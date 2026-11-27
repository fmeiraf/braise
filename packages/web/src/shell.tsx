import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DraftBar, DraftRoomProvider } from "./draft.tsx";
import { queries, rememberVenture, StreamContext, useHintStream } from "./live.ts";
import { AppIcon, accent, Drone, Elapsed, HoldingIcon, hueOf, Icon, type IconName, isSquare, You } from "./marks.tsx";
import { Select } from "./menu.tsx";
import { OperatorPanel } from "./operator.tsx";
import { Palette } from "./palette.tsx";
import { ago } from "./time.ts";
import { useToasts } from "./toast.ts";
import { toneWords } from "./venture-state.ts";
import { ThreadLink, useVentureTones, useWorking } from "./working.tsx";

const weekMs = 7 * 24 * 60 * 60 * 1000;

const scopedViews = ["overview", "strategy", "work", "threads", "activity", "settings"] as const;

const holdingViews: readonly string[] = ["overview", "work", "threads", "activity"];

type View = (typeof scopedViews)[number] | "inbox" | "agents" | "new";

const fixedViews = new Set<View>(["work", "threads", "inbox"]);

function viewOf(pathname: string) {
	const tail = pathname
		.replace(/^\/v\/[^/]+/u, "")
		.replace(/\/$/u, "")
		.slice(1);

	if (tail === "history") return "strategy";

	return (tail === "" ? "overview" : tail) as View;
}

function scopedPath(view: View, slug: string | null) {
	const prefix = slug === null ? "" : `/v/${slug}`;

	return view === "overview" ? prefix || "/" : `${prefix}/${view}`;
}

const draftViews = { overview: "overview", strategy: "strategy", work: "work" } as const;

const operatorKey = "braise.operator";

function remembered() {
	try {
		return window.localStorage.getItem(operatorKey) === "open";
	} catch {
		return false;
	}
}

function remember(open: boolean) {
	try {
		window.localStorage.setItem(operatorKey, open ? "open" : "closed");
	} catch {
		return;
	}
}

const keyViews: Record<string, View> = {
	"1": "overview",
	"2": "strategy",
	"3": "work",
	"4": "threads",
	"5": "activity",
};

