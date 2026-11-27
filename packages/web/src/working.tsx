import type { ActiveRun, AgentOverview } from "@braise/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { CSSProperties, DragEventHandler, ReactNode } from "react";
import { queries } from "./live.ts";
import { ventureTone } from "./venture-state.ts";

export interface Working {
	run: ActiveRun;
	agent: AgentOverview | null;
}

/** The runs an agent is working on now (not the queued ones), each with that agent. */
export function useWorking() {
	const runs = (useQuery(queries.activeRuns()).data?.runs ?? []).filter((run) => run.status === "running");
	const threads = useQuery({ ...queries.threads({}), enabled: runs.length > 0 }).data?.threads ?? [];
	const agents = useQuery(queries.agents()).data?.agents ?? [];

	return runs.map((run) => {
		const profileId = threads.find((thread) => thread.id === run.threadId)?.agentProfileId;

		return { run, agent: agents.find((agent) => agent.id === profileId) ?? null } satisfies Working;
	});
}

/** Each venture's state from the live inbox and runs: needs you, running, queued or nothing. */
export function useVentureTones() {
	const pending = useQuery(queries.inbox()).data?.pending ?? [];
	const runs = useQuery(queries.activeRuns()).data?.runs ?? [];

	return (venture: { id: string; slug: string }) => ventureTone(venture, { pending, runs });
}

/** Looks an agent up by its profile id or its actor (`agent:<id>`). */
export function useAgentLookup() {
	const agents = useQuery(queries.agents()).data?.agents ?? [];

	return (actorOrId: string) => agents.find((agent) => agent.id === actorOrId || agent.actor === actorOrId);
}

export function workingLabel(working: Working | undefined) {
	return `${working?.agent?.name ?? "An agent"} is working`;
}

/** A link to a thread, in its venture's Threads view or the Holding's. */
export function ThreadLink(props: {
	ventureSlug: string | null;
	threadId: string;
	className?: string;
	style?: CSSProperties;
	tip?: string;
	current?: boolean;
	onDragStart?: DragEventHandler<HTMLAnchorElement>;
	tone?: string;
	children: ReactNode;
}) {
	const search = { thread: props.threadId };
	const current = props.current === true ? "page" : undefined;

	return props.ventureSlug === null ? (
		<Link
			to="/threads"
			search={search}
			className={props.className}
			style={props.style}
			data-tip={props.tip}
			aria-current={current}
			onDragStart={props.onDragStart}
			data-tone={props.tone}
		>
			{props.children}
		</Link>
	) : (
		<Link
			to="/v/$slug/threads"
			params={{ slug: props.ventureSlug }}
			search={search}
			className={props.className}
			style={props.style}
			data-tip={props.tip}
			aria-current={current}
			onDragStart={props.onDragStart}
			data-tone={props.tone}
		>
			{props.children}
		</Link>
	);
}
