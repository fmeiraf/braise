import {
	activeRunStatuses,
	type LinkTarget,
	type Run,
	type RunStatus,
	type ThreadDetail,
	type ThreadLink,
	type ThreadLinkType,
	type ThreadMessage,
	type ThreadSummary,
} from "@braise/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { ArrowUp, ChevronRight, Link2, Plus, RotateCcw, Square, X } from "lucide-react";
import {
	type ChangeEvent,
	type KeyboardEvent,
	type MouseEvent,
	type ReactNode,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "./api.ts";
import { Editable } from "./editable.tsx";
import { describeError } from "./errors.ts";
import { PageError } from "./holding.tsx";
import { keys, queries } from "./live.ts";
import { useThreadStream } from "./thread-stream.ts";
import {
	actorName,
	buildTimeline,
	describeCall,
	type LiveBlock,
	type LiveRuns,
	liveTail,
	plainSnippet,
	type Segment,
	summarizeTools,
	type ToolCall,
	writeTools,
} from "./thread-timeline.ts";
import { ago, formatDateTime } from "./time.ts";
import { useCommand } from "./use-command.ts";

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
	goal: "Goal",
	bet: "Bet",
	venture: "Venture",
};

const statusWords: Partial<Record<RunStatus, string>> = {
	queued: "Waiting to start",
	cancelled: "Stopped",
	failed: "Failed",
	interrupted: "Interrupted",
};

const clock = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" });

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

	if (ventures.isPending) return <ThreadsSkeleton />;

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
	const venture = scope.venture;

	return (
		<>
			<header className="topbar">
				<Link to="/" className="crumb">
					Holding
				</Link>
				<span className="muted" aria-hidden>
					/
				</span>
				{venture === null ? null : (
					<>
						<Link to="/v/$slug" params={{ slug: venture.slug }} className="crumb">
							{venture.name}
						</Link>
						<span className="muted" aria-hidden>
							/
						</span>
					</>
				)}
				<span className="crumb-current">Threads</span>
				<div className="topbar-actions">
					<button type="button" className="button is-primary" onClick={() => open(null)}>
						<Plus aria-hidden />
						New thread
					</button>
				</div>
			</header>

			<div className="threads-layout">
				<ThreadList scope={scope} selectedId={selectedId} />
				{selectedId === null ? (
					<NewThread
						key={draftLinks.map((link) => link.id).join()}
						scope={scope}
						draftLinks={draftLinks}
						open={open}
					/>
				) : (
					<Conversation key={selectedId} threadId={selectedId} scope={scope} />
				)}
			</div>
		</>
	);
}

function ThreadList({ scope, selectedId }: { scope: Scope; selectedId: string | null }) {
	const filter = scope.venture === null ? {} : { ventureId: scope.venture.id };
	const threads = useQuery(queries.threads(filter));
	const now = Date.now();

	return (
		<nav className="thread-list" aria-label="Threads">
			{threads.isPending ? (
				<div className="skeleton-stack thread-list-loading" aria-busy="true">
					<span className="visually-hidden">Loading threads…</span>
					{[70, 90, 60, 80].map((width) => (
						<span key={width} className="skeleton" style={{ width: `${width}%` }} />
					))}
				</div>
			) : threads.isError ? (
				<p className="error-text thread-list-note" role="alert">
					{describeError(threads.error)}
				</p>
			) : threads.data.threads.length === 0 ? (
				<p className="thread-list-note muted">No threads yet. Start one to talk with Claude.</p>
			) : (
				<ul>
					{threads.data.threads.map((thread) => (
						<li key={thread.id}>
							<ThreadRow thread={thread} scope={scope} selected={thread.id === selectedId} now={now} />
						</li>
					))}
				</ul>
			)}
		</nav>
	);
}

