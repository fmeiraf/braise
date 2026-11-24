import { describe, expect, it } from "vitest";
import { abortedStream, failedRun, recordedToolRun } from "./normalize.fixture.ts";
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
