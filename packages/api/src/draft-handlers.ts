import {
	type CommandPayload,
	commandSchemas,
	type DraftBase,
	type DraftChange,
	type DraftHint,
	draftClosedLine,
	dropClosure,
	isCreating,
	isPointer,
	keepClosure,
	maxDraftChanges,
	type OperableCommand,
	referenceSlots,
	samePayload,
	subjectOfChange,
	systemAuthor,
	withSlot,
} from "@braise/core";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { draftChannel } from "./channels.ts";
import type { Executor, Transaction } from "./db/client.ts";
import { assumptions, bets, objectives, proposals, runs, strategyVersions, threads, workItems } from "./db/schema.ts";
import { type Board, changeLabel } from "./draft-labels.ts";
import { AppError } from "./errors.ts";
import {
	type Handler,
	type HandlerContext,
	type Handlers,
	notifyThread,
	type PendingEvent,
	type VentureRow,
} from "./pipeline.ts";
import { getCockpit, getVentureWork } from "./queries.ts";
import { appendMessage, lockThread } from "./thread-handlers.ts";

export type OperableHandlers = Pick<Handlers, OperableCommand>;

export type DraftRow = typeof proposals.$inferSelect;

export function changesOf(draft: Pick<DraftRow, "changes">) {
	return draft.changes as unknown as DraftChange[];
}

function requireVenture(context: HandlerContext) {
	if (context.venture === null) throw new AppError("internal_error", "Command ran without a venture lock");

	return context.venture;
}

export function notifyDraft(tx: Transaction, hint: DraftHint) {
	return tx.execute(sql`SELECT pg_notify(${draftChannel}, ${JSON.stringify(hint)})`);
}

export async function currentDraft(executor: Executor, ventureId: string) {
	const [draft] = await executor
		.select()
		.from(proposals)
		.where(and(eq(proposals.ventureId, ventureId), eq(proposals.status, "drafting")));

	return draft;
}

async function lockDraft(tx: Transaction, ventureId: string) {
	const [draft] = await tx
		.select()
		.from(proposals)
		.where(and(eq(proposals.ventureId, ventureId), eq(proposals.status, "drafting")))
		.for("update");

	return draft;
}

async function requireDraft(tx: Transaction, ventureId: string) {
	const draft = await lockDraft(tx, ventureId);

	if (draft === undefined) {
		throw new AppError("rule_violated", "The venture has no open draft", { rule: "draft_none", ventureId });
	}

	return draft;
}

function notOpen(changeId: string) {
	return new AppError("rule_violated", "That change is not open in the draft", {
		rule: "draft_change_not_open",
		changeId,
	});
}

const tableOfCommand = {
	objective: objectives,
	assumption: assumptions,
	bet: bets,
	work: workItems,
} as const;

type RowTable = keyof typeof tableOfCommand;

const createTables = {
	"objective.create": "objective",
	"assumption.create": "assumption",
	"bet.create": "bet",
	"work.create": "work",
	"reading.record": null,
} as const;

function tableOf(command: OperableCommand) {
	const prefix = command.split(".")[0];

	return prefix !== undefined && Object.hasOwn(tableOfCommand, prefix) ? (prefix as RowTable) : null;
}

const tableNames = { objective: "objective", assumption: "assumption", bet: "bet", work: "work item" } as const;

async function rowStamp(executor: Executor, table: RowTable, id: string) {
	const source = tableOfCommand[table];

	const [found] = await executor
		.select({ ventureId: source.ventureId, updatedAt: source.updatedAt, archivedAt: source.archivedAt })
		.from(source)
		.where(eq(source.id, id));

	return found;
}

async function activeVersion(executor: Executor, ventureId: string) {
	const [strategy] = await executor
		.select({ version: strategyVersions.version })
		.from(strategyVersions)
		.where(and(eq(strategyVersions.ventureId, ventureId), eq(strategyVersions.status, "active")));

	return strategy?.version ?? null;
}

