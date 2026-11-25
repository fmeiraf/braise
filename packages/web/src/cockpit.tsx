import type { Bet, BetStatus, Cockpit, Goal, StrategyVersion, WorkProgress } from "@braise/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { type FormEvent, type KeyboardEvent, useState } from "react";
import { ApiRequestError, api, type SetStatusResult } from "./api.ts";
import { Editable } from "./editable.tsx";
import { describeError } from "./errors.ts";
import { EventItem } from "./feed.tsx";
import { focusOnMount } from "./focus.ts";
import { useFreshIds } from "./fresh.ts";
import { PageError } from "./holding.tsx";
import { NeedsYou } from "./inbox.tsx";
import { betNumbers, kindLabel } from "./labels.ts";
import { keys, queries, rememberVenture, updateCockpit } from "./live.ts";
import { accent, Cast, Crest, Dia, Icon, Pips, progressStatus } from "./marks.tsx";
import { Select } from "./menu.tsx";
import { Sec, Skeleton } from "./parts.tsx";
import { ago, shortDate } from "./time.ts";
import { toast } from "./toast.ts";
import { useCommand } from "./use-command.ts";
import { ThreadLink, useWorking, workingLabel } from "./working.tsx";

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

	if (cockpit.isPending) {
		return (
			<div className="page">
				<Skeleton label="Loading venture…" widths={[60, 90, 85, 40, 75, 70]} />
			</div>
		);
	}

	if (cockpit.isError) return <PageError error={cockpit.error} retry={() => void cockpit.refetch()} />;

	rememberVenture(cockpit.data.venture.id, slug, cockpit.data.venture.lastSeq);

	return <CockpitView slug={slug} cockpit={cockpit.data} />;
}

function CockpitView({ slug, cockpit }: { slug: string; cockpit: Cockpit }) {
	const { venture, strategy, bets, goals, workProgress } = cockpit;
	const freshBets = useFreshIds(venture.id, bets);
	const freshGoals = useFreshIds(venture.id, goals);
	const [adding, setAdding] = useState(false);
	const live = useWorking().find((item) => item.run.ventureSlug === slug);
	const numbers = betNumbers(bets);
	const liveBetIds = new Set(bets.map((bet) => bet.id));
	const looseGoals = goals.filter((goal) => goal.betId === null || !liveBetIds.has(goal.betId));
	const open = bets.filter((bet) => bet.status === "open");
	const settled = bets.filter((bet) => bet.status !== "open");
	const work = Object.values(workProgress);
	const done = work.reduce((sum, progress) => sum + progress.done, 0);
	const total = work.reduce((sum, progress) => sum + progress.total, 0);

	const betCard = (bet: Bet) => (
		<BetCard
			key={bet.id}
			slug={slug}
			bet={bet}
			bets={bets}
			numbers={numbers}
			goals={goals.filter((goal) => goal.betId === bet.id)}
			fresh={freshBets.has(bet.id)}
			freshGoals={freshGoals}
			progress={workProgress}
		/>
	);

	return (
		<div className="page" style={accent(slug)}>
			<header className="sheet">
				<div className="sheet-crest">
					<Crest seed={slug} size={48} live={live !== undefined} />
				</div>
				<div>
					<h1 className="h1">{venture.name}</h1>
					<div className="sheet-meta">
						<span className="cap">
							{kindLabel[venture.kind]} · strategy v{strategy.version}
						</span>
						{live === undefined ? null : (
							<ThreadLink ventureSlug={slug} threadId={live.run.threadId} className="sheet-cast">
								<Cast label={workingLabel(live)} since={live.run.startedAt ?? live.run.createdAt} />
							</ThreadLink>
						)}
					</div>
				</div>
				<div className="stats">
					<div className="stat">
						<b>{open.length}</b>
						<span className="cap">Open bets</span>
					</div>
					<div className="stat">
						<b>{goals.length}</b>
						<span className="cap">Goals</span>
					</div>
					<div className="stat">
						<b>
							{done}
							<small>/{total}</small>
						</b>
						<span className="cap">Work done</span>
					</div>
				</div>
			</header>

			<div className="cols">
				<div>
					<StrategyPanel slug={slug} ventureId={venture.id} strategy={strategy} />

					<section aria-labelledby="bets-heading">
						<Sec title="Bets" id="bets-heading" count={open.length}>
							<button type="button" className="btn ghost sm" onClick={() => setAdding(true)}>
								<Icon name="plus" />
								Add bet
							</button>
						</Sec>
						{adding ? <AddBetForm slug={slug} ventureId={venture.id} close={() => setAdding(false)} /> : null}
						{open.length === 0 && !adding ? (
							<p className="empty">
								No open bets. A bet is a hypothesis, the action that tests it, and the result that makes you
								stop.
							</p>
						) : (
							open.map(betCard)
						)}
					</section>

					<LooseGoals
						slug={slug}
						ventureId={venture.id}
						goals={looseGoals}
						bets={bets}
						numbers={numbers}
						fresh={freshGoals}
						progress={workProgress}
					/>

					{settled.length === 0 ? null : (
						<section aria-labelledby="settled-heading">
							<Sec title="Settled" id="settled-heading" count={settled.length} />
							{settled.map(betCard)}
						</section>
					)}
				</div>

				<aside>
					<NeedsYou ventureId={venture.id} />
					<RecentActivity slug={slug} ventureId={venture.id} lastSeq={venture.lastSeq} />
				</aside>
			</div>
		</div>
	);
}

