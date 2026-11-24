import type { Bet, BetStatus, Cockpit, Goal, StrategyVersion, WorkProgress } from "@braise/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Archive, ChevronDown, ChevronRight, History, MessagesSquare, Pencil, Plus } from "lucide-react";
import { type CSSProperties, type FormEvent, type KeyboardEvent, useRef, useState } from "react";
import { ApiRequestError, api, type SetStatusResult } from "./api.ts";
import { Editable } from "./editable.tsx";
import { describeError } from "./errors.ts";
import { EventItem } from "./feed.tsx";
import { focusOnMount } from "./focus.ts";
import { useFreshIds } from "./fresh.ts";
import { PageError } from "./holding.tsx";
import { NeedsYou } from "./inbox.tsx";
import { kindLabel } from "./labels.ts";
import { keys, queries, rememberVenture, updateCockpit } from "./live.ts";
import { CoreSample, Progress, ringColor } from "./rings.tsx";
import { ago, formatDate } from "./time.ts";
import { useCommand } from "./use-command.ts";

const kernelFields = [
	{ key: "why", label: "Why", prompt: "Why should this venture exist?" },
	{ key: "what", label: "What", prompt: "What is it?" },
	{ key: "diagnosis", label: "Diagnosis", prompt: "No diagnosis yet. What is the crux of the challenge?" },
	{
		key: "guidingPolicy",
		label: "Guiding policy",
		prompt: "No guiding policy yet. How will you answer the diagnosis?",
	},
] as const;

type KernelKey = (typeof kernelFields)[number]["key"];

function replaceById<Item extends { id: string }>(items: Item[], next: Item) {
	return items.some((item) => item.id === next.id)
		? items.map((item) => (item.id === next.id ? next : item))
		: [...items, next];
}

export function CockpitPage() {
	const { slug } = useParams({ from: "/v/$slug/" });
	const cockpit = useQuery(queries.cockpit(slug));

	if (cockpit.isPending) return <CockpitSkeleton />;

	if (cockpit.isError) return <PageError error={cockpit.error} retry={() => void cockpit.refetch()} />;

	rememberVenture(cockpit.data.venture.id, slug, cockpit.data.venture.lastSeq);

	return <CockpitView slug={slug} cockpit={cockpit.data} />;
}