function touchedRows(change: Pick<DraftChange, "command" | "payload">) {
	const rows: { table: RowTable; id: string }[] = [];
	const subject = subjectOfChange(change);
	const table = tableOf(change.command);

	if (subject !== null && typeof subject.value === "string" && table !== null) {
		rows.push({ table, id: subject.value });
	}

	for (const slot of referenceSlots(change.command, change.payload)) {
		const target = createTables[slot.target];

		if (target !== null && typeof slot.value === "string") rows.push({ table: target, id: slot.value });
	}

	return rows;
}

/** The base of a change: the `updated_at` of every real row it touches, and the strategy version for a revision. */
export async function draftBaseOf(
	executor: Executor,
	ventureId: string,
	change: Pick<DraftChange, "command" | "payload">,
) {
	const base: DraftBase = { rows: {} };

	if (change.command === "strategy.revise") {
		const version = await activeVersion(executor, ventureId);

		if (version !== null) base.strategyVersion = version;
	}

	for (const row of touchedRows(change)) {
		const found = await rowStamp(executor, row.table, row.id);

		if (found !== undefined && found.ventureId === ventureId) {
			base.rows[`${row.table}:${row.id}`] = found.updatedAt.toISOString();
		}
	}

	return base;
}

/** Why a change no longer fits the board it was drafted against, or null. */
export async function draftStaleness(executor: Executor, ventureId: string, base: DraftBase) {
	if (base.strategyVersion !== undefined) {
		const version = await activeVersion(executor, ventureId);

		if (version !== base.strategyVersion) return `The strategy is now v${version}`;
	}

	for (const [key, updatedAt] of Object.entries(base.rows)) {
		const [table, id] = key.split(":") as [RowTable, string];

		const found = await rowStamp(executor, table, id);

		if (found === undefined || found.archivedAt !== null) return `The ${tableNames[table]} was archived`;

		if (found.updatedAt.toISOString() !== updatedAt) return `The ${tableNames[table]} changed since`;
	}

	return null;
}

function withoutVenture(venture: VentureRow, payload: Record<string, unknown>) {
	const { ventureId, ...rest } = payload;

	if (ventureId !== undefined && ventureId !== venture.id) {
		throw new AppError("rule_violated", "A draft change is for the draft's venture", {
			rule: "draft_out_of_scope",
		});
	}

	return rest;
}

function normalize(
	command: OperableCommand,
	payload: Record<string, unknown>,
	changes: DraftChange[],
	before: number,
	keptEarlier: DraftChange[] = [],
) {
	let normalized = payload;

	const earlier = changes.slice(0, before);
	const known = [...changes, ...keptEarlier];

	for (const slot of referenceSlots(command, payload)) {
		const field = slot.path.join(".");

		if (isPointer(slot.value)) {
			const pointer = slot.value;
			const target = known.find((change) => change.id === pointer.change);
			const placed = earlier.some((change) => change.id === pointer.change);

			if (target === undefined || target.state === "dropped" || (target.state === "open" && !placed)) {
				throw new AppError("rule_violated", `${field} points at a change that is not an earlier open one`, {
					rule: "draft_pointer_invalid",
					field,
					change: pointer.change,
				});
			}

			if (target.command !== slot.target) {
				throw new AppError("rule_violated", `${field} must point at a ${slot.target}`, {
					rule: "draft_pointer_invalid",
					field,
					change: pointer.change,
					expected: slot.target,
				});
			}

			if (target.state === "kept") normalized = withSlot(normalized, slot.path, target.entityId);

			continue;
		}

		const drafted = earlier.find(
			(change) => change.state === "open" && change.entityId === slot.value && change.command === slot.target,
		);

		if (drafted !== undefined) normalized = withSlot(normalized, slot.path, { change: drafted.id });
	}

	const subject = subjectOfChange({ command, payload: normalized });

	if (subject === null) return normalized;

	const { field, value } = subject;

	const named = isPointer(value)
		? known.find((change) => change.id === value.change)
		: changes.find((change) => change.state === "open" && isCreating(change.command) && change.entityId === value);

	if (named?.state === "open") {
		throw new AppError("rule_violated", "That item is itself still in the draft; revise its change instead", {
			rule: "draft_revise_create",
			changeId: named.id,
		});
	}

	if (!isPointer(value)) return normalized;

	if (named?.state !== "kept") {
		throw new AppError("rule_violated", `${field} points at a change that is not in the draft`, {
			rule: "draft_pointer_invalid",
			field,
			change: value.change,
		});
	}

	return { ...normalized, [field]: named.entityId };
}

