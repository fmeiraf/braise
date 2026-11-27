import {
	assumptionStatuses,
	betMethods,
	capabilityCommands,
	capabilityLabels,
	changeLabels,
	type InboxAccessRequest,
	type InboxDraft,
	type InboxItem,
	type InboxNeedsInput,
	impacts,
	isRef,
	methodLabels,
	type ProposalChangeDetail,
	type ProposalDetail,
	refFields,
	samePayload,
	workFunctions,
} from "@braise/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiRequestError } from "./api.ts";
import { DraftControls, DraftRoomProvider, stepOf, useDraftRoom } from "./draft.tsx";
import { describeError } from "./errors.ts";
import { DiffField } from "./history.tsx";
import { PageError } from "./holding.tsx";
import { capabilityPhrases, plural } from "./labels.ts";
import { keys, queries, refreshVenture } from "./live.ts";
import { AppIcon, accent, Dia, Icon, Need } from "./marks.tsx";
import { Select } from "./menu.tsx";
import { Sec, Skeleton } from "./parts.tsx";
import { actorName } from "./thread-timeline.ts";
import { ago, formatDate, formatDateTime } from "./time.ts";
import { toast } from "./toast.ts";
import { useCommand } from "./use-command.ts";
import { ThreadLink } from "./working.tsx";

type FieldKind = "text" | "date" | "number" | "choice" | "objective" | "assumption" | "lines" | "flag";

interface FieldSpec {
	key: string;
	label: string;
	kind: FieldKind;
	choices?: Record<string, string>;
}

const text = (key: string, label: string) => ({ key, label, kind: "text" }) satisfies FieldSpec;

const number = (key: string, label: string) => ({ key, label, kind: "number" }) satisfies FieldSpec;

const choice = (key: string, label: string, choices: Record<string, string>) =>
	({ key, label, kind: "choice", choices }) satisfies FieldSpec;

const capitalised = (values: readonly string[]) =>
	Object.fromEntries(values.map((value) => [value, value.charAt(0).toUpperCase() + value.slice(1)]));

const functionChoices = capitalised(workFunctions);

const objectiveFields = [
	choice("kind", "Kind", { metric: "Metric", learning: "Learning", build: "Build" }),
	text("statement", "Objective"),
	text("measure", "Measure"),
	text("unit", "Unit"),
	number("baseline", "Baseline"),
	number("target", "Target"),
	text("decision", "Decision it changes"),
	text("doneRule", "Answered when"),
	{ key: "doneList", label: "Done means", kind: "lines" },
	{ key: "byDate", label: "By", kind: "date" },
	text("guardrails", "Guardrails"),
	text("budget", "Budget"),
] satisfies FieldSpec[];

const assumptionFields = [
	text("statement", "Assumption"),
	{ key: "objectiveId", label: "Under", kind: "objective" },
	choice("impact", "Impact if false", capitalised(impacts)),
	number("confidence", "Confidence"),
	choice("function", "Function", functionChoices),
	choice("status", "Where it stands", capitalised(assumptionStatuses)),
] satisfies FieldSpec[];

const betFields = [
	{ key: "assumptionId", label: "Tests", kind: "assumption" },
	text("action", "Action"),
	text("signal", "Signal"),
	text("unit", "Unit"),
	number("baseline", "Today"),
	number("passAt", "Pass at"),
	number("failAt", "Fail past"),
	choice("method", "Method", Object.fromEntries(betMethods.map((method) => [method, methodLabels[method]]))),
	choice("function", "Led by", functionChoices),
	text("budget", "Budget"),
	{ key: "deadline", label: "Deadline", kind: "date" },
] satisfies FieldSpec[];

const goalFields = [
	text("outcome", "Outcome"),
	text("signal", "Signal"),
	{ key: "horizon", label: "Horizon", kind: "date" },
] satisfies FieldSpec[];

const fieldsByCommand: Record<ProposalChangeDetail["command"], FieldSpec[]> = {
	"strategy.revise": [
		text("why", "Why"),
		text("what", "What"),
		text("diagnosis", "Diagnosis"),
		text("guidingPolicy", "Guiding policy"),
	],
	"objective.create": objectiveFields,
	"objective.update": objectiveFields,
	"objective.close": [choice("status", "Close as", { active: "Active", met: "Met", dropped: "Dropped" })],
	"assumption.create": assumptionFields,
	"assumption.update": assumptionFields,
	"bet.create": betFields,
	"bet.update": betFields,
	"bet.close": [
		choice("result", "Result", { pass: "Passed", fail: "Failed", inconclusive: "Inconclusive" }),
		choice("cause", "What was wrong", { idea: "The idea", execution: "The execution" }),
		text("statement", "Learning"),
		number("confidenceTo", "Confidence after"),
	],
	"bet.set_status": [
		choice("status", "Settle as", { open: "Open", won: "Won", lost: "Lost", killed: "Killed" }),
		{ key: "archiveGoals", label: "Its goals", kind: "flag" },
	],
	"goal.create": goalFields,
	"goal.update": goalFields,
};

const subjectKeys = new Set(["objectiveId", "assumptionId", "betId", "goalId", "ventureId"]);

const legacyLabels: Record<string, string> = { hypothesis: "Hypothesis", killCriteria: "Kill criteria" };

