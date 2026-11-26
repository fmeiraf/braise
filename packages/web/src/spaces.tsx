import {
	defaultAgentProfileId,
	type MemberState,
	maxWakesSinceOwner,
	type SpaceMember,
	type SpaceSummary,
	type ThreadMessage,
} from "@braise/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type DragEvent, type FormEvent, type ReactNode, useContext, useId, useState } from "react";
import { Editable } from "./editable.tsx";
import { describeError } from "./errors.ts";
import { PageError } from "./holding.tsx";
import { keys, queries } from "./live.ts";
import { accent, Drone, Elapsed, Icon, isSquare, Need } from "./marks.tsx";
import { Select } from "./menu.tsx";
import { Skeleton } from "./parts.tsx";
import { useThreadStream } from "./thread-stream.ts";
import {
	ConversationHead,
	PostComposer,
	QuestionStrip,
	type Scope,
	type Selection,
	SpaceChat,
	Timeline,
} from "./threads.tsx";
import { ago, clockTime, formatDateTime } from "./time.ts";
import { toast } from "./toast.ts";
import { useCommand } from "./use-command.ts";
import { ThreadLink, useAgentLookup } from "./working.tsx";

export const threadDragType = "application/x-braise-thread";

export type Tone = "needs" | "live" | "wait" | "ok" | "bad";

const toneOrder: readonly Tone[] = ["needs", "live", "bad", "wait", "ok"];

const toneWords: Record<Tone, string> = {
	needs: "need you",
	live: "running",
	wait: "queued",
	ok: "done",
	bad: "failed",
};

export function toneOf(member: Pick<SpaceMember, "state" | "latestRun">) {
	switch (member.state) {
		case "needs_you":
			return "needs" satisfies Tone;
		case "running":
			return "live" satisfies Tone;
		case "queued":
			return "wait" satisfies Tone;
		case "done": {
			const status = member.latestRun?.status;

			if (status === "failed" || status === "interrupted") return "bad" satisfies Tone;

			return status === "succeeded" ? ("ok" satisfies Tone) : ("wait" satisfies Tone);
		}
	}
}

function tally(tones: Tone[]) {
	return toneOrder.map((tone) => ({ tone, count: tones.filter((candidate) => candidate === tone).length }));
}

export function Pip({ tone }: { tone: Tone }) {
	return <i className="pip" data-tone={tone} aria-hidden="true" />;
}

/** A space's mark: a tinted tile of its members' states, so a space never looks like a thread. */
export function SpaceMark({ tones, size = "sm" }: { tones: Tone[]; size?: "sm" | "lg" }) {
	const shown = [...tones].toSorted((a, b) => toneOrder.indexOf(a) - toneOrder.indexOf(b)).slice(0, 4);

	return (
		<span className={size === "lg" ? "smark lg" : "smark"} aria-hidden="true">
			{[0, 1, 2, 3].map((index) => {
				const tone = shown[index];

				return tone === undefined ? <i key={index} /> : <i key={index} data-tone={tone} />;
			})}
		</span>
	);
}

export function ToneBar({ tones }: { tones: Tone[] }) {
	const counts = tally(tones).filter((entry) => entry.count > 0);

	if (tones.length === 0) return <p className="tonebar-empty">No threads yet</p>;

	const label = counts.map((entry) => `${entry.count} ${toneWords[entry.tone]}`).join(", ");

	return (
		<div className="tonebar">
			<div className="tonebar-b" role="img" aria-label={label}>
				{counts.map((entry) => (
					<i key={entry.tone} data-tone={entry.tone} style={{ flexGrow: entry.count }} />
				))}
			</div>
			<ul className="tonebar-l">
				{counts.map((entry) => (
					<li key={entry.tone} data-tone={entry.tone}>
						<Pip tone={entry.tone} />
						<b className="mono">{entry.count}</b> {toneWords[entry.tone]}
					</li>
				))}
			</ul>
		</div>
	);
}

function summaryTones(space: SpaceSummary) {
	return [
		...Array.from({ length: space.counts.needs_you }, () => "needs" as const),
		...Array.from({ length: space.counts.running }, () => "live" as const),
		...Array.from({ length: space.counts.queued }, () => "wait" as const),
		...Array.from({ length: space.counts.done }, () => "ok" as const),
	];
}

export interface SpaceView {
	spaceId: string;
	ventureSlug: string | null;
	members: SpaceMember[];
}

