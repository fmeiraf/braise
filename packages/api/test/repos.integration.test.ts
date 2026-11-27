import { execFileSync } from "node:child_process";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitHubConnection, ReachableRepo, ThreadCode, ThreadDetail, VentureRepo } from "@braise/core";
import { and, eq } from "drizzle-orm";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { braiseTools } from "../src/agent/tools.ts";
import { appKeyFile, threadDir } from "../src/code/config.ts";
import { codeQueue } from "../src/code/host.ts";
import { accessRequests, events, githubApp, pullRequests, ventureRepos } from "../src/db/schema.ts";
import {
	createIsolatedDatabase,
	createVenture,
	freshKey,
	openTestDatabase,
	testCodeConfig,
} from "./database.test-utils.ts";

const remotes = await mkdtemp(join(tmpdir(), "braise-github-"));

const config = testCodeConfig({ gitBase: `file://${remotes}/` });

const database = await openTestDatabase(await createIsolatedDatabase("braise_repos_test"), config);

const api = "https://api.github.com";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

const appId = 777;

const installationId = 9;

const repos = {
	app: { id: 101, full_name: "owner/app", default_branch: "main", private: true },
	gone: { id: 102, full_name: "owner/gone", default_branch: "main", private: true },
	hidden: { id: 103, full_name: "owner/hidden", default_branch: "main", private: true },
	other: { id: 104, full_name: "owner/other", default_branch: "main", private: false },
};

const repoById = new Map(Object.values(repos).map((repo) => [repo.id, repo]));

const hiddenFromApp = new Set([repos.hidden.id]);

interface Pull {
	number: number;
	html_url: string;
	title: string;
	body: string;
	state: "open" | "closed";
	merged: boolean;
	head: { sha: string; ref: string };
	base: { ref: string };
}

const github = {
	mints: [] as { repositoryIds: number[] | undefined; permissions: Record<string, string> | undefined }[],
	opened: [] as Record<string, unknown>[],
	pulls: new Map<number, Pull>(),
};

function verifiedApp(request: Request) {
	const [header = "", payload = "", signature = ""] = (request.headers.get("authorization") ?? "")
		.replace(/^Bearer /u, "")
		.split(".");

	return createVerify("RSA-SHA256").update(`${header}.${payload}`).verify(publicKey, signature, "base64url");
}

