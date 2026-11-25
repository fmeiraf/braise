import {
	type Bet,
	capabilityCommands,
	capabilityLabels,
	changeLabels,
	type InboxAccessRequest,
	type InboxItem,
	isBetRef,
	type ProposalChangeDetail,
	type ProposalDetail,
	samePayload,
} from "@braise/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiRequestError } from "./api.ts";
import { describeError } from "./errors.ts";
import { DiffField } from "./history.tsx";
import { PageError } from "./holding.tsx";
import { capabilityPhrases, plural } from "./labels.ts";
import { keys, queries, refreshVenture } from "./live.ts";
import { accent, Crest, Dia, Icon, Need } from "./marks.tsx";
import { Select } from "./menu.tsx";
import { Sec, Skeleton } from "./parts.tsx";
import { actorName } from "./thread-timeline.ts";
import { ago, formatDate, formatDateTime } from "./time.ts";
import { toast } from "./toast.ts";
import { useCommand } from "./use-command.ts";
import { ThreadLink } from "./working.tsx";

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
	const selectedId = search.access ?? search.proposal ?? pending[0]?.id ?? decided[0]?.id ?? null;
	const selected = [...pending, ...decided].find((item) => item.id === selectedId);

	return (
		<div className="split">
			<nav className="list" aria-label="Inbox">
				<div className="bar">
					<h1>Inbox</h1>
					<span className="cnt">{pending.length}</span>
				</div>
				{pending.length === 0 ? (
					<p className="empty list-note">Nothing needs you. Agents' proposals and access requests land here.</p>
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
							When an agent proposes a change to a strategy, a bet or a goal, or asks for access it doesn't have,
							you decide here. Nothing changes until you approve.
						</p>
					</div>
				) : selected?.kind === "access_request" ? (
					<AccessReview key={`${selected.id}:${selected.status}`} item={selected} />
				) : search.access === undefined ? (
					<Review key={selectedId} proposalId={selectedId} />
				) : (
					<div className="rev">
						<p className="lede">This access request is no longer in the inbox.</p>
					</div>
				)}
			</section>
		</div>
	);
}

function accessTitle(item: InboxAccessRequest) {
	return `${item.agent.name} asks for ${capabilityLabels[item.capability].toLowerCase()}`;
}

function InboxRow({ item, selected }: { item: InboxItem; selected: boolean }) {
	const now = Date.now();
	const decided = item.status !== "pending";
	const at = item.decidedAt ?? item.createdAt;
	const proposal = item.kind === "proposal" ? item : null;

	return (
		<Link
			to="/inbox"
			search={item.kind === "proposal" ? { proposal: item.id } : { access: item.id }}
			className={decided ? "lr dim" : "lr"}
			aria-current={selected ? "page" : undefined}
			style={accent(item.venture?.slug)}
		>
			<span className="lr-h">
				<span className="lr-mark">
					{decided ? <Dia status={item.status === "approved" ? "won" : "lost"} /> : <Need />}
				</span>
				<b>{item.kind === "proposal" ? item.title : accessTitle(item)}</b>
				<time className="mono" dateTime={at} title={formatDateTime(at)}>
					{ago(at, now)}
				</time>
			</span>
			<span className="lr-s">
				<span>
					{item.venture?.name ?? "Holding"} ·{" "}
					{item.kind === "proposal"
						? `${plural(item.changeCount, "change")} · ${actorName(item.createdBy)}`
						: `Access request${item.attempts > 1 ? ` · tried ${item.attempts}×` : ""}`}
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
					? "A new goal tests a new bet you left out. Include the bet or leave out the goal."
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
				<Crest seed={venture.slug} size={14} />
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
				{item.venture === null ? <Icon name="holding" /> : <Crest seed={item.venture.slug} size={14} />}
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
	const creates = change.command === "bet.create" || change.command === "goal.create";
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
						className="inp"
						value={typeof value === "string" ? value : ""}
						onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
					/>
				);
			case "bet":
				return (
					<Select
						title={field.label}
						value={encodeBet(value)}
						options={betOptions(detail, index)}
						onChange={(next) => onChange(decodeBet(next))}
					/>
				);
			case "status":
				return (
					<Select
						title={field.label}
						value={typeof value === "string" ? value : "won"}
						options={Object.entries(settleNames).map(([status, label]) => ({ value: status, label }))}
						onChange={onChange}
					/>
				);
			case "flag":
				return (
					<label className="chg-flag">
						<input
							id={id}
							type="checkbox"
							role="switch"
							className="sw"
							checked={value === true}
							aria-checked={value === true}
							onChange={(event) => onChange(event.target.checked)}
						/>
						Archive its goals too
					</label>
				);
			default:
				return (
					<textarea
						id={id}
						className="ta"
						rows={2}
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
		<div className="chg-f">
			{field.kind === "text" || field.kind === "date" ? (
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
				item.kind === "proposal" ? (
					<Link key={item.id} to="/inbox" search={{ proposal: item.id }} className="quest">
						<Need />
						<b>{item.title}</b>
						<span>
							{plural(item.changeCount, "change")} · {actorName(item.createdBy)} · {ago(item.createdAt, now)}
							{item.staleCount > 0 ? " · stale" : ""}
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
