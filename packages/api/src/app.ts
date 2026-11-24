import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { Database } from "./db/client.ts";
import { AppError } from "./errors.ts";
import { handlers } from "./handlers.ts";
import type { HintHub } from "./hints.ts";
import { executeCommand } from "./pipeline.ts";
import { getCockpit, getEvents, getRecentEvents, getStrategyVersions, listVentures } from "./queries.ts";

const actor = "owner";

const heartbeatMs = 15_000;

const versionQuery = z.object({ version: z.coerce.number().int().positive().optional() });

const eventsQuery = z.object({
	before: z.coerce.number().int().positive().optional(),
	limit: z.coerce.number().int().min(1).max(200).default(50),
});

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

export function createApp({ db, hub }: { db: Database; hub: HintHub }) {
	const app = new Hono().basePath("/api");

	app.onError((error, c) => {
		if (error instanceof AppError) return c.json(error.toBody(), error.status);

		console.error(error);

		return c.json(new AppError("internal_error", "Something went wrong").toBody(), 500);
	});

	app.notFound((c) => c.json(new AppError("not_found", "No such endpoint").toBody(), 404));

	app.post("/commands/:name", async (c) => {
		const body = await readJson(c.req.raw);

		return c.json(await executeCommand(db, handlers, { name: c.req.param("name"), body, actor }));
	});

	app.get("/events", async (c) => {
		const { limit } = parseQuery(eventsQuery, c.req.query());

		return c.json(await getRecentEvents(db, limit));
	});

	app.get("/ventures", async (c) => c.json({ ventures: await listVentures(db) }));

	app.get("/ventures/:slug", async (c) => c.json(await getCockpit(db, c.req.param("slug"))));

	app.get("/ventures/:slug/strategy/versions", async (c) => {
		const { version } = parseQuery(versionQuery, c.req.query());

		return c.json(await getStrategyVersions(db, c.req.param("slug"), version ?? null));
	});

	app.get("/ventures/:slug/events", async (c) => {
		const { before, limit } = parseQuery(eventsQuery, c.req.query());

		return c.json(await getEvents(db, c.req.param("slug"), { before: before ?? null, limit }));
	});

	app.get("/stream", (c) =>
		streamSSE(c, async (stream) => {
			const closed = new Promise<void>((resolve) => {
				stream.onAbort(resolve);
			});

			const unsubscribe = hub.subscribe((message) => {
				const write =
					message.type === "hint"
						? stream.writeSSE({
								event: "hint",
								data: JSON.stringify({ ventureId: message.ventureId, seq: message.seq }),
							})
						: stream.writeSSE({ event: "reset", data: "{}" });

				write.catch((error: unknown) => console.error("hint stream: write failed", error));
			});

			await stream.writeSSE({ event: "ready", data: "{}" });

			const heartbeat = setInterval(() => {
				stream
					.writeSSE({ event: "ping", data: "{}" })
					.catch((error: unknown) => console.error("hint stream: ping failed", error));
			}, heartbeatMs);

			await closed;

			clearInterval(heartbeat);

			unsubscribe();
		}),
	);

	return app;
}