const githubApi = setupServer(
	http.post(`${api}/app-manifests/:code/conversions`, ({ params }) =>
		params.code === "manifest-code"
			? HttpResponse.json({
					id: appId,
					slug: "braise-test",
					pem,
					owner: { login: "owner" },
					html_url: "https://github.com/apps/braise-test",
				})
			: HttpResponse.json({ message: "Not Found" }, { status: 404 }),
	),
	http.get(`${api}/app/installations`, ({ request }) =>
		verifiedApp(request)
			? HttpResponse.json([
					{
						id: installationId,
						account: { login: "owner", type: "User" },
						repository_selection: "selected",
						html_url: "https://github.com/settings/installations/9",
					},
				])
			: HttpResponse.json({ message: "Bad credentials" }, { status: 401 }),
	),
	http.post(`${api}/app/installations/:id/access_tokens`, async ({ request }) => {
		if (!verifiedApp(request)) return HttpResponse.json({ message: "Bad credentials" }, { status: 401 });

		const body = (await request.json()) as { repository_ids?: number[]; permissions?: Record<string, string> };

		github.mints.push({ repositoryIds: body.repository_ids, permissions: body.permissions });

		if (body.repository_ids?.some((id) => hiddenFromApp.has(id)) === true) {
			return HttpResponse.json({ message: "There is at least one repository that does not exist" }, { status: 422 });
		}

		return HttpResponse.json({ token: "ghs_testtoken", expires_at: "2026-11-26T18:00:00Z" });
	}),
	http.get(`${api}/installation/repositories`, () =>
		HttpResponse.json({ repositories: Object.values(repos).filter((repo) => !hiddenFromApp.has(repo.id)) }),
	),
	http.get(`${api}/repositories/:id`, ({ params }) => {
		const repo = repoById.get(Number(params.id));

		return repo === undefined
			? HttpResponse.json({ message: "Not Found" }, { status: 404 })
			: HttpResponse.json(repo);
	}),
	http.post(`${api}/repos/:owner/:name/pulls`, async ({ request }) => {
		const body = (await request.json()) as { title: string; body: string; head: string; base: string };

		github.opened.push(body);

		const number = 7 + github.pulls.size;

		const pull = {
			number,
			html_url: `https://github.com/owner/app/pull/${number}`,
			title: body.title,
			body: body.body,
			state: "open",
			merged: false,
			head: { sha: "0".repeat(40), ref: body.head },
			base: { ref: body.base },
		} satisfies Pull;

		github.pulls.set(number, pull);

		return HttpResponse.json(pull, { status: 201 });
	}),
	http.get(`${api}/repos/:owner/:name/pulls/:number`, ({ params }) => {
		const pull = github.pulls.get(Number(params.number));

		return pull === undefined
			? HttpResponse.json({ message: "Not Found" }, { status: 404 })
			: HttpResponse.json(pull);
	}),
	http.patch(`${api}/repos/:owner/:name/pulls/:number`, async ({ params, request }) => {
		const pull = github.pulls.get(Number(params.number));

		if (pull === undefined) return HttpResponse.json({ message: "Not Found" }, { status: 404 });

		Object.assign(pull, (await request.json()) as Partial<Pull>);

		return HttpResponse.json(pull);
	}),
	http.get(`${api}/repos/:owner/:name/commits/:sha/check-runs`, () =>
		HttpResponse.json({ check_runs: [{ name: "test", status: "completed", conclusion: "success" }] }),
	),
	http.get(`${api}/repos/:owner/:name/commits/:sha/status`, () =>
		HttpResponse.json({ state: "success", statuses: [] }),
	),
	http.get(`${api}/repos/:owner/:name/pulls/:number/reviews`, () =>
		HttpResponse.json([{ user: { login: "owner" }, state: "CHANGES_REQUESTED", body: "Add a testing section" }]),
	),
	http.get(`${api}/repos/:owner/:name/pulls/:number/comments`, () =>
		HttpResponse.json([
			{ user: { login: "owner" }, path: "CONTRIBUTING.md", line: 1, body: "Typo here", created_at: "2026-11-26" },
		]),
	),
	http.get(`${api}/repos/:owner/:name/issues/:number/comments`, () =>
		HttpResponse.json([{ user: { login: "owner" }, body: "Nice start", created_at: "2026-11-26" }]),
	),
);

function git(cwd: string, ...args: string[]) {
	return execFileSync("git", ["-c", "user.name=Owner", "-c", "user.email=owner@example.com", ...args], {
		cwd,
		encoding: "utf8",
		env: { PATH: process.env.PATH ?? "", HOME: remotes, GIT_CONFIG_NOSYSTEM: "1" },
	}).trim();
}

async function refOf(gitDir: string, ref: string) {
	const loose = await readFile(join(gitDir, ref), "utf8").catch(async (error: unknown) => {
		const packed = await readFile(join(gitDir, "packed-refs"), "utf8");

		const line = packed.split("\n").find((entry) => entry.endsWith(` ${ref}`));

		if (line === undefined) throw error;

		return line.split(" ")[0] ?? "";
	});

	return loose.trim();
}

async function headOf(checkout: string) {
	const head = (await readFile(join(checkout, ".git", "HEAD"), "utf8")).trim();

	return head.startsWith("ref: ") ? refOf(join(checkout, ".git"), head.slice(5)) : head;
}

