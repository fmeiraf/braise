import type { OperatorSession } from "@braise/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useDraftRoom } from "./draft.tsx";
import { describeError } from "./errors.ts";
import { keys, queries } from "./live.ts";
import { Drone, Icon } from "./marks.tsx";
import { Select } from "./menu.tsx";
import { Skeleton } from "./parts.tsx";
import { useThreadStream } from "./thread-stream.ts";
import { PostComposer, Timeline } from "./threads.tsx";
import { clockTime, shortDate } from "./time.ts";
import { useCommand } from "./use-command.ts";

const viewNames = { overview: "Overview", strategy: "Strategy", work: "Work" } as const;

function sessionLabel(session: OperatorSession, now: number) {
	const day = shortDate(session.createdAt.slice(0, 10), now);

	return `${day} · ${clockTime(session.createdAt)}`;
}

function Elsewhere() {
	const room = useDraftRoom();
	const changes = room?.draft?.changes ?? [];
	const away = changes.filter((change) => change.view !== room?.view);

	const target =
		(["work", "strategy", "overview"] as const)
			.map((view) => ({ view, count: away.filter((change) => change.view === view).length }))
			.find((entry) => entry.count > 0) ?? null;

	if (room === null || target === null) return null;

	const first = away.find((change) => change.view === target.view);

	return (
		<button
			type="button"
			className="op-elsewhere"
			onClick={() => {
				const step =
					first === undefined ? null : document.querySelector<HTMLElement>(`.op [data-change="${first.id}"]`);

				step?.click();
			}}
		>
			<span>
				<b>
					{target.count} {target.count === 1 ? "change" : "changes"}
				</b>{" "}
				drafted in {viewNames[target.view]}
			</span>
			<span className="grow" />
			Open
			<Icon name="chevr" />
		</button>
	);
}

function SessionBody({
	threadId,
	current,
	venture,
	back,
}: {
	threadId: string;
	current: boolean;
	venture: { id: string; slug: string; name: string };
	back: () => void;
}) {
	const client = useQueryClient();
	const room = useDraftRoom();
	const detail = useQuery(queries.thread(threadId));
	const { live } = useThreadStream(threadId);

	if (detail.isPending) {
		return (
			<div className="op-tl">
				<Skeleton label="Loading the session…" widths={[60, 85, 40]} />
			</div>
		);
	}

	if (detail.isError) {
		return (
			<div className="op-tl">
				<p className="err">{describeError(detail.error)}</p>
			</div>
		);
	}

	const working = detail.data.runs.some((run) => run.status === "queued" || run.status === "running");

	return (
		<>
			<Timeline
				detail={detail.data}
				live={live}
				className="tl op-tl"
				empty={
					<li className="op-sys">
						{current ? "Session started · the operator drafts, you keep" : "This session is empty"}
					</li>
				}
			/>
			<Elsewhere />
			{current ? (
				<PostComposer
					threadId={threadId}
					scope={{ venture }}
					working={working}
					agentName={detail.data.agent.name}
					answering={detail.data.inputRequest !== null}
					placeholder="Tell the operator what to change"
					posted={(result) => {
						room?.follow();

						const session = (result as { session?: { id: string } }).session;

						if (session !== undefined && session.id !== threadId) {
							void client.invalidateQueries({ queryKey: keys.operator(venture.slug) });
						}
					}}
				/>
			) : (
				<div className="op-past">
					<span>An earlier session · read only</span>
					<button type="button" className="btn ghost sm" onClick={back}>
						Back to the current session
					</button>
				</div>
			)}
		</>
	);
}

/** The venture's operator: a chat whose agent drafts changes to the board, beside the venture's pages. */
export function OperatorPanel({
	venture,
	close,
}: {
	venture: { id: string; slug: string; name: string };
	close: () => void;
}) {
	const client = useQueryClient();
	const state = useQuery(queries.operator(venture.slug));
	const [viewing, setViewing] = useState<string | null>(null);
	const opened = useRef<string | null>(null);

	const settle = () => {
		setViewing(null);

		void client.invalidateQueries({ queryKey: keys.operator(venture.slug) });
	};

	const open = useCommand<"operator.open", unknown>("operator.open", settle);
	const fresh = useCommand<"operator.new_session", unknown>("operator.new_session", settle);

	useEffect(() => {
		if (opened.current === venture.id) return;

		opened.current = venture.id;

		open.mutate({ payload: { ventureId: venture.id } });
	}, [open, venture.id]);

	const now = Date.now();
	const session = state.data?.session ?? null;
	const sessions = state.data?.sessions ?? [];
	const shown = viewing ?? session?.id ?? null;
	const agent = useQuery({ ...queries.agents(), select: (data) => data.agents });
	const agentName = agent.data?.find((candidate) => candidate.id === session?.agentProfileId)?.name ?? "Claude";
	const error = open.error ?? fresh.error;

	return (
		<aside className="op" aria-label="Operator">
			<header className="op-h">
				<span className="orb">
					<Drone size={16} />
				</span>
				<div className="op-t">
					<b>Operator</b>
					<span className="cap">
						{venture.name}
						{session === null ? "" : ` · since ${clockTime(session.createdAt)}`} · {agentName}
					</span>
				</div>
				<span className="grow" />
				{sessions.length > 1 ? (
					<Select
						className="ib op-hist"
						title="Sessions"
						tip="Earlier sessions"
						value={shown ?? ""}
						options={sessions.map((entry) => ({
							value: entry.id,
							label: entry.archivedAt === null ? "Current session" : sessionLabel(entry, now),
							sub: `${entry.messageCount} ${entry.messageCount === 1 ? "message" : "messages"}`,
						}))}
						onChange={(next) => setViewing(next === session?.id ? null : next)}
					>
						<Icon name="history" />
					</Select>
				) : null}
				<button
					type="button"
					className="ib"
					aria-label="New session"
					data-tip="New session|the draft carries over"
					disabled={fresh.isPending}
					onClick={() => fresh.mutate({ payload: { ventureId: venture.id } })}
				>
					<Icon name="plus" />
				</button>
				<button type="button" className="ib" aria-label="Close operator" data-tip="Close|O" onClick={close}>
					<Icon name="x" />
				</button>
			</header>
			{error === null ? null : (
				<p className="err op-err" role="alert">
					{describeError(error)}
				</p>
			)}
			{shown === null ? (
				<div className="op-tl">
					<Skeleton label="Opening the operator…" widths={[60, 85, 40]} />
				</div>
			) : (
				<SessionBody
					key={shown}
					threadId={shown}
					current={shown === session?.id}
					venture={venture}
					back={() => setViewing(null)}
				/>
			)}
		</aside>
	);
}
