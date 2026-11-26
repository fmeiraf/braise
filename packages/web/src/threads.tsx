import {
	activeRunStatuses,
	defaultAgentProfileId,
	type LinkTarget,
	type Run,
	type RunStatus,
	systemAuthor,
	type ThreadDetail,
	type ThreadLink as ThreadLinkData,
	type ThreadLinkType,
	type ThreadMessage,
	type ThreadSummary,
} from "@braise/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { type ChangeEvent, type KeyboardEvent, type MouseEvent, useEffect, useId, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "./api.ts";
import { Editable } from "./editable.tsx";
import { describeError } from "./errors.ts";
import { PageError } from "./holding.tsx";
import { keys, queries } from "./live.ts";
import { accent, Cast, Drone, Icon, isSquare, Need, You } from "./marks.tsx";
import { Select } from "./menu.tsx";
import { Skeleton } from "./parts.tsx";
import { useThreadStream } from "./thread-stream.ts";
import {
	accessRequestOf,
	actorName,
	buildTimeline,
	describeCall,
	type LiveBlock,
	type LiveRuns,
	liveTail,
	parseJson,
	plainSnippet,
	proposalsOf,
	type Segment,
	type TimelineEntry,
	type ToolCall,
} from "./thread-timeline.ts";
import { ago, clockTime, dayLabel, formatDateTime } from "./time.ts";
import { useCommand } from "./use-command.ts";
import { ThreadLink, useAgentLookup } from "./working.tsx";

interface Scope {
	venture: { id: string; slug: string; name: string } | null;
}

interface DraftLink {
	type: ThreadLinkType;
	id: string;
	label: string;
}

const linkKinds: Record<ThreadLinkType, string> = {
	work_item: "Work",
	bet: "Bet",
	assumption: "Assumption",
	objective: "Objective",
	venture: "Venture",
};

const statusWords: Partial<Record<RunStatus, string>> = {
	queued: "Waiting to start",
	cancelled: "Stopped",
	failed: "Failed",
	interrupted: "Interrupted",
};

function isActive(status: RunStatus) {
	return (activeRunStatuses as readonly RunStatus[]).includes(status);
}

function parseLink(value: string | undefined, label: string | undefined) {
	if (value === undefined) return [];

	const [type, id] = value.split(":");

	if (id === undefined || !(type !== undefined && type in linkKinds)) return [];

	return [{ type: type as ThreadLinkType, id, label: label ?? linkKinds[type as ThreadLinkType] }];
}

export function HoldingThreadsPage() {
	const search = useSearch({ from: "/threads" });
	const navigate = useNavigate();

	return (
		<ThreadsScreen
			scope={{ venture: null }}
			selectedId={search.thread ?? null}
			draftLinks={parseLink(search.link, search.label)}
			open={(thread) => void navigate({ to: "/threads", search: thread === null ? {} : { thread } })}
		/>
	);
}

export function VentureThreadsPage() {
	const { slug } = useParams({ from: "/v/$slug/threads" });
	const search = useSearch({ from: "/v/$slug/threads" });
	const navigate = useNavigate();
	const ventures = useQuery(queries.ventures());

	if (ventures.isPending) {
		return (
			<div className="split">
				<div className="list">
					<Skeleton label="Loading threads…" widths={[70, 90, 60]} />
				</div>
				<div className="conv" />
			</div>
		);
	}

	if (ventures.isError) return <PageError error={ventures.error} retry={() => void ventures.refetch()} />;

	const venture = ventures.data.ventures.find((candidate) => candidate.slug === slug);

	if (venture === undefined) {
		return (
			<div className="page-error">
				<p>This venture doesn't exist or was archived.</p>
			</div>
		);
	}

	return (
		<ThreadsScreen
			scope={{ venture: { id: venture.id, slug: venture.slug, name: venture.name } }}
			selectedId={search.thread ?? null}
			draftLinks={parseLink(search.link, search.label)}
			open={(thread) =>
				void navigate({ to: "/v/$slug/threads", params: { slug }, search: thread === null ? {} : { thread } })
			}
		/>
	);
}

function ThreadsScreen({
	scope,
	selectedId,
	draftLinks,
	open,
}: {
	scope: Scope;
	selectedId: string | null;
	draftLinks: DraftLink[];
	open: (threadId: string | null) => void;
}) {
	const [listHidden, setListHidden] = useState(false);

	return (
		<div className={listHidden ? "split solo" : "split"}>
			<ThreadList scope={scope} selectedId={selectedId} startNew={() => open(null)} />
			{selectedId === null ? (
				<NewThread
					key={draftLinks.map((link) => link.id).join()}
					scope={scope}
					draftLinks={draftLinks}
					open={open}
				/>
			) : (
				<Conversation
					key={selectedId}
					threadId={selectedId}
					scope={scope}
					listHidden={listHidden}
					toggleList={() => setListHidden((hidden) => !hidden)}
				/>
			)}
		</div>
	);
}

