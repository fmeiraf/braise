import { z } from "zod";

const text = z.string().trim().min(1).max(10_000);
const longText = z.string().trim().max(10_000);
const id = z.uuid();
const isoDate = z.iso.date();

export const ventureKinds = ["for_profit", "non_profit"] as const;
export const betStatuses = ["open", "won", "lost", "killed"] as const;
export const workStatuses = ["todo", "doing", "done"] as const;
export const workFunctions = ["product", "design", "engineering", "marketing", "sales", "ops"] as const;
export const workPriorities = ["none", "low", "medium", "high", "urgent"] as const;
export const maxWorkDepth = 2;
export const threadLinkTypes = ["work_item", "goal", "bet", "venture"] as const;
export const runStatuses = ["queued", "running", "succeeded", "failed", "cancelled", "interrupted"] as const;
export const activeRunStatuses = ["queued", "running"] as const;
export const maxThreadLinks = 20;

export const proposableCommands = [
	"strategy.revise",
	"bet.create",
	"bet.update",
	"bet.set_status",
	"goal.create",
	"goal.update",
] as const;

export const proposalStatuses = ["pending", "approved", "rejected"] as const;
export const capabilities = ["work", "links", "propose"] as const;
export const accessRequestStatuses = ["pending", "approved", "denied"] as const;
export const defaultAgentProfileId = "claude";
export const maxProposalChanges = 10;
export const proposalTitleLength = 120;
export const threadTitleLength = 80;

export const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const ventureScoped = { ventureId: id };

const threadLink = z.strictObject({ type: z.enum(threadLinkTypes), id });

const messageBody = text.max(20_000);

const changePayload = z.record(z.string(), z.unknown());

const proposalChange = z.strictObject({ command: z.enum(proposableCommands), payload: changePayload });

const note = z.string().trim().min(1).max(2_000);

const profileId = z.string().regex(slugPattern).max(40);

const capability = z.enum(capabilities);

