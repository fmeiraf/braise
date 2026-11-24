import {
	type Goal,
	type WorkFunction,
	type WorkItem,
	type WorkPriority,
	type WorkStatus,
	workFunctions,
	workPriorities,
	workStatuses,
} from "@braise/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import {
	Archive,
	ArrowDown,
	ArrowUp,
	ChevronRight,
	OctagonAlert,
	Plus,
	SignalHigh,
	SignalLow,
	SignalMedium,
	X,
} from "lucide-react";
import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { ArchiveWorkResult } from "./api.ts";
import { Editable } from "./editable.tsx";
import { describeError } from "./errors.ts";
import { focusOnMount } from "./focus.ts";
import { useFreshIds } from "./fresh.ts";
import { PageError } from "./holding.tsx";
import { patchWork, queries, refreshVenture, rememberVenture } from "./live.ts";
import { WorkItemThreads } from "./threads.tsx";
import { ago, formatDate } from "./time.ts";
import { useCommand } from "./use-command.ts";
import { buildForest, cycleStatus, goalProgress, kindOf, orderGoals, type WorkNode } from "./work-tree.ts";

interface VentureRef {
	id: string;
	slug: string;
	name: string;
}

interface WorkSection {
	venture: VentureRef;
	goals: Goal[];
	items: WorkItem[];
}

interface Located {
	node: WorkNode;
	section: WorkSection;
	siblings: number;
	parent: WorkNode | null;
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
		<WorkScreen
			crumbs={
				<>
					<Link to="/" className="crumb">
						Holding
					</Link>
					<span className="muted" aria-hidden>
						/
					</span>
					<Link to="/v/$slug" params={{ slug }} className="crumb">
						{name}
					</Link>
					<span className="muted" aria-hidden>
						/
					</span>
					<span className="crumb-current">Work</span>
				</>
			}
			sections={[{ venture, goals: work.data.goals, items: work.data.workItems }]}
			selectedId={item ?? null}
			select={(next) =>
				void navigate({
					to: "/v/$slug/work",
					params: { slug },
					search: next === null ? {} : { item: next },
					replace: true,
				})
			}
		/>
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
		goals: work.data.goals.filter((goal) => goal.ventureId === venture.id),
		items: work.data.workItems.filter((workItem) => workItem.ventureId === venture.id),
	}));

	return (
		<WorkScreen
			crumbs={
				<>
					<Link to="/" className="crumb">
						Holding
					</Link>
					<span className="muted" aria-hidden>
						/
					</span>
					<span className="crumb-current">Work</span>
				</>
			}
			sections={sections}
			holding
			selectedId={item ?? null}
			select={(next) => void navigate({ to: "/work", search: next === null ? {} : { item: next }, replace: true })}
		/>
	);
}