const groups = [
	{ state: "needs_you", label: "Needs you", tone: "needs" },
	{ state: "running", label: "Running", tone: "live" },
	{ state: "queued", label: "Queued", tone: "wait" },
	{ state: "done", label: "Done", tone: "ok" },
] as const satisfies readonly { state: MemberState; label: string; tone: Tone }[];

const endWords: Record<string, string> = {
	succeeded: "Finished",
	failed: "Failed",
	interrupted: "Interrupted",
	cancelled: "Stopped",
};

function draggedThread(event: DragEvent) {
	return event.dataTransfer.types.includes(threadDragType) ? event.dataTransfer.getData(threadDragType) : null;
}

function useAddMember() {
	const client = useQueryClient();

	return useCommand<"space.add_thread", { thread: { title: string } }>("space.add_thread", (response) => {
		void client.invalidateQueries({ queryKey: keys.spaces });

		void client.invalidateQueries({ queryKey: keys.threads });

		toast(
			<>
				Added <b>{response.result.thread.title}</b> to the space
			</>,
			"threads",
		);
	});
}

function useDropTarget(add: (threadId: string) => void) {
	const [over, setOver] = useState(false);

	return {
		over,
		handlers: {
			onDragOver: (event: DragEvent) => {
				if (!event.dataTransfer.types.includes(threadDragType)) return;

				event.preventDefault();

				event.dataTransfer.dropEffect = "link";

				setOver(true);
			},
			onDragLeave: () => setOver(false),
			onDrop: (event: DragEvent) => {
				setOver(false);

				const threadId = draggedThread(event);

				if (threadId === null || threadId === "") return;

				event.preventDefault();

				add(threadId);
			},
		},
	};
}

function SpaceLink({
	scope,
	spaceId,
	className,
	current,
	children,
}: {
	scope: Scope;
	spaceId: string;
	className: string;
	current: boolean;
	children: ReactNode;
}) {
	const aria = current ? "page" : undefined;

	return scope.venture === null ? (
		<Link to="/threads" search={{ space: spaceId }} className={className} aria-current={aria}>
			{children}
		</Link>
	) : (
		<Link
			to="/v/$slug/threads"
			params={{ slug: scope.venture.slug }}
			search={{ space: spaceId }}
			className={className}
			aria-current={aria}
		>
			{children}
		</Link>
	);
}

export function SpaceRows({ scope, selectedId }: { scope: Scope; selectedId: string | null }) {
	const spaces = useQuery(queries.spaces(scope.venture?.id));
	const list = spaces.data?.spaces ?? [];

	if (spaces.isError) {
		return (
			<p className="err list-note" role="alert">
				{describeError(spaces.error)}
			</p>
		);
	}

	if (list.length === 0) return null;

	return (
		<>
			<div className="group">
				<h2 className="cap">Spaces</h2>
				<span className="cnt">{list.length}</span>
			</div>
			{list.map((space) => (
				<SpaceRow key={space.id} space={space} scope={scope} selected={space.id === selectedId} />
			))}
		</>
	);
}

function SpaceRow({ space, scope, selected }: { space: SpaceSummary; scope: Scope; selected: boolean }) {
	const agentOf = useAgentLookup();
	const add = useAddMember();
	const drop = useDropTarget((threadId) => add.mutate({ payload: { spaceId: space.id, threadId } }));
	const live = space.chatActive || space.counts.running > 0;
	const tones = summaryTones(space);
	const counts = tally(tones).filter((entry) => entry.count > 0);

	return (
		<div className={drop.over ? "sr drop" : "sr"} style={accent(space.venture?.slug)} {...drop.handlers}>
			<SpaceLink scope={scope} spaceId={space.id} className="lr sp" current={selected}>
				<span className="lr-h">
					<SpaceMark tones={tones} />
					<b>{space.title}</b>
					<time className="mono" dateTime={space.updatedAt} title={formatDateTime(space.updatedAt)}>
						{live ? "now" : ago(space.updatedAt, Date.now())}
					</time>
				</span>
				<span className="lr-s">
					<span className="sp-who">
						<Drone size={11} run={space.chatActive} square={isSquare(agentOf(space.agentProfileId))} />
						{space.agent.name}
						{scope.venture === null ? ` · ${space.venture?.name ?? "Holding"}` : null}
					</span>
					{space.pausedForOwner ? (
						<span className="sp-c" data-tone="needs">
							<Pip tone="needs" />
							paused, needs you
						</span>
					) : counts.length === 0 ? (
						<span className="sp-c">no threads yet</span>
					) : (
						counts.map((entry) => (
							<span key={entry.tone} className="sp-c" data-tone={entry.tone}>
								<Pip tone={entry.tone} />
								{entry.count}
							</span>
						))
					)}
				</span>
			</SpaceLink>
			{add.error === null ? null : (
				<p className="err list-note" role="alert">
					{describeError(add.error)}
				</p>
			)}
		</div>
	);
}

