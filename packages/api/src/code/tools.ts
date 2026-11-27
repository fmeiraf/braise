import type { CommandName } from "@braise/core";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { AgentTool, ToolOutput } from "../agent/runtime.ts";
import type { Database } from "../db/client.ts";
import { pullRequests, ventureRepos } from "../db/schema.ts";
import { AppError } from "../errors.ts";
import { threadDir } from "./config.ts";
import { editText, maxReadLines, PathError, readText, writeText } from "./files.ts";
import type { CodeHost, RepoRow } from "./host.ts";
import { defaultTimeoutMs, maxTimeoutMs, runSandboxed } from "./sandbox.ts";

export interface CodeToolScope {
	db: Database;
	code: CodeHost;
	threadId: string;
	threadTitle: string;
	ventureId: string;
	signal: AbortSignal;
	command(name: CommandName, payload: Record<string, unknown>): Promise<ToolOutput>;
	fail(error: unknown): ToolOutput;
}

function defineTool<Shape extends z.ZodRawShape>(tool: {
	name: string;
	description: string;
	input: Shape;
	execute(args: z.output<z.ZodObject<Shape>>, signal?: AbortSignal): Promise<ToolOutput>;
}) {
	const schema = z.object(tool.input);

	return {
		name: tool.name,
		description: tool.description,
		input: tool.input,
		execute: (args: unknown, signal?: AbortSignal) => tool.execute(schema.parse(args), signal),
	} satisfies AgentTool;
}

function text(value: unknown) {
	return { text: typeof value === "string" ? value : JSON.stringify(value, null, 1), isError: false };
}

const repoArg = z.string().min(1).max(200).describe("The repo's full name (owner/name) or its braise repo id");

const toolPathNote =
	"Paths are relative to this thread's folder (e.g. app/src/index.ts, where app is the checkout's folder) or absolute inside it.";