function CockpitView({ slug, cockpit }: { slug: string; cockpit: Cockpit }) {
	const { venture, strategy, bets, goals, workProgress } = cockpit;
	const freshBets = useFreshIds(venture.id, bets);
	const freshGoals = useFreshIds(venture.id, goals);
	const [adding, setAdding] = useState(false);
	const activeRuns = useQuery(queries.activeRuns());
	const working = (activeRuns.data?.runs ?? []).filter((run) => run.ventureSlug === slug);

	const liveBetIds = new Set(bets.map((bet) => bet.id));
	const looseGoals = goals.filter((goal) => goal.betId === null || !liveBetIds.has(goal.betId));

	const ordered = [
		...bets.filter((bet) => bet.status === "open" || bet.status === "won"),
		...bets.filter((bet) => bet.status === "lost" || bet.status === "killed"),
	];

	return (
		<>
			<header className="topbar">
				<Link to="/" className="crumb">
					Holding
				</Link>
				<span className="muted" aria-hidden>
					/
				</span>
				<span className="crumb-current">{venture.name}</span>
				<div className="topbar-actions">
					<Link to="/v/$slug/threads" params={{ slug }} className="button">
						<MessagesSquare aria-hidden />
						New thread
					</Link>
					<button type="button" className="button is-primary" onClick={() => setAdding(true)}>
						<Plus aria-hidden />
						Add bet
					</button>
				</div>
			</header>

			<div className="cockpit" style={{ "--ring": ringColor(venture.id) } as CSSProperties}>
				<div className="cockpit-main">
					<div className="venture-title">
						<CoreSample id={venture.id} version={strategy.version} live={working.length > 0} />
						<div className="venture-title-text">
							<h1>{venture.name}</h1>
							<div className="venture-meta">
								<span className="tag">{kindLabel[venture.kind]}</span>
								<span className="data muted">/v/{venture.slug}</span>
								{working.length > 0 ? (
									<span className="venture-working">
										<span className="pixel is-live" aria-hidden />
										{working.length === 1
											? "Claude is working"
											: `Claude is working in ${working.length} threads`}
									</span>
								) : null}
							</div>
						</div>
					</div>

					<div className="trunk">
						<StrategyPanel slug={slug} ventureId={venture.id} strategy={strategy} />

						<section aria-labelledby="bets-heading">
							<div className="section-head">
								<h2 id="bets-heading">Bets</h2>
								<span className="section-meta num">
									{bets.filter((bet) => bet.status === "open").length} open
								</span>
							</div>

							{adding ? <AddBetForm slug={slug} ventureId={venture.id} close={() => setAdding(false)} /> : null}

							{bets.length === 0 && !adding ? (
								<p className="empty-state">
									No bets yet. A bet is a hypothesis, the action that tests it, and when you'd kill it.
								</p>
							) : (
								<ol className="spine">
									{ordered.map((bet) => (
										<BetItem
											key={bet.id}
											slug={slug}
											bet={bet}
											bets={bets}
											goals={goals.filter((goal) => goal.betId === bet.id)}
											fresh={freshBets.has(bet.id)}
											freshGoals={freshGoals}
											progress={workProgress}
										/>
									))}
								</ol>
							)}
						</section>

						<section className="loose" aria-labelledby="loose-heading">
							<div className="section-head">
								<span className="node is-loose" aria-hidden />
								<h2 id="loose-heading">Not tied to a bet</h2>
								<span className="section-meta num">{looseGoals.length}</span>
							</div>
							<GoalList
								slug={slug}
								ventureId={venture.id}
								betId={null}
								goals={looseGoals}
								bets={bets}
								fresh={freshGoals}
								progress={workProgress}
								loose
							/>
						</section>
					</div>
				</div>

				<aside className="cockpit-aside" aria-labelledby="recent-heading">
					<NeedsYou ventureId={venture.id} />
					<RecentActivity slug={slug} ventureId={venture.id} lastSeq={venture.lastSeq} />
				</aside>
			</div>
		</>
	);
}