function locate(sections: readonly WorkSection[]) {
	const located = new Map<string, Located>();
	const forests = new Map<string, Map<string, WorkNode[]>>();

	for (const section of sections) {
		const forest = buildForest(section.items);

		forests.set(section.venture.id, forest);

		const walk = (nodes: WorkNode[], parent: WorkNode | null) => {
			for (const node of nodes) {
				located.set(node.item.id, { node, section, siblings: nodes.length, parent });

				walk(node.children, node);
			}
		};

		for (const roots of forest.values()) walk(roots, null);
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

function WorkScreen(props: {
	crumbs: ReactNode;
	sections: WorkSection[];
	holding?: boolean;
	selectedId: string | null;
	select: (id: string | null) => void;
}) {
	const { sections, selectedId, select } = props;
	const mainRef = useRef<HTMLDivElement>(null);
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
	const [editingId, setEditingId] = useState<string | null>(null);
	const client = useQueryClient();
	const { located, forests } = locate(sections);
	const selected = selectedId === null ? null : (located.get(selectedId) ?? null);
	const allItems = sections.flatMap((section) => section.items);
	const done = allItems.filter((item) => item.status === "done").length;
	const hasGoals = sections.some((section) => section.goals.length > 0);

	useEffect(() => {
		const hash = window.location.hash.slice(1);

		if (hash !== "") document.getElementById(hash)?.scrollIntoView({ block: "start" });
	}, []);

	useEffect(() => {
		if (selectedId === null) return;

		const onEscape = (event: globalThis.KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;

			select(null);

			focusItem(mainRef.current, selectedId);
		};

		document.addEventListener("keydown", onEscape);

		return () => document.removeEventListener("keydown", onEscape);
	}, [selectedId, select]);

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

			select(element.dataset.id ?? null);
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

				select(id);

				setEditingId(id);

				break;
			default:
		}
	};

	return (
		<>
			<header className="topbar">{props.crumbs}</header>

			<div className={selected === null ? "work-layout" : "work-layout has-pane"}>
				<div className="work-main" ref={mainRef}>
					<div className="work-title">
						<h1>Work</h1>
						<span className="muted num">
							{plural(allItems.length, "item")} · {done} done
						</span>
						<span className="kbd-hint work-keys">↑↓ select · ←→ fold · Enter rename · ⌥↑↓ reorder</span>
					</div>

					{hasGoals ? null : (
						<p className="empty-state">
							{props.holding === true
								? "Work hangs off goals, and no venture has a goal yet."
								: "Work hangs off goals, and this venture has none yet."}{" "}
							{props.holding === true || sections[0] === undefined ? null : (
								<Link to="/v/$slug" params={{ slug: sections[0].venture.slug }} className="inline-link">
									Add a goal in the overview
								</Link>
							)}
						</p>
					)}

					{sections.map((section) => (
						<VentureWork
							key={section.venture.id}
							section={section}
							forest={forests.get(section.venture.id) ?? new Map()}
							holding={props.holding === true}
							tree={{
								collapsed,
								toggle,
								selectedId,
								select,
								editingId,
								setEditingId,
								onKeyDown,
								focusRow: (id) => focusItem(mainRef.current, id),
							}}
						/>
					))}
				</div>

				{selected === null ? null : (
					<WorkPane
						key={selected.node.item.id}
						located={selected}
						close={() => {
							select(null);

							focusItem(mainRef.current, selected.node.item.id);
						}}
						onArchived={() => select(null)}
					/>
				)}
			</div>
		</>
	);
}

interface TreeState {
	collapsed: ReadonlySet<string>;
	toggle: (id: string, open?: boolean) => void;
	selectedId: string | null;
	select: (id: string | null) => void;
	editingId: string | null;
	setEditingId: (id: string | null) => void;
	onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
	focusRow: (id: string) => void;
}

function VentureWork({
	section,
	forest,
	holding,
	tree,
}: {
	section: WorkSection;
	forest: Map<string, WorkNode[]>;
	holding: boolean;
	tree: TreeState;
}) {
	const fresh = useFreshIds(section.venture.id, section.items);
	const goals = orderGoals(section.goals);

	const body = goals.map((goal) => (
		<GoalWork
			key={goal.id}
			venture={section.venture}
			goal={goal}
			roots={forest.get(goal.id) ?? []}
			progress={goalProgress(section.items, goal.id)}
			level={holding ? 3 : 2}
			fresh={fresh}
			tree={tree}
		/>
	));

	if (!holding) return <>{body}</>;

	return (
		<section className="work-venture" aria-labelledby={`venture-${section.venture.id}`}>
			<div className="work-venture-head">
				<h2 id={`venture-${section.venture.id}`}>
					<Link to="/v/$slug/work" params={{ slug: section.venture.slug }}>
						{section.venture.name}
					</Link>
				</h2>
				<span className="muted num">{plural(section.items.length, "item")}</span>
			</div>
			{goals.length === 0 ? <p className="empty-state">No goals yet.</p> : body}
		</section>
	);
}