function memberLine(member: SpaceMember) {
	const run = member.latestRun;

	switch (member.state) {
		case "needs_you":
			return member.question ?? "Waiting for your answer";
		case "running":
			return null;
		case "queued":
			return null;
		case "done":
			return run === null
				? "Not started"
				: `${endWords[run.status] ?? "Finished"} ${clockTime(run.finishedAt ?? run.createdAt)}`;
	}
}

function MemberStatus({ member }: { member: SpaceMember }) {
	const run = member.latestRun;
	const line = memberLine(member);

	const who = (
		<span className="mr-who">
			<Drone size={11} run={member.state === "running"} square={member.agent.runtime === "pi"} />
			{member.agent.name}
		</span>
	);

	if (member.state === "running" && run !== null) {
		return (
			<span className="mr-s">
				{who} · <span className="mr-t">working</span> <Elapsed since={run.startedAt ?? run.createdAt} />
			</span>
		);
	}

	if (member.state === "queued" && run !== null) {
		return (
			<span className="mr-s">
				{who} · <span className="mr-t">queued</span> <Elapsed since={run.createdAt} />
			</span>
		);
	}

	return (
		<span className="mr-s">
			{who} · <span className="mr-t">{member.state === "needs_you" ? `asks: ${line}` : line}</span>
		</span>
	);
}

export function MemberCard({ threadId }: { threadId: string }) {
	const space = useContext(SpaceChat);
	const member = space?.members.find((candidate) => candidate.thread.id === threadId);

	if (member === undefined) {
		return (
			<ThreadLink ventureSlug={space?.ventureSlug ?? null} threadId={threadId} className="tcard gone">
				<Icon name="threads" />
				<b>A thread started here</b>
				<span className="mute">no longer in the space</span>
				<Icon name="right" />
			</ThreadLink>
		);
	}

	const tone = toneOf(member);

	return (
		<ThreadLink ventureSlug={space?.ventureSlug ?? null} threadId={threadId} className="tcard" tone={tone}>
			<Pip tone={tone} />
			<b>{member.thread.title}</b>
			<MemberStatus member={member} />
			<Icon name="right" />
		</ThreadLink>
	);
}

const reportTones = {
	succeeded: "ok",
	failed: "bad",
	interrupted: "bad",
	cancelled: "wait",
	needs_input: "needs",
} as const satisfies Record<string, Tone>;

export function ReportLine({ message, space }: { message: ThreadMessage; space: SpaceView | null }) {
	if (message.meta?.kind !== "report") return null;

	const { outcome, threadId } = message.meta;

	return (
		<li className="sys rep">
			<ThreadLink
				ventureSlug={space?.ventureSlug ?? null}
				threadId={threadId}
				className="rep-l"
				tone={reportTones[outcome]}
			>
				<Pip tone={reportTones[outcome]} />
				<span>{message.body}</span>
				<time className="mono" dateTime={message.createdAt} title={formatDateTime(message.createdAt)}>
					{clockTime(message.createdAt)}
				</time>
			</ThreadLink>
		</li>
	);
}

export function SpaceScreen({
	spaceId,
	scope,
	listHidden,
	toggleList,
	go,
}: {
	spaceId: string;
	scope: Scope;
	listHidden: boolean;
	toggleList: () => void;
	go: (next: Selection) => void;
}) {
	const detail = useQuery(queries.space(spaceId));

	if (detail.isPending) {
		return (
			<div className="space-v">
				<section className="conv" aria-busy="true">
					<div className="tl">
						<Skeleton label="Loading the space…" widths={[40, 85, 70, 90]} />
					</div>
				</section>
			</div>
		);
	}

	if (detail.isError) {
		return (
			<section className="conv">
				<PageError error={detail.error} retry={() => void detail.refetch()} />
			</section>
		);
	}

	const { space, members } = detail.data;

	if (space.archivedAt !== null) {
		return (
			<section className="conv">
				<div className="tl">
					<p className="conv-note">This space is archived. Its threads are back in the list.</p>
				</div>
			</section>
		);
	}

	const view = { spaceId, ventureSlug: space.venture?.slug ?? null, members } satisfies SpaceView;

	return (
		<SpaceChat.Provider value={view}>
			<div className="space-v" style={accent(space.venture?.slug)}>
				<SpaceChatPane
					space={space}
					members={members}
					scope={scope}
					listHidden={listHidden}
					toggleList={toggleList}
					go={go}
				/>
				<Members space={space} members={members} scope={scope} go={go} stats={detail.data.stats} />
			</div>
		</SpaceChat.Provider>
	);
}

