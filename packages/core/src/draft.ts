import type { draftChangeStates, OperableCommand } from "./commands.ts";

export type DraftChangeState = (typeof draftChangeStates)[number];

/** A pointer from an id field to an earlier open create in the same draft. */
export interface Pointer {
	change: string;
}

/** What a draft change was checked against: the strategy version and the `updated_at` of each real row it touches. */
export interface DraftBase {
	strategyVersion?: number;
	rows: Record<string, string>;
}

export interface DraftChange {
	id: string;
	command: OperableCommand;
	payload: Record<string, unknown>;
	base: DraftBase;
	runId: string | null;
	note: string;
	state: DraftChangeState;
	entityId: string | null;
	editedBy: "owner" | null;
	editedFields: string[];
	createdAt: string;
	editedAt: string | null;
	decidedAt: string | null;
	decidedBy: string | null;
}

export type DraftView = "overview" | "strategy" | "work";

/** How the draft changes one item, keyed by the item's id (`strategy` for the strategy kernel). */
export interface DraftMark {
	changeIds: string[];
	created: boolean;
	fields: Record<string, unknown>;
	moved: { from: unknown } | null;
	status: { from: unknown; to: unknown } | null;
	archived: boolean;
}

export interface DraftChangeView extends DraftChange {
	label: string;
	view: DraftView;
	dependsOn: string[];
	stale: string | null;
	error: string | null;
}

export interface DraftSummary {
	id: string;
	ventureId: string;
	threadId: string;
	version: number;
	createdAt: string;
	updatedAt: string;
	kept: number;
	dropped: number;
	changes: DraftChangeView[];
	marks: Record<string, DraftMark>;
}

export interface DraftHint {
	ventureId: string;
	version: number;
	changeId: string | null;
	action: "add" | "revise" | "remove" | "keep" | "drop" | "discard";
}

export const strategyMarkKey = "strategy";

export function isPointer(value: unknown): value is Pointer {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.keys(value).length === 1 &&
		typeof (value as { change?: unknown }).change === "string"
	);
}

/** The field naming the row a command changes; that row may not be a create still in the draft. */
export const draftSubjectFields = {
	"objective.update": "objectiveId",
	"objective.check": "objectiveId",
	"objective.close": "objectiveId",
	"objective.archive": "objectiveId",
	"assumption.update": "assumptionId",
	"assumption.archive": "assumptionId",
	"bet.update": "betId",
	"bet.close": "betId",
	"bet.archive": "betId",
	"work.update": "workItemId",
	"work.set_status": "workItemId",
	"work.move": "workItemId",
	"work.archive": "workItemId",
} as const satisfies Partial<Record<OperableCommand, string>>;

export const creatingCommands = [
	"objective.create",
	"assumption.create",
	"bet.create",
	"reading.record",
	"work.create",
] as const satisfies readonly OperableCommand[];

export type CreatingCommand = (typeof creatingCommands)[number];

export function isCreating(command: string): command is CreatingCommand {
	return (creatingCommands as readonly string[]).includes(command);
}

export function subjectOfChange(change: { command: OperableCommand; payload: Record<string, unknown> }) {
	const field = (draftSubjectFields as Partial<Record<OperableCommand, string>>)[change.command];

	return field === undefined ? null : { field, value: change.payload[field] };
}

/** An id field that may hold a pointer, where it sits in the payload and which create it may point at. */
export interface ReferenceSlot {
	path: string[];
	target: CreatingCommand;
	value: unknown;
}

function typedTarget(type: unknown) {
	if (type === "bet") return "bet.create" as const;

	if (type === "objective") return "objective.create" as const;

	return null;
}

function nested(payload: Record<string, unknown>, field: string) {
	const value = payload[field];

	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function referenceSlots(command: OperableCommand, payload: Record<string, unknown>) {
	const slots: ReferenceSlot[] = [];

	const direct = (field: string, target: CreatingCommand) => {
		if (payload[field] !== undefined && payload[field] !== null) {
			slots.push({ path: [field], target, value: payload[field] });
		}
	};

	const typed = (field: string) => {
		const inner = nested(payload, field);
		const target = typedTarget(inner?.type);

		if (inner !== null && target !== null && inner.id !== undefined) {
			slots.push({ path: [field, "id"], target, value: inner.id });
		}
	};

	switch (command) {
		case "assumption.create":
		case "assumption.update":
			direct("objectiveId", "objective.create");

			break;
		case "bet.create":
			direct("assumptionId", "assumption.create");

			break;
		case "work.create":
			direct("parentId", "work.create");

			typed("home");

			break;
		case "work.move":
			typed("home");

			break;
		case "reading.record":
			typed("subject");

			break;
		default:
			break;
	}

	return slots;
}

export function withSlot(payload: Record<string, unknown>, path: string[], value: unknown) {
	const [head, ...rest] = path;

	if (head === undefined) return payload;

	const inner: unknown = rest.length === 0 ? value : withSlot(nested(payload, head) ?? {}, rest, value);
	const next: Record<string, unknown> = { ...payload, [head]: inner };

	return next;
}

/** The open changes this change points at. */
export function pointersOf(change: { command: OperableCommand; payload: Record<string, unknown> }) {
	return referenceSlots(change.command, change.payload).flatMap((slot) =>
		isPointer(slot.value) ? [slot.value.change] : [],
	);
}

type Linked = { id: string; state: DraftChangeState; command: OperableCommand; payload: Record<string, unknown> };

/** The changes to apply when keeping `ids`: them and every open change they point at, in draft order. */
export function keepClosure<Change extends Linked>(changes: Change[], ids: readonly string[]) {
	const open = new Map(changes.filter((change) => change.state === "open").map((change) => [change.id, change]));
	const wanted = new Set<string>();
	const queue = ids.filter((id) => open.has(id));

	while (queue.length > 0) {
		const id = queue.pop();

		if (id === undefined || wanted.has(id)) continue;

		wanted.add(id);

		const change = open.get(id);

		if (change !== undefined) queue.push(...pointersOf(change).filter((target) => open.has(target)));
	}

	return [...open.values()].filter((change) => wanted.has(change.id));
}

/** The changes to drop with `ids`: them and every open change that points at them, in draft order. */
export function dropClosure<Change extends Linked>(changes: Change[], ids: readonly string[]) {
	const open = changes.filter((change) => change.state === "open");
	const wanted = new Set(ids.filter((id) => open.some((change) => change.id === id)));

	let grew = true;

	while (grew) {
		grew = false;

		for (const change of open) {
			if (!wanted.has(change.id) && pointersOf(change).some((target) => wanted.has(target))) {
				wanted.add(change.id);

				grew = true;
			}
		}
	}

	return open.filter((change) => wanted.has(change.id));
}

export function draftViewOf(command: OperableCommand) {
	if (command === "venture.update") return "overview" satisfies DraftView;

	return command.startsWith("work.") ? ("work" satisfies DraftView) : ("strategy" satisfies DraftView);
}

export function draftClosedLine(summary: { kept: number; dropped: number }) {
	const count = (total: number) => `${total} ${total === 1 ? "change" : "changes"}`;

	if (summary.kept === 0) return `Draft dropped · ${count(summary.dropped)}`;

	return summary.dropped === 0
		? `Draft kept · ${count(summary.kept)}`
		: `Draft closed · kept ${count(summary.kept)}, dropped ${count(summary.dropped)}`;
}