function StrategyPanel({ slug, ventureId, strategy }: { slug: string; ventureId: string; strategy: StrategyVersion }) {
	const client = useQueryClient();
	const [open, setOpen] = useState(true);
	const [draft, setDraft] = useState<Record<KernelKey, string> | null>(null);
	const [askingReason, setAskingReason] = useState(false);
	const [reason, setReason] = useState("");
	const reasonRef = useRef<HTMLInputElement>(null);
	const nextVersion = strategy.version + 1;

	const revise = useCommand<"strategy.revise", StrategyVersion>("strategy.revise", (response) => {
		updateCockpit(client, slug, response.seq, (cockpit) => ({ ...cockpit, strategy: response.result }));

		setDraft(null);

		setAskingReason(false);

		setReason("");
	});

	const startEditing = () => {
		setOpen(true);

		revise.reset();

		setDraft({
			why: strategy.why,
			what: strategy.what,
			diagnosis: strategy.diagnosis,
			guidingPolicy: strategy.guidingPolicy,
		});
	};

	const cancel = () => {
		setDraft(null);

		setAskingReason(false);

		setReason("");

		revise.reset();
	};

	const unchanged = draft !== null && kernelFields.every(({ key }) => draft[key].trim() === strategy[key].trim());

	const submit = (event: FormEvent) => {
		event.preventDefault();

		if (draft === null || unchanged) return;

		if (!askingReason) {
			setAskingReason(true);

			queueMicrotask(() => reasonRef.current?.focus());

			return;
		}

		if (reason.trim() === "") return;

		revise.mutate({ payload: { ventureId, ...draft }, reason: reason.trim() });
	};

	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === "Escape") {
			event.preventDefault();

			cancel();
		}
	};

	const revisedAt = strategy.activatedAt ?? strategy.createdAt;

	return (
		<section className="strategy" aria-labelledby="strategy-heading">
			<span className="node is-strategy" aria-hidden />
			<div className="strategy-head">
				<button
					type="button"
					className="icon-button collapse"
					aria-expanded={open}
					aria-controls="strategy-body"
					aria-label={open ? "Collapse strategy" : "Expand strategy"}
					onClick={() => setOpen(!open)}
				>
					<ChevronDown aria-hidden />
				</button>
				<h2 id="strategy-heading">Strategy</h2>
				<span className="data muted">v{strategy.version}</span>
				<span className="muted">
					· {strategy.version === 1 ? "created" : "revised"} {ago(revisedAt, Date.now())}
				</span>
				<Link to="/v/$slug/history" params={{ slug }} className="version-link">
					<History aria-hidden size={13} />
					History
				</Link>
				<div className="section-actions" style={{ marginLeft: "auto" }}>
					{draft === null ? (
						<button type="button" className="button is-ghost" onClick={startEditing}>
							<Pencil aria-hidden />
							Edit
						</button>
					) : null}
				</div>
			</div>

			{open && draft === null ? (
				<dl className="kernel" id="strategy-body">
					{kernelFields.map(({ key, label, prompt }) => (
						<KernelRow key={key} label={label}>
							{strategy[key] === "" ? (
								<button type="button" className="prompt" onClick={startEditing}>
									{prompt}
								</button>
							) : (
								strategy[key]
							)}
						</KernelRow>
					))}
				</dl>
			) : null}

			{draft === null ? null : (
				<form className="kernel-edit" id="strategy-body" onSubmit={submit} onKeyDown={onKeyDown}>
					{kernelFields.map(({ key, label, prompt }, index) => (
						<label key={key} className="field">
							<span className="field-label">{label}</span>
							<textarea
								className="textarea"
								rows={2}
								value={draft[key]}
								placeholder={prompt}
								required={key === "why" || key === "what"}
								ref={index === 0 ? focusOnMount : undefined}
								onChange={(event) => {
									setDraft({ ...draft, [key]: event.target.value });

									setAskingReason(false);
								}}
							/>
						</label>
					))}

					{askingReason ? (
						<div className="reason-row">
							<label className="field">
								<span className="field-label">Why are you revising it?</span>
								<input
									ref={reasonRef}
									className="input"
									value={reason}
									required
									maxLength={2000}
									placeholder={`Kept with v${nextVersion} in the strategy history`}
									onChange={(event) => setReason(event.target.value)}
								/>
							</label>
						</div>
					) : null}

					{revise.isError ? (
						<p className="error-text" role="alert">
							{describeError(revise.error)}
						</p>
					) : null}

					<div className="form-actions">
						<button
							type="submit"
							className="button is-primary"
							disabled={unchanged || revise.isPending || (askingReason && reason.trim() === "")}
						>
							{revise.isPending ? "Saving…" : askingReason ? `Save v${nextVersion}` : `Save as v${nextVersion}`}
						</button>
						<button type="button" className="button is-ghost" onClick={cancel}>
							Cancel
						</button>
						<span className="kbd-hint">
							{unchanged ? "Change a field to save a new version" : "Esc to cancel"}
						</span>
					</div>
				</form>
			)}
		</section>
	);
}

function KernelRow({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<>
			<dt>{label}</dt>
			<dd>{children}</dd>
		</>
	);
}

function useBetCache(slug: string) {
	const client = useQueryClient();

	return (seq: number, bet: Bet) =>
		updateCockpit(client, slug, seq, (cockpit) => ({ ...cockpit, bets: replaceById(cockpit.bets, bet) }));
}