async function keptInClosedDrafts(tx: Transaction, ventureId: string) {
	const closed = await tx
		.select({ changes: proposals.changes })
		.from(proposals)
		.innerJoin(threads, eq(threads.id, proposals.threadId))
		.where(
			and(
				eq(proposals.ventureId, ventureId),
				eq(proposals.status, "approved"),
				isNotNull(threads.operatorVentureId),
			),
		)
		.orderBy(desc(proposals.decidedAt))
		.limit(5);

	return closed.flatMap((draft) => changesOf(draft).filter((change) => change.state === "kept"));
}

function entityOf(venture: VentureRow, command: OperableCommand, payload: Record<string, unknown>) {
	if (isCreating(command)) return uuidv7();

	if (command === "venture.update") return venture.id;

	const subject = subjectOfChange({ command, payload });

	return typeof subject?.value === "string" ? subject.value : null;
}

function resolvePointers(change: DraftChange, entities: Map<string, string>, failed: Set<string>) {
	let resolved = change.payload;

	for (const slot of referenceSlots(change.command, change.payload)) {
		if (!isPointer(slot.value)) continue;

		const target = slot.value.change;
		const entity = entities.get(target);

		if (entity === undefined || failed.has(target)) {
			throw new AppError("rule_violated", "This change builds on a drafted item that can't be applied", {
				rule: "draft_pointer_unresolved",
				change: target,
			});
		}

		resolved = withSlot(resolved, slot.path, entity);
	}

	return resolved;
}

function parseChange(command: OperableCommand, payload: Record<string, unknown>) {
	const parsed = commandSchemas[command].safeParse(payload);

	if (!parsed.success) {
		throw new AppError("validation_failed", "The change is not valid", {
			scope: "change",
			issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
		});
	}

	return parsed.data as CommandPayload<OperableCommand>;
}

function handlerFor(apply: OperableHandlers, command: OperableCommand) {
	return apply[command] as Handler<OperableCommand>;
}

export interface ReplayStep {
	change: DraftChange;
	stale: string | null;
	error: AppError | null;
	events: PendingEvent[];
}

function asAppError(error: unknown) {
	if (error instanceof AppError) return error;

	return new AppError("rule_violated", error instanceof Error ? error.message : String(error), {
		rule: "draft_replay_failed",
	});
}

/**
 * Applies the open changes in order through the real handlers, each in its own savepoint. A stale or failing
 * change is skipped and recorded; `strict` names a change whose failure is thrown instead.
 */