function StrategyPanel({ slug, ventureId, strategy }: { slug: string; ventureId: string; strategy: StrategyVersion }) {
	const client = useQueryClient();
	const [open, setOpen] = useState(true);
	const [draft, setDraft] = useState<Record<KernelKey, string> | null>(null);
	const [reason, setReason] = useState("");
	const nextVersion = strategy.version + 1;

	const revise = useCommand<"strategy.revise", StrategyVersion>("strategy.revise", (response) => {
		updateCockpit(client, slug, response.seq, (cockpit) => ({ ...cockpit, strategy: response.result }));

		setDraft(null);

		setReason("");

		toast(
			<>
				Strategy saved as <b>v{response.result.version}</b>
			</>,
		);
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

		setReason("");

		revise.reset();
	};

	const unchanged = draft !== null && kernelFields.every(({ key }) => draft[key].trim() === strategy[key].trim());

	const submit = (event: FormEvent) => {
		event.preventDefault();

		if (draft === null || unchanged || reason.trim() === "") return;

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
		<section aria-labelledby="strategy-heading">
			<Sec title="Strategy" id="strategy-heading">
				<span className="cap sec-note">
					v{strategy.version} · {strategy.version === 1 ? "created" : "revised"} {ago(revisedAt, Date.now())}
				</span>
				<Link to="/v/$slug/history" params={{ slug }} className="btn ghost sm">
					<Icon name="history" />
					History
				</Link>
				{draft === null ? (
					<button type="button" className="btn ghost sm" onClick={startEditing}>
						<Icon name="edit" />
						Revise
					</button>
				) : null}
				<button
					type="button"
					className="ib"
					aria-expanded={open}
					aria-controls="strategy-body"
					aria-label={open ? "Collapse strategy" : "Expand strategy"}
					data-tip={open ? "Collapse strategy" : "Expand strategy"}
					onClick={() => setOpen(!open)}
				>
					<Icon name={open ? "chevd" : "chevr"} />
				</button>
			</Sec>

			{open && draft === null ? (
				<div className="strat" id="strategy-body">
					<dl>
						{kernelFields.map(({ key, label, prompt }) => (
							<div key={key} className="strat-row">
								<dt>{label}</dt>
								{strategy[key] === "" ? (
									<dd className="unset">
										<button type="button" className="editable unset" onClick={startEditing}>
											{prompt}
										</button>
									</dd>
								) : (
									<dd>{strategy[key]}</dd>
								)}
							</div>
						))}
					</dl>
				</div>
			) : null}

			{draft === null ? null : (
				<form className="strat" id="strategy-body" onSubmit={submit} onKeyDown={onKeyDown}>
					<dl>
						{kernelFields.map(({ key, label, prompt }, index) => (
							<div key={key} className="strat-row">
								<dt>
									<label htmlFor={`strategy-${key}`}>{label}</label>
								</dt>
								<dd>
									<textarea
										id={`strategy-${key}`}
										className="ta"
										rows={2}
										value={draft[key]}
										placeholder={prompt}
										required={key === "why" || key === "what"}
										ref={index === 0 ? focusOnMount : undefined}
										onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
									/>
								</dd>
							</div>
						))}
					</dl>
					{revise.isError ? (
						<p className="err strat-err" role="alert">
							{describeError(revise.error)}
						</p>
					) : null}
					<div className="strat-foot">
						<input
							className="inp"
							value={reason}
							required
							maxLength={2000}
							aria-label="Why are you revising it?"
							placeholder={
								unchanged
									? "Change a field to save a new version"
									: `Why are you revising it? Kept with v${nextVersion} in the strategy history`
							}
							onChange={(event) => setReason(event.target.value)}
						/>
						<button type="button" className="btn ghost" onClick={cancel}>
							Cancel<span className="kbd">esc</span>
						</button>
						<button
							type="submit"
							className="btn pri"
							disabled={unchanged || revise.isPending || reason.trim() === ""}
						>
							{revise.isPending ? "Saving…" : `Save as v${nextVersion}`}
						</button>
					</div>
				</form>
			)}
		</section>
	);
}

function useBetCache(slug: string) {
	const client = useQueryClient();

	return (seq: number, bet: Bet) =>
		updateCockpit(client, slug, seq, (cockpit) => ({ ...cockpit, bets: replaceById(cockpit.bets, bet) }));
}

const betStatuses = ["open", "won", "lost", "killed"] as const satisfies readonly BetStatus[];

function BetCard(props: {
	slug: string;
	bet: Bet;
	bets: Bet[];
	numbers: Map<string, string>;
	goals: Goal[];
	fresh: boolean;
	freshGoals: ReadonlySet<string>;
	progress: Record<string, WorkProgress>;
}) {
	const { slug, bet, goals } = props;
	const client = useQueryClient();
	const storeBet = useBetCache(slug);
	const settled = bet.status !== "open";
	const [expanded, setExpanded] = useState(!settled);
	const [settling, setSettling] = useState<Exclude<BetStatus, "open"> | null>(null);
	const number = props.numbers.get(bet.id) ?? "B";

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

		setExpanded(false);

		toast(
			<>
				Bet {number} marked <b>{response.result.bet.status}</b>
			</>,
		);
	});

	const saveField = (field: "hypothesis" | "action" | "killCriteria") => (value: string) =>
		update.mutateAsync({ payload: { ventureId: bet.ventureId, betId: bet.id, [field]: value } });

	const settle = (archiveGoals: boolean) => {
		if (settling === null) return;

		setStatus.mutate({ payload: { ventureId: bet.ventureId, betId: bet.id, status: settling, archiveGoals } });
	};

	const className = ["bet", settled ? "settled" : "", props.fresh ? "fresh" : ""].filter(Boolean).join(" ");
	const goalWord = goals.length === 1 ? "goal" : "goals";

	return (
		<article className={className}>
			<header className="bet-h">
				<span className="bet-n">{number}</span>
				<h3>
					<Editable label="hypothesis" value={bet.hypothesis} required multiline save={saveField("hypothesis")} />
				</h3>
				{settled ? (
					<span className="sel pill is-static">
						<Dia status={bet.status} />
						<span>{bet.status}</span>
					</span>
				) : (
					<Select
						className="sel pill"
						title="Settle this bet"
						value={settling ?? bet.status}
						options={betStatuses.map((status) => ({
							value: status,
							label: status,
							glyph: <Dia status={status} />,
						}))}
						onChange={(status) => setSettling(status === "open" ? null : status)}
					/>
				)}
				{goals.length === 0 ? (
					<button
						type="button"
						className="ib"
						aria-label="Archive bet"
						data-tip="Archive bet"
						disabled={archive.isPending}
						onClick={() => archive.mutate({ payload: { ventureId: bet.ventureId, betId: bet.id } })}
					>
						<Icon name="archive" />
					</button>
				) : null}
				{settled ? (
					<button
						type="button"
						className="ib"
						aria-expanded={expanded}
						aria-label={expanded ? "Collapse bet" : "Expand bet"}
						data-tip={expanded ? "Collapse" : `Expand · ${goals.length} ${goalWord}`}
						onClick={() => setExpanded(!expanded)}
					>
						<Icon name={expanded ? "chevd" : "chevr"} />
					</button>
				) : null}
			</header>

			{archive.isError ? (
				<p className="err bet-err" role="alert">
					{describeError(archive.error)}
				</p>
			) : null}

			{expanded ? (
				<>
					<dl className="bet-kv">
						<dt className="cap">Action</dt>
						<dd>
							<Editable label="action" value={bet.action} required multiline save={saveField("action")} />
						</dd>
						<dt className="cap">Kill criteria</dt>
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
							<legend className="vh">Mark bet {settling}</legend>
							<p>
								Mark this bet <b>{settling}</b>.{" "}
								{goals.length > 0
									? `Archive its ${goals.length === 1 ? "goal" : `${goals.length} goals`} too?`
									: null}
							</p>
							{goals.length > 0 ? (
								<>
									<button
										type="button"
										className="btn pri sm"
										disabled={setStatus.isPending}
										onClick={() => settle(true)}
									>
										Mark {settling} and archive {goalWord}
									</button>
									<button
										type="button"
										className="btn sm"
										disabled={setStatus.isPending}
										onClick={() => settle(false)}
									>
										Keep {goalWord}
									</button>
								</>
							) : (
								<button
									type="button"
									className="btn pri sm"
									disabled={setStatus.isPending}
									onClick={() => settle(false)}
								>
									Mark {settling}
								</button>
							)}
							<button type="button" className="btn ghost sm" onClick={() => setSettling(null)}>
								Cancel
							</button>
							{setStatus.isError ? (
								<p className="err" role="alert">
									{describeError(setStatus.error)}
								</p>
							) : null}
						</fieldset>
					)}

					<GoalList
						slug={slug}
						ventureId={bet.ventureId}
						betId={bet.id}
						goals={goals}
						bets={props.bets}
						numbers={props.numbers}
						fresh={props.freshGoals}
						progress={props.progress}
					/>
				</>
			) : null}
		</article>
	);
}

