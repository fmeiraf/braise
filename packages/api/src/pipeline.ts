import { createHash } from "node:crypto";
import {
	type CommandName,
	type CommandPayload,
	type CommandResponse,
	commandEnvelope,
	commandSchemas,
	commandsRequiringReason,
	isCommandName,
} from "@braise/core";
import { eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { z } from "zod";
import type { Database, Transaction } from "./db/client.ts";
import { commands, events, ventures } from "./db/schema.ts";
import { AppError } from "./errors.ts";

export const notifyChannel = "venture_events";

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
	venture: VentureRow | null;
}

export interface HandlerOutcome {
	ventureId: string;
	result: unknown;
	events: PendingEvent[];
}

export type Handler<Name extends CommandName> = (
	context: HandlerContext,
	payload: CommandPayload<Name>,
) => Promise<HandlerOutcome>;

export type Handlers = { [Name in CommandName]: Handler<Name> };

export interface CommandRequest {
	name: string;
	body: unknown;
	actor: string;
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

async function run<Name extends CommandName>(db: Database, handlers: Handlers, name: Name, request: CommandRequest) {
	const { payload, idempotencyKey, reason } = parse(name, request.body);
	const payloadHash = hashCommand(name, payload, reason);
	const targetVentureId = ventureIdOf(payload);

	return db.transaction(async (tx) => {
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

		const venture = targetVentureId === null ? null : await lockVenture(tx, targetVentureId);

		const outcome = await handlers[name]({ tx, actor: request.actor, reason, venture }, payload);

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
			})),
		);

		const response = JSON.parse(
			JSON.stringify({ result: outcome.result, seq: sequenced.lastSeq } satisfies CommandResponse),
		) as CommandResponse;

		await tx
			.update(commands)
			.set({ result: response, ventureId: outcome.ventureId })
			.where(eq(commands.id, commandId));

		await tx.execute(sql`SELECT pg_notify(${notifyChannel}, ${`${outcome.ventureId}:${sequenced.lastSeq}`})`);

		return response;
	});
}

export function executeCommand(db: Database, handlers: Handlers, request: CommandRequest) {
	if (!isCommandName(request.name)) {
		throw new AppError("not_found", `Unknown command ${request.name}`, { command: request.name });
	}

	return run(db, handlers, request.name, request);
}