function ThreadList({
	scope,
	selectedId,
	startNew,
}: {
	scope: Scope;
	selectedId: string | null;
	startNew: () => void;
}) {
	const filter = scope.venture === null ? {} : { ventureId: scope.venture.id };
	const threads = useQuery(queries.threads(filter));
	const ventures = useQuery(queries.ventures()).data?.ventures ?? [];
	const now = Date.now();

	return (
		<nav className="list" aria-label="Threads">
			<div className="bar">
				<h1>Threads</h1>
				{threads.isSuccess ? <span className="cnt">{threads.data.threads.length}</span> : null}
				<span className="grow" />
				<button type="button" className="btn sm" onClick={startNew}>
					<Icon name="plus" />
					New
				</button>
			</div>
			{threads.isPending ? (
				<Skeleton label="Loading threads…" widths={[70, 90, 60, 80]} />
			) : threads.isError ? (
				<p className="err list-note" role="alert">
					{describeError(threads.error)}
				</p>
			) : threads.data.threads.length === 0 ? (
				<p className="empty list-note">No threads yet. Start one to talk with an agent.</p>
			) : (
				threads.data.threads.map((thread) => (
					<ThreadRow
						key={thread.id}
						thread={thread}
						scope={scope}
						venture={ventures.find((venture) => venture.id === thread.ventureId) ?? null}
						selected={thread.id === selectedId}
						now={now}
					/>
				))
			)}
		</nav>
	);
}

function ThreadRow({
	thread,
	scope,
	venture,
	selected,
	now,
}: {
	thread: ThreadSummary;
	scope: Scope;
	venture: { slug: string; name: string } | null;
	selected: boolean;
	now: number;
}) {
	const agentOf = useAgentLookup();
	const running = thread.activeRun !== null;
	const snippet = thread.lastMessage === null ? "" : plainSnippet(thread.lastMessage.body);

	return (
		<ThreadLink
			ventureSlug={scope.venture?.slug ?? null}
			threadId={thread.id}
			className="lr"
			current={selected}
			style={accent(venture?.slug)}
		>
			<span className="lr-h">
				<Drone size={15} run={running} square={isSquare(agentOf(thread.agentProfileId))} />
				<b>{thread.title}</b>
				<time className="mono" dateTime={thread.updatedAt} title={formatDateTime(thread.updatedAt)}>
					{running ? "now" : ago(thread.updatedAt, now)}
				</time>
			</span>
			{snippet === "" ? null : <span className="lr-p">{snippet}</span>}
			{scope.venture === null ? (
				<span className="lr-s">
					<i className="vdot" />
					{venture?.name ?? "Holding"}
				</span>
			) : null}
		</ThreadLink>
	);
}

function NewThread({
	scope,
	draftLinks,
	open,
}: {
	scope: Scope;
	draftLinks: DraftLink[];
	open: (threadId: string) => void;
}) {
	const client = useQueryClient();
	const agents = useQuery(queries.agents());
	const [agentId, setAgentId] = useState(defaultAgentProfileId);
	const list = agents.data?.agents ?? [];
	const agentName = list.find((agent) => agent.id === agentId)?.name ?? actorName(`agent:${agentId}`);

	const start = useCommand<"thread.start", { thread: { id: string } }>("thread.start", (response) => {
		void client.invalidateQueries({ queryKey: keys.threads });

		void client.invalidateQueries({ queryKey: keys.activeRuns });

		open(response.result.thread.id);
	});

	return (
		<section className="conv" aria-label="New thread" style={accent(scope.venture?.slug)}>
			<div className="tl">
				<div className="newthread">
					<span className="cap">New thread</span>
					<h2 className="h1">Who do you want to ask?</h2>
					<p className="newthread-with">
						with
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
					<p className="lede">
						Ask {agentName} about {scope.venture === null ? "any venture" : scope.venture.name}. It reads
						everything in braise; what it may change is up to you in <Link to="/agents">Agents</Link>.
					</p>
				</div>
			</div>
			<Composer
				scope={scope}
				initialLinks={draftLinks}
				busy={start.isPending}
				working={false}
				error={start.error}
				autoFocus
				agentName={agentName}
				submit={(body, links, sent) =>
					start.mutate(
						{
							payload: {
								...(scope.venture === null ? {} : { ventureId: scope.venture.id }),
								agentProfileId: agentId,
								body,
								links: links.map(({ type, id }) => ({ type, id })),
							},
						},
						{ onSuccess: sent },
					)
				}
			/>
		</section>
	);
}

