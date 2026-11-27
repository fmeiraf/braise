import type { Cockpit, DraftHint, HoldingWork, StreamHint, ThreadHint, VentureWork, WorkItem } from "@braise/core";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { createContext, useEffect, useState } from "react";
import { api } from "./api.ts";

export const keys = {
	ventures: ["ventures"] as const,
	recent: ["recent-events"] as const,
	holdingWork: ["work"] as const,
	venture: (slug: string) => ["venture", slug] as const,
	cockpit: (slug: string) => ["venture", slug, "cockpit"] as const,
	board: (slug: string) => ["venture", slug, "board"] as const,
	draft: (slug: string) => ["venture", slug, "draft"] as const,
	operator: (slug: string) => ["venture", slug, "operator"] as const,
	versions: (slug: string) => ["venture", slug, "versions"] as const,
	events: (slug: string) => ["venture", slug, "events"] as const,
	work: (slug: string) => ["venture", slug, "work"] as const,
	threads: ["threads"] as const,
	threadList: (scope: { ventureId?: string; subject?: string; space?: string }) =>
		["threads", "list", scope.ventureId ?? "holding", scope.subject ?? "all", scope.space ?? "any"] as const,
	spaces: ["spaces"] as const,
	spaceList: (ventureId: string | undefined) => ["spaces", "list", ventureId ?? "holding"] as const,
	space: (id: string) => ["spaces", "detail", id] as const,
	capacity: ["capacity"] as const,
	thread: (id: string) => ["threads", "detail", id] as const,
	activeRuns: ["runs", "active"] as const,
	inbox: ["inbox"] as const,
	agents: ["agents"] as const,
	proposal: (id: string) => ["proposal", id] as const,
	github: ["github"] as const,
	reachableRepos: ["github", "repos"] as const,
	repos: (slug: string) => ["venture", slug, "repos"] as const,
	threadCode: (id: string) => ["threads", "code", id] as const,
};

export const queries = {
	ventures: () => queryOptions({ queryKey: keys.ventures, queryFn: api.ventures }),
	recent: () => queryOptions({ queryKey: keys.recent, queryFn: () => api.recentEvents() }),
	cockpit: (slug: string) => queryOptions({ queryKey: keys.cockpit(slug), queryFn: () => api.cockpit(slug) }),
	board: (slug: string) => queryOptions({ queryKey: keys.board(slug), queryFn: () => api.board(slug) }),
	draft: (slug: string) => queryOptions({ queryKey: keys.draft(slug), queryFn: () => api.draft(slug) }),
	operator: (slug: string) => queryOptions({ queryKey: keys.operator(slug), queryFn: () => api.operator(slug) }),
	versions: (slug: string) => queryOptions({ queryKey: keys.versions(slug), queryFn: () => api.versions(slug) }),
	work: (slug: string) => queryOptions({ queryKey: keys.work(slug), queryFn: () => api.work(slug) }),
	holdingWork: () => queryOptions({ queryKey: keys.holdingWork, queryFn: api.holdingWork }),
	threads: (scope: { ventureId?: string; subject?: string; space?: string }) =>
		queryOptions({ queryKey: keys.threadList(scope), queryFn: () => api.threads(scope) }),
	thread: (id: string) => queryOptions({ queryKey: keys.thread(id), queryFn: () => api.thread(id) }),
	spaces: (ventureId: string | undefined) =>
		queryOptions({ queryKey: keys.spaceList(ventureId), queryFn: () => api.spaces(ventureId) }),
	space: (id: string) => queryOptions({ queryKey: keys.space(id), queryFn: () => api.space(id) }),
	capacity: () => queryOptions({ queryKey: keys.capacity, queryFn: api.capacity }),
	activeRuns: () => queryOptions({ queryKey: keys.activeRuns, queryFn: api.activeRuns }),
	inbox: () => queryOptions({ queryKey: keys.inbox, queryFn: api.inbox }),
	agents: () => queryOptions({ queryKey: keys.agents, queryFn: api.agents }),
	proposal: (id: string) => queryOptions({ queryKey: keys.proposal(id), queryFn: () => api.proposal(id) }),
	github: () => queryOptions({ queryKey: keys.github, queryFn: api.github }),
	reachableRepos: () => queryOptions({ queryKey: keys.reachableRepos, queryFn: api.reachableRepos }),
	repos: (slug: string) => queryOptions({ queryKey: keys.repos(slug), queryFn: () => api.repos(slug) }),
	threadCode: (id: string) => queryOptions({ queryKey: keys.threadCode(id), queryFn: () => api.threadCode(id) }),
};

export function applyAccessHint(client: QueryClient) {
	void client.invalidateQueries({ queryKey: keys.inbox });

	void client.invalidateQueries({ queryKey: keys.agents });
}

export function applyThreadHint(client: QueryClient, hint: ThreadHint) {
	void client.invalidateQueries({ queryKey: keys.thread(hint.threadId) });

	void client.invalidateQueries({ queryKey: ["threads", "list"] });

	void client.invalidateQueries({ queryKey: keys.activeRuns });

	void client.invalidateQueries({ queryKey: keys.spaces });

	void client.invalidateQueries({ queryKey: keys.inbox });

	void client.invalidateQueries({ queryKey: keys.capacity });
}