type Payload = Record<string, unknown>;

interface ChangeState {
	included: boolean;
	editing: boolean;
	draft: Payload;
}

function visibleFields(change: { command: ProposalChangeDetail["command"]; payload: Payload }) {
	const known = fieldsByCommand[change.command];

	if (change.command === "strategy.revise") return known;

	const present = known.filter((field) => change.payload[field.key] !== undefined && change.payload[field.key] !== "");
	const named = new Set(known.map((field) => field.key));

	const extra = Object.keys(change.payload)
		.filter((key) => !named.has(key) && !subjectKeys.has(key) && typeof change.payload[key] === "string")
		.map((key) => text(key, legacyLabels[key] ?? key));

	return [...present, ...extra];
}

function refLabel(value: { ref: number }, detail: ProposalDetail, noun: string) {
	const label = detail.proposal.changes[value.ref]?.payload.statement;

	return `The new ${noun} above${typeof label === "string" ? `: ${label}` : ""}`;
}

function objectiveLabel(value: unknown, detail: ProposalDetail) {
	if (value === null || value === undefined) return "Worth testing later (no objective yet)";

	if (isRef(value)) return refLabel(value, detail, "objective");

	return (
		detail.objectives.find((objective) => objective.id === value)?.statement ?? "An objective that no longer exists"
	);
}

function assumptionLabel(value: unknown, detail: ProposalDetail) {
	if (isRef(value)) return refLabel(value, detail, "assumption");

	return (
		detail.assumptions.find((assumption) => assumption.id === value)?.statement ??
		"An assumption that no longer exists"
	);
}

function lineOf(item: unknown) {
	if (typeof item === "string") return item;

	return typeof item === "object" && item !== null && "text" in item ? String(item.text) : "";
}

function linesOf(value: unknown) {
	return Array.isArray(value) ? value.map(lineOf) : [];
}

function display(field: FieldSpec, value: unknown, detail: ProposalDetail) {
	switch (field.kind) {
		case "objective":
			return objectiveLabel(value, detail);
		case "assumption":
			return assumptionLabel(value, detail);
		case "date":
			return typeof value === "string" && value !== "" ? formatDate(value) : "No date";
		case "choice":
			return typeof value === "string" ? (field.choices?.[value] ?? value) : "";
		case "number":
			return typeof value === "number" ? String(value) : "None";
		case "lines":
			return linesOf(value).join("\n");
		case "flag":
			return value === true ? "Archive them too" : "Keep them";
		default:
			return typeof value === "string" ? value : "";
	}
}

function currentDisplay(field: FieldSpec, current: Payload | null, detail: ProposalDetail) {
	if (current === null || current[field.key] === undefined || field.kind === "flag") return null;

	return display(field, current[field.key], detail);
}

function subjectOf(change: ProposalChangeDetail, detail: ProposalDetail) {
	const { payload } = change;

	if (change.command === "objective.update" || change.command === "objective.close") {
		return detail.objectives.find((objective) => objective.id === payload.objectiveId)?.statement ?? null;
	}

	if (change.command === "assumption.update") {
		return detail.assumptions.find((assumption) => assumption.id === payload.assumptionId)?.statement ?? null;
	}

	if (change.command === "bet.update" || change.command === "bet.close") {
		return detail.bets.find((bet) => bet.id === payload.betId)?.action ?? null;
	}

	return null;
}

export function InboxPage() {
	const inbox = useQuery(queries.inbox());
	const search = useSearch({ from: "/inbox" });

	if (inbox.isPending) {
		return (
			<div className="split">
				<div className="list">
					<div className="bar">
						<h1>Inbox</h1>
					</div>
					<Skeleton label="Loading the inbox…" widths={[70, 90, 60]} />
				</div>
				<div className="pane" />
			</div>
		);
	}

	if (inbox.isError) return <PageError error={inbox.error} retry={() => void inbox.refetch()} />;

	const { pending, decided } = inbox.data;

	const selectedId =
		search.question ?? search.access ?? search.draft ?? search.proposal ?? pending[0]?.id ?? decided[0]?.id ?? null;

	const selected = [...pending, ...decided].find((item) => item.id === selectedId);

	return (
		<div className="split">
			<nav className="list" aria-label="Inbox">
				<div className="bar">
					<h1>Inbox</h1>
					<span className="cnt">{pending.length}</span>
				</div>
				{pending.length === 0 ? (
					<p className="empty list-note">
						Nothing needs you. Agents' proposals, access requests and questions land here.
					</p>
				) : (
					pending.map((item) => <InboxRow key={item.id} item={item} selected={item.id === selectedId} />)
				)}
				{decided.length === 0 ? null : (
					<>
						<div className="group">
							<h2 className="cap">Decided</h2>
						</div>
						{decided.map((item) => (
							<InboxRow key={item.id} item={item} selected={item.id === selectedId} />
						))}
					</>
				)}
			</nav>

			<section className="pane" aria-label="Review">
				{selectedId === null ? (
					<div className="rev">
						<p className="lede">
							When an agent proposes a change to a strategy, an objective, an assumption or a bet, or asks for
							access it doesn't have, you decide here. Nothing changes until you approve.
						</p>
					</div>
				) : selected?.kind === "access_request" ? (
					<AccessReview key={`${selected.id}:${selected.status}`} item={selected} />
				) : selected?.kind === "needs_input" ? (
					<QuestionReview key={`${selected.id}:${selected.status}`} item={selected} />
				) : selected?.kind === "draft" ? (
					<DraftReview key={`${selected.id}:${selected.status}`} item={selected} />
				) : search.access === undefined && search.question === undefined && search.draft === undefined ? (
					<Review key={selectedId} proposalId={selectedId} />
				) : (
					<div className="rev">
						<p className="lede">This item is no longer in the inbox.</p>
					</div>
				)}
			</section>
		</div>
	);
}

