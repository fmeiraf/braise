import { systemAuthor, type ThreadLink, type ThreadMessage } from "@braise/core";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import { proposals, strategyVersions, ventures } from "../db/schema.ts";
import { AppError } from "../errors.ts";
import { getThread } from "../thread-queries.ts";

export interface ContextVenture {
	id: string;
	slug: string;
	name: string;
}

export interface RunContext {
	today: string;
	thread: { id: string; title: string };
	scope:
		| (ContextVenture & { strategy: { why: string; what: string; diagnosis: string; guidingPolicy: string } | null })
		| null;
	ventures: ContextVenture[];
	links: ThreadLink[];
	transcript: Pick<ThreadMessage, "author" | "body">[];
	pendingProposals: { id: string; title: string; changeCount: number }[];
	message: string;
}

const linkNames = { work_item: "work item", goal: "goal", bet: "bet", venture: "venture" } as const;

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

	return `You are the agent inside braise, the owner's holding for their product ventures. Braise keeps each venture's strategy (why, what, diagnosis, guiding policy), bets, goals and a work tree (initiative → task → subtask under goals). You talk with the owner in a thread.

What you can do:
- Read anything with describe_schema and query (read-only SQL). Look things up instead of guessing ids or titles.
- Create, edit, reorder and set the status of work items, and link or unlink this thread. Every change is recorded under your name and this run.
- Propose changes to strategy, bets and goals with propose_changes. The owner approves, edits or rejects them in the inbox; never claim a proposed change is applied. Group related changes into one proposal with a clear reason, and don't propose again while an earlier proposal for the same change is pending.
- You cannot change ventures, archive anything, or touch code repositories. When asked, say so plainly and suggest what the owner can do.

Lines from "braise" in the conversation are system notes, such as the owner's decision on a proposal.

How to answer: be brief and concrete, in Markdown. When you changed something, say what you changed. Ask when a request is ambiguous rather than guessing.

Today is ${context.today}. ${scope}${strategy}

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

export async function loadRunContext(db: Database, run: { threadId: string; messageId: string }) {
	const detail = await getThread(db, run.threadId);

	const trigger = detail.messages.find((message) => message.id === run.messageId);

	if (trigger === undefined) throw new AppError("internal_error", "The run's message is missing", run);

	const [ventureRows, strategy, pendingRows] = await Promise.all([
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
	]);

	return {
		today: new Date().toISOString().slice(0, 10),
		thread: { id: detail.thread.id, title: detail.thread.title },
		scope: detail.venture === null ? null : { ...detail.venture, strategy: strategy ?? null },
		ventures: ventureRows,
		links: detail.links,
		transcript: detail.messages
			.filter((message) => message.seq < trigger.seq)
			.map(({ author, body }) => ({ author, body })),
		message: trigger.body,
		pendingProposals: pendingRows.map((row) => ({ id: row.id, title: row.title, changeCount: row.changes.length })),
	} satisfies RunContext;
}