export function refreshDraft(client: QueryClient, slug: string) {
	return Promise.all([
		client.invalidateQueries({ queryKey: keys.board(slug) }),
		client.invalidateQueries({ queryKey: keys.work(slug) }),
		client.invalidateQueries({ queryKey: keys.draft(slug) }),
		client.invalidateQueries({ queryKey: keys.operator(slug) }),
		client.invalidateQueries({ queryKey: keys.inbox }),
	]);
}

export function applyDraftHint(client: QueryClient, hint: DraftHint) {
	const slug = slugById.get(hint.ventureId);

	if (slug !== undefined) void refreshDraft(client, slug);
	else void client.invalidateQueries({ queryKey: keys.inbox });
}

export function applyCapacityHint(client: QueryClient) {
	void client.invalidateQueries({ queryKey: keys.capacity });
}

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

export function applyCodeHint(client: QueryClient, hint: { ventureId: string; threadId: string | null }) {
	const slug = slugById.get(hint.ventureId);

	if (slug !== undefined) void client.invalidateQueries({ queryKey: keys.repos(slug) });

	if (hint.threadId !== null) void client.invalidateQueries({ queryKey: keys.threadCode(hint.threadId) });
}

export function applyHint(client: QueryClient, hint: StreamHint) {
	if ((knownSeq.get(hint.ventureId) ?? 0) >= hint.seq) return;

	knownSeq.set(hint.ventureId, hint.seq);

	const slug = slugById.get(hint.ventureId);

	if (slug !== undefined) void client.invalidateQueries({ queryKey: keys.venture(slug) });

	void client.invalidateQueries({ queryKey: keys.ventures });

	void client.invalidateQueries({ queryKey: keys.recent });

	void client.invalidateQueries({ queryKey: keys.holdingWork });

	void client.invalidateQueries({ queryKey: keys.inbox });

	void client.invalidateQueries({ queryKey: ["proposal"] });

	for (const listener of freshListeners) listener(hint.ventureId);
}

export function patchWork(client: QueryClient, slug: string, update: (items: WorkItem[]) => WorkItem[]) {
	client.setQueryData<VentureWork>(keys.work(slug), (current) =>
		current === undefined ? current : { ...current, workItems: update(current.workItems) },
	);

	client.setQueryData<HoldingWork>(keys.holdingWork, (current) =>
		current === undefined ? current : { ...current, workItems: update(current.workItems) },
	);
}

export function refreshVenture(client: QueryClient, venture: { id: string; slug: string }, seq: number) {
	for (const listener of localListeners) listener();

	rememberVenture(venture.id, venture.slug, seq);

	return Promise.all([
		client.invalidateQueries({ queryKey: keys.venture(venture.slug) }),
		client.invalidateQueries({ queryKey: keys.holdingWork }),
		client.invalidateQueries({ queryKey: keys.ventures }),
		client.invalidateQueries({ queryKey: keys.recent }),
		client.invalidateQueries({ queryKey: keys.inbox }),
		client.invalidateQueries({ queryKey: ["proposal"] }),
	]);
}

export function updateCockpit(client: QueryClient, slug: string, seq: number, update: (cockpit: Cockpit) => Cockpit) {
	for (const listener of localListeners) listener();

	client.setQueryData<Cockpit>(keys.cockpit(slug), (current) => {
		if (current === undefined) return current;

		rememberVenture(current.venture.id, slug, seq);

		return update({ ...current, venture: { ...current.venture, lastSeq: seq } });
	});

	client.setQueryData<Cockpit>(keys.board(slug), (current) =>
		current === undefined ? current : update({ ...current, venture: { ...current.venture, lastSeq: seq } }),
	);

	void client.invalidateQueries({ queryKey: keys.board(slug) });

	void client.invalidateQueries({ queryKey: keys.ventures });

	void client.invalidateQueries({ queryKey: keys.recent });

	void client.invalidateQueries({ queryKey: keys.events(slug) });

	void client.invalidateQueries({ queryKey: keys.versions(slug) });

	void client.invalidateQueries({ queryKey: keys.work(slug) });

	void client.invalidateQueries({ queryKey: keys.holdingWork });

	void client.invalidateQueries({ queryKey: keys.inbox });

	void client.invalidateQueries({ queryKey: ["proposal"] });
}

export type StreamState = "connecting" | "live" | "down";

/** Whether the live update stream is connected, for pages that show it. */
export const StreamContext = createContext<StreamState>("connecting");

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

			next.addEventListener("thread", (event) => {
				heard();

				applyThreadHint(client, JSON.parse(event.data as string) as ThreadHint);
			});

			next.addEventListener("access", () => {
				heard();

				applyAccessHint(client);
			});

			next.addEventListener("capacity", () => {
				heard();

				applyCapacityHint(client);
			});

			next.addEventListener("code", (event) => {
				heard();

				applyCodeHint(client, JSON.parse(event.data as string) as { ventureId: string; threadId: string | null });
			});

			next.addEventListener("draft", (event) => {
				heard();

				applyDraftHint(client, JSON.parse(event.data as string) as DraftHint);
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
