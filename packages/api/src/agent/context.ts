import {
	type Assumption,
	type Bet,
	type Capability,
	capabilities,
	capabilityLabels,
	isAgentActor,
	type Learning,
	type MemberState,
	maxThreadsStartedPerRun,
	maxWakesSinceOwner,
	memberStateOf,
	methodCeilings,
	type Objective,
	rankAssumptions,
	systemAuthor,
	type ThreadLink,
	type ThreadMessage,
} from "@braise/core";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import {
	agentGrants,
	agentProfiles,
	inputRequests,
	proposals,
	runEvents,
	runs,
	spaces,
	strategyVersions,
	threads,
	ventures,
} from "../db/schema.ts";
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

export interface ContextMember {
	threadId: string;
	title: string;
	agent: string;
	state: MemberState;
	latestRunId: string | null;
	latestStatus: string | null;
	question: string | null;
}

export interface ContextSpace {
	id: string;
	title: string;
	goal: string | null;
	ventureId: string | null;
	role: "chat" | "member";
	agentName: string;
	wakesLeft: number;
	members: ContextMember[];
}

export interface DoneCall {
	name: string;
	input: unknown;
	output: string;
}

export interface RunContext {
	today: string;
	agent: { name: string; actor: string; grants: Capability[] };
	thread: { id: string; title: string };
	seenSeq: number;
	rootRunId: string;
	profiles: { id: string; name: string; actor: string; runtime: string }[];
	space: ContextSpace | null;
	reports: string[];
	retry: { calls: DoneCall[]; partial: string } | null;
	trigger: { author: string };
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

	const relevant = capabilities.filter((capability) => capability !== "delegate" || context.space?.role === "chat");

	const grantedLabels = relevant.filter(granted).map((capability) => capabilityLabels[capability]);

	const missingLabels = relevant
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

