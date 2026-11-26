import {
	type AgentCapability,
	type AgentOverview,
	capabilityCommands,
	capabilityLabels,
	type LimitReading,
	type RuntimeCapacity,
	type RuntimeDay,
} from "@braise/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { describeError } from "./errors.ts";
import { PageError } from "./holding.tsx";
import { capabilityPhrases } from "./labels.ts";
import { keys, queries } from "./live.ts";
import { accent, Cast, Drone, Elapsed, Icon, isSquare } from "./marks.tsx";
import { Hero, Sec, Skeleton } from "./parts.tsx";
import { actorName } from "./thread-timeline.ts";
import { ago, clockTime, dayLabel, formatDateTime } from "./time.ts";
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
					<CapacityPanel />
					<Sec title="Permissions" />
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

const windowNames: Record<string, string> = {
	five_hour: "5-hour window",
	seven_day: "7-day window",
	seven_day_opus: "7-day Opus window",
	seven_day_sonnet: "7-day Sonnet window",
	primary: "5-hour window",
	secondary: "Weekly window",
};

function windowName(window: string) {
	return windowNames[window] ?? window.replaceAll("_", " ");
}

function ms(value: number | null) {
	if (value === null) return "–";

	if (value < 1_000) return `${value}ms`;

	if (value < 60_000) return `${(value / 1_000).toFixed(1)}s`;

	return `${Math.floor(value / 60_000)}m ${Math.round((value % 60_000) / 1_000)}s`;
}

function tokens(count: number) {
	if (count < 1_000) return `${count}`;

	return count < 1_000_000 ? `${(count / 1_000).toFixed(1)}k` : `${(count / 1_000_000).toFixed(2)}M`;
}

function resetText(iso: string | null, now: number) {
	if (iso === null) return "no reset time";

	const at = Date.parse(iso);

	return at - now < 86_400_000
		? `resets ${clockTime(iso)}`
		: `resets ${dayLabel(iso, now).toLowerCase()} ${clockTime(iso)}`;
}

function CapacityPanel() {
	const capacity = useQuery(queries.capacity());

	return (
		<section className="capacity" aria-labelledby="capacity-heading">
			<Sec title="Capacity" id="capacity-heading" />
			<p className="lede">
				How many runs each login takes at once, what waits, and how much of each subscription window is used. braise
				pauses a runtime at {Math.round((capacity.data?.pauseAt ?? 0.9) * 100)}% of a window, or when the provider
				refuses, and resumes when the window resets.
			</p>
			{capacity.isPending ? (
				<Skeleton label="Loading capacity…" widths={[60, 90, 80]} />
			) : capacity.isError ? (
				<PageError error={capacity.error} retry={() => void capacity.refetch()} />
			) : (
				capacity.data.runtimes.map((runtime) => (
					<RuntimePanel key={runtime.runtime} runtime={runtime} pauseAt={capacity.data.pauseAt} />
				))
			)}
		</section>
	);
}

function WindowRow({ reading, pauseAt, now }: { reading: LimitReading; pauseAt: number; now: number }) {
	const used = reading.utilization;
	const full = reading.status === "rejected" || (used !== null && used >= pauseAt);

	return (
		<li className={full ? "win full" : "win"}>
			<span className="win-n">{windowName(reading.window)}</span>
			<span className="win-b" aria-hidden="true">
				<i style={{ width: `${Math.round((used ?? (reading.status === "rejected" ? 1 : 0)) * 100)}%` }} />
				<b style={{ left: `${pauseAt * 100}%` }} />
			</span>
			<span className="mono win-u">
				{used === null ? (reading.status === "rejected" ? "full" : "–") : `${Math.round(used * 100)}%`}
			</span>
			<span className="win-r">
				{resetText(reading.resetsAt, now)} ·{" "}
				<time dateTime={reading.observedAt} title={formatDateTime(reading.observedAt)}>
					read {ago(reading.observedAt, now)}
				</time>
			</span>
		</li>
	);
}