export const commandSchemas = {
	"venture.create": z.strictObject({
		name: text.max(120),
		slug: z.string().regex(slugPattern).max(64).optional(),
		kind: z.enum(ventureKinds),
		why: text,
		what: text,
		diagnosis: longText.default(""),
		guidingPolicy: longText.default(""),
	}),
	"venture.archive": z.strictObject({ ...ventureScoped }),
	"strategy.revise": z.strictObject({
		...ventureScoped,
		why: text,
		what: text,
		diagnosis: longText,
		guidingPolicy: longText,
	}),
	"bet.create": z.strictObject({
		...ventureScoped,
		hypothesis: text,
		action: text,
		killCriteria: text,
	}),
	"bet.update": z
		.strictObject({
			...ventureScoped,
			betId: id,
			hypothesis: text.optional(),
			action: text.optional(),
			killCriteria: text.optional(),
		})
		.refine((value) => [value.hypothesis, value.action, value.killCriteria].some((field) => field !== undefined), {
			message: "Change at least one field",
		}),
	"bet.archive": z.strictObject({ ...ventureScoped, betId: id }),
	"bet.set_status": z.strictObject({
		...ventureScoped,
		betId: id,
		status: z.enum(["won", "lost", "killed"]),
		archiveGoals: z.boolean(),
	}),
	"goal.create": z.strictObject({
		...ventureScoped,
		betId: id.nullable(),
		outcome: text,
		signal: text,
		horizon: isoDate.nullable(),
	}),
	"goal.update": z
		.strictObject({
			...ventureScoped,
			goalId: id,
			betId: id.nullable().optional(),
			outcome: text.optional(),
			signal: text.optional(),
			horizon: isoDate.nullable().optional(),
		})
		.refine(
			(value) => [value.betId, value.outcome, value.signal, value.horizon].some((field) => field !== undefined),
			{ message: "Change at least one field" },
		),
	"goal.archive": z.strictObject({ ...ventureScoped, goalId: id }),
	"work.create": z
		.strictObject({
			...ventureScoped,
			goalId: id.optional(),
			parentId: id.optional(),
			title: text.max(500),
			description: longText.default(""),
			function: z.enum(workFunctions).optional(),
			priority: z.enum(workPriorities).default("none"),
		})
		.refine((value) => (value.goalId === undefined) !== (value.parentId === undefined), {
			message: "Give either a goal (new initiative) or a parent, not both",
			path: ["goalId"],
		})
		.refine((value) => value.parentId !== undefined || value.function !== undefined, {
			message: "An initiative needs a function",
			path: ["function"],
		}),
	"work.update": z
		.strictObject({
			...ventureScoped,
			workItemId: id,
			title: text.max(500).optional(),
			description: longText.optional(),
			function: z.enum(workFunctions).optional(),
			priority: z.enum(workPriorities).optional(),
		})
		.refine(
			(value) =>
				[value.title, value.description, value.function, value.priority].some((field) => field !== undefined),
			{ message: "Change at least one field" },
		),
	"work.set_status": z.strictObject({ ...ventureScoped, workItemId: id, status: z.enum(workStatuses) }),
	"work.move": z.strictObject({
		...ventureScoped,
		workItemId: id,
		index: z.number().int().min(0),
		goalId: id.optional(),
	}),
	"work.archive": z.strictObject({ ...ventureScoped, workItemId: id }),
	"thread.start": z.strictObject({
		ventureId: id.optional(),
		agentProfileId: profileId.default(defaultAgentProfileId),
		body: messageBody,
		links: z.array(threadLink).max(maxThreadLinks).default([]),
	}),
	"thread.post": z.strictObject({
		threadId: id,
		body: messageBody,
		links: z.array(threadLink).max(maxThreadLinks).default([]),
	}),
	"thread.link": z.strictObject({ threadId: id, link: threadLink }),
	"thread.unlink": z.strictObject({ threadId: id, link: threadLink }),
	"thread.rename": z.strictObject({ threadId: id, title: text.max(threadTitleLength) }),
	"thread.archive": z.strictObject({ threadId: id }),
	"run.cancel": z.strictObject({ runId: id }),
	"run.retry": z.strictObject({ runId: id }),
	"proposal.create": z.strictObject({
		...ventureScoped,
		threadId: id,
		title: text.max(proposalTitleLength),
		reason: text.max(2_000),
		changes: z.array(proposalChange).min(1).max(maxProposalChanges),
	}),
	"proposal.approve": z.strictObject({
		...ventureScoped,
		proposalId: id,
		changes: z
			.array(z.strictObject({ payload: changePayload }).nullable())
			.min(1)
			.max(maxProposalChanges),
		note: note.optional(),
	}),
	"proposal.reject": z.strictObject({ ...ventureScoped, proposalId: id, note: note.optional() }),
	"access.request": z.strictObject({
		capability,
		threadId: id,
		command: z.string().min(1).max(80),
		payload: changePayload,
	}),
	"access.approve": z.strictObject({ accessRequestId: id, note: note.optional() }),
	"access.deny": z.strictObject({ accessRequestId: id, note: note.optional() }),
	"grant.add": z.strictObject({ profileId, capability }),
	"grant.revoke": z.strictObject({ profileId, capability }),
};

export type CommandName = keyof typeof commandSchemas;

export type CommandInput<Name extends CommandName> = z.input<(typeof commandSchemas)[Name]>;

export type CommandPayload<Name extends CommandName> = z.output<(typeof commandSchemas)[Name]>;

export type ProposableCommand = (typeof proposableCommands)[number];

export const commandsRequiringReason = new Set<CommandName>(["strategy.revise", "proposal.approve"]);

export const threadCommands = new Set<CommandName>([
	"thread.start",
	"thread.post",
	"thread.link",
	"thread.unlink",
	"thread.rename",
	"thread.archive",
	"run.cancel",
	"run.retry",
]);

export const accessCommands = new Set<CommandName>([
	"access.request",
	"access.approve",
	"access.deny",
	"grant.add",
	"grant.revoke",
]);

export const agentActorPrefix = "agent:";

export const systemAuthor = "braise";

export function isAgentActor(actor: string) {
	return actor.startsWith(agentActorPrefix);
}

export function threadTitle(body: string) {
	const firstLine = body.trim().split("\n", 1)[0]?.trim() ?? "";
	const characters = [...firstLine];

	if (characters.length <= threadTitleLength) return firstLine;

	return `${characters
		.slice(0, threadTitleLength - 1)
		.join("")
		.trimEnd()}…`;
}

export const commandEnvelope = z.strictObject({
	payload: z.unknown(),
	idempotencyKey: z.string().min(8).max(200),
	reason: z.string().trim().min(1).max(2_000).optional(),
});

export type CommandEnvelope = z.infer<typeof commandEnvelope>;

export function isCommandName(name: string): name is CommandName {
	return Object.hasOwn(commandSchemas, name);
}
