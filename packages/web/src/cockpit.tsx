import { type Cockpit, type StrategyVersion, strategyMarkKey } from "@braise/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { type FormEvent, type KeyboardEvent, type ReactNode, useState } from "react";
import { api } from "./api.ts";
import { DraftControls, DraftMarks, DraftMeta, useDraftItem, useStatusDrafted, Was } from "./draft.tsx";
import { describeError } from "./errors.ts";
import { EventItem } from "./feed.tsx";
import { focusOnMount } from "./focus.ts";
import { useFreshIds } from "./fresh.ts";
import { PageError } from "./holding.tsx";
import { NeedsYou } from "./inbox.tsx";
import { betNumbers, kindLabel } from "./labels.ts";
import { keys, queries, rememberVenture, updateCockpit } from "./live.ts";
import { timeLeft } from "./loop-view.ts";
import { AppIcon, accent, Cast, Icon, type IconName } from "./marks.tsx";
import { AddObjectiveForm, ClosedObjectives, Hunches, Learnings, ObjectiveCard } from "./objectives.tsx";
import { Hero, Sec, Skeleton } from "./parts.tsx";
import { Integrations } from "./repos.tsx";
import { ago } from "./time.ts";
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

function useCockpitPage(slug: string, render: (cockpit: Cockpit) => ReactNode) {
	const cockpit = useQuery(queries.board(slug));

	if (cockpit.isPending) {
		return (
			<div className="page">
				<Skeleton label="Loading venture…" widths={[60, 90, 85, 40, 75, 70]} />
			</div>
		);
	}

	if (cockpit.isError) return <PageError error={cockpit.error} retry={() => void cockpit.refetch()} />;

	rememberVenture(cockpit.data.venture.id, slug, cockpit.data.venture.lastSeq);

	return <DraftMarks draft={cockpit.data.draft}>{render(cockpit.data)}</DraftMarks>;
}

export function CockpitPage() {
	const { slug } = useParams({ from: "/v/$slug/" });

	return useCockpitPage(slug, (cockpit) => <OverviewView slug={slug} cockpit={cockpit} />);
}

export function StrategyPage() {
	const { slug } = useParams({ from: "/v/$slug/strategy" });

	return useCockpitPage(slug, (cockpit) => <StrategyView slug={slug} cockpit={cockpit} />);
}

function Topic({
	to,
	slug,
	icon,
	title,
	summary,
	figure,
	note,
}: {
	to: "/v/$slug/strategy" | "/v/$slug/work" | "/v/$slug/threads";
	slug: string;
	icon: IconName;
	title: string;
	summary: ReactNode;
	figure: ReactNode;
	note?: string;
}) {
	return (
		<li>
			<Link to={to} params={{ slug }} className="topic">
				<Icon name={icon} />
				<span className="topic-main">
					<b>{title}</b>
					<span className="topic-sum">{summary}</span>
				</span>
				<span className="topic-fig">
					<strong>{figure}</strong>
					{note === undefined ? null : <span className="cap">{note}</span>}
				</span>
				<Icon name="chevr" className="topic-go" />
			</Link>
		</li>
	);
}