function accessTitle(item: InboxAccessRequest) {
	return `${item.agent.name} asks for ${capabilityLabels[item.capability].toLowerCase()}`;
}

function questionTitle(item: InboxNeedsInput) {
	return `${item.agent.name} asks: ${item.question}`;
}

function draftTitle(item: InboxDraft) {
	return item.status === "drafting"
		? `Draft · ${plural(item.changeCount, "change")}`
		: `Draft · ${item.kept} kept, ${item.dropped} dropped`;
}

function itemTitle(item: InboxItem) {
	if (item.kind === "proposal") return item.title;

	if (item.kind === "draft") return draftTitle(item);

	return item.kind === "needs_input" ? questionTitle(item) : accessTitle(item);
}

function itemSearch(item: InboxItem) {
	if (item.kind === "proposal") return { proposal: item.id };

	if (item.kind === "draft") return { draft: item.id };

	return item.kind === "needs_input" ? { question: item.id } : { access: item.id };
}

function itemMeta(item: InboxItem) {
	if (item.kind === "proposal") return `${plural(item.changeCount, "change")} · ${actorName(item.createdBy)}`;

	if (item.kind === "draft") return item.kept === 0 ? "Operator" : `Operator · ${item.kept} kept so far`;

	if (item.kind === "needs_input")
		return item.space === null ? item.thread.title : `${item.space.title} · ${item.thread.title}`;

	return `Access request${item.attempts > 1 ? ` · tried ${item.attempts}×` : ""}`;
}

function isDecided(item: InboxItem) {
	return item.status !== "pending" && item.status !== "drafting";
}

function InboxRow({ item, selected }: { item: InboxItem; selected: boolean }) {
	const now = Date.now();
	const decided = isDecided(item);
	const at = item.decidedAt ?? item.createdAt;
	const proposal = item.kind === "proposal" ? item : null;

	return (
		<Link
			to="/inbox"
			search={itemSearch(item)}
			className={decided ? "lr dim" : "lr"}
			aria-current={selected ? "page" : undefined}
			style={accent(item.venture?.slug)}
		>
			<span className="lr-h">
				<span className="lr-mark">
					{decided ? (
						<Dia status={item.status === "approved" || item.status === "answered" ? "won" : "lost"} />
					) : (
						<Need />
					)}
				</span>
				<b>{itemTitle(item)}</b>
				<time className="mono" dateTime={at} title={formatDateTime(at)}>
					{ago(at, now)}
				</time>
			</span>
			<span className="lr-s">
				<span>
					{item.venture?.name ?? "Holding"} · {itemMeta(item)}
					{decided ? ` · ${decisionWord(item)}` : null}
					{proposal !== null && !decided && proposal.staleCount > 0 ? (
						<>
							{" · "}
							<em>Stale</em>
						</>
					) : null}
				</span>
			</span>
		</Link>
	);
}

function decisionWord(item: InboxItem) {
	if (item.kind === "proposal") return item.status;

	if (item.kind === "draft") return item.kept === 0 ? "dropped" : "kept";

	if (item.kind === "needs_input") return "answered";

	return item.status === "approved" ? "granted" : "denied";
}

function initialState(detail: ProposalDetail) {
	const states: ChangeState[] = detail.changes.map((change) => ({
		included: true,
		editing: false,
		draft: { ...change.payload },
	}));

	return states;
}

function droppedRefs(states: ChangeState[]) {
	return states.some(
		(state) =>
			state.included &&
			refFields.some((field) => {
				const value = state.draft[field];

				return isRef(value) && states[value.ref]?.included === false;
			}),
	);
}

function Review({ proposalId }: { proposalId: string }) {
	const proposal = useQuery(queries.proposal(proposalId));

	if (proposal.isPending) {
		return (
			<div className="rev">
				<Skeleton label="Loading proposal…" widths={[50, 80, 90, 70]} />
			</div>
		);
	}

	if (proposal.isError) {
		return (
			<div className="rev">
				<p className="err" role="alert">
					{describeError(proposal.error)}
				</p>
			</div>
		);
	}

	return <ReviewBody key={proposal.data.proposal.status} detail={proposal.data} />;
}

function useApproveShortcut(enabled: boolean) {
	const form = useRef<HTMLFormElement>(null);

	useEffect(() => {
		if (!enabled) return;

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;

			event.preventDefault();

			form.current?.requestSubmit();
		};

		document.addEventListener("keydown", onKeyDown);

		return () => document.removeEventListener("keydown", onKeyDown);
	}, [enabled]);

	return form;
}

