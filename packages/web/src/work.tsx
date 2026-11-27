import {
	type Bet,
	type Objective,
	type WorkFunction,
	type WorkItem,
	type WorkPriority,
	type WorkStatus,
	workFunctions,
	workHomeKey,
	workPriorities,
	workStatuses,
} from "@braise/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import {
	type CSSProperties,
	type FormEvent,
	type KeyboardEvent,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { ArchiveWorkResult } from "./api.ts";
import { DraftControls, DraftMarks, DraftMeta, useDraftItem, Was } from "./draft.tsx";
import { Editable } from "./editable.tsx";
import { describeError } from "./errors.ts";
import { focusOnMount } from "./focus.ts";
import { useFreshIds } from "./fresh.ts";
import { PageError } from "./holding.tsx";
import { betNumbers } from "./labels.ts";
import { patchWork, queries, refreshVenture, rememberVenture } from "./live.ts";
import { timeLeft } from "./loop-view.ts";
import { MarkdownField } from "./markdown.tsx";
import { AppIcon, accent, Dia, FunctionGlyph, FunctionTag, Icon, Pips, progressStatus, Rank } from "./marks.tsx";
import { Select } from "./menu.tsx";
import { Skeleton } from "./parts.tsx";
import { WorkItemThreads } from "./threads.tsx";
import { ago, shortDate } from "./time.ts";
import { useCommand } from "./use-command.ts";
import { buildForest, cycleStatus, filterForest, homeProgress, kindOf, type WorkNode } from "./work-tree.ts";

interface VentureRef {
	id: string;
	slug: string;
	name: string;
}

interface WorkSection {
	venture: VentureRef;
	objectives: Objective[];
	bets: Bet[];
	items: WorkItem[];
}

type Home = { type: "bet"; id: string } | { type: "objective"; id: string } | { type: "upkeep" };

interface Group {
	key: string;
	home: Home;
	number: string | null;
	title: string;
	note: string;
	open: boolean;
}

function groupsOf(section: WorkSection, now: number) {
	const numbers = betNumbers(section.bets);
	const unfinished = new Set(section.items.filter((item) => item.status !== "done").map(workHomeKey));

	const bets = section.bets.map((bet) => ({
		key: workHomeKey({ betId: bet.id, objectiveId: null }),
		home: { type: "bet", id: bet.id },
		number: numbers.get(bet.id) ?? null,
		title: bet.action,
		note:
			bet.status === "open" ? `Due ${shortDate(bet.deadline, now)} · ${timeLeft(bet.deadline, now)}` : "Bet closed",
		open: bet.status === "open",
	})) satisfies Group[];

	const builds = section.objectives
		.filter((objective) => objective.kind === "build")
		.map((objective) => ({
			key: workHomeKey({ betId: null, objectiveId: objective.id }),
			home: { type: "objective", id: objective.id },
			number: null,
			title: objective.statement,
			note:
				objective.status !== "active"
					? "Objective closed"
					: objective.byDate === null
						? "Build · no time box"
						: `Build · ends ${shortDate(objective.byDate, now)} · ${timeLeft(objective.byDate, now)}`,
			open: objective.status === "active",
		})) satisfies Group[];

	const upkeep = {
		key: workHomeKey({ betId: null, objectiveId: null }),
		home: { type: "upkeep" },
		number: null,
		title: "Upkeep",
		note: "Work that tests nothing",
		open: true,
	} satisfies Group;

	return [...bets, ...builds, upkeep].filter((group) => group.open || unfinished.has(group.key));
}

interface Located {
	node: WorkNode;
	section: WorkSection;
	siblings: number;
	parent: WorkNode | null;
	ancestors: WorkNode[];
}

export const functionLabel = {
	product: "Product",
	design: "Design",
	engineering: "Engineering",
	marketing: "Marketing",
	sales: "Sales",
	ops: "Ops",
} satisfies Record<WorkFunction, string>;

const priorityLabel = {
	none: "No priority",
	low: "Low",
	medium: "Medium",
	high: "High",
	urgent: "Urgent",
} satisfies Record<WorkPriority, string>;

const statusLabel = { todo: "To do", doing: "Doing", done: "Done" } satisfies Record<WorkStatus, string>;

const kindLabel = { initiative: "Initiative", task: "Task", subtask: "Subtask" } as const;

const childKind = ["task", "subtask"] as const;

let lastFunction: WorkFunction = "product";

function plural(count: number, word: string) {
	return count === 1 ? `1 ${word}` : `${count} ${word}s`;
}

function useWorkCache(venture: VentureRef) {
	const client = useQueryClient();

	return {
		store: (seq: number, item: WorkItem) => {
			patchWork(client, venture.slug, (items) =>
				items.some((existing) => existing.id === item.id)
					? items.map((existing) => (existing.id === item.id ? item : existing))
					: [...items, item],
			);

			return refreshVenture(client, venture, seq);
		},
		drop: (seq: number, ids: readonly string[]) => {
			const gone = new Set(ids);

			patchWork(client, venture.slug, (items) => items.filter((item) => !gone.has(item.id)));

			return refreshVenture(client, venture, seq);
		},
		refresh: (seq: number) => refreshVenture(client, venture, seq),
	};
}