function SpaceChatPane({
	space,
	members,
	scope,
	listHidden,
	toggleList,
	go,
}: {
	space: SpaceSummary;
	members: SpaceMember[];
	scope: Scope;
	listHidden: boolean;
	toggleList: () => void;
	go: (next: Selection) => void;
}) {
	const client = useQueryClient();
	const chat = useQuery(queries.thread(space.chatThreadId));
	const { live, down } = useThreadStream(space.chatThreadId);
	const refresh = () => void client.invalidateQueries({ queryKey: keys.spaces });
	const update = useCommand<"space.update", unknown>("space.update", refresh);

	if (chat.isPending) {
		return (
			<section className="conv" aria-busy="true">
				<div className="tl">
					<Skeleton label="Loading the chat…" widths={[40, 85, 70]} />
				</div>
			</section>
		);
	}

	if (chat.isError) {
		return (
			<section className="conv">
				<PageError error={chat.error} retry={() => void chat.refetch()} />
			</section>
		);
	}

	const working = chat.data.runs.some((run) => run.status === "queued" || run.status === "running");
	const empty = chat.data.messages.length === 0;
	const tones = members.map(toneOf);

	return (
		<section className="conv" aria-label={space.title}>
			<ConversationHead
				detail={chat.data}
				scope={scope}
				running={working}
				listHidden={listHidden}
				toggleList={toggleList}
				kind="space"
				title={
					<>
						<SpaceMark tones={tones} size="lg" />
						<span className="space-t">
							<span className="cap">Space</span>
							<Editable
								label="space title"
								value={space.title}
								required
								save={(title) => update.mutateAsync({ payload: { spaceId: space.id, title } })}
							/>
						</span>
					</>
				}
				extra={<ToneBar tones={tones} />}
			/>
			<SpaceGoal
				space={space}
				save={(goal) => update.mutateAsync({ payload: { spaceId: space.id, goal } })}
				go={go}
			/>
			{empty ? (
				<div className="tl">
					<div className="newthread">
						<span className="cap">New space</span>
						<h2 className="h1">What should {space.agent.name} get done here?</h2>
						<p className="lede">
							{space.agent.name} plans the work, starts a thread for each part with the agent that fits it, and
							reads their reports as they finish. Questions any thread has for you land in the inbox.
						</p>
					</div>
				</div>
			) : (
				<Timeline detail={chat.data} live={live} />
			)}
			{down ? (
				<output className="conv-note">
					<Need />
					Reconnecting to the live reply…
				</output>
			) : null}
			<QuestionStrip detail={chat.data} />
			{space.pausedForOwner ? (
				<output className="asks">
					<Need />
					<span>
						<b>Paused: needs you.</b> {space.agent.name} woke {maxWakesSinceOwner} times on its own. Write to let
						it carry on.
					</span>
				</output>
			) : null}
			<PostComposer
				threadId={space.chatThreadId}
				scope={scope}
				working={working}
				agentName={space.agent.name}
				answering={chat.data.inputRequest !== null}
			/>
		</section>
	);
}

function SpaceGoal({
	space,
	save,
	go,
}: {
	space: SpaceSummary;
	save: (goal: string) => Promise<unknown>;
	go: (next: Selection) => void;
}) {
	const client = useQueryClient();
	const [confirming, setConfirming] = useState(false);

	const archive = useCommand<"space.archive", unknown>("space.archive", () => {
		void client.invalidateQueries({ queryKey: keys.spaces });

		void client.invalidateQueries({ queryKey: keys.threads });

		toast(
			<>
				Archived <b>{space.title}</b>
			</>,
			"archive",
		);

		go({});
	});

	return (
		<div className="space-goal">
			<span className="cap">Goal</span>
			<div className="space-goal-t">
				<Editable
					label="space goal"
					value={space.goal ?? ""}
					placeholder="Add a goal the space works toward"
					multiline
					save={save}
				/>
			</div>
			{confirming ? (
				<>
					<button
						type="button"
						className="btn danger sm"
						disabled={archive.isPending}
						onClick={() => archive.mutate({ payload: { spaceId: space.id } })}
					>
						Archive space
					</button>
					<button type="button" className="btn ghost sm" onClick={() => setConfirming(false)}>
						Keep
					</button>
				</>
			) : (
				<button type="button" className="btn ghost sm" onClick={() => setConfirming(true)}>
					<Icon name="archive" />
					Archive
				</button>
			)}
			{archive.error === null ? null : (
				<p className="err" role="alert">
					{describeError(archive.error)}
				</p>
			)}
		</div>
	);
}