	const space = spaceSection(context);

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
- Ask the owner: when you need a decision or a fact only the owner has, call ask_owner with one clear question. Your run ends there, the question waits in the owner's inbox, and the owner's reply in this thread resumes the work. Don't ask what you can look up.
- You cannot change ventures, archive anything, or touch code repositories; no grant covers these. When asked, say so plainly and suggest what the owner can do.

${permissions}${space}

Lines from "braise" in the conversation are system notes, such as the owner's decision on a proposal, an access request, or a report from a thread in a space.

How to answer: be brief and concrete, in Markdown. When you changed something, say what you changed. Ask when a request is ambiguous rather than guessing.

Today is ${context.today}. ${scope}${strategy}${loop}

Ventures:
${ventureList || "(none yet)"}

${links}

${pending}

Thread id: ${context.thread.id} ("${context.thread.title}").`;
}

function memberLine(member: ContextMember) {
	const status = member.question === null ? member.state.replace("_", " ") : `needs the owner: "${member.question}"`;

	const run = member.latestRunId === null ? "" : `, latest run ${member.latestRunId} ${member.latestStatus}`;

	return `- "${member.title}" (thread ${member.threadId}, ${member.agent}): ${status}${run}`;
}

function spaceSection(context: RunContext) {
	const { space } = context;

	if (space === null) return "";

	const goal = space.goal === null ? "" : ` Its goal: ${space.goal}`;

	if (space.role === "member") {
		return `\n\nSpaces: this thread is a member of the space "${space.title}", directed by ${space.agentName}, the space's agent.${goal} Messages from ${space.agentName} here come from the space's agent, not the owner. When your run ends, braise reports to the space, so end with a short summary of what you found or did.`;
	}

	const profiles = context.profiles.map((profile) => `${profile.name} (id ${profile.id})`).join(", ");

	const members = space.members.length === 0 ? "- (no threads yet)" : space.members.map(memberLine).join("\n");

	return `\n\nSpaces: you are the agent of the space "${space.title}" and this thread is its chat with the owner.${goal}
- Start and direct threads${context.agent.grants.includes("delegate") ? "" : " (not granted)"}: you work through threads. start_thread starts a member thread with the agent you pick (${profiles}), a short title and a first message that stands on its own; at most ${maxThreadsStartedPerRun} per run. Pick by the work: each agent has its own subscription and limits. message_thread sends a member a follow-up, retry_thread retries a failed or interrupted member from where it stopped, and add_thread_to_space / remove_thread_from_space change who is in the space.
- You never wait for a thread. Start or message what's needed, tell the owner in a line or two what you set going, and end your run. When a member finishes, fails, is interrupted or asks the owner, braise posts a report line here and wakes you to read the reports together.
- Without a message from the owner you wake at most ${maxWakesSinceOwner} times in a row (${space.wakesLeft} left). Don't spend wakes on nothing: when the work is done or needs the owner, say so and stop.
Members:
${members}`;
}

function speaker(context: RunContext, author: string) {
	if (author === "owner") return "Owner";

	if (author === systemAuthor) return "braise";

	if (author === context.agent.actor) return "You (agent)";

	const name = context.profiles.find((profile) => profile.actor === author)?.name ?? author;

	return isAgentActor(author) ? `${name} (the space's agent)` : name;
}

function clip(text: string, length: number) {
	return text.length > length ? `${text.slice(0, length)}…` : text;
}

function retrySection(context: RunContext) {
	if (context.retry === null) return "";

	const calls =
		context.retry.calls.length === 0
			? "- (no tool calls were finished)"
			: context.retry.calls
					.map((call) => `- ${call.name} ${clip(JSON.stringify(call.input), 400)} → ${clip(call.output, 400)}`)
					.join("\n");

	const partial =
		context.retry.partial.trim() === ""
			? ""
			: `\n\nWhat it had written so far:\n${clip(context.retry.partial, 4_000)}`;

	return `\n\nThis run is a retry. Before braise stopped, your previous attempt already did:\n${calls}${partial}\n\nContinue from there; don't repeat these.`;
}

export function renderPrompt(context: RunContext) {
	const history = context.transcript
		.map((message) => `${speaker(context, message.author)}:\n${message.body}`)
		.join("\n\n");

	const reports =
		context.reports.length === 0
			? ""
			: `\n\nReports from the space's threads since your last run:\n${context.reports.map((line) => `- ${line}`).join("\n")}`;

	const isWake = context.trigger.author === systemAuthor;

	const latest = isWake
		? `${reports.trimStart()}\n\nRead the reports and decide the next step for the space.`
		: `${speaker(context, context.trigger.author) === "Owner" ? "The owner's new message" : `New message from ${speaker(context, context.trigger.author)}`}:\n${context.message}${reports}`;

	const plain = !isWake && context.trigger.author === "owner" && reports === "";

	const opening = plain ? context.message : latest;

	const body = context.transcript.length === 0 ? opening : `The conversation so far:\n\n${history}\n\n${latest}`;

	return `${body}${retrySection(context)}`;
}

async function retryChain(db: Database, retryOf: string) {
	const rows = await db.execute<{ id: string }>(sql`
		WITH RECURSIVE chain AS (
			SELECT id, retry_of, 0 AS depth FROM runs WHERE id = ${retryOf}
			UNION ALL
			SELECT runs.id, runs.retry_of, chain.depth + 1 FROM runs JOIN chain ON runs.id = chain.retry_of
		)
		SELECT id FROM chain ORDER BY depth DESC`);

	return rows.rows.map((row) => row.id);
}

export async function loadRetry(db: Database, retryOf: string | null) {
	if (retryOf === null) return null;

	const chain = await retryChain(db, retryOf);

	const events = await db
		.select()
		.from(runEvents)
		.where(and(inArray(runEvents.runId, chain), inArray(runEvents.type, ["tool.call", "tool.result", "message"])))
		.orderBy(asc(runEvents.createdAt), asc(runEvents.seq));

	const ordered = chain.flatMap((runId) => events.filter((event) => event.runId === runId));

	const results = new Map(
		ordered
			.filter((event) => event.type === "tool.result" && event.payload.isError !== true)
			.map((event) => [String(event.payload.toolUseId), String(event.payload.output ?? "")]),
	);

	const calls = ordered.flatMap((event) => {
		const output = event.type === "tool.call" ? results.get(String(event.payload.toolUseId)) : undefined;

		return output === undefined ? [] : [{ name: String(event.payload.name), input: event.payload.input, output }];
	});

	const partial = ordered
		.filter((event) => event.type === "message" && typeof event.payload.text === "string")
		.map((event) => String(event.payload.text))
		.join("\n\n");

	return { rootRunId: chain[0] ?? retryOf, retry: { calls, partial } };
}

async function seenSeqOfRun(db: Database, runId: string) {
	const [started] = await db
		.select({ payload: runEvents.payload })
		.from(runEvents)
		.where(and(eq(runEvents.runId, runId), eq(runEvents.type, "run.started")));

	return typeof started?.payload.seenSeq === "number" ? started.payload.seenSeq : null;
}

async function loadMembers(db: Database, spaceId: string) {
	const rows = await db
		.select({ id: threads.id, title: threads.title, agent: agentProfiles.name })
		.from(threads)
		.innerJoin(agentProfiles, eq(agentProfiles.id, threads.agentProfileId))
		.where(and(eq(threads.spaceId, spaceId), isNull(threads.archivedAt)))
		.orderBy(asc(threads.createdAt));

	const ids = rows.map((row) => row.id);

	const [latest, questions] =
		ids.length === 0
			? [[], []]
			: await Promise.all([
					db
						.selectDistinctOn([runs.threadId], { threadId: runs.threadId, id: runs.id, status: runs.status })
						.from(runs)
						.where(inArray(runs.threadId, ids))
						.orderBy(runs.threadId, desc(runs.createdAt), desc(runs.id)),
					db
						.select({ threadId: inputRequests.threadId, question: inputRequests.question })
						.from(inputRequests)
						.where(and(inArray(inputRequests.threadId, ids), eq(inputRequests.status, "pending"))),
				]);

	return rows.map((row) => {
		const run = latest.find((found) => found.threadId === row.id);
		const question = questions.find((found) => found.threadId === row.id)?.question ?? null;

		return {
			threadId: row.id,
			title: row.title,
			agent: row.agent,
			state: memberStateOf(run?.status ?? null, question !== null),
			latestRunId: run?.id ?? null,
			latestStatus: run?.status ?? null,
			question,
		} satisfies ContextMember;
	});
}

async function loadSpace(db: Database, threadId: string, spaceId: string | null) {
	const [chatOf] = await db.select().from(spaces).where(eq(spaces.chatThreadId, threadId));

	const [memberOf] =
		chatOf !== undefined || spaceId === null ? [] : await db.select().from(spaces).where(eq(spaces.id, spaceId));

	const space = chatOf ?? memberOf;

	if (space === undefined) return null;

	const [agent] = await db
		.select({ name: agentProfiles.name })
		.from(agentProfiles)
		.where(eq(agentProfiles.id, space.agentProfileId));

	return {
		id: space.id,
		title: space.title,
		goal: space.goal,
		ventureId: space.ventureId,
		role: chatOf === undefined ? "member" : "chat",
		agentName: agent?.name ?? space.agentProfileId,
		wakesLeft: Math.max(0, maxWakesSinceOwner - space.wakesSinceOwner),
		members: chatOf === undefined ? [] : await loadMembers(db, space.id),
	} satisfies ContextSpace;
}

export async function loadRunContext(
	db: Database,
	run: { id: string; threadId: string; messageId: string; actor: string; retryOf: string | null },
) {
	const detail = await getThread(db, run.threadId);

	const trigger = detail.messages.find((message) => message.id === run.messageId);

	if (trigger === undefined) throw new AppError("internal_error", "The run's message is missing", run);

	const space = await loadSpace(db, run.threadId, detail.thread.spaceId);

	const [previous] =
		space?.role === "chat"
			? await db
					.select({ id: runs.id })
					.from(runs)
					.where(and(eq(runs.threadId, run.threadId), ne(runs.id, run.id)))
					.orderBy(desc(runs.createdAt), desc(runs.id))
					.limit(1)
			: [];

	const lastSeen = previous === undefined ? 0 : ((await seenSeqOfRun(db, previous.id)) ?? 0);

	const isReport = (message: (typeof detail.messages)[number]) => message.meta?.kind === "report";

	const reports =
		space?.role === "chat"
			? detail.messages.filter(
					(message) => isReport(message) && message.seq > lastSeen && message.id !== run.messageId,
				)
			: [];

	const triggerReports = isReport(trigger) && trigger.seq > lastSeen ? [trigger] : [];

	const unread = [...reports, ...triggerReports].toSorted((a, b) => a.seq - b.seq);

	const unreadIds = new Set(unread.map((message) => message.id));

	const chained = await loadRetry(db, run.retryOf);

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

	const [ventureRows, strategy, pendingRows, grantRows, profileRows] = await Promise.all([
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
		db
			.select({
				id: agentProfiles.id,
				name: agentProfiles.name,
				actor: agentProfiles.actor,
				runtime: agentProfiles.runtime,
			})
			.from(agentProfiles)
			.orderBy(asc(agentProfiles.createdAt), asc(agentProfiles.id)),
	]);

	return {
		today: new Date().toISOString().slice(0, 10),
		agent: { name: detail.agent.name, actor: run.actor, grants: grantRows.map((row) => row.capability) },
		thread: { id: detail.thread.id, title: detail.thread.title },
		seenSeq: detail.thread.lastSeq,
		rootRunId: chained?.rootRunId ?? run.id,
		profiles: profileRows,
		space,
		reports: unread.map((message) => message.body),
		retry: chained?.retry ?? null,
		trigger: { author: trigger.author },
		scope: detail.venture === null || loop === null ? null : { ...detail.venture, strategy: strategy ?? null, loop },
		ventures: ventureRows,
		links: detail.links,
		transcript: detail.messages
			.filter((message) => message.seq < trigger.seq && !unreadIds.has(message.id))
			.map(({ author, body }) => ({ author, body })),
		message: trigger.body,
		pendingProposals: pendingRows.map((row) => ({ id: row.id, title: row.title, changeCount: row.changes.length })),
	} satisfies RunContext;
}
