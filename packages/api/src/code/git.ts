import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { type CodeConfig, mirrorOf, remoteUrl } from "./config.ts";

const run = promisify(execFile);

const maxBuffer = 16 * 1024 * 1024;

export const shaPattern = /^[0-9a-f]{40}$/u;

export class GitError extends Error {
	readonly stderr: string;

	constructor(message: string, stderr: string) {
		super(message);

		this.name = "GitError";
		this.stderr = stderr;
	}
}

function trustedEnv(config: CodeConfig, extra: Record<string, string> = {}) {
	return {
		PATH: process.env.PATH ?? "/usr/bin:/bin",
		HOME: config.home,
		LANG: "C",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_TERMINAL_PROMPT: "0",
		GIT_ASKPASS: "/usr/bin/false",
		...extra,
	};
}

export function tokenEnv(token: string | null) {
	const env: Record<string, string> = {};

	if (token === null) return env;

	env.GIT_CONFIG_COUNT = "1";
	env.GIT_CONFIG_KEY_0 = "http.extraHeader";
	env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;

	return env;
}

function redact(text: string) {
	return text.replace(/(Authorization: Basic )\S+/giu, "$1***").replace(/ghs_[A-Za-z0-9]+/gu, "ghs_***");
}

function subcommandOf(args: string[]) {
	const at = args[0] === "-C" ? 2 : 0;

	return args[at] ?? "";
}

function summaryOf(stderr: string) {
	const lines = stderr
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");

	return lines.find((line) => /^(fatal|error):/u.test(line)) ?? lines.at(-1) ?? "no output";
}

export async function git(config: CodeConfig, args: string[], options: { env?: Record<string, string> } = {}) {
	try {
		const { stdout } = await run("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], {
			env: trustedEnv(config, options.env),
			maxBuffer,
		});

		return stdout.trim();
	} catch (error) {
		const stderr = redact(
			typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr) : String(error),
		);

		throw new GitError(`git ${subcommandOf(args)} failed: ${summaryOf(stderr)}`, stderr);
	}
}

async function exists(path: string) {
	return stat(path).then(
		() => true,
		(error: unknown) => {
			if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return false;

			throw error;
		},
	);
}

/** Creates or fetches a repo's bare mirror: heads only, objects never pruned because checkouts borrow them. */
export async function syncMirror(
	config: CodeConfig,
	repo: { githubRepoId: number; fullName: string; defaultBranch: string },
	token: string | null,
) {
	const mirror = mirrorOf(config, repo.githubRepoId);

	if (!(await exists(mirror))) {
		await mkdir(dirname(mirror), { recursive: true });

		await git(config, ["init", "--quiet", "--bare", mirror]);

		await git(config, ["-C", mirror, "config", "gc.pruneExpire", "never"]);

		await git(config, ["-C", mirror, "config", "remote.origin.fetch", "+refs/heads/*:refs/heads/*"]);
	}

	await git(config, ["-C", mirror, "config", "remote.origin.url", remoteUrl(config, repo.fullName)]);

	await git(config, ["-C", mirror, "fetch", "--quiet", "--prune", "origin"], { env: tokenEnv(token) });

	await git(config, ["-C", mirror, "symbolic-ref", "HEAD", `refs/heads/${repo.defaultBranch}`]);

	return git(config, ["-C", mirror, "rev-parse", `refs/heads/${repo.defaultBranch}`]);
}

/** A fresh `--shared` clone on a new branch; runs before the agent has touched the folder. */
export async function cloneShared(
	config: CodeConfig,
	options: {
		githubRepoId: number;
		defaultBranch: string;
		target: string;
		branch: string;
		author: { name: string; email: string };
	},
) {
	const mirror = mirrorOf(config, options.githubRepoId);

	await git(config, [
		"clone",
		"--quiet",
		"--shared",
		"--branch",
		options.defaultBranch,
		"--config",
		`user.name=${options.author.name}`,
		"--config",
		`user.email=${options.author.email}`,
		mirror,
		options.target,
	]);

	await git(config, ["-C", options.target, "switch", "--quiet", "-c", options.branch]);

	return git(config, ["-C", options.target, "rev-parse", "HEAD"]);
}

/**
 * Pushes one SHA to one branch without running git in the agent's checkout: a temporary bare repository
 * owned by braise borrows the checkout's and the mirror's objects and pushes from there.
 */
export async function pushFromCheckout(
	config: CodeConfig,
	options: {
		threadRoot: string;
		checkout: string;
		githubRepoId: number;
		fullName: string;
		branch: string;
		sha: string;
		token: string | null;
	},
) {
	if (!shaPattern.test(options.sha)) throw new GitError(`Not a commit SHA: ${options.sha}`, "");

	const gitDir = join(options.checkout, ".git");

	const info = await lstat(gitDir);

	if (!info.isDirectory()) throw new GitError("The checkout's .git is not a directory", "");

	const objects = await realpath(join(gitDir, "objects"));

	const root = await realpath(options.threadRoot);

	if (!objects.startsWith(`${root}/`)) throw new GitError("The checkout's objects are outside the thread folder", "");

	const scratch = await mkdtemp(join(tmpdir(), "braise-push-"));

	try {
		await git(config, ["init", "--quiet", "--bare", scratch]);

		await writeFile(
			join(scratch, "objects", "info", "alternates"),
			`${objects}\n${join(mirrorOf(config, options.githubRepoId), "objects")}\n`,
		);

		await git(config, ["-C", scratch, "update-ref", `refs/heads/${options.branch}`, options.sha]);

		await git(
			config,
			[
				"-C",
				scratch,
				"push",
				"--quiet",
				"--porcelain",
				remoteUrl(config, options.fullName),
				`refs/heads/${options.branch}:refs/heads/${options.branch}`,
			],
			{ env: tokenEnv(options.token) },
		);
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}