export async function replay(
	apply: OperableHandlers,
	context: HandlerContext,
	venture: VentureRow,
	changes: DraftChange[],
	stale: Map<string, string | null>,
	strict: string | null = null,
) {
	const entities = new Map<string, string>();
	const failed = new Set<string>();
	const steps: ReplayStep[] = [];

	for (const change of changes) {
		if (change.state === "kept" && change.entityId !== null) entities.set(change.id, change.entityId);
	}

	for (const change of changes) {
		if (change.state !== "open") continue;

		if (change.entityId !== null && isCreating(change.command)) entities.set(change.id, change.entityId);

		const staleReason = stale.get(change.id) ?? null;

		if (staleReason !== null) {
			failed.add(change.id);

			steps.push({ change, stale: staleReason, error: null, events: [] });

			continue;
		}

		await context.tx.execute(sql`SAVEPOINT draft_step`);

		try {
			const payload = parseChange(change.command, {
				...resolvePointers(change, entities, failed),
				ventureId: venture.id,
			});

			const outcome = await handlerFor(apply, change.command)(
				{
					...context,
					reason: change.note,
					presetId: isCreating(change.command) ? (change.entityId ?? undefined) : undefined,
				},
				payload,
			);

			await context.tx.execute(sql`RELEASE SAVEPOINT draft_step`);

			steps.push({ change, stale: null, error: null, events: "events" in outcome ? outcome.events : [] });
		} catch (error) {
			await context.tx.execute(sql`ROLLBACK TO SAVEPOINT draft_step`);

			const appError = asAppError(error);

			if (change.id === strict) {
				throw new AppError(appError.code, appError.message, { ...appError.details, change: change.id });
			}

			failed.add(change.id);

			steps.push({ change, stale: null, error: appError, events: [] });
		}
	}

	return steps;
}

export async function stalenessOf(executor: Executor, ventureId: string, changes: DraftChange[]) {
	const stale = new Map<string, string | null>();

	for (const change of changes) {
		if (change.state === "open") stale.set(change.id, await draftStaleness(executor, ventureId, change.base));
	}

	return stale;
}

export async function boardOf(executor: Executor, slug: string) {
	const cockpit = await getCockpit(executor, slug);

	const work = await getVentureWork(executor, slug);

	return { ...cockpit, workItems: work.workItems } satisfies Board;
}

async function checkAndLabel(
	apply: OperableHandlers,
	context: HandlerContext,
	venture: VentureRow,
	changes: DraftChange[],
	checked: DraftChange,
) {
	const stale = await stalenessOf(context.tx, venture.id, changes);

	stale.set(checked.id, null);

	const labelAfter = isCreating(checked.command) || checked.command === "venture.update";

	const before = labelAfter ? null : changeLabel(await boardOf(context.tx, venture.slug), checked);

	await context.tx.execute(sql`SAVEPOINT draft_check`);

	try {
		await replay(apply, context, venture, changes, stale, checked.id);

		return before ?? changeLabel(await boardOf(context.tx, venture.slug), checked);
	} finally {
		await context.tx.execute(sql`ROLLBACK TO SAVEPOINT draft_check`);
	}
}

async function operatorRun(context: HandlerContext, venture: VentureRow) {
	const runId = context.runId;

	const [found] =
		runId === null
			? []
			: await context.tx
					.select({ id: threads.id, ventureId: threads.operatorVentureId })
					.from(runs)
					.innerJoin(threads, eq(threads.id, runs.threadId))
					.where(eq(runs.id, runId));

	if (runId === null || found === undefined || found.ventureId !== venture.id) {
		throw new AppError("not_in_operator_chat", "Only the venture's operator, in its operator chat, can draft", {
			actor: context.actor,
		});
	}

	return { threadId: found.id, runId };
}

export async function openSessionOf(executor: Executor, ventureId: string) {
	const [session] = await executor
		.select()
		.from(threads)
		.where(and(eq(threads.operatorVentureId, ventureId), isNull(threads.archivedAt)));

	return session;
}

async function store(
	tx: Transaction,
	draft: DraftRow,
	changes: DraftChange[],
	hint: Omit<DraftHint, "ventureId" | "version">,
) {
	const open = changes.filter((change) => change.state === "open");
	const kept = changes.filter((change) => change.state === "kept").length;
	const closing = open.length === 0;
	const version = draft.version + 1;

	const [stored] = await tx
		.update(proposals)
		.set({
			changes: changes as unknown as DraftRow["changes"],
			version,
			...(closing ? { status: kept > 0 ? "approved" : "rejected", decidedAt: sql`now()` } : {}),
		})
		.where(eq(proposals.id, draft.id))
		.returning();

	if (closing) {
		const session = await openSessionOf(tx, draft.ventureId);

		if (session !== undefined) {
			const thread = await lockThread(tx, session.id);

			await appendMessage(tx, thread, {
				author: systemAuthor,
				body: draftClosedLine({ kept, dropped: changes.length - kept }),
				runId: null,
			});

			await notifyThread(tx, thread);
		}
	}

	await notifyDraft(tx, { ventureId: draft.ventureId, version, ...hint });

	if (stored === undefined) throw new AppError("internal_error", "The draft disappeared");

	return stored;
}