interface GoalListProps {
	slug: string;
	ventureId: string;
	betId: string | null;
	goals: Goal[];
	bets: Bet[];
	numbers: Map<string, string>;
	fresh: ReadonlySet<string>;
	progress: Record<string, WorkProgress>;
}

function GoalList(props: GoalListProps) {
	const [adding, setAdding] = useState(false);
	const loose = props.betId === null;

	return (
		<>
			<ul className="goals">
				{props.goals.map((goal) => (
					<GoalRow
						key={goal.id}
						slug={props.slug}
						goal={goal}
						bets={props.bets}
						numbers={props.numbers}
						loose={loose}
						fresh={props.fresh.has(goal.id)}
						progress={props.progress[goal.id]}
					/>
				))}
				{props.goals.length === 0 && !adding ? (
					<li className="goals-none">{loose ? "Every goal tests a bet." : "No goals test this bet yet."}</li>
				) : null}
			</ul>
			{adding ? (
				<AddGoalForm
					slug={props.slug}
					ventureId={props.ventureId}
					betId={props.betId}
					close={() => setAdding(false)}
				/>
			) : (
				<button type="button" className="addline" onClick={() => setAdding(true)}>
					<Icon name="plus" />
					{loose ? "Add a goal that tests no bet" : "Add goal"}
				</button>
			)}
		</>
	);
}