function RuntimePanel({ runtime, pauseAt }: { runtime: RuntimeCapacity; pauseAt: number }) {
	const client = useQueryClient();
	const now = Date.now();
	const headingId = useId();
	const refresh = () => void client.invalidateQueries({ queryKey: keys.capacity });
	const resume = useCommand("runtime.resume", refresh);
	const pause = useCommand("runtime.pause", refresh);
	const payload = { runtime: runtime.runtime };
	const error = resume.error ?? pause.error;

	return (
		<section className={runtime.pause === null ? "cap-rt" : "cap-rt paused"} aria-labelledby={headingId}>
			<header className="cap-h">
				<Drone square={runtime.runtime === "pi"} size={22} run={runtime.running > 0} />
				<div>
					<h3 id={headingId}>{runtime.label}</h3>
					<span className="mono mute">{runtimeNames[runtime.runtime] ?? runtime.runtime}</span>
				</div>
				<span className="grow" />
				<dl className="cap-n">
					<div>
						<dt>Running</dt>
						<dd className="mono">
							{runtime.running}/{runtime.limit}
						</dd>
					</div>
					<div>
						<dt>Queued</dt>
						<dd className="mono">
							{runtime.queued}
							{runtime.oldestQueuedAt === null ? null : (
								<span className="mute">
									{" "}
									· oldest <Elapsed since={runtime.oldestQueuedAt} />
								</span>
							)}
						</dd>
					</div>
				</dl>
			</header>
			{runtime.pause === null ? null : (
				<output className="cap-pause">
					<span className="need" />
					<span>
						<b>Paused</b>{" "}
						{runtime.pause.reason === "owner"
							? "by you"
							: runtime.pause.until === null
								? "by a subscription limit"
								: `until ${clockTime(runtime.pause.until)}, when the window resets`}
						. Its runs stay queued.
					</span>
					<button
						type="button"
						className="btn sm"
						disabled={resume.isPending}
						onClick={() => resume.mutate({ payload })}
					>
						Resume
					</button>
				</output>
			)}
			{runtime.windows.length === 0 ? (
				<p className="cap-none">No window readings yet. They arrive with the next run on this login.</p>
			) : (
				<ul className="wins">
					{runtime.windows.map((reading) => (
						<WindowRow key={reading.window} reading={reading} pauseAt={pauseAt} now={now} />
					))}
				</ul>
			)}
			<DayTable days={runtime.days} />
			<footer className="cap-f">
				<span className="mute">{runtime.readings.length} readings in the last 7 days</span>
				<span className="grow" />
				{runtime.pause === null ? (
					<button
						type="button"
						className="btn ghost sm"
						disabled={pause.isPending}
						onClick={() => pause.mutate({ payload })}
					>
						Pause {runtime.label}
					</button>
				) : null}
				{error === null ? null : (
					<span className="err" role="alert">
						{describeError(error)}
					</span>
				)}
			</footer>
		</section>
	);
}

function DayTable({ days }: { days: RuntimeDay[] }) {
	if (days.length === 0) return <p className="cap-none">No runs in the last two weeks.</p>;

	return (
		<div className="cap-t">
			<table className="tbl perf">
				<thead>
					<tr>
						<th>Day</th>
						<th className="r">Runs</th>
						<th className="r" data-tip="Median and 95th percentile">
							Queue wait
						</th>
						<th className="r" data-tip="Median and 95th percentile">
							First token
						</th>
						<th className="r" data-tip="Median and 95th percentile">
							Duration
						</th>
						<th className="r">Tokens</th>
						<th className="r">Cost</th>
						<th className="r">Failed</th>
					</tr>
				</thead>
				<tbody>
					{days.map((day) => (
						<tr key={day.day}>
							<td className="mono">{day.day}</td>
							<td className="r mono">{day.runs}</td>
							<td className="r mono">
								{ms(day.queueWaitP50Ms)} <span className="mute">/ {ms(day.queueWaitP95Ms)}</span>
							</td>
							<td className="r mono">
								{ms(day.firstTokenP50Ms)} <span className="mute">/ {ms(day.firstTokenP95Ms)}</span>
							</td>
							<td className="r mono">
								{ms(day.durationP50Ms)} <span className="mute">/ {ms(day.durationP95Ms)}</span>
							</td>
							<td className="r mono">{tokens(day.inputTokens + day.outputTokens)}</td>
							<td className="r mono">${day.costUsd.toFixed(2)}</td>
							<td className="r mono">
								{day.failed + day.interrupted === 0 ? (
									<span className="mute">0</span>
								) : (
									<span data-tip={`${day.failed} failed · ${day.interrupted} interrupted`}>
										{day.failed + day.interrupted}
									</span>
								)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