function GoalWork(props: {
	venture: VentureRef;
	goal: Goal;
	roots: WorkNode[];
	progress: { done: number; total: number };
	level: 2 | 3;
	fresh: ReadonlySet<string>;
	tree: TreeState;
}) {
	const { goal, venture } = props;
	const [adding, setAdding] = useState(false);
	const Heading = props.level === 2 ? "h2" : "h3";
	const headingId = `goal-heading-${goal.id}`;

	return (
		<section className="work-goal" id={`goal-${goal.id}`} aria-labelledby={headingId}>
			<div className="work-goal-head">
				<span className={goal.betId === null ? "goal-node is-loose" : "goal-node"} aria-hidden />
				<Heading id={headingId}>{goal.outcome}</Heading>
				{goal.horizon === null ? null : <span className="data muted">{formatDate(goal.horizon)}</span>}
				<span className="work-goal-meta">
					{props.progress.total === 0 ? null : (
						<span className="num">
							{props.progress.done}/{props.progress.total} done
						</span>
					)}
					<button
						type="button"
						className="icon-button"
						aria-label="Add initiative"
						title="Add initiative"
						onClick={() => setAdding(true)}
					>
						<Plus aria-hidden />
					</button>
				</span>
			</div>

			{props.roots.length === 0 && !adding ? (
				<button type="button" className="work-empty" onClick={() => setAdding(true)}>
					No work yet. <span>Add the first initiative</span>
				</button>
			) : (
				<div role="tree" aria-labelledby={headingId} className="work-tree">
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
				<AddWorkForm venture={venture} placement={{ goalId: goal.id }} depth={0} close={() => setAdding(false)} />
			) : props.roots.length === 0 ? null : (
				<button type="button" className="add-row work-add" onClick={() => setAdding(true)}>
					<Plus aria-hidden />
					Add initiative
				</button>
			)}
		</section>
	);
}

function StatusMarker({ status }: { status: WorkStatus }) {
	return <span className={`work-status is-${status}`} aria-hidden />;
}

function PriorityGlyph({ priority }: { priority: WorkPriority }) {
	const label = `Priority: ${priorityLabel[priority].toLowerCase()}`;

	switch (priority) {
		case "low":
			return <SignalLow aria-label={label} className="priority" />;
		case "medium":
			return <SignalMedium aria-label={label} className="priority" />;
		case "high":
			return <SignalHigh aria-label={label} className="priority" />;
		case "urgent":
			return <OctagonAlert aria-label={label} className="priority is-urgent" />;
		default:
			return <span className="priority" />;
	}
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
	const selected = tree.selectedId === item.id;
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

	const className = [
		"work-row",
		selected ? "is-selected" : "",
		item.status === "done" ? "is-done" : "",
		props.fresh.has(item.id) ? "is-fresh" : "",
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
			tabIndex={selected || (tree.selectedId === null && item.depth === 0 && item.position === 0) ? 0 : -1}
			data-id={item.id}
			data-parent={item.parentId ?? ""}
			className="work-item"
			onKeyDown={tree.onKeyDown}
			onClick={(event) => {
				const target = event.target as HTMLElement;

				if (target.closest('[role="treeitem"]') !== event.currentTarget || target.closest("form") !== null) return;

				tree.select(item.id);
			}}
		>
			<div className={className} style={{ paddingLeft: `${item.depth * 22}px` }}>
				{node.children.length > 0 ? (
					<button
						type="button"
						className="work-fold"
						tabIndex={-1}
						aria-label={open ? "Collapse" : "Expand"}
						onClick={(event) => {
							event.stopPropagation();

							tree.toggle(item.id);
						}}
					>
						<ChevronRight aria-hidden className={open ? "is-open" : undefined} />
					</button>
				) : (
					<span className="work-fold" />
				)}

				<button
					type="button"
					className="work-status-button"
					tabIndex={-1}
					title={`${statusLabel[item.status]}. Click for ${statusLabel[cycleStatus(item.status)].toLowerCase()}`}
					aria-label={`Status ${statusLabel[item.status]}, change to ${statusLabel[cycleStatus(item.status)]}`}
					disabled={setStatus.isPending}
					onClick={(event) => {
						event.stopPropagation();

						setStatus.mutate({ payload: { ...base, status: cycleStatus(item.status) } });
					}}
				>
					<StatusMarker status={item.status} />
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
					<span className="work-title-text">{item.title}</span>
				)}

				<span className="work-meta">
					<span
						className="num work-progress"
						title={node.total === 0 ? undefined : `${node.done} of ${node.total} items under it done`}
					>
						{node.total === 0 ? null : `${node.done}/${node.total}`}
					</span>
					<span className="work-function">
						{showFunction ? <span className="tag">{functionLabel[item.function]}</span> : null}
					</span>
					<PriorityGlyph priority={item.priority} />
					<span className="work-row-actions">
						{canNest ? (
							<button
								type="button"
								className="icon-button"
								tabIndex={-1}
								aria-label={`Add ${childKind[item.depth]}`}
								title={`Add ${childKind[item.depth]}`}
								onClick={(event) => {
									event.stopPropagation();

									tree.toggle(item.id, true);

									setAdding(true);
								}}
							>
								<Plus aria-hidden />
							</button>
						) : null}
					</span>
				</span>
			</div>

			{error === null ? null : (
				<p className="error-text work-row-error" role="alert" style={{ paddingLeft: `${item.depth * 22 + 44}px` }}>
					{describeError(error)}
				</p>
			)}

			{(open && node.children.length > 0) || adding ? (
				<div className="work-tree">
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
						<div className="work-add-child">
							<AddWorkForm
								venture={venture}
								placement={{ parentId: item.id }}
								depth={item.depth + 1}
								close={() => setAdding(false)}
							/>
						</div>
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
		<span className="editing work-title-edit">
			<input
				ref={focusOnMount}
				className="input"
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
				<span className="error-text" role="alert">
					{error}
				</span>
			)}
		</span>
	);
}