function ThreadRow({
	thread,
	scope,
	selected,
	now,
}: {
	thread: ThreadSummary;
	scope: Scope;
	selected: boolean;
	now: number;
}) {
	const running = thread.activeRun !== null;

	const snippet =
		thread.lastMessage === null
			? null
			: `${actorName(thread.lastMessage.author)}: ${plainSnippet(thread.lastMessage.body)}`;

	const ventureName =
		scope.venture === null
			? (thread.links.find((link) => link.ventureId === thread.ventureId)?.ventureName ?? null)
			: null;

	const className = ["thread-row", selected ? "is-selected" : ""].join(" ");

	const body = (
		<>
			<span className={running ? "pixel is-live" : "pixel thread-row-mark"} aria-hidden />
			<span className="thread-row-main">
				<span className="thread-row-top">
					<span className="thread-row-title">{thread.title}</span>
					<time className="thread-row-time" dateTime={thread.updatedAt} title={formatDateTime(thread.updatedAt)}>
						{running ? "working" : ago(thread.updatedAt, now)}
					</time>
				</span>
				{snippet === null ? null : <span className="thread-row-snippet">{snippet}</span>}
				{thread.links.length === 0 && ventureName === null ? null : (
					<span className="thread-row-links">
						{ventureName === null ? null : <span className="thread-row-venture">{ventureName}</span>}
						{thread.links.slice(0, 1).map((link) => (
							<span key={`${link.type}:${link.id}`} className="tag">
								{link.label}
							</span>
						))}
						{thread.links.length > 1 ? <span className="muted">+{thread.links.length - 1}</span> : null}
					</span>
				)}
			</span>
		</>
	);

	return scope.venture === null ? (
		<Link
			to="/threads"
			search={{ thread: thread.id }}
			className={className}
			aria-current={selected ? "page" : undefined}
		>
			{body}
		</Link>
	) : (
		<Link
			to="/v/$slug/threads"
			params={{ slug: scope.venture.slug }}
			search={{ thread: thread.id }}
			className={className}
			aria-current={selected ? "page" : undefined}
		>
			{body}
		</Link>
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

	const start = useCommand<"thread.start", { thread: { id: string } }>("thread.start", (response) => {
		void client.invalidateQueries({ queryKey: keys.threads });

		void client.invalidateQueries({ queryKey: keys.activeRuns });

		open(response.result.thread.id);
	});

	return (
		<section className="conversation" aria-label="New thread">
			<div className="conversation-scroll">
				<div className="new-thread">
					<h2>New thread</h2>
					<p className="muted">
						{scope.venture === null
							? "Ask Claude about any venture. It can read everything in braise and change work items."
							: `Ask Claude about ${scope.venture.name}. It can read everything in braise and change work items.`}
					</p>
					<p className="muted">Type @ to link work items, goals, bets or ventures.</p>
				</div>
			</div>
			<Composer
				scope={scope}
				initialLinks={draftLinks}
				busy={start.isPending}
				activeRun={null}
				error={start.error}
				autoFocus
				submit={(body, links, sent) =>
					start.mutate(
						{
							payload: {
								...(scope.venture === null ? {} : { ventureId: scope.venture.id }),
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
		if (event.target instanceof Element && event.target.closest("summary") !== null) pinned.current = false;
	};

	return { scroller, content, onScroll, onClickCapture };
}

function Conversation({ threadId, scope }: { threadId: string; scope: Scope }) {
	const detail = useQuery(queries.thread(threadId));
	const { live, down } = useThreadStream(threadId);

	if (detail.isPending) {
		return (
			<section className="conversation" aria-busy="true">
				<div className="conversation-scroll">
					<div className="skeleton-stack conversation-loading">
						<span className="visually-hidden">Loading the thread…</span>
						{[40, 85, 70, 90, 55].map((width) => (
							<span key={width} className="skeleton" style={{ width: `${width}%` }} />
						))}
					</div>
				</div>
			</section>
		);
	}

	if (detail.isError) {
		return (
			<section className="conversation">
				<PageError error={detail.error} retry={() => void detail.refetch()} />
			</section>
		);
	}

	const activeRun = detail.data.runs.find((run) => isActive(run.status)) ?? null;
	const archived = detail.data.thread.archivedAt !== null;

	return (
		<section className="conversation" aria-label={detail.data.thread.title}>
			<ConversationHead detail={detail.data} scope={scope} />
			<Timeline detail={detail.data} live={live} />
			{down ? (
				<output className="conversation-down">
					<span className="pixel" aria-hidden />
					Reconnecting to the live reply…
				</output>
			) : null}
			{archived ? (
				<p className="conversation-archived muted">This thread is archived.</p>
			) : (
				<PostComposer threadId={threadId} scope={scope} activeRun={activeRun} />
			)}
		</section>
	);
}

function Timeline({ detail, live }: { detail: ThreadDetail; live: LiveRuns }) {
	const timeline = buildTimeline(detail);
	const scroll = useStickToBottom();

	return (
		<div className="conversation-scroll" ref={scroll.scroller} onScroll={scroll.onScroll}>
			<ol className="timeline" ref={scroll.content}>
				{timeline.map((entry) =>
					entry.kind === "message" ? (
						<OwnerMessage key={entry.message.id} message={entry.message} />
					) : (
						<RunEntry
							key={entry.run.id}
							run={entry.run}
							segments={entry.segments}
							latest={entry.latest}
							tail={liveTail(live, entry.run, entry.segments)}
						/>
					),
				)}
			</ol>
		</div>
	);
}

function PostComposer({ threadId, scope, activeRun }: { threadId: string; scope: Scope; activeRun: Run | null }) {
	const client = useQueryClient();

	const refresh = () => {
		void client.invalidateQueries({ queryKey: keys.thread(threadId) });

		void client.invalidateQueries({ queryKey: keys.activeRuns });
	};

	const post = useCommand<"thread.post", unknown>("thread.post", refresh);
	const cancel = useCommand<"run.cancel", unknown>("run.cancel", refresh);

	return (
		<Composer
			scope={scope}
			initialLinks={[]}
			busy={post.isPending}
			activeRun={activeRun}
			error={post.error ?? cancel.error}
			stop={activeRun === null ? undefined : () => cancel.mutate({ payload: { runId: activeRun.id } })}
			stopping={cancel.isPending}
			submit={(body, links, sent) =>
				post.mutate(
					{ payload: { threadId, body, links: links.map(({ type, id }) => ({ type, id })) } },
					{ onSuccess: sent },
				)
			}
		/>
	);
}

function ConversationHead({ detail, scope }: { detail: ThreadDetail; scope: Scope }) {
	const client = useQueryClient();
	const threadId = detail.thread.id;
	const refresh = () => void client.invalidateQueries({ queryKey: keys.thread(threadId) });
	const rename = useCommand<"thread.rename", unknown>("thread.rename", refresh);
	const link = useCommand<"thread.link", unknown>("thread.link", refresh);
	const unlink = useCommand<"thread.unlink", unknown>("thread.unlink", refresh);
	const [picking, setPicking] = useState(false);
	const error = link.error ?? unlink.error;
	const linkScope = detail.venture === null ? scope : { venture: detail.venture };

	return (
		<header className="conversation-head">
			<div className="conversation-title">
				<Editable
					label="thread title"
					value={detail.thread.title}
					required
					save={(title) => rename.mutateAsync({ payload: { threadId, title } })}
				/>
				{detail.venture === null || scope.venture !== null ? null : (
					<span className="conversation-venture">{detail.venture.name}</span>
				)}
			</div>
			<div className="conversation-links">
				{detail.links.map((item) => (
					<LinkTag
						key={`${item.type}:${item.id}`}
						link={item}
						remove={() => unlink.mutate({ payload: { threadId, link: { type: item.type, id: item.id } } })}
					/>
				))}
				<div className="link-picker-anchor">
					<button
						type="button"
						className="button is-ghost is-small"
						aria-expanded={picking}
						onClick={() => setPicking((current) => !current)}
					>
						<Link2 aria-hidden />
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
			</div>
			{error === null ? null : (
				<p className="error-text" role="alert">
					{describeError(error)}
				</p>
			)}
		</header>
	);
}

function linkPath(link: ThreadLink) {
	switch (link.type) {
		case "work_item":
			return { to: "/v/$slug/work" as const, params: { slug: link.ventureSlug }, search: { item: link.id } };
		case "venture":
			return { to: "/v/$slug" as const, params: { slug: link.ventureSlug }, search: {} };
		default:
			return { to: "/v/$slug" as const, params: { slug: link.ventureSlug }, search: {} };
	}
}

function LinkTag({ link, remove }: { link: ThreadLink; remove: () => void }) {
	const path = linkPath(link);

	return (
		<span className={link.archived ? "link-tag is-archived" : "link-tag"}>
			<span className="link-tag-kind">{linkKinds[link.type]}</span>
			{path.to === "/v/$slug/work" ? (
				<Link to={path.to} params={path.params} search={path.search} className="link-tag-label" title={link.label}>
					{link.label}
				</Link>
			) : (
				<Link to={path.to} params={path.params} className="link-tag-label" title={link.label}>
					{link.label}
				</Link>
			)}
			<button type="button" className="link-tag-remove" aria-label={`Remove link to ${link.label}`} onClick={remove}>
				<X aria-hidden />
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
		<div className="link-options" id={listId} role="listbox" aria-label="Link targets">
			{targets.map((target, index) => (
				<div
					key={`${target.type}:${target.id}`}
					id={`${listId}-${index}`}
					role="option"
					tabIndex={-1}
					aria-selected={index === active}
					className={index === active ? "link-option is-active" : "link-option"}
					onMouseDown={(event) => {
						event.preventDefault();

						choose(target);
					}}
					onMouseEnter={() => hover(index)}
				>
					<span className="link-option-kind">{target.detail}</span>
					<span className="link-option-label">{target.label}</span>
					{showVenture ? <span className="link-option-venture">{target.ventureName}</span> : null}
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
			close();
		}
	};

	return (
		<div className="link-popover is-below">
			<input
				className="input link-search"
				role="combobox"
				aria-expanded
				aria-controls={listId}
				aria-activedescendant={options.length === 0 ? undefined : `${listId}-${active.index}`}
				aria-label="Search work items, goals, bets and ventures"
				placeholder="Search work, goals, bets…"
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
				<p className="link-empty muted">{targets.isFetching ? "Searching…" : "Nothing matches."}</p>
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
	activeRun,
	error,
	autoFocus = false,
	stop,
	stopping = false,
	submit,
}: {
	scope: Scope;
	initialLinks: DraftLink[];
	busy: boolean;
	activeRun: Run | null;
	error: unknown;
	autoFocus?: boolean;
	stop?: () => void;
	stopping?: boolean;
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
	const working = activeRun !== null;
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
		<div className="composer">
			{links.length === 0 ? null : (
				<fieldset className="composer-links">
					<legend className="visually-hidden">Links sent with this message</legend>
					{links.map((link) => (
						<span key={`${link.type}:${link.id}`} className="link-tag">
							<span className="link-tag-kind">{linkKinds[link.type]}</span>
							<span className="link-tag-label">{link.label}</span>
							<button
								type="button"
								className="link-tag-remove"
								aria-label={`Don't link ${link.label}`}
								onClick={() => setLinks((current) => current.filter((other) => other !== link))}
							>
								<X aria-hidden />
							</button>
						</span>
					))}
				</fieldset>
			)}
			<div className="composer-box">
				{mention === null ? null : (
					<div className="link-popover is-above">
						{options.length === 0 ? (
							<p className="link-empty muted">
								{targets.isFetching ? "Searching…" : "Nothing to link matches."}
							</p>
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
				<textarea
					ref={field}
					className="composer-field"
					rows={1}
					value={body}
					placeholder={working ? "Claude is working on a reply…" : "Message Claude"}
					aria-label="Message"
					aria-describedby={hintId}
					aria-activedescendant={mention !== null && options.length > 0 ? `${listId}-${active.index}` : undefined}
					onChange={onChange}
					onKeyDown={onKeyDown}
					onBlur={() => setMention(null)}
				/>
				{working && stop !== undefined ? (
					<button type="button" className="button composer-action" disabled={stopping} onClick={stop}>
						<Square aria-hidden />
						Stop
					</button>
				) : (
					<button
						type="button"
						className="button is-primary composer-action"
						disabled={!canSend}
						aria-label="Send"
						onClick={send}
					>
						<ArrowUp aria-hidden />
						Send
					</button>
				)}
			</div>
			<p className="composer-hint" id={hintId}>
				{error === null ? (
					working ? (
						"Claude is replying. Stop it, or wait to send the next message."
					) : (
						<>
							<kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line · <kbd>@</kbd> to link
						</>
					)
				) : (
					<span className="error-text" role="alert">
						{describeError(error)}
					</span>
				)}
			</p>
		</div>
	);
}

function MessageHead({
	author,
	at,
	mark,
	children,
}: {
	author: string;
	at: string;
	mark: string;
	children?: ReactNode;
}) {
	return (
		<div className="message-head">
			<span className={mark} aria-hidden />
			<span className="message-author">{actorName(author)}</span>
			<time className="message-time data" dateTime={at} title={formatDateTime(at)}>
				{clock.format(new Date(at))}
			</time>
			{children}
		</div>
	);
}

function OwnerMessage({ message }: { message: ThreadMessage }) {
	return (
		<li className="message">
			<MessageHead author={message.author} at={message.createdAt} mark="author-mark is-owner" />
			<p className="message-body is-plain">{message.body}</p>
		</li>
	);
}

function Prose({ text, live = false }: { text: string; live?: boolean }) {
	return (
		<div className={live ? "prose is-live" : "prose"}>
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
	const active = isActive(run.status);
	const lastSegment = segments.at(-1);
	const pendingTools = lastSegment?.kind === "tools" && lastSegment.calls.some((call) => call.result === null);
	const thinking = run.status === "running" && tail === null && !pendingTools;

	return (
		<li className="message is-agent">
			<MessageHead
				author={run.actor}
				at={run.startedAt ?? run.createdAt}
				mark={active ? "author-mark is-agent is-live" : "author-mark is-agent"}
			/>
			<div className="message-body">
				{segments.map((segment, index) =>
					segment.kind === "tools" ? (
						<ToolGroup
							key={segment.calls[0]?.id ?? index}
							calls={segment.calls}
							live={active && index === segments.length - 1}
						/>
					) : (
						<Prose key={`text-${segment.block}`} text={segment.text} />
					),
				)}
				{tail === null ? null : tail.broken ? (
					<p className="run-working">
						<span className="pixel is-live" aria-hidden />
						Writing…
					</p>
				) : (
					<Prose text={tail.text} live />
				)}
				{run.status === "queued" ? (
					<p className="run-working">
						<span className="pixel is-live" aria-hidden />
						Waiting to start…
					</p>
				) : null}
				{thinking ? (
					<p className="run-working">
						<span className="pixel is-live" aria-hidden />
						{segments.length === 0 ? "Thinking…" : "Working…"}
					</p>
				) : null}
				{active ? null : <RunFoot run={run} latest={latest} />}
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

	const word = statusWords[run.status];
	const retryable = latest && (run.status === "failed" || run.status === "interrupted");

	return (
		<div className={run.status === "succeeded" ? "run-foot" : "run-foot is-ended"}>
			{word === undefined ? null : <span className="run-status">{word}</span>}
			{run.error === null ? null : (
				<span className={run.status === "failed" ? "run-error" : "run-error is-note"}>{run.error.message}</span>
			)}
			<span className="data">{run.model}</span>
			{usage === null ? null : <span className="num">{formatDuration(usage.durationMs)}</span>}
			{tokens === null ? null : <span className="num">{formatTokens(tokens)} tokens</span>}
			{retryable ? (
				<button
					type="button"
					className="button is-small"
					disabled={retry.isPending}
					onClick={() => retry.mutate({ payload: { runId: run.id } })}
				>
					<RotateCcw aria-hidden />
					Retry
				</button>
			) : null}
			{retry.error === null ? null : (
				<span className="error-text" role="alert">
					{describeError(retry.error)}
				</span>
			)}
		</div>
	);
}

function ToolGroup({ calls, live }: { calls: ToolCall[]; live: boolean }) {
	const pending = calls.find((call) => call.result === null);
	const changed = calls.some((call) => writeTools.has(call.name) && call.result?.isError === false);

	return (
		<details className="tool-group">
			<summary>
				<ChevronRight className="tool-chevron" aria-hidden />
				{live && pending !== undefined ? (
					<>
						<span className="pixel is-live" aria-hidden />
						<span>{describeCall(pending).action}…</span>
					</>
				) : (
					<span className={changed ? "tool-summary is-changed" : "tool-summary"}>{summarizeTools(calls)}</span>
				)}
			</summary>
			<ol className="tool-calls">
				{calls.map((call) => (
					<ToolRow key={call.id} call={call} />
				))}
			</ol>
		</details>
	);
}

function formatJson(value: unknown) {
	return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function prettyOutput(output: string) {
	try {
		return JSON.stringify(JSON.parse(output), null, 2);
	} catch {
		return output;
	}
}

function ToolRow({ call }: { call: ToolCall }) {
	const { action, detail } = describeCall(call);
	const write = writeTools.has(call.name);
	const failed = call.result?.isError === true;
	const sql = call.name === "query" ? (call.input as { sql?: unknown }).sql : undefined;

	return (
		<li>
			<details className="tool-call">
				<summary>
					<span
						className={[
							"tool-marker",
							write ? "is-write" : "",
							failed ? "is-failed" : "",
							call.result === null ? "is-pending" : "",
						].join(" ")}
						aria-hidden
					/>
					<span className={write ? "tool-action is-write" : "tool-action"}>{action}</span>
					{failed ? <span className="tool-detail is-failed">failed</span> : null}
					{detail === null || failed ? null : <span className="tool-detail">{detail}</span>}
				</summary>
				<div className="tool-io">
					<span className="tool-io-label">{call.name}</span>
					<pre>{typeof sql === "string" ? sql : formatJson(call.input)}</pre>
					{call.result === null ? null : (
						<>
							<span className="tool-io-label">{failed ? "Error" : "Result"}</span>
							<pre className={failed ? "is-failed" : undefined}>{prettyOutput(call.result.output)}</pre>
						</>
					)}
				</div>
			</details>
		</li>
	);
}

function ThreadsSkeleton() {
	return (
		<>
			<header className="topbar">
				<span className="skeleton" style={{ width: 160 }} />
			</header>
			<div className="threads-layout">
				<div className="thread-list skeleton-stack thread-list-loading" aria-busy="true">
					<span className="visually-hidden">Loading threads…</span>
					{[70, 90, 60].map((width) => (
						<span key={width} className="skeleton" style={{ width: `${width}%` }} />
					))}
				</div>
				<div className="conversation" />
			</div>
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
	const navigate = useNavigate();
	const now = Date.now();

	return (
		<div className="work-threads">
			<div className="work-threads-head">
				<span className="field-label">Threads</span>
				<button
					type="button"
					className="button is-ghost is-small"
					onClick={() =>
						void navigate({
							to: "/v/$slug/threads",
							params: { slug: venture.slug },
							search: { link: `work_item:${workItem.id}`, label: workItem.title },
						})
					}
				>
					<Plus aria-hidden />
					New thread
				</button>
			</div>
			{threads.isPending ? (
				<span className="skeleton" style={{ width: "60%" }} />
			) : threads.isError ? (
				<p className="error-text">{describeError(threads.error)}</p>
			) : threads.data.threads.length === 0 ? (
				<p className="muted">No threads about this yet.</p>
			) : (
				<ul className="work-thread-list">
					{threads.data.threads.map((thread) => (
						<li key={thread.id}>
							<Link
								to="/v/$slug/threads"
								params={{ slug: venture.slug }}
								search={{ thread: thread.id }}
								className="work-thread"
							>
								<span
									className={thread.activeRun === null ? "pixel thread-row-mark" : "pixel is-live"}
									aria-hidden
								/>
								<span className="work-thread-title">{thread.title}</span>
								<time className="muted" dateTime={thread.updatedAt}>
									{thread.activeRun === null ? ago(thread.updatedAt, now) : "working"}
								</time>
							</Link>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
