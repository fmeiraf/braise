import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const maxReadLines = 2_000;

const maxLineLength = 2_000;

export class PathError extends Error {
	constructor(message: string) {
		super(message);

		this.name = "PathError";
	}
}

function isMissing(error: unknown) {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function inside(root: string, path: string) {
	return path === root || path.startsWith(`${root}${sep}`);
}

async function existing(path: string) {
	return lstat(path).then(
		() => true,
		(error: unknown) => {
			if (isMissing(error)) return false;

			throw error;
		},
	);
}

/**
 * Resolves a tool path against the thread folder. The real path, with every symlink resolved, must stay
 * inside the folder; parents that don't exist yet are resolved from the nearest one that does.
 */
export async function resolveInside(rootPath: string, filePath: string) {
	const root = await realpath(rootPath);

	const given = resolve(rootPath);
	const lexical = resolve(root, filePath);

	const candidate =
		isAbsolute(filePath) && !inside(root, lexical) && inside(given, lexical)
			? join(root, relative(given, lexical))
			: lexical;

	if (!inside(root, candidate)) throw new PathError(`${filePath} is outside this thread's folder`);

	let probe = candidate;
	const missing: string[] = [];

	while (!(await existing(probe))) {
		missing.unshift(probe.slice(dirname(probe).length + 1));

		probe = dirname(probe);
	}

	const real = await realpath(probe);

	if (!inside(root, real)) throw new PathError(`${filePath} leads outside this thread's folder`);

	return { path: join(real, ...missing), root, exists: missing.length === 0 };
}

export function displayPath(root: string, path: string) {
	return relative(root, path) || ".";
}

export async function readText(rootPath: string, filePath: string, options: { offset?: number; limit?: number }) {
	const target = await resolveInside(rootPath, filePath);

	if (!target.exists) throw new PathError(`${filePath} doesn't exist`);

	const info = await lstat(target.path);

	if (info.isDirectory()) throw new PathError(`${filePath} is a directory; list it with bash (ls)`);

	const content = await readFile(target.path);

	if (content.includes(0)) throw new PathError(`${filePath} looks binary`);

	const lines = content.toString("utf8").split("\n");
	const start = Math.max(1, options.offset ?? 1);
	const count = Math.min(options.limit ?? maxReadLines, maxReadLines);
	const shown = lines.slice(start - 1, start - 1 + count);

	const numbered = shown.map((line, index) => {
		const clipped = line.length > maxLineLength ? `${line.slice(0, maxLineLength)}…` : line;

		return `${String(start + index).padStart(6)}\t${clipped}`;
	});

	const rest = lines.length - (start - 1 + shown.length);

	return rest > 0
		? `${numbered.join("\n")}\n… ${rest} more lines (read with offset ${start + shown.length})`
		: numbered.join("\n");
}

export async function writeText(rootPath: string, filePath: string, content: string) {
	const target = await resolveInside(rootPath, filePath);

	await mkdir(dirname(target.path), { recursive: true });

	await writeFile(target.path, content);

	return { path: displayPath(target.root, target.path), created: !target.exists, bytes: Buffer.byteLength(content) };
}

function occurrences(haystack: string, needle: string) {
	let count = 0;
	let index = haystack.indexOf(needle);

	while (index !== -1) {
		count += 1;

		index = haystack.indexOf(needle, index + needle.length);
	}

	return count;
}

export async function editText(
	rootPath: string,
	filePath: string,
	edit: { oldString: string; newString: string; replaceAll: boolean },
) {
	if (edit.oldString === edit.newString) throw new PathError("old_string and new_string are the same");

	const target = await resolveInside(rootPath, filePath);

	if (!target.exists) throw new PathError(`${filePath} doesn't exist; create it with write`);

	const content = await readFile(target.path, "utf8");

	const found = occurrences(content, edit.oldString);

	if (found === 0) throw new PathError(`old_string isn't in ${filePath}; read the file and copy the text exactly`);

	if (found > 1 && !edit.replaceAll) {
		throw new PathError(
			`old_string appears ${found} times in ${filePath}; give more surrounding text or set replace_all`,
		);
	}

	const next = edit.replaceAll
		? content.split(edit.oldString).join(edit.newString)
		: content.replace(edit.oldString, () => edit.newString);

	await writeFile(target.path, next);

	return { path: displayPath(target.root, target.path), replaced: edit.replaceAll ? found : 1 };
}
