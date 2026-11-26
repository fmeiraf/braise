import { type WorkFunction, type WorkItem, type WorkStatus, workHomeKey } from "@braise/core";

export interface WorkNode {
	item: WorkItem;
	children: WorkNode[];
	done: number;
	total: number;
}

export const workKinds = ["initiative", "task", "subtask"] as const;

export function kindOf(item: Pick<WorkItem, "depth">) {
	return workKinds[item.depth] ?? "subtask";
}

const byPosition = (a: WorkItem, b: WorkItem) => a.position - b.position;

export function buildForest(items: readonly WorkItem[]) {
	const childrenOf = new Map<string, WorkItem[]>();
	const roots = new Map<string, WorkItem[]>();

	for (const item of items) {
		const bucket = item.parentId === null ? roots : childrenOf;
		const key = item.parentId ?? workHomeKey(item);

		bucket.set(key, [...(bucket.get(key) ?? []), item]);
	}

	const build: (item: WorkItem) => WorkNode = (item) => {
		const children = (childrenOf.get(item.id) ?? []).toSorted(byPosition).map(build);

		return {
			item,
			children,
			done: children.reduce((sum, child) => sum + child.done + (child.item.status === "done" ? 1 : 0), 0),
			total: children.reduce((sum, child) => sum + child.total + 1, 0),
		};
	};

	return new Map([...roots].map(([home, list]) => [home, list.toSorted(byPosition).map(build)]));
}

export function homeProgress(items: readonly WorkItem[], home: string) {
	const inHome = items.filter((item) => workHomeKey(item) === home);

	return { done: inHome.filter((item) => item.status === "done").length, total: inHome.length };
}

/** Keeps the branches that hold work of one function: a match, with the path that leads to it. */
export function filterForest(nodes: readonly WorkNode[], fn: WorkFunction | null) {
	if (fn === null) return [...nodes];

	const kept: WorkNode[] = [];

	for (const node of nodes) {
		const children = filterForest(node.children, fn);

		if (node.item.function === fn || children.length > 0) kept.push({ ...node, children });
	}

	return kept;
}

export function visibleRows(forest: readonly WorkNode[], collapsed: ReadonlySet<string>) {
	const rows: WorkNode[] = [];

	const walk = (nodes: readonly WorkNode[]) => {
		for (const node of nodes) {
			rows.push(node);

			if (!collapsed.has(node.item.id)) walk(node.children);
		}
	};

	walk(forest);

	return rows;
}

const nextStatus: Record<WorkStatus, WorkStatus> = { todo: "doing", doing: "done", done: "todo" };

export function cycleStatus(status: WorkStatus) {
	return nextStatus[status];
}
