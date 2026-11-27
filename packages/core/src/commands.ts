import { z } from "zod";

const text = z.string().trim().min(1).max(10_000);
const longText = z.string().trim().max(10_000);
const id = z.uuid();
const isoDate = z.iso.date();

export const ventureKinds = ["for_profit", "non_profit"] as const;
export const objectiveKinds = ["metric", "learning", "build"] as const;
export const objectiveStatuses = ["active", "met", "dropped"] as const;
export const impacts = ["low", "medium", "high"] as const;
export const assumptionStatuses = ["open", "holds", "false", "dropped"] as const;
export const betStatuses = ["open", "closed"] as const;

export const betMethods = [
	"existing_data",
	"interviews",
	"fake_door",
	"concierge",
	"before_after",
	"staggered_rollout",
	"ab_test",
] as const;

export const betResults = ["pass", "fail", "inconclusive"] as const;
export const failCauses = ["idea", "execution"] as const;
export const readingSubjects = ["objective", "bet"] as const;
export const maxConfidence = 4;
export const maxClimbingObjectives = 2;
export const maxDoneItems = 20;
export const workStatuses = ["todo", "doing", "done"] as const;
export const workFunctions = ["product", "design", "engineering", "marketing", "sales", "ops"] as const;
export const workPriorities = ["none", "low", "medium", "high", "urgent"] as const;
export const maxWorkDepth = 2;
export const threadLinkTypes = ["work_item", "bet", "assumption", "objective", "venture"] as const;
export const runStatuses = ["queued", "running", "succeeded", "failed", "cancelled", "interrupted"] as const;
export const activeRunStatuses = ["queued", "running"] as const;
export const maxThreadLinks = 20;

export const proposableCommands = [
	"strategy.revise",
	"objective.create",
	"objective.update",
	"objective.close",
	"assumption.create",
	"assumption.update",
	"bet.create",
	"bet.update",
	"bet.close",
] as const;

export const legacyProposableCommands = ["bet.set_status", "goal.create", "goal.update"] as const;

export const proposalStatuses = ["pending", "approved", "rejected"] as const;
export const capabilities = ["work", "links", "propose", "delegate", "code"] as const;
export const accessRequestStatuses = ["pending", "approved", "denied"] as const;
export const defaultAgentProfileId = "claude";
export const maxProposalChanges = 10;
export const proposalTitleLength = 120;
export const threadTitleLength = 80;
export const spaceTitleLength = 80;
export const maxThreadsStartedPerRun = 8;
export const maxWakesSinceOwner = 5;
export const reportOutcomes = ["succeeded", "failed", "interrupted", "cancelled", "needs_input"] as const;
export const inputRequestStatuses = ["pending", "answered"] as const;
export const runtimeNames = ["claude-agent-sdk", "pi"] as const;
export const limitStatuses = ["allowed", "warning", "rejected"] as const;
export const pauseReasons = ["limit", "owner"] as const;
export const repoStatuses = ["cloning", "ready", "failed", "no_access"] as const;
export const pullRequestStates = ["open", "closed", "merged"] as const;
export const maxAllowedDomains = 20;
export const pullRequestTitleLength = 200;

export const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const ventureScoped = { ventureId: id };

const threadLink = z.strictObject({ type: z.enum(threadLinkTypes), id });

const messageBody = text.max(20_000);

const changePayload = z.record(z.string(), z.unknown());

const proposalChange = z.strictObject({ command: z.enum(proposableCommands), payload: changePayload });

const note = z.string().trim().min(1).max(2_000);

const profileId = z.string().regex(slugPattern).max(40);

const capability = z.enum(capabilities);

const githubId = z.number().int().positive();

const domain = z
	.string()
	.trim()
	.toLowerCase()
	.regex(/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/u, "A host name such as registry.example.com or *.example.com");

const amount = z.number();

const confidence = z.number().int().min(0).max(maxConfidence);

const shortText = z.string().trim().max(200);

const statement = text.max(1_000);

const objectiveCommon = {
	...ventureScoped,
	statement,
	guardrails: longText.default(""),
	budget: shortText.default(""),
};

const doneItem = z.strictObject({ id: id.optional(), text: text.max(500) });

const workHome = z.discriminatedUnion("type", [
	z.strictObject({ type: z.literal("bet"), id }),
	z.strictObject({ type: z.literal("objective"), id }),
	z.strictObject({ type: z.literal("upkeep") }),
]);

const someField = (value: Record<string, unknown>, fields: readonly string[]) =>
	fields.some((field) => value[field] !== undefined);