function Members({
	space,
	members,
	scope,
	go,
	stats,
}: {
	space: SpaceSummary;
	members: SpaceMember[];
	scope: Scope;
	go: (next: Selection) => void;
	stats: { runs: number; inputTokens: number; outputTokens: number; costUsd: number };
}) {
	const add = useAddMember();
	const drop = useDropTarget((threadId) => add.mutate({ payload: { spaceId: space.id, threadId } }));
	const headingId = useId();

	const loose = useQuery(
		queries.threads(scope.venture === null ? { space: "none" } : { ventureId: scope.venture.id, space: "none" }),
	);

	const candidates = (loose.data?.threads ?? []).filter((thread) => thread.ventureId === space.ventureId);

	const addOptions = [
		{ value: "", label: candidates.length === 0 ? "No loose threads" : "Add a thread" },
		...candidates.map((thread) => ({ value: thread.id, label: thread.title })),
	];

	return (
		<aside className={drop.over ? "mem drop" : "mem"} aria-labelledby={headingId} {...drop.handlers}>
			<div className="bar">
				<h2 id={headingId}>In this space</h2>
				<span className="cnt">{members.length}</span>
				<span className="grow" />
				<button
					type="button"
					className="ib"
					aria-label="New thread in this space"
					data-tip="New thread in this space"
					onClick={() => go({ in: space.id })}
				>
					<Icon name="plus" />
				</button>
			</div>
			<div className="mem-add">
				<Select
					title="Add a thread"
					value=""
					disabled={candidates.length === 0 || add.isPending}
					options={addOptions}
					onChange={(threadId) => {
						if (threadId !== "") add.mutate({ payload: { spaceId: space.id, threadId } });
					}}
				/>
			</div>
			{add.error === null ? null : (
				<p className="err list-note" role="alert">
					{describeError(add.error)}
				</p>
			)}
			{members.length === 0 ? (
				<p className="empty mem-empty">
					{space.agent.name} starts threads here as it plans. Drag a thread in from the list to add your own.
				</p>
			) : (
				groups.map((group) => {
					const inGroup = members.filter((member) => member.state === group.state);

					if (inGroup.length === 0) return null;

					return (
						<section key={group.state} className="mem-g" aria-label={group.label}>
							<h3 className="cap" data-tone={group.tone}>
								<Pip tone={group.tone} />
								{group.label}
								<span className="cnt">{inGroup.length}</span>
							</h3>
							<ul>
								{inGroup.map((member) => (
									<MemberRow key={member.thread.id} member={member} space={space} />
								))}
							</ul>
						</section>
					);
				})
			)}
			<p className="mem-f mono">
				{stats.runs} runs · {Math.round((stats.inputTokens + stats.outputTokens) / 1_000)}k tokens · $
				{stats.costUsd.toFixed(2)}
			</p>
			{drop.over ? <p className="mem-drop">Drop to add to {space.title}</p> : null}
		</aside>
	);
}

function MemberRow({ member, space }: { member: SpaceMember; space: SpaceSummary }) {
	const client = useQueryClient();

	const remove = useCommand<"space.remove_thread", unknown>("space.remove_thread", () => {
		void client.invalidateQueries({ queryKey: keys.spaces });

		void client.invalidateQueries({ queryKey: keys.threads });

		toast(
			<>
				Removed <b>{member.thread.title}</b> from the space
			</>,
			"threads",
		);
	});

	return (
		<li className="mr" data-tone={toneOf(member)}>
			<ThreadLink ventureSlug={space.venture?.slug ?? null} threadId={member.thread.id} className="mr-l">
				<Pip tone={toneOf(member)} />
				<b>{member.thread.title}</b>
				<MemberStatus member={member} />
			</ThreadLink>
			<button
				type="button"
				className="ib"
				aria-label={`Remove ${member.thread.title} from the space`}
				data-tip="Remove from space|Its history stays"
				disabled={remove.isPending}
				onClick={() => remove.mutate({ payload: { spaceId: space.id, threadId: member.thread.id } })}
			>
				<Icon name="x" />
			</button>
			{remove.error === null ? null : (
				<p className="err" role="alert">
					{describeError(remove.error)}
				</p>
			)}
		</li>
	);
}