function useStickToBottom() {
	const scroller = useRef<HTMLDivElement>(null);
	const content = useRef<HTMLOListElement>(null);
	const pinned = useRef(true);

	useEffect(() => {
		const scrollElement = scroller.current;
		const contentElement = content.current;

		if (scrollElement === null || contentElement === null) return;

		scrollElement.scrollTop = scrollElement.scrollHeight;

		const observer = new ResizeObserver(() => {
			if (pinned.current) scrollElement.scrollTop = scrollElement.scrollHeight;
		});

		observer.observe(contentElement);

		return () => observer.disconnect();
	}, []);

	const onScroll = () => {
		const element = scroller.current;

		if (element === null) return;

		pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
	};

	const onClickCapture = (event: MouseEvent<HTMLElement>) => {
		if (event.target instanceof Element && event.target.closest(".tool") !== null) pinned.current = false;
	};

	return { scroller, content, onScroll, onClickCapture };
}

function Conversation({
	threadId,
	scope,
	listHidden,
	toggleList,
}: {
	threadId: string;
	scope: Scope;
	listHidden: boolean;
	toggleList: () => void;
}) {
	const detail = useQuery(queries.thread(threadId));
	const { live, down } = useThreadStream(threadId);

	if (detail.isPending) {
		return (
			<section className="conv" aria-busy="true">
				<div className="tl">
					<Skeleton label="Loading the thread…" widths={[40, 85, 70, 90, 55]} />
				</div>
			</section>
		);
	}

	if (detail.isError) {
		return (
			<section className="conv">
				<PageError error={detail.error} retry={() => void detail.refetch()} />
			</section>
		);
	}

	const activeRun = detail.data.runs.find((run) => isActive(run.status)) ?? null;
	const archived = detail.data.thread.archivedAt !== null;

	return (
		<section className="conv" aria-label={detail.data.thread.title} style={accent(detail.data.venture?.slug)}>
			<ConversationHead
				detail={detail.data}
				scope={scope}
				running={activeRun !== null}
				listHidden={listHidden}
				toggleList={toggleList}
			/>
			<Timeline detail={detail.data} live={live} />
			{down ? (
				<output className="conv-note">
					<Need />
					Reconnecting to the live reply…
				</output>
			) : null}
			{archived ? (
				<p className="conv-note">This thread is archived.</p>
			) : (
				<PostComposer
					threadId={threadId}
					scope={scope}
					working={activeRun !== null}
					agentName={detail.data.agent.name}
				/>
			)}
		</section>
	);
}

function entryTime(entry: TimelineEntry) {
	return entry.kind === "message" ? entry.message.createdAt : (entry.run.startedAt ?? entry.run.createdAt);
}

function Timeline({ detail, live }: { detail: ThreadDetail; live: LiveRuns }) {
	const timeline = buildTimeline(detail);
	const scroll = useStickToBottom();
	const now = Date.now();

	return (
		<div className="tl" ref={scroll.scroller} onScroll={scroll.onScroll} onClickCapture={scroll.onClickCapture}>
			<ol ref={scroll.content}>
				{timeline.flatMap((entry, index) => {
					const day = dayLabel(entryTime(entry), now);
					const previous = timeline[index - 1];
					const firstOfDay = previous === undefined || dayLabel(entryTime(previous), now) !== day;
					const key = entry.kind === "message" ? entry.message.id : entry.run.id;

					return [
						firstOfDay ? (
							<li key={`day-${key}`} className="day-div">
								{day}
							</li>
						) : null,
						entry.kind === "message" ? (
							entry.message.author === systemAuthor ? (
								<SystemLine key={key} message={entry.message} />
							) : (
								<OwnerMessage key={key} message={entry.message} />
							)
						) : (
							<RunEntry
								key={key}
								run={entry.run}
								segments={entry.segments}
								latest={entry.latest}
								tail={liveTail(live, entry.run, entry.segments)}
							/>
						),
					];
				})}
			</ol>
		</div>
	);
}