function ReviewBody({ detail }: { detail: ProposalDetail }) {
	const { proposal, venture, thread } = detail;
	const client = useQueryClient();
	const navigate = useNavigate();
	const [states, setStates] = useState(() => initialState(detail));
	const [reason, setReason] = useState(proposal.reason);
	const [note, setNote] = useState("");
	const pending = proposal.status === "pending";
	const form = useApproveShortcut(pending);
	const now = Date.now();
	const author = actorName(proposal.createdBy);

	const settle = (seq: number) => {
		void navigate({ to: "/inbox", search: { proposal: proposal.id }, replace: true });

		void refreshVenture(client, venture, seq);

		void client.invalidateQueries({ queryKey: keys.inbox });

		void client.invalidateQueries({ queryKey: keys.proposal(proposal.id) });

		void client.invalidateQueries({ queryKey: keys.thread(thread.id) });
	};

	const update = (index: number, change: Partial<ChangeState>) =>
		setStates((current) => current.map((state, at) => (at === index ? { ...state, ...change } : state)));

	const kept = states.filter((state) => state.included).length;

	const approve = useCommand("proposal.approve", (response) => {
		settle(response.seq);

		reject.reset();

		toast(
			<>
				Approved · <b>{plural(kept, "change")} applied</b> to {venture.name}
			</>,
		);
	});

	const reject = useCommand("proposal.reject", (response) => {
		settle(response.seq);

		approve.reset();

		toast("Proposal rejected", "x");
	});

	const stale = detail.changes.filter((change, index) => change.stale !== null && states[index]?.included === true);
	const refDropped = droppedRefs(states);
	const busy = approve.isPending || reject.isPending;

	const blocked =
		stale.length > 0
			? `Part of this proposal is out of date. Leave the stale change out, or reject it and ask ${author} for a fresh one.`
			: kept === 0
				? "Include at least one change, or reject the proposal."
				: refDropped
					? "A change builds on a new item you left out. Include that item or leave out the change."
					: reason.trim() === ""
						? "Give a reason; it is recorded with the change."
						: null;

	const submitApprove = (event: FormEvent) => {
		event.preventDefault();

		if (blocked !== null || busy) return;

		approve.mutate({
			payload: {
				ventureId: venture.id,
				proposalId: proposal.id,
				changes: states.map((state) => (state.included ? { payload: state.draft } : null)),
				note: note.trim() === "" ? undefined : note.trim(),
			},
			reason: reason.trim(),
		});
	};

	const submitReject = () =>
		reject.mutate({
			payload: {
				ventureId: venture.id,
				proposalId: proposal.id,
				note: note.trim() === "" ? undefined : note.trim(),
			},
		});

	const error = approve.error ?? reject.error;
	const anyStale = detail.changes.some((change) => change.stale !== null);

	return (
		<div className="rev" style={accent(venture.slug)}>
			<div className="rev-kind">
				<AppIcon slug={venture.slug} size={16} />
				<span>
					<Link to="/v/$slug" params={{ slug: venture.slug }}>
						{venture.name}
					</Link>
				</span>
				<i>·</i>
				<span>Proposal</span>
				{pending && anyStale ? (
					<>
						<i>·</i>
						<em>Out of date</em>
					</>
				) : null}
			</div>
			<h2>{proposal.title}</h2>
			<p className="rev-meta">
				{author} proposed this{" "}
				<time dateTime={proposal.createdAt} title={formatDateTime(proposal.createdAt)}>
					{ago(proposal.createdAt, now)}
				</time>{" "}
				in{" "}
				<ThreadLink ventureSlug={thread.ventureSlug} threadId={thread.id}>
					{thread.title}
				</ThreadLink>
			</p>
			<p className="rev-why">{proposal.reason}</p>

			<Sec title="Changes" count={detail.changes.length} />
			{detail.changes.map((change, index) => (
				<Change
					key={`${change.command}:${index}`}
					index={index}
					change={change}
					detail={detail}
					state={states[index] ?? { included: true, editing: false, draft: change.payload }}
					applied={pending ? undefined : (proposal.applied?.[index] ?? null)}
					update={(next) => update(index, next)}
				/>
			))}

			{pending ? (
				<form className="verdict" ref={form} onSubmit={submitApprove}>
					{error !== null || blocked !== null ? (
						<output className={error === null ? "verdict-hint" : "verdict-hint err"}>
							{error === null ? blocked : approvalError(error)}
						</output>
					) : null}
					<label className="verdict-reason">
						<span className="cap">Reason</span>
						<input
							className="inp"
							value={reason}
							placeholder="Recorded with the change"
							onChange={(event) => setReason(event.target.value)}
							aria-invalid={reason.trim() === "" ? true : undefined}
						/>
					</label>
					<input
						className="inp"
						value={note}
						aria-label={`Note for ${author}`}
						placeholder={`Note for ${author}. Optional, shown in the thread`}
						onChange={(event) => setNote(event.target.value)}
					/>
					<button type="button" className="btn ghost danger" disabled={busy} onClick={submitReject}>
						Reject
					</button>
					<button type="submit" className="btn pri" disabled={busy || blocked !== null}>
						{kept === detail.changes.length ? "Approve" : `Approve ${plural(kept, "change")}`}
						<span className="kbd">⌘↵</span>
					</button>
				</form>
			) : (
				<Decided
					approved={proposal.status === "approved"}
					text={proposal.status === "approved" ? "You approved this" : "You rejected this"}
					at={proposal.decidedAt}
					note={proposal.note}
				/>
			)}
		</div>
	);
}