export function Shell() {
	const client = useQueryClient();
	const stream = useHintStream(client);
	const ventures = useQuery(queries.ventures());
	const inbox = useQuery(queries.inbox());
	const agents = useQuery(queries.agents());
	const working = useWorking();
	const toneOf = useVentureTones();
	const navigate = useNavigate();
	const pathname = useLocation({ select: (location) => location.pathname });
	const { slug } = useParams({ strict: false });
	const [palette, setPalette] = useState(false);
	const [operating, setOperating] = useState(remembered);
	const scope = slug ?? null;
	const view = viewOf(pathname);
	const rows = ventures.data?.ventures ?? [];
	const scopeVenture = rows.find((venture) => venture.slug === scope);
	const waiting = inbox.data?.pending.length ?? 0;
	const now = Date.now();

	for (const venture of rows) rememberVenture(venture.id, venture.slug, venture.lastSeq);

	useEffect(() => {
		document.documentElement.style.setProperty("--acc", scope === null ? "var(--ink)" : hueOf(scope));
	}, [scope]);

	const toggleOperator = useCallback((next?: boolean) => {
		setOperating((current) => {
			const value = next ?? !current;

			remember(value);

			return value;
		});
	}, []);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return;

			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();

				setPalette(true);

				return;
			}

			const target = event.target;

			if (event.metaKey || event.ctrlKey || event.altKey) return;

			if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable]") !== null)
				return;

			const key = event.key.toLowerCase();
			const scoped = keyViews[key];

			if (scoped !== undefined && (scope !== null || holdingViews.includes(scoped)))
				void navigate({ to: scopedPath(scoped, scope) });
			else if (key === "o" && scope !== null) toggleOperator();
			else if (key === "i") void navigate({ to: "/inbox" });
			else if (key === "a") void navigate({ to: "/agents" });
			else if (key === "h") void navigate({ to: "/" });
		};

		document.addEventListener("keydown", onKeyDown);

		return () => document.removeEventListener("keydown", onKeyDown);
	}, [navigate, scope, toggleOperator]);

	const slot = (target: View, key: string, label: string, count = 0) => (
		<Link
			to={target === "inbox" || target === "agents" ? `/${target}` : scopedPath(target, scope)}
			className="slot"
			aria-current={view === target ? "page" : undefined}
			activeOptions={{ exact: true, includeSearch: false }}
			data-tip={`${label}|press ${key}`}
		>
			<Icon name={target as IconName} />
			<span>{label}</span>
			{count === 0 ? null : <span className="n">{count}</span>}
		</Link>
	);

	const operatorOpen = operating && scope !== null && scopeVenture !== undefined;
	const draftView = (draftViews as Record<string, (typeof draftViews)[keyof typeof draftViews]>)[view] ?? null;

	const shell = (
		<div className={operatorOpen ? "app op-open" : "app"}>
			<nav className="rail" aria-label="Ventures">
				<Link
					to="/"
					className="r-i"
					aria-label="Holding"
					aria-current={scope === null && scopedViews.includes(view as never) ? "page" : undefined}
					activeOptions={{ exact: true }}
					style={{ "--acc": "var(--ink)" } as React.CSSProperties}
					data-tip="Holding|all ventures"
					data-side="r"
				>
					<HoldingIcon size={58} />
				</Link>
				<span className="r-sep" />
				{rows.map((venture) => {
					const tone = toneOf(venture);
					const quiet = tone === null && now - Date.parse(venture.lastActivityAt) > weekMs;

					return (
						<Link
							key={venture.id}
							to="/v/$slug"
							params={{ slug: venture.slug }}
							className={quiet ? "r-i quiet" : "r-i"}
							aria-label={venture.name}
							aria-current={venture.slug === scope ? "true" : undefined}
							style={accent(venture.slug)}
							data-tip={`${venture.name}|${tone === null ? `v${venture.strategyVersion} · ${ago(venture.lastActivityAt, now)}` : toneWords[tone]}`}
							data-side="r"
						>
							<AppIcon slug={venture.slug} size={58} tone={tone} />
						</Link>
					);
				})}
				<Link
					to="/new"
					className="r-i r-add"
					aria-label="New venture"
					aria-current={view === "new" ? "page" : undefined}
					style={{ "--acc": "var(--ink)" } as React.CSSProperties}
					data-tip="New venture"
					data-side="r"
				>
					<Icon name="plus" />
				</Link>
				<span className="grow" />
				{scope === null ? null : (
					<button
						type="button"
						className="r-i op-rail"
						aria-label="Operator"
						aria-pressed={operatorOpen}
						data-tip="Operator|press O"
						data-side="r"
						onClick={() => toggleOperator()}
					>
						<Drone size={18} />
					</button>
				)}
				<button
					type="button"
					className="r-i"
					aria-label="Jump to anything"
					data-tip="Jump to anything|⌘K"
					data-side="r"
					onClick={() => setPalette(true)}
				>
					<Icon name="search" />
				</button>
				<span className="r-i" data-tip="You|owner" data-side="r">
					<You size={16} />
				</span>
			</nav>

			<main key={pathname} className={fixedViews.has(view) ? "main fixed enter" : "main enter"}>
				<StreamContext value={stream}>
					<Outlet />
				</StreamContext>
			</main>

			{operatorOpen ? (
				<OperatorPanel
					key={scopeVenture.id}
					venture={{ id: scopeVenture.id, slug: scopeVenture.slug, name: scopeVenture.name }}
					close={() => toggleOperator(false)}
				/>
			) : null}

			{scopeVenture === undefined || draftView === null ? null : <DraftBar />}

			<footer className="deck">
				<span />
				<Dock view={view} scope={scope}>
					<Select
						className="hot-scope"
						title="Go to"
						above
						tip="Switch venture|H goes to the holding"
						value={scope ?? ""}
						options={[
							{ value: "", label: "Holding", glyph: <HoldingIcon size={16} />, sub: "All ventures" },
							...rows.map((venture) => ({
								value: venture.slug,
								label: venture.name,
								glyph: <AppIcon slug={venture.slug} size={16} />,
								sub: `v${venture.strategyVersion}`,
								accent: hueOf(venture.slug),
							})),
						]}
						onChange={(next) =>
							void navigate({
								to: scopedPath(
									(next === "" ? holdingViews : scopedViews).includes(view as never) ? view : "overview",
									next === "" ? null : next,
								),
							})
						}
					>
						{scope === null ? <HoldingIcon size={28} /> : <AppIcon slug={scope} size={28} />}
						<span>{scope === null ? "Holding" : (scopeVenture?.name ?? scope)}</span>
						<Icon name="chevd" className="chev" />
					</Select>
					<i className="dock-sep" />
					{slot("overview", "1", "Overview")}
					{scope === null ? null : slot("strategy", "2", "Strategy")}
					{slot("work", "3", "Work")}
					{slot("threads", "4", "Threads")}
					{slot("activity", "5", "Activity")}
					<i className="dock-sep" />
					{slot("inbox", "I", "Inbox", waiting)}
					{slot("agents", "A", "Agents")}
				</Dock>
				<div className="party">
					{(agents.data?.agents ?? []).map((agent) => {
						const busy = working.find((item) => item.agent?.id === agent.id);

						if (busy === undefined) {
							return (
								<Link
									key={agent.id}
									to="/agents"
									className="pf"
									data-tip={`${agent.name}|idle · ${agent.model}`}
								>
									<Drone square={isSquare(agent)} size={16} />
									<span>{agent.name}</span>
								</Link>
							);
						}

						return (
							<ThreadLink
								key={agent.id}
								ventureSlug={busy.run.ventureSlug}
								threadId={busy.run.threadId}
								className="pf run"
								style={accent(busy.run.ventureSlug)}
								tip={`${agent.name}|working on “${busy.run.threadTitle}”`}
							>
								<Drone square={isSquare(agent)} size={16} run />
								<span>{agent.name}</span>
								{busy.run.ventureSlug === null ? null : (
									<span className="where">
										over{" "}
										{rows.find((venture) => venture.slug === busy.run.ventureSlug)?.name ??
											busy.run.ventureSlug}
									</span>
								)}
								<Elapsed since={busy.run.startedAt ?? busy.run.createdAt} />
							</ThreadLink>
						);
					})}
				</div>
			</footer>

			<Tips />
			<Toasts down={stream === "down"} />
			{palette ? (
				<Palette scope={scope} close={() => setPalette(false)} operator={() => toggleOperator(true)} />
			) : null}
		</div>
	);

	if (scopeVenture === undefined) return shell;

	return (
		<DraftRoomProvider slug={scopeVenture.slug} ventureId={scopeVenture.id} view={draftView}>
			{shell}
		</DraftRoomProvider>
	);
}