function Topics({ slug, cockpit }: { slug: string; cockpit: Cockpit }) {
	const now = Date.now();
	const { venture, strategy, objectives, bets, workProgress } = cockpit;
	const threads = useQuery(queries.threads({ ventureId: venture.id }));

	const active = objectives.filter((objective) => objective.status === "active");
	const climbing = active.filter((objective) => objective.kind !== "build").length;

	const nextDue = active
		.map((objective) => objective.byDate)
		.filter((date) => date !== null)
		.toSorted()[0];

	const openBets = bets
		.filter((bet) => bet.status === "open")
		.toSorted((a, b) => a.deadline.localeCompare(b.deadline));

	const nextBet = openBets[0];
	const work = Object.values(workProgress);
	const done = work.reduce((sum, progress) => sum + progress.done, 0);
	const total = work.reduce((sum, progress) => sum + progress.total, 0);
	const threadRows = (threads.data?.threads ?? []).filter((thread) => thread.archivedAt === null);
	const running = threadRows.filter((thread) => thread.activeRun?.status === "running").length;
	const lastThread = threadRows[0];
	const revisedAt = strategy.activatedAt ?? strategy.createdAt;

	return (
		<ul className="topics">
			<Topic
				to="/v/$slug/strategy"
				slug={slug}
				icon="strategy"
				title="Strategy"
				summary={strategy.why}
				figure={`v${strategy.version}`}
				note={`revised ${ago(revisedAt, now)}`}
			/>
			<Topic
				to="/v/$slug/strategy"
				slug={slug}
				icon="target"
				title="Objectives"
				summary={
					active.length === 0
						? "None yet: say where this venture is going"
						: `${climbing} to climb, ${active.length - climbing} to build${nextDue === undefined ? "" : ` · next due ${timeLeft(nextDue, now).replace(" left", "")}`}`
				}
				figure={active.length}
				note="active"
			/>
			<Topic
				to="/v/$slug/strategy"
				slug={slug}
				icon="bolt"
				title="Bets"
				summary={nextBet === undefined ? "No open bet" : nextBet.action}
				figure={openBets.length}
				note={nextBet === undefined ? "open" : timeLeft(nextBet.deadline, now)}
			/>
			<Topic
				to="/v/$slug/work"
				slug={slug}
				icon="work"
				title="Work"
				summary={
					total === 0 ? (
						"Nothing planned yet"
					) : (
						<span className="topic-bar" aria-hidden="true">
							<i style={{ width: `${Math.round((done / total) * 100)}%` }} />
						</span>
					)
				}
				figure={
					<>
						{done}
						<small>/{total}</small>
					</>
				}
				note="done"
			/>
			<Topic
				to="/v/$slug/threads"
				slug={slug}
				icon="threads"
				title="Threads"
				summary={lastThread === undefined ? "No conversation yet" : `Latest: ${lastThread.title}`}
				figure={threadRows.length}
				note={running > 0 ? `${running} running now` : "threads"}
			/>
		</ul>
	);
}

function VentureSheet({ slug, cockpit }: { slug: string; cockpit: Cockpit }) {
	const { venture, strategy } = cockpit;
	const drafted = useDraftItem(venture.id);
	const live = useWorking().find((item) => item.run.ventureSlug === slug);

	return (
		<header className="sheet home-sheet">
			<div className="sheet-crest">
				<AppIcon slug={slug} size={56} />
			</div>
			<div className={["sheet-id", drafted.className].filter(Boolean).join(" ")} {...drafted.attrs}>
				<h1 className="h1">
					{venture.name}
					<Was item={drafted} field="name" />
				</h1>
				<div className="sheet-meta">
					<span className="cap">
						{drafted.mark === null ? null : (
							<>
								<DraftMeta item={drafted} />
								{" · "}
							</>
						)}
						{kindLabel[venture.kind]}
						{drafted.mark?.fields.kind === undefined ? null : (
							<span className="d-was-inline">
								{kindLabel[drafted.mark.fields.kind as Cockpit["venture"]["kind"]]}
							</span>
						)}{" "}
						· strategy v{strategy.version}
					</span>
					<DraftControls changes={drafted.changes} />
					{live === undefined ? null : (
						<ThreadLink ventureSlug={slug} threadId={live.run.threadId} className="sheet-cast">
							<Cast label={workingLabel(live)} since={live.run.startedAt ?? live.run.createdAt} />
						</ThreadLink>
					)}
				</div>
			</div>
			<Link
				to="/v/$slug/settings"
				params={{ slug }}
				className="btn ghost sm"
				data-tip="Settings|GitHub, repos and archiving"
			>
				<Icon name="settings" />
				<span className="sheet-set">Settings</span>
			</Link>
		</header>
	);
}

