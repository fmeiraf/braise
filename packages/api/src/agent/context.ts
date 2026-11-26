import {
	type Assumption,
	type Bet,
	type Capability,
	capabilities,
	capabilityLabels,
	type Learning,
	methodCeilings,
	type Objective,
	rankAssumptions,
	systemAuthor,
	type ThreadLink,
	type ThreadMessage,
} from "@braise/core";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import { agentGrants, agentProfiles, proposals, strategyVersions, ventures } from "../db/schema.ts";
import { AppError } from "../errors.ts";
import { getCockpit } from "../queries.ts";
import { getThread } from "../thread-queries.ts";

export interface ContextVenture {
	id: string;
	slug: string;
	name: string;
}

type LoopObjective = Pick<
	Objective,
	| "id"
	| "kind"
	| "statement"
	| "measure"
	| "unit"
	| "baseline"
	| "target"
	| "decision"
	| "doneRule"
	| "doneList"
	| "byDate"
	| "guardrails"
	| "budget"
> & { latest: number | null };

type LoopAssumption = Pick<
	Assumption,
	"id" | "objectiveId" | "statement" | "impact" | "confidence" | "function" | "status"
> & { createdAt: string };

type LoopBet = Pick<
	Bet,
	"id" | "assumptionId" | "action" | "signal" | "unit" | "passAt" | "failAt" | "method" | "deadline"
> & { latest: number | null };

type LoopLearning = Pick<Learning, "assumptionId" | "result" | "cause" | "statement">;

/** Where a venture stands on its objectives: what an agent reads before it picks the next step. */
export interface LoopState {
	objectives: LoopObjective[];
	assumptions: LoopAssumption[];
	bets: LoopBet[];
	learnings: LoopLearning[];
}

export interface RunContext {
	today: string;
	agent: { name: string; grants: Capability[] };
	thread: { id: string; title: string };
	scope:
		| (ContextVenture & {
				strategy: { why: string; what: string; diagnosis: string; guidingPolicy: string } | null;
				loop: LoopState;
		  })
		| null;
	ventures: ContextVenture[];
	links: ThreadLink[];
	transcript: Pick<ThreadMessage, "author" | "body">[];
	pendingProposals: { id: string; title: string; changeCount: number }[];
	message: string;
}

const linkNames = {
	work_item: "work item",
	bet: "bet",
	assumption: "assumption",
	objective: "objective",
	venture: "venture",
} as const;

function amount(value: number | null, unit: string) {
	return value === null ? "none yet" : `${value}${unit}`;
}

function objectiveLine(objective: LoopObjective) {
	const extras = [
		objective.guardrails === "" ? null : `Guardrails: ${objective.guardrails}`,
		objective.budget === "" ? null : `Budget: ${objective.budget}`,
	]
		.filter((part) => part !== null)
		.join(". ");

	const tail = extras === "" ? "" : ` ${extras}.`;
	const head = `- ${objective.kind} objective "${objective.statement}" (id ${objective.id})`;
	const by = objective.byDate === null ? "no date" : `by ${objective.byDate}`;

	if (objective.kind === "metric") {
		return `${head}: ${objective.measure}, baseline ${amount(objective.baseline, objective.unit)}, latest reading ${amount(objective.latest, objective.unit)}, target ${amount(objective.target, objective.unit)} ${by}.${tail}`;
	}

	if (objective.kind === "learning") {
		return `${head}: answers the decision "${objective.decision}"; counts as answered when ${objective.doneRule} (${by}).${tail}`;
	}

	const done = objective.doneList.map((item) => `  - [${item.done ? "x" : " "}] ${item.text} (item ${item.id})`);

	return [`${head}: built by vision, no assumptions or bets; time box ends ${by}.${tail} Done means:`, ...done].join(
		"\n",
	);
}

function assumptionLines(assumption: LoopAssumption, loop: LoopState) {
	const head = `  - [${assumption.impact} impact, confidence ${assumption.confidence}/4, ${assumption.function}${assumption.status === "open" ? "" : `, ${assumption.status}`}] "${assumption.statement}" (id ${assumption.id})`;

	const open = loop.bets
		.filter((bet) => bet.assumptionId === assumption.id)
		.map(
			(bet) =>
				`    - open bet (id ${bet.id}): ${bet.action} Signal: ${bet.signal}; pass at ${bet.passAt}${bet.unit}, fail past ${bet.failAt}${bet.unit}; method ${bet.method} (can earn confidence ${methodCeilings[bet.method]}); deadline ${bet.deadline}; latest reading ${amount(bet.latest, bet.unit)}.`,
		);

	const learned = loop.learnings
		.filter((learning) => learning.assumptionId === assumption.id)
		.map(
			(learning) =>
				`    - learned (${learning.result}${learning.cause === null ? "" : `, ${learning.cause} was wrong`}): ${learning.statement}`,
		);

	return [head, ...open, ...learned];
}