export function VentureWorkPage() {
	const { slug } = useParams({ from: "/v/$slug/work" });
	const { item } = useSearch({ from: "/v/$slug/work" });
	const navigate = useNavigate();
	const work = useQuery(queries.work(slug));
	const ventures = useQuery(queries.ventures());

	if (work.isPending) return <WorkSkeleton />;

	if (work.isError) return <PageError error={work.error} retry={() => void work.refetch()} />;

	rememberVenture(work.data.ventureId, slug, work.data.lastSeq);

	const name = ventures.data?.ventures.find((venture) => venture.id === work.data.ventureId)?.name ?? slug;
	const venture = { id: work.data.ventureId, slug, name };

	return (
		<DraftMarks draft={work.data.draft}>
			<WorkScreen
				sections={[{ venture, objectives: work.data.objectives, bets: work.data.bets, items: work.data.workItems }]}
				openId={item ?? null}
				open={(next, replace = false) =>
					void navigate({
						to: "/v/$slug/work",
						params: { slug },
						search: next === null ? {} : { item: next },
						replace,
					})
				}
			/>
		</DraftMarks>
	);
}

export function HoldingWorkPage() {
	const { item } = useSearch({ from: "/work" });
	const navigate = useNavigate();
	const work = useQuery(queries.holdingWork());

	if (work.isPending) return <WorkSkeleton />;

	if (work.isError) return <PageError error={work.error} retry={() => void work.refetch()} />;

	for (const venture of work.data.ventures) rememberVenture(venture.id, venture.slug, venture.lastSeq);

	const sections = work.data.ventures.map((venture) => ({
		venture,
		objectives: work.data.objectives.filter((objective) => objective.ventureId === venture.id),
		bets: work.data.bets.filter((bet) => bet.ventureId === venture.id),
		items: work.data.workItems.filter((workItem) => workItem.ventureId === venture.id),
	}));

	return (
		<WorkScreen
			sections={sections}
			holding
			openId={item ?? null}
			open={(next, replace = false) =>
				void navigate({ to: "/work", search: next === null ? {} : { item: next }, replace })
			}
		/>
	);
}

function locate(sections: readonly WorkSection[]) {
	const located = new Map<string, Located>();
	const forests = new Map<string, Map<string, WorkNode[]>>();

	for (const section of sections) {
		const forest = buildForest(section.items);

		forests.set(section.venture.id, forest);

		const walk = (nodes: WorkNode[], ancestors: WorkNode[]) => {
			for (const node of nodes) {
				located.set(node.item.id, {
					node,
					section,
					siblings: nodes.length,
					parent: ancestors.at(-1) ?? null,
					ancestors,
				});

				walk(node.children, [...ancestors, node]);
			}
		};

		for (const roots of forest.values()) walk(roots, []);
	}

	return { located, forests };
}

function treeItems(root: HTMLElement | null) {
	return root === null ? [] : [...root.querySelectorAll<HTMLElement>('[role="treeitem"]')];
}

function focusItem(root: HTMLElement | null, id: string) {
	treeItems(root)
		.find((element) => element.dataset.id === id)
		?.focus();
}

function flatten(nodes: readonly WorkNode[]) {
	const ids: string[] = [];

	const walk = (list: readonly WorkNode[]) => {
		for (const node of list) {
			ids.push(node.item.id);

			walk(node.children);
		}
	};

	walk(nodes);

	return ids;
}

