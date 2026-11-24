import type { Run, RunEvent, ThreadDetail } from "@braise/core";
import { describe, expect, it } from "vitest";
import {
	actorName,
	applyDelta,
	buildTimeline,
	describeCall,
	liveTail,
	plainSnippet,
	proposalsOf,
	runSegments,
	summarizeTools,
} from "./thread-timeline.ts";

const at = "2026-11-24T12:00:00.000Z";

function event(seq: number, rest: Omit<RunEvent, "runId" | "seq" | "createdAt">) {
	return { runId: "r1", seq, createdAt: at, ...rest } as RunEvent;
}

const run = {
	id: "r1",
	threadId: "t1",
	messageId: "m1",
	retryOf: null,
	runtime: "claude-agent-sdk",
	model: "claude-opus-5-5",
	actor: "agent:claude",
	status: "succeeded",
	error: null,
	usage: null,
	createdAt: at,
	startedAt: at,
	finishedAt: at,
	cancelRequestedAt: null,
} satisfies Run;

const events = [
	event(0, { type: "run.started", payload: { model: "claude-opus-5-5" } }),
	event(1, { type: "tool.call", payload: { toolUseId: "a", name: "describe_schema", input: {} } }),
	event(2, { type: "tool.call", payload: { toolUseId: "b", name: "query", input: { sql: "SELECT * FROM goals" } } }),
	event(3, { type: "tool.result", payload: { toolUseId: "a", output: "goals(id uuid)", isError: false } }),
	event(4, {
		type: "tool.result",
		payload: { toolUseId: "b", output: '{"rowCount":3,"truncated":false}', isError: false },
	}),
	event(5, { type: "message", payload: { block: 0, text: "Two goals." } }),
	event(6, {
		type: "tool.call",
		payload: { toolUseId: "c", name: "set_work_item_status", input: { status: "doing" } },
	}),
	event(7, {
		type: "tool.result",
		payload: { toolUseId: "c", output: '{"title":"Bake sourdough"}', isError: false },
	}),
	event(8, { type: "message", payload: { block: 1, text: "Done." } }),
	event(9, { type: "run.finished", payload: { status: "succeeded" } }),
];

describe("runSegments", () => {
	it("folds consecutive tool calls into one group before the text they led to", () => {
		const segments = runSegments(events);

		expect(segments.map((segment) => (segment.kind === "tools" ? segment.calls.length : segment.text))).toEqual([
			2,
			"Two goals.",
			1,
			"Done.",
		]);
	});
});

describe("buildTimeline", () => {
	it("puts each run after the message it answers and hides its saved reply", () => {
		const detail = {
			thread: {
				id: "t1",
				ventureId: null,
				title: "T",
				lastSeq: 2,
				createdBy: "owner",
				createdAt: at,
				updatedAt: at,
				archivedAt: null,
			},
			venture: null,
			links: [],
			messages: [
				{ id: "m1", threadId: "t1", seq: 1, author: "owner", runId: null, body: "Hi", createdAt: at },
				{
					id: "m2",
					threadId: "t1",
					seq: 2,
					author: "agent:claude",
					runId: "r1",
					body: "Two goals.\n\nDone.",
					createdAt: at,
				},
			],
			runs: [{ ...run, events }],
		} satisfies ThreadDetail;

		const timeline = buildTimeline(detail);

		expect(timeline.map((entry) => entry.kind)).toEqual(["message", "run"]);

		expect(timeline[1]).toMatchObject({ kind: "run", latest: true });
	});
});

describe("applyDelta and liveTail", () => {
	const base = { threadId: "t1", runId: "r1" };

	it("appends contiguous text and marks gaps as broken", () => {
		let live = applyDelta(new Map(), { ...base, block: 0, offset: 0, text: "Hel" });

		live = applyDelta(live, { ...base, block: 0, offset: 3, text: "lo" });

		live = applyDelta(live, { ...base, block: 0, offset: 3, text: "lo" });

		expect(live.get("r1")).toEqual({ block: 0, text: "Hello", broken: false });

		live = applyDelta(live, { ...base, block: 0, offset: 9, text: "x" });

		expect(live.get("r1")?.broken).toBe(true);

		live = applyDelta(live, { ...base, block: 1, offset: 0, text: "Next" });

		expect(live.get("r1")).toEqual({ block: 1, text: "Next", broken: false });
	});

	it("shows the live block only while running and until it is saved", () => {
		const live = applyDelta(new Map(), { ...base, block: 1, offset: 0, text: "Stream" });
		const running = { ...run, status: "running" as const };

		expect(liveTail(live, running, [{ kind: "text", block: 0, text: "Saved" }])).toMatchObject({ text: "Stream" });

		expect(liveTail(live, running, [{ kind: "text", block: 1, text: "Stream done" }])).toBeNull();

		expect(liveTail(live, run, [])).toBeNull();
	});
});

describe("describeCall and summarizeTools", () => {
	const segments = runSegments(events);
	const [first, , second] = segments;

	it("names tool calls in the owner's language", () => {
		const statusCall = second?.kind === "tools" ? second.calls[0] : undefined;

		if (first?.kind !== "tools" || statusCall === undefined) throw new Error("Expected tool groups");

		expect(first.calls.map(describeCall)).toEqual([
			{ action: "Read the database schema", detail: null },
			{ action: "Queried goals", detail: "3 rows" },
		]);

		expect(describeCall(statusCall)).toEqual({
			action: "Set “Bake sourdough” to doing",
			detail: null,
		});

		expect(summarizeTools(first.calls)).toBe("2 steps");

		expect(summarizeTools([statusCall])).toBe("1 step · 1 change");
	});

	it("names actors", () => {
		expect([actorName("owner"), actorName("agent:claude"), actorName("agent:pi")]).toEqual(["You", "Claude", "pi"]);
	});
});

describe("plainSnippet", () => {
	it("strips Markdown syntax for one-line previews", () => {
		expect(plainSnippet("**Edge cases**\n\n- The *cutoff* at `9pm`\n1. See [the bet](/v/x)")).toBe(
			"Edge cases The cutoff at 9pm See the bet",
		);
	});
});

describe("proposals", () => {
	const proposeEvents = [
		event(0, {
			type: "tool.call",
			payload: {
				toolUseId: "p",
				name: "propose_changes",
				input: { title: "Loyalty", changes: [{ command: "bet.create" }, { command: "goal.create" }] },
			},
		}),
		event(1, {
			type: "tool.result",
			payload: { toolUseId: "p", output: JSON.stringify({ proposalId: "prop-1" }), isError: false },
		}),
		event(2, { type: "tool.call", payload: { toolUseId: "q", name: "propose_changes", input: { title: "Bad" } } }),
		event(3, { type: "tool.result", payload: { toolUseId: "q", output: "{}", isError: true } }),
	];

	it("names a proposal call and links only successful ones", () => {
		const [segment] = runSegments(proposeEvents);
		const calls = segment?.kind === "tools" ? segment.calls : [];

		expect(calls.map(describeCall)[0]).toEqual({ action: "Proposed “Loyalty”", detail: "2 changes" });

		expect(proposalsOf(runSegments(proposeEvents))).toEqual([{ id: "prop-1", title: "Loyalty", changeCount: 2 }]);
	});

	it("names braise system lines", () => {
		expect(actorName("braise")).toBe("braise");
	});
});