export function renderLoop(name: string, loop: LoopState) {
	if (loop.objectives.length === 0 && loop.assumptions.length === 0) {
		return `${name} has no objective yet. Suggest one: a build objective while the product is mostly vision, a learning objective once there is something to show, a metric objective once a number tracks progress.`;
	}

	const objectives = loop.objectives.flatMap((objective) => [
		objectiveLine(objective),
		...rankAssumptions(loop.assumptions.filter((assumption) => assumption.objectiveId === objective.id)).flatMap(
			(assumption) => assumptionLines(assumption, loop),
		),
	]);

	const hunches = loop.assumptions.filter((assumption) => assumption.objectiveId === null);

	const later =
		hunches.length === 0
			? []
			: [
					"Worth testing later (assumptions not yet under an objective):",
					...hunches.map((hunch) => `  - "${hunch.statement}" (id ${hunch.id})`),
				];

	return [
		`Where ${name} stands (assumptions are listed next move first: highest impact, then lowest confidence):`,
		...(objectives.length === 0 ? ["- No active objective."] : objectives),
		...later,
	].join("\n");
}

export function renderSystemPrompt(context: RunContext) {
	const scope =
		context.scope === null
			? "This thread belongs to the Holding (all ventures)."
			: `This thread belongs to the venture ${context.scope.name} (id ${context.scope.id}).`;

	const strategy =
		context.scope?.strategy === null || context.scope === null
			? ""
			: `\n\nActive strategy of ${context.scope.name}:\n- Why: ${context.scope.strategy.why}\n- What: ${context.scope.strategy.what}\n- Diagnosis: ${context.scope.strategy.diagnosis || "(none)"}\n- Guiding policy: ${context.scope.strategy.guidingPolicy || "(none)"}`;

	const pending =
		context.pendingProposals.length === 0
			? "No proposals from this thread are waiting for the owner."
			: `Proposals from this thread waiting for the owner:\n${context.pendingProposals
					.map((proposal) => `- "${proposal.title}" (id ${proposal.id}, ${proposal.changeCount} changes)`)
					.join("\n")}`;

	const granted = (capability: Capability) => context.agent.grants.includes(capability);

	const mark = (capability: Capability) => (granted(capability) ? "" : " (not granted)");

	const grantedLabels = capabilities.filter(granted).map((capability) => capabilityLabels[capability]);

	const missingLabels = capabilities
		.filter((capability) => !granted(capability))
		.map((capability) => capabilityLabels[capability]);

	const permissions = `Permissions: the owner grants and revokes them, and braise enforces them on every change. Granted now: ${grantedLabels.join(", ") || "nothing"}. Not granted: ${missingLabels.join(", ") || "nothing"}. When you try something that isn't granted, braise files an access request in the owner's inbox and the tool result says so. Tell the owner what you asked for and why, carry on with what you can, and don't retry until the owner says it's granted.`;

	const ventureList = context.ventures.map((venture) => `- ${venture.name} (id ${venture.id})`).join("\n");

	const links =
		context.links.length === 0
			? "The thread is not linked to anything yet."
			: `The thread is linked to:\n${context.links
					.map(
						(link) =>
							`- ${linkNames[link.type]} "${link.label}" (id ${link.id}, venture ${link.ventureName})${link.archived ? " [archived]" : ""}`,
					)
					.join("\n")}`;

	const loop = context.scope === null ? "" : `\n\n${renderLoop(context.scope.name, context.scope.loop)}`;

	return `You are ${context.agent.name}, the agent inside braise, the owner's holding for their product ventures. Braise keeps each venture's strategy (why, what, diagnosis, guiding policy) and, under it, a loop: objectives, the assumptions they rest on, bets that test one assumption each, the learning every closed bet leaves, and a work tree (initiative → task → subtask). You talk with the owner in a thread.

How a venture climbs:
- An objective is the height. A metric objective is a number with a baseline, a target and a date. A learning objective is a question whose answer changes a decision. A build objective is vision-led work with a done list and a time box: it has no assumptions or bets, its work hangs directly under it, and you plan the work, do it, tick the done list and stop at the time box.
- For metric and learning objectives, repeat: read the state below; pick the open assumption with the highest impact and lowest confidence and read its learnings so you don't retry a rejected step; propose one to three bets on it; when a bet is approved, break its action into work items, including one that takes the reading; record readings as they come in; at the deadline propose closing the bet with its learning, then pick again.
- A bet is registered in full before it starts: the action, the signal, the pass and fail marks, the method and the deadline. Pick the cheapest method that could change confidence: existing_data (can earn 1), interviews (2), fake_door or concierge or before_after (3), staggered_rollout or ab_test (4). Prefer what people do over what they say, paying over clicking, a repeated result over a single one.
- Closing a bet: pass needs a latest reading at the pass mark and raises confidence up to what the method can earn. A fail says whether the idea or the execution was wrong: "idea" needs a reading past the fail mark and lowers confidence; "execution" leaves it and is run again once, with the fix. Anything else is inconclusive: propose it once more, or one rung higher.
- Stop and ask the owner for a decision, instead of proposing another bet, when an assumption reaches confidence 0, when three bets on it have failed, when two passes in a row moved the objective little (switch assumption), or when the budget is spent or a guardrail is broken.
- Work that tests nothing (a bug, a bill, a routine count) goes under Upkeep.

What you can do:
- Read anything with describe_schema and query (read-only SQL). Look things up instead of guessing ids or titles.
- Work and readings${mark("work")}: create, edit, reorder and set the status of work items; record readings for a metric objective or an open bet; tick a build objective's done list.
- Thread links${mark("links")}: link or unlink this thread.
- Proposals${mark("propose")}: propose changes to strategy, objectives, assumptions and bets with propose_changes. The owner approves, edits or rejects them in the inbox; never claim a proposed change is applied. Group related changes into one proposal with a clear reason, and don't propose again while an earlier proposal for the same change is pending.
- Every change is recorded under your name and this run.
- You cannot change ventures, archive anything, or touch code repositories; no grant covers these. When asked, say so plainly and suggest what the owner can do.

${permissions}

Lines from "braise" in the conversation are system notes, such as the owner's decision on a proposal or an access request.

How to answer: be brief and concrete, in Markdown. When you changed something, say what you changed. Ask when a request is ambiguous rather than guessing.

Today is ${context.today}. ${scope}${strategy}${loop}

Ventures:
${ventureList || "(none yet)"}

${links}

${pending}

Thread id: ${context.thread.id} ("${context.thread.title}").`;
}