function BetItem(props: {
	slug: string;
	bet: Bet;
	bets: Bet[];
	goals: Goal[];
	fresh: boolean;
	freshGoals: ReadonlySet<string>;
	progress: Record<string, WorkProgress>;
}) {
	const { slug, bet, goals } = props;
	const client = useQueryClient();
	const storeBet = useBetCache(slug);
	const settled = bet.status === "lost" || bet.status === "killed";
	const [expanded, setExpanded] = useState(!settled);
	const [settling, setSettling] = useState<Exclude<BetStatus, "open"> | null>(null);

	const update = useCommand<"bet.update", Bet>("bet.update", (response) => storeBet(response.seq, response.result));

	const archive = useCommand<"bet.archive", Bet>("bet.archive", (response) =>
		updateCockpit(client, slug, response.seq, (cockpit) => ({
			...cockpit,
			bets: cockpit.bets.filter((item) => item.id !== response.result.id),
		})),
	);

	const setStatus = useCommand<"bet.set_status", SetStatusResult>("bet.set_status", (response) => {
		const archived = new Set(response.result.archivedGoals.map((goal) => goal.id));

		updateCockpit(client, slug, response.seq, (cockpit) => ({
			...cockpit,
			bets: replaceById(cockpit.bets, response.result.bet),
			goals: cockpit.goals.filter((goal) => !archived.has(goal.id)),
		}));

		setSettling(null);

		if (response.result.bet.status !== "won") setExpanded(false);
	});

	const saveField = (field: "hypothesis" | "action" | "killCriteria") => (value: string) =>
		update.mutateAsync({ payload: { ventureId: bet.ventureId, betId: bet.id, [field]: value } });

	const settle = (archiveGoals: boolean) => {
		if (settling === null) return;

		setStatus.mutate({ payload: { ventureId: bet.ventureId, betId: bet.id, status: settling, archiveGoals } });
	};

	const className = [
		"bet",
		settled ? "is-settled" : "",
		bet.status === "won" ? "is-won" : "",
		props.fresh ? "is-fresh" : "",
	]
		.filter(Boolean)
		.join(" ");

	if (!expanded) {
		return (
			<li className={className}>
				<span className="node" aria-hidden />
				<button type="button" className="collapsed-bet" aria-expanded={false} onClick={() => setExpanded(true)}>
					<ChevronRight aria-hidden size={14} />
					<span>{bet.hypothesis}</span>
					<span className="tag">{bet.status}</span>
					<span className="num">{goals.length === 1 ? "1 goal" : `${goals.length} goals`}</span>
				</button>
			</li>
		);
	}

	return (
		<li className={className}>
			<span className="node" aria-hidden />
			<div className="bet-head">
				<div className="bet-title">
					<Editable label="hypothesis" value={bet.hypothesis} required multiline save={saveField("hypothesis")} />
				</div>
				<div className="row-actions">
					{goals.length === 0 ? (
						<button
							type="button"
							className="icon-button"
							aria-label="Archive bet"
							title="Archive bet"
							disabled={archive.isPending}
							onClick={() => archive.mutate({ payload: { ventureId: bet.ventureId, betId: bet.id } })}
						>
							<Archive aria-hidden />
						</button>
					) : null}
					{settled ? (
						<button
							type="button"
							className="icon-button"
							aria-label="Collapse bet"
							title="Collapse"
							onClick={() => setExpanded(false)}
						>
							<ChevronDown aria-hidden />
						</button>
					) : null}
				</div>
				<StatusControl status={bet.status} onPick={setSettling} />
			</div>

			<dl className="bet-fields">
				<dt>Action</dt>
				<dd>
					<Editable label="action" value={bet.action} required multiline save={saveField("action")} />
				</dd>
				<dt>Kill criteria</dt>
				<dd>
					<Editable
						label="kill criteria"
						value={bet.killCriteria}
						required
						multiline
						save={saveField("killCriteria")}
					/>
				</dd>
			</dl>

			{settling === null ? null : (
				<fieldset className="settle">
					<legend className="visually-hidden">Mark bet {settling}</legend>
					<p>
						Mark this bet <strong>{settling}</strong>.{" "}
						{goals.length > 0
							? `Archive its ${goals.length === 1 ? "goal" : `${goals.length} goals`} too?`
							: "It has no goals."}
					</p>
					{goals.length > 0 ? (
						<>
							<button
								type="button"
								className="button is-primary"
								disabled={setStatus.isPending}
								onClick={() => settle(true)}
							>
								Mark {settling} and archive {goals.length === 1 ? "goal" : "goals"}
							</button>
							<button
								type="button"
								className="button"
								disabled={setStatus.isPending}
								onClick={() => settle(false)}
							>
								Keep goals
							</button>
						</>
					) : (
						<button
							type="button"
							className="button is-primary"
							disabled={setStatus.isPending}
							onClick={() => settle(false)}
						>
							Mark {settling}
						</button>
					)}
					<button type="button" className="button is-ghost" onClick={() => setSettling(null)}>
						Cancel
					</button>
					{setStatus.isError ? (
						<p className="error-text" role="alert">
							{describeError(setStatus.error)}
						</p>
					) : null}
				</fieldset>
			)}

			{archive.isError ? (
				<p className="error-text" role="alert">
					{describeError(archive.error)}
				</p>
			) : null}

			<GoalList
				slug={slug}
				ventureId={bet.ventureId}
				betId={bet.id}
				goals={goals}
				bets={props.bets}
				fresh={props.freshGoals}
				progress={props.progress}
			/>
		</li>
	);
}

