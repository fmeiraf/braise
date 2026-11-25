import {
	type Bet,
	capabilityCommands,
	capabilityLabels,
	changeLabels,
	type InboxAccessRequest,
	type InboxItem,
	type InboxProposal,
	isBetRef,
	type ProposalChangeDetail,
	type ProposalDetail,
	samePayload,
} from "@braise/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Check, Inbox as InboxIcon, Pencil, X } from "lucide-react";
import { type CSSProperties, type FormEvent, useState } from "react";
import { ApiRequestError } from "./api.ts";
import { describeError } from "./errors.ts";
import { DiffField } from "./history.tsx";
import { PageError } from "./holding.tsx";
import { capabilityPhrases, plural } from "./labels.ts";
import { keys, queries, refreshVenture } from "./live.ts";
import { ringColor } from "./rings.tsx";
import { actorName } from "./thread-timeline.ts";
import { ago, formatDate, formatDateTime } from "./time.ts";
import { useCommand } from "./use-command.ts";

type FieldKind = "text" | "date" | "bet" | "status" | "flag";

interface FieldSpec {
	key: string;
	label: string;
	kind: FieldKind;
}

const text = (key: string, label: string) => ({ key, label, kind: "text" }) satisfies FieldSpec;

const fieldsByCommand: Record<ProposalChangeDetail["command"], FieldSpec[]> = {
	"strategy.revise": [
		text("why", "Why"),
		text("what", "What"),
		text("diagnosis", "Diagnosis"),
		text("guidingPolicy", "Guiding policy"),
	],
	"bet.create": [text("hypothesis", "Hypothesis"), text("action", "Action"), text("killCriteria", "Kill criteria")],
	"bet.update": [text("hypothesis", "Hypothesis"), text("action", "Action"), text("killCriteria", "Kill criteria")],
	"bet.set_status": [
		{ key: "status", label: "Settle as", kind: "status" },
		{ key: "archiveGoals", label: "Its goals", kind: "flag" },
	],
	"goal.create": [
		text("outcome", "Outcome"),
		text("signal", "Signal"),
		{ key: "horizon", label: "Horizon", kind: "date" },
		{ key: "betId", label: "Tests", kind: "bet" },
	],
	"goal.update": [
		text("outcome", "Outcome"),
		text("signal", "Signal"),
		{ key: "horizon", label: "Horizon", kind: "date" },
		{ key: "betId", label: "Tests", kind: "bet" },
	],
};

const partialCommands = new Set(["bet.update", "goal.update"]);

const settleNames: Record<string, string> = { won: "Won", lost: "Lost", killed: "Killed" };

type Payload = Record<string, unknown>;

interface ChangeState {
	included: boolean;
	editing: boolean;
	draft: Payload;
}

function visibleFields(change: { command: ProposalChangeDetail["command"]; payload: Payload }) {
	const fields = fieldsByCommand[change.command];

	return partialCommands.has(change.command)
		? fields.filter((field) => change.payload[field.key] !== undefined)
		: fields;
}

function betLabel(value: unknown, detail: ProposalDetail) {
	if (value === null || value === undefined) return "No bet";

	if (isBetRef(value)) {
		const hypothesis = detail.proposal.changes[value.ref]?.payload.hypothesis;

		return `The new bet above${typeof hypothesis === "string" ? `: ${hypothesis}` : ""}`;
	}

	return detail.bets.find((bet) => bet.id === value)?.hypothesis ?? "A bet that no longer exists";
}

function display(field: FieldSpec, value: unknown, detail: ProposalDetail) {
	switch (field.kind) {
		case "bet":
			return betLabel(value, detail);
		case "date":
			return typeof value === "string" && value !== "" ? formatDate(value) : "No horizon";
		case "status":
			return typeof value === "string" ? (settleNames[value] ?? value) : "";
		case "flag":
			return value === true ? "Archive them too" : "Keep them";
		default:
			return typeof value === "string" ? value : "";
	}
}

function currentDisplay(field: FieldSpec, current: Payload | null, detail: ProposalDetail) {
	if (current === null) return null;

	if (field.kind === "flag") return null;

	if (field.kind === "status") {
		return current.status === "open" ? "Open" : (settleNames[String(current.status)] ?? null);
	}

	return display(field, current[field.key], detail);
}

