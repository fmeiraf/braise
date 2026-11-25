import { createHash } from "node:crypto";
import {
	type Capability,
	type CommandName,
	type CommandPayload,
	type CommandResponse,
	capabilityLabels,
	capabilityOf,
	commandEnvelope,
	commandSchemas,
	commandsRequiringReason,
	isAgentActor,
	isCommandName,
} from "@braise/core";
import { and, eq, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { z } from "zod";
import { accessChannel, notifyChannel, threadChannel } from "./channels.ts";
import type { Database, Transaction } from "./db/client.ts";
import { agentGrants, agentProfiles, commands, events, runs, ventures } from "./db/schema.ts";
import { AppError } from "./errors.ts";

export interface Services {
	enqueueRun(runId: string): Promise<void>;
}

export type VentureRow = typeof ventures.$inferSelect;

export interface PendingEvent {
	type: string;
	subject: string;
	payload: Record<string, unknown>;
}

export interface HandlerContext {
	tx: Transaction;
	actor: string;
	reason: string | null;
	runId: string | null;
	venture: VentureRow | null;
	queueRun(runId: string): void;
}

export interface VentureOutcome {
	ventureId: string;
	result: unknown;
	events: PendingEvent[];
}

export interface ThreadOutcome {
	thread: { id: string; ventureId: string | null; seq: number };
	result: unknown;
}

export interface GlobalOutcome {
	global: true;
	result: unknown;
}

export type HandlerOutcome = VentureOutcome | ThreadOutcome | GlobalOutcome;

export type Handler<Name extends CommandName> = (
	context: HandlerContext,
	payload: CommandPayload<Name>,
) => Promise<HandlerOutcome>;

export type Handlers = { [Name in CommandName]: Handler<Name> };

export interface CommandRequest {
	name: string;
	body: unknown;
	actor: string;
	runId?: string | null;
}

function validationError(error: z.ZodError, scope: string) {
	return new AppError("validation_failed", "The command is not valid", {
		scope,
		issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
	});
}

function parse<Name extends CommandName>(name: Name, body: unknown) {
	const envelope = commandEnvelope.safeParse(body);

	if (!envelope.success) throw validationError(envelope.error, "envelope");

	const payload = commandSchemas[name].safeParse(envelope.data.payload);

	if (!payload.success) throw validationError(payload.error, "payload");

	if (commandsRequiringReason.has(name) && envelope.data.reason === undefined) {
		throw new AppError("validation_failed", "A reason is required", {
			scope: "envelope",
			issues: [{ path: "reason", message: "A reason is required" }],
		});
	}

	return {
		payload: payload.data as CommandPayload<Name>,
		idempotencyKey: envelope.data.idempotencyKey,
		reason: envelope.data.reason ?? null,
	};
}

function hashCommand(name: string, payload: unknown, reason: string | null) {
	return createHash("sha256").update(JSON.stringify({ name, payload, reason })).digest("hex");
}

function ventureIdOf(payload: object) {
	return "ventureId" in payload && typeof payload.ventureId === "string" ? payload.ventureId : null;
}

async function lockVenture(tx: Transaction, ventureId: string) {
	const [venture] = await tx.select().from(ventures).where(eq(ventures.id, ventureId)).for("update");

	if (venture === undefined) throw new AppError("not_found", "Venture not found", { ventureId });

	if (venture.archivedAt !== null) throw new AppError("rule_violated", "The venture is archived", { ventureId });

	return venture;
}

async function finishVentureCommand(
	tx: Transaction,
	commandId: string,
	request: CommandRequest,
	outcome: VentureOutcome,
) {
	const [sequenced] = await tx
		.update(ventures)
		.set({ lastSeq: sql`${ventures.lastSeq} + ${outcome.events.length}`, updatedAt: sql`now()` })
		.where(eq(ventures.id, outcome.ventureId))
		.returning({ lastSeq: ventures.lastSeq });

	if (sequenced === undefined) throw new AppError("internal_error", "Venture disappeared during the command");

	const firstSeq = sequenced.lastSeq - outcome.events.length + 1;

	await tx.insert(events).values(
		outcome.events.map((event, index) => ({
			ventureId: outcome.ventureId,
			seq: firstSeq + index,
			commandId,
			type: event.type,
			subject: event.subject,
			payload: event.payload,
			actor: request.actor,
			runId: request.runId ?? null,
		})),
	);

	await tx.execute(sql`SELECT pg_notify(${notifyChannel}, ${`${outcome.ventureId}:${sequenced.lastSeq}`})`);

	return { ventureId: outcome.ventureId, seq: sequenced.lastSeq };
}

export function notifyThread(tx: Transaction | Database, thread: { id: string; ventureId: string | null }) {
	return tx.execute(
		sql`SELECT pg_notify(${threadChannel}, ${JSON.stringify({ threadId: thread.id, ventureId: thread.ventureId })})`,
	);
}

async function finishThreadCommand(tx: Transaction, outcome: ThreadOutcome) {
	await notifyThread(tx, outcome.thread);

	return { ventureId: outcome.thread.ventureId, seq: outcome.thread.seq };
}

async function finishGlobalCommand(tx: Transaction) {
	await tx.execute(sql`SELECT pg_notify(${accessChannel}, '')`);

	return { ventureId: null, seq: 0 };
}

function activeGrant(executor: Database | Transaction, actor: string, capability: Capability) {
	return executor
		.select({ id: agentGrants.id })
		.from(agentGrants)
		.innerJoin(agentProfiles, eq(agentProfiles.id, agentGrants.profileId))
		.where(
			and(eq(agentProfiles.actor, actor), eq(agentGrants.capability, capability), isNull(agentGrants.revokedAt)),
		);
}

async function holdsCapability(db: Database, actor: string, capability: Capability) {
	const [grant] = await activeGrant(db, actor, capability);

	return grant !== undefined;
}

async function assertStillGranted(tx: Transaction, name: CommandName, actor: string) {
	const capability = isAgentActor(actor) ? capabilityOf(name) : null;

	if (capability === null) return;

	const [grant] = await activeGrant(tx, actor, capability).for("share", { of: agentGrants });

	if (grant === undefined) {
		throw new AppError("not_granted", `${capabilityLabels[capability]} was revoked`, {
			command: name,
			actor,
			capability,
		});
	}
}

function assertGrantable(name: CommandName, actor: string) {
	if (isAgentActor(actor) && name !== "access.request" && capabilityOf(name) === null) {
		throw new AppError("not_granted", "Agents may not run this command", { command: name, actor });
	}
}

async function assertGranted(
	db: Database,
	handlers: Handlers,
	services: Services,
	name: CommandName,
	request: CommandRequest,
	attempt: { payload: object; idempotencyKey: string },
) {
	const capability = isAgentActor(request.actor) ? capabilityOf(name) : null;

	if (capability === null) return;

	const details = { command: name, actor: request.actor };

	if (await holdsCapability(db, request.actor, capability)) return;

	const refused = { ...details, capability };
	const runId = request.runId ?? null;

	const [found] =
		runId === null ? [] : await db.select({ threadId: runs.threadId }).from(runs).where(eq(runs.id, runId));

	if (runId === null || found === undefined) {
		throw new AppError("not_granted", `${capabilityLabels[capability]} isn't granted to this agent`, refused);
	}

	const attempted = { ...attempt.payload } as Record<string, unknown>;

	const filed = await run(db, handlers, services, "access.request", {
		name: "access.request",
		actor: request.actor,
		runId,
		body: {
			payload: { capability, threadId: found.threadId, command: name, payload: attempted },
			idempotencyKey: `access:${attempt.idempotencyKey}`,
		},
	});

	const { accessRequest } = filed.result as { accessRequest: { id: string } };

	throw new AppError("not_granted", `${capabilityLabels[capability]} isn't granted; the owner was asked`, {
		...refused,
		accessRequestId: accessRequest.id,
	});
}

async function run<Name extends CommandName>(
	db: Database,
	handlers: Handlers,
	services: Services,
	name: Name,
	request: CommandRequest,
) {
	assertGrantable(name, request.actor);

	const { payload, idempotencyKey, reason } = parse(name, request.body);

	await assertGranted(db, handlers, services, name, request, { payload, idempotencyKey });

	const payloadHash = hashCommand(name, payload, reason);
	const targetVentureId = ventureIdOf(payload);
	const queuedRuns: string[] = [];

	const response = await db.transaction(async (tx) => {
		const commandId = uuidv7();

		const inserted = await tx
			.insert(commands)
			.values({
				id: commandId,
				idempotencyKey,
				name,
				ventureId: targetVentureId,
				actor: request.actor,
				reason,
				payload,
				payloadHash,
				runId: request.runId ?? null,
			})
			.onConflictDoNothing({ target: commands.idempotencyKey })
			.returning({ id: commands.id });

		if (inserted.length === 0) {
			const [stored] = await tx
				.select({ payloadHash: commands.payloadHash, result: commands.result })
				.from(commands)
				.where(eq(commands.idempotencyKey, idempotencyKey));

			if (stored === undefined || stored.payloadHash !== payloadHash) {
				throw new AppError("idempotency_conflict", "This idempotency key was used for a different command", {
					idempotencyKey,
				});
			}

			return stored.result as CommandResponse;
		}

		await assertStillGranted(tx, name, request.actor);

		const venture = targetVentureId === null ? null : await lockVenture(tx, targetVentureId);

		const outcome = await handlers[name](
			{
				tx,
				actor: request.actor,
				reason,
				runId: request.runId ?? null,
				venture,
				queueRun: (runId) => queuedRuns.push(runId),
			},
			payload,
		);

		const finished =
			"global" in outcome
				? await finishGlobalCommand(tx)
				: "thread" in outcome
					? await finishThreadCommand(tx, outcome)
					: await finishVentureCommand(tx, commandId, request, outcome);

		const response = JSON.parse(
			JSON.stringify({ result: outcome.result, seq: finished.seq } satisfies CommandResponse),
		) as CommandResponse;

		await tx
			.update(commands)
			.set({ result: response, ventureId: finished.ventureId })
			.where(eq(commands.id, commandId));

		return response;
	});

	for (const runId of queuedRuns) await services.enqueueRun(runId);

	return response;
}

export function executeCommand(db: Database, handlers: Handlers, services: Services, request: CommandRequest) {
	if (!isCommandName(request.name)) {
		throw new AppError("not_found", `Unknown command ${request.name}`, { command: request.name });
	}

	return run(db, handlers, services, request.name, request);
}