function Dock({ view, scope, children }: { view: View; scope: string | null; children: React.ReactNode }) {
	const dock = useRef<HTMLElement>(null);
	const thumb = useRef<HTMLElement>(null);
	const last = useRef<{ x: number; w: number } | null>(null);

	useLayoutEffect(() => {
		const current = dock.current?.querySelector<HTMLElement>(".slot[aria-current]");
		const mark = thumb.current;

		if (mark === null) return;

		if (current === null || current === undefined) {
			mark.style.opacity = "0";

			last.current = null;

			return;
		}

		const next = { x: current.offsetLeft, w: current.offsetWidth };
		const before = last.current;

		mark.style.opacity = "";

		mark.style.left = `${next.x}px`;

		mark.style.width = `${next.w}px`;

		if (
			before !== null &&
			(before.x !== next.x || before.w !== next.w) &&
			!window.matchMedia("(prefers-reduced-motion: reduce)").matches
		) {
			mark.animate(
				[
					{ left: `${before.x}px`, width: `${before.w}px` },
					{ left: `${next.x}px`, width: `${next.w}px` },
				],
				{ duration: 300, easing: "cubic-bezier(.2,.8,.2,1)" },
			);
		}

		last.current = next;
	});

	return (
		<nav className="dock" ref={dock} aria-label="Views" data-view={view} data-scope={scope ?? ""}>
			<i className="thumb" ref={thumb} />
			{children}
		</nav>
	);
}

interface Tip {
	label: string;
	hint: string | null;
	rect: DOMRect;
	side: boolean;
}

function Tips() {
	const [tip, setTip] = useState<Tip | null>(null);
	const box = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const show = (event: Event) => {
			const source = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tip]") : null;
			const byPointer = event.type === "focusin" && source?.matches(":focus-visible") !== true;

			if (source === null || byPointer || source.getAttribute("aria-expanded") === "true") {
				setTip(null);

				return;
			}

			const [label = "", hint] = (source.dataset.tip ?? "").split("|");

			setTip({ label, hint: hint ?? null, rect: source.getBoundingClientRect(), side: source.dataset.side === "r" });
		};

		const hide = () => setTip(null);

		document.addEventListener("mouseover", show);

		document.addEventListener("focusin", show);

		document.addEventListener("mousedown", hide);

		document.addEventListener("keydown", hide);

		return () => {
			document.removeEventListener("mouseover", show);

			document.removeEventListener("focusin", show);

			document.removeEventListener("mousedown", hide);

			document.removeEventListener("keydown", hide);
		};
	}, []);

	useLayoutEffect(() => {
		const element = box.current;

		if (element === null || tip === null) return;

		const { rect } = tip;
		const below = rect.top - element.offsetHeight - 8 < 4;
		const x = tip.side ? rect.right + 10 : rect.left + rect.width / 2 - element.offsetWidth / 2;

		const y = tip.side
			? rect.top + rect.height / 2 - element.offsetHeight / 2
			: below
				? rect.bottom + 8
				: rect.top - element.offsetHeight - 8;

		element.style.left = `${Math.max(6, Math.min(x, window.innerWidth - element.offsetWidth - 6))}px`;

		element.style.top = `${y}px`;
	}, [tip]);

	return (
		<div className={tip === null ? "tip" : "tip on"} role="tooltip" ref={box}>
			{tip?.label}
			{tip === null || tip.hint === null ? null : <small>{tip.hint}</small>}
		</div>
	);
}

function Toasts({ down }: { down: boolean }) {
	const toasts = useToasts();

	return (
		<div className="toasts" aria-live="polite">
			{down ? (
				<output className="toast is-down">
					<i className="need" aria-hidden="true" />
					<span>Reconnecting to live updates…</span>
				</output>
			) : null}
			{toasts.map((item) => (
				<div key={item.id} className={item.leaving ? "toast bye" : "toast"}>
					<Icon name={item.icon} />
					<span>{item.body}</span>
				</div>
			))}
		</div>
	);
}