function OverviewView({ slug, cockpit }: { slug: string; cockpit: Cockpit }) {
	return (
		<div className="page" style={accent(slug)}>
			<VentureSheet slug={slug} cockpit={cockpit} />
			<Integrations slug={slug} />
			<div className="cols home">
				<section aria-labelledby="topics-heading">
					<Sec title="At a glance" id="topics-heading" />
					<Topics slug={slug} cockpit={cockpit} />
				</section>
				<aside className="ov-aside">
					<NeedsYou ventureId={cockpit.venture.id} />
					<RecentActivity slug={slug} ventureId={cockpit.venture.id} lastSeq={cockpit.venture.lastSeq} />
				</aside>
			</div>
		</div>
	);
}

function StrategyView({ slug, cockpit }: { slug: string; cockpit: Cockpit }) {
	const { venture, strategy, objectives, assumptions, bets } = cockpit;
	const freshObjectives = useFreshIds(venture.id, objectives);
	const freshAssumptions = useFreshIds(venture.id, assumptions);
	const freshBets = useFreshIds(venture.id, bets);
	const fresh = new Set([...freshObjectives, ...freshAssumptions, ...freshBets]);
	const [adding, setAdding] = useState(false);
	const numbers = betNumbers(bets);
	const ref = { id: venture.id, slug };
	const closing = useStatusDrafted();
	const open = objectives.filter((objective) => objective.status === "active" || closing(objective.id));

	const active = [
		...open.filter((objective) => objective.kind !== "build"),
		...open.filter((objective) => objective.kind === "build"),
	];

	const closed = objectives.filter((objective) => objective.status !== "active" && !closing(objective.id));

	return (
		<div className="page" style={accent(slug)}>
			<Hero cap={venture.name} title="Strategy" />
			<div className="cols">
				<div>
					<StrategyPanel slug={slug} ventureId={venture.id} strategy={strategy} startOpen={active.length === 0} />

					<section aria-labelledby="objectives-heading">
						<Sec title="Objectives" id="objectives-heading" count={active.length}>
							<button type="button" className="btn ghost sm" onClick={() => setAdding(true)}>
								<Icon name="plus" />
								Add objective
							</button>
						</Sec>
						{adding ? <AddObjectiveForm venture={ref} close={() => setAdding(false)} /> : null}
						{active.length === 0 && !adding ? (
							<p className="empty">
								No objective yet. An objective says where this venture is going: something to build, a question
								to answer, or a number to move.
							</p>
						) : (
							active.map((objective) => (
								<ObjectiveCard
									key={objective.id}
									venture={ref}
									objective={objective}
									cockpit={cockpit}
									numbers={numbers}
									fresh={fresh}
								/>
							))
						)}
					</section>

					<ClosedObjectives objectives={closed} />
				</div>

				<aside>
					<Hunches venture={ref} cockpit={cockpit} />
					<Learnings cockpit={cockpit} />
				</aside>
			</div>
		</div>
	);
}

function StrategyPanel({
	slug,
	ventureId,
	strategy,
	startOpen,
}: {
	slug: string;
	ventureId: string;
	strategy: StrategyVersion;
	startOpen: boolean;
}) {
	const client = useQueryClient();
	const drafted = useDraftItem(strategyMarkKey);
	const [open, setOpen] = useState(startOpen || drafted.mark !== null);
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
		<section
			aria-labelledby="strategy-heading"
			className={["kernel", drafted.className].filter(Boolean).join(" ")}
			{...drafted.attrs}
		>
			<Sec title="Kernel" id="strategy-heading">
				{drafted.mark === null ? null : (
					<span className="cap">
						<DraftMeta item={drafted} />
					</span>
				)}
				<DraftControls changes={drafted.changes} />
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
									<dd>
										{strategy[key]}
										<Was item={drafted} field={key} />
									</dd>
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

function RecentActivity({ slug, ventureId, lastSeq }: { slug: string; ventureId: string; lastSeq: number }) {
	const events = useQuery({
		queryKey: [...keys.events(slug), "recent", lastSeq],
		queryFn: () => api.events(slug, null, 5),
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
