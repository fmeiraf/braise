import {
	type DraftChangeView,
	type DraftSummary,
	type DraftView,
	dropClosure,
	keepClosure,
	type OperableCommand,
} from "@braise/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { describeError } from "./errors.ts";
import { keys, queries, refreshDraft } from "./live.ts";
import { Icon } from "./marks.tsx";
import type { ToolCall } from "./thread-timeline.ts";
import { parseJson } from "./thread-timeline.ts";
import { toast } from "./toast.ts";
import { useCommand } from "./use-command.ts";

type Verdict = "keep" | "drop";

interface Pending {
	verdict: Verdict;
	ids: string[];
	others: DraftChangeView[];
	at: { top: number; left: number };
}

interface DraftRoom {
	slug: string;
	ventureId: string;
	view: DraftView | null;
	draft: DraftSummary | null;
	hovered: string | null;
	hover: (changeId: string | null) => void;
	fresh: ReadonlySet<string>;
	settling: ReadonlySet<string>;
	stateOf: (changeId: string) => "open" | "kept" | "dropped" | null;
	decide: (changeIds: string[], verdict: Verdict, anchor: Element | null) => void;
	revise: (change: DraftChangeView, patch: Record<string, unknown>) => Promise<unknown>;
	follow: () => void;
	busy: boolean;
}

const Room = createContext<DraftRoom | null>(null);

const Marks = createContext<DraftSummary | null | undefined>(undefined);

const settleMs = 1_100;

const freshMs = 1_300;

function openIds(draft: DraftSummary | null) {
	return (draft?.changes ?? []).map((change) => change.id);
}

function motionOk() {
	return window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
}

function elementOf(changeId: string) {
	return document.querySelector<HTMLElement>(`.main [data-change~="${changeId}"]`);
}