const objectiveFields = [
	"statement",
	"byDate",
	"guardrails",
	"budget",
	"measure",
	"unit",
	"baseline",
	"target",
	"decision",
	"doneRule",
	"doneList",
] as const;

const assumptionFields = ["objectiveId", "statement", "impact", "function", "status"] as const;

export const betLockedFields = ["signal", "unit", "baseline", "passAt", "failAt", "method", "deadline"] as const;

const betFields = ["function", "action", "budget", ...betLockedFields] as const;

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
	"objective.create": z.discriminatedUnion("kind", [
		z
			.strictObject({
				...objectiveCommon,
				kind: z.literal("metric"),
				measure: text.max(200),
				unit: shortText.max(20).default(""),
				baseline: amount,
				target: amount,
				byDate: isoDate,
			})
			.refine((value) => value.baseline !== value.target, {
				message: "The target must differ from the baseline",
				path: ["target"],
			}),
		z.strictObject({
			...objectiveCommon,
			kind: z.literal("learning"),
			decision: text,
			doneRule: text,
			byDate: isoDate.nullable().default(null),
		}),
		z.strictObject({
			...objectiveCommon,
			kind: z.literal("build"),
			doneList: z.array(text.max(500)).min(1).max(maxDoneItems),
			byDate: isoDate,
		}),
	]),
	"objective.update": z
		.strictObject({
			...ventureScoped,
			objectiveId: id,
			statement: statement.optional(),
			byDate: isoDate.nullable().optional(),
			guardrails: longText.optional(),
			budget: shortText.optional(),
			measure: text.max(200).optional(),
			unit: shortText.max(20).optional(),
			baseline: amount.optional(),
			target: amount.optional(),
			decision: text.optional(),
			doneRule: text.optional(),
			doneList: z.array(doneItem).min(1).max(maxDoneItems).optional(),
		})
		.refine((value) => someField(value, objectiveFields), { message: "Change at least one field" }),
	"objective.check": z.strictObject({ ...ventureScoped, objectiveId: id, itemId: id, done: z.boolean() }),
	"objective.close": z.strictObject({ ...ventureScoped, objectiveId: id, status: z.enum(["met", "dropped"]) }),
	"objective.archive": z.strictObject({ ...ventureScoped, objectiveId: id }),
	"assumption.create": z.strictObject({
		...ventureScoped,
		objectiveId: id.nullable(),
		statement,
		impact: z.enum(impacts).default("medium"),
		confidence: confidence.min(1).default(1),
		function: z.enum(workFunctions),
	}),
	"assumption.update": z
		.strictObject({
			...ventureScoped,
			assumptionId: id,
			objectiveId: id.nullable().optional(),
			statement: statement.optional(),
			impact: z.enum(impacts).optional(),
			function: z.enum(workFunctions).optional(),
			status: z.enum(assumptionStatuses).optional(),
		})
		.refine((value) => someField(value, assumptionFields), { message: "Change at least one field" }),
	"assumption.archive": z.strictObject({ ...ventureScoped, assumptionId: id }),
	"bet.create": z
		.strictObject({
			...ventureScoped,
			assumptionId: id,
			function: z.enum(workFunctions),
			action: text.max(2_000),
			signal: text.max(500),
			unit: shortText.max(20).default(""),
			baseline: amount.nullable().default(null),
			passAt: amount,
			failAt: amount,
			method: z.enum(betMethods),
			budget: shortText.default(""),
			deadline: isoDate,
		})
		.refine((value) => value.passAt !== value.failAt, {
			message: "The pass and fail marks must differ",
			path: ["failAt"],
		}),
	"bet.update": z
		.strictObject({
			...ventureScoped,
			betId: id,
			function: z.enum(workFunctions).optional(),
			action: text.max(2_000).optional(),
			signal: text.max(500).optional(),
			unit: shortText.max(20).optional(),
			baseline: amount.nullable().optional(),
			passAt: amount.optional(),
			failAt: amount.optional(),
			method: z.enum(betMethods).optional(),
			budget: shortText.optional(),
			deadline: isoDate.optional(),
		})
		.refine((value) => someField(value, betFields), { message: "Change at least one field" }),
	"bet.close": z
		.strictObject({
			...ventureScoped,
			betId: id,
			result: z.enum(betResults),
			cause: z.enum(failCauses).optional(),
			statement: text.max(2_000),
			confidenceTo: confidence.optional(),
		})
		.refine((value) => (value.result === "fail") === (value.cause !== undefined), {
			message: "A failed bet says whether the idea or the execution was wrong; other results don't",
			path: ["cause"],
		}),
	"bet.archive": z.strictObject({ ...ventureScoped, betId: id }),
	"reading.record": z.strictObject({
		...ventureScoped,
		subject: z.strictObject({ type: z.enum(readingSubjects), id }),
		value: amount,
		takenOn: isoDate,
		source: text.max(500),
	}),
	"work.create": z
		.strictObject({
			...ventureScoped,
			home: workHome.optional(),
			parentId: id.optional(),
			title: text.max(500),
			description: longText.default(""),
			function: z.enum(workFunctions).optional(),
			priority: z.enum(workPriorities).default("none"),
		})
		.refine((value) => (value.home === undefined) !== (value.parentId === undefined), {
			message: "Give either a home (new initiative) or a parent, not both",
			path: ["home"],
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
		home: workHome.optional(),
	}),
	"work.archive": z.strictObject({ ...ventureScoped, workItemId: id }),
	"thread.start": z.strictObject({
		ventureId: id.optional(),
		spaceId: id.optional(),
		agentProfileId: profileId.default(defaultAgentProfileId),
		title: text.max(threadTitleLength).optional(),
		body: messageBody,
		links: z.array(threadLink).max(maxThreadLinks).default([]),
	}),
	"thread.message": z.strictObject({ threadId: id, body: messageBody }),
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
	"space.create": z.strictObject({
		ventureId: id.optional(),
		title: text.max(spaceTitleLength),
		goal: longText.max(2_000).optional(),
		agentProfileId: profileId.default(defaultAgentProfileId),
		links: z.array(threadLink).max(maxThreadLinks).default([]),
	}),
	"space.update": z
		.strictObject({
			spaceId: id,
			title: text.max(spaceTitleLength).optional(),
			goal: longText.max(2_000).nullable().optional(),
			agentProfileId: profileId.optional(),
		})
		.refine((value) => someField(value, ["title", "goal", "agentProfileId"]), {
			message: "Change at least one field",
		}),
	"space.archive": z.strictObject({ spaceId: id }),
	"space.add_thread": z.strictObject({ spaceId: id, threadId: id }),
	"space.remove_thread": z.strictObject({ spaceId: id, threadId: id }),
	"input.request": z.strictObject({ question: text.max(4_000) }),
	"github.connect": z.strictObject({
		appId: githubId,
		slug: z.string().trim().min(1).max(100),
		ownerLogin: z.string().trim().min(1).max(100),
		htmlUrl: z.url(),
	}),
	"venture.add_repo": z.strictObject({
		...ventureScoped,
		githubRepoId: githubId,
		installationId: githubId,
		fullName: z
			.string()
			.trim()
			.regex(/^[\w.-]+\/[\w.-]+$/u),
		defaultBranch: z.string().trim().min(1).max(255),
	}),
	"venture.update_repo": z.strictObject({
		...ventureScoped,
		repoId: id,
		allowedDomains: z.array(domain).max(maxAllowedDomains),
	}),
	"venture.remove_repo": z.strictObject({ ...ventureScoped, repoId: id }),
	"repo.fetch": z.strictObject({ repoId: id }),
	"repo.push": z.strictObject({ ...ventureScoped, threadId: id, repoId: id }),
	"pr.open": z.strictObject({
		...ventureScoped,
		threadId: id,
		repoId: id,
		title: text.max(pullRequestTitleLength),
		body: longText.max(20_000).default(""),
		draft: z.boolean().default(false),
	}),
	"pr.update": z
		.strictObject({
			...ventureScoped,
			pullRequestId: id,
			title: text.max(pullRequestTitleLength).optional(),
			body: longText.max(20_000).optional(),
		})
		.refine((value) => someField(value, ["title", "body"]), { message: "Change at least one field" }),
	"runtime.pause": z.strictObject({ runtime: z.enum(runtimeNames) }),
	"runtime.resume": z.strictObject({ runtime: z.enum(runtimeNames) }),
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

export type LegacyProposableCommand = (typeof legacyProposableCommands)[number];

export const commandsRequiringReason = new Set<CommandName>(["strategy.revise", "proposal.approve"]);

export const threadCommands = new Set<CommandName>([
	"thread.start",
	"thread.post",
	"thread.message",
	"thread.link",
	"thread.unlink",
	"thread.rename",
	"thread.archive",
	"run.cancel",
	"run.retry",
	"space.create",
	"space.update",
	"space.archive",
	"space.add_thread",
	"space.remove_thread",
	"input.request",
]);

export const accessCommands = new Set<CommandName>([
	"access.request",
	"access.approve",
	"access.deny",
	"grant.add",
	"grant.revoke",
	"runtime.pause",
	"runtime.resume",
	"github.connect",
	"repo.fetch",
]);

export const openAgentCommands = new Set<CommandName>(["access.request", "input.request"]);

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