function StatusControl({
	status,
	onPick,
}: {
	status: BetStatus;
	onPick: (status: Exclude<BetStatus, "open">) => void;
}) {
	const statusClass = status === "won" ? "is-won" : status === "open" ? "" : "is-settled";

	if (status !== "open") {
		return (
			<span className={`status-pill ${statusClass}`}>
				<span className="pixel" aria-hidden />
				{status}
			</span>
		);
	}

	return (
		<label className="status-pill" title="Settle this bet">
			<span className="pixel" aria-hidden />
			<span className="visually-hidden">Bet status</span>
			<select
				className="status-select"
				value="open"
				onChange={(event) => {
					const value = event.target.value;

					if (value === "won" || value === "lost" || value === "killed") onPick(value);
				}}
			>
				<option value="open">open</option>
				<option value="won">won</option>
				<option value="lost">lost</option>
				<option value="killed">killed</option>
			</select>
			<ChevronDown aria-hidden size={12} />
		</label>
	);
}

function GoalList(props: {
	slug: string;
	ventureId: string;
	betId: string | null;
	goals: Goal[];
	bets: Bet[];
	fresh: ReadonlySet<string>;
	progress: Record<string, WorkProgress>;
	loose?: boolean;
}) {
	const [adding, setAdding] = useState(false);

	return (
		<ul className={props.loose === true ? "goals is-loose" : "goals"}>
			{props.goals.map((goal) => (
				<GoalRow
					key={goal.id}
					slug={props.slug}
					goal={goal}
					bets={props.bets}
					fresh={props.fresh.has(goal.id)}
					progress={props.progress[goal.id]}
				/>
			))}
			{props.goals.length === 0 && !adding ? (
				<li className="goal-empty">
					{props.loose === true ? "Every goal tests a bet." : "No goals test this bet yet."}
				</li>
			) : null}
			<li>
				{adding ? (
					<AddGoalForm
						slug={props.slug}
						ventureId={props.ventureId}
						betId={props.betId}
						close={() => setAdding(false)}
					/>
				) : (
					<button type="button" className="add-row" onClick={() => setAdding(true)}>
						<Plus aria-hidden />
						Add goal
					</button>
				)}
			</li>
		</ul>
	);
}