export function DraftRoomProvider({
	slug,
	ventureId,
	view,
	children,
}: {
	slug: string;
	ventureId: string;
	view: DraftView | null;
	children: ReactNode;
}) {
	const client = useQueryClient();
	const query = useQuery(queries.draft(slug));
	const operator = useQuery(queries.operator(slug));
	const draft = query.data?.draft ?? null;
	const [hovered, setHovered] = useState<string | null>(null);
	const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
	const [settling, setSettling] = useState<ReadonlySet<string>>(new Set());
	const [pending, setPending] = useState<Pending | null>(null);
	const seen = useRef<Set<string> | null>(null);
	const following = useRef(true);

	useEffect(() => {
		if (query.data === undefined) return;

		const ids = openIds(draft);

		if (seen.current === null) {
			seen.current = new Set(ids);

			return;
		}

		const known = seen.current;
		const added = ids.filter((id) => !known.has(id));

		for (const id of ids) known.add(id);

		if (added.length === 0) return;

		setFresh(new Set(added));

		const timer = setTimeout(() => setFresh(new Set()), freshMs);

		return () => clearTimeout(timer);
	}, [draft, query.data]);

	useLayoutEffect(() => {
		if (fresh.size === 0 || !following.current) return;

		const last = [...fresh].at(-1);
		const element = last === undefined ? null : elementOf(last);

		element?.scrollIntoView({ block: "center", behavior: motionOk() ? "smooth" : "auto" });
	}, [fresh]);

	useEffect(() => {
		const stop = () => {
			following.current = false;
		};

		const main = document.querySelector(".main");

		main?.addEventListener("wheel", stop, { passive: true });

		main?.addEventListener("touchmove", stop, { passive: true });

		return () => {
			main?.removeEventListener("wheel", stop);

			main?.removeEventListener("touchmove", stop);
		};
	});

	const done = (verb: string) => (response: { result: unknown }) => {
		const result = response.result as { kept?: string[]; dropped?: string[]; open: number };
		const ids = result.kept ?? result.dropped ?? [];

		if (result.kept !== undefined) {
			const entities = (draft?.changes ?? [])
				.filter((change) => ids.includes(change.id) && change.entityId !== null)
				.map((change) => change.entityId as string);

			setSettling(new Set(entities));

			setTimeout(() => setSettling(new Set()), settleMs);
		}

		void refreshDraft(client, slug);

		void client.invalidateQueries({ queryKey: keys.venture(slug) });

		toast(`${verb} ${ids.length} ${ids.length === 1 ? "change" : "changes"}`, verb === "Kept" ? "check" : "x");
	};

	const keep = useCommand<"draft.keep", unknown>("draft.keep", done("Kept"));
	const drop = useCommand<"draft.drop", unknown>("draft.drop", done("Dropped"));

	const reviseCommand = useCommand<"draft.revise", unknown>("draft.revise", () => void refreshDraft(client, slug));

	const error = keep.error ?? drop.error;

	useEffect(() => {
		if (error !== null) toast(describeError(error), "x");
	}, [error]);

	const run = useCallback(
		(ids: string[], verdict: Verdict) => {
			const input = { payload: { ventureId, changeIds: ids } };

			if (verdict === "keep") keep.mutate(input);
			else drop.mutate(input);
		},
		[drop, keep, ventureId],
	);

	const decide = useCallback(
		(changeIds: string[], verdict: Verdict, anchor: Element | null) => {
			const changes = draft?.changes ?? [];
			const closure = (verdict === "keep" ? keepClosure : dropClosure)(changes, changeIds);
			const others = closure.filter((change) => !changeIds.includes(change.id));

			if (others.length === 0 || anchor === null) {
				run(
					closure.map((change) => change.id),
					verdict,
				);

				return;
			}

			const box = anchor.getBoundingClientRect();

			setPending({
				verdict,
				ids: closure.map((change) => change.id),
				others,
				at: {
					top: Math.min(box.bottom + 8, window.innerHeight - 220),
					left: Math.max(12, Math.min(box.right - 300, window.innerWidth - 312)),
				},
			});
		},
		[draft, run],
	);

	const room = useMemo(
		() =>
			({
				slug,
				ventureId,
				view,
				draft,
				hovered,
				hover: setHovered,
				fresh,
				settling,
				stateOf: (changeId: string) =>
					draft?.changes.some((change) => change.id === changeId) === true
						? "open"
						: (operator.data?.changeStates[changeId] ?? null),
				decide,
				revise: (change: DraftChangeView, patch: Record<string, unknown>) =>
					reviseCommand.mutateAsync({
						payload: { ventureId, changeId: change.id, payload: { ...change.payload, ...patch } },
					}),
				follow: () => {
					following.current = true;
				},
				busy: keep.isPending || drop.isPending,
			}) satisfies DraftRoom,
		[
			slug,
			ventureId,
			view,
			draft,
			hovered,
			fresh,
			settling,
			operator.data,
			decide,
			reviseCommand,
			keep.isPending,
			drop.isPending,
		],
	);

	return (
		<Room.Provider value={room}>
			{children}
			{pending === null ? null : (
				<DecisionPopover
					pending={pending}
					close={() => setPending(null)}
					confirm={() => {
						run(pending.ids, pending.verdict);

						setPending(null);
					}}
				/>
			)}
		</Room.Provider>
	);
}

function DecisionPopover({ pending, close, confirm }: { pending: Pending; close: () => void; confirm: () => void }) {
	const box = useRef<HTMLDivElement>(null);

	useEffect(() => {
		box.current?.querySelector<HTMLButtonElement>("[data-confirm]")?.focus();

		const away = (event: MouseEvent) => {
			if (event.target instanceof Node && box.current?.contains(event.target) !== true) close();
		};

		const onEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") close();
		};

		document.addEventListener("mousedown", away);

		document.addEventListener("keydown", onEscape);

		return () => {
			document.removeEventListener("mousedown", away);

			document.removeEventListener("keydown", onEscape);
		};
	}, [close]);

	const keeping = pending.verdict === "keep";

	return (
		<div className="d-pop" role="dialog" aria-label="Confirm" ref={box} style={pending.at}>
			<p>{keeping ? "Keeping this also keeps" : "Dropping this also drops"}</p>
			<ul>
				{pending.others.map((change) => (
					<li key={change.id}>
						<span>{stepOf(change.command, change.payload).label}</span>
						<span>{change.label}</span>
					</li>
				))}
			</ul>
			<div className="row">
				<button type="button" className="btn ghost sm" onClick={close}>
					Cancel
				</button>
				<button type="button" className={keeping ? "btn pri sm" : "btn danger sm"} data-confirm onClick={confirm}>
					{keeping ? "Keep" : "Drop"} {pending.ids.length} changes
				</button>
			</div>
		</div>
	);
}

export function useDraftRoom() {
	return useContext(Room);
}

/** Whether the draft changes this item's status, so it stays where it is until the change is kept. */
export function useStatusDrafted() {
	const draft = useMarksDraft();

	return (id: string) => draft?.marks[id]?.status != null;
}