export function InboxPage() {
	const inbox = useQuery(queries.inbox());
	const search = useSearch({ from: "/inbox" });

	if (inbox.isPending) return <InboxSkeleton />;

	if (inbox.isError) return <PageError error={inbox.error} retry={() => void inbox.refetch()} />;

	const { pending, decided } = inbox.data;
	const selectedId = search.access ?? search.proposal ?? pending[0]?.id ?? null;
	const selected = [...pending, ...decided].find((item) => item.id === selectedId);

	return (
		<>
			<header className="topbar">
				<span className="crumb-current">Inbox</span>
				{pending.length === 0 ? null : <span className="muted num">{pending.length} waiting</span>}
			</header>

			<div className="threads-layout">
				<nav className="thread-list inbox-list" aria-label="Inbox">
					{pending.length === 0 ? (
						<p className="thread-list-note muted">
							Nothing needs you. Agents' proposals and access requests land here.
						</p>
					) : (
						<ul>
							{pending.map((item) => (
								<li key={item.id}>
									<InboxRow item={item} selected={item.id === selectedId} />
								</li>
							))}
						</ul>
					)}
					{decided.length === 0 ? null : (
						<>
							<h2 className="inbox-group">Decided</h2>
							<ul>
								{decided.map((item) => (
									<li key={item.id}>
										<InboxRow item={item} selected={item.id === selectedId} />
									</li>
								))}
							</ul>
						</>
					)}
				</nav>

				{selectedId === null ? (
					<div className="inbox-empty">
						<InboxIcon aria-hidden />
						<p>
							When an agent proposes a change to a strategy, a bet or a goal, or asks for access it doesn't have,
							you decide here. Nothing changes until you approve.
						</p>
					</div>
				) : selected?.kind === "access_request" ? (
					<AccessReview key={`${selected.id}:${selected.status}`} item={selected} />
				) : search.access === undefined ? (
					<Review key={selectedId} proposalId={selectedId} />
				) : (
					<div className="review">
						<p className="inbox-note muted">This access request is no longer in the inbox.</p>
					</div>
				)}
			</div>
		</>
	);
}

function InboxRow({ item, selected }: { item: InboxItem; selected: boolean }) {
	return item.kind === "proposal" ? (
		<ProposalRow item={item} selected={selected} />
	) : (
		<AccessRow item={item} selected={selected} />
	);
}

function accessTitle(item: InboxAccessRequest) {
	return `${item.agent.name} asks for ${capabilityLabels[item.capability]}`;
}

function AccessRow({ item, selected }: { item: InboxAccessRequest; selected: boolean }) {
	const now = Date.now();
	const decided = item.status !== "pending";
	const at = item.decidedAt ?? item.createdAt;

	return (
		<Link
			to="/inbox"
			search={{ access: item.id }}
			className={["thread-row inbox-row", selected ? "is-selected" : "", decided ? "is-decided" : ""].join(" ")}
			aria-current={selected ? "page" : undefined}
			style={item.venture === null ? undefined : ({ "--ring": ringColor(item.venture.id) } as CSSProperties)}
		>
			<span className={`inbox-mark is-access is-${item.status}`} aria-hidden />
			<span className="thread-row-main">
				<span className="thread-row-top">
					<span className="thread-row-title">{accessTitle(item)}</span>
					<time className="thread-row-time" dateTime={at} title={formatDateTime(at)}>
						{ago(at, now)}
					</time>
				</span>
				<span className="thread-row-snippet">
					<span className="inbox-venture">{item.venture?.name ?? "Holding"}</span> · {item.summary}
					{decided ? ` · ${item.status === "approved" ? "granted" : "denied"}` : ""}
				</span>
				{item.attempts > 1 ? (
					<span className="thread-row-links">
						<span className="tag num">Tried {item.attempts}×</span>
					</span>
				) : null}
			</span>
		</Link>
	);
}

function ProposalRow({ item, selected }: { item: InboxProposal; selected: boolean }) {
	const now = Date.now();
	const decided = item.status !== "pending";

	return (
		<Link
			to="/inbox"
			search={{ proposal: item.id }}
			className={["thread-row inbox-row", selected ? "is-selected" : "", decided ? "is-decided" : ""].join(" ")}
			aria-current={selected ? "page" : undefined}
			style={{ "--ring": ringColor(item.venture.id) } as CSSProperties}
		>
			<span className={`inbox-mark is-${item.status}`} aria-hidden />
			<span className="thread-row-main">
				<span className="thread-row-top">
					<span className="thread-row-title">{item.title}</span>
					<time
						className="thread-row-time"
						dateTime={item.decidedAt ?? item.createdAt}
						title={formatDateTime(item.decidedAt ?? item.createdAt)}
					>
						{ago(item.decidedAt ?? item.createdAt, now)}
					</time>
				</span>
				<span className="thread-row-snippet">
					<span className="inbox-venture">{item.venture.name}</span> · {plural(item.changeCount, "change")}
					{decided ? ` · ${item.status}` : ""}
				</span>
				{item.staleCount > 0 ? (
					<span className="thread-row-links">
						<span className="tag is-stale">Stale</span>
					</span>
				) : null}
			</span>
		</Link>
	);
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
		(state, index) =>
			state.included &&
			isBetRef(state.draft.betId) &&
			states[state.draft.betId.ref]?.included === false &&
			index > state.draft.betId.ref,
	);
}