function Decided({
	approved,
	text,
	at,
	note,
}: {
	approved: boolean;
	text: string;
	at: string | null;
	note: string | null;
}) {
	return (
		<div className="decided">
			<Dia status={approved ? "won" : "lost"} />
			<b>{text}</b>
			<span className="mute">
				{at === null ? null : (
					<time dateTime={at} title={formatDateTime(at)}>
						{ago(at, Date.now())}
					</time>
				)}
				{note === null ? null : ` · “${note}”`}
			</span>
		</div>
	);
}

const attemptLabels: Record<string, string> = {
	title: "Title",
	description: "Description",
	function: "Function",
	priority: "Priority",
	status: "Status",
	index: "Position",
	goalId: "Goal",
	home: "Lives under",
	value: "Value",
	takenOn: "Taken on",
	source: "Source",
	subject: "For",
	objectiveId: "Objective",
	itemId: "Done-list line",
	done: "Done",
	parentId: "Parent",
	workItemId: "Work item",
	threadId: "Thread",
	link: "Link",
	reason: "Reason",
	changes: "Changes",
};

function attemptValue(value: unknown) {
	if (typeof value === "string") return value;

	if (typeof value === "number" || typeof value === "boolean") return String(value);

	return JSON.stringify(value);
}

function isIdField(key: string) {
	return key.endsWith("Id") || ["link", "changes", "subject", "home"].includes(key);
}

function QuestionReview({ item }: { item: InboxNeedsInput }) {
	const client = useQueryClient();
	const navigate = useNavigate();
	const [answer, setAnswer] = useState("");
	const now = Date.now();
	const answerId = `answer-${item.id}`;

	const send = useCommand<"thread.post", unknown>("thread.post", () => {
		void client.invalidateQueries({ queryKey: keys.inbox });

		void client.invalidateQueries({ queryKey: keys.thread(item.thread.id) });

		void client.invalidateQueries({ queryKey: keys.spaces });

		toast(
			<>
				Answered <b>{item.agent.name}</b>; the thread carries on
			</>,
			"threads",
		);

		void navigate({ to: "/inbox", search: {} });
	});

	const submit = (event: FormEvent) => {
		event.preventDefault();

		if (answer.trim() === "" || send.isPending) return;

		send.mutate({ payload: { threadId: item.thread.id, body: answer.trim(), links: [] } });
	};

	return (
		<div className="rev" style={accent(item.venture?.slug)}>
			<div className="rev-kind">
				{item.venture === null ? <Icon name="holding" /> : <AppIcon slug={item.venture.slug} size={16} />}
				<span>{item.venture?.name ?? "Holding"}</span>
				<i>·</i>
				<span>{item.space === null ? "Question" : `Question in ${item.space.title}`}</span>
			</div>
			<h2>{item.agent.name} asks</h2>
			<p className="rev-meta">
				<time dateTime={item.createdAt} title={formatDateTime(item.createdAt)}>
					{ago(item.createdAt, now)}
				</time>{" "}
				in{" "}
				<ThreadLink ventureSlug={item.thread.ventureSlug} threadId={item.thread.id}>
					{item.thread.title}
				</ThreadLink>
			</p>
			<blockquote className="ask-q">{item.question}</blockquote>
			{item.status === "pending" ? (
				<form className="ask-f" onSubmit={submit}>
					<label htmlFor={answerId} className="cap">
						Your answer goes to the thread and starts {item.agent.name}'s next run
					</label>
					<textarea
						id={answerId}
						className="inp"
						rows={4}
						value={answer}
						placeholder={`Answer ${item.agent.name}`}
						onChange={(event) => setAnswer(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit(event);
						}}
					/>
					<div className="ask-b">
						<button type="submit" className="btn pri" disabled={answer.trim() === "" || send.isPending}>
							Send answer
						</button>
						<ThreadLink ventureSlug={item.thread.ventureSlug} threadId={item.thread.id} className="btn ghost">
							Open the thread
						</ThreadLink>
					</div>
					{send.error === null ? null : (
						<p className="err" role="alert">
							{describeError(send.error)}
						</p>
					)}
				</form>
			) : (
				<p className="decided">
					<Dia status="won" />
					Answered{" "}
					{item.decidedAt === null ? null : (
						<time dateTime={item.decidedAt} title={formatDateTime(item.decidedAt)}>
							{ago(item.decidedAt, now)}
						</time>
					)}
				</p>
			)}
		</div>
	);
}