/** Puts a page's own draft (from the same response as its data) in charge of the marks below it. */
export function DraftMarks({ draft, children }: { draft: DraftSummary | null; children: ReactNode }) {
	return <Marks.Provider value={draft}>{children}</Marks.Provider>;
}

function useMarksDraft() {
	const own = useContext(Marks);
	const room = useContext(Room);

	return own === undefined ? (room?.draft ?? null) : own;
}

/** How the draft touches one item on the page, with the classes, hover wiring and controls to show it. */
export function useDraftItem(id: string | null | undefined) {
	const room = useContext(Room);
	const draft = useMarksDraft();
	const mark = id === null || id === undefined ? undefined : draft?.marks[id];

	if (mark === undefined || room === null) {
		const settled = id !== null && id !== undefined && room?.settling.has(id) === true;

		return { mark: null, changes: [], className: settled ? "d-settle" : "", attrs: {}, created: false } as const;
	}

	const changes = (draft?.changes ?? []).filter((change) => mark.changeIds.includes(change.id));
	const lit = room.hovered !== null && mark.changeIds.includes(room.hovered);
	const landing = mark.changeIds.some((changeId) => room.fresh.has(changeId));
	const kind = mark.archived ? "d-gone" : mark.created ? "d-new" : "d-mod";

	return {
		mark,
		changes,
		className: [kind, lit ? "d-lit" : "", landing ? "d-in d-writing" : ""].filter(Boolean).join(" "),
		attrs: {
			"data-change": mark.changeIds.join(" "),
			onMouseEnter: () => room.hover(mark.changeIds[0] ?? null),
			onMouseLeave: () => room.hover(null),
		},
		created: mark.created,
	} as const;
}

export function DraftControls({ changes }: { changes: readonly DraftChangeView[] }) {
	const room = useContext(Room);

	if (room === null || changes.length === 0) return null;

	const ids = changes.map((change) => change.id);
	const stale = changes.find((change) => change.stale !== null || change.error !== null);

	return (
		<span className="dctl">
			{stale === undefined ? (
				<button
					type="button"
					className="btn ghost sm d-keep"
					disabled={room.busy}
					onClick={(event) => {
						event.stopPropagation();

						room.decide(ids, "keep", event.currentTarget);
					}}
				>
					<Icon name="check" />
					Keep
				</button>
			) : (
				<span className="d-stale" data-tip={`Can't keep yet|${stale.stale ?? stale.error}`}>
					{stale.stale === null ? "Fails" : "Stale"}
				</span>
			)}
			<button
				type="button"
				className="ib d-drop"
				aria-label="Drop"
				data-tip="Drop"
				disabled={room.busy}
				onClick={(event) => {
					event.stopPropagation();

					room.decide(ids, "drop", event.currentTarget);
				}}
			>
				<Icon name="x" />
			</button>
		</span>
	);
}

/** The short word that says what the draft does to an item: New, Edited, Archive, with the owner's edit. */
export function DraftMeta({ item }: { item: ReturnType<typeof useDraftItem> }) {
	if (item.mark === null) return null;

	const status = item.mark.status;

	const word = item.mark.archived
		? "Archive"
		: item.mark.created
			? "New"
			: status !== null
				? `Closing · ${String(status.to).replace("_", " ")}`
				: item.mark.moved !== null
					? "Moved"
					: "Edited";

	const edited = item.changes.some((change) => change.editedBy === "owner");

	return (
		<>
			<span className="dmeta">{word}</span>
			{edited ? <span className="you-tag"> · edited by you</span> : null}
		</>
	);
}

export function Was({
	item,
	field,
	format,
}: {
	item: ReturnType<typeof useDraftItem>;
	field: string;
	format?: (value: unknown) => string;
}) {
	const fields = item.mark?.fields;

	if (fields === undefined || !Object.hasOwn(fields, field) || item.mark?.created === true) return null;

	const value = fields[field];
	const text = format === undefined ? (typeof value === "string" ? value : JSON.stringify(value)) : format(value);

	return <span className="d-was">{text === "" ? "(empty)" : text}</span>;
}

/** Saves an edit to a drafted item as the owner's revision of its change, or through `real` when it is real. */
export function useDraftSave(item: ReturnType<typeof useDraftItem>) {
	const room = useContext(Room);
	const change = item.created ? item.changes[0] : undefined;

	return (field: string, value: unknown, real: () => Promise<unknown>) =>
		room === null || change === undefined ? real() : room.revise(change, { [field]: value });
}