function WorkScreen(props: {
	sections: WorkSection[];
	holding?: boolean;
	openId: string | null;
	open: (id: string | null, replace?: boolean) => void;
}) {
	const { sections, openId } = props;
	const mainRef = useRef<HTMLDivElement>(null);
	const treeRef = useRef<HTMLDivElement>(null);
	const savedScroll = useRef<number | null>(null);
	const returnTo = useRef<string | null>(null);
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
	const [editingId, setEditingId] = useState<string | null>(null);
	const [cursor, setCursor] = useState<string | null>(openId);
	const client = useQueryClient();
	const { located, forests } = locate(sections);
	const opened = openId === null ? null : (located.get(openId) ?? null);
	const allItems = sections.flatMap((section) => section.items);
	const done = allItems.filter((item) => item.status === "done").length;
	const [fn, setFn] = useState<WorkFunction | null>(null);
	const used = workFunctions.filter((value) => allItems.some((item) => item.function === value));
	const now = Date.now();

	const order = sections.flatMap((section) => {
		const forest = forests.get(section.venture.id);

		return groupsOf(section, now).flatMap((group) => flatten(filterForest(forest?.get(group.key) ?? [], fn)));
	});

	const openItem = (id: string) => {
		savedScroll.current = treeRef.current?.scrollTop ?? null;

		setCursor(id);

		props.open(id);
	};

	const closeItem = () => {
		if (opened !== null) {
			const id = opened.node.item.id;

			returnTo.current = id;

			setCursor(id);

			setCollapsed((current) => {
				const next = new Set(current);

				for (const ancestor of opened.ancestors) next.delete(ancestor.item.id);

				return next;
			});
		}

		props.open(null, true);
	};

	useEffect(() => {
		const hash = window.location.hash.slice(1);

		if (hash !== "") document.getElementById(hash)?.scrollIntoView({ block: "start" });
	}, []);

	useLayoutEffect(() => {
		const id = returnTo.current;

		if (openId !== null || id === null) return;

		returnTo.current = null;

		if (treeRef.current !== null && savedScroll.current !== null) treeRef.current.scrollTop = savedScroll.current;

		const row = treeItems(mainRef.current).find((element) => element.dataset.id === id);

		row?.focus({ preventScroll: true });

		row?.scrollIntoView({ block: "nearest" });
	}, [openId]);

	const move = useCommand<"work.move", WorkItem>("work.move", (response) => {
		const venture = located.get(response.result.id)?.section.venture;

		if (venture === undefined) return;

		void refreshVenture(client, venture, response.seq).then(() => focusItem(mainRef.current, response.result.id));
	});

	const toggle = (id: string, open?: boolean) =>
		setCollapsed((current) => {
			const next = new Set(current);
			const shouldOpen = open ?? next.has(id);

			if (shouldOpen) next.delete(id);
			else next.add(id);

			return next;
		});

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.target !== event.currentTarget) return;

		const target = event.currentTarget;
		const id = target.dataset.id ?? "";
		const here = located.get(id);

		if (here === undefined) return;

		const rows = treeItems(mainRef.current);
		const index = rows.indexOf(target);

		const go = (element: HTMLElement | undefined) => {
			if (element === undefined) return;

			event.preventDefault();

			element.focus();

			setCursor(element.dataset.id ?? null);
		};

		if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
			event.preventDefault();

			const nextIndex = here.node.item.position + (event.key === "ArrowUp" ? -1 : 1);

			if (nextIndex >= 0 && nextIndex < here.siblings && !move.isPending) {
				move.mutate({ payload: { ventureId: here.section.venture.id, workItemId: id, index: nextIndex } });
			}

			return;
		}

		switch (event.key) {
			case "ArrowDown":
				go(rows[index + 1]);

				break;
			case "ArrowUp":
				go(rows[index - 1]);

				break;
			case "ArrowRight":
				event.preventDefault();

				if (here.node.children.length > 0 && collapsed.has(id)) toggle(id, true);
				else go(rows[index + 1]?.dataset.parent === id ? rows[index + 1] : undefined);

				break;
			case "ArrowLeft":
				event.preventDefault();

				if (here.node.children.length > 0 && !collapsed.has(id)) toggle(id, false);
				else if (here.parent !== null) go(rows.find((row) => row.dataset.id === here.parent?.item.id));

				break;
			case "Enter":
				event.preventDefault();

				openItem(id);

				break;
			case "F2":
				event.preventDefault();

				setCursor(id);

				setEditingId(id);

				break;
			default:
		}
	};

	if (opened !== null) {
		const index = order.indexOf(opened.node.item.id);

		return (
			<div className="wk">
				<WorkItemPage
					key={opened.node.item.id}
					located={opened}
					holding={props.holding === true}
					step={{
						index,
						total: order.length,
						prev: index > 0 ? (order[index - 1] ?? null) : null,
						next: index >= 0 ? (order[index + 1] ?? null) : null,
					}}
					go={(id) => props.open(id, true)}
					close={closeItem}
					onArchived={() => props.open(null, true)}
				/>
			</div>
		);
	}

	return (
		<div className="wk">
			<div className="wk-main" ref={mainRef}>
				<div className="bar">
					<h1>Work</h1>
					<span className="cnt">
						{plural(allItems.length, "item")} · {done} done
					</span>
					<span className="grow" />
					{used.length < 2 ? null : (
						<fieldset className="seg fn-filter">
							<legend className="vh">Show work of one function</legend>
							<button type="button" aria-pressed={fn === null} onClick={() => setFn(null)}>
								All
							</button>
							{used.map((value) => (
								<button key={value} type="button" aria-pressed={fn === value} onClick={() => setFn(value)}>
									<FunctionGlyph fn={value} />
									{functionLabel[value]}
								</button>
							))}
						</fieldset>
					)}
					<span className="hint">↑↓ select · ←→ fold · ↵ open · F2 rename · ⌥↑↓ reorder</span>
				</div>

				<div className="wk-tree" ref={treeRef}>
					{sections.map((section) => (
						<VentureWork
							key={section.venture.id}
							section={section}
							forest={forests.get(section.venture.id) ?? new Map()}
							holding={props.holding === true}
							fn={fn}
							tree={{
								collapsed,
								toggle,
								cursor,
								open: openItem,
								editingId,
								setEditingId,
								onKeyDown,
								focusRow: (id) => focusItem(mainRef.current, id),
							}}
						/>
					))}
				</div>
			</div>
		</div>
	);
}

interface TreeState {
	collapsed: ReadonlySet<string>;
	toggle: (id: string, open?: boolean) => void;
	cursor: string | null;
	open: (id: string) => void;
	editingId: string | null;
	setEditingId: (id: string | null) => void;
	onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
	focusRow: (id: string) => void;
}

