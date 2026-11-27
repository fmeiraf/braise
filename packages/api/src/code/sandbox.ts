import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import { type CodeConfig, keysDir, threadDir, threadHome, threadsDir } from "./config.ts";

export const registryDomains = [
	"registry.npmjs.org",
	"registry.yarnpkg.com",
	"pypi.org",
	"files.pythonhosted.org",
	"crates.io",
	"index.crates.io",
	"static.crates.io",
	"proxy.golang.org",
	"sum.golang.org",
	"rubygems.org",
	"repo.maven.apache.org",
];

export const githubDomains = ["github.com", "*.github.com", "*.githubusercontent.com"];

export const defaultTimeoutMs = 120_000;

export const maxTimeoutMs = 600_000;

export const maxCommandOutput = 30_000;

export interface SandboxResult {
	exitCode: number | null;
	output: string;
	timedOut: boolean;
	aborted: boolean;
}

let initialized: Promise<void> | null = null;

function ensureSandbox() {
	if (initialized !== null) return initialized;

	if (!SandboxManager.isSupportedPlatform()) {
		return Promise.reject(new Error("braise's sandbox (srt) doesn't support this platform"));
	}

	initialized = SandboxManager.initialize({
		network: { allowedDomains: registryDomains, deniedDomains: githubDomains },
		filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
	}).catch((error: unknown) => {
		initialized = null;

		throw error;
	});

	return initialized;
}

export function sandboxPolicy(config: CodeConfig, threadId: string) {
	const own = threadDir(config, threadId);

	return {
		filesystem: {
			denyRead: [keysDir(config), threadsDir(config), ...config.protectedPaths],
			allowRead: [own],
			allowWrite: [own],
			denyWrite: [],
		},
	};
}

export function sandboxEnv(config: CodeConfig, threadId: string) {
	const home = threadHome(config, threadId);

	return {
		PATH: process.env.PATH ?? "/usr/bin:/bin",
		HOME: home,
		TMPDIR: join(home, "tmp"),
		LANG: "en_US.UTF-8",
		TERM: "dumb",
		CI: "1",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_TERMINAL_PROMPT: "0",
		NO_COLOR: "1",
	};
}

export function capOutput(text: string, limit = maxCommandOutput) {
	if (text.length <= limit) return text;

	const half = Math.floor(limit / 2);

	return `${text.slice(0, half)}\n…(${text.length - limit} characters cut)…\n${text.slice(-half)}`;
}

/** Runs one bash command inside srt, confined to the thread's folder, with a timeout. */
export async function runSandboxed(
	config: CodeConfig,
	options: {
		threadId: string;
		command: string;
		cwd?: string;
		timeoutMs?: number;
		signal?: AbortSignal;
		allowedDomains?: string[];
	},
) {
	await ensureSandbox();

	const home = threadHome(config, options.threadId);

	await mkdir(join(home, "tmp"), { recursive: true });

	const commandId = randomBytes(16).toString("base64url");
	const domains = options.allowedDomains ?? [];

	if (domains.length > 0) SandboxManager.registerCommandNetworkLists(commandId, { allowedDomains: domains });

	try {
		const wrapped = await SandboxManager.wrapWithSandbox(
			options.command,
			"/bin/bash",
			sandboxPolicy(config, options.threadId),
			undefined,
			{ commandId, commandText: options.command },
		);

		return await new Promise<SandboxResult>((resolve, reject) => {
			const child = spawn("/bin/bash", ["-c", wrapped], {
				cwd: options.cwd ?? threadDir(config, options.threadId),
				env: sandboxEnv(config, options.threadId),
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
			});

			let output = "";
			let timedOut = false;
			let aborted = false;

			const collect = (chunk: Buffer) => {
				output += chunk.toString("utf8");

				if (output.length > maxCommandOutput * 4) output = capOutput(output, maxCommandOutput * 2);
			};

			child.stdout.on("data", collect);

			child.stderr.on("data", collect);

			const kill = () => {
				if (child.pid !== undefined && child.exitCode === null) process.kill(-child.pid, "SIGKILL");
			};

			const timer = setTimeout(
				() => {
					timedOut = true;

					kill();
				},
				Math.min(options.timeoutMs ?? defaultTimeoutMs, maxTimeoutMs),
			);

			const onAbort = () => {
				aborted = true;

				kill();
			};

			options.signal?.addEventListener("abort", onAbort, { once: true });

			if (options.signal?.aborted === true) onAbort();

			child.once("error", (error) => {
				clearTimeout(timer);

				reject(error);
			});

			child.once("close", (code) => {
				clearTimeout(timer);

				options.signal?.removeEventListener("abort", onAbort);

				resolve({
					exitCode: code,
					output: capOutput(SandboxManager.annotateStderrWithSandboxFailures(options.command, output)),
					timedOut,
					aborted,
				});
			});
		});
	} finally {
		if (domains.length > 0) SandboxManager.unregisterCommandNetworkLists(commandId);

		SandboxManager.cleanupAfterCommand();
	}
}