function Review({ proposalId }: { proposalId: string }) {
	const proposal = useQuery(queries.proposal(proposalId));

	if (proposal.isPending) {
		return (
			<div className="review skeleton-stack inbox-loading" aria-busy="true">
				<span className="visually-hidden">Loading proposal…</span>
				{[50, 80, 90, 70].map((width) => (
					<span key={width} className="skeleton" style={{ width: `${width}%` }} />
				))}
			</div>
		);
	}

	if (proposal.isError) {
		return (
			<div className="review">
				<p className="error-text inbox-note" role="alert">
					{describeError(proposal.error)}
				</p>
			</div>
		);
	}

	return <ReviewBody key={proposal.data.proposal.status} detail={proposal.data} />;
}

function ReviewBody({ detail }: { detail: ProposalDetail }) {
	const { proposal, venture, thread } = detail;
	const client = useQueryClient();
	const navigate = useNavigate();
	const [states, setStates] = useState(() => initialState(detail));
	const [reason, setReason] = useState(proposal.reason);
	const [note, setNote] = useState("");
	const pending = proposal.status === "pending";
	const now = Date.now();

	const settle = (seq: number) => {
		void navigate({ to: "/inbox", search: { proposal: proposal.id }, replace: true });

		void refreshVenture(client, venture, seq);

		void client.invalidateQueries({ queryKey: keys.inbox });

		void client.invalidateQueries({ queryKey: keys.proposal(proposal.id) });

		void client.invalidateQueries({ queryKey: keys.thread(thread.id) });
	};

	const approve = useCommand("proposal.approve", (response) => {
		settle(response.seq);

		reject.reset();
	});

	const reject = useCommand("proposal.reject", (response) => {
		settle(response.seq);

		approve.reset();
	});

	const update = (index: number, change: Partial<ChangeState>) =>
		setStates((current) => current.map((state, at) => (at === index ? { ...state, ...change } : state)));

	const kept = states.filter((state) => state.included).length;
	const stale = detail.changes.filter((change, index) => change.stale !== null && states[index]?.included === true);
	const refDropped = droppedRefs(states);
	const busy = approve.isPending || reject.isPending;

	const blocked =
		stale.length > 0
			? `Part of this proposal is out of date. Reject it and ask ${actorName(proposal.createdBy)} for a fresh one.`
			: kept === 0
				? "Include at least one change, or reject the proposal."
				: refDropped
					? "A new goal tests a new bet you left out. Include the bet or leave out the goal."
					: reason.trim() === ""
						? "Give a reason; it is recorded with the change."
						: null;

	const submitApprove = (event: FormEvent) => {
		event.preventDefault();

		if (blocked !== null) return;

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
	const threadSearch = { thread: thread.id };

	return (
		<div className="review" style={{ "--ring": ringColor(venture.id) } as CSSProperties}>
			<div className="review-scroll">
				<header className="review-head">
					<p className="review-venture">
						<span className="ring-dot" aria-hidden />
						<Link to="/v/$slug" params={{ slug: venture.slug }}>
							{venture.name}
						</Link>
					</p>
					<h1 className="review-title">{proposal.title}</h1>
					<p className="review-meta">
						{actorName(proposal.createdBy)} proposed this in{" "}
						{thread.ventureSlug === null ? (
							<Link to="/threads" search={threadSearch}>
								{thread.title}
							</Link>
						) : (
							<Link to="/v/$slug/threads" params={{ slug: thread.ventureSlug }} search={threadSearch}>
								{thread.title}
							</Link>
						)}{" "}
						·{" "}
						<time dateTime={proposal.createdAt} title={formatDateTime(proposal.createdAt)}>
							{ago(proposal.createdAt, now)}
						</time>
					</p>
					<p className="review-reason">{proposal.reason}</p>
				</header>

				{pending ? null : <Decision detail={detail} />}

				<ol className="changes">
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
				</ol>
			</div>

			{pending ? (
				<form className="decision-bar" onSubmit={submitApprove}>
					<div className="decision-fields">
						<label className="field">
							<span className="field-label">Reason</span>
							<input
								className="input"
								value={reason}
								onChange={(event) => setReason(event.target.value)}
								aria-invalid={reason.trim() === "" ? true : undefined}
							/>
						</label>
						<label className="field">
							<span className="field-label">Note for {actorName(proposal.createdBy)}</span>
							<input
								className="input"
								value={note}
								placeholder="Optional, shown in the thread"
								onChange={(event) => setNote(event.target.value)}
							/>
						</label>
					</div>
					<div className="decision-actions">
						<output className={error === null ? "decision-hint" : "decision-hint error-text"}>
							{error !== null ? approvalError(error) : blocked}
						</output>
						<button type="button" className="button" disabled={busy} onClick={submitReject}>
							<X aria-hidden />
							Reject
						</button>
						<button type="submit" className="button is-primary" disabled={busy || blocked !== null}>
							<Check aria-hidden />
							{kept === detail.changes.length ? "Approve" : `Approve ${plural(kept, "change")}`}
						</button>
					</div>
				</form>
			) : null}
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
	return key.endsWith("Id") || key === "link" || key === "changes";
}

function AccessReview({ item }: { item: InboxAccessRequest }) {
	const client = useQueryClient();
	const [note, setNote] = useState("");
	const pending = item.status === "pending";
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
	});

	const deny = useCommand("access.deny", () => {
		settle();

		approve.reset();
	});

	const busy = approve.isPending || deny.isPending;
	const error = approve.error ?? deny.error;
	const trimmed = note.trim() === "" ? undefined : note.trim();
	const threadSearch = { thread: item.thread.id };
	const fields = Object.entries(item.payload).filter(([key]) => key !== "ventureId");

	return (
		<div
			className="review"
			style={item.venture === null ? undefined : ({ "--ring": ringColor(item.venture.id) } as CSSProperties)}
		>
			<div className="review-scroll">
				<header className="review-head">
					<p className="review-venture">
						{item.venture === null ? (
							<span>Holding</span>
						) : (
							<>
								<span className="ring-dot" aria-hidden />
								<Link to="/v/$slug" params={{ slug: item.venture.slug }}>
									{item.venture.name}
								</Link>
							</>
						)}
					</p>
					<h1 className="review-title">{accessTitle(item)}</h1>
					<p className="review-meta">
						Refused in{" "}
						{item.thread.ventureSlug === null ? (
							<Link to="/threads" search={threadSearch}>
								{item.thread.title}
							</Link>
						) : (
							<Link to="/v/$slug/threads" params={{ slug: item.thread.ventureSlug }} search={threadSearch}>
								{item.thread.title}
							</Link>
						)}{" "}
						·{" "}
						<time dateTime={item.createdAt} title={formatDateTime(item.createdAt)}>
							{ago(item.createdAt, now)}
						</time>
						{item.attempts > 1 ? <> · tried {plural(item.attempts, "time")}</> : null}
					</p>
				</header>

				{pending ? null : (
					<p className={`decision-line is-${item.status}`}>
						<span className={`inbox-mark is-access is-${item.status}`} aria-hidden />
						<span>
							{item.status === "approved" ? `You granted ${label}` : `You denied ${label}`}
							{item.decidedAt === null ? null : (
								<>
									{" "}
									<time dateTime={item.decidedAt} title={formatDateTime(item.decidedAt)}>
										{ago(item.decidedAt, now)}
									</time>
								</>
							)}
							{item.note === null ? null : <> · “{item.note}”</>}
						</span>
					</p>
				)}

				<section className="access-section" aria-labelledby="access-tried">
					<h2 id="access-tried">What it tried</h2>
					<p className="access-summary">{item.summary.charAt(0).toUpperCase() + item.summary.slice(1)}</p>
					{fields.length === 0 ? null : (
						<dl className="access-payload">
							{fields.map(([key, value]) => (
								<div key={key}>
									<dt>{attemptLabels[key] ?? key}</dt>
									{item.references[key] === undefined ? (
										<dd className={isIdField(key) ? "num" : undefined}>{attemptValue(value)}</dd>
									) : (
										<dd title={attemptValue(value)}>{item.references[key]}</dd>
									)}
								</div>
							))}
						</dl>
					)}
				</section>

				<section className="access-section" aria-labelledby="access-grant">
					<h2 id="access-grant">
						{item.status === "pending"
							? "What approving grants"
							: item.status === "approved"
								? "What you granted"
								: "What it asked for"}
					</h2>
					<p className="access-summary">
						{item.status === "denied" ? (
							<>
								To let {item.agent.name} {capabilityPhrases[item.capability]}, grant it in{" "}
								<Link to="/agents">Agents</Link>.
							</>
						) : (
							<>
								{item.agent.name} may {capabilityPhrases[item.capability]} in every venture until you revoke it
								in <Link to="/agents">Agents</Link>. What it tried isn't replayed; it tries again when you ask.
							</>
						)}
					</p>
					<ul className="access-commands">
						{capabilityCommands[item.capability].map((command) => (
							<li key={command} className="access-command num">
								{command}
							</li>
						))}
					</ul>
				</section>
			</div>

			{pending ? (
				<form
					className="decision-bar"
					onSubmit={(event) => {
						event.preventDefault();

						approve.mutate({ payload: { accessRequestId: item.id, note: trimmed } });
					}}
				>
					<div className="decision-fields is-single">
						<label className="field">
							<span className="field-label">Note for {item.agent.name}</span>
							<input
								className="input"
								value={note}
								placeholder="Optional, shown in the thread"
								onChange={(event) => setNote(event.target.value)}
							/>
						</label>
					</div>
					<div className="decision-actions">
						<output className={error === null ? "decision-hint" : "decision-hint error-text"}>
							{error === null ? null : accessError(error)}
						</output>
						<button
							type="button"
							className="button"
							disabled={busy}
							onClick={() => deny.mutate({ payload: { accessRequestId: item.id, note: trimmed } })}
						>
							<X aria-hidden />
							Deny
						</button>
						<button type="submit" className="button is-primary" disabled={busy}>
							<Check aria-hidden />
							Approve
						</button>
					</div>
				</form>
			) : null}
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

function Decision({ detail }: { detail: ProposalDetail }) {
	const { proposal } = detail;
	const decidedAt = proposal.decidedAt;

	return (
		<p className={`decision-line is-${proposal.status}`}>
			<span className={`inbox-mark is-${proposal.status}`} aria-hidden />
			<span>
				{proposal.status === "approved" ? "You approved this" : "You rejected this"}
				{decidedAt === null ? null : (
					<>
						{" "}
						<time dateTime={decidedAt} title={formatDateTime(decidedAt)}>
							{ago(decidedAt, Date.now())}
						</time>
					</>
				)}
				{proposal.note === null ? null : <> · “{proposal.note}”</>}
			</span>
		</p>
	);
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
	const creates = change.command === "bet.create" || change.command === "goal.create";
	const edited = !left && !samePayload(payload, change.payload);

	const before = (field: FieldSpec) => {
		const fromCurrent = currentDisplay(field, change.current, detail);

		if (fromCurrent !== null || !edited) return fromCurrent;

		return display(field, change.payload[field.key], detail);
	};

	const labelId = `change-${index}`;

	return (
		<li
			className={["change", left ? "is-left-out" : "", change.stale === null ? "" : "is-stale"].join(" ")}
			aria-labelledby={labelId}
		>
			<div className="change-head">
				<span className={creates ? "change-node is-new" : "change-node"} aria-hidden />
				<h2 id={labelId}>{changeLabels[change.command]}</h2>
				{change.stale === null ? null : <span className="tag is-stale">Stale · {change.stale}</span>}
				{left ? <span className="tag">{pending ? "Left out" : "Not applied"}</span> : null}
				{edited ? (
					<span className="tag">
						{creates ? `Edited · diff against ${actorName(detail.proposal.createdBy)}’s version` : "Edited"}
					</span>
				) : null}
				{pending ? (
					<div className="change-actions">
						<label className="change-include">
							<input
								type="checkbox"
								checked={state.included}
								onChange={(event) => update({ included: event.target.checked })}
							/>
							Include
						</label>
						<button
							type="button"
							className={state.editing ? "button is-small is-ghost is-on" : "button is-small is-ghost"}
							aria-pressed={state.editing}
							disabled={!state.included}
							onClick={() => update({ editing: !state.editing })}
						>
							<Pencil aria-hidden />
							{state.editing ? "Done" : "Edit"}
						</button>
					</div>
				) : null}
			</div>

			{pending && state.editing && state.included ? (
				<div className="change-edit">
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
							label={field.label}
							before={before(field)}
							after={display(field, payload[field.key], detail)}
						/>
					))}
				</dl>
			)}
		</li>
	);
}