const nouns: Record<string, string> = {
	venture: "venture",
	strategy: "strategy",
	objective: "objective",
	assumption: "assumption",
	bet: "bet",
	reading: "reading",
	work: "work",
};

export function stepOf(command: OperableCommand, payload: Record<string, unknown>) {
	const [subject = "", verb = ""] = command.split(".");
	const noun = subject === "work" ? (payload.parentId === undefined ? "initiative" : "task") : nouns[subject];

	if (command === "venture.update") return { label: "Rename", kind: "edit" } as const;

	if (command === "strategy.revise") return { label: "Revise strategy", kind: "edit" } as const;

	if (command === "reading.record") return { label: "New reading", kind: "create" } as const;

	if (verb === "create") return { label: `New ${noun}`, kind: "create" } as const;

	if (verb === "archive") return { label: "Archive", kind: "archive" } as const;

	if (verb === "close") return { label: `Close ${noun}`, kind: "edit" } as const;

	if (verb === "move") return { label: "Move", kind: "edit" } as const;

	if (verb === "set_status") return { label: "Status", kind: "edit" } as const;

	if (verb === "check") return { label: "Tick done", kind: "edit" } as const;

	return { label: `Edit ${noun}`, kind: "edit" } as const;
}

const draftTools = new Set(["draft", "draft_revise", "draft_remove"]);

export function isDraftCall(call: ToolCall) {
	return draftTools.has(call.name) && call.result?.isError !== true;
}

function resultOf(call: ToolCall) {
	if (call.result === null || call.result.isError) return null;

	const parsed = parseJson(call.result.output);

	return parsed.ok ? (parsed.value as { changeId?: string; label?: string; removed?: string[] }) : null;
}

const viewPaths = { overview: "/v/$slug", strategy: "/v/$slug/strategy", work: "/v/$slug/work" } as const;

/** One drafted change as a row in the operator's trace, linked to its card on the page. */
export function DraftStep({ call }: { call: ToolCall }) {
	const room = useContext(Room);
	const navigate = useNavigate();
	const result = resultOf(call);
	const input = (call.input ?? {}) as { command?: string; payload?: Record<string, unknown>; changeId?: string };
	const changeId = result?.changeId ?? input.changeId ?? null;
	const change = room?.draft?.changes.find((candidate) => candidate.id === changeId);
	const failed = call.result?.isError === true;

	const step =
		call.name === "draft_remove"
			? ({ label: "Withdraw", kind: "archive" } as const)
			: call.name === "draft_revise"
				? ({ label: "Revise", kind: "edit" } as const)
				: stepOf((change?.command ?? input.command ?? "work.update") as OperableCommand, input.payload ?? {});

	const title = change?.label ?? result?.label ?? (failed ? "Couldn't draft this" : "…");

	const state =
		call.result === null ? "now" : failed ? "failed" : changeId === null ? null : (room?.stateOf(changeId) ?? null);

	const lit = changeId !== null && room?.hovered === changeId;

	return (
		<button
			type="button"
			className={[
				"step dstep",
				state === "now" ? "now" : "",
				lit ? "lit" : "",
				room?.fresh.has(changeId ?? "") ? "d-in" : "",
			]
				.filter(Boolean)
				.join(" ")}
			data-kind={failed ? "archive" : step.kind}
			data-state={state ?? "open"}
			data-change={changeId ?? undefined}
			onMouseEnter={() => room?.hover(changeId)}
			onMouseLeave={() => room?.hover(null)}
			onClick={() => {
				if (room === null || change === undefined) return;

				room.follow();

				if (room.view !== change.view) void navigate({ to: viewPaths[change.view], params: { slug: room.slug } });

				requestAnimationFrame(() =>
					elementOf(change.id)?.scrollIntoView({ block: "center", behavior: motionOk() ? "smooth" : "auto" }),
				);
			}}
		>
			<span className="k">{step.label}</span>
			<span className="t">{failed ? (call.result?.output.slice(0, 160) ?? title) : title}</span>
			<span className="s" role="img" aria-label={state ?? "drafted"}>
				{state === "kept" ? (
					<Icon name="check" />
				) : state === "dropped" || state === "failed" ? (
					<Icon name="x" />
				) : null}
			</span>
		</button>
	);
}

