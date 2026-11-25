import { accessDecisionLine, type Capability, systemAuthor } from "@braise/core";
import { and, eq, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { Transaction } from "./db/client.ts";
import { accessRequests, agentGrants, agentProfiles, commands, runs, threads, ventures } from "./db/schema.ts";
import { AppError } from "./errors.ts";
import { type Handlers, notifyThread } from "./pipeline.ts";
import { appendMessage, lockThread } from "./thread-handlers.ts";

type AccessRequestRow = typeof accessRequests.$inferSelect;

function noChanges() {
	return new AppError("rule_violated", "Nothing changed", { rule: "no_changes" });
}

async function profileById(tx: Transaction, profileId: string) {
	const [profile] = await tx.select().from(agentProfiles).where(eq(agentProfiles.id, profileId));

	if (profile === undefined) throw new AppError("not_found", "Agent profile not found", { profileId });

	return profile;
}

async function activeGrant(tx: Transaction, profileId: string, capability: Capability) {
	const [grant] = await tx
		.select()
		.from(agentGrants)
		.where(
			and(
				eq(agentGrants.profileId, profileId),
				eq(agentGrants.capability, capability),
				isNull(agentGrants.revokedAt),
			),
		)
		.for("update");

	return grant;
}

async function lockPending(tx: Transaction, accessRequestId: string) {
	const [request] = await tx.select().from(accessRequests).where(eq(accessRequests.id, accessRequestId)).for("update");

	if (request === undefined) throw new AppError("not_found", "Access request not found", { accessRequestId });

	if (request.status !== "pending") {
		throw new AppError("rule_violated", "This access request was already decided", {
			rule: "access_decided",
			status: request.status,
		});
	}

	return request;
}

async function pendingRequest(tx: Transaction, profileId: string, capability: Capability) {
	const [request] = await tx
		.select()
		.from(accessRequests)
		.where(
			and(
				eq(accessRequests.profileId, profileId),
				eq(accessRequests.capability, capability),
				eq(accessRequests.status, "pending"),
			),
		)
		.for("update");

	return request;
}

async function requestingThreads(tx: Transaction, request: AccessRequestRow) {
	const rows = await tx
		.selectDistinct({ threadId: sql<string>`${commands.payload}->>'threadId'` })
		.from(commands)
		.where(
			and(
				eq(commands.name, "access.request"),
				sql`${commands.result}->'result'->'accessRequest'->>'id' = ${request.id}`,
			),
		);

	return [...new Set([request.threadId, ...rows.map((row) => row.threadId)])].toSorted();
}

async function decide(tx: Transaction, request: AccessRequestRow, status: "approved" | "denied", note: string | null) {
	const [decided] = await tx
		.update(accessRequests)
		.set({ status, note, decidedAt: sql`now()` })
		.where(eq(accessRequests.id, request.id))
		.returning();

	if (decided === undefined) throw new AppError("internal_error", "Access request disappeared");

	const profile = await profileById(tx, request.profileId);

	const body = accessDecisionLine({ status, capability: request.capability, agentName: profile.name, note });

	for (const threadId of await requestingThreads(tx, request)) {
		const thread = await lockThread(tx, threadId);

		if (thread.archivedAt !== null) continue;

		await appendMessage(tx, thread, { author: systemAuthor, body, runId: null });

		await notifyThread(tx, thread);
	}

	return decided;
}

async function addGrant(
	tx: Transaction,
	grant: { profileId: string; capability: Capability; grantedBy: string; accessRequestId: string | null },
) {
	const [created] = await tx
		.insert(agentGrants)
		.values({ id: uuidv7(), ...grant })
		.onConflictDoNothing({
			target: [agentGrants.profileId, agentGrants.capability],
			where: sql`${agentGrants.revokedAt} IS NULL`,
		})
		.returning();

	return created;
}

function globalOutcome(result: unknown) {
	return { global: true as const, result };
}

export const accessHandlers = {
	"access.request": async ({ tx, actor, runId }, payload) => {
		const [profile] = await tx.select().from(agentProfiles).where(eq(agentProfiles.actor, actor));

		if (profile === undefined) throw new AppError("not_found", "Agent profile not found", { actor });

		if (runId === null) throw new AppError("validation_failed", "An access request needs a run", { scope: "run" });

		const [run] = await tx
			.select({ threadId: runs.threadId, threadVentureId: threads.ventureId })
			.from(runs)
			.innerJoin(threads, eq(threads.id, runs.threadId))
			.where(eq(runs.id, runId));

		if (run?.threadId !== payload.threadId) {
			throw new AppError("validation_failed", "The run doesn't belong to this thread", { runId });
		}

		const attemptedVenture =
			typeof payload.payload.ventureId === "string" ? payload.payload.ventureId : run.threadVentureId;

		const [venture] =
			attemptedVenture === null
				? []
				: await tx.select({ id: ventures.id }).from(ventures).where(eq(ventures.id, attemptedVenture));

		const [request] = await tx
			.insert(accessRequests)
			.values({
				id: uuidv7(),
				profileId: profile.id,
				capability: payload.capability,
				threadId: payload.threadId,
				runId,
				ventureId: venture?.id ?? null,
				command: payload.command,
				payload: payload.payload,
				status: "pending",
			})
			.onConflictDoUpdate({
				target: [accessRequests.profileId, accessRequests.capability],
				targetWhere: sql`${accessRequests.status} = 'pending'`,
				set: { attempts: sql`${accessRequests.attempts} + 1` },
			})
			.returning();

		return globalOutcome({ accessRequest: request });
	},
	"access.approve": async ({ tx, actor }, payload) => {
		const request = await lockPending(tx, payload.accessRequestId);

		const grant =
			(await addGrant(tx, {
				profileId: request.profileId,
				capability: request.capability,
				grantedBy: actor,
				accessRequestId: request.id,
			})) ?? (await activeGrant(tx, request.profileId, request.capability));

		const decided = await decide(tx, request, "approved", payload.note ?? null);

		return globalOutcome({ accessRequest: decided, grant });
	},
	"access.deny": async ({ tx }, payload) => {
		const request = await lockPending(tx, payload.accessRequestId);

		const decided = await decide(tx, request, "denied", payload.note ?? null);

		return globalOutcome({ accessRequest: decided });
	},
	"grant.add": async ({ tx, actor }, payload) => {
		await profileById(tx, payload.profileId);

		if ((await activeGrant(tx, payload.profileId, payload.capability)) !== undefined) throw noChanges();

		const request = await pendingRequest(tx, payload.profileId, payload.capability);

		const grant = await addGrant(tx, {
			profileId: payload.profileId,
			capability: payload.capability,
			grantedBy: actor,
			accessRequestId: request?.id ?? null,
		});

		if (grant === undefined) throw noChanges();

		if (request !== undefined) await decide(tx, request, "approved", null);

		return globalOutcome({ grant });
	},
	"grant.revoke": async ({ tx, actor }, payload) => {
		await profileById(tx, payload.profileId);

		const grant = await activeGrant(tx, payload.profileId, payload.capability);

		if (grant === undefined) throw noChanges();

		const [revoked] = await tx
			.update(agentGrants)
			.set({ revokedBy: actor, revokedAt: sql`now()` })
			.where(eq(agentGrants.id, grant.id))
			.returning();

		return globalOutcome({ grant: revoked });
	},
} satisfies Pick<Handlers, "access.request" | "access.approve" | "access.deny" | "grant.add" | "grant.revoke">;
