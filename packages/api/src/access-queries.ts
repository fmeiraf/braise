import {
	type AgentCapability,
	type AgentOverview,
	attemptSummary,
	capabilities,
	type InboxAccessRequest,
} from "@braise/core";
import { asc, desc, eq, inArray, ne } from "drizzle-orm";
import type { Database } from "./db/client.ts";
import { accessRequests, agentGrants, agentProfiles, goals, threads, ventures, workItems } from "./db/schema.ts";

const decidedLimit = 20;

function accessRows(db: Database) {
	return db
		.select({
			request: accessRequests,
			agent: { id: agentProfiles.id, name: agentProfiles.name },
			thread: { id: threads.id, title: threads.title, ventureId: threads.ventureId },
			venture: { id: ventures.id, slug: ventures.slug, name: ventures.name },
		})
		.from(accessRequests)
		.innerJoin(agentProfiles, eq(agentProfiles.id, accessRequests.profileId))
		.innerJoin(threads, eq(threads.id, accessRequests.threadId))
		.leftJoin(ventures, eq(ventures.id, accessRequests.ventureId));
}

async function threadVentureSlugs(db: Database, ids: string[]) {
	if (ids.length === 0) return new Map<string, string>();

	const rows = await db
		.select({ id: ventures.id, slug: ventures.slug })
		.from(ventures)
		.where(inArray(ventures.id, ids));

	return new Map(rows.map((row) => [row.id, row.slug]));
}

const referenceKeys = ["goalId", "parentId", "workItemId"] as const;

async function referenceLabels(db: Database, payloads: Record<string, unknown>[]) {
	const ids = [
		...new Set(
			payloads.flatMap((payload) =>
				referenceKeys.map((key) => payload[key]).filter((value) => typeof value === "string"),
			),
		),
	];

	if (ids.length === 0) return new Map<string, string>();

	const [goalRows, workRows] = await Promise.all([
		db.select({ id: goals.id, label: goals.outcome }).from(goals).where(inArray(goals.id, ids)),
		db.select({ id: workItems.id, label: workItems.title }).from(workItems).where(inArray(workItems.id, ids)),
	]);

	return new Map([...goalRows, ...workRows].map((row) => [row.id, row.label]));
}

function referencesOf(payload: Record<string, unknown>, labels: Map<string, string>) {
	return Object.fromEntries(
		referenceKeys.flatMap((key) => {
			const id = payload[key];
			const label = typeof id === "string" ? labels.get(id) : undefined;

			return label === undefined ? [] : [[key, label]];
		}),
	);
}

export async function accessInbox(db: Database) {
	const [pending, decided] = await Promise.all([
		accessRows(db).where(eq(accessRequests.status, "pending")).orderBy(asc(accessRequests.createdAt)),
		accessRows(db)
			.where(ne(accessRequests.status, "pending"))
			.orderBy(desc(accessRequests.decidedAt))
			.limit(decidedLimit),
	]);

	const threadVentures = [...pending, ...decided].map((row) => row.thread.ventureId).filter((id) => id !== null);

	const [slugs, labels] = await Promise.all([
		threadVentureSlugs(db, [...new Set(threadVentures)]),
		referenceLabels(
			db,
			[...pending, ...decided].map((row) => row.request.payload),
		),
	]);

	const toItem = (row: (typeof pending)[number]) =>
		({
			kind: "access_request",
			id: row.request.id,
			agent: row.agent,
			capability: row.request.capability,
			command: row.request.command,
			payload: row.request.payload,
			references: referencesOf(row.request.payload, labels),
			summary: attemptSummary(row.request.command, row.request.payload),
			attempts: row.request.attempts,
			venture: row.venture,
			thread: {
				id: row.thread.id,
				title: row.thread.title,
				ventureSlug: row.thread.ventureId === null ? null : (slugs.get(row.thread.ventureId) ?? null),
			},
			runId: row.request.runId,
			status: row.request.status,
			note: row.request.note,
			createdAt: row.request.createdAt.toISOString(),
			decidedAt: row.request.decidedAt?.toISOString() ?? null,
		}) satisfies InboxAccessRequest;

	return { pending: pending.map(toItem), decided: decided.map(toItem) };
}

export async function getAgents(db: Database) {
	const [profiles, grants, pending] = await Promise.all([
		db.select().from(agentProfiles).orderBy(asc(agentProfiles.createdAt), asc(agentProfiles.id)),
		db.select().from(agentGrants).orderBy(asc(agentGrants.grantedAt)),
		db
			.select({ id: accessRequests.id, profileId: accessRequests.profileId, capability: accessRequests.capability })
			.from(accessRequests)
			.where(eq(accessRequests.status, "pending")),
	]);

	return profiles.map((profile) => {
		const capabilityStates = capabilities.map((capability) => {
			const history = grants.filter((grant) => grant.profileId === profile.id && grant.capability === capability);
			const latest = history.at(-1);
			const granted = latest !== undefined && latest.revokedAt === null;
			const request = pending.find((row) => row.profileId === profile.id && row.capability === capability);

			return {
				capability,
				granted,
				changedAt: (granted ? latest?.grantedAt : latest?.revokedAt)?.toISOString() ?? null,
				changedBy: (granted ? latest?.grantedBy : latest?.revokedBy) ?? null,
				viaRequest: granted && latest?.accessRequestId !== null,
				pendingRequestId: request?.id ?? null,
			} satisfies AgentCapability;
		});

		return {
			id: profile.id,
			actor: profile.actor,
			name: profile.name,
			runtime: profile.runtime,
			model: profile.model,
			capabilities: capabilityStates,
		} satisfies AgentOverview;
	});
}
