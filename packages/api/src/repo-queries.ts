import type { Checkout, GitHubConnection, PullRequest, ReachableRepo, ThreadCode, VentureRepo } from "@braise/core";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { CodeHost } from "./code/host.ts";
import type { Database } from "./db/client.ts";
import { checkouts, pullRequests, threads, ventureRepos, ventures } from "./db/schema.ts";
import { AppError } from "./errors.ts";

function errorText(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

export async function getGitHub(code: CodeHost) {
	const app = await code.github.app();

	if (app === null) return { app: null, installations: [], installUrl: null, error: null } satisfies GitHubConnection;

	const installUrl = `${code.config.githubWeb}/apps/${app.slug}/installations/new`;

	const listed = await code.github.installations().then(
		(installations) => ({ installations, error: null }),
		(error: unknown) => {
			console.error("github: listing installations failed", error);

			return { installations: [], error: errorText(error) };
		},
	);

	return {
		app: { ...app, createdAt: app.createdAt.toISOString() },
		installUrl,
		...listed,
	} satisfies GitHubConnection;
}

export async function getReachableRepos(db: Database, code: CodeHost) {
	const installations = await code.github.installations();

	const attached = await db
		.select({ githubRepoId: ventureRepos.githubRepoId, ventureId: ventures.id, ventureName: ventures.name })
		.from(ventureRepos)
		.innerJoin(ventures, eq(ventures.id, ventureRepos.ventureId))
		.where(isNull(ventureRepos.removedAt));

	const repos: ReachableRepo[] = [];

	for (const installation of installations) {
		for (const repo of await code.github.installationRepos(installation.id)) {
			const owner = attached.find((row) => row.githubRepoId === repo.githubRepoId);

			repos.push({
				...repo,
				installationId: installation.id,
				ventureId: owner?.ventureId ?? null,
				ventureName: owner?.ventureName ?? null,
			});
		}
	}

	return repos.toSorted((a, b) => a.fullName.localeCompare(b.fullName));
}

function toRepo(row: typeof ventureRepos.$inferSelect, openPullRequests: number) {
	return {
		id: row.id,
		ventureId: row.ventureId,
		githubRepoId: row.githubRepoId,
		installationId: row.installationId,
		fullName: row.fullName,
		defaultBranch: row.defaultBranch,
		status: row.status,
		error: row.error,
		mirrorHeadSha: row.mirrorHeadSha,
		fetchedAt: row.fetchedAt?.toISOString() ?? null,
		allowedDomains: row.allowedDomains,
		openPullRequests,
		createdAt: row.createdAt.toISOString(),
	} satisfies VentureRepo;
}

export async function getVentureRepos(db: Database, slug: string) {
	const [venture] = await db.select({ id: ventures.id }).from(ventures).where(eq(ventures.slug, slug));

	if (venture === undefined) throw new AppError("not_found", "Venture not found", { slug });

	const rows = await db
		.select({
			repo: ventureRepos,
			open: sql<number>`(SELECT count(*)::int FROM ${pullRequests} WHERE ${pullRequests.repoId} = ${ventureRepos.id} AND ${pullRequests.state} = 'open')`,
		})
		.from(ventureRepos)
		.where(and(eq(ventureRepos.ventureId, venture.id), isNull(ventureRepos.removedAt)))
		.orderBy(asc(ventureRepos.fullName));

	return rows.map((row) => toRepo(row.repo, row.open));
}

export async function getThreadCode(db: Database, code: CodeHost, threadId: string) {
	const [thread] = await db.select({ id: threads.id }).from(threads).where(eq(threads.id, threadId));

	if (thread === undefined) throw new AppError("not_found", "Thread not found", { threadId });

	const refreshError = await code.refreshThread(threadId);

	const [held, prs] = await Promise.all([
		db
			.select({ checkout: checkouts, fullName: ventureRepos.fullName })
			.from(checkouts)
			.innerJoin(ventureRepos, eq(ventureRepos.id, checkouts.repoId))
			.where(and(eq(checkouts.threadId, threadId), isNull(checkouts.removedAt)))
			.orderBy(asc(checkouts.createdAt)),
		db
			.select({ pr: pullRequests, fullName: ventureRepos.fullName })
			.from(pullRequests)
			.innerJoin(ventureRepos, eq(ventureRepos.id, pullRequests.repoId))
			.where(eq(pullRequests.threadId, threadId))
			.orderBy(asc(pullRequests.createdAt)),
	]);

	return {
		checkouts: held.map(
			({ checkout, fullName }) =>
				({
					id: checkout.id,
					threadId: checkout.threadId,
					repoId: checkout.repoId,
					fullName,
					dir: checkout.dir,
					branch: checkout.branch,
					baseSha: checkout.baseSha,
					checkpointSha: checkout.checkpointSha,
					createdAt: checkout.createdAt.toISOString(),
					removedAt: checkout.removedAt?.toISOString() ?? null,
				}) satisfies Checkout,
		),
		pullRequests: prs.map(
			({ pr, fullName }) =>
				({
					id: pr.id,
					threadId: pr.threadId,
					repoId: pr.repoId,
					fullName,
					number: pr.number,
					url: pr.url,
					title: pr.title,
					branch: pr.branch,
					state: pr.state,
					headSha: pr.headSha,
					createdBy: pr.createdBy,
					createdAt: pr.createdAt.toISOString(),
					updatedAt: pr.updatedAt.toISOString(),
				}) satisfies PullRequest,
		),
		refreshError,
	} satisfies ThreadCode;
}
