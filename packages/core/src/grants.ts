import type { CommandName, capabilities } from "./commands.ts";

export type Capability = (typeof capabilities)[number];

export const capabilityCommands = {
	work: ["work.create", "work.update", "work.set_status", "work.move", "reading.record", "objective.check"],
	links: ["thread.link", "thread.unlink"],
	propose: ["proposal.create"],
	delegate: ["thread.start", "thread.message", "run.retry", "space.add_thread", "space.remove_thread"],
	code: ["repo.push", "pr.open", "pr.update"],
} as const satisfies Record<Capability, readonly CommandName[]>;

export const capabilityLabels = {
	work: "Work and readings",
	links: "Thread links",
	propose: "Proposals",
	delegate: "Start and direct threads",
	code: "Push branches and open PRs",
} as const satisfies Record<Capability, string>;

export function capabilityOf(name: CommandName) {
	for (const [capability, names] of Object.entries(capabilityCommands)) {
		if ((names as readonly string[]).includes(name)) return capability as Capability;
	}

	return null;
}

export function accessDecisionLine(decision: {
	status: "approved" | "denied";
	capability: Capability;
	agentName: string;
	note: string | null;
}) {
	const verb = decision.status === "approved" ? "Granted" : "Denied";
	const head = `${verb} ${capabilityLabels[decision.capability]} to ${decision.agentName}`;

	return decision.note === null ? head : `${head} · ${decision.note}`;
}

const attemptVerbs: Partial<Record<CommandName, string>> = {
	"work.create": "create work item",
	"work.update": "edit work item",
	"work.set_status": "set the status of work item",
	"work.move": "move work item",
	"reading.record": "record a reading",
	"objective.check": "tick the done list",
	"thread.link": "link this thread",
	"thread.unlink": "unlink this thread",
	"proposal.create": "propose",
	"thread.start": "start a thread",
	"thread.message": "message a thread",
	"run.retry": "retry a thread",
	"space.add_thread": "add a thread to the space",
	"space.remove_thread": "remove a thread from the space",
	"repo.push": "push its branch",
	"pr.open": "open a pull request",
	"pr.update": "edit a pull request",
};

function quoted(value: unknown) {
	return typeof value === "string" && value.trim() !== "" ? `“${value.trim()}”` : null;
}

export function attemptSummary(command: string, payload: Record<string, unknown>) {
	const verb = attemptVerbs[command as CommandName] ?? command;

	const detail =
		quoted(payload.title) ??
		(typeof payload.status === "string" ? `to ${payload.status}` : null) ??
		(typeof payload.value === "number" ? `of ${payload.value}` : null) ??
		(typeof payload.link === "object" && payload.link !== null && "type" in payload.link
			? `to a ${String(payload.link.type).replace("_", " ")}`
			: null);

	return detail === null ? verb : `${verb} ${detail}`;
}