export function codingTools(scope: CodeToolScope) {
	const root = threadDir(scope.code.config, scope.threadId);

	const attempt = async (work: () => Promise<ToolOutput>) => {
		try {
			return await work();
		} catch (error) {
			if (error instanceof PathError) return { text: error.message, isError: true };

			return scope.fail(error);
		}
	};

	async function findRepo(ref: string) {
		const repos = await scope.db
			.select()
			.from(ventureRepos)
			.where(and(eq(ventureRepos.ventureId, scope.ventureId), isNull(ventureRepos.removedAt)));

		const lowered = ref.trim().toLowerCase();

		const repo = repos.find((candidate) => candidate.id === ref || candidate.fullName.toLowerCase() === lowered);

		if (repo === undefined) {
			throw new AppError(
				"not_found",
				`No repo ${ref} on this venture; its repos are: ${repos.map((r) => r.fullName).join(", ") || "none"}`,
				{
					repo: ref,
				},
			);
		}

		return repo;
	}

	async function threadPullRequest(repo: RepoRow) {
		const [pr] = await scope.db
			.select()
			.from(pullRequests)
			.where(and(eq(pullRequests.threadId, scope.threadId), eq(pullRequests.repoId, repo.id)))
			.orderBy(desc(pullRequests.createdAt))
			.limit(1);

		if (pr === undefined) {
			throw new AppError("not_found", `This thread has no pull request on ${repo.fullName}`, {
				repo: repo.fullName,
			});
		}

		return pr;
	}

	const commandFor = (name: CommandName, repoRef: string, extra: Record<string, unknown>) =>
		attempt(async () => {
			const repo = await findRepo(repoRef);

			return scope.command(name, {
				ventureId: scope.ventureId,
				threadId: scope.threadId,
				repoId: repo.id,
				...extra,
			});
		});

	return [
		defineTool({
			name: "checkout_repo",
			description: `Get this thread's own checkout of one of the venture's repos, on the branch braise/<thread>, made from the default branch the first time (later calls return the same checkout). Work there with read, write, edit and bash; commit with git as you go. ${toolPathNote}`,
			input: { repo: repoArg },
			execute: ({ repo }) =>
				attempt(async () => {
					const found = await findRepo(repo);

					const { checkout, created } = await scope.code.ensureCheckout(
						{ id: scope.threadId, title: scope.threadTitle },
						found.id,
					);

					return text({
						repo: found.fullName,
						dir: checkout.dir,
						branch: checkout.branch,
						baseSha: checkout.baseSha,
						defaultBranch: found.defaultBranch,
						created,
						hint: `Files are under ${checkout.dir}/. Run commands with bash, e.g. "cd ${checkout.dir} && git status".`,
					});
				}),
		}),
		defineTool({
			name: "read",
			description: `Read a text file with line numbers. At most ${maxReadLines} lines at a time; use offset (1-based line) and limit for more. ${toolPathNote}`,
			input: {
				file_path: z.string().min(1).max(1_000),
				offset: z.number().int().min(1).optional(),
				limit: z.number().int().min(1).max(maxReadLines).optional(),
			},
			execute: ({ file_path, offset, limit }) =>
				attempt(async () =>
					text(
						await readText(root, file_path, {
							...(offset === undefined ? {} : { offset }),
							...(limit === undefined ? {} : { limit }),
						}),
					),
				),
		}),
		defineTool({
			name: "write",
			description: `Create or overwrite a file with the given content; parent folders are created. Prefer edit for changes to an existing file. ${toolPathNote}`,
			input: { file_path: z.string().min(1).max(1_000), content: z.string().max(2_000_000) },
			execute: ({ file_path, content }) => attempt(async () => text(await writeText(root, file_path, content))),
		}),
		defineTool({
			name: "edit",
			description: `Replace old_string with new_string in a file. old_string must match exactly (including whitespace) and be unique in the file, unless replace_all is true. ${toolPathNote}`,
			input: {
				file_path: z.string().min(1).max(1_000),
				old_string: z.string().min(1),
				new_string: z.string(),
				replace_all: z.boolean().optional(),
			},
			execute: ({ file_path, old_string, new_string, replace_all }) =>
				attempt(async () =>
					text(
						await editText(root, file_path, {
							oldString: old_string,
							newString: new_string,
							replaceAll: replace_all ?? false,
						}),
					),
				),
		}),
		defineTool({
			name: "bash",
			description: `Run a bash command in a sandbox, starting in this thread's folder (cd into the checkout first). Each call is a fresh process. It can write only inside the thread's folder, has no access to GitHub or local services, and reaches only package registries, so install dependencies and run builds and tests here, and commit with git; push with push_branch or open_pull_request. Times out after ${defaultTimeoutMs / 1000}s unless timeout (ms, at most ${maxTimeoutMs / 1000}s) says otherwise. Output is capped.`,
			input: {
				command: z.string().min(1).max(20_000),
				timeout: z.number().int().min(1_000).max(maxTimeoutMs).optional(),
			},
			execute: ({ command, timeout }, signal) =>
				attempt(async () => {
					const domains = await scope.db
						.select({ allowedDomains: ventureRepos.allowedDomains })
						.from(ventureRepos)
						.where(and(eq(ventureRepos.ventureId, scope.ventureId), isNull(ventureRepos.removedAt)));

					const result = await runSandboxed(scope.code.config, {
						threadId: scope.threadId,
						command,
						timeoutMs: timeout ?? defaultTimeoutMs,
						signal: signal === undefined ? scope.signal : AbortSignal.any([signal, scope.signal]),
						allowedDomains: [...new Set(domains.flatMap((row) => row.allowedDomains))],
					});

					const status = result.timedOut
						? `Timed out after ${(timeout ?? defaultTimeoutMs) / 1000}s and was killed.`
						: result.aborted
							? "Stopped."
							: `Exit code ${result.exitCode ?? "none"}.`;

					return {
						text: result.output.trim() === "" ? status : `${result.output.trimEnd()}\n\n${status}`,
						isError: result.exitCode !== 0,
					};
				}),
		}),
		defineTool({
			name: "push_branch",
			description:
				"Push this thread's braise/… branch of a repo to GitHub (never force). Commit first. If the thread has an open pull request on the repo, the push updates it.",
			input: { repo: repoArg },
			execute: ({ repo }) => commandFor("repo.push", repo, {}),
		}),
		defineTool({
			name: "open_pull_request",
			description:
				"Push this thread's branch and open a pull request against the repo's default branch, authored by braise's GitHub App. The owner reviews and merges it on GitHub; you can't merge. One open pull request per repo per thread.",
			input: {
				repo: repoArg,
				title: z.string().min(1).max(200),
				body: z.string().max(20_000).optional().describe("What changed and why, and how it was tested"),
				draft: z.boolean().optional(),
			},
			execute: ({ repo, title, body, draft }) =>
				commandFor("pr.open", repo, { title, ...(body === undefined ? {} : { body }), draft: draft ?? false }),
		}),
		defineTool({
			name: "update_pull_request",
			description: "Change the title or description of this thread's open pull request on a repo.",
			input: {
				repo: repoArg,
				title: z.string().min(1).max(200).optional(),
				body: z.string().max(20_000).optional(),
			},
			execute: ({ repo, title, body }) =>
				attempt(async () => {
					const found = await findRepo(repo);

					const pr = await threadPullRequest(found);

					return scope.command("pr.update", {
						ventureId: scope.ventureId,
						pullRequestId: pr.id,
						...(title === undefined ? {} : { title }),
						...(body === undefined ? {} : { body }),
					});
				}),
		}),
		defineTool({
			name: "pull_request_status",
			description:
				"Read this thread's pull request on a repo as GitHub has it now: state (open, merged, closed), checks and statuses on its head commit, reviews, review comments and comments.",
			input: { repo: repoArg },
			execute: ({ repo }) =>
				attempt(async () => {
					const found = await findRepo(repo);

					return text(await scope.code.pullRequestStatus(await threadPullRequest(found), found));
				}),
		}),
	];
}
