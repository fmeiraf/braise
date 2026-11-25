import { type AgentCapability, type AgentOverview, capabilityCommands, capabilityLabels } from "@braise/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { describeError } from "./errors.ts";
import { PageError } from "./holding.tsx";
import { capabilityPhrases } from "./labels.ts";
import { keys, queries } from "./live.ts";
import { accent, Cast, Drone, Icon, isSquare } from "./marks.tsx";
import { Hero, Skeleton } from "./parts.tsx";
import { actorName } from "./thread-timeline.ts";
import { ago, formatDateTime } from "./time.ts";
import { toast } from "./toast.ts";
import { useCommand } from "./use-command.ts";
import { ThreadLink, useWorking, type Working } from "./working.tsx";

const runtimeNames: Record<string, string> = { "claude-agent-sdk": "Claude Agent SDK", pi: "Pi" };

export function AgentsPage() {
	const agents = useQuery(queries.agents());
	const working = useWorking();
	const count = agents.data?.agents.length ?? 0;

	return (
		<div className="page narrow">
			<Hero cap={agents.isSuccess ? `${count === 1 ? "1 agent" : `${count} agents`}` : "Agents"} title="Agents" />
			{agents.isPending ? (
				<Skeleton label="Loading agents…" widths={[40, 90, 80, 70]} />
			) : agents.isError ? (
				<PageError error={agents.error} retry={() => void agents.refetch()} />
			) : (
				<>
					<p className="lede">
						Every agent reads everything in braise. These switches decide what each one may change; braise checks
						them on every change. Approving proposals, archiving and editing ventures stay yours.
					</p>
					{agents.data.agents.map((agent) => (
						<AgentSection
							key={agent.id}
							agent={agent}
							busy={working.find((item) => item.agent?.id === agent.id)}
						/>
					))}
				</>
			)}
		</div>
	);
}

function AgentSection({ agent, busy }: { agent: AgentOverview; busy: Working | undefined }) {
	const headingId = useId();

	return (
		<section className="agent" aria-labelledby={headingId} style={accent(busy?.run.ventureSlug)}>
			<header className="agent-h">
				<Drone square={isSquare(agent)} size={30} run={busy !== undefined} />
				<div>
					<h2 id={headingId}>{agent.name}</h2>
					<span className="mono mute">
						{runtimeNames[agent.runtime] ?? agent.runtime} · {agent.model}
					</span>
				</div>
				<span className="grow" />
				{busy === undefined ? (
					<span className="tag">Idle</span>
				) : (
					<ThreadLink ventureSlug={busy.run.ventureSlug} threadId={busy.run.threadId} className="agent-cast">
						<Cast label={busy.run.threadTitle} since={busy.run.startedAt ?? busy.run.createdAt} />
					</ThreadLink>
				)}
			</header>
			<ul>
				{agent.capabilities.map((state) => (
					<GrantRow key={state.capability} agent={agent} state={state} />
				))}
			</ul>
		</section>
	);
}

function lastChange(state: AgentCapability, now: number) {
	if (state.changedAt === null) return "Never granted";

	const when = ago(state.changedAt, now);

	if (!state.granted) return `Revoked ${when} by ${actorName(state.changedBy ?? "owner").toLowerCase()}`;

	if (state.changedBy === "braise") return `Granted at setup, ${when}`;

	return state.viaRequest ? `Granted ${when}, approving a request` : `Granted ${when} by you`;
}

function GrantRow({ agent, state }: { agent: AgentOverview; state: AgentCapability }) {
	const client = useQueryClient();
	const switchId = useId();
	const label = capabilityLabels[state.capability];

	const refresh = () => {
		void client.invalidateQueries({ queryKey: keys.agents });

		void client.invalidateQueries({ queryKey: keys.inbox });
	};

	const add = useCommand("grant.add", () => {
		refresh();

		revoke.reset();

		toast(
			<>
				{agent.name} may now change <b>{label.toLowerCase()}</b>
			</>,
			"key",
		);
	});

	const revoke = useCommand("grant.revoke", () => {
		refresh();

		add.reset();

		toast(
			<>
				Revoked <b>{label.toLowerCase()}</b> from {agent.name}
			</>,
			"key",
		);
	});

	const busy = add.isPending || revoke.isPending;
	const shown = add.isPending ? true : revoke.isPending ? false : state.granted;
	const error = add.error ?? revoke.error;
	const payload = { profileId: agent.id, capability: state.capability };

	return (
		<li className={state.granted ? "grant on" : "grant"}>
			<span className="grant-k">
				<Icon name="key" />
			</span>
			<div>
				<label htmlFor={switchId}>
					<b>{label}</b>
				</label>
				<p>May {capabilityPhrases[state.capability]}.</p>
				<span className="mono cmds">{capabilityCommands[state.capability].join(" · ")}</span>
			</div>
			<div className="grant-s">
				<input
					id={switchId}
					type="checkbox"
					role="switch"
					className="sw"
					checked={shown}
					aria-checked={shown}
					disabled={busy}
					aria-describedby={`${switchId}-status`}
					onChange={(event) => (event.target.checked ? add.mutate({ payload }) : revoke.mutate({ payload }))}
				/>
				<span id={`${switchId}-status`}>
					{error === null ? (
						state.changedAt === null ? (
							lastChange(state, Date.now())
						) : (
							<time dateTime={state.changedAt} title={formatDateTime(state.changedAt)}>
								{lastChange(state, Date.now())}
							</time>
						)
					) : (
						<span className="err" role="alert">
							{describeError(error)}
						</span>
					)}
				</span>
				{state.pendingRequestId === null ? null : (
					<Link to="/inbox" search={{ access: state.pendingRequestId }}>
						{agent.name} asked for this
					</Link>
				)}
			</div>
		</li>
	);
}