async function makeRemote(fullName: string) {
	const bare = join(remotes, `${fullName}.git`);

	const seed = await mkdtemp(join(tmpdir(), "braise-seed-"));

	await mkdir(bare, { recursive: true });

	git(bare, "init", "--quiet", "--bare", "--initial-branch=main");

	git(seed, "init", "--quiet", "--initial-branch=main");

	execFileSync("sh", ["-c", 'printf "# App\\n" > README.md'], { cwd: seed });

	git(seed, "add", "README.md");

	git(seed, "commit", "--quiet", "-m", "First commit");

	git(seed, "push", "--quiet", bare, "main");

	return { bare, head: git(bare, "rev-parse", "refs/heads/main") };
}

const appRemote = await makeRemote(repos.app.full_name);

await makeRemote(repos.other.full_name);

beforeAll(() => githubApi.listen({ onUnhandledFrame: "error" }));

afterAll(async () => {
	githubApi.close();

	await database.close();
});

interface Sent<Result> {
	status: number;
	body: { result: Result; error?: { code: string; message: string; details: Record<string, unknown> } };
}

async function send<Result>(name: string, payload: Record<string, unknown>) {
	const response = await database.post(name, { payload, idempotencyKey: freshKey(name) });

	return { status: response.status, body: await response.json() } as Sent<Result>;
}

async function ok<Result>(name: string, payload: Record<string, unknown>) {
	const sent = await send<Result>(name, payload);

	expect(sent.status, JSON.stringify(sent.body)).toBe(200);

	return sent.body.result;
}

async function read<Body>(path: string) {
	const response = await database.app.request(`/api${path}`);

	expect(response.status, path).toBe(200);

	return (await response.json()) as Body;
}

const venture = await createVenture(database, "Code Venture");

const otherVenture = await createVenture(database, "Other Venture");

async function startThread(title: string) {
	const started = await ok<{ thread: { id: string; title: string }; run: { id: string } }>("thread.start", {
		ventureId: venture.id,
		title,
		body: "Add a CONTRIBUTING.md",
	});

	await ok("run.cancel", { runId: started.run.id });

	const tools = braiseTools({
		db: database.db,
		reader: database.reader,
		services: database.services,
		actor: "agent:claude",
		runId: started.run.id,
		threadId: started.thread.id,
		coding: {
			code: database.services.code,
			ventureId: venture.id,
			threadTitle: started.thread.title,
			signal: new AbortController().signal,
		},
	});

	const call = async (name: string, args: Record<string, unknown>) => {
		const found = tools.find((candidate) => candidate.name === name);

		if (found === undefined) throw new Error(`No tool ${name}`);

		return found.execute(args);
	};

	return { thread: started.thread, run: started.run, call };
}

async function repoRow(githubRepoId: number) {
	const [row] = await database.db.select().from(ventureRepos).where(eq(ventureRepos.githubRepoId, githubRepoId));

	return row;
}

async function addRepo(target: { id: string }, repo: (typeof repos)[keyof typeof repos]) {
	return send<{ id: string; status: string }>("venture.add_repo", {
		ventureId: target.id,
		githubRepoId: repo.id,
		installationId,
		fullName: repo.full_name,
		defaultBranch: repo.default_branch,
	});
}

