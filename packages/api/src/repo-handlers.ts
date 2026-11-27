import { systemAuthor } from "@braise/core";
import { and, eq, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { notifyCode } from "./code/host.ts";
import type { Transaction } from "./db/client.ts";
import { agentProfiles, checkouts, githubApp, pullRequests, ventureRepos } from "./db/schema.ts";
import { AppError } from "./errors.ts";
import { type HandlerContext, type Handlers, notifyThread } from "./pipeline.ts";
import { appendMessage, assertLive, lockThread } from "./thread-handlers.ts";

function requireVenture(context: HandlerContext) {
	if (context.venture === null) throw new AppError("internal_error", "Command ran without a venture lock");

	return context.venture;
}

async function liveRepo(tx: Transaction, ventureId: string, repoId: string) {
	const [repo] = await tx
		.select()
		.from(ventureRepos)
		.where(and(eq(ventureRepos.id, repoId), eq(ventureRepos.ventureId, ventureId), isNull(ventureRepos.removedAt)));

	if (repo === undefined) throw new AppError("not_found", "Repo not found on this venture", { repoId });

	return repo;
}

async function openPullRequestOf(tx: Transaction, filter: { repoId: string; threadId?: string }) {
	const [open] = await tx
		.select()
		.from(pullRequests)
		.where(
			and(
				eq(pullRequests.repoId, filter.repoId),
				eq(pullRequests.state, "open"),
				...(filter.threadId === undefined ? [] : [eq(pullRequests.threadId, filter.threadId)]),
			),
		)
		.limit(1);

	return open;
}

async function codeTarget(context: HandlerContext, payload: { threadId: string; repoId: string }) {
	const venture = requireVenture(context);

	const thread = await lockThread(context.tx, payload.threadId);

	assertLive(thread);

	if (thread.ventureId !== venture.id) {
		throw new AppError("rule_violated", "The thread isn't in this venture", {
			rule: "thread_not_in_venture",
			threadId: thread.id,
		});
	}

	const repo = await liveRepo(context.tx, venture.id, payload.repoId);

	const [checkout] = await context.tx
		.select()
		.from(checkouts)
		.where(and(eq(checkouts.threadId, thread.id), eq(checkouts.repoId, repo.id), isNull(checkouts.removedAt)));

	if (checkout === undefined) {
		throw new AppError("rule_violated", `This thread has no checkout of ${repo.fullName}; call checkout_repo first`, {
			rule: "no_checkout",
			repo: repo.fullName,
		});
	}

	return { venture, thread, repo, checkout };
}

async function signature(tx: Transaction, actor: string, threadTitle: string) {
	const [profile] = await tx
		.select({ name: agentProfiles.name })
		.from(agentProfiles)
		.where(eq(agentProfiles.actor, actor));

	const who = profile?.name ?? (actor === "owner" ? "the owner" : actor);

	return `Opened by ${who} from the braise thread “${threadTitle}”.`;
}

export const repoHandlers = {
	"github.connect": async ({ tx }, payload) => {
		await tx.delete(githubApp);

		const [app] = await tx
			.insert(githubApp)
			.values({ id: payload.appId, slug: payload.slug, ownerLogin: payload.ownerLogin, htmlUrl: payload.htmlUrl })
			.returning();

		return { global: true, result: app };
	},

	"venture.add_repo": async (context, payload) => {
		const venture = requireVenture(context);

		const [taken] = await context.tx
			.select({ ventureId: ventureRepos.ventureId })
			.from(ventureRepos)
			.where(and(eq(ventureRepos.githubRepoId, payload.githubRepoId), isNull(ventureRepos.removedAt)));

		if (taken !== undefined) {
			throw new AppError(
				"rule_violated",
				taken.ventureId === venture.id
					? `${payload.fullName} is already on this venture`
					: `${payload.fullName} belongs to another venture; a repo has one venture`,
				{ rule: "repo_taken", ventureId: taken.ventureId },
			);
		}

		const [repo] = await context.tx
			.insert(ventureRepos)
			.values({
				id: uuidv7(),
				ventureId: venture.id,
				githubRepoId: payload.githubRepoId,
				installationId: payload.installationId,
				fullName: payload.fullName,
				defaultBranch: payload.defaultBranch,
				status: "cloning",
				addedBy: context.actor,
			})
			.returning();

		if (repo === undefined) throw new AppError("internal_error", "Repo insert returned nothing");

		context.queueCode({ type: "mirror", repoId: repo.id });

		return {
			ventureId: venture.id,
			result: repo,
			events: [
				{
					type: "repo.added",
					subject: `repo:${repo.id}`,
					payload: { fullName: repo.fullName, githubRepoId: repo.githubRepoId },
				},
			],
		};
	},

	"venture.update_repo": async (context, payload) => {
		const venture = requireVenture(context);

		const repo = await liveRepo(context.tx, venture.id, payload.repoId);

		const domains = [...new Set(payload.allowedDomains)];

		const [updated] = await context.tx
			.update(ventureRepos)
			.set({ allowedDomains: domains, updatedAt: sql`now()` })
			.where(eq(ventureRepos.id, repo.id))
			.returning();

		return {
			ventureId: venture.id,
			result: updated,
			events: [
				{
					type: "repo.updated",
					subject: `repo:${repo.id}`,
					payload: {
						fullName: repo.fullName,
						changes: { allowedDomains: { from: repo.allowedDomains, to: domains } },
					},
				},
			],
		};
	},

	"venture.remove_repo": async (context, payload) => {
		const venture = requireVenture(context);

		const repo = await liveRepo(context.tx, venture.id, payload.repoId);

		const open = await openPullRequestOf(context.tx, { repoId: repo.id });

		if (open !== undefined) {
			throw new AppError("rule_violated", `${repo.fullName} has an open braise pull request (#${open.number})`, {
				rule: "repo_has_open_prs",
				repoId: repo.id,
				number: open.number,
			});
		}

		const [removed] = await context.tx
			.update(ventureRepos)
			.set({ removedAt: sql`now()`, updatedAt: sql`now()` })
			.where(eq(ventureRepos.id, repo.id))
			.returning();

		const held = await context.tx
			.selectDistinct({ threadId: checkouts.threadId })
			.from(checkouts)
			.where(and(eq(checkouts.repoId, repo.id), isNull(checkouts.removedAt)));

		for (const { threadId } of held) context.queueCode({ type: "cleanup", threadId, repoId: repo.id });

		return {
			ventureId: venture.id,
			result: removed,
			events: [{ type: "repo.removed", subject: `repo:${repo.id}`, payload: { fullName: repo.fullName } }],
		};
	},

	"repo.fetch": async (context, payload) => {
		const [repo] = await context.tx
			.select()
			.from(ventureRepos)
			.where(and(eq(ventureRepos.id, payload.repoId), isNull(ventureRepos.removedAt)));

		if (repo === undefined) throw new AppError("not_found", "Repo not found", { repoId: payload.repoId });

		context.queueCode({ type: "mirror", repoId: repo.id });

		return { global: true, result: { repoId: repo.id, queued: true } };
	},

	"repo.push": async (context, payload) => {
		const { venture, thread, repo, checkout } = await codeTarget(context, payload);

		const sha = await context.code.push(repo, checkout);

		await context.tx
			.update(pullRequests)
			.set({ headSha: sha, updatedAt: sql`now()` })
			.where(
				and(eq(pullRequests.threadId, thread.id), eq(pullRequests.repoId, repo.id), eq(pullRequests.state, "open")),
			);

		await notifyCode(context.tx, { ventureId: venture.id, threadId: thread.id });

		return {
			ventureId: venture.id,
			result: { repo: repo.fullName, branch: checkout.branch, sha },
			events: [
				{
					type: "repo.pushed",
					subject: `repo:${repo.id}`,
					payload: { fullName: repo.fullName, branch: checkout.branch, sha, threadId: thread.id },
				},
			],
		};
	},

	"pr.open": async (context, payload) => {
		const { venture, thread, repo, checkout } = await codeTarget(context, payload);

		const existing = await openPullRequestOf(context.tx, { repoId: repo.id, threadId: thread.id });

		if (existing !== undefined) {
			throw new AppError(
				"rule_violated",
				`This thread already has pull request #${existing.number} open on ${repo.fullName}; push to update it`,
				{ rule: "pr_exists", number: existing.number, url: existing.url },
			);
		}

		const footer = await signature(context.tx, context.actor, thread.title);

		const body = payload.body === "" ? footer : `${payload.body}\n\n---\n${footer}`;

		const opened = await context.code.openPullRequest(repo, checkout, {
			title: payload.title,
			body,
			draft: payload.draft,
		});

		const values = {
			threadId: thread.id,
			repoId: repo.id,
			runId: context.runId,
			number: opened.number,
			url: opened.url,
			title: opened.title,
			branch: checkout.branch,
			state: opened.state,
			headSha: opened.headSha,
			createdBy: context.actor,
		};

		const [pr] = await context.tx
			.insert(pullRequests)
			.values({ id: uuidv7(), ...values })
			.onConflictDoUpdate({
				target: [pullRequests.repoId, pullRequests.number],
				set: { ...values, updatedAt: sql`now()` },
			})
			.returning();

		if (pr === undefined) throw new AppError("internal_error", "Pull request insert returned nothing");

		await appendMessage(context.tx, thread, {
			author: systemAuthor,
			body: `Opened pull request #${pr.number} on ${repo.fullName}: ${pr.title}`,
			runId: context.runId,
			meta: { kind: "pull_request", pullRequestId: pr.id, number: pr.number, url: pr.url },
		});

		await notifyThread(context.tx, thread);

		await notifyCode(context.tx, { ventureId: venture.id, threadId: thread.id });

		return {
			ventureId: venture.id,
			result: pr,
			events: [
				{
					type: "pr.opened",
					subject: `pull_request:${pr.id}`,
					payload: {
						fullName: repo.fullName,
						number: pr.number,
						url: pr.url,
						title: pr.title,
						branch: pr.branch,
						threadId: thread.id,
					},
				},
			],
		};
	},

	"pr.update": async (context, payload) => {
		const venture = requireVenture(context);

		const [found] = await context.tx
			.select({ pr: pullRequests, repo: ventureRepos })
			.from(pullRequests)
			.innerJoin(ventureRepos, eq(ventureRepos.id, pullRequests.repoId))
			.where(and(eq(pullRequests.id, payload.pullRequestId), eq(ventureRepos.ventureId, venture.id)));

		if (found === undefined) {
			throw new AppError("not_found", "Pull request not found", { pullRequestId: payload.pullRequestId });
		}

		const { pr, repo } = found;

		if (pr.state !== "open") {
			throw new AppError("rule_violated", `#${pr.number} is ${pr.state}`, { rule: "pr_not_open", state: pr.state });
		}

		const updated = await context.code.updatePullRequest(repo, pr.number, {
			...(payload.title === undefined ? {} : { title: payload.title }),
			...(payload.body === undefined ? {} : { body: payload.body }),
		});

		const [row] = await context.tx
			.update(pullRequests)
			.set({ title: updated.title, state: updated.state, updatedAt: sql`now()` })
			.where(eq(pullRequests.id, pr.id))
			.returning();

		await notifyCode(context.tx, { ventureId: venture.id, threadId: pr.threadId });

		return {
			ventureId: venture.id,
			result: row,
			events: [
				{
					type: "pr.updated",
					subject: `pull_request:${pr.id}`,
					payload: { fullName: repo.fullName, number: pr.number, url: pr.url, title: updated.title },
				},
			],
		};
	},
} satisfies Pick<
	Handlers,
	| "github.connect"
	| "venture.add_repo"
	| "venture.update_repo"
	| "venture.remove_repo"
	| "repo.fetch"
	| "repo.push"
	| "pr.open"
	| "pr.update"
>;