function speaker(author: string) {
	if (author === "owner") return "Owner";

	return author === systemAuthor ? "braise" : "You (agent)";
}

export function renderPrompt(context: RunContext) {
	if (context.transcript.length === 0) return context.message;

	const history = context.transcript.map((message) => `${speaker(message.author)}:\n${message.body}`).join("\n\n");

	return `The conversation so far:\n\n${history}\n\nThe owner's new message:\n${context.message}`;
}

export async function loadRunContext(db: Database, run: { threadId: string; messageId: string; actor: string }) {
	const detail = await getThread(db, run.threadId);

	const trigger = detail.messages.find((message) => message.id === run.messageId);

	if (trigger === undefined) throw new AppError("internal_error", "The run's message is missing", run);

	const cockpit = detail.venture === null ? null : await getCockpit(db, detail.venture.slug);

	const latestOf = (subjectId: string) =>
		cockpit?.readings.findLast((reading) => reading.subjectId === subjectId)?.value ?? null;

	const loop =
		cockpit === null
			? null
			: ({
					objectives: cockpit.objectives
						.filter((objective) => objective.status === "active")
						.map((objective) => ({ ...objective, latest: latestOf(objective.id) })),
					assumptions: cockpit.assumptions
						.filter((assumption) => assumption.status !== "dropped")
						.map((assumption) => ({ ...assumption, createdAt: assumption.createdAt.toISOString() })),
					bets: cockpit.bets
						.filter((bet) => bet.status === "open")
						.map((bet) => ({ ...bet, latest: latestOf(bet.id) })),
					learnings: cockpit.learnings.slice(0, 30),
				} satisfies LoopState);

	const [ventureRows, strategy, pendingRows, grantRows] = await Promise.all([
		db
			.select({ id: ventures.id, slug: ventures.slug, name: ventures.name })
			.from(ventures)
			.where(isNull(ventures.archivedAt))
			.orderBy(asc(ventures.name)),
		detail.venture === null
			? undefined
			: db
					.select({
						why: strategyVersions.why,
						what: strategyVersions.what,
						diagnosis: strategyVersions.diagnosis,
						guidingPolicy: strategyVersions.guidingPolicy,
					})
					.from(strategyVersions)
					.where(and(eq(strategyVersions.ventureId, detail.venture.id), eq(strategyVersions.status, "active")))
					.then(([found]) => found),
		db
			.select({ id: proposals.id, title: proposals.title, changes: proposals.changes })
			.from(proposals)
			.where(and(eq(proposals.threadId, run.threadId), eq(proposals.status, "pending")))
			.orderBy(asc(proposals.createdAt)),
		db
			.select({ capability: agentGrants.capability })
			.from(agentGrants)
			.innerJoin(agentProfiles, eq(agentProfiles.id, agentGrants.profileId))
			.where(and(eq(agentProfiles.actor, run.actor), isNull(agentGrants.revokedAt))),
	]);

	return {
		today: new Date().toISOString().slice(0, 10),
		agent: { name: detail.agent.name, grants: grantRows.map((row) => row.capability) },
		thread: { id: detail.thread.id, title: detail.thread.title },
		scope: detail.venture === null || loop === null ? null : { ...detail.venture, strategy: strategy ?? null, loop },
		ventures: ventureRows,
		links: detail.links,
		transcript: detail.messages
			.filter((message) => message.seq < trigger.seq)
			.map(({ author, body }) => ({ author, body })),
		message: trigger.body,
		pendingProposals: pendingRows.map((row) => ({ id: row.id, title: row.title, changeCount: row.changes.length })),
	} satisfies RunContext;
}
