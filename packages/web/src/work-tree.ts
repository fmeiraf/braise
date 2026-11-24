import type { Goal, WorkItem, WorkStatus } from "@braise/core";

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
		const key = item.parentId ?? item.goalId;

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

	return new Map([...roots].map(([goalId, list]) => [goalId, list.toSorted(byPosition).map(build)]));
}

export function goalProgress(items: readonly WorkItem[], goalId: string) {
	const ofGoal = items.filter((item) => item.goalId === goalId);

	return { done: ofGoal.filter((item) => item.status === "done").length, total: ofGoal.length };
}

export function orderGoals(goals: readonly Goal[]) {
	return [...goals.filter((goal) => goal.betId !== null), ...goals.filter((goal) => goal.betId === null)];
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
