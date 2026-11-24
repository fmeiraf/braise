import type { RunDelta } from "@braise/core";

export const maxDeltaLength = 1_500;

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

export function createDeltaPublisher(publish: (delta: RunDelta) => Promise<void>) {
	let buffer: RunDelta[] = [];
	let flushing: Promise<void> | null = null;

	const flush = async () => {
		while (buffer.length > 0) {
			const batch = buffer;

			buffer = [];

			for (const delta of mergeDeltas(batch)) {
				for (const piece of splitDelta(delta)) await publish(piece);
			}
		}

		flushing = null;
	};

	return {
		push(delta: RunDelta) {
			buffer.push(delta);

			flushing ??= flush().catch((error: unknown) => {
				flushing = null;

				console.error("agent: publishing a live delta failed", error);
			});
		},
		drained() {
			return flushing ?? Promise.resolve();
		},
	};
}
