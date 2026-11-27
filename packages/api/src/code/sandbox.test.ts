import { mkdtempSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { keysDir, mirrorOf, readCodeConfig, threadDir, threadHome } from "./config.ts";
import { runSandboxed } from "./sandbox.ts";

const config = readCodeConfig({ ...process.env, BRAISE_HOME: mkdtempSync(join(tmpdir(), "braise-home-")) });

const own = "00000000-0000-7000-8000-00000000aaaa";

const other = "00000000-0000-7000-8000-00000000bbbb";

await mkdir(threadHome(config, own), { recursive: true });

await mkdir(threadDir(config, other), { recursive: true });

await writeFile(join(threadDir(config, other), "notes.txt"), "another thread's work");

await mkdir(keysDir(config), { recursive: true });

await writeFile(join(keysDir(config), "github-app.pem"), "secret key");

await mkdir(mirrorOf(config, 42), { recursive: true });

await writeFile(join(mirrorOf(config, 42), "HEAD"), "ref: refs/heads/main\n");

function sandboxed(command: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}) {
	return runSandboxed(config, { threadId: own, command, ...options });
}

describe("bash in srt", () => {
	it("writes inside the thread's folder, with HOME in it", async () => {
		const result = await sandboxed('echo made > made.txt && echo "$HOME"');

		expect(result).toMatchObject({ exitCode: 0, timedOut: false });

		expect(result.output).toContain(threadHome(config, own));

		expect(await readFile(join(threadDir(config, own), "made.txt"), "utf8")).toBe("made\n");
	});

	it("can't write outside the thread's folder", async () => {
		const result = await sandboxed(`echo no > ${join(threadDir(config, other), "planted.txt")}`);

		expect(result.exitCode).not.toBe(0);

		expect(result.output).toContain("Operation not permitted");
	});

	it("can't write into a mirror, though it can read one", async () => {
		const mirror = mirrorOf(config, 42);

		expect((await sandboxed(`cat ${join(mirror, "HEAD")}`)).output).toContain("refs/heads/main");

		expect((await sandboxed(`touch ${join(mirror, "planted")}`)).exitCode).not.toBe(0);
	});

	it("can't read the keys folder or another thread's folder", async () => {
		const key = await sandboxed(`cat ${join(keysDir(config), "github-app.pem")}`);

		const notes = await sandboxed(`cat ${join(threadDir(config, other), "notes.txt")}`);

		expect(key.exitCode).not.toBe(0);

		expect(key.output).not.toContain("secret key");

		expect(notes.exitCode).not.toBe(0);

		expect(notes.output).not.toContain("another thread");
	});

	it("gets a scrubbed environment", async () => {
		const result = await sandboxed("env");

		expect(result.output).not.toMatch(/DATABASE_URL|BRAISE_|GITHUB_TOKEN|ANTHROPIC/u);
	});

	it("can't reach GitHub", async () => {
		const result = await sandboxed("curl -sS -m 10 -o /dev/null https://github.com");

		expect(result.exitCode).not.toBe(0);
	});

	it("kills a command that runs past its timeout", async () => {
		const result = await sandboxed("while true; do :; done", { timeoutMs: 1_000 });

		expect(result).toMatchObject({ timedOut: true });
	});

	it("kills a command when the run stops", async () => {
		const controller = new AbortController();

		const running = sandboxed("echo started; while true; do :; done", { signal: controller.signal });

		controller.abort();

		expect(await running).toMatchObject({ aborted: true, timedOut: false });
	});
});
