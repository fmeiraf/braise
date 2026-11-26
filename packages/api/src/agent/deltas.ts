import type { RunDelta } from "@braise/core";
import { type Cause, Effect, Fiber, Queue } from "effect";

export const maxDeltaLength = 1_000;

export function mergeDeltas(deltas: RunDelta[]) {
	const merged: RunDelta[] = [];

	for (const delta of deltas) {
		const last = merged.at(-1);

		if (last !== undefined && last.block === delta.block && last.offset + last.text.length === delta.offset) {
			merged[merged.length - 1] = { ...last, text: last.text + delta.text };
		} else {
			merged.push({ ...delta });
		}
	}

	return merged;
}

function isHighSurrogate(character: string | undefined) {
	return character !== undefined && /[\uD800-\uDBFF]/u.test(character);
}

export function splitDelta(delta: RunDelta) {
	const pieces: RunDelta[] = [];
	let start = 0;

	while (start < delta.text.length) {
		let end = Math.min(start + maxDeltaLength, delta.text.length);

		if (end < delta.text.length && isHighSurrogate(delta.text[end - 1])) end -= 1;

		pieces.push({ ...delta, offset: delta.offset + start, text: delta.text.slice(start, end) });

		start = end;
	}

	return pieces;
}

export function makeDeltaPublisher<E>(publish: (delta: RunDelta) => Effect.Effect<void, E>) {
	return Effect.gen(function* () {
		const queue = yield* Queue.unbounded<RunDelta, Cause.Done>();

		const publishBatch = (batch: RunDelta[]) =>
			Effect.forEach(mergeDeltas(batch).flatMap(splitDelta), publish, { discard: true }).pipe(
				Effect.catch((error) => Effect.sync(() => console.error("agent: publishing a live delta failed", error))),
			);

		const consumer = yield* Queue.takeAll(queue).pipe(
			Effect.flatMap(publishBatch),
			Effect.forever,
			Effect.forkScoped,
		);

		return {
			push: (delta: RunDelta) => Queue.offer(queue, delta),
			drained: Queue.end(queue).pipe(Effect.andThen(Fiber.await(consumer)), Effect.asVoid),
		};
	});
}
