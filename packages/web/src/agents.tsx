import { type AgentCapability, type AgentOverview, capabilityCommands, capabilityLabels } from "@braise/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { describeError } from "./errors.ts";
import { PageError } from "./holding.tsx";
import { capabilityPhrases } from "./labels.ts";
import { keys, queries } from "./live.ts";
import { actorName } from "./thread-timeline.ts";
import { ago, formatDateTime } from "./time.ts";
import { useCommand } from "./use-command.ts";

const runtimeNames: Record<string, string> = { "claude-agent-sdk": "Claude Agent SDK", pi: "Pi" };

export function AgentsPage() {
	const agents = useQuery(queries.agents());

	return (
		<>
			<header className="topbar">
				<span className="crumb-current">Agents</span>
			</header>
			{agents.isPending ? (
				<div className="page page-narrow skeleton-stack" aria-busy="true">
					<span className="visually-hidden">Loading agents…</span>
					{[40, 90, 80, 70].map((width) => (
						<span key={width} className="skeleton" style={{ width: `${width}%` }} />
					))}
				</div>
			) : agents.isError ? (
				<PageError error={agents.error} retry={() => void agents.refetch()} />
			) : (
				<div className="page page-narrow agents">
					<p className="agents-lede">
						Every agent reads everything in braise. These switches decide what each one may change; braise checks
						them on every change. Approving proposals, archiving and editing ventures stay yours.
					</p>
					{agents.data.agents.map((agent) => (
						<AgentSection key={agent.id} agent={agent} />
					))}
				</div>
			)}
		</>
	);
}

function AgentSection({ agent }: { agent: AgentOverview }) {
	const headingId = useId();

	return (
		<section className="agent" aria-labelledby={headingId}>
			<header className="agent-head">
				<span className="author-mark is-agent" aria-hidden />
				<h2 id={headingId}>{agent.name}</h2>
				<span className="agent-runtime">
					{runtimeNames[agent.runtime] ?? agent.runtime} · <span className="num">{agent.model}</span>
				</span>
			</header>
			<ul className="grants">
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
	});

	const revoke = useCommand("grant.revoke", () => {
		refresh();

		add.reset();
	});

	const busy = add.isPending || revoke.isPending;
	const shown = add.isPending ? true : revoke.isPending ? false : state.granted;
	const error = add.error ?? revoke.error;
	const payload = { profileId: agent.id, capability: state.capability };

	return (
		<li className={state.granted ? "grant is-granted" : "grant"}>
			<div className="grant-main">
				<label className="grant-label" htmlFor={switchId}>
					{label}
				</label>
				<p className="grant-phrase">May {capabilityPhrases[state.capability]}.</p>
				<p className="grant-commands num">{capabilityCommands[state.capability].join(" · ")}</p>
			</div>
			<div className="grant-side">
				<input
					id={switchId}
					type="checkbox"
					role="switch"
					className="switch"
					checked={shown}
					aria-checked={shown}
					disabled={busy}
					aria-describedby={`${switchId}-status`}
					onChange={(event) => (event.target.checked ? add.mutate({ payload }) : revoke.mutate({ payload }))}
				/>
				<p className="grant-status" id={`${switchId}-status`}>
					{error === null ? (
						state.changedAt === null ? (
							lastChange(state, Date.now())
						) : (
							<time dateTime={state.changedAt} title={formatDateTime(state.changedAt)}>
								{lastChange(state, Date.now())}
							</time>
						)
					) : (
						<span className="error-text" role="alert">
							{describeError(error)}
						</span>
					)}
				</p>
				{state.pendingRequestId === null ? null : (
					<Link to="/inbox" search={{ access: state.pendingRequestId }} className="grant-request">
						{agent.name} asked for this
					</Link>
				)}
			</div>
		</li>
	);
}