function AddWorkForm(props: {
	venture: VentureRef;
	placement: { goalId: string } | { parentId: string };
	depth: number;
	close: () => void;
}) {
	const cache = useWorkCache(props.venture);
	const [title, setTitle] = useState("");
	const [fn, setFn] = useState<WorkFunction>(lastFunction);
	const isRoot = "goalId" in props.placement;
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
			className="work-add-form"
			style={{ paddingLeft: `${props.depth * 22 + 22}px` }}
			onSubmit={submit}
			onKeyDown={(event) => {
				event.stopPropagation();

				if (event.key === "Escape") props.close();
			}}
		>
			<StatusMarker status="todo" />
			<input
				className="input"
				aria-label={`${kind} title`}
				placeholder={`${kind} title`}
				value={title}
				required
				maxLength={500}
				ref={focusOnMount}
				onChange={(event) => setTitle(event.target.value)}
			/>
			{isRoot ? (
				<select
					className="select"
					aria-label="Function"
					value={fn}
					onChange={(event) => setFn(event.target.value as WorkFunction)}
				>
					{workFunctions.map((value) => (
						<option key={value} value={value}>
							{functionLabel[value]}
						</option>
					))}
				</select>
			) : null}
			<button type="submit" className="button is-primary" disabled={create.isPending || title.trim() === ""}>
				Add
			</button>
			<button type="button" className="button is-ghost" onClick={props.close}>
				Done
			</button>
			{create.isError ? (
				<p className="error-text" role="alert">
					{describeError(create.error)}
				</p>
			) : null}
		</form>
	);
}