function PostComposer({
	threadId,
	scope,
	working,
	agentName,
}: {
	threadId: string;
	scope: Scope;
	working: boolean;
	agentName: string;
}) {
	const client = useQueryClient();

	const post = useCommand<"thread.post", unknown>("thread.post", () => {
		void client.invalidateQueries({ queryKey: keys.thread(threadId) });

		void client.invalidateQueries({ queryKey: keys.activeRuns });
	});

	return (
		<Composer
			scope={scope}
			initialLinks={[]}
			busy={post.isPending}
			working={working}
			error={post.error}
			agentName={agentName}
			submit={(body, links, sent) =>
				post.mutate(
					{ payload: { threadId, body, links: links.map(({ type, id }) => ({ type, id })) } },
					{ onSuccess: sent },
				)
			}
		/>
	);
}

function ConversationHead({
	detail,
	scope,
	running,
	listHidden,
	toggleList,
}: {
	detail: ThreadDetail;
	scope: Scope;
	running: boolean;
	listHidden: boolean;
	toggleList: () => void;
}) {
	const client = useQueryClient();
	const agentOf = useAgentLookup();
	const threadId = detail.thread.id;
	const refresh = () => void client.invalidateQueries({ queryKey: keys.thread(threadId) });
	const rename = useCommand<"thread.rename", unknown>("thread.rename", refresh);
	const link = useCommand<"thread.link", unknown>("thread.link", refresh);
	const unlink = useCommand<"thread.unlink", unknown>("thread.unlink", refresh);
	const [picking, setPicking] = useState(false);
	const error = link.error ?? unlink.error;
	const linkScope = detail.venture === null ? scope : { venture: detail.venture };
	const agent = agentOf(detail.agent.id);

	return (
		<header className="conv-h">
			<h2>
				<button
					type="button"
					className="ib"
					aria-label={listHidden ? "Show thread list" : "Hide thread list"}
					aria-pressed={listHidden}
					data-tip={listHidden ? "Show thread list" : "Hide thread list"}
					onClick={toggleList}
				>
					<Icon name="panel" />
				</button>
				<Editable
					label="thread title"
					value={detail.thread.title}
					required
					save={(title) => rename.mutateAsync({ payload: { threadId, title } })}
				/>
				<span className="with">
					<Drone size={14} run={running} square={isSquare(agent)} />
					{detail.agent.name}
					{agent === undefined ? null : ` · ${agent.model}`}
				</span>
			</h2>
			{detail.venture === null || scope.venture !== null ? null : (
				<span className="chip nox">
					<span className="cap">Venture</span>
					<Link to="/v/$slug" params={{ slug: detail.venture.slug }}>
						{detail.venture.name}
					</Link>
				</span>
			)}
			{detail.links.map((item) => (
				<LinkTag
					key={`${item.type}:${item.id}`}
					link={item}
					remove={() => unlink.mutate({ payload: { threadId, link: { type: item.type, id: item.id } } })}
				/>
			))}
			<div className="link-anchor">
				<button
					type="button"
					className="btn ghost sm"
					aria-expanded={picking}
					onClick={() => setPicking((current) => !current)}
				>
					<Icon name="link" />
					{detail.links.length === 0 ? "Link to work" : "Link"}
				</button>
				{picking ? (
					<LinkSearch
						scope={linkScope}
						exclude={detail.links}
						close={() => setPicking(false)}
						choose={(target) => {
							setPicking(false);

							link.mutate({ payload: { threadId, link: { type: target.type, id: target.id } } });
						}}
					/>
				) : null}
			</div>
			{error === null ? null : (
				<p className="err" role="alert">
					{describeError(error)}
				</p>
			)}
		</header>
	);
}

function LinkTag({ link, remove }: { link: ThreadLinkData; remove: () => void }) {
	return (
		<span className={link.archived ? "chip archived" : "chip"}>
			<span className="cap">{linkKinds[link.type]}</span>
			{link.type === "work_item" ? (
				<Link to="/v/$slug/work" params={{ slug: link.ventureSlug }} search={{ item: link.id }} title={link.label}>
					{link.label}
				</Link>
			) : (
				<Link to="/v/$slug" params={{ slug: link.ventureSlug }} title={link.label}>
					{link.label}
				</Link>
			)}
			<button type="button" aria-label={`Remove link to ${link.label}`} onClick={remove}>
				<Icon name="x" />
			</button>
		</span>
	);
}

function useLinkTargets(query: string, scope: Scope) {
	const ventureId = scope.venture?.id ?? null;

	return useQuery({
		queryKey: ["link-targets", ventureId ?? "holding", query],
		queryFn: () => api.linkTargets(query, ventureId),
		placeholderData: (previous) => previous,
	});
}