function VentureWork({
	section,
	forest,
	holding,
	fn,
	tree,
}: {
	section: WorkSection;
	forest: Map<string, WorkNode[]>;
	holding: boolean;
	fn: WorkFunction | null;
	tree: TreeState;
}) {
	const fresh = useFreshIds(section.venture.id, section.items);
	const groups = groupsOf(section, Date.now());

	const body = groups.map((group) => (
		<GroupWork
			key={group.key}
			venture={section.venture}
			group={group}
			roots={filterForest(forest.get(group.key) ?? [], fn)}
			filtered={fn !== null}
			progress={homeProgress(section.items, group.key)}
			level={holding ? 3 : 2}
			fresh={fresh}
			tree={tree}
		/>
	));

	if (!holding) return <div style={accent(section.venture.slug)}>{body}</div>;

	return (
		<section style={accent(section.venture.slug)} aria-labelledby={`venture-${section.venture.id}`}>
			<h2 className="wk-v" id={`venture-${section.venture.id}`}>
				<AppIcon slug={section.venture.slug} size={18} />
				<Link to="/v/$slug/work" params={{ slug: section.venture.slug }}>
					{section.venture.name}
				</Link>
				<span className="cnt">{plural(section.items.length, "item")}</span>
			</h2>
			{body}
		</section>
	);
}

function GroupWork(props: {
	venture: VentureRef;
	group: Group;
	roots: WorkNode[];
	filtered: boolean;
	progress: { done: number; total: number };
	level: 2 | 3;
	fresh: ReadonlySet<string>;
	tree: TreeState;
}) {
	const { group, venture, progress } = props;
	const [adding, setAdding] = useState(false);
	const Heading = props.level === 2 ? "h2" : "h3";
	const headingId = `home-heading-${venture.id}-${group.key}`;
	const drafted = useDraftItem(group.home.type === "upkeep" ? null : group.home.id);
	const placeable = group.open && !drafted.created;

	if (props.filtered && props.roots.length === 0) return null;

	return (
		<section
			id={`home-${group.key}`}
			aria-labelledby={headingId}
			className={[group.open ? "" : "wk-closed", drafted.className].filter(Boolean).join(" ") || undefined}
			{...drafted.attrs}
		>
			<div className="wk-g">
				{group.number === null ? (
					<Dia status={progressStatus(progress)} />
				) : (
					<span className="bet-n">{group.number}</span>
				)}
				<Heading id={headingId}>
					{group.title}
					<Was item={drafted} field={group.home.type === "bet" ? "action" : "statement"} />
				</Heading>
				<span className="tag plain">
					{drafted.mark === null ? null : (
						<>
							<DraftMeta item={drafted} />
							{" · "}
						</>
					)}
					{group.note}
				</span>
				<i className="dots" />
				<Pips done={progress.done} total={progress.total} />
				<span className="mono mute">
					{progress.done}/{progress.total}
				</span>
				<DraftControls changes={drafted.changes} />
				{placeable ? (
					<button
						type="button"
						className="ib"
						aria-label="Add initiative"
						data-tip="Add initiative"
						onClick={() => setAdding(true)}
					>
						<Icon name="plus" />
					</button>
				) : null}
			</div>

			{props.roots.length === 0 ? null : (
				<div role="tree" aria-labelledby={headingId}>
					{props.roots.map((node) => (
						<WorkRow
							key={node.item.id}
							venture={venture}
							node={node}
							parent={null}
							siblings={props.roots.length}
							fresh={props.fresh}
							tree={props.tree}
						/>
					))}
				</div>
			)}

			{adding ? (
				<AddWorkForm venture={venture} placement={{ home: group.home }} depth={0} close={() => setAdding(false)} />
			) : drafted.created && props.roots.length === 0 ? (
				<p className="cap d-empty">No work yet. Ask the operator, or keep the bet and add it yourself.</p>
			) : placeable && !props.filtered ? (
				<button type="button" className="addline" onClick={() => setAdding(true)}>
					<Icon name="plus" />
					{props.roots.length > 0
						? "Add initiative"
						: group.home.type === "upkeep"
							? "Nothing here. Add work that tests nothing: a fix, a bill, a routine"
							: "No work yet. Add the first initiative"}
				</button>
			) : null}
		</section>
	);
}