function AccessReview({ item }: { item: InboxAccessRequest }) {
	const client = useQueryClient();
	const [note, setNote] = useState("");
	const pending = item.status === "pending";
	const form = useApproveShortcut(pending);
	const now = Date.now();
	const label = capabilityLabels[item.capability];

	const settle = () => {
		void client.invalidateQueries({ queryKey: keys.inbox });

		void client.invalidateQueries({ queryKey: keys.agents });

		void client.invalidateQueries({ queryKey: keys.thread(item.thread.id) });
	};

	const approve = useCommand("access.approve", () => {
		settle();

		deny.reset();

		toast(
			<>
				{item.agent.name} may now change <b>{label.toLowerCase()}</b>
			</>,
			"key",
		);
	});

	const deny = useCommand("access.deny", () => {
		settle();

		approve.reset();

		toast("Request denied", "x");
	});

	const busy = approve.isPending || deny.isPending;
	const error = approve.error ?? deny.error;
	const trimmed = note.trim() === "" ? undefined : note.trim();
	const fields = Object.entries(item.payload).filter(([key]) => key !== "ventureId");

	return (
		<div className="rev" style={accent(item.venture?.slug)}>
			<div className="rev-kind">
				{item.venture === null ? <Icon name="holding" /> : <AppIcon slug={item.venture.slug} size={16} />}
				<span>
					{item.venture === null ? (
						"Holding"
					) : (
						<Link to="/v/$slug" params={{ slug: item.venture.slug }}>
							{item.venture.name}
						</Link>
					)}
				</span>
				<i>·</i>
				<span>Access request</span>
			</div>
			<h2>{accessTitle(item)}</h2>
			<p className="rev-meta">
				{item.agent.name} asked{" "}
				<time dateTime={item.createdAt} title={formatDateTime(item.createdAt)}>
					{ago(item.createdAt, now)}
				</time>{" "}
				in{" "}
				<ThreadLink ventureSlug={item.thread.ventureSlug} threadId={item.thread.id}>
					{item.thread.title}
				</ThreadLink>
				{item.attempts > 1 ? `, after trying ${plural(item.attempts, "time")}` : null}
			</p>

			<Sec title="What it tried" />
			<p className="rev-tried">{item.summary.charAt(0).toUpperCase() + item.summary.slice(1)}</p>
			{fields.length === 0 ? null : (
				<dl className="tried">
					{fields.map(([key, value]) => (
						<div key={key} className="lead">
							<dt>{attemptLabels[key] ?? key}</dt>
							<i className="dots" />
							{item.references[key] === undefined ? (
								<dd className={isIdField(key) ? "is-id" : undefined}>{attemptValue(value)}</dd>
							) : (
								<dd className="is-ref" title={attemptValue(value)}>
									{item.references[key]}
								</dd>
							)}
						</div>
					))}
				</dl>
			)}

			<Sec
				title={
					item.status === "pending"
						? "What approving grants"
						: item.status === "approved"
							? "What you granted"
							: "What it asked for"
				}
			/>
			<div className={item.status === "denied" ? "grant solo" : "grant on solo"}>
				<span className="grant-k">
					<Icon name="key" />
				</span>
				<div>
					<b>{label}</b>
					<p>
						{item.status === "denied" ? (
							<>
								To let {item.agent.name} {capabilityPhrases[item.capability]}, grant it in{" "}
								<Link to="/agents">Agents</Link>.
							</>
						) : (
							<>
								{item.agent.name} may {capabilityPhrases[item.capability]}, in every venture, until you revoke
								it in <Link to="/agents">Agents</Link>. What it tried isn't replayed; it tries again when you
								ask.
							</>
						)}
					</p>
					<span className="mono cmds">{capabilityCommands[item.capability].join(" · ")}</span>
				</div>
			</div>

			{pending ? (
				<form
					className="verdict"
					ref={form}
					onSubmit={(event) => {
						event.preventDefault();

						if (!busy) approve.mutate({ payload: { accessRequestId: item.id, note: trimmed } });
					}}
				>
					{error === null ? null : <output className="verdict-hint err">{accessError(error)}</output>}
					<input
						className="inp"
						value={note}
						aria-label={`Note for ${item.agent.name}`}
						placeholder={`Note for ${item.agent.name}. Optional, shown in the thread`}
						onChange={(event) => setNote(event.target.value)}
					/>
					<button
						type="button"
						className="btn ghost danger"
						disabled={busy}
						onClick={() => deny.mutate({ payload: { accessRequestId: item.id, note: trimmed } })}
					>
						Deny
					</button>
					<button type="submit" className="btn pri" disabled={busy}>
						Grant {label.toLowerCase()}
						<span className="kbd">⌘↵</span>
					</button>
				</form>
			) : (
				<Decided
					approved={item.status === "approved"}
					text={
						item.status === "approved"
							? `You granted ${label.toLowerCase()}`
							: `You denied ${label.toLowerCase()}`
					}
					at={item.decidedAt}
					note={item.note}
				/>
			)}
		</div>
	);
}

function accessError(error: unknown) {
	if (error instanceof ApiRequestError && error.details.rule === "access_decided") {
		return "This request was already decided, maybe in another tab.";
	}

	return describeError(error);
}

function approvalError(error: unknown) {
	if (error instanceof ApiRequestError && error.details.rule === "proposal_decided") {
		return "This proposal was already decided, maybe in another tab.";
	}

	return describeError(error);
}