function GoalRow(props: { slug: string; goal: Goal; bets: Bet[]; fresh: boolean; progress: WorkProgress | undefined }) {
	const { slug, goal, bets, fresh, progress } = props;
	const client = useQueryClient();

	const storeGoal = (seq: number, next: Goal) =>
		updateCockpit(client, slug, seq, (cockpit) => ({ ...cockpit, goals: replaceById(cockpit.goals, next) }));

	const update = useCommand<"goal.update", Goal>("goal.update", (response) =>
		storeGoal(response.seq, response.result),
	);

	const archive = useCommand<"goal.archive", Goal>("goal.archive", (response) =>
		updateCockpit(client, slug, response.seq, (cockpit) => ({
			...cockpit,
			goals: cockpit.goals.filter((item) => item.id !== response.result.id),
		})),
	);

	const base = { ventureId: goal.ventureId, goalId: goal.id };
	const linkable = bets.filter((bet) => bet.status === "open" || bet.id === goal.betId);

	return (
		<li className={fresh ? "goal is-fresh" : "goal"}>
			<span className="goal-node" aria-hidden />
			<span className="goal-outcome">
				<Editable
					label="outcome"
					value={goal.outcome}
					required
					save={(value) => update.mutateAsync({ payload: { ...base, outcome: value } })}
				/>
			</span>
			<span className="goal-signal">
				<Editable
					label="signal"
					value={goal.signal}
					required
					save={(value) => update.mutateAsync({ payload: { ...base, signal: value } })}
				/>
			</span>
			<span className={goal.horizon === null ? "goal-horizon" : "goal-horizon data"}>
				<Editable
					label="horizon"
					type="date"
					value={goal.horizon ?? ""}
					placeholder="No horizon"
					display={goal.horizon === null ? undefined : formatDate(goal.horizon)}
					save={(value) => update.mutateAsync({ payload: { ...base, horizon: value === "" ? null : value } })}
				/>
			</span>
			<span className="goal-work">
				{progress === undefined ? null : (
					<Link
						to="/v/$slug/work"
						params={{ slug }}
						hash={`goal-${goal.id}`}
						className="num"
						title="Open this goal's work"
					>
						<Progress done={progress.done} total={progress.total} />
						{progress.done}/{progress.total} done
					</Link>
				)}
			</span>
			<span className="row-actions">
				<label className="visually-hidden" htmlFor={`bet-of-${goal.id}`}>
					Bet this goal tests
				</label>
				<select
					id={`bet-of-${goal.id}`}
					className="select goal-bet"
					value={goal.betId ?? ""}
					title="Bet this goal tests"
					onChange={(event) =>
						update.mutate({ payload: { ...base, betId: event.target.value === "" ? null : event.target.value } })
					}
				>
					<option value="">No bet</option>
					{linkable.map((bet) => (
						<option key={bet.id} value={bet.id}>
							{bet.hypothesis}
						</option>
					))}
				</select>
				<button
					type="button"
					className="icon-button"
					aria-label="Archive goal"
					title="Archive goal"
					disabled={archive.isPending}
					onClick={() => archive.mutate({ payload: base })}
				>
					<Archive aria-hidden />
				</button>
			</span>
			{update.isError || archive.isError ? (
				<span className="error-text goal-error" role="alert">
					{describeError(update.error ?? archive.error)}
					{archive.error instanceof ApiRequestError && archive.error.details.rule === "goal_has_work" ? (
						<>
							{". "}
							<Link to="/v/$slug/work" params={{ slug }} hash={`goal-${goal.id}`} className="inline-link">
								Open its work
							</Link>
						</>
					) : null}
				</span>
			) : null}
		</li>
	);
}

function AddBetForm({ slug, ventureId, close }: { slug: string; ventureId: string; close: () => void }) {
	const storeBet = useBetCache(slug);
	const [fields, setFields] = useState({ hypothesis: "", action: "", killCriteria: "" });

	const create = useCommand<"bet.create", Bet>("bet.create", (response) => {
		storeBet(response.seq, response.result);

		close();
	});

	const submit = (event: FormEvent) => {
		event.preventDefault();

		create.mutate({ payload: { ventureId, ...fields } });
	};

	return (
		<form
			className="inline-form is-bet"
			onSubmit={submit}
			onKeyDown={(event) => {
				if (event.key === "Escape") close();
			}}
		>
			{(
				[
					["hypothesis", "Hypothesis", "What do you believe is true?"],
					["action", "Action", "What will you do to test it?"],
					["killCriteria", "Kill criteria", "What result makes you stop?"],
				] as const
			).map(([key, label, placeholder], index) => (
				<label key={key} className="field">
					<span className="field-label">{label}</span>
					<input
						className="input"
						value={fields[key]}
						required
						placeholder={placeholder}
						ref={index === 0 ? focusOnMount : undefined}
						onChange={(event) => setFields({ ...fields, [key]: event.target.value })}
					/>
				</label>
			))}
			{create.isError ? (
				<p className="error-text" role="alert">
					{describeError(create.error)}
				</p>
			) : null}
			<div className="form-actions">
				<button type="submit" className="button is-primary" disabled={create.isPending}>
					{create.isPending ? "Adding…" : "Add bet"}
				</button>
				<button type="button" className="button is-ghost" onClick={close}>
					Cancel
				</button>
				<span className="kbd-hint">Enter to add · Esc to cancel</span>
			</div>
		</form>
	);
}

