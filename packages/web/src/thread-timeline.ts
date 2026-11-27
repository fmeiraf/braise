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
	"write",
	"edit",
	"push_branch",
	"open_pull_request",
	"update_pull_request",
]);

export const codeTools = new Set(["read", "write", "edit", "bash"]);

const maxCommandShown = 80;

function firstLine(value: unknown) {
	if (typeof value !== "string") return null;

	const line = value.trim().split("\n", 1)[0] ?? "";

	return line.length > maxCommandShown ? `${line.slice(0, maxCommandShown - 1)}…` : line;
}

function exitOf(call: ToolCall) {
	if (call.result === null) return null;

	const code = /Exit code (\d+)\.$/u.exec(call.result.output.trimEnd())?.[1];

	if (code !== undefined) return code === "0" ? null : `exit ${code}`;

	return /Timed out after/u.test(call.result.output) ? "timed out" : null;
}

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

export function parseJson(text: string) {
	try {
		return { ok: true, value: JSON.parse(text) as unknown } as const;
	} catch (error) {
		return { ok: false, error } as const;
	}
}

function parsed(output: string) {
	const result = parseJson(output);

	return result.ok ? result.value : null;
}

function field(value: unknown, key: string) {
	if (typeof value !== "object" || value === null || !(key in value)) return undefined;

	return (value as Record<string, unknown>)[key];
}

function str(value: unknown) {
	return typeof value === "string" ? value : null;
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

export function accessRequestOf(call: ToolCall) {
	const requested = call.result === null ? undefined : field(parsed(call.result.output), "accessRequested");
	const id = field(requested, "accessRequestId");
	const label = field(requested, "label");

	return typeof id === "string" && typeof label === "string" ? { id, label } : null;
}

export function describeCall(call: ToolCall) {
	const output = call.result === null ? null : parsed(call.result.output);
	const title = field(output, "title") ?? field(call.input, "title");
	const access = accessRequestOf(call);

	if (access !== null) return { action: `Access requested · ${access.label}`, detail: null };

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
		case "propose_changes": {
			const changes = field(call.input, "changes");

			return {
				action: `Proposed ${typeof field(call.input, "title") === "string" ? quoted(field(call.input, "title")) : "changes"}`,
				detail: Array.isArray(changes) ? `${changes.length} ${changes.length === 1 ? "change" : "changes"}` : null,
			};
		}
		case "start_thread": {
			const agent = field(call.input, "agentProfileId");

			return {
				action: `Started ${quoted(title)}`,
				detail: typeof agent === "string" ? `with ${actorName(`agent:${agent}`)}` : null,
			};
		}
		case "message_thread":
			return { action: "Messaged a thread", detail: null };
		case "retry_thread":
			return { action: "Retried a thread", detail: null };
		case "add_thread_to_space":
			return { action: "Added a thread to the space", detail: null };
		case "remove_thread_from_space":
			return { action: "Removed a thread from the space", detail: null };
		case "ask_owner":
			return { action: "Asked you", detail: null };
		case "checkout_repo":
			return {
				action: `Checked out ${str(field(call.input, "repo")) ?? "a repo"}`,
				detail: str(field(output, "branch")),
			};
		case "read":
			return { action: "Read", detail: firstLine(field(call.input, "file_path")) };
		case "write":
			return {
				action: field(output, "created") === true ? "Created" : "Wrote",
				detail: firstLine(field(call.input, "file_path")),
			};
		case "edit":
			return { action: "Edited", detail: firstLine(field(call.input, "file_path")) };
		case "bash":
			return { action: "Ran", detail: firstLine(field(call.input, "command")), exit: exitOf(call) };
		case "push_branch":
			return {
				action: `Pushed to ${str(field(call.input, "repo")) ?? "GitHub"}`,
				detail: str(field(output, "branch")),
			};
		case "open_pull_request": {
			const number = field(output, "number");

			return {
				action: typeof number === "number" ? `Opened pull request #${number}` : "Opened a pull request",
				detail: str(field(call.input, "title")),
			};
		}
		case "update_pull_request":
			return { action: "Edited the pull request", detail: str(field(call.input, "repo")) };
		case "pull_request_status":
			return { action: "Read the pull request's status", detail: str(field(output, "state")) };
		default:
			return { action: `Used ${call.name}`, detail: null };
	}
}

export function summarizeTools(calls: ToolCall[]) {
	const changes = calls.filter(
		(call) => writeTools.has(call.name) && call.result?.isError === false && accessRequestOf(call) === null,
	).length;

	const failures = calls.filter((call) => call.result?.isError === true).length;
	const parts = [`${calls.length} ${calls.length === 1 ? "step" : "steps"}`];

	if (changes > 0) parts.push(`${changes} ${changes === 1 ? "change" : "changes"}`);

	if (failures > 0) parts.push(`${failures} failed`);

	return parts.join(" · ");
}

export function proposalsOf(segments: Segment[]) {
	return segments.flatMap((segment) =>
		segment.kind === "tools"
			? segment.calls.flatMap((call) => {
					if (call.name !== "propose_changes" || call.result === null || call.result.isError) return [];

					if (accessRequestOf(call) !== null) return [];

					const id = field(parsed(call.result.output), "proposalId");
					const title = field(call.input, "title");
					const changes = field(call.input, "changes");

					return typeof id === "string"
						? [
								{
									id,
									title: typeof title === "string" ? title : "Proposal",
									changeCount: Array.isArray(changes) ? changes.length : 0,
								},
							]
						: [];
				})
			: [],
	);
}

export function actorName(actor: string) {
	if (actor === "owner") return "You";

	if (actor === "braise") return "braise";

	if (actor === "agent:claude") return "Claude";

	if (actor === "agent:gpt") return "GPT";

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