function Change({
	index,
	change,
	detail,
	state,
	applied,
	update,
}: {
	index: number;
	change: ProposalChangeDetail;
	detail: ProposalDetail;
	state: ChangeState;
	applied: { payload: Payload } | null | undefined;
	update: (next: Partial<ChangeState>) => void;
}) {
	const pending = applied === undefined;
	const left = pending ? !state.included : applied === null;
	const payload = pending ? state.draft : (applied?.payload ?? change.payload);
	const fields = visibleFields({ command: change.command, payload: change.payload });
	const creates = change.command.endsWith(".create");
	const subject = subjectOf(change, detail);
	const edited = !left && !samePayload(payload, change.payload);

	const before = (field: FieldSpec) => {
		const fromCurrent = currentDisplay(field, change.current, detail);

		if (fromCurrent !== null || !edited) return fromCurrent;

		return display(field, change.payload[field.key], detail);
	};

	const labelId = `change-${index}`;
	const className = ["chg", left ? "out" : "", creates ? "add" : ""].filter(Boolean).join(" ");

	return (
		<article className={className} aria-labelledby={labelId}>
			<header className="chg-h">
				<span className="n">{index + 1}</span>
				<b id={labelId}>{changeLabels[change.command]}</b>
				{subject === null ? null : <span className="chg-on">{subject}</span>}
				{change.stale === null ? null : <span className="ref bad">Stale · {change.stale}</span>}
				{edited ? (
					<span className="ref">
						{creates ? `Edited · compared with ${actorName(detail.proposal.createdBy)}’s version` : "Edited"}
					</span>
				) : null}
				<span className="grow" />
				{left ? <span className="cap">{pending ? "Left out" : "Not applied"}</span> : null}
				{pending ? (
					<span className="acts">
						<button
							type="button"
							className="btn ghost sm"
							aria-pressed={state.editing}
							disabled={!state.included}
							onClick={() => update({ editing: !state.editing })}
						>
							{state.editing ? "Done" : "Edit"}
						</button>
						<button
							type="button"
							className="btn ghost sm"
							aria-pressed={!state.included}
							onClick={() => update({ included: !state.included, editing: false })}
						>
							{state.included ? "Leave out" : "Include"}
						</button>
					</span>
				) : null}
			</header>

			{pending && state.editing && state.included ? (
				<div className="chg-edit">
					{fields.map((field) => (
						<FieldInput
							key={field.key}
							field={field}
							index={index}
							value={state.draft[field.key]}
							detail={detail}
							onChange={(value) => update({ draft: { ...state.draft, [field.key]: value } })}
						/>
					))}
				</div>
			) : (
				<dl>
					{fields.map((field) => (
						<DiffField
							key={field.key}
							className="chg-f"
							label={field.label}
							before={before(field)}
							after={display(field, payload[field.key], detail)}
						/>
					))}
				</dl>
			)}
		</article>
	);
}

function refOptions(detail: ProposalDetail, index: number, kind: "objective" | "assumption") {
	const created = detail.proposal.changes
		.map((change, at) => ({ change, at }))
		.filter(({ change, at }) => change.command === `${kind}.create` && at < index)
		.map(({ change, at }) => ({
			value: `ref:${at}`,
			label: `New: ${typeof change.payload.statement === "string" ? change.payload.statement : `${kind} above`}`,
		}));

	const existing =
		kind === "objective"
			? detail.objectives
					.filter((objective) => objective.status === "active" && objective.kind !== "build")
					.map((objective) => ({ value: `id:${objective.id}`, label: objective.statement }))
			: detail.assumptions.map((assumption) => ({ value: `id:${assumption.id}`, label: assumption.statement }));

	const none = kind === "objective" ? [{ value: "none", label: "Worth testing later (no objective yet)" }] : [];

	return [...none, ...created, ...existing];
}

function encodeRef(value: unknown) {
	if (isRef(value)) return `ref:${value.ref}`;

	return typeof value === "string" ? `id:${value}` : "none";
}

function decodeRef(value: string) {
	if (value === "none") return null;

	if (value.startsWith("ref:")) return { ref: Number(value.slice(4)) };

	return value.slice(3);
}

function relined(previous: unknown, next: string) {
	const lines = next.split("\n");

	if (!Array.isArray(previous) || previous.every((item) => typeof item === "string")) return lines;

	return lines.map((line, index) => {
		const before: unknown = previous[index];
		const id = typeof before === "object" && before !== null && "id" in before ? before.id : undefined;

		return id === undefined ? { text: line } : { id, text: line };
	});
}

const optionalText = ["diagnosis", "guidingPolicy", "guardrails", "budget", "unit"];

