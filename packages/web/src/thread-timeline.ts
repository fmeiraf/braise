import type { Run, RunDelta, RunEvent, ThreadDetail, ThreadMessage } from "@braise/core";

export interface ToolCall {
	id: string;
	name: string;
	input: unknown;
	result: { output: string; isError: boolean } | null;
}

export type Segment = { kind: "tools"; calls: ToolCall[] } | { kind: "text"; block: number; text: string };

export type TimelineEntry =
	| { kind: "message"; message: ThreadMessage }
	| { kind: "run"; run: Run; segments: Segment[]; latest: boolean };

export const writeTools = new Set([
	"create_work_item",
	"update_work_item",
	"set_work_item_status",
	"move_work_item",
	"link_thread",
	"unlink_thread",
]);

export function runSegments(events: RunEvent[]) {
	const segments: Segment[] = [];
	const calls = new Map<string, ToolCall>();

	for (const event of events) {
		if (event.type === "tool.call") {
			const call = {
				id: event.payload.toolUseId,
				name: event.payload.name,
				input: event.payload.input,
				result: null,
			};

			const last = segments.at(-1);

			calls.set(call.id, call);

			if (last?.kind === "tools") last.calls.push(call);
			else segments.push({ kind: "tools", calls: [call] });
		}

		if (event.type === "tool.result") {
			const call = calls.get(event.payload.toolUseId);

			if (call !== undefined) call.result = { output: event.payload.output, isError: event.payload.isError };
		}

		if (event.type === "message") {
			segments.push({ kind: "text", block: event.payload.block, text: event.payload.text });
		}
	}

	return segments;
}

export function buildTimeline(detail: ThreadDetail) {
	const runsByMessage = new Map<string, Run[]>();
	const runIds = new Set(detail.runs.map((run) => run.id));
	const latestRun = detail.runs.at(-1)?.id;
	const entries: TimelineEntry[] = [];

	for (const run of detail.runs) runsByMessage.set(run.messageId, [...(runsByMessage.get(run.messageId) ?? []), run]);

	for (const message of detail.messages) {
		if (message.runId !== null && runIds.has(message.runId)) continue;

		entries.push({ kind: "message", message });

		for (const run of runsByMessage.get(message.id) ?? []) {
			const full = detail.runs.find((candidate) => candidate.id === run.id);
			const segments = full === undefined ? [] : runSegments(full.events);
			const reply = detail.messages.find((candidate) => candidate.runId === run.id);

			entries.push({
				kind: "run",
				run,
				segments:
					segments.length === 0 && reply !== undefined ? [{ kind: "text", block: 0, text: reply.body }] : segments,
				latest: run.id === latestRun,
			});
		}
	}

	return entries;
}

export interface LiveBlock {
	block: number;
	text: string;
	broken: boolean;
}

export type LiveRuns = ReadonlyMap<string, LiveBlock>;

export function applyDelta(live: LiveRuns, delta: RunDelta) {
	const current = live.get(delta.runId);
	const next = new Map(live);

	if (current === undefined || current.block < delta.block) {
		next.set(delta.runId, {
			block: delta.block,
			text: delta.offset === 0 ? delta.text : "",
			broken: delta.offset !== 0,
		});

		return next;
	}

	if (current.block > delta.block || current.broken) return live;

	if (delta.offset === current.text.length) {
		next.set(delta.runId, { ...current, text: current.text + delta.text });

		return next;
	}

	if (delta.offset > current.text.length) {
		next.set(delta.runId, { ...current, broken: true });

		return next;
	}

	return live;
}

export function liveTail(live: LiveRuns, run: Run, segments: Segment[]) {
	if (run.status !== "running") return null;

	const block = live.get(run.id);

	if (block === undefined) return null;

	const saved = segments.some((segment) => segment.kind === "text" && segment.block >= block.block);

	return saved ? null : block;
}

function parsed(output: string) {
	try {
		return JSON.parse(output) as unknown;
	} catch {
		return null;
	}
}

function field(value: unknown, key: string) {
	if (typeof value !== "object" || value === null || !(key in value)) return undefined;

	return (value as Record<string, unknown>)[key];
}

function quoted(value: unknown) {
	return typeof value === "string" ? `“${value}”` : "a work item";
}

const statusNames: Record<string, string> = { todo: "to do", doing: "doing", done: "done" };

function tableOf(sql: unknown) {
	if (typeof sql !== "string") return null;

	const match = /\bfrom\s+"?([a-z_][a-z0-9_]*)"?/iu.exec(sql);

	return match?.[1] ?? null;
}

export function describeCall(call: ToolCall) {
	const output = call.result === null ? null : parsed(call.result.output);
	const title = field(output, "title") ?? field(call.input, "title");

	switch (call.name) {
		case "describe_schema":
			return { action: "Read the database schema", detail: null };
		case "query": {
			const table = tableOf(field(call.input, "sql"));
			const rows = field(output, "rowCount");
			const truncated = field(output, "truncated") === true;

			return {
				action: table === null ? "Ran a query" : `Queried ${table}`,
				detail: typeof rows === "number" ? `${rows}${truncated ? "+" : ""} ${rows === 1 ? "row" : "rows"}` : null,
			};
		}
		case "create_work_item":
			return { action: `Created ${quoted(title)}`, detail: null };
		case "update_work_item":
			return { action: `Updated ${quoted(title)}`, detail: null };
		case "set_work_item_status": {
			const status = field(call.input, "status");

			return {
				action: `Set ${quoted(title)} to ${typeof status === "string" ? (statusNames[status] ?? status) : "a new status"}`,
				detail: null,
			};
		}
		case "move_work_item":
			return { action: `Moved ${quoted(title)}`, detail: null };
		case "link_thread":
			return { action: "Linked this thread", detail: null };
		case "unlink_thread":
			return { action: "Removed a link from this thread", detail: null };
		default:
			return { action: `Used ${call.name}`, detail: null };
	}
}

export function summarizeTools(calls: ToolCall[]) {
	const changes = calls.filter((call) => writeTools.has(call.name) && call.result?.isError === false).length;
	const failures = calls.filter((call) => call.result?.isError === true).length;
	const parts = [`${calls.length} ${calls.length === 1 ? "step" : "steps"}`];

	if (changes > 0) parts.push(`${changes} ${changes === 1 ? "change" : "changes"}`);

	if (failures > 0) parts.push(`${failures} failed`);

	return parts.join(" · ");
}

export function actorName(actor: string) {
	if (actor === "owner") return "You";

	if (actor === "agent:claude") return "Claude";

	return actor.startsWith("agent:") ? actor.slice("agent:".length) : actor;
}

export function plainSnippet(markdown: string) {
	return markdown
		.replaceAll(/```[\s\S]*?```/gu, " ")
		.replaceAll(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
		.replaceAll(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/gmu, "")
		.replaceAll(/[*_`~|]/gu, "")
		.replaceAll(/\s+/gu, " ")
		.trim();
}
