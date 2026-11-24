import type { Cockpit, StreamHint } from "@braise/core";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "./api.ts";

export const keys = {
	ventures: ["ventures"] as const,
	recent: ["recent-events"] as const,
	venture: (slug: string) => ["venture", slug] as const,
	cockpit: (slug: string) => ["venture", slug, "cockpit"] as const,
	versions: (slug: string) => ["venture", slug, "versions"] as const,
	events: (slug: string) => ["venture", slug, "events"] as const,
};

export const queries = {
	ventures: () => queryOptions({ queryKey: keys.ventures, queryFn: api.ventures }),
	recent: () => queryOptions({ queryKey: keys.recent, queryFn: () => api.recentEvents() }),
	cockpit: (slug: string) => queryOptions({ queryKey: keys.cockpit(slug), queryFn: () => api.cockpit(slug) }),
	versions: (slug: string) => queryOptions({ queryKey: keys.versions(slug), queryFn: () => api.versions(slug) }),
};

const knownSeq = new Map<string, number>();
const slugById = new Map<string, string>();
const freshListeners = new Set<(ventureId: string) => void>();

const localListeners = new Set<() => void>();

export function onLocalChange(listener: () => void) {
	localListeners.add(listener);

	return () => {
		localListeners.delete(listener);
	};
}

export function rememberVenture(ventureId: string, slug: string, seq: number) {
	slugById.set(ventureId, slug);

	knownSeq.set(ventureId, Math.max(seq, knownSeq.get(ventureId) ?? 0));
}

export function onFreshHint(listener: (ventureId: string) => void) {
	freshListeners.add(listener);

	return () => {
		freshListeners.delete(listener);
	};
}

export function applyHint(client: QueryClient, hint: StreamHint) {
	if ((knownSeq.get(hint.ventureId) ?? 0) >= hint.seq) return;

	knownSeq.set(hint.ventureId, hint.seq);

	const slug = slugById.get(hint.ventureId);

	if (slug !== undefined) void client.invalidateQueries({ queryKey: keys.venture(slug) });

	void client.invalidateQueries({ queryKey: keys.ventures });

	void client.invalidateQueries({ queryKey: keys.recent });

	for (const listener of freshListeners) listener(hint.ventureId);
}

export function updateCockpit(client: QueryClient, slug: string, seq: number, update: (cockpit: Cockpit) => Cockpit) {
	for (const listener of localListeners) listener();

	client.setQueryData<Cockpit>(keys.cockpit(slug), (current) => {
		if (current === undefined) return current;

		rememberVenture(current.venture.id, slug, seq);

		return update({ ...current, venture: { ...current.venture, lastSeq: seq } });
	});

	void client.invalidateQueries({ queryKey: keys.ventures });

	void client.invalidateQueries({ queryKey: keys.recent });

	void client.invalidateQueries({ queryKey: keys.events(slug) });

	void client.invalidateQueries({ queryKey: keys.versions(slug) });
}

export type StreamState = "connecting" | "live" | "down";

const silenceLimitMs = 35_000;

const reopenDelayMs = 2_000;

export function useHintStream(client: QueryClient) {
	const [state, setState] = useState<StreamState>("connecting");

	useEffect(() => {
		let source: EventSource | null = null;
		let lastHeard = Date.now();
		let dropped = false;
		let reopenTimer: ReturnType<typeof setTimeout> | null = null;

		const markDown = () => {
			dropped = true;

			setState("down");
		};

		const open = () => {
			source?.close();

			lastHeard = Date.now();

			const next = new EventSource("/api/stream");

			source = next;

			const heard = () => {
				lastHeard = Date.now();
			};

			next.addEventListener("ready", () => {
				heard();

				setState("live");

				if (dropped) void client.invalidateQueries();

				dropped = false;
			});

			next.addEventListener("ping", heard);

			next.addEventListener("hint", (event) => {
				heard();

				applyHint(client, JSON.parse(event.data as string) as StreamHint);
			});

			next.addEventListener("reset", () => {
				heard();

				void client.invalidateQueries();
			});

			next.addEventListener("error", () => {
				markDown();

				if (next.readyState === EventSource.CLOSED && reopenTimer === null) {
					reopenTimer = setTimeout(() => {
						reopenTimer = null;

						open();
					}, reopenDelayMs);
				}
			});
		};

		open();

		const watchdog = setInterval(() => {
			if (Date.now() - lastHeard <= silenceLimitMs) return;

			markDown();

			open();
		}, 5_000);

		return () => {
			clearInterval(watchdog);

			if (reopenTimer !== null) clearTimeout(reopenTimer);

			source?.close();
		};
	}, [client]);

	return state;
}