function WorkPane({ located, close, onArchived }: { located: Located; close: () => void; onArchived: () => void }) {
	const { node, section, parent, siblings } = located;
	const { item } = node;
	const venture = section.venture;
	const cache = useWorkCache(venture);
	const [confirming, setConfirming] = useState(false);
	const base = { ventureId: venture.id, workItemId: item.id };
	const kind = kindOf(item);
	const descendants = node.children.reduce((count, child) => count + 1 + child.children.length, 0);
	const goal = section.goals.find((candidate) => candidate.id === item.goalId);

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

	return (
		<aside className="work-pane" aria-label={`${kindLabel[kind]} details`}>
			<div className="work-pane-head">
				<span className="tag">{kindLabel[kind]}</span>
				{parent === null ? (
					<span className="work-pane-path">in {goal?.outcome}</span>
				) : (
					<span className="work-pane-path">in {parent.item.title}</span>
				)}
				<button
					type="button"
					className="icon-button"
					aria-label="Close details"
					title="Close (Esc)"
					onClick={close}
				>
					<X aria-hidden />
				</button>
			</div>

			<div className="work-pane-title">
				<Editable
					label="title"
					value={item.title}
					required
					save={(title) => update.mutateAsync({ payload: { ...base, title } })}
				/>
			</div>

			<dl className="work-fields">
				<dt id="status-label">Status</dt>
				<dd>
					<div className="segmented is-compact" role="radiogroup" aria-labelledby="status-label">
						{workStatuses.map((status) => (
							<label key={status}>
								<input
									type="radio"
									name={`status-${item.id}`}
									value={status}
									checked={item.status === status}
									disabled={setStatus.isPending}
									onChange={() => setStatus.mutate({ payload: { ...base, status } })}
								/>
								<StatusMarker status={status} />
								{statusLabel[status]}
							</label>
						))}
					</div>
				</dd>

				<dt>
					<label htmlFor={`function-${item.id}`}>Function</label>
				</dt>
				<dd>
					<select
						id={`function-${item.id}`}
						className="select"
						value={item.function}
						onChange={(event) =>
							update.mutate({ payload: { ...base, function: event.target.value as WorkFunction } })
						}
					>
						{workFunctions.map((value) => (
							<option key={value} value={value}>
								{functionLabel[value]}
							</option>
						))}
					</select>
				</dd>

				<dt>
					<label htmlFor={`priority-${item.id}`}>Priority</label>
				</dt>
				<dd>
					<select
						id={`priority-${item.id}`}
						className="select"
						value={item.priority}
						onChange={(event) =>
							update.mutate({ payload: { ...base, priority: event.target.value as WorkPriority } })
						}
					>
						{workPriorities.map((value) => (
							<option key={value} value={value}>
								{priorityLabel[value]}
							</option>
						))}
					</select>
				</dd>

				{parent === null ? (
					<>
						<dt>
							<label htmlFor={`goal-${item.id}`}>Goal</label>
						</dt>
						<dd>
							<select
								id={`goal-${item.id}`}
								className="select"
								value={item.goalId}
								disabled={move.isPending}
								onChange={(event) => {
									const goalId = event.target.value;

									const index = section.items.filter(
										(other) => other.goalId === goalId && other.parentId === null,
									).length;

									move.mutate({ payload: { ...base, goalId, index } });
								}}
							>
								{orderGoals(section.goals).map((option) => (
									<option key={option.id} value={option.id}>
										{option.outcome}
									</option>
								))}
							</select>
						</dd>
					</>
				) : null}

				<dt>Order</dt>
				<dd className="work-order">
					<span className="num muted">
						{item.position + 1} of {siblings}
					</span>
					<button
						type="button"
						className="icon-button"
						aria-label="Move up"
						title="Move up (⌥↑)"
						disabled={item.position === 0 || move.isPending}
						onClick={() => move.mutate({ payload: { ...base, index: item.position - 1 } })}
					>
						<ArrowUp aria-hidden />
					</button>
					<button
						type="button"
						className="icon-button"
						aria-label="Move down"
						title="Move down (⌥↓)"
						disabled={item.position >= siblings - 1 || move.isPending}
						onClick={() => move.mutate({ payload: { ...base, index: item.position + 1 } })}
					>
						<ArrowDown aria-hidden />
					</button>
				</dd>
			</dl>

			<div className="work-description">
				<span className="field-label">Description</span>
				<Editable
					label="description"
					value={item.description}
					multiline
					placeholder="What does done look like?"
					save={(description) => update.mutateAsync({ payload: { ...base, description } })}
				/>
			</div>

			<WorkItemThreads workItem={item} venture={venture} />

			{error === null ? null : (
				<p className="error-text" role="alert">
					{describeError(error)}
				</p>
			)}

			<div className="work-pane-foot">
				<span className="muted">
					Added {ago(item.createdAt, Date.now())}
					{item.updatedAt === item.createdAt ? null : ` · edited ${ago(item.updatedAt, Date.now())}`}
				</span>

				{confirming ? (
					<div className="settle work-confirm">
						<p>
							Archive this {kind} and the {plural(descendants, "item")} under it?
						</p>
						<button
							type="button"
							className="button is-primary"
							disabled={archive.isPending}
							onClick={() => archive.mutate({ payload: base })}
						>
							Archive {1 + descendants} items
						</button>
						<button type="button" className="button is-ghost" onClick={() => setConfirming(false)}>
							Cancel
						</button>
					</div>
				) : (
					<button
						type="button"
						className="button"
						disabled={archive.isPending}
						onClick={() => (descendants === 0 ? archive.mutate({ payload: base }) : setConfirming(true))}
					>
						<Archive aria-hidden />
						Archive {kind}
					</button>
				)}
			</div>
		</aside>
	);
}

function WorkSkeleton() {
	return (
		<>
			<header className="topbar">
				<span className="skeleton" style={{ width: 180 }} />
			</header>
			<div className="work-layout">
				<div className="work-main skeleton-stack" aria-busy="true">
					<span className="visually-hidden">Loading work…</span>
					{[30, 80, 70, 75, 40, 85, 60].map((width) => (
						<span key={width} className="skeleton" style={{ width: `${width}%` }} />
					))}
				</div>
			</div>
		</>
	);
}
