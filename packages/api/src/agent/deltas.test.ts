import type { RunDelta } from "@braise/core";
import { describe, expect, it } from "vitest";
import { createDeltaPublisher, maxDeltaLength, mergeDeltas, splitDelta } from "./deltas.ts";

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

describe("createDeltaPublisher", () => {
	it("publishes everything pushed, merged, in order", async () => {
		const published: RunDelta[] = [];

		const publisher = createDeltaPublisher(async (piece) => {
			published.push(piece);
		});

		publisher.push(delta(0, 0, "Hel"));

		publisher.push(delta(0, 3, "lo"));

		publisher.push(delta(1, 0, "!"));

		await publisher.drained();

		expect(published.map((piece) => `${piece.block}:${piece.text}`).join("|")).toBe("0:Hel|0:lo|1:!");
	});
});