describe("the GitHub App", () => {
	it("is created through the manifest flow and its key is saved outside Postgres", async () => {
		const page = await database.app.request("/api/github/connect?return=/v/code-venture");

		const html = await page.text();

		const state = /state=([0-9a-f]+)/u.exec(html)?.[1] ?? "";

		expect(html).toContain('action="https://github.com/settings/apps/new?state=');

		expect(html).toContain("&quot;contents&quot;:&quot;write&quot;");

		const callback = await database.app.request(`/api/github/callback?code=manifest-code&state=${state}`);

		expect(callback.status).toBe(302);

		expect(callback.headers.get("location")).toBe(
			`https://github.com/apps/braise-test/installations/new?state=${state}`,
		);

		expect(statSync(appKeyFile(config)).mode & 0o777).toBe(0o600);

		expect(await database.db.select().from(githubApp)).toMatchObject([
			{ id: appId, slug: "braise-test", ownerLogin: "owner" },
		]);

		const installed = await database.app.request(
			`/api/github/installed?installation_id=${installationId}&setup_action=install&state=${state}`,
		);

		expect(installed.headers.get("location")).toBe("http://localhost:5400/v/code-venture?github=installed");
	});

	it("refuses a callback it didn't start", async () => {
		const callback = await database.app.request("/api/github/callback?code=manifest-code&state=forged");

		expect(callback.status).toBe(400);
	});

	it("lists its installations and the repos they reach, live", async () => {
		const connection = await read<GitHubConnection>("/github");

		expect(connection).toMatchObject({
			app: { id: appId, slug: "braise-test" },
			installations: [{ id: installationId, account: "owner", selection: "selected" }],
			installUrl: "https://github.com/apps/braise-test/installations/new",
			error: null,
		});

		const { repos: reachable } = await read<{ repos: ReachableRepo[] }>("/github/repos");

		expect(reachable.map((repo) => repo.fullName)).toEqual(["owner/app", "owner/gone", "owner/other"]);
	});
});

describe("repos on a venture", () => {
	it("adds a repo, records the event and mirrors it", async () => {
		const added = await addRepo(venture, repos.app);

		expect(added.status, JSON.stringify(added.body)).toBe(200);

		expect(added.body.result.status).toBe("cloning");

		const [queued] = await database.boss.fetch(codeQueue);

		expect(queued?.data).toEqual({ type: "mirror", repoId: added.body.result.id });

		github.mints.length = 0;

		await database.services.code.syncRepo(added.body.result.id);

		expect(await repoRow(repos.app.id)).toMatchObject({
			status: "ready",
			mirrorHeadSha: appRemote.head,
			error: null,
		});

		expect(github.mints.some((mint) => mint.repositoryIds?.join() === String(repos.app.id))).toBe(true);

		expect(github.mints.every((mint) => mint.repositoryIds?.length === 1)).toBe(true);

		const [event] = await database.db
			.select()
			.from(events)
			.where(and(eq(events.ventureId, venture.id), eq(events.type, "repo.added")));

		expect(event?.payload).toMatchObject({ fullName: "owner/app" });
	});

	it("is owner-only", async () => {
		const refused = await database
			.command(
				"venture.add_repo",
				{
					payload: {
						ventureId: venture.id,
						githubRepoId: repos.other.id,
						installationId,
						fullName: repos.other.full_name,
						defaultBranch: "main",
					},
					idempotencyKey: freshKey("agent-add"),
				},
				"agent:claude",
			)
			.then(
				() => null,
				(error: unknown) => error as { code: string },
			);

		expect(refused?.code).toBe("not_granted");
	});

	it("gives a repo one venture", async () => {
		const taken = await addRepo(otherVenture, repos.app);

		expect(taken.status).toBe(422);

		expect(taken.body.error?.details.rule).toBe("repo_taken");
	});

	it("marks a repo the App can't reach as no_access and a failed clone as failed", async () => {
		const hidden = await addRepo(otherVenture, repos.hidden);

		const gone = await addRepo(otherVenture, repos.gone);

		await database.services.code.syncRepo(hidden.body.result.id);

		await database.services.code.syncRepo(gone.body.result.id);

		expect(await repoRow(repos.hidden.id)).toMatchObject({ status: "no_access" });

		expect((await repoRow(repos.hidden.id))?.error).toContain("add it to the App's repositories");

		expect(await repoRow(repos.gone.id)).toMatchObject({ status: "failed" });

		expect((await repoRow(repos.gone.id))?.error).toContain("git fetch failed");
	});

	it("lists a venture's repos", async () => {
		const { repos: listed } = await read<{ repos: VentureRepo[] }>(`/ventures/${venture.slug}/repos`);

		expect(listed).toMatchObject([{ fullName: "owner/app", status: "ready", openPullRequests: 0 }]);
	});
});

