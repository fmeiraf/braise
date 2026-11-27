import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activeRunStatuses, type RunError, type RunStatus, type RunUsage } from "@braise/core";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Cause, Effect, Exit, Fiber, FiberSet, Layer, Stream } from "effect";
import { capacityChannel, deltaChannel } from "../channels.ts";
import { Database, query, Tx, transaction } from "../db/effect.ts";
import { runEvents, runs } from "../db/schema.ts";
import { HintHub } from "../hints.ts";
import { notifyThread, type RunJob } from "../pipeline.ts";
import { appendMessage, lockThread, runJobOf } from "../thread-handlers.ts";
import { loadRunContext, renderPrompt, renderSystemPrompt } from "./context.ts";
import { makeDeltaPublisher } from "./deltas.ts";
import { liftPause, openPauseOf, recordLimit } from "./limits.ts";
import { Boss, concurrencyOf, liftQueue, queueOf, RunQueue, runtimeNamesInOrder, runtimeQueues } from "./queue.ts";
import { AgentReader } from "./reader.ts";
import { reportRunEnd } from "./reports.ts";
import { type AgentRuntime, type RunSignal, RuntimeError } from "./runtime.ts";
import { braiseTools } from "./tools.ts";

const interruptedMessage = "braise stopped while the agent was working";

const shutdownTimeout = "10 seconds";

type RunRow = typeof runs.$inferSelect;

type StopReason = "cancel" | "shutdown" | "input";

interface Outcome {
	status: RunStatus;
	usage: RunUsage | null;
	error: RunError | null;
}

function runError(message: string | null) {
	return message === null ? null : ({ message } satisfies RunError);
}

interface RunState {
	seq: number;
	thread: { id: string; ventureId: string | null };
	finished: Extract<RunSignal, { type: "finished" }> | null;
	partial: { block: number; text: string } | null;
	firstToken: boolean;
	limited: boolean;
	endAfterTool: boolean;
}