function targetKey(target: { type: ThreadLinkType; id: string }) {
	return `${target.type}:${target.id}`;
}

function useActiveOption(options: LinkTarget[]) {
	const [key, setKey] = useState<string | null>(null);
	const found = options.findIndex((option) => targetKey(option) === key);
	const index = found === -1 ? 0 : found;

	const pick = (next: number) => {
		const target = options[Math.min(Math.max(next, 0), options.length - 1)];

		if (target !== undefined) setKey(targetKey(target));
	};

	return {
		index,
		current: options[index],
		move: (step: number) => pick(index + step),
		hover: pick,
		reset: () => setKey(null),
	};
}

function TargetList({
	targets,
	active,
	listId,
	showVenture,
	choose,
	hover,
}: {
	targets: LinkTarget[];
	active: number;
	listId: string;
	showVenture: boolean;
	choose: (target: LinkTarget) => void;
	hover: (index: number) => void;
}) {
	return (
		<div id={listId} role="listbox" aria-label="Link targets">
			{targets.map((target, index) => (
				<div
					key={`${target.type}:${target.id}`}
					id={`${listId}-${index}`}
					role="option"
					tabIndex={-1}
					aria-selected={index === active}
					className={index === active ? "opt on" : "opt"}
					onMouseDown={(event) => {
						event.preventDefault();

						choose(target);
					}}
					onMouseEnter={() => hover(index)}
				>
					<span>{target.label}</span>
					<span className="sub">
						{target.detail}
						{showVenture ? ` · ${target.ventureName}` : null}
					</span>
				</div>
			))}
		</div>
	);
}

function LinkSearch({
	scope,
	exclude,
	close,
	choose,
}: {
	scope: Scope;
	exclude: { type: ThreadLinkType; id: string }[];
	close: () => void;
	choose: (target: LinkTarget) => void;
}) {
	const [query, setQuery] = useState("");
	const listId = useId();
	const targets = useLinkTargets(query, scope);

	const options = (targets.data?.targets ?? []).filter(
		(target) => !exclude.some((link) => link.type === target.type && link.id === target.id),
	);

	const active = useActiveOption(options);

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "ArrowDown") {
			event.preventDefault();

			active.move(1);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();

			active.move(-1);
		} else if (event.key === "Enter") {
			event.preventDefault();

			if (active.current !== undefined) choose(active.current);
		} else if (event.key === "Escape") {
			event.preventDefault();

			close();
		}
	};

	return (
		<div className="pop link-pop">
			<input
				className="inp"
				role="combobox"
				aria-expanded
				aria-controls={listId}
				aria-activedescendant={options.length === 0 ? undefined : `${listId}-${active.index}`}
				aria-label="Search work items, objectives, assumptions, bets and ventures"
				placeholder="Search work, objectives, bets…"
				value={query}
				ref={(element) => element?.focus()}
				onChange={(event) => {
					setQuery(event.target.value);

					active.reset();
				}}
				onKeyDown={onKeyDown}
				onBlur={close}
			/>
			{options.length === 0 ? (
				<p className="pal-none">{targets.isFetching ? "Searching…" : "Nothing matches."}</p>
			) : (
				<TargetList
					targets={options}
					active={active.index}
					listId={listId}
					showVenture={scope.venture === null}
					choose={choose}
					hover={active.hover}
				/>
			)}
		</div>
	);
}

function mentionAt(text: string, caret: number) {
	const before = text.slice(0, caret);
	const match = /(^|\s)@([^\s@]{0,40})$/u.exec(before);

	if (match === null) return null;

	return { start: caret - (match[2]?.length ?? 0) - 1, query: match[2] ?? "" };
}