function countKinds(changes: readonly DraftChangeView[]) {
	const kinds = changes.map((change) => stepOf(change.command, change.payload).kind);

	return {
		created: kinds.filter((kind) => kind === "create").length,
		edited: kinds.filter((kind) => kind === "edit").length,
		archived: kinds.filter((kind) => kind === "archive").length,
	};
}

/** The sticky bar at the bottom of the page while the venture has a draft: what's in it, Drop all and Keep all. */
export function DraftBar() {
	const room = useContext(Room);
	const client = useQueryClient();
	const [offscreen, setOffscreen] = useState<string[]>([]);
	const changes = room?.draft?.changes ?? [];
	const keepable = changes.filter((change) => change.stale === null && change.error === null);
	const blocked = changes.length - keepable.length;

	const discard = useCommand<"draft.discard", unknown>("draft.discard", () => {
		if (room !== null) void refreshDraft(client, room.slug);

		toast(`Dropped ${changes.length} ${changes.length === 1 ? "change" : "changes"}`, "x");
	});

	const keepAll = useCallback(() => {
		if (room === null || keepable.length === 0) return;

		room.decide(
			keepable.map((change) => change.id),
			"keep",
			null,
		);
	}, [keepable, room]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;

			if (event.target instanceof HTMLElement && event.target.closest(".op .comp, form") !== null) return;

			event.preventDefault();

			keepAll();
		};

		document.addEventListener("keydown", onKeyDown);

		return () => document.removeEventListener("keydown", onKeyDown);
	}, [keepAll]);

	const view = room?.view ?? null;

	const here = changes
		.filter((change) => change.view === view)
		.map((change) => change.id)
		.join(" ");

	useEffect(() => {
		const ids = here === "" ? [] : here.split(" ");

		const measure = () => {
			const main = document.querySelector(".main");

			if (main === null) return;

			const box = main.getBoundingClientRect();

			const next = ids.filter((id) => {
				const element = elementOf(id);

				if (element === null) return false;

				const rect = element.getBoundingClientRect();

				return rect.top > box.bottom - 90 || rect.bottom < box.top;
			});

			setOffscreen((current) => (current.join(" ") === next.join(" ") ? current : next));
		};

		measure();

		document.addEventListener("scroll", measure, { capture: true, passive: true });

		const timer = setTimeout(measure, 700);

		return () => {
			document.removeEventListener("scroll", measure, { capture: true });

			clearTimeout(timer);
		};
	}, [here]);

	if (room === null || changes.length === 0) return null;

	const mix = countKinds(changes);

	const parts = [
		mix.created === 0 ? null : (
			<span key="n" className="n-new">
				{mix.created} new
			</span>
		),
		mix.edited === 0 ? null : <span key="e">{mix.edited} edited</span>,
		mix.archived === 0 ? null : (
			<span key="a" className="n-gone">
				{mix.archived} archived
			</span>
		),
		blocked === 0 ? null : (
			<span key="s" className="n-gone">
				{blocked} stale
			</span>
		),
	].filter((part) => part !== null);

	return (
		<>
			{offscreen.length === 0 ? null : (
				<button
					type="button"
					className="d-below"
					onClick={() => {
						room.follow();

						const first = offscreen[0];

						if (first !== undefined) {
							elementOf(first)?.scrollIntoView({ block: "center", behavior: motionOk() ? "smooth" : "auto" });
						}
					}}
				>
					{offscreen.length} drafted {offscreen.length === 1 ? "change" : "changes"} out of view
					<Icon name="chevd" />
				</button>
			)}
			<section className="d-bar" aria-label="Draft">
				<span className="mark" aria-hidden="true" />
				<b>Draft</b>
				<span>
					· {changes.length} {changes.length === 1 ? "change" : "changes"}
				</span>
				<span className="mix">{parts.flatMap((part) => [" · ", part])}</span>
				<button
					type="button"
					className="btn ghost sm"
					disabled={discard.isPending || room.busy}
					onClick={() => discard.mutate({ payload: { ventureId: room.ventureId } })}
				>
					Drop all
				</button>
				<span className="sep" />
				<button
					type="button"
					className="btn pri sm"
					disabled={keepable.length === 0 || room.busy}
					data-tip={blocked === 0 ? "Keep every change" : `Keep the ${keepable.length} that can be kept`}
					onClick={keepAll}
				>
					Keep all
					<span className="kbd">⌘↵</span>
				</button>
			</section>
		</>
	);
}
