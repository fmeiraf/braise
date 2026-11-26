import { describe, expect, it } from "vitest";
import {
	abortedStream,
	failedRun,
	recordedRateLimit,
	recordedToolRun,
	rejectedRateLimit,
} from "./normalize.fixture.ts";
import { createTranslator } from "./normalize.ts";

function translate(messages: typeof recordedToolRun) {
	const translator = createTranslator();

	return messages.flatMap((message) => translator(message));
}

describe("createTranslator", () => {
	it("maps a recorded run with a tool call to run signals", () => {
		const signals = translate(recordedToolRun);

		expect(signals.map((signal) => signal.type)).toEqual([
			"tool.call",
			"tool.result",
			"delta",
			"delta",
			"message",
			"finished",
		]);

		expect(signals[0]).toEqual({
			type: "tool.call",
			toolUseId: "toolu_017Lj1prSfL21337gHTUoJ6W",
			name: "count_ventures",
			input: {},
		});

		expect(signals[1]).toEqual({
			type: "tool.result",
			toolUseId: "toolu_017Lj1prSfL21337gHTUoJ6W",
			output: "2 ventures",
			isError: false,
		});

		expect(signals.slice(2, 4)).toEqual([
			{ type: "delta", block: 0, offset: 0, text: "Braise has 2 vent" },
			{ type: "delta", block: 0, offset: 17, text: "ures." },
		]);

		expect(signals[4]).toEqual({ type: "message", block: 0, text: "Braise has 2 ventures." });

		expect(signals[5]).toMatchObject({
			type: "finished",
			status: "succeeded",
			error: null,
			usage: { outputTokens: 87, turns: 2 },
		});
	});

	it("reports a failed result with its errors", () => {
		expect(translate(failedRun)).toEqual([
			{
				type: "finished",
				status: "failed",
				error: "Not logged in. Run claude and /login.",
				usage: {
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheCreationTokens: 0,
					costUsd: 0,
					durationMs: 900,
					turns: 0,
				},
			},
		]);
	});

	it("streams deltas of an unfinished block without a message", () => {
		expect(translate(abortedStream)).toEqual([{ type: "delta", block: 0, offset: 0, text: "Partial ans" }]);
	});
});

describe("blank text blocks", () => {
	it("still advance the block index so later live text streams", () => {
		const translator = createTranslator();

		const assistant = (text: string) =>
			({
				type: "assistant",
				parent_tool_use_id: null,
				message: { content: [{ type: "text", text }] },
			}) as unknown as Parameters<typeof translator>[0];

		const start = {
			type: "stream_event",
			parent_tool_use_id: null,
			event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
		} as unknown as Parameters<typeof translator>[0];

		const delta = {
			type: "stream_event",
			parent_tool_use_id: null,
			event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } },
		} as unknown as Parameters<typeof translator>[0];

		translator(start);

		expect(translator(assistant("  "))).toEqual([]);

		translator(start);

		expect(translator(delta)).toEqual([{ type: "delta", block: 1, offset: 0, text: "Hi" }]);
	});
});

describe("rate limit events", () => {
	it("map a recorded subscription event to one reading per window", () => {
		expect(translate(recordedRateLimit)).toEqual([
			{
				type: "limit",
				reading: {
					window: "five_hour",
					status: "allowed",
					utilization: 0.24,
					resetsAt: new Date(1795729200 * 1000),
				},
			},
			{
				type: "limit",
				reading: {
					window: "seven_day",
					status: "allowed",
					utilization: 0.28,
					resetsAt: new Date(1795856400 * 1000),
				},
			},
		]);
	});

	it("map a rejection without window details to a rejected reading", () => {
		expect(translate(rejectedRateLimit)).toEqual([
			{
				type: "limit",
				reading: { window: "five_hour", status: "rejected", utilization: 1, resetsAt: new Date(1795729200 * 1000) },
			},
		]);
	});
});
