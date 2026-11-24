import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunDelta, RunStatus, RunUsage } from "@braise/core";
import { and, asc, eq, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { deltaChannel } from "../channels.ts";
import type { Database } from "../db/client.ts";
import { runEvents, runs } from "../db/schema.ts";
import type { HintHub } from "../hints.ts";
import { notifyThread, type Services } from "../pipeline.ts";
import { appendMessage, lockThread } from "../thread-handlers.ts";
import { loadRunContext, renderPrompt, renderSystemPrompt } from "./context.ts";
import { createDeltaPublisher } from "./deltas.ts";
import { runQueue } from "./queue.ts";
import type { AgentRuntime, RunSignal } from "./runtime.ts";
import { braiseTools } from "./tools.ts";

export const maxConcurrentRuns = 2;

const interruptedMessage = "braise stopped while the agent was working";

type RunRow = typeof runs.$inferSelect;

interface Outcome {
	status: RunStatus;
	usage: RunUsage | null;
	error: string | null;
}

async function nextEventSeq(db: Database, runId: string) {
	const [row] = await db
		.select({ next: sql<number>`coalesce(max(${runEvents.seq}) + 1, 0)::int` })
		.from(runEvents)
		.where(eq(runEvents.runId, runId));

	return row?.next ?? 0;
}

export async function finishRun(db: Database, runId: string, outcome: Outcome) {
	const seq = await nextEventSeq(db, runId);

	await db.transaction(async (tx) => {
		const [run] = await tx.select().from(runs).where(eq(runs.id, runId));

		if (run === undefined) return;

		const thread = await lockThread(tx, run.threadId);

		await tx
			.update(runs)
			.set({
				status: outcome.status,
				usage: outcome.usage === null ? null : { ...outcome.usage },
				error: outcome.error === null ? null : { message: outcome.error },
				finishedAt: sql`now()`,
			})
			.where(eq(runs.id, runId));

		await tx.insert(runEvents).values({ runId, seq, type: "run.finished", payload: { status: outcome.status } });

		const texts = await tx
			.select({ payload: runEvents.payload })
			.from(runEvents)
			.where(and(eq(runEvents.runId, runId), eq(runEvents.type, "message")))
			.orderBy(asc(runEvents.seq));

		const body = texts
			.map((row) => (typeof row.payload.text === "string" ? row.payload.text : ""))
			.filter((text) => text !== "")
			.join("\n\n");

		if (body !== "") await appendMessage(tx, thread, { author: run.actor, body, runId });

		await notifyThread(tx, thread);
	});
}

export async function recoverRuns(db: Database, services: Services) {
	const interrupted = await db.select({ id: runs.id }).from(runs).where(eq(runs.status, "running"));

	for (const run of interrupted) {
		await finishRun(db, run.id, { status: "interrupted", usage: null, error: interruptedMessage });
	}

	const queued = await db.select({ id: runs.id }).from(runs).where(eq(runs.status, "queued"));

	for (const run of queued) await services.enqueueRun(run.id);

	return { interrupted: interrupted.length, requeued: queued.length };
}

export async function claimRun(db: Database, runId: string) {
	const [claimed] = await db
		.update(runs)
		.set({ status: "running", startedAt: sql`now()` })
		.where(and(eq(runs.id, runId), eq(runs.status, "queued")))
		.returning();

	return claimed;
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

export function createAgentWorker(deps: {
	db: Database;
	hub: HintHub;
	boss: PgBoss;
	services: Services;
	runtime: AgentRuntime;
}) {
	const { db, hub, boss, services, runtime } = deps;
	const active = new Map<string, { controller: AbortController; reason: "cancel" | "shutdown" | null }>();

	const unsubscribe = hub.subscribe((message) => {
		if (message.type !== "control") return;

		const entry = active.get(message.runId);

		if (entry === undefined) return;

		entry.reason = "cancel";

		entry.controller.abort();
	});

	async function execute(run: RunRow) {
		const entry = { controller: new AbortController(), reason: null as "cancel" | "shutdown" | null };
		const thread = { id: run.threadId, ventureId: null as string | null };
		let seq = 0;

		const result: {
			finished: Extract<RunSignal, { type: "finished" }> | null;
			partial: { block: number; text: string } | null;
		} = { finished: null, partial: null };

		active.set(run.id, entry);

		const append = async (type: string, payload: Record<string, unknown>) => {
			await db.insert(runEvents).values({ runId: run.id, seq, type, payload });

			seq += 1;

			await notifyThread(db, thread);
		};

		const deltas = createDeltaPublisher(async (delta: RunDelta) => {
			await db.execute(sql`SELECT pg_notify(${deltaChannel}, ${JSON.stringify(delta)})`);
		});

		const workDir = await mkdtemp(join(tmpdir(), "braise-run-"));

		try {
			const context = await loadRunContext(db, run);

			thread.ventureId = context.scope?.id ?? null;

			await append("run.started", { model: run.model });

			await runtime.run(
				{
					model: run.model,
					systemPrompt: renderSystemPrompt(context),
					prompt: renderPrompt(context),
					tools: braiseTools({ db, services, actor: run.actor, runId: run.id, threadId: run.threadId }),
					workDir,
				},
				async (signal) => {
					switch (signal.type) {
						case "delta":
							result.partial =
								result.partial?.block === signal.block
									? { block: signal.block, text: result.partial.text + signal.text }
									: { block: signal.block, text: signal.text };

							deltas.push({ threadId: run.threadId, runId: run.id, ...signal });

							return;
						case "message":
							result.partial = null;

							return append("message", { block: signal.block, text: signal.text });
						case "tool.call":
							return append("tool.call", {
								toolUseId: signal.toolUseId,
								name: signal.name,
								input: signal.input,
							});
						case "tool.result":
							return append("tool.result", {
								toolUseId: signal.toolUseId,
								output: signal.output,
								isError: signal.isError,
							});
						case "finished":
							result.finished = signal;
					}
				},
				entry.controller.signal,
			);
		} catch (error) {
			if (!entry.controller.signal.aborted) {
				console.error(`agent: run ${run.id} failed`, error);

				result.finished = { type: "finished", status: "failed", usage: null, error: errorMessage(error) };
			}
		} finally {
			active.delete(run.id);

			await deltas.drained();

			await rm(workDir, { recursive: true, force: true });
		}

		const { finished, partial } = result;

		if (entry.controller.signal.aborted && partial !== null && partial.text.trim() !== "") {
			await append("message", { block: partial.block, text: partial.text, partial: true });
		}

		const outcome: Outcome =
			entry.reason === "cancel"
				? { status: "cancelled", usage: finished?.usage ?? null, error: null }
				: entry.reason === "shutdown"
					? { status: "interrupted", usage: finished?.usage ?? null, error: interruptedMessage }
					: (finished ?? { status: "failed", usage: null, error: "The agent stopped without a result" });

		await finishRun(db, run.id, outcome);
	}

	return {
		async start() {
			const recovered = await recoverRuns(db, services);

			if (recovered.interrupted > 0) console.log(`agent: marked ${recovered.interrupted} run(s) interrupted`);

			await boss.work<{ runId: string }>(
				runQueue,
				{ localConcurrency: maxConcurrentRuns, batchSize: 1 },
				async ([job]) => {
					if (job === undefined) return;

					const run = await claimRun(db, job.data.runId);

					if (run !== undefined) await execute(run);
				},
			);
		},
		async stop() {
			unsubscribe();

			for (const entry of active.values()) {
				entry.reason = "shutdown";

				entry.controller.abort();
			}

			await boss.stop({ graceful: true, timeout: 10_000 });
		},
	};
}

export type AgentWorker = ReturnType<typeof createAgentWorker>;