function betOptions(detail: ProposalDetail, index: number) {
	const created = detail.proposal.changes
		.map((change, at) => ({ change, at }))
		.filter(({ change, at }) => change.command === "bet.create" && at < index)
		.map(({ change, at }) => ({
			value: `ref:${at}`,
			label: `New: ${typeof change.payload.hypothesis === "string" ? change.payload.hypothesis : "bet above"}`,
		}));

	const live = detail.bets
		.filter((bet: Pick<Bet, "status">) => bet.status === "open")
		.map((bet) => ({ value: `bet:${bet.id}`, label: bet.hypothesis }));

	return [{ value: "none", label: "No bet" }, ...created, ...live];
}

function encodeBet(value: unknown) {
	if (isBetRef(value)) return `ref:${value.ref}`;

	return typeof value === "string" ? `bet:${value}` : "none";
}

function decodeBet(value: string) {
	if (value === "none") return null;

	if (value.startsWith("ref:")) return { ref: Number(value.slice(4)) };

	return value.slice(4);
}

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
						className="input"
						value={typeof value === "string" ? value : ""}
						onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
					/>
				);
			case "bet":
				return (
					<select
						id={id}
						className="select"
						value={encodeBet(value)}
						onChange={(event) => onChange(decodeBet(event.target.value))}
					>
						{betOptions(detail, index).map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				);
			case "status":
				return (
					<select
						id={id}
						className="select"
						value={typeof value === "string" ? value : "won"}
						onChange={(event) => onChange(event.target.value)}
					>
						{Object.entries(settleNames).map(([status, label]) => (
							<option key={status} value={status}>
								{label}
							</option>
						))}
					</select>
				);
			case "flag":
				return (
					<label className="change-include">
						<input
							id={id}
							type="checkbox"
							checked={value === true}
							onChange={(event) => onChange(event.target.checked)}
						/>
						Archive its goals too
					</label>
				);
			default:
				return (
					<textarea
						id={id}
						className="textarea"
						value={typeof value === "string" ? value : ""}
						aria-invalid={
							typeof value === "string" &&
							value.trim() === "" &&
							field.key !== "diagnosis" &&
							field.key !== "guidingPolicy"
								? true
								: undefined
						}
						onChange={(event) => onChange(event.target.value)}
					/>
				);
		}
	})();

	return (
		<div className="change-field">
			{field.kind === "flag" ? (
				<span className="field-label">{field.label}</span>
			) : (
				<label className="field-label" htmlFor={id}>
					{field.label}
				</label>
			)}
			{control}
		</div>
	);
}