interface ActiveRun {
	fiber: Fiber.Fiber<void, unknown>;
	stop: { reason: StopReason | null };
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

const nextEventSeq = Effect.fn("nextEventSeq")(function* (runId: string) {
	const db = yield* Database;

	const [row] = yield* query(() =>
		db
			.select({ next: sql<number>`coalesce(max(${runEvents.seq}) + 1, 0)::int` })
			.from(runEvents)
			.where(eq(runEvents.runId, runId)),
	);

	return row?.next ?? 0;
});

export const finishRun = Effect.fn("finishRun")(function* (runId: string, outcome: Outcome) {
	const seq = yield* nextEventSeq(runId);
	const queue = yield* RunQueue;

	const jobs = yield* transaction(
		Effect.gen(function* () {
			const tx = yield* Tx;

			const [run] = yield* query(() => tx.select().from(runs).where(eq(runs.id, runId)));

			if (run === undefined) return [] as RunJob[];

			const thread = yield* query(() => lockThread(tx, run.threadId));

			yield* query(() =>
				tx
					.update(runs)
					.set({
						status: outcome.status,
						usage: outcome.usage === null ? null : { ...outcome.usage },
						error: outcome.error,
						finishedAt: sql`now()`,
					})
					.where(eq(runs.id, runId)),
			);

			yield* query(() =>
				tx.insert(runEvents).values({ runId, seq, type: "run.finished", payload: { status: outcome.status } }),
			);

			const texts = yield* query(() =>
				tx
					.select({ payload: runEvents.payload })
					.from(runEvents)
					.where(and(eq(runEvents.runId, runId), eq(runEvents.type, "message")))
					.orderBy(asc(runEvents.seq)),
			);

			const body = texts
				.map((row) => (typeof row.payload.text === "string" ? row.payload.text : ""))
				.filter((text) => text !== "")
				.join("\n\n");

			if (body !== "") yield* query(() => appendMessage(tx, thread, { author: run.actor, body, runId }));

			const queued = yield* query(() => reportRunEnd(tx, run, thread, outcome.status, outcome.error));

			yield* query(() => notifyThread(tx, thread));

			return queued;
		}),
	);

	for (const job of jobs) yield* query(() => queue.enqueueRun(job));
});

export const recoverRuns = Effect.fn("recoverRuns")(function* () {
	const db = yield* Database;
	const queue = yield* RunQueue;

	const interrupted = yield* query(() => db.select({ id: runs.id }).from(runs).where(eq(runs.status, "running")));

	for (const run of interrupted) {
		yield* finishRun(run.id, { status: "interrupted", usage: null, error: runError(interruptedMessage) });
	}

	const queued = yield* query(() => db.select().from(runs).where(eq(runs.status, "queued")));

	for (const run of queued) yield* query(async () => queue.enqueueRun(await runJobOf(db, run)));

	return { interrupted: interrupted.length, requeued: queued.length };
});

const cancelRequested = Effect.fn("cancelRequested")(function* (runId: string) {
	const db = yield* Database;

	const [row] = yield* query(() =>
		db.select({ cancelRequestedAt: runs.cancelRequestedAt }).from(runs).where(eq(runs.id, runId)),
	);

	return row?.cancelRequestedAt !== null && row?.cancelRequestedAt !== undefined;
});

const failRun = Effect.fn("failRun")(function* (
	runId: string,
	thread: { id: string; ventureId: string | null },
	message: string,
) {
	const db = yield* Database;

	yield* query(() =>
		db
			.update(runs)
			.set({ status: "failed", error: runError(message), finishedAt: sql`now()` })
			.where(and(eq(runs.id, runId), inArray(runs.status, [...activeRunStatuses]))),
	);

	yield* query(() => notifyThread(db, thread));
});

export const claimRun = Effect.fn("claimRun")(function* (runId: string) {
	const db = yield* Database;

	const [claimed] = yield* query(() =>
		db
			.update(runs)
			.set({ status: "running", startedAt: sql`now()` })
			.where(and(eq(runs.id, runId), eq(runs.status, "queued")))
			.returning(),
	);

	return claimed;
});

function limitOutcome(run: RunRow, usage: RunUsage | null) {
	const label = Object.hasOwn(runtimeQueues, run.runtime)
		? runtimeQueues[run.runtime as keyof typeof runtimeQueues].label
		: run.runtime;

	return {
		status: "interrupted",
		usage,
		error: { message: `${label} hit its subscription limit`, code: "limit" },
	} satisfies Outcome;
}

function outcomeOf(
	run: RunRow,
	stop: { reason: StopReason | null },
	exit: Exit.Exit<void, unknown>,
	state: { finished: Extract<RunSignal, { type: "finished" }> | null; limited: boolean },
) {
	const { finished } = state;
	const usage = finished?.usage ?? null;

	if (stop.reason === "cancel") return { status: "cancelled", usage, error: null } satisfies Outcome;

	if (stop.reason === "input") return { status: "succeeded", usage, error: null } satisfies Outcome;

	if (stop.reason === "shutdown") {
		return { status: "interrupted", usage, error: runError(interruptedMessage) } satisfies Outcome;
	}

	if (Exit.isFailure(exit)) {
		const error = Cause.squash(exit.cause);

		if (state.limited) return limitOutcome(run, null);

		console.error(`agent: run ${run.id} failed`, error);

		return { status: "failed", usage: null, error: runError(errorMessage(error)) } satisfies Outcome;
	}

	if (finished === null) {
		return state.limited
			? limitOutcome(run, null)
			: ({ status: "failed", usage: null, error: runError("The agent stopped without a result") } satisfies Outcome);
	}

	if (finished.status === "failed" && state.limited) return limitOutcome(run, usage);

	return { status: finished.status, usage, error: runError(finished.error) } satisfies Outcome;
}

const recordCheckpoints = Effect.fn("recordCheckpoints")(function* (
	run: RunRow,
	append: (type: string, payload: Record<string, unknown>) => Effect.Effect<void, unknown>,
) {
	const services = yield* RunQueue;

	const recorded = yield* query(() => services.code.checkpoint(run.threadId)).pipe(
		Effect.catch((error) =>
			Effect.sync(() => {
				console.error(`agent: recording run ${run.id}'s checkpoints failed`, error);

				return [];
			}),
		),
	);

	if (recorded.length > 0) yield* append("checkpoint", { checkouts: recorded });
});

export function agentWorkerLayer(runtimes: AgentRuntime[]) {
	return Layer.effectDiscard(
		Effect.gen(function* () {
			const db = yield* Database;
			const reader = yield* AgentReader;
			const services = yield* RunQueue;
			const boss = yield* Boss;
			const hub = yield* HintHub;
			const context = yield* Effect.context<Database | RunQueue>();
			const active = new Map<string, ActiveRun>();
			const jobs = yield* FiberSet.make<void, unknown>();
			const runJob = yield* FiberSet.runtimePromise(jobs)<Database | RunQueue>();
			let stopping = false;

			const agentWork = (
				run: RunRow,
				stop: { reason: StopReason | null },
				state: RunState,
				append: (type: string, payload: Record<string, unknown>) => Effect.Effect<void, unknown>,
			) =>
				Effect.gen(function* () {
					const workDir = yield* Effect.acquireRelease(
						Effect.promise(() => mkdtemp(join(tmpdir(), "braise-run-"))),
						(dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
					);

					const deltas = yield* makeDeltaPublisher((delta) =>
						query(() => db.execute(sql`SELECT pg_notify(${deltaChannel}, ${JSON.stringify(delta)})`)),
					);

					yield* Effect.addFinalizer(() => deltas.drained);

					const runContext = yield* query(() => loadRunContext(db, run, services));

					state.thread.ventureId = runContext.scope?.id ?? null;

					yield* append("run.started", { model: run.model, seenSeq: runContext.seenSeq });

					if (yield* cancelRequested(run.id)) {
						stop.reason = "cancel";

						return yield* Effect.interrupt;
					}

					const runtime = runtimes.find((candidate) => candidate.name === run.runtime);

					if (runtime === undefined) {
						return yield* new RuntimeError({ message: `braise has no runtime ${run.runtime}` });
					}

					const firstToken = Effect.suspend(() => {
						if (state.firstToken) return Effect.void;

						state.firstToken = true;

						return Effect.asVoid(
							query(() =>
								db
									.update(runs)
									.set({ firstTokenAt: sql`now()` })
									.where(and(eq(runs.id, run.id), isNull(runs.firstTokenAt))),
							),
						);
					});

					const onSignal = (signal: RunSignal) => {
						switch (signal.type) {
							case "limit":
								if (signal.reading.status === "rejected") state.limited = true;

								return Effect.asVoid(
									query(() =>
										recordLimit(db, services, {
											runtime: run.runtime,
											runId: run.id,
											reading: signal.reading,
										}),
									),
								);
							case "delta":
								state.partial =
									state.partial?.block === signal.block
										? { block: signal.block, text: state.partial.text + signal.text }
										: { block: signal.block, text: signal.text };

								return firstToken.pipe(
									Effect.andThen(deltas.push({ threadId: run.threadId, runId: run.id, ...signal })),
									Effect.asVoid,
								);
							case "message":
								state.partial = null;

								return firstToken.pipe(
									Effect.andThen(append("message", { block: signal.block, text: signal.text })),
								);
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
								}).pipe(
									Effect.andThen(
										Effect.sync(() => {
											if (!state.endAfterTool) return;

											stop.reason = "input";

											active.get(run.id)?.fiber.interruptUnsafe();
										}),
									),
								);
							case "finished":
								return Effect.sync(() => {
									state.finished = signal;
								});
						}
					};

					yield* runtime.run(
						{
							model: run.model,
							systemPrompt: renderSystemPrompt(runContext),
							prompt: renderPrompt(runContext),
							tools: braiseTools({
								db,
								reader,
								services,
								actor: run.actor,
								runId: run.id,
								rootRunId: runContext.rootRunId,
								threadId: run.threadId,
								chatOf:
									runContext.space?.role === "chat"
										? { spaceId: runContext.space.id, ventureId: runContext.space.ventureId }
										: null,
								operator:
									runContext.operator === null
										? null
										: { ventureId: runContext.operator.ventureId, slug: runContext.operator.slug },
								onInputRequested: () => {
									state.endAfterTool = true;
								},
							}),
							workDir,
						},
						onSignal,
					);
				}).pipe(Effect.scoped);

			const execute = Effect.fn("execute")(function* (run: RunRow) {
				const stop = { reason: null as StopReason | null };

				const state: RunState = {
					seq: 0,
					thread: { id: run.threadId, ventureId: null },
					finished: null,
					partial: null,
					firstToken: false,
					limited: false,
					endAfterTool: false,
				};

				const append = (type: string, payload: Record<string, unknown>) =>
					Effect.uninterruptible(
						Effect.gen(function* () {
							yield* query(() => db.insert(runEvents).values({ runId: run.id, seq: state.seq, type, payload }));

							state.seq += 1;

							yield* query(() => notifyThread(db, state.thread));
						}),
					);

				const fiber = yield* Effect.forkChild(agentWork(run, stop, state, append).pipe(Effect.provide(context)));

				active.set(run.id, { fiber, stop });

				if (stopping) {
					stop.reason = "shutdown";

					yield* Fiber.interrupt(fiber);
				}

				const exit = yield* Fiber.await(fiber);

				active.delete(run.id);

				const outcome = outcomeOf(run, stop, exit, state);

				const { partial } = state;

				yield* Effect.gen(function* () {
					if (stop.reason !== null && partial !== null && partial.text.trim() !== "") {
						yield* append("message", { block: partial.block, text: partial.text, partial: true });
					}

					yield* recordCheckpoints(run, append);

					yield* finishRun(run.id, outcome);
				}).pipe(
					Effect.catch((error) => {
						console.error(`agent: finishing run ${run.id} failed; marking it failed`, error);

						return failRun(run.id, state.thread, `braise could not save the run's end: ${errorMessage(error)}`);
					}),
				);
			});

			const claimAndExecute = Effect.fn("claimAndExecute")(function* (runId: string, runtime: string) {
				const pause = yield* query(() => openPauseOf(db, runtime));

				if (pause !== undefined) {
					yield* query(() => db.execute(sql`SELECT pg_notify(${capacityChannel}, ${runId})`));

					return;
				}

				const run = yield* claimRun(runId);

				if (run !== undefined) yield* execute(run);
			});

			const control = yield* hub.subscribe;

			yield* Stream.fromSubscription(control).pipe(
				Stream.runForEach((message) =>
					Effect.sync(() => {
						if (message.type !== "control") return;

						const entry = active.get(message.runId);

						if (entry === undefined) return;

						entry.stop.reason = "cancel";

						entry.fiber.interruptUnsafe();
					}),
				),
				Effect.forkScoped,
			);

			yield* Effect.addFinalizer(() =>
				Effect.gen(function* () {
					stopping = true;

					const running = [...active.values()];

					for (const entry of running) entry.stop.reason = "shutdown";

					yield* Effect.forEach(running, (entry) => Fiber.interrupt(entry.fiber), {
						concurrency: "unbounded",
						discard: true,
					});

					yield* FiberSet.awaitEmpty(jobs);
				}).pipe(
					Effect.timeout(shutdownTimeout),
					Effect.catch((error) => Effect.sync(() => console.error("agent: shutdown did not finish", error))),
				),
			);

			const recovered = yield* recoverRuns();

			if (recovered.interrupted > 0) console.log(`agent: marked ${recovered.interrupted} run(s) interrupted`);

			for (const runtime of runtimeNamesInOrder) {
				yield* query(() =>
					boss.work<{ runId: string }>(
						queueOf(runtime),
						{ localConcurrency: concurrencyOf(runtime), batchSize: 1 },
						async ([job]) => {
							if (job === undefined) return;

							await runJob(claimAndExecute(job.data.runId, runtime));
						},
					),
				);
			}

			yield* query(() =>
				boss.work<{ pauseId: string }>(liftQueue, { batchSize: 1 }, async ([job]) => {
					if (job === undefined) return;

					await liftPause(db, services, job.data.pauseId);
				}),
			);
		}),
	);
}