export function NewSpace({ scope, go }: { scope: Scope; go: (next: Selection) => void }) {
	const client = useQueryClient();
	const agents = useQuery(queries.agents());
	const list = agents.data?.agents ?? [];
	const [agentId, setAgentId] = useState(defaultAgentProfileId);
	const [title, setTitle] = useState("");
	const [goal, setGoal] = useState("");
	const titleId = useId();
	const goalId = useId();

	const create = useCommand<"space.create", { space: { id: string } }>("space.create", (response) => {
		void client.invalidateQueries({ queryKey: keys.spaces });

		go({ space: response.result.space.id });
	});

	const agentName = list.find((agent) => agent.id === agentId)?.name ?? agentId;

	const submit = (event: FormEvent) => {
		event.preventDefault();

		if (title.trim() === "") return;

		create.mutate({
			payload: {
				...(scope.venture === null ? {} : { ventureId: scope.venture.id }),
				title: title.trim(),
				...(goal.trim() === "" ? {} : { goal: goal.trim() }),
				agentProfileId: agentId,
			},
		});
	};

	return (
		<section className="conv" aria-label="New space" style={accent(scope.venture?.slug)}>
			<div className="tl">
				<form className="newthread newspace" onSubmit={submit}>
					<span className="cap">
						New space{scope.venture === null ? " in the Holding" : ` in ${scope.venture.name}`}
					</span>
					<h2 className="h1">A space for one piece of work</h2>
					<p className="lede">
						The space's agent breaks the work into threads, picks an agent for each and hears back from them. You
						can bring your own threads in too.
					</p>
					<label className="field" htmlFor={titleId}>
						<span className="cap">Title</span>
						<input
							id={titleId}
							className="inp"
							value={title}
							placeholder="Pricing page"
							required
							maxLength={80}
							onChange={(event) => setTitle(event.target.value)}
						/>
					</label>
					<label className="field" htmlFor={goalId}>
						<span className="cap">Goal</span>
						<textarea
							id={goalId}
							className="inp"
							rows={3}
							value={goal}
							placeholder="What done looks like"
							maxLength={2_000}
							onChange={(event) => setGoal(event.target.value)}
						/>
					</label>
					<p className="newthread-with">
						orchestrated by
						<Select
							title="Agent"
							value={agentId}
							disabled={agents.data === undefined}
							options={
								list.length === 0
									? [{ value: agentId, label: agentName }]
									: list.map((agent) => ({
											value: agent.id,
											label: agent.name,
											glyph: <Drone size={14} square={isSquare(agent)} />,
											sub: agent.model,
										}))
							}
							onChange={setAgentId}
						/>
					</p>
					<div className="newspace-f">
						<button type="submit" className="btn pri" disabled={title.trim() === "" || create.isPending}>
							Create space
						</button>
						<button type="button" className="btn ghost" onClick={() => go({})}>
							Cancel
						</button>
					</div>
					{create.error === null ? null : (
						<p className="err" role="alert">
							{describeError(create.error)}
						</p>
					)}
				</form>
			</div>
		</section>
	);
}

export function SpaceBand({ spaceId, go }: { spaceId: string; go: (next: Selection) => void }) {
	const detail = useQuery(queries.space(spaceId));

	if (detail.data === undefined) return <div className="space-band" />;

	const { space, members } = detail.data;
	const tones = members.map(toneOf);

	return (
		<div className="space-band">
			<button type="button" className="space-band-a" onClick={() => go({ space: spaceId })}>
				<SpaceMark tones={tones} />
				<span className="cap">Part of the space</span>
				<b>{space.title}</b>
				<span className="mute">directed by {space.agent.name}</span>
			</button>
			<span className="grow" />
			<ToneBar tones={tones} />
			<button type="button" className="btn ghost sm" onClick={() => go({ space: spaceId })}>
				Back to the space
				<Icon name="right" />
			</button>
		</div>
	);
}