function WorkRow(props: {
	venture: VentureRef;
	node: WorkNode;
	parent: WorkNode | null;
	siblings: number;
	fresh: ReadonlySet<string>;
	tree: TreeState;
}) {
	const { node, tree, venture } = props;
	const { item } = node;
	const cache = useWorkCache(venture);
	const [adding, setAdding] = useState(false);
	const open = !tree.collapsed.has(item.id);
	const selected = tree.cursor === item.id;
	const editing = tree.editingId === item.id;
	const canNest = item.depth < 2;
	const base = { ventureId: venture.id, workItemId: item.id };

	const setStatus = useCommand<"work.set_status", WorkItem>(
		"work.set_status",
		(response) => void cache.store(response.seq, response.result),
	);

	const update = useCommand<"work.update", WorkItem>(
		"work.update",
		(response) => void cache.store(response.seq, response.result),
	);

	const showFunction = props.parent === null || props.parent.item.function !== item.function;
	const error = setStatus.error ?? update.error;
	const drafted = useDraftItem(item.id);
	const real = drafted.mark === null || !drafted.created;
	const growable = real && drafted.mark?.archived !== true;

	const className = [
		"wr",
		item.status,
		selected ? "on" : "",
		open && node.children.length > 0 ? "open" : "",
		props.fresh.has(item.id) ? "fresh" : "",
	]
		.filter(Boolean)
		.join(" ");

	return (
		<div
			role="treeitem"
			aria-level={item.depth + 1}
			aria-expanded={node.children.length > 0 ? open : undefined}
			aria-selected={selected}
			aria-label={item.title}
			tabIndex={selected || (tree.cursor === null && item.depth === 0 && item.position === 0) ? 0 : -1}
			data-id={item.id}
			data-parent={item.parentId ?? ""}
			className={["wi", drafted.className].filter(Boolean).join(" ")}
			{...drafted.attrs}
			onKeyDown={tree.onKeyDown}
			onClick={(event) => {
				const target = event.target as HTMLElement;

				if (target.closest('[role="treeitem"]') !== event.currentTarget || target.closest("form") !== null) return;

				if (!real) return;

				tree.open(item.id);
			}}
		>
			<div className={className} data-depth={item.depth} style={{ "--d": item.depth } as CSSProperties}>
				{node.children.length > 0 ? (
					<button
						type="button"
						className="fold"
						tabIndex={-1}
						aria-label={open ? "Collapse" : "Expand"}
						onClick={(event) => {
							event.stopPropagation();

							tree.toggle(item.id);
						}}
					>
						<Icon name="chevr" />
					</button>
				) : (
					<span className="fold" />
				)}

				<button
					type="button"
					className="st"
					tabIndex={-1}
					data-tip={`${statusLabel[item.status]}|click for ${statusLabel[cycleStatus(item.status)].toLowerCase()}`}
					aria-label={`Status ${statusLabel[item.status]}, change to ${statusLabel[cycleStatus(item.status)]}`}
					disabled={setStatus.isPending || drafted.mark !== null}
					onClick={(event) => {
						event.stopPropagation();

						setStatus.mutate({ payload: { ...base, status: cycleStatus(item.status) } });
					}}
				>
					<Dia status={item.status} />
				</button>

				{editing ? (
					<TitleInput
						value={item.title}
						done={() => {
							tree.setEditingId(null);

							tree.focusRow(item.id);
						}}
						save={(title) => update.mutateAsync({ payload: { ...base, title } })}
					/>
				) : (
					<span className="wt">
						{item.title}
						<Was item={drafted} field="title" />
					</span>
				)}

				{drafted.mark === null ? null : (
					<span className="cap dmeta-row">
						<DraftMeta item={drafted} />
					</span>
				)}

				<span className="grow" />

				<DraftControls changes={drafted.changes} />

				{canNest && growable ? (
					<button
						type="button"
						className="ib add"
						tabIndex={-1}
						aria-label={`Add ${childKind[item.depth]}`}
						data-tip={`Add ${childKind[item.depth]}`}
						onClick={(event) => {
							event.stopPropagation();

							tree.toggle(item.id, true);

							setAdding(true);
						}}
					>
						<Icon name="plus" />
					</button>
				) : null}
				{node.total === 0 ? null : (
					<>
						<Pips done={node.done} total={node.total} />
						<span className="mono frac">
							{node.done}/{node.total}
						</span>
					</>
				)}
				{showFunction ? (
					<FunctionTag fn={item.function} label={functionLabel[item.function]} />
				) : (
					<span className="tag fn" />
				)}
				<Rank priority={item.priority} />
			</div>

			{error === null ? null : (
				<p className="err wr-err" role="alert" style={{ "--d": item.depth } as CSSProperties}>
					{describeError(error)}
				</p>
			)}

			{(open && node.children.length > 0) || adding ? (
				<div>
					{open
						? node.children.map((child) => (
								<WorkRow
									key={child.item.id}
									venture={venture}
									node={child}
									parent={node}
									siblings={node.children.length}
									fresh={props.fresh}
									tree={tree}
								/>
							))
						: null}
					{adding ? (
						<AddWorkForm
							venture={venture}
							placement={{ parentId: item.id }}
							depth={item.depth + 1}
							close={() => setAdding(false)}
						/>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function TitleInput({
	value,
	save,
	done,
}: {
	value: string;
	save: (next: string) => Promise<unknown>;
	done: () => void;
}) {
	const [draft, setDraft] = useState(value);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const commit = () => {
		const next = draft.trim();

		if (next === "" || next === value.trim()) {
			done();

			return;
		}

		setSaving(true);

		save(next).then(done, (failure: unknown) => {
			setSaving(false);

			setError(describeError(failure));
		});
	};

	return (
		<span className="editing wt-edit">
			<input
				ref={focusOnMount}
				className="inp"
				aria-label="Title"
				aria-invalid={error !== null}
				value={draft}
				disabled={saving}
				onClick={(event) => event.stopPropagation()}
				onChange={(event) => setDraft(event.target.value)}
				onBlur={() => {
					if (!saving && error === null) commit();
				}}
				onKeyDown={(event) => {
					event.stopPropagation();

					if (event.key === "Enter") {
						event.preventDefault();

						commit();
					}

					if (event.key === "Escape") {
						event.preventDefault();

						done();
					}
				}}
			/>
			{error === null ? null : (
				<span className="err" role="alert">
					{error}
				</span>
			)}
		</span>
	);
}

const functionOptions = workFunctions.map((value) => ({
	value,
	label: functionLabel[value],
	glyph: <FunctionGlyph fn={value} />,
}));

function AddWorkForm(props: {
	venture: VentureRef;
	placement: { home: Home } | { parentId: string };
	depth: number;
	close: () => void;
}) {
	const cache = useWorkCache(props.venture);
	const [title, setTitle] = useState("");
	const [fn, setFn] = useState<WorkFunction>(lastFunction);
	const isRoot = "home" in props.placement;
	const kind = kindLabel[kindOf({ depth: props.depth })];

	const create = useCommand<"work.create", WorkItem>("work.create", (response) => {
		void cache.store(response.seq, response.result);

		setTitle("");
	});

	const submit = (event: FormEvent) => {
		event.preventDefault();

		if (title.trim() === "") return;

		if (isRoot) lastFunction = fn;

		create.mutate({
			payload: { ventureId: props.venture.id, ...props.placement, title, ...(isRoot ? { function: fn } : {}) },
		});
	};

	return (
		<form
			className="wr add-work"
			style={{ "--d": props.depth } as CSSProperties}
			onSubmit={submit}
			onKeyDown={(event) => {
				event.stopPropagation();

				if (event.key === "Escape") props.close();
			}}
		>
			<span className="fold" />
			<span className="st">
				<Dia status="todo" />
			</span>
			<input
				className="inp"
				aria-label={`${kind} title`}
				placeholder={`${kind} title`}
				value={title}
				required
				maxLength={500}
				ref={focusOnMount}
				onChange={(event) => setTitle(event.target.value)}
			/>
			{isRoot ? <Select title="Function" value={fn} options={functionOptions} onChange={setFn} /> : null}
			<button type="submit" className="btn pri sm" disabled={create.isPending || title.trim() === ""}>
				Add
			</button>
			<button type="button" className="btn ghost sm" onClick={props.close}>
				Done
			</button>
			{create.isError ? (
				<p className="err" role="alert">
					{describeError(create.error)}
				</p>
			) : null}
		</form>
	);
}

function KidRow({ venture, node, open }: { venture: VentureRef; node: WorkNode; open: (id: string) => void }) {
	const { item } = node;
	const cache = useWorkCache(venture);

	const setStatus = useCommand<"work.set_status", WorkItem>(
		"work.set_status",
		(response) => void cache.store(response.seq, response.result),
	);

	return (
		<li className={`kid ${item.status}`}>
			<button
				type="button"
				className="st"
				data-tip={`${statusLabel[item.status]}|click for ${statusLabel[cycleStatus(item.status)].toLowerCase()}`}
				aria-label={`Status ${statusLabel[item.status]}, change to ${statusLabel[cycleStatus(item.status)]}`}
				disabled={setStatus.isPending}
				onClick={() =>
					setStatus.mutate({
						payload: { ventureId: venture.id, workItemId: item.id, status: cycleStatus(item.status) },
					})
				}
			>
				<Dia status={item.status} />
			</button>
			<button type="button" className="wt" onClick={() => open(item.id)}>
				{item.title}
			</button>
			<span className="grow" />
			<FunctionTag fn={item.function} label={functionLabel[item.function]} />
			<Rank priority={item.priority} />
		</li>
	);
}

const priorityOptions = workPriorities.map((value) => ({
	value,
	label: priorityLabel[value],
	glyph: <Rank priority={value} />,
}));

function editingKeys(target: EventTarget | null) {
	return (
		target instanceof HTMLElement &&
		target.closest('input, textarea, select, [contenteditable], [role="listbox"]') !== null
	);
}

function WorkItemPage({
	located,
	holding,
	step,
	go,
	close,
	onArchived,
}: {
	located: Located;
	holding: boolean;
	step: { index: number; total: number; prev: string | null; next: string | null };
	go: (id: string) => void;
	close: () => void;
	onArchived: () => void;
}) {
	const { node, section, parent, ancestors } = located;
	const { item } = node;
	const venture = section.venture;
	const cache = useWorkCache(venture);
	const navigate = useNavigate();
	const pageRef = useRef<HTMLElement>(null);
	const cockpit = useQuery(queries.cockpit(venture.slug)).data;
	const now = Date.now();
	const groups = groupsOf(section, now);
	const homeKey = workHomeKey(item);
	const group = groups.find((candidate) => candidate.key === homeKey);
	const [confirming, setConfirming] = useState(false);
	const base = { ventureId: venture.id, workItemId: item.id };
	const kind = kindOf(item);
	const descendants = node.children.reduce((count, child) => count + 1 + child.children.length, 0);
	const bet = section.bets.find((candidate) => candidate.id === item.betId);
	const assumption = cockpit?.assumptions.find((candidate) => candidate.id === bet?.assumptionId);
	const objectiveId = item.objectiveId ?? assumption?.objectiveId ?? null;
	const objective = (cockpit?.objectives ?? section.objectives).find((candidate) => candidate.id === objectiveId);
	const homeWork = homeProgress(section.items, homeKey);
	const statusIndex = workStatuses.indexOf(item.status);
	const { prev, next } = step;

	useEffect(() => {
		pageRef.current?.focus({ preventScroll: true });
	}, []);

	useEffect(() => {
		const onKeyDown = (event: globalThis.KeyboardEvent) => {
			if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || editingKeys(event.target))
				return;

			const target =
				event.key === "ArrowUp" || event.key === "k"
					? prev
					: event.key === "ArrowDown" || event.key === "j"
						? next
						: undefined;

			if (event.key === "Escape") {
				event.preventDefault();

				close();
			} else if (target !== undefined && target !== null) {
				event.preventDefault();

				go(target);
			}
		};

		document.addEventListener("keydown", onKeyDown);

		return () => document.removeEventListener("keydown", onKeyDown);
	}, [prev, next, go, close]);

	const update = useCommand<"work.update", WorkItem>(
		"work.update",
		(response) => void cache.store(response.seq, response.result),
	);

	const setStatus = useCommand<"work.set_status", WorkItem>(
		"work.set_status",
		(response) => void cache.store(response.seq, response.result),
	);

	const move = useCommand<"work.move", WorkItem>("work.move", (response) => void cache.refresh(response.seq));

	const archive = useCommand<"work.archive", ArchiveWorkResult>("work.archive", (response) => {
		onArchived();

		void cache.drop(response.seq, response.result.archivedIds);
	});

	const error = update.error ?? setStatus.error ?? move.error ?? archive.error;
	const home = parent?.item.title ?? (group === undefined ? null : group.title);

	return (
		<article
			ref={pageRef}
			tabIndex={-1}
			className="wpage"
			style={accent(venture.slug)}
			aria-label={`${kindLabel[kind]}: ${item.title}`}
		>
			<div className="bar">
				<button type="button" className="btn ghost sm wpage-back" data-tip="Back to Work|esc" onClick={close}>
					<Icon name="left" />
					Work
				</button>
				{holding ? (
					<span className="wpage-v">
						<AppIcon slug={venture.slug} size={16} />
						{venture.name}
					</span>
				) : null}
				<span className="grow" />
				{step.index < 0 ? null : (
					<span className="mono mute">
						{step.index + 1} / {step.total}
					</span>
				)}
				<button
					type="button"
					className="ib"
					aria-label="Previous item"
					data-tip="Previous|↑ or K"
					disabled={prev === null}
					onClick={() => prev !== null && go(prev)}
				>
					<Icon name="up" />
				</button>
				<button
					type="button"
					className="ib"
					aria-label="Next item"
					data-tip="Next|↓ or J"
					disabled={next === null}
					onClick={() => next !== null && go(next)}
				>
					<Icon name="down" />
				</button>
				<button
					type="button"
					className="btn pri sm"
					onClick={() =>
						void navigate({
							to: "/v/$slug/threads",
							params: { slug: venture.slug },
							search: { link: `work_item:${item.id}`, label: item.title },
						})
					}
				>
					<Icon name="threads" />
					Start a thread
				</button>
			</div>

			<div className="wpage-cols">
				<div className="wpage-main">
					<div className="wpage-doc">
						<header className="wpage-head">
							<h1>
								<Editable
									label="title"
									value={item.title}
									required
									save={(title) => update.mutateAsync({ payload: { ...base, title } })}
								/>
							</h1>
							<p className="wpage-meta">
								{kindLabel[kind]}
								{home === null ? null : (
									<>
										{" in "}
										{parent === null ? (
											<span>{home}</span>
										) : (
											<button type="button" onClick={() => go(parent.item.id)}>
												{home}
											</button>
										)}
									</>
								)}
							</p>
						</header>

						<section>
							<h2>What done looks like</h2>
							<MarkdownField
								label="description"
								value={item.description}
								placeholder="Describe the result that lets you mark this done. Markdown works: lists, links, code, tables."
								save={(description) => update.mutateAsync({ payload: { ...base, description } })}
							/>
						</section>

						{node.children.length === 0 ? null : (
							<section>
								<h2>
									{item.depth === 0 ? "Tasks" : "Subtasks"}
									<span className="cnt">
										{node.done}/{node.total}
									</span>
								</h2>
								<ul className="kids">
									{node.children.map((child) => (
										<KidRow key={child.item.id} venture={venture} node={child} open={go} />
									))}
								</ul>
							</section>
						)}

						<WorkItemThreads workItem={item} venture={venture} />

						{error === null ? null : (
							<p className="err" role="alert">
								{describeError(error)}
							</p>
						)}
					</div>
				</div>

				<aside className="wpage-side" aria-label={`${kindLabel[kind]} properties`}>
					<div className="wpage-props">
						<fieldset className="stepper">
							<legend className="vh">Status</legend>
							{workStatuses.map((status, index) => (
								<button
									key={status}
									type="button"
									aria-pressed={item.status === status}
									className={index <= statusIndex ? "lit" : undefined}
									disabled={setStatus.isPending}
									onClick={() => setStatus.mutate({ payload: { ...base, status } })}
								>
									<i />
									<span>
										<Dia status={status} />
										{statusLabel[status]}
									</span>
								</button>
							))}
						</fieldset>

						<div className="props">
							<div className="prop">
								<span className="cap">Function</span>
								<Select
									title="Function"
									value={item.function}
									options={functionOptions}
									onChange={(value) => update.mutate({ payload: { ...base, function: value } })}
								/>
							</div>
							<div className="prop">
								<span className="cap">Priority</span>
								<Select
									title="Priority"
									value={item.priority}
									options={priorityOptions}
									onChange={(value) => update.mutate({ payload: { ...base, priority: value } })}
								/>
							</div>
							{node.total === 0 ? null : (
								<div className="prop wide">
									<span className="cap">
										Progress
										<span>
											{node.done} of {node.total} done
										</span>
									</span>
									<span className="bar-p">
										<i style={{ width: `${(node.done / node.total) * 100}%` }} />
									</span>
								</div>
							)}
							{parent === null ? (
								<div className="prop wide">
									<span className="cap">Lives under</span>
									<Select
										title="Lives under"
										value={homeKey}
										disabled={move.isPending}
										options={groups
											.filter((option) => option.open || option.key === homeKey)
											.map((option) => ({
												value: option.key,
												label: option.number === null ? option.title : `${option.number} · ${option.title}`,
											}))}
										onChange={(key) => {
											const target = groups.find((option) => option.key === key);

											if (target === undefined || key === homeKey) return;

											const index = section.items.filter(
												(other) => workHomeKey(other) === key && other.parentId === null,
											).length;

											move.mutate({ payload: { ...base, home: target.home, index } });
										}}
									/>
								</div>
							) : null}
						</div>
					</div>

					<section className="wpage-trace">
						<h2>Traces back to</h2>
						<ol className="chain">
							{objective === undefined ? null : (
								<li>
									<Dia status={objective.status === "active" ? "open" : "done"} />
									<div>
										<span className="cap">
											{objective.kind === "build" ? "Build objective" : "Objective"}
											{objective.kind === "build" ? ` · ${homeWork.done}/${homeWork.total} done` : ""}
										</span>
										<p>{objective.statement}</p>
									</div>
								</li>
							)}
							{assumption === undefined ? null : (
								<li>
									<Dia status="todo" />
									<div>
										<span className="cap">Assumption · confidence {assumption.confidence} of 4</span>
										<p>{assumption.statement}</p>
									</div>
								</li>
							)}
							{bet === undefined ? null : (
								<li>
									<span className="bet-n">{group?.number ?? "B"}</span>
									<div>
										<span className="cap">
											Bet · {homeWork.done}/{homeWork.total} done ·{" "}
											{bet.status === "open" ? timeLeft(bet.deadline, now) : "closed"}
										</span>
										<p>{bet.action}</p>
									</div>
								</li>
							)}
							{bet === undefined && item.objectiveId === null ? (
								<li>
									<Dia status={progressStatus(homeWork)} />
									<div>
										<span className="cap">
											Upkeep · {homeWork.done}/{homeWork.total} done
										</span>
										<p>Tests nothing. It keeps the venture running.</p>
									</div>
								</li>
							) : null}
							{ancestors.map((ancestor) => (
								<li key={ancestor.item.id}>
									<button type="button" onClick={() => go(ancestor.item.id)}>
										<Dia status={ancestor.item.status} />
										<div>
											<span className="cap">{kindLabel[kindOf(ancestor.item)]}</span>
											<p>{ancestor.item.title}</p>
										</div>
									</button>
								</li>
							))}
							<li className="me">
								<Dia status={item.status} />
								<div>
									<span className="cap">This {kind}</span>
									<p>{item.title}</p>
								</div>
							</li>
						</ol>
					</section>

					<footer className="wpage-foot">
						<p className="cap">
							Added {ago(item.createdAt, now)}
							{item.updatedAt === item.createdAt ? null : ` · edited ${ago(item.updatedAt, now)}`}
						</p>
						{confirming ? (
							<div className="wpage-ask">
								<p>
									Archive this {kind} and the {plural(descendants, "item")} under it?
								</p>
								<button type="button" className="btn ghost sm" onClick={() => setConfirming(false)}>
									Cancel
								</button>
								<button
									type="button"
									className="btn danger sm"
									disabled={archive.isPending}
									onClick={() => archive.mutate({ payload: base })}
								>
									Archive {1 + descendants} items
								</button>
							</div>
						) : (
							<button
								type="button"
								className="btn ghost danger sm"
								disabled={archive.isPending}
								onClick={() => (descendants === 0 ? archive.mutate({ payload: base }) : setConfirming(true))}
							>
								<Icon name="archive" />
								Archive
							</button>
						)}
					</footer>
				</aside>
			</div>
		</article>
	);
}

function WorkSkeleton() {
	return (
		<div className="wk">
			<div className="wk-main">
				<div className="bar">
					<h1>Work</h1>
				</div>
				<div className="wk-tree">
					<Skeleton label="Loading work…" widths={[30, 80, 70, 75, 40, 85, 60]} />
				</div>
			</div>
		</div>
	);
}
