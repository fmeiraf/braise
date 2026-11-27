import type { ThreadLinkType } from "@braise/core";
import { Effect, Stream } from "effect";
import { Hono } from "hono";
import { z } from "zod";
import { getAgents } from "./access-queries.ts";
import type { Database } from "./db/client.ts";
import { AppError } from "./errors.ts";
import { handlers } from "./handlers.ts";
import type { HintHubShape, HubMessage } from "./hints.ts";
import { executeCommand, type Services } from "./pipeline.ts";
import { getInbox, getProposal } from "./proposal-queries.ts";
import {
	getCockpit,
	getEvents,
	getHoldingWork,
	getRecentEvents,
	getStrategyVersions,
	getVentureWork,
	listVentures,
} from "./queries.ts";
import { registerCodeRoutes } from "./repo-routes.ts";
import { getCapacity, getSpace, listSpaces } from "./space-queries.ts";
import { getActiveRuns, getLinkTargets, getThread, listThreads } from "./thread-queries.ts";

const actor = "owner";

const heartbeat = "15 seconds";

const versionQuery = z.object({ version: z.coerce.number().int().positive().optional() });

const eventsQuery = z.object({
	before: z.coerce.number().int().positive().optional(),
	limit: z.coerce.number().int().min(1).max(200).default(50),
});

const spacesQuery = z.object({ ventureId: z.uuid().optional() });

const threadsQuery = z.object({
	ventureId: z.uuid().optional(),
	space: z.union([z.literal("none"), z.uuid()]).optional(),
	subject: z
		.string()
		.regex(/^(work_item|bet|assumption|objective|venture):[0-9a-f-]{36}$/u)
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

const encoder = new TextEncoder();

const sseHeaders = {
	"Transfer-Encoding": "chunked",
	"Content-Type": "text/event-stream",
	"Cache-Control": "no-cache",
	Connection: "keep-alive",
};

function frame(event: string, data: unknown) {
	return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sseResponse(hub: HintHubShape, toFrame: (message: HubMessage) => Uint8Array | null) {
	const frames = Stream.unwrap(
		Effect.map(hub.subscribe, (subscription) =>
			Stream.make(frame("ready", {})).pipe(
				Stream.concat(
					Stream.merge(
						Stream.fromSubscription(subscription).pipe(
							Stream.map(toFrame),
							Stream.filter((bytes) => bytes !== null),
						),
						Stream.tick(heartbeat).pipe(
							Stream.drop(1),
							Stream.map(() => frame("ping", {})),
						),
					),
				),
			),
		),
	);

	return new Response(Stream.toReadableStream(frames), { headers: sseHeaders });
}

export function createApp({ db, hub, services }: { db: Database; hub: HintHubShape; services: Services }) {
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
		const { ventureId, subject, space } = parseQuery(threadsQuery, c.req.query());

		return c.json({
			threads: await listThreads(db, {
				ventureId: ventureId ?? null,
				subject: parseSubject(subject),
				space: space ?? null,
			}),
		});
	});

	app.get("/spaces", async (c) => {
		const { ventureId } = parseQuery(spacesQuery, c.req.query());

		return c.json({ spaces: await listSpaces(db, { ventureId: ventureId ?? null }) });
	});

	app.get("/spaces/:id", async (c) => {
		const id = z.uuid().safeParse(c.req.param("id"));

		if (!id.success) throw new AppError("not_found", "Space not found", { spaceId: c.req.param("id") });

		return c.json(await getSpace(db, id.data));
	});

	app.get("/capacity", async (c) => c.json(await getCapacity(db)));

	app.get("/threads/:id", async (c) => {
		const id = z.uuid().safeParse(c.req.param("id"));

		if (!id.success) throw new AppError("not_found", "Thread not found", { threadId: c.req.param("id") });

		return c.json(await getThread(db, id.data));
	});

	app.get("/inbox", async (c) => c.json(await getInbox(db)));

	app.get("/agents", async (c) => c.json({ agents: await getAgents(db) }));

	app.get("/proposals/:id", async (c) => {
		const id = z.uuid().safeParse(c.req.param("id"));

		if (!id.success) throw new AppError("not_found", "Proposal not found", { proposalId: c.req.param("id") });

		return c.json(await getProposal(db, id.data));
	});

	registerCodeRoutes(app, { db, services });

	app.get("/runs/active", async (c) => c.json({ runs: await getActiveRuns(db) }));

	app.get("/link-targets", async (c) => {
		const { q, ventureId } = parseQuery(linkTargetsQuery, c.req.query());

		return c.json({ targets: await getLinkTargets(db, { query: q, ventureId: ventureId ?? null }) });
	});

	app.get("/threads/:id/stream", (c) => {
		const threadId = c.req.param("id");

		return sseResponse(hub, (message) => {
			if (message.type === "reset") return frame("reset", {});

			if (message.type === "thread" && message.threadId === threadId) {
				return frame("hint", { threadId: message.threadId, ventureId: message.ventureId });
			}

			if (message.type === "delta" && message.threadId === threadId) {
				const { type: _type, ...delta } = message;

				return frame("delta", delta);
			}

			return null;
		});
	});

	app.get("/stream", () =>
		sseResponse(hub, (message) => {
			if (message.type === "hint") return frame("hint", { ventureId: message.ventureId, seq: message.seq });

			if (message.type === "thread")
				return frame("thread", { threadId: message.threadId, ventureId: message.ventureId });

			if (message.type === "access") return frame("access", {});

			if (message.type === "capacity") return frame("capacity", {});

			if (message.type === "code")
				return frame("code", { ventureId: message.ventureId, threadId: message.threadId });

			if (message.type === "reset") return frame("reset", {});

			return null;
		}),
	);

	return app;
}
