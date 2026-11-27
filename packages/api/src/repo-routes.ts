import { randomBytes } from "node:crypto";
import type { Hono } from "hono";
import { z } from "zod";
import { convertManifest, manifestPage, saveAppKey } from "./code/github.ts";
import type { Database } from "./db/client.ts";
import { AppError } from "./errors.ts";
import { handlers } from "./handlers.ts";
import { executeCommand, type Services } from "./pipeline.ts";
import { getGitHub, getReachableRepos, getThreadCode, getVentureRepos } from "./repo-queries.ts";

const stateLifetimeMs = 60 * 60 * 1000;

const connectQuery = z.object({
	org: z
		.string()
		.regex(/^[\w-]{1,39}$/u)
		.optional(),
	return: z.string().max(500).optional(),
});

const callbackQuery = z.object({ code: z.string().min(1).max(200), state: z.string().min(1).max(100) });

const installedQuery = z.object({
	installation_id: z.coerce.number().int().positive().optional(),
	setup_action: z.string().max(40).optional(),
	state: z.string().max(100).optional(),
});

function safeReturn(path: string | undefined) {
	return path?.startsWith("/") && !path.startsWith("//") ? path : "/";
}

function parse<Schema extends z.ZodType>(schema: Schema, query: Record<string, string>) {
	const parsed = schema.safeParse(query);

	if (!parsed.success) throw new AppError("validation_failed", "The query is not valid", { scope: "query" });

	return parsed.data;
}

export function registerCodeRoutes(app: Hono, { db, services }: { db: Database; services: Services }) {
	const { code } = services;
	const pending = new Map<string, { returnTo: string; at: number }>();

	const remember = (returnTo: string) => {
		const now = Date.now();

		for (const [key, entry] of pending) if (now - entry.at > stateLifetimeMs) pending.delete(key);

		const state = randomBytes(16).toString("hex");

		pending.set(state, { returnTo, at: now });

		return state;
	};

	const webUrl = (path: string, flag: string) => {
		const url = new URL(path, code.config.webUrl);

		url.searchParams.set("github", flag);

		return url.toString();
	};

	app.get("/github", async (c) => c.json(await getGitHub(code)));

	app.get("/github/repos", async (c) => c.json({ repos: await getReachableRepos(db, code) }));

	app.get("/ventures/:slug/repos", async (c) => c.json({ repos: await getVentureRepos(db, c.req.param("slug")) }));

	app.get("/threads/:id/code", async (c) => {
		const id = z.uuid().safeParse(c.req.param("id"));

		if (!id.success) throw new AppError("not_found", "Thread not found", { threadId: c.req.param("id") });

		return c.json(await getThreadCode(db, code, id.data));
	});

	app.get("/github/connect", (c) => {
		const query = parse(connectQuery, c.req.query());
		const state = remember(safeReturn(query.return));

		return c.html(manifestPage(code.config, { state, org: query.org ?? null }));
	});

	app.get("/github/callback", async (c) => {
		const query = parse(callbackQuery, c.req.query());
		const entry = pending.get(query.state);

		if (entry === undefined) {
			throw new AppError(
				"validation_failed",
				"This GitHub connection was not started here, or it expired; start again",
				{
					scope: "query",
				},
			);
		}

		const converted = await convertManifest(code.config, query.code);

		await saveAppKey(code.config, converted.pem);

		await executeCommand(db, handlers, services, {
			name: "github.connect",
			actor: "owner",
			body: {
				payload: {
					appId: converted.id,
					slug: converted.slug,
					ownerLogin: converted.owner.login,
					htmlUrl: converted.html_url,
				},
				idempotencyKey: `github.connect:${converted.id}`,
			},
		});

		return c.redirect(
			`${code.config.githubWeb}/apps/${encodeURIComponent(converted.slug)}/installations/new?state=${query.state}`,
		);
	});

	app.get("/github/installed", (c) => {
		const query = parse(installedQuery, c.req.query());
		const entry = query.state === undefined ? undefined : pending.get(query.state);

		if (query.state !== undefined) pending.delete(query.state);

		return c.redirect(
			webUrl(entry?.returnTo ?? "/", query.installation_id === undefined ? "connected" : "installed"),
		);
	});
}
