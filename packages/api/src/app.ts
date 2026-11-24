import type { ThreadLinkType } from "@braise/core";
import { Hono } from "hono";
import type { SSEStreamingApi } from "hono/streaming";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { Database } from "./db/client.ts";
import { AppError } from "./errors.ts";
import { handlers } from "./handlers.ts";
import type { HintHub } from "./hints.ts";
import { executeCommand, type Services } from "./pipeline.ts";
import {
	getCockpit,
	getEvents,
	getHoldingWork,
	getRecentEvents,
	getStrategyVersions,
	getVentureWork,
	listVentures,
} from "./queries.ts";
import { getActiveRuns, getLinkTargets, getThread, listThreads } from "./thread-queries.ts";

const actor = "owner";

const heartbeatMs = 15_000;

const versionQuery = z.object({ version: z.coerce.number().int().positive().optional() });

const eventsQuery = z.object({
	before: z.coerce.number().int().positive().optional(),
	limit: z.coerce.number().int().min(1).max(200).default(50),
});

const threadsQuery = z.object({
	ventureId: z.uuid().optional(),
	subject: z
		.string()
		.regex(/^(work_item|goal|bet|venture):[0-9a-f-]{36}$/u)
		.optional(),
});

const linkTargetsQuery = z.object({
	q: z.string().max(200).default(""),
	ventureId: z.uuid().optional(),
});

function parseSubject(subject: string | undefined) {
	if (subject === undefined) return null;

	const [type, id] = subject.split(":") as [ThreadLinkType, string];

	return { type, id };
}

function sse(data: unknown) {
	return JSON.stringify(data);
}

function parseQuery<Schema extends z.ZodType>(schema: Schema, query: Record<string, string>) {
	const parsed = schema.safeParse(query);

	if (!parsed.success) {
		throw new AppError("validation_failed", "The query is not valid", {
			scope: "query",
			issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
		});
	}

	return parsed.data;
}

async function readJson(request: Request) {
	const text = await request.text();

	try {
		return JSON.parse(text) as unknown;
	} catch (error) {
		throw new AppError("validation_failed", "The body is not valid JSON", { scope: "body", cause: String(error) });
	}
}

function keepAlive(stream: SSEStreamingApi, label: string) {
	const heartbeat = setInterval(() => {
		stream
			.writeSSE({ event: "ping", data: "{}" })
			.catch((error: unknown) => console.error(`${label}: ping failed`, error));
	}, heartbeatMs);

	return () => clearInterval(heartbeat);
}

function write(stream: SSEStreamingApi, label: string, event: string, data: unknown) {
	stream
		.writeSSE({ event, data: sse(data) })
		.catch((error: unknown) => console.error(`${label}: write failed`, error));
}

export function createApp({ db, hub, services }: { db: Database; hub: HintHub; services: Services }) {
	const app = new Hono().basePath("/api");

	app.onError((error, c) => {
		if (error instanceof AppError) return c.json(error.toBody(), error.status);

		console.error(error);

		return c.json(new AppError("internal_error", "Something went wrong").toBody(), 500);
	});

	app.notFound((c) => c.json(new AppError("not_found", "No such endpoint").toBody(), 404));

	app.post("/commands/:name", async (c) => {
		const body = await readJson(c.req.raw);

		return c.json(await executeCommand(db, handlers, services, { name: c.req.param("name"), body, actor }));
	});

	app.get("/events", async (c) => {
		const { limit } = parseQuery(eventsQuery, c.req.query());

		return c.json(await getRecentEvents(db, limit));
	});

	app.get("/ventures", async (c) => c.json({ ventures: await listVentures(db) }));

	app.get("/ventures/:slug", async (c) => c.json(await getCockpit(db, c.req.param("slug"))));

	app.get("/work", async (c) => c.json(await getHoldingWork(db)));

	app.get("/ventures/:slug/work", async (c) => c.json(await getVentureWork(db, c.req.param("slug"))));

	app.get("/ventures/:slug/strategy/versions", async (c) => {
		const { version } = parseQuery(versionQuery, c.req.query());

		return c.json(await getStrategyVersions(db, c.req.param("slug"), version ?? null));
	});

	app.get("/ventures/:slug/events", async (c) => {
		const { before, limit } = parseQuery(eventsQuery, c.req.query());

		return c.json(await getEvents(db, c.req.param("slug"), { before: before ?? null, limit }));
	});

	app.get("/threads", async (c) => {
		const { ventureId, subject } = parseQuery(threadsQuery, c.req.query());

		return c.json({
			threads: await listThreads(db, { ventureId: ventureId ?? null, subject: parseSubject(subject) }),
		});
	});

	app.get("/threads/:id", async (c) => {
		const id = z.uuid().safeParse(c.req.param("id"));

		if (!id.success) throw new AppError("not_found", "Thread not found", { threadId: c.req.param("id") });

		return c.json(await getThread(db, id.data));
	});

	app.get("/runs/active", async (c) => c.json({ runs: await getActiveRuns(db) }));

	app.get("/link-targets", async (c) => {
		const { q, ventureId } = parseQuery(linkTargetsQuery, c.req.query());

		return c.json({ targets: await getLinkTargets(db, { query: q, ventureId: ventureId ?? null }) });
	});

	app.get("/threads/:id/stream", (c) => {
		const threadId = c.req.param("id");

		return streamSSE(c, async (stream) => {
			const label = "thread stream";

			const closed = new Promise<void>((resolve) => {
				stream.onAbort(resolve);
			});

			const unsubscribe = hub.subscribe((message) => {
				if (message.type === "reset") write(stream, label, "reset", {});

				if (message.type === "thread" && message.threadId === threadId) {
					write(stream, label, "hint", { threadId: message.threadId, ventureId: message.ventureId });
				}

				if (message.type === "delta" && message.threadId === threadId) {
					const { type: _type, ...delta } = message;

					write(stream, label, "delta", delta);
				}
			});

			await stream.writeSSE({ event: "ready", data: "{}" });

			const stop = keepAlive(stream, label);

			await closed;

			stop();

			unsubscribe();
		});
	});

	app.get("/stream", (c) =>
		streamSSE(c, async (stream) => {
			const label = "hint stream";

			const closed = new Promise<void>((resolve) => {
				stream.onAbort(resolve);
			});

			const unsubscribe = hub.subscribe((message) => {
				if (message.type === "hint")
					write(stream, label, "hint", { ventureId: message.ventureId, seq: message.seq });

				if (message.type === "thread") {
					write(stream, label, "thread", { threadId: message.threadId, ventureId: message.ventureId });
				}

				if (message.type === "reset") write(stream, label, "reset", {});
			});

			await stream.writeSSE({ event: "ready", data: "{}" });

			const stop = keepAlive(stream, label);

			await closed;

			stop();

			unsubscribe();
		}),
	);

	return app;
}