function InboxSkeleton() {
	return (
		<>
			<header className="topbar">
				<span className="crumb-current">Inbox</span>
			</header>
			<div className="threads-layout">
				<div className="thread-list skeleton-stack thread-list-loading" aria-busy="true">
					<span className="visually-hidden">Loading the inbox…</span>
					{[70, 90, 60].map((width) => (
						<span key={width} className="skeleton" style={{ width: `${width}%` }} />
					))}
				</div>
				<div className="review" />
			</div>
		</>
	);
}

export function NeedsYou({ ventureId }: { ventureId: string }) {
	const inbox = useQuery(queries.inbox());
	const items = (inbox.data?.pending ?? []).filter((item) => item.venture?.id === ventureId);
	const now = Date.now();

	if (items.length === 0) return null;

	return (
		<section className="needs-you" aria-labelledby="needs-you-heading">
			<div className="aside-head">
				<h2 id="needs-you-heading">Needs you</h2>
				<Link to="/inbox">Inbox</Link>
			</div>
			<ul>
				{items.map((item) => (
					<li key={item.id}>
						{item.kind === "proposal" ? (
							<Link to="/inbox" search={{ proposal: item.id }} className="needs-you-row">
								<span className="needs-you-title">{item.title}</span>
								<span className="needs-you-meta">
									{plural(item.changeCount, "change")} · {ago(item.createdAt, now)}
									{item.staleCount > 0 ? " · stale" : ""}
								</span>
							</Link>
						) : (
							<Link to="/inbox" search={{ access: item.id }} className="needs-you-row">
								<span className="needs-you-title">{accessTitle(item)}</span>
								<span className="needs-you-meta">
									{item.summary} · {ago(item.createdAt, now)}
								</span>
							</Link>
						)}
					</li>
				))}
			</ul>
		</section>
	);
}
