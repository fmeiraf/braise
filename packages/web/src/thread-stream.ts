import type { RunDelta, ThreadHint } from "@braise/core";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { applyThreadHint } from "./live.ts";
import { applyDelta, type LiveRuns } from "./thread-timeline.ts";

const reopenDelayMs = 2_000;

function openStream(
	client: QueryClient,
	threadId: string,
	onDelta: (delta: RunDelta) => void,
	onDown: (down: boolean) => void,
) {
	let source: EventSource | null = null;
	let reopenTimer: ReturnType<typeof setTimeout> | null = null;
	let dropped = false;

	const open = () => {
		const next = new EventSource(`/api/threads/${encodeURIComponent(threadId)}/stream`);

		source = next;

		next.addEventListener("ready", () => {
			onDown(false);

			if (dropped) applyThreadHint(client, { threadId, ventureId: null });

			dropped = false;
		});

		next.addEventListener("hint", (event) => {
			applyThreadHint(client, JSON.parse(event.data as string) as ThreadHint);
		});

		next.addEventListener("delta", (event) => {
			onDelta(JSON.parse(event.data as string) as RunDelta);
		});

		next.addEventListener("reset", () => applyThreadHint(client, { threadId, ventureId: null }));

		next.addEventListener("error", () => {
			dropped = true;

			onDown(true);

			if (next.readyState === EventSource.CLOSED && reopenTimer === null) {
				reopenTimer = setTimeout(() => {
					reopenTimer = null;

					open();
				}, reopenDelayMs);
			}
		});
	};

	open();

	return () => {
		if (reopenTimer !== null) clearTimeout(reopenTimer);

		source?.close();
	};
}

export function useThreadStream(threadId: string) {
	const client = useQueryClient();
	const [live, setLive] = useState<LiveRuns>(new Map());
	const [down, setDown] = useState(false);

	useEffect(() => {
		setLive(new Map());

		return openStream(client, threadId, (delta) => setLive((current) => applyDelta(current, delta)), setDown);
	}, [client, threadId]);

	return { live, down };
}