function decide(change: DraftChange, state: "kept" | "dropped", actor: string, at: string) {
	return { ...change, state, decidedAt: at, decidedBy: actor } satisfies DraftChange;
}

function editedFieldsOf(before: Record<string, unknown>, after: Record<string, unknown>) {
	const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

	return [...keys].filter((key) => !samePayload(before[key], after[key]));
}

function rewritePointers(change: DraftChange, kept: Map<string, string>) {
	let payload = change.payload;

	for (const slot of referenceSlots(change.command, change.payload)) {
		if (!isPointer(slot.value)) continue;

		const entity = kept.get(slot.value.change);

		if (entity !== undefined) payload = withSlot(payload, slot.path, entity);
	}

	return payload === change.payload ? change : { ...change, payload };
}

function summaryOf(draft: DraftRow, changes: DraftChange[]) {
	return {
		draftId: draft.id,
		version: draft.version,
		open: changes.filter((change) => change.state === "open").length,
		status: draft.status,
	};
}

export function draftHandlers(apply: OperableHandlers) {
	return {
		"draft.add": async (context, payload) => {
			const venture = requireVenture(context);

			const { threadId, runId } = await operatorRun(context, venture);

			const draft = await lockDraft(context.tx, venture.id);

			const changes = draft === undefined ? [] : changesOf(draft);
			const open = changes.filter((change) => change.state === "open");

			if (open.length >= maxDraftChanges) {
				throw new AppError("rule_violated", `A draft holds at most ${maxDraftChanges} open changes`, {
					rule: "draft_full",
					limit: maxDraftChanges,
				});
			}

			const normalized = normalize(
				payload.command,
				withoutVenture(venture, payload.payload),
				changes,
				changes.length,
				await keptInClosedDrafts(context.tx, venture.id),
			);

			const now = new Date().toISOString();

			const change: DraftChange = {
				id: uuidv7(),
				command: payload.command,
				payload: normalized,
				base: await draftBaseOf(context.tx, venture.id, { command: payload.command, payload: normalized }),
				runId: context.runId,
				note: payload.note,
				state: "open",
				entityId: entityOf(venture, payload.command, normalized),
				editedBy: null,
				editedFields: [],
				createdAt: now,
				editedAt: null,
				decidedAt: null,
				decidedBy: null,
			};

			const next = [...changes, change];

			const label = await checkAndLabel(apply, context, venture, next, change);

			const stored =
				draft === undefined
					? await context.tx
							.insert(proposals)
							.values({
								id: uuidv7(),
								ventureId: venture.id,
								threadId,
								runId,
								createdBy: context.actor,
								title: "Draft",
								reason: "",
								changes: next as unknown as DraftRow["changes"],
								status: "drafting",
								version: 1,
							})
							.returning()
							.then(async ([inserted]) => {
								await notifyDraft(context.tx, {
									ventureId: venture.id,
									version: 1,
									changeId: change.id,
									action: "add",
								});

								return inserted;
							})
					: await store(context.tx, draft, next, { changeId: change.id, action: "add" });

			if (stored === undefined) throw new AppError("internal_error", "Draft insert returned nothing");

			return {
				ventureId: venture.id,
				result: {
					changeId: change.id,
					entityId: change.entityId,
					label,
					...summaryOf(stored, next),
				},
				events: [],
			};
		},

		"draft.revise": async (context, payload) => {
			const venture = requireVenture(context);

			const byOwner = context.actor === "owner";

			if (!byOwner) await operatorRun(context, venture);

			const draft = await requireDraft(context.tx, venture.id);

			const changes = changesOf(draft);
			const index = changes.findIndex((change) => change.id === payload.changeId);
			const current = changes[index];

			if (current === undefined || current.state !== "open") throw notOpen(payload.changeId);

			const normalized = normalize(
				current.command,
				withoutVenture(venture, payload.payload),
				changes,
				index,
				await keptInClosedDrafts(context.tx, venture.id),
			);

			const edited = editedFieldsOf(current.payload, normalized);

			if (edited.length === 0 && (payload.note === undefined || payload.note === current.note)) {
				const base = await draftBaseOf(context.tx, venture.id, current);

				if (samePayload(base, current.base)) {
					throw new AppError("rule_violated", "Nothing changed", { rule: "no_changes" });
				}
			}

			const now = new Date().toISOString();

			const revised: DraftChange = {
				...current,
				payload: normalized,
				note: payload.note ?? current.note,
				base: await draftBaseOf(context.tx, venture.id, { command: current.command, payload: normalized }),
				runId: byOwner ? current.runId : context.runId,
				editedBy: byOwner ? "owner" : current.editedBy,
				editedFields: byOwner ? [...new Set([...current.editedFields, ...edited])] : current.editedFields,
				editedAt: byOwner ? now : current.editedAt,
			};

			const next = changes.map((change) => (change.id === revised.id ? revised : change));

			const label = await checkAndLabel(apply, context, venture, next, revised);

			const stored = await store(context.tx, draft, next, { changeId: revised.id, action: "revise" });

			return {
				ventureId: venture.id,
				result: { changeId: revised.id, entityId: revised.entityId, label, ...summaryOf(stored, next) },
				events: [],
			};
		},

		"draft.remove": async (context, payload) => {
			const venture = requireVenture(context);

			await operatorRun(context, venture);

			const draft = await requireDraft(context.tx, venture.id);

			const changes = changesOf(draft);

			const target = changes.find((change) => change.id === payload.changeId);

			if (target === undefined || target.state !== "open") throw notOpen(payload.changeId);

			const removed = new Set(dropClosure(changes, [payload.changeId]).map((change) => change.id));
			const now = new Date().toISOString();

			const next = changes.map((change) =>
				removed.has(change.id) ? decide(change, "dropped", context.actor, now) : change,
			);

			const stored = await store(context.tx, draft, next, { changeId: payload.changeId, action: "remove" });

			return {
				ventureId: venture.id,
				result: { removed: [...removed], ...summaryOf(stored, next) },
				events: [],
			};
		},

		"draft.keep": async (context, payload) => {
			const venture = requireVenture(context);

			const draft = await requireDraft(context.tx, venture.id);

			const changes = changesOf(draft);

			for (const id of payload.changeIds) {
				if (!changes.some((change) => change.id === id && change.state === "open")) throw notOpen(id);
			}

			const closure = keepClosure(changes, payload.changeIds);
			const keeping = new Set(closure.map((change) => change.id));

			const stale = [];

			for (const change of closure) {
				const reason = await draftStaleness(context.tx, venture.id, change.base);

				if (reason !== null) stale.push({ change: change.id, stale: reason });
			}

			if (stale.length > 0) {
				throw new AppError("rule_violated", "Part of what you keep is stale", { rule: "proposal_stale", stale });
			}

			const others = changes.filter((change) => change.state === "open" && !keeping.has(change.id));
			const freshBefore = new Set<string>();

			for (const change of others) {
				if ((await draftStaleness(context.tx, venture.id, change.base)) === null) freshBefore.add(change.id);
			}

			const entities = new Map<string, string>();

			for (const change of changes) {
				if (change.state === "kept" && change.entityId !== null) entities.set(change.id, change.entityId);
			}

			const applied: PendingEvent[] = [];

			for (const change of closure) {
				if (change.entityId !== null && isCreating(change.command)) entities.set(change.id, change.entityId);

				try {
					const parsed = parseChange(change.command, {
						...resolvePointers(change, entities, new Set()),
						ventureId: venture.id,
					});

					const outcome = await handlerFor(apply, change.command)(
						{
							...context,
							reason: change.note,
							presetId: isCreating(change.command) ? (change.entityId ?? undefined) : undefined,
						},
						parsed,
					);

					if (!("events" in outcome)) {
						throw new AppError("internal_error", "An operable command returned a non-venture outcome");
					}

					applied.push(
						...outcome.events.map((event) => ({
							...event,
							payload: { ...event.payload, proposalId: draft.id, changeId: change.id, reason: change.note },
						})),
					);
				} catch (error) {
					const appError = asAppError(error);

					throw new AppError(appError.code, appError.message, { ...appError.details, change: change.id });
				}
			}

			const now = new Date().toISOString();

			const keptEntities = new Map(
				closure.flatMap((change) => (change.entityId === null ? [] : [[change.id, change.entityId] as const])),
			);

			const next: DraftChange[] = [];

			for (const change of changes) {
				if (keeping.has(change.id)) {
					next.push(decide(change, "kept", context.actor, now));

					continue;
				}

				if (change.state !== "open") {
					next.push(change);

					continue;
				}

				const rewritten = rewritePointers(change, keptEntities);

				if (!freshBefore.has(change.id) && rewritten === change) {
					next.push(change);

					continue;
				}

				const rebased = await draftBaseOf(context.tx, venture.id, rewritten);

				next.push({
					...rewritten,
					base: freshBefore.has(change.id)
						? rebased
						: { ...rewritten.base, rows: { ...rebased.rows, ...rewritten.base.rows } },
				});
			}

			const stored = await store(context.tx, draft, next, { changeId: null, action: "keep" });

			return {
				ventureId: venture.id,
				result: { kept: closure.map((change) => change.id), ...summaryOf(stored, next) },
				events: [
					{
						type: "draft.kept",
						subject: `proposal:${draft.id}`,
						payload: {
							proposalId: draft.id,
							kept: closure.length,
							changeIds: closure.map((change) => change.id),
						},
					},
					...applied,
				],
			};
		},

		"draft.drop": async (context, payload) => {
			const venture = requireVenture(context);

			const draft = await requireDraft(context.tx, venture.id);

			const changes = changesOf(draft);

			for (const id of payload.changeIds) {
				if (!changes.some((change) => change.id === id && change.state === "open")) throw notOpen(id);
			}

			const dropped = new Set(dropClosure(changes, payload.changeIds).map((change) => change.id));

			return dropChanges(context, venture, draft, changes, dropped, "drop");
		},

		"draft.discard": async (context) => {
			const venture = requireVenture(context);

			const draft = await requireDraft(context.tx, venture.id);

			const changes = changesOf(draft);

			const dropped = new Set(changes.filter((change) => change.state === "open").map((change) => change.id));

			return dropChanges(context, venture, draft, changes, dropped, "discard");
		},
	} satisfies Pick<
		Handlers,
		"draft.add" | "draft.revise" | "draft.remove" | "draft.keep" | "draft.drop" | "draft.discard"
	>;
}

async function dropChanges(
	context: HandlerContext,
	venture: VentureRow,
	draft: DraftRow,
	changes: DraftChange[],
	dropped: Set<string>,
	action: "drop" | "discard",
) {
	const now = new Date().toISOString();

	const next = changes.map((change) =>
		dropped.has(change.id) ? decide(change, "dropped", context.actor, now) : change,
	);

	const stored = await store(context.tx, draft, next, { changeId: null, action });

	return {
		ventureId: venture.id,
		result: { dropped: [...dropped], ...summaryOf(stored, next) },
		events: [
			{
				type: "draft.dropped",
				subject: `proposal:${draft.id}`,
				payload: { proposalId: draft.id, dropped: dropped.size, changeIds: [...dropped] },
			},
		],
	};
}
