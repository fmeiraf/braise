import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { editText, readText, resolveInside, writeText } from "./files.ts";

const outside = await mkdtemp(join(tmpdir(), "braise-outside-"));

const root = await mkdtemp(join(tmpdir(), "braise-thread-"));

await mkdir(join(root, "app"), { recursive: true });

await writeFile(join(root, "app", "notes.md"), "one\ntwo\nthree\ntwo\n");

await writeFile(join(outside, "secret.txt"), "secret");

await symlink(outside, join(root, "app", "escape"));

await symlink(join(outside, "secret.txt"), join(root, "app", "secret-link"));

describe("resolveInside", () => {
	it("accepts relative paths and absolute paths inside the folder", async () => {
		expect((await resolveInside(root, "app/notes.md")).exists).toBe(true);

		expect((await resolveInside(root, join(root, "app", "new", "file.ts"))).exists).toBe(false);
	});

	it("refuses .. and absolute paths outside the folder", async () => {
		await expect(resolveInside(root, "../x")).rejects.toThrow("outside this thread's folder");

		await expect(resolveInside(root, join(outside, "secret.txt"))).rejects.toThrow("outside this thread's folder");
	});

	it("refuses symlinks that lead out, for files and for folders", async () => {
		await expect(resolveInside(root, "app/secret-link")).rejects.toThrow("leads outside");

		await expect(resolveInside(root, "app/escape/new.txt")).rejects.toThrow("leads outside");
	});
});

describe("file tools", () => {
	it("reads with line numbers and an offset", async () => {
		expect(await readText(root, "app/notes.md", { offset: 2, limit: 2 })).toBe(
			"     2\ttwo\n     3\tthree\n… 2 more lines (read with offset 4)",
		);
	});

	it("writes a new file with its folders", async () => {
		expect(await writeText(root, "app/src/index.ts", "export {};\n")).toEqual({
			path: "app/src/index.ts",
			created: true,
			bytes: 11,
		});
	});

	it("refuses an ambiguous or missing old_string and replaces all on request", async () => {
		await expect(
			editText(root, "app/notes.md", { oldString: "two", newString: "2", replaceAll: false }),
		).rejects.toThrow("appears 2 times");

		await expect(
			editText(root, "app/notes.md", { oldString: "four", newString: "4", replaceAll: false }),
		).rejects.toThrow("isn't in");

		expect(await editText(root, "app/notes.md", { oldString: "two", newString: "2", replaceAll: true })).toEqual({
			path: "app/notes.md",
			replaced: 2,
		});

		expect(await readFile(join(root, "app", "notes.md"), "utf8")).toBe("one\n2\nthree\n2\n");
	});
});