describe("a thread's checkout", () => {
	const marker = join(config.home, "hook-ran");

	let flow: Awaited<ReturnType<typeof startThread>>;
	let repoId = "";
	let committedSha = "";

	beforeAll(async () => {
		flow = await startThread("Contributing guide");

		repoId = (await repoRow(repos.app.id))?.id ?? "";
	});

	it("is a --shared clone on the thread's branch, made once", async () => {
		const first = await flow.call("checkout_repo", { repo: "owner/app" });

		expect(first.isError, first.text).toBe(false);

		const made = JSON.parse(first.text) as { dir: string; branch: string; baseSha: string; created: boolean };

		expect(made).toMatchObject({ dir: "app", baseSha: appRemote.head, created: true });

		expect(made.branch).toMatch(/^braise\/contributing-guide-[0-9a-f]{6}$/u);

		const checkout = join(threadDir(config, flow.thread.id), "app");

		expect(await readFile(join(checkout, ".git", "HEAD"), "utf8")).toBe(`ref: refs/heads/${made.branch}\n`);

		expect(existsSync(join(checkout, ".git", "objects", "info", "alternates"))).toBe(true);

		const again = JSON.parse((await flow.call("checkout_repo", { repo: repoId })).text) as { created: boolean };

		expect(again.created).toBe(false);
	});

	it("is edited with the file tools, which stay inside the thread's folder", async () => {
		expect(
			(await flow.call("write", { file_path: "app/CONTRIBUTING.md", content: "# Contributing\n\nOpen a PR.\n" }))
				.isError,
		).toBe(false);

		const edited = await flow.call("edit", {
			file_path: "app/CONTRIBUTING.md",
			old_string: "Open a PR.",
			new_string: "Open a pull request.",
		});

		expect(edited.isError, edited.text).toBe(false);

		expect((await flow.call("read", { file_path: "app/CONTRIBUTING.md" })).text).toContain("Open a pull request.");

		const escaped = await flow.call("read", { file_path: "../../keys/github-app.pem" });

		expect(escaped).toMatchObject({ isError: true });

		expect(escaped.text).toContain("outside this thread's folder");
	});

	it("is committed to in the sandbox, where planted hooks stay inert", async () => {
		const committed = await flow.call("bash", {
			command: `cd app && git add CONTRIBUTING.md && git commit --quiet -m "Add CONTRIBUTING.md" && printf '#!/bin/sh\\ntouch ${marker}\\n' > .git/hooks/pre-push && chmod +x .git/hooks/pre-push && git rev-parse HEAD`,
		});

		expect(committed.isError, committed.text).toBe(false);

		committedSha = /[0-9a-f]{40}/u.exec(committed.text)?.[0] ?? "";

		expect(committedSha).not.toBe(appRemote.head);
	});

	it("files an access request when the agent pushes without code", async () => {
		const refused = await flow.call("push_branch", { repo: "owner/app" });

		expect(refused.isError).toBe(false);

		expect(refused.text).toContain("Access requested");

		const [request] = await database.db
			.select()
			.from(accessRequests)
			.where(and(eq(accessRequests.runId, flow.run.id), eq(accessRequests.capability, "code")));

		expect(request).toMatchObject({ command: "repo.push", status: "pending" });

		await ok("access.approve", { accessRequestId: request?.id });
	});

	it("pushes only the thread's branch, without running the checkout's hooks", async () => {
		const pushed = await flow.call("push_branch", { repo: "owner/app" });

		expect(pushed.isError, pushed.text).toBe(false);

		const { branch, sha } = JSON.parse(pushed.text) as { branch: string; sha: string };

		expect(await refOf(appRemote.bare, `refs/heads/${branch}`)).toBe(sha);

		expect(sha).toBe(committedSha);

		expect(existsSync(marker)).toBe(false);
	});

	it("opens one pull request as the App and notes it in the thread", async () => {
		const opened = await flow.call("open_pull_request", {
			repo: "owner/app",
			title: "Add CONTRIBUTING.md",
			body: "Explains how to contribute.",
		});

		expect(opened.isError, opened.text).toBe(false);

		expect(github.opened.at(-1)).toMatchObject({
			title: "Add CONTRIBUTING.md",
			base: "main",
			head: expect.stringMatching(/^braise\/contributing-guide-/u),
			body: expect.stringContaining("Opened by Claude from the braise thread “Contributing guide”."),
		});

		const [row] = await database.db.select().from(pullRequests).where(eq(pullRequests.threadId, flow.thread.id));

		expect(row).toMatchObject({ number: 7, state: "open", createdBy: "agent:claude", runId: flow.run.id });

		const detail = await read<ThreadDetail>(`/threads/${flow.thread.id}`);

		expect(detail.messages.at(-1)).toMatchObject({
			author: "braise",
			body: "Opened pull request #7 on owner/app: Add CONTRIBUTING.md",
			meta: { kind: "pull_request", number: 7 },
		});

		const again = await flow.call("open_pull_request", { repo: "owner/app", title: "Again" });

		expect(again.isError).toBe(true);

		expect(again.text).toContain("pr_exists");
	});

	it("keeps the repo on the venture while a braise pull request is open", async () => {
		const refused = await send("venture.remove_repo", { ventureId: venture.id, repoId });

		expect(refused.status).toBe(422);

		expect(refused.body.error?.details.rule).toBe("repo_has_open_prs");
	});

	it("reads the pull request's checks, reviews and comments", async () => {
		const status = await flow.call("pull_request_status", { repo: "owner/app" });

		expect(status.isError, status.text).toBe(false);

		expect(JSON.parse(status.text)).toMatchObject({
			number: 7,
			state: "open",
			checks: [{ name: "test", conclusion: "success" }],
			reviews: [{ by: "owner", state: "CHANGES_REQUESTED" }],
			reviewComments: [{ path: "CONTRIBUTING.md", body: "Typo here" }],
			comments: [{ body: "Nice start" }],
		});
	});

	it("records the checkout's HEAD as the run's checkpoint", async () => {
		const [recorded] = await database.services.code.checkpoint(flow.thread.id);

		expect(recorded?.sha).toBe(await headOf(join(threadDir(config, flow.thread.id), "app")));
	});

	it("is removed once its pull requests are merged", async () => {
		const pull = github.pulls.get(7);

		if (pull !== undefined) Object.assign(pull, { state: "closed", merged: true });

		const code = await read<ThreadCode>(`/threads/${flow.thread.id}/code`);

		expect(code.pullRequests).toMatchObject([{ number: 7, state: "merged" }]);

		expect(code.checkouts).toEqual([]);

		expect(existsSync(threadDir(config, flow.thread.id))).toBe(false);
	});

	it("leaves the venture once no pull request is open", async () => {
		await ok("venture.remove_repo", { ventureId: venture.id, repoId });

		expect((await repoRow(repos.app.id))?.removedAt).not.toBeNull();
	});
});

describe("archiving a thread", () => {
	it("removes its checkouts", async () => {
		const added = await ok<{ id: string }>("venture.add_repo", {
			ventureId: venture.id,
			githubRepoId: repos.other.id,
			installationId,
			fullName: repos.other.full_name,
			defaultBranch: "main",
		});

		await database.services.code.syncRepo(added.id);

		const flow = await startThread("Scratch work");

		expect((await flow.call("checkout_repo", { repo: "owner/other" })).isError).toBe(false);

		await ok("thread.archive", { threadId: flow.thread.id });

		const jobs = await database.boss.fetch(codeQueue, { batchSize: 10 });

		const cleanup = jobs.find((job) => (job.data as { threadId?: string }).threadId === flow.thread.id);

		expect(cleanup?.data).toEqual({ type: "cleanup", threadId: flow.thread.id });

		await database.services.code.runJob(cleanup?.data as { type: "cleanup"; threadId: string });

		expect(existsSync(threadDir(config, flow.thread.id))).toBe(false);
	});
});