function Composer({
	scope,
	initialLinks,
	busy,
	working,
	error,
	autoFocus = false,
	agentName,
	submit,
}: {
	scope: Scope;
	initialLinks: DraftLink[];
	busy: boolean;
	working: boolean;
	error: unknown;
	autoFocus?: boolean;
	agentName: string;
	submit: (body: string, links: DraftLink[], sent: () => void) => void;
}) {
	const [body, setBody] = useState("");
	const [links, setLinks] = useState<DraftLink[]>(initialLinks);
	const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
	const field = useRef<HTMLTextAreaElement>(null);
	const listId = useId();
	const hintId = useId();
	const targets = useLinkTargets(mention?.query ?? "", scope);

	const options =
		mention === null
			? []
			: (targets.data?.targets ?? []).filter(
					(target) => !links.some((link) => link.type === target.type && link.id === target.id),
				);

	const active = useActiveOption(options);
	const canSend = body.trim() !== "" && !busy && !working;

	useEffect(() => {
		if (autoFocus) field.current?.focus();
	}, [autoFocus]);

	const send = () => {
		if (!canSend) return;

		submit(body.trim(), links, () => {
			setBody("");

			setLinks([]);
		});
	};

	const choose = (target: LinkTarget) => {
		const element = field.current;

		if (mention === null || element === null) return;

		const caret = element.selectionStart;
		const before = body.slice(0, mention.start).replace(/[ \t]+$/u, "");
		const after = body.slice(caret).replace(/^[ \t]+/u, "");
		const joiner = before === "" || after === "" ? "" : " ";

		setBody(`${before}${joiner}${after}`);

		setLinks((current) => [...current, { type: target.type, id: target.id, label: target.label }]);

		setMention(null);

		const position = before.length + joiner.length;

		requestAnimationFrame(() => element.setSelectionRange(position, position));
	};

	const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
		setBody(event.target.value);

		setMention(mentionAt(event.target.value, event.target.selectionStart));

		active.reset();
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (mention !== null && options.length > 0) {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();

				active.move(event.key === "ArrowDown" ? 1 : -1);

				return;
			}

			if (event.key === "Enter" || event.key === "Tab") {
				event.preventDefault();

				if (active.current !== undefined) choose(active.current);

				return;
			}
		}

		if (event.key === "Escape" && mention !== null) {
			event.preventDefault();

			setMention(null);

			return;
		}

		if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
			event.preventDefault();

			send();
		}
	};

	return (
		<div className="comp">
			{mention === null ? null : (
				<div className="pop link-pop above">
					{options.length === 0 ? (
						<p className="pal-none">{targets.isFetching ? "Searching…" : "Nothing to link matches."}</p>
					) : (
						<TargetList
							targets={options}
							active={active.index}
							listId={listId}
							showVenture={scope.venture === null}
							choose={choose}
							hover={active.hover}
						/>
					)}
				</div>
			)}
			{links.length === 0 ? null : (
				<fieldset className="comp-links">
					<legend className="vh">Links sent with this message</legend>
					{links.map((link) => (
						<span key={`${link.type}:${link.id}`} className="chip">
							<span className="cap">{linkKinds[link.type]}</span>
							<span>{link.label}</span>
							<button
								type="button"
								aria-label={`Don't link ${link.label}`}
								onClick={() => setLinks((current) => current.filter((other) => other !== link))}
							>
								<Icon name="x" />
							</button>
						</span>
					))}
				</fieldset>
			)}
			<textarea
				ref={field}
				rows={2}
				value={body}
				placeholder={working ? `${agentName} is working on a reply…` : `Message ${agentName}`}
				aria-label="Message"
				aria-describedby={hintId}
				aria-activedescendant={mention !== null && options.length > 0 ? `${listId}-${active.index}` : undefined}
				onChange={onChange}
				onKeyDown={onKeyDown}
				onBlur={() => setMention(null)}
			/>
			<div className="comp-f">
				<span id={hintId}>
					{error === null ? (
						working ? (
							`${agentName} is replying. Stop it, or wait to send the next message.`
						) : (
							"↵ send · ⇧↵ new line · @ to link work, objectives or bets"
						)
					) : (
						<span className="err" role="alert">
							{describeError(error)}
						</span>
					)}
				</span>
				<span className="grow" />
				<button type="button" className="btn pri sm" disabled={!canSend} onClick={send}>
					Send
				</button>
			</div>
		</div>
	);
}

function SystemLine({ message }: { message: ThreadMessage }) {
	return (
		<li className="sys">
			<span>
				{message.body} ·{" "}
				<time dateTime={message.createdAt} title={formatDateTime(message.createdAt)}>
					{clockTime(message.createdAt)}
				</time>
			</span>
		</li>
	);
}

function OwnerMessage({ message }: { message: ThreadMessage }) {
	return (
		<li className="turn you">
			<div className="turn-m">
				<time className="mono" dateTime={message.createdAt} title={formatDateTime(message.createdAt)}>
					{clockTime(message.createdAt)}
				</time>
				<b>{actorName(message.author)}</b>
				<You size={13} />
			</div>
			<div className="bubble">
				<p>{message.body}</p>
			</div>
		</li>
	);
}

function Prose({ text, live = false }: { text: string; live?: boolean }) {
	return (
		<div className={live ? "step say live" : "step say"}>
			<Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
		</div>
	);
}