function FieldInput({
	field,
	index,
	value,
	detail,
	onChange,
}: {
	field: FieldSpec;
	index: number;
	value: unknown;
	detail: ProposalDetail;
	onChange: (value: unknown) => void;
}) {
	const id = `change-${index}-${field.key}`;

	const control = (() => {
		switch (field.kind) {
			case "date":
				return (
					<input
						id={id}
						type="date"
						className="inp"
						value={typeof value === "string" ? value : ""}
						onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
					/>
				);
			case "number":
				return (
					<input
						id={id}
						className="inp num"
						inputMode="decimal"
						value={typeof value === "number" || typeof value === "string" ? String(value) : ""}
						aria-invalid={typeof value === "string" ? true : undefined}
						onChange={(event) => {
							const raw = event.target.value.trim();
							const parsed = Number(raw.replace(",", "."));

							onChange(raw !== "" && Number.isFinite(parsed) ? parsed : raw);
						}}
					/>
				);
			case "objective":
			case "assumption":
				return (
					<Select
						title={field.label}
						value={encodeRef(value)}
						options={refOptions(detail, index, field.kind)}
						onChange={(next) => onChange(decodeRef(next))}
					/>
				);
			case "choice":
				return field.key === "kind" ? (
					<span>{display(field, value, detail)}</span>
				) : (
					<Select
						title={field.label}
						value={typeof value === "string" ? value : ""}
						options={Object.entries(field.choices ?? {}).map(([option, label]) => ({ value: option, label }))}
						onChange={onChange}
					/>
				);
			case "flag":
				return <span>{display(field, value, detail)}</span>;
			case "lines":
				return (
					<textarea
						id={id}
						className="ta"
						rows={3}
						value={linesOf(value).join("\n")}
						onChange={(event) => onChange(relined(value, event.target.value))}
					/>
				);
			default:
				return (
					<textarea
						id={id}
						className="ta"
						rows={2}
						value={typeof value === "string" ? value : ""}
						aria-invalid={
							typeof value === "string" && value.trim() === "" && !optionalText.includes(field.key)
								? true
								: undefined
						}
						onChange={(event) => onChange(event.target.value)}
					/>
				);
		}
	})();

	return (
		<div className="chg-f">
			{["text", "date", "number", "lines"].includes(field.kind) ? (
				<label className="cap" htmlFor={id}>
					{field.label}
				</label>
			) : (
				<span className="cap">{field.label}</span>
			)}
			<div>{control}</div>
		</div>
	);
}

export function NeedsYou({ ventureId }: { ventureId: string }) {
	const inbox = useQuery(queries.inbox());
	const items = (inbox.data?.pending ?? []).filter((item) => item.venture?.id === ventureId);
	const now = Date.now();

	return (
		<section aria-labelledby="needs-you-heading">
			<Sec title="Needs you" id="needs-you-heading" count={items.length}>
				<Link to="/inbox" className="btn ghost sm">
					Inbox
				</Link>
			</Sec>
			{items.length === 0 ? <p className="empty">Nothing needs you.</p> : null}
			{items.map((item) =>
				item.kind === "draft" ? (
					<Link key={item.id} to="/inbox" search={{ draft: item.id }} className="quest">
						<Need />
						<b>{draftTitle(item)}</b>
						<span>The operator drafted these · {ago(item.latestChangeAt, now)}</span>
					</Link>
				) : item.kind === "proposal" ? (
					<Link key={item.id} to="/inbox" search={{ proposal: item.id }} className="quest">
						<Need />
						<b>{item.title}</b>
						<span>
							{plural(item.changeCount, "change")} · {actorName(item.createdBy)} · {ago(item.createdAt, now)}
							{item.staleCount > 0 ? " · stale" : ""}
						</span>
					</Link>
				) : item.kind === "needs_input" ? (
					<Link key={item.id} to="/inbox" search={{ question: item.id }} className="quest">
						<Need />
						<b>{questionTitle(item)}</b>
						<span>
							{itemMeta(item)} · {ago(item.createdAt, now)}
						</span>
					</Link>
				) : (
					<Link key={item.id} to="/inbox" search={{ access: item.id }} className="quest">
						<Need />
						<b>{accessTitle(item)}</b>
						<span>
							Access request · {item.summary} · {ago(item.createdAt, now)}
						</span>
					</Link>
				),
			)}
		</section>
	);
}

function DraftRows() {
	const room = useDraftRoom();
	const changes = room?.draft?.changes ?? [];

	if (room === null) return null;

	return (
		<ol className="d-rev">
			{changes.map((change) => (
				<li
					key={change.id}
					className={change.stale === null && change.error === null ? "d-row" : "d-row bad"}
					data-kind={stepOf(change.command, change.payload).kind}
				>
					<span className="k">{stepOf(change.command, change.payload).label}</span>
					<span className="d-row-t">
						<b>{change.label}</b>
						<span className="cap">
							{change.stale ?? change.error ?? change.note}
							{change.editedBy === "owner" ? " · edited by you" : ""}
						</span>
					</span>
					<DraftControls changes={[change]} />
				</li>
			))}
		</ol>
	);
}

function DraftReview({ item }: { item: InboxDraft }) {
	const now = Date.now();

	return (
		<div className="rev" style={accent(item.venture.slug)}>
			<span className="rev-kind">
				<AppIcon slug={item.venture.slug} size={16} />
				{item.venture.name} · Operator draft
			</span>
			<h2>{draftTitle(item)}</h2>
			<span className="rev-meta">Latest change {ago(item.latestChangeAt, now)}</span>
			{item.status === "drafting" ? (
				<>
					<p className="lede">
						The operator drafted these on {item.venture.name}'s board. Nothing applies until you keep it; keeping
						a change also keeps what it builds on.
					</p>
					<DraftRoomProvider slug={item.venture.slug} ventureId={item.venture.id} view={null}>
						<DraftRows />
					</DraftRoomProvider>
					<p className="rev-foot">
						<Link to="/v/$slug/strategy" params={{ slug: item.venture.slug }} className="btn ghost sm">
							See them on the board
							<Icon name="chevr" />
						</Link>
					</p>
				</>
			) : (
				<p className="lede">
					This draft closed {item.decidedAt === null ? "" : ago(item.decidedAt, now)}: {item.kept} kept,{" "}
					{item.dropped} dropped.
				</p>
			)}
		</div>
	);
}