function AddGoalForm(props: { slug: string; ventureId: string; betId: string | null; close: () => void }) {
	const client = useQueryClient();
	const [fields, setFields] = useState({ outcome: "", signal: "", horizon: "" });

	const create = useCommand<"goal.create", Goal>("goal.create", (response) => {
		updateCockpit(client, props.slug, response.seq, (cockpit) => ({
			...cockpit,
			goals: replaceById(cockpit.goals, response.result),
		}));

		props.close();
	});

	const submit = (event: FormEvent) => {
		event.preventDefault();

		create.mutate({
			payload: {
				ventureId: props.ventureId,
				betId: props.betId,
				outcome: fields.outcome,
				signal: fields.signal,
				horizon: fields.horizon === "" ? null : fields.horizon,
			},
		});
	};

	return (
		<form
			className="inline-form is-goal"
			onSubmit={submit}
			onKeyDown={(event) => {
				if (event.key === "Escape") props.close();
			}}
		>
			<input
				className="input"
				aria-label="Outcome"
				placeholder="Outcome"
				value={fields.outcome}
				required
				ref={focusOnMount}
				onChange={(event) => setFields({ ...fields, outcome: event.target.value })}
			/>
			<input
				className="input"
				aria-label="Signal"
				placeholder="Signal you'll measure"
				value={fields.signal}
				required
				onChange={(event) => setFields({ ...fields, signal: event.target.value })}
			/>
			<input
				className="input data"
				aria-label="Horizon"
				type="date"
				value={fields.horizon}
				onChange={(event) => setFields({ ...fields, horizon: event.target.value })}
			/>
			<div className="form-actions">
				<button type="submit" className="button is-primary" disabled={create.isPending}>
					Add
				</button>
				<button type="button" className="button is-ghost" onClick={props.close}>
					Cancel
				</button>
			</div>
			{create.isError ? (
				<p className="error-text" role="alert">
					{describeError(create.error)}
				</p>
			) : null}
		</form>
	);
}

function RecentActivity({ slug, ventureId, lastSeq }: { slug: string; ventureId: string; lastSeq: number }) {
	const events = useQuery({
		queryKey: [...keys.events(slug), "recent", lastSeq],
		queryFn: () => api.events(slug, null, 10),
		placeholderData: (previous) => previous,
	});

	const items = (events.data?.events ?? []).map((event) => ({ id: String(event.seq), createdAt: event.createdAt }));
	const fresh = useFreshIds(ventureId, items);

	return (
		<>
			<div className="aside-head">
				<h2 id="recent-heading">Recent activity</h2>
				<Link to="/v/$slug/activity" params={{ slug }}>
					All activity
				</Link>
			</div>
			{events.isPending ? (
				<div className="skeleton-stack" aria-busy="true">
					{[90, 70, 80].map((width) => (
						<span key={width} className="skeleton" style={{ width: `${width}%` }} />
					))}
				</div>
			) : events.isError ? (
				<p className="error-text">{describeError(events.error)}</p>
			) : (
				<ol className="feed">
					{events.data.events.map((event) => (
						<EventItem key={event.seq} event={event} fresh={fresh.has(String(event.seq))} />
					))}
				</ol>
			)}
		</>
	);
}

function CockpitSkeleton() {
	return (
		<>
			<header className="topbar">
				<span className="skeleton" style={{ width: 180 }} />
			</header>
			<div className="cockpit">
				<div className="cockpit-main skeleton-stack" aria-busy="true">
					<span className="visually-hidden">Loading venture…</span>
					{[60, 90, 85, 40, 75, 70].map((width) => (
						<span key={width} className="skeleton" style={{ width: `${width}%` }} />
					))}
				</div>
				<aside className="cockpit-aside" />
			</div>
		</>
	);
}