function formatDuration(ms: number) {
	if (ms < 1_000) return `${ms}ms`;

	if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;

	return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1_000)}s`;
}

function formatTokens(count: number) {
	return count < 1_000 ? `${count}` : `${(count / 1_000).toFixed(1)}k`;
}

function CardLinks({ segments }: { segments: Segment[] }) {
	const inbox = useQuery(queries.inbox()).data;
	const pending = new Set((inbox?.pending ?? []).map((item) => item.id));
	const decided = new Map((inbox?.decided ?? []).map((item) => [item.id, item.status]));
	const proposals = proposalsOf(segments);

	const requests = new Map(
		segments
			.flatMap((segment) => (segment.kind === "tools" ? segment.calls : []))
			.map(accessRequestOf)
			.filter((request) => request !== null)
			.map((request) => [request.id, request]),
	);

	const state = (id: string, waiting: string) => (pending.has(id) ? waiting : (decided.get(id) ?? waiting));

	return (
		<>
			{proposals.map((proposal) => (
				<div key={proposal.id} className="step">
					<Link to="/inbox" search={{ proposal: proposal.id }} className="card-link">
						{pending.has(proposal.id) ? <Need /> : <Icon name="inbox" />}
						<span className="cap">Proposal</span>
						<b>{proposal.title}</b>
						<span className="mute">
							{state(
								proposal.id,
								`${proposal.changeCount} ${proposal.changeCount === 1 ? "change" : "changes"} · decide in the inbox`,
							)}
						</span>
						<Icon name="right" />
					</Link>
				</div>
			))}
			{[...requests.values()].map((request) => (
				<div key={request.id} className="step">
					<Link to="/inbox" search={{ access: request.id }} className="card-link">
						{pending.has(request.id) ? <Need /> : <Icon name="key" />}
						<span className="cap">Access</span>
						<b>{request.label}</b>
						<span className="mute">{state(request.id, "decide in the inbox")}</span>
						<Icon name="right" />
					</Link>
				</div>
			))}
		</>
	);
}

function StopButton({ run }: { run: Run }) {
	const client = useQueryClient();

	const cancel = useCommand<"run.cancel", unknown>("run.cancel", () => {
		void client.invalidateQueries({ queryKey: keys.thread(run.threadId) });

		void client.invalidateQueries({ queryKey: keys.activeRuns });
	});

	return (
		<>
			<button
				type="button"
				className="btn sm"
				disabled={cancel.isPending || run.cancelRequestedAt !== null}
				onClick={() => cancel.mutate({ payload: { runId: run.id } })}
			>
				<Icon name="stop" />
				{cancel.isPending || run.cancelRequestedAt !== null ? "Stopping…" : "Stop"}
			</button>
			{cancel.error === null ? null : (
				<span className="err" role="alert">
					{describeError(cancel.error)}
				</span>
			)}
		</>
	);
}

function RunEntry({
	run,
	segments,
	latest,
	tail,
}: {
	run: Run;
	segments: Segment[];
	latest: boolean;
	tail: LiveBlock | null;
}) {
	const agentOf = useAgentLookup();
	const active = isActive(run.status);
	const lastSegment = segments.at(-1);

	const pendingCall =
		lastSegment?.kind === "tools" ? lastSegment.calls.find((call) => call.result === null) : undefined;

	const startedAt = run.startedAt ?? run.createdAt;

	const doing =
		run.status === "queued"
			? "Waiting to start"
			: pendingCall !== undefined
				? describeCall(pendingCall).action
				: tail !== null
					? "Writing"
					: segments.length === 0
						? "Thinking"
						: "Working";

	return (
		<li className={active ? "turn run live" : "turn run"}>
			<div className="run-h">
				<span className="orb">
					<Drone size={17} run={active} square={isSquare(agentOf(run.actor))} />
				</span>
				<b>{actorName(run.actor)}</b>
				<time className="mono" dateTime={startedAt} title={formatDateTime(startedAt)}>
					{clockTime(startedAt)}
				</time>
			</div>
			<div className="trace">
				{segments.map((segment, index) =>
					segment.kind === "tools" ? (
						<ToolGroup key={segment.calls[0]?.id ?? index} calls={segment.calls} />
					) : (
						<Prose key={`text-${segment.block}`} text={segment.text} />
					),
				)}
				{tail === null || tail.broken ? null : <Prose text={tail.text} live />}
				<CardLinks segments={segments} />
				{active ? (
					<div className="step now">
						<Cast label={doing} since={startedAt} />
						<StopButton run={run} />
					</div>
				) : (
					<RunFoot run={run} latest={latest} />
				)}
			</div>
		</li>
	);
}

function RunFoot({ run, latest }: { run: Run; latest: boolean }) {
	const client = useQueryClient();

	const retry = useCommand<"run.retry", unknown>("run.retry", () => {
		void client.invalidateQueries({ queryKey: keys.thread(run.threadId) });

		void client.invalidateQueries({ queryKey: keys.activeRuns });
	});

	const usage = run.usage;

	const tokens =
		usage === null
			? null
			: usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;

	const word = statusWords[run.status] ?? "Finished";
	const retryable = latest && (run.status === "failed" || run.status === "interrupted");

	return (
		<div className={run.status === "succeeded" ? "step end" : "step end ended"}>
			<span>
				{word}
				{usage === null ? null : ` in ${formatDuration(usage.durationMs)}`}
				{tokens === null ? null : ` · used ${formatTokens(tokens)} tokens`}
			</span>
			<span className="mono">{run.model}</span>
			{run.error === null ? null : (
				<span className={run.status === "failed" ? "err" : "mute"}>{run.error.message}</span>
			)}
			{retryable ? (
				<button
					type="button"
					className="btn sm"
					disabled={retry.isPending}
					onClick={() => retry.mutate({ payload: { runId: run.id } })}
				>
					<Icon name="retry" />
					Retry
				</button>
			) : null}
			{retry.error === null ? null : (
				<span className="err" role="alert">
					{describeError(retry.error)}
				</span>
			)}
		</div>
	);
}

function ToolGroup({ calls }: { calls: ToolCall[] }) {
	return (
		<div className="step tl-tool">
			<div className="tgrp">
				{calls.map((call) => (
					<ToolRow key={call.id} call={call} />
				))}
			</div>
		</div>
	);
}

function formatJson(value: unknown) {
	return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function prettyOutput(output: string) {
	const result = parseJson(output);

	return result.ok ? JSON.stringify(result.value, null, 2) : output;
}

function ToolRow({ call }: { call: ToolCall }) {
	const [open, setOpen] = useState(false);
	const { action, detail } = describeCall(call);
	const failed = call.result?.isError === true;
	const sql = call.name === "query" ? (call.input as { sql?: unknown }).sql : undefined;

	return (
		<>
			<button type="button" className="tool" aria-expanded={open} onClick={() => setOpen(!open)}>
				<Icon name="chevr" />
				<b>{action}</b>
				<span className="a">{failed ? null : detail}</span>
				{call.result === null ? (
					<span className="d">running…</span>
				) : failed ? (
					<span className="d bad">failed</span>
				) : (
					<Icon name="check" className="ok" />
				)}
			</button>
			{open ? (
				<div className="tool-io">
					<b>{call.name}</b>
					<pre>{typeof sql === "string" ? sql : formatJson(call.input)}</pre>
					{call.result === null ? null : (
						<>
							<b>{failed ? "Error" : "Result"}</b>
							<pre className={failed ? "bad" : undefined}>{prettyOutput(call.result.output)}</pre>
						</>
					)}
				</div>
			) : null}
		</>
	);
}

export function WorkItemThreads({
	workItem,
	venture,
}: {
	workItem: { id: string; title: string };
	venture: { slug: string };
}) {
	const threads = useQuery(queries.threads({ subject: `work_item:${workItem.id}` }));
	const agentOf = useAgentLookup();
	const now = Date.now();

	return (
		<section>
			<h3>
				Threads
				{threads.isSuccess ? <span className="cnt">{threads.data.threads.length}</span> : null}
			</h3>
			{threads.isPending ? (
				<Skeleton label="Loading threads…" widths={[60]} />
			) : threads.isError ? (
				<p className="err">{describeError(threads.error)}</p>
			) : threads.data.threads.length === 0 ? (
				<p className="none">No threads about this yet. Start one and the agent gets this item as context.</p>
			) : (
				<ul className="tcards">
					{threads.data.threads.map((thread) => {
						const agent = agentOf(thread.agentProfileId);

						return (
							<li key={thread.id}>
								<ThreadLink ventureSlug={venture.slug} threadId={thread.id} className="tcard">
									<Drone size={18} run={thread.activeRun !== null} square={isSquare(agent)} />
									<b>{thread.title}</b>
									<span>
										{agent?.name ?? "Agent"} ·{" "}
										{thread.activeRun === null ? ago(thread.updatedAt, now) : "working now"}
									</span>
									<Icon name="right" />
								</ThreadLink>
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}
