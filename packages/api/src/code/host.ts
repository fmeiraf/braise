import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { slugify } from "@braise/core";
import { and, eq, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { codeChannel } from "../channels.ts";
import type { Database, Transaction } from "../db/client.ts";
import { checkouts, pullRequests, threads, ventureRepos } from "../db/schema.ts";
import { AppError } from "../errors.ts";
import { type CodeConfig, threadDir, threadHome } from "./config.ts";
import { cloneShared, pushFromCheckout, shaPattern, syncMirror } from "./git.ts";
import {
	createGitHub,
	GitHubError,
	isAccessLoss,
	mirrorPermissions,
	pullPermissions,
	pushPermissions,
	statusPermissions,
} from "./github.ts";
import { runSandboxed } from "./sandbox.ts";

export type RepoRow = typeof ventureRepos.$inferSelect;

export type CheckoutRow = typeof checkouts.$inferSelect;

export type PullRequestRow = typeof pullRequests.$inferSelect;

export type CodeJob = { type: "mirror"; repoId: string } | { type: "cleanup"; threadId: string; repoId?: string };

export const codeQueue = "code";

const branchSlugLength = 40;

export function branchOf(thread: { id: string; title: string }) {
	const slug = slugify(thread.title).slice(0, branchSlugLength).replace(/-+$/u, "") || "thread";

	return `braise/${slug}-${thread.id.slice(-6)}`;
}

export function botIdentity(app: { slug: string } | null) {
	const slug = app?.slug ?? "braise";

	return { name: `${slug}[bot]`, email: `${slug}[bot]@users.noreply.github.com` };
}

function errorText(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

export function notifyCode(executor: Database | Transaction, change: { ventureId: string; threadId?: string | null }) {
	return executor.execute(
		sql`SELECT pg_notify(${codeChannel}, ${JSON.stringify({ ventureId: change.ventureId, threadId: change.threadId ?? null })})`,
	);
}

interface RawPull {
	number: number;
	html_url: string;
	title: string;
	state: "open" | "closed";
	merged?: boolean;
	merged_at?: string | null;
	draft?: boolean;
	mergeable_state?: string;
	head: { sha: string; ref: string };
	base: { ref: string };
}

function pullState(raw: RawPull) {
	if (raw.state === "open") return "open" as const;

	return raw.merged === true || (raw.merged_at !== null && raw.merged_at !== undefined)
		? ("merged" as const)
		: ("closed" as const);
}

/** Everything braise does with repos outside Postgres: mirrors, checkouts, the sandbox and GitHub. */
export function createCodeHost(config: CodeConfig, db: Database) {
	const github = createGitHub(config, db);
	const syncing = new Map<string, Promise<RepoRow>>();

	async function repoById(repoId: string) {
		const [repo] = await db.select().from(ventureRepos).where(eq(ventureRepos.id, repoId));

		if (repo === undefined) throw new AppError("not_found", "Repo not found", { repoId });

		return repo;
	}

	async function markRepo(repo: RepoRow, change: Partial<RepoRow>) {
		const [updated] = await db
			.update(ventureRepos)
			.set({ ...change, updatedAt: sql`now()` })
			.where(eq(ventureRepos.id, repo.id))
			.returning();

		await notifyCode(db, { ventureId: repo.ventureId });

		return updated ?? repo;
	}

	async function fetchMirror(repoId: string) {
		const repo = await repoById(repoId);

		if (repo.removedAt !== null) return repo;

		try {
			const info = await github.repository(repo);

			const token = await github.repoToken(repo, mirrorPermissions);

			const current = { ...repo, fullName: info.fullName, defaultBranch: info.defaultBranch };

			const sha = await syncMirror(config, current, token);

			return await markRepo(repo, {
				status: "ready",
				error: null,
				fullName: info.fullName,
				defaultBranch: info.defaultBranch,
				mirrorHeadSha: sha,
				fetchedAt: new Date(),
			});
		} catch (error) {
			const lost = isAccessLoss(error);

			console.error(`code: fetching ${repo.fullName} failed`, error);

			return markRepo(repo, {
				status: lost ? "no_access" : "failed",
				error: lost
					? `braise's GitHub App can't reach ${repo.fullName}; add it to the App's repositories on GitHub`
					: errorText(error),
			});
		}
	}

	function syncRepo(repoId: string) {
		const running = syncing.get(repoId);

		if (running !== undefined) return running;

		const started = fetchMirror(repoId).finally(() => syncing.delete(repoId));

		syncing.set(repoId, started);

		return started;
	}

	function assertUsable(repo: RepoRow) {
		if (repo.status === "no_access") {
			throw new AppError("rule_violated", repo.error ?? `braise has no access to ${repo.fullName}`, {
				rule: "repo_no_access",
				repo: repo.fullName,
			});
		}

		if (repo.status !== "ready") {
			throw new AppError("rule_violated", `${repo.fullName} isn't ready: ${repo.error ?? repo.status}`, {
				rule: "repo_not_ready",
				repo: repo.fullName,
			});
		}
	}

	async function liveCheckout(threadId: string, repoId: string) {
		const [found] = await db
			.select()
			.from(checkouts)
			.where(and(eq(checkouts.threadId, threadId), eq(checkouts.repoId, repoId), isNull(checkouts.removedAt)));

		return found;
	}

	async function freeDir(threadId: string, name: string) {
		const taken = new Set(await readdir(threadDir(config, threadId)));

		for (let suffix = 1; ; suffix += 1) {
			const candidate = suffix === 1 ? name : `${name}-${suffix}`;

			if (candidate !== "home" && !taken.has(candidate)) return candidate;
		}
	}

	async function ensureCheckout(thread: { id: string; title: string }, repoId: string) {
		const existing = await liveCheckout(thread.id, repoId);

		if (existing !== undefined) return { checkout: existing, created: false };

		const repo = await syncRepo(repoId);

		assertUsable(repo);

		const root = threadDir(config, thread.id);

		await mkdir(threadHome(config, thread.id), { recursive: true });

		const dir = await freeDir(thread.id, repo.fullName.split("/")[1] ?? "repo");

		const branch = branchOf(thread);

		const baseSha = await cloneShared(config, {
			githubRepoId: repo.githubRepoId,
			defaultBranch: repo.defaultBranch,
			target: join(root, dir),
			branch,
			author: botIdentity(await github.app()),
		});

		const [checkout] = await db
			.insert(checkouts)
			.values({ id: uuidv7(), threadId: thread.id, repoId, dir, branch, baseSha })
			.returning();

		if (checkout === undefined) throw new AppError("internal_error", "Checkout insert returned nothing");

		await notifyCode(db, { ventureId: repo.ventureId, threadId: thread.id });

		return { checkout, created: true };
	}

	async function headOf(checkout: CheckoutRow, ref = "HEAD") {
		const result = await runSandboxed(config, {
			threadId: checkout.threadId,
			cwd: join(threadDir(config, checkout.threadId), checkout.dir),
			command: `git rev-parse --verify --quiet '${ref}^{commit}'`,
			timeoutMs: 30_000,
		});

		const sha = result.output.trim().split("\n").at(-1) ?? "";

		if (result.exitCode !== 0 || !shaPattern.test(sha)) return null;

		return sha;
	}

	async function checkpoint(threadId: string) {
		const live = await db
			.select()
			.from(checkouts)
			.where(and(eq(checkouts.threadId, threadId), isNull(checkouts.removedAt)));

		const recorded: { checkoutId: string; dir: string; sha: string }[] = [];

		for (const checkout of live) {
			const sha = await headOf(checkout);

			if (sha === null) continue;

			await db
				.update(checkouts)
				.set({ checkpointSha: sha, updatedAt: sql`now()` })
				.where(eq(checkouts.id, checkout.id));

			recorded.push({ checkoutId: checkout.id, dir: checkout.dir, sha });
		}

		return recorded;
	}

	async function branchSha(checkout: CheckoutRow) {
		const sha = await headOf(checkout, `refs/heads/${checkout.branch}`);

		if (sha === null) {
			throw new AppError("rule_violated", `The checkout has no branch ${checkout.branch}; commit on it first`, {
				rule: "branch_missing",
				branch: checkout.branch,
			});
		}

		if (sha === checkout.baseSha) {
			throw new AppError("rule_violated", `${checkout.branch} has no commits yet; commit your changes first`, {
				rule: "nothing_to_push",
				branch: checkout.branch,
			});
		}

		return sha;
	}

	async function githubCall<Result>(repo: RepoRow, work: () => Promise<Result>) {
		try {
			return await work();
		} catch (error) {
			if (error instanceof GitHubError) {
				throw new AppError("rule_violated", error.message, {
					rule: isAccessLoss(error) ? "github_refused" : "github_failed",
					repo: repo.fullName,
					status: error.status,
				});
			}

			throw error;
		}
	}

	async function push(repo: RepoRow, checkout: CheckoutRow) {
		assertUsable(repo);

		const sha = await branchSha(checkout);

		const token = await githubCall(repo, () => github.repoToken(repo, pushPermissions));

		await pushFromCheckout(config, {
			threadRoot: threadDir(config, checkout.threadId),
			checkout: join(threadDir(config, checkout.threadId), checkout.dir),
			githubRepoId: repo.githubRepoId,
			fullName: repo.fullName,
			branch: checkout.branch,
			sha,
			token,
		}).catch((error: unknown) => {
			throw new AppError("rule_violated", `Pushing ${checkout.branch} failed: ${errorText(error)}`, {
				rule: "push_failed",
				branch: checkout.branch,
			});
		});

		return sha;
	}

	async function openPullRequest(
		repo: RepoRow,
		checkout: CheckoutRow,
		fields: { title: string; body: string; draft: boolean },
	) {
		const sha = await push(repo, checkout);

		const owner = repo.fullName.split("/")[0] ?? "";

		const raw = await githubCall(repo, async () => {
			try {
				return (await github.asInstallation(repo, pullPermissions, "POST", `/repos/${repo.fullName}/pulls`, {
					title: fields.title,
					body: fields.body,
					head: checkout.branch,
					base: repo.defaultBranch,
					draft: fields.draft,
				})) as RawPull;
			} catch (error) {
				if (!(error instanceof GitHubError) || error.status !== 422) throw error;

				const open = (await github.asInstallation(
					repo,
					pullPermissions,
					"GET",
					`/repos/${repo.fullName}/pulls?state=open&head=${encodeURIComponent(`${owner}:${checkout.branch}`)}`,
				)) as RawPull[];

				const [found] = open;

				if (found === undefined) throw error;

				return found;
			}
		});

		return { number: raw.number, url: raw.html_url, title: raw.title, state: pullState(raw), headSha: sha };
	}

	async function updatePullRequest(repo: RepoRow, number: number, fields: { title?: string; body?: string }) {
		const raw = await githubCall(
			repo,
			async () =>
				(await github.asInstallation(
					repo,
					pullPermissions,
					"PATCH",
					`/repos/${repo.fullName}/pulls/${number}`,
					fields,
				)) as RawPull,
		);

		return { title: raw.title, state: pullState(raw), headSha: raw.head.sha };
	}

	async function removeCheckouts(threadId: string, repoId?: string) {
		const removed = await db
			.update(checkouts)
			.set({ removedAt: sql`now()`, updatedAt: sql`now()` })
			.where(
				and(
					eq(checkouts.threadId, threadId),
					isNull(checkouts.removedAt),
					...(repoId === undefined ? [] : [eq(checkouts.repoId, repoId)]),
				),
			)
			.returning();

		const root = threadDir(config, threadId);

		for (const checkout of removed) await rm(join(root, checkout.dir), { recursive: true, force: true });

		const [left] = await db
			.select({ id: checkouts.id })
			.from(checkouts)
			.where(and(eq(checkouts.threadId, threadId), isNull(checkouts.removedAt)))
			.limit(1);

		if (left === undefined) await rm(root, { recursive: true, force: true });

		const [thread] = await db.select({ ventureId: threads.ventureId }).from(threads).where(eq(threads.id, threadId));

		if (thread?.ventureId !== null && thread?.ventureId !== undefined && removed.length > 0) {
			await notifyCode(db, { ventureId: thread.ventureId, threadId });
		}

		return removed.length;
	}

	async function refreshPullRequest(pr: PullRequestRow, repo: RepoRow) {
		const raw = (await github.asInstallation(
			repo,
			statusPermissions,
			"GET",
			`/repos/${repo.fullName}/pulls/${pr.number}`,
		)) as RawPull;

		const state = pullState(raw);

		if (state !== pr.state || raw.head.sha !== pr.headSha || raw.title !== pr.title) {
			await db
				.update(pullRequests)
				.set({ state, headSha: raw.head.sha, title: raw.title, updatedAt: sql`now()` })
				.where(eq(pullRequests.id, pr.id));
		}

		return { raw, state };
	}

	async function cleanupIfDone(threadId: string) {
		const prs = await db
			.select({ state: pullRequests.state })
			.from(pullRequests)
			.where(eq(pullRequests.threadId, threadId));

		if (prs.length > 0 && prs.every((pr) => pr.state !== "open")) await removeCheckouts(threadId);
	}

	async function refreshThread(threadId: string) {
		const open = await db
			.select({ pr: pullRequests, repo: ventureRepos })
			.from(pullRequests)
			.innerJoin(ventureRepos, eq(ventureRepos.id, pullRequests.repoId))
			.where(and(eq(pullRequests.threadId, threadId), eq(pullRequests.state, "open")));

		const errors: string[] = [];

		for (const { pr, repo } of open) {
			await refreshPullRequest(pr, repo).catch((error: unknown) => {
				console.error(`code: refreshing ${repo.fullName}#${pr.number} failed`, error);

				errors.push(`${repo.fullName}#${pr.number}: ${errorText(error)}`);
			});
		}

		if (open.length > 0) await cleanupIfDone(threadId);

		return errors.length === 0 ? null : errors.join("; ");
	}

	async function pullRequestStatus(pr: PullRequestRow, repo: RepoRow) {
		const { raw, state } = await githubCall(repo, () => refreshPullRequest(pr, repo));

		const read = (path: string) =>
			githubCall(repo, () =>
				github.asInstallation(repo, statusPermissions, "GET", `/repos/${repo.fullName}${path}`),
			);

		const [checks, status, reviews, reviewComments, comments] = (await Promise.all([
			read(`/commits/${raw.head.sha}/check-runs?per_page=100`),
			read(`/commits/${raw.head.sha}/status`),
			read(`/pulls/${pr.number}/reviews?per_page=100`),
			read(`/pulls/${pr.number}/comments?per_page=100`),
			read(`/issues/${pr.number}/comments?per_page=100`),
		])) as [
			{ check_runs: { name: string; status: string; conclusion: string | null; html_url?: string }[] },
			{ state: string; statuses: { context: string; state: string; description: string | null }[] },
			{ user: { login: string } | null; state: string; body: string; submitted_at?: string }[],
			{ user: { login: string } | null; path: string; line: number | null; body: string; created_at: string }[],
			{ user: { login: string } | null; body: string; created_at: string }[],
		];

		if (state !== "open") await cleanupIfDone(pr.threadId);

		return {
			number: raw.number,
			url: raw.html_url,
			title: raw.title,
			state,
			draft: raw.draft ?? false,
			mergeable: raw.mergeable_state ?? null,
			headSha: raw.head.sha,
			checks: checks.check_runs.map((run) => ({ name: run.name, status: run.status, conclusion: run.conclusion })),
			statuses: {
				state: status.state,
				items: status.statuses.map(({ context, state: s, description }) => ({ context, state: s, description })),
			},
			reviews: reviews.map((review) => ({ by: review.user?.login ?? null, state: review.state, body: review.body })),
			reviewComments: reviewComments.map((comment) => ({
				by: comment.user?.login ?? null,
				path: comment.path,
				line: comment.line,
				body: comment.body,
			})),
			comments: comments.map((comment) => ({ by: comment.user?.login ?? null, body: comment.body })),
		};
	}

	async function runJob(job: CodeJob) {
		if (job.type === "mirror") {
			await syncRepo(job.repoId);

			return;
		}

		await removeCheckouts(job.threadId, job.repoId);
	}

	return {
		config,
		github,
		repoById,
		syncRepo,
		ensureCheckout,
		liveCheckout,
		checkpoint,
		push,
		openPullRequest,
		updatePullRequest,
		pullRequestStatus,
		refreshThread,
		removeCheckouts,
		runJob,
	};
}

export type CodeHost = ReturnType<typeof createCodeHost>;
