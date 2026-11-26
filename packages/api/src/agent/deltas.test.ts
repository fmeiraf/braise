import type { RunDelta } from "@braise/core";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { makeDeltaPublisher, maxDeltaLength, mergeDeltas, splitDelta } from "./deltas.ts";

const base = { threadId: "t", runId: "r" };

function delta(block: number, offset: number, text: string) {
	return { ...base, block, offset, text } satisfies RunDelta;
}

describe("mergeDeltas", () => {
	it("joins contiguous chunks of the same block", () => {
		expect(mergeDeltas([delta(0, 0, "Hel"), delta(0, 3, "lo"), delta(1, 0, "Next")])).toEqual([
			delta(0, 0, "Hello"),
			delta(1, 0, "Next"),
		]);
	});

	it("keeps a gap as a separate chunk", () => {
		expect(mergeDeltas([delta(0, 0, "a"), delta(0, 5, "b")])).toHaveLength(2);
	});
});

describe("splitDelta", () => {
	it("splits long text under the NOTIFY size limit with correct offsets", () => {
		const pieces = splitDelta(delta(0, 10, "x".repeat(maxDeltaLength * 2 + 3)));

		expect(pieces.map((piece) => [piece.offset, piece.text.length])).toEqual([
			[10, maxDeltaLength],
			[10 + maxDeltaLength, maxDeltaLength],
			[10 + maxDeltaLength * 2, 3],
		]);
	});

	it("keeps every escaped piece under the 8000-byte NOTIFY limit", () => {
		const worst = splitDelta(delta(0, 0, "\u0001".repeat(maxDeltaLength * 3)));

		expect(Math.max(...worst.map((piece) => Buffer.byteLength(JSON.stringify(piece))))).toBeLessThan(8_000);
	});

	it("never cuts a surrogate pair in half", () => {
		const text = `${"x".repeat(maxDeltaLength - 1)}🍞tail`;
		const pieces = splitDelta(delta(0, 0, text));

		expect(pieces.map((piece) => piece.text).join("")).toBe(text);

		expect(pieces[1]?.text.startsWith("🍞")).toBe(true);
	});
});

describe("makeDeltaPublisher", () => {
	it("publishes everything pushed, in order, before it is drained", async () => {
		const published: RunDelta[] = [];

		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const publisher = yield* makeDeltaPublisher((piece) => Effect.sync(() => published.push(piece)));

					yield* publisher.push(delta(0, 0, "Hel"));

					yield* publisher.push(delta(0, 3, "lo"));

					yield* publisher.push(delta(1, 0, "!"));

					yield* publisher.drained;
				}),
			),
		);

		expect(mergeDeltas(published)).toEqual([delta(0, 0, "Hello"), delta(1, 0, "!")]);
	});

	it("still drains when a publish fails", async () => {
		const published: string[] = [];

		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const publisher = yield* makeDeltaPublisher((piece) =>
						piece.text === "boom" ? Effect.fail("refused") : Effect.sync(() => published.push(piece.text)),
					);

					yield* publisher.push(delta(0, 0, "boom"));

					yield* publisher.drained;
				}),
			),
		);

		expect(published).toEqual([]);
	});
});