function LooseGoals(props: Omit<GoalListProps, "betId">) {
	return (
		<section aria-labelledby="loose-heading">
			<Sec title="Not tied to a bet" id="loose-heading" count={props.goals.length} />
			<article className="bet">
				<GoalList {...props} betId={null} />
			</article>
		</section>
	);
}

function GoalRow(props: {
	slug: string;
	goal: Goal;
	bets: Bet[];
	numbers: Map<string, string>;
	loose: boolean;
	fresh: boolean;
	progress: WorkProgress | undefined;
}) {
	const { slug, goal, bets, progress } = props;
	const client = useQueryClient();
	const now = Date.now();

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
	const className = ["goal", props.loose ? "loose" : "", props.fresh ? "fresh" : ""].filter(Boolean).join(" ");

	return (
		<li className={className}>
			<Dia status={progressStatus(progress)} />
			<div className="goal-t">
				<b>
					<Editable
						label="outcome"
						value={goal.outcome}
						required
						save={(value) => update.mutateAsync({ payload: { ...base, outcome: value } })}
					/>
				</b>
				<span>
					<Editable
						label="signal"
						value={goal.signal}
						required
						save={(value) => update.mutateAsync({ payload: { ...base, signal: value } })}
					/>
				</span>
			</div>
			<span className="tag plain">
				<Editable
					label="horizon"
					type="date"
					value={goal.horizon ?? ""}
					placeholder="No horizon"
					display={goal.horizon === null ? undefined : shortDate(goal.horizon, now)}
					save={(value) => update.mutateAsync({ payload: { ...base, horizon: value === "" ? null : value } })}
				/>
			</span>
			<Link
				to="/v/$slug/work"
				params={{ slug }}
				hash={`goal-${goal.id}`}
				className="goal-p mono"
				data-tip="Open this goal’s work"
			>
				{progress === undefined || progress.total === 0 ? (
					"No work"
				) : (
					<>
						<Pips done={progress.done} total={progress.total} />
						{progress.done}/{progress.total}
					</>
				)}
			</Link>
			<Select
				className="sel pill"
				title="Bet this goal tests"
				value={goal.betId ?? ""}
				options={[
					{ value: "", label: "No bet" },
					...linkable.map((bet) => ({
						value: bet.id,
						label: props.numbers.get(bet.id) ?? "Bet",
						sub: bet.hypothesis,
					})),
				]}
				onChange={(betId) => update.mutate({ payload: { ...base, betId: betId === "" ? null : betId } })}
			/>
			<button
				type="button"
				className="ib goal-x"
				aria-label="Archive goal"
				data-tip="Archive goal"
				disabled={archive.isPending}
				onClick={() => archive.mutate({ payload: base })}
			>
				<Icon name="archive" />
			</button>
			{update.isError || archive.isError ? (
				<span className="err goal-err" role="alert">
					{describeError(update.error ?? archive.error)}
					{archive.error instanceof ApiRequestError && archive.error.details.rule === "goal_has_work" ? (
						<>
							{". "}
							<Link to="/v/$slug/work" params={{ slug }} hash={`goal-${goal.id}`}>
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
			className="bet add-bet"
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
					<span className="cap">{label}</span>
					<input
						className="inp"
						value={fields[key]}
						required
						placeholder={placeholder}
						ref={index === 0 ? focusOnMount : undefined}
						onChange={(event) => setFields({ ...fields, [key]: event.target.value })}
					/>
				</label>
			))}
			{create.isError ? (
				<p className="err" role="alert">
					{describeError(create.error)}
				</p>
			) : null}
			<div className="form-acts">
				<button type="submit" className="btn pri" disabled={create.isPending}>
					{create.isPending ? "Adding…" : "Add bet"}
				</button>
				<button type="button" className="btn ghost" onClick={close}>
					Cancel<span className="kbd">esc</span>
				</button>
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
			className="add-goal"
			onSubmit={submit}
			onKeyDown={(event) => {
				if (event.key === "Escape") props.close();
			}}
		>
			<input
				className="inp"
				aria-label="Outcome"
				placeholder="Outcome"
				value={fields.outcome}
				required
				ref={focusOnMount}
				onChange={(event) => setFields({ ...fields, outcome: event.target.value })}
			/>
			<input
				className="inp"
				aria-label="Signal"
				placeholder="Signal you'll measure"
				value={fields.signal}
				required
				onChange={(event) => setFields({ ...fields, signal: event.target.value })}
			/>
			<input
				className="inp"
				aria-label="Horizon"
				type="date"
				value={fields.horizon}
				onChange={(event) => setFields({ ...fields, horizon: event.target.value })}
			/>
			<button type="submit" className="btn pri" disabled={create.isPending}>
				Add
			</button>
			<button type="button" className="btn ghost" onClick={props.close}>
				Cancel
			</button>
			{create.isError ? (
				<p className="err" role="alert">
					{describeError(create.error)}
				</p>
			) : null}
		</form>
	);
}

function RecentActivity({ slug, ventureId, lastSeq }: { slug: string; ventureId: string; lastSeq: number }) {
	const events = useQuery({
		queryKey: [...keys.events(slug), "recent", lastSeq],
		queryFn: () => api.events(slug, null, 6),
		placeholderData: (previous) => previous,
	});

	const items = (events.data?.events ?? []).map((event) => ({ id: String(event.seq), createdAt: event.createdAt }));
	const fresh = useFreshIds(ventureId, items);

	return (
		<section aria-labelledby="recent-heading">
			<Sec title="Recent activity" id="recent-heading">
				<Link to="/v/$slug/activity" params={{ slug }} className="btn ghost sm">
					All
				</Link>
			</Sec>
			{events.isPending ? (
				<Skeleton label="Loading activity…" widths={[90, 70, 80]} />
			) : events.isError ? (
				<p className="err">{describeError(events.error)}</p>
			) : (
				<ol className="log">
					{events.data.events.map((event) => (
						<EventItem key={event.seq} event={event} slug={slug} fresh={fresh.has(String(event.seq))} />
					))}
				</ol>
			)}
		</section>
	);
}
