import type { Cockpit, DomainEvent, StrategyVersion } from "@braise/core";
import { afterAll, describe, expect, it } from "vitest";
import { freshKey, openTestDatabase } from "./database.test-utils.ts";

const database = await openTestDatabase();

afterAll(() => database.close());

async function json<Body>(response: Response | Promise<Response>) {
	const resolved = await response;

	return { status: resolved.status, body: (await resolved.json()) as Body };
}

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, marker: string) {
	const decoder = new TextDecoder();
	let received = "";

	while (!received.includes(marker)) {
		const chunk = await reader.read();

		if (chunk.done) throw new Error(`Stream ended before ${marker}: ${received}`);

		received += decoder.decode(chunk.value, { stream: true });
	}

	return received;
}

describe("slice 1 demo scenario over HTTP", () => {
	it("creates, revises, sets an objective, notes assumptions, edits, dedupes and keeps history", async () => {
		const name = `Demo ${crypto.randomUUID().slice(0, 8)}`;

		const created = await json<{ result: Cockpit; seq: number }>(
			database.post("venture.create", {
				payload: { name, kind: "non_profit", why: "People need this", what: "A small service" },
				idempotencyKey: freshKey("demo"),
			}),
		);

		expect(created.status).toBe(200);
		expect(created.body.seq).toBe(1);

		const { slug, id: ventureId } = created.body.result.venture;

		const revisionPayload = {
			ventureId,
			why: "People need this now",
			what: "A small service",
			diagnosis: "Nobody serves them",
			guidingPolicy: "",
		};

		const missingReason = await json<{ error: { code: string } }>(
			database.post("strategy.revise", { payload: revisionPayload, idempotencyKey: freshKey() }),
		);

		expect(missingReason).toMatchObject({ status: 400, body: { error: { code: "validation_failed" } } });

		const revised = await json<{ result: StrategyVersion }>(
			database.post("strategy.revise", {
				payload: revisionPayload,
				reason: "Learned it is urgent",
				idempotencyKey: freshKey(),
			}),
		);

		expect(revised.body.result).toMatchObject({ version: 2, status: "active", reason: "Learned it is urgent" });

		const objective = await json<{ result: { id: string } }>(
			database.post("objective.create", {
				payload: {
					ventureId,
					kind: "learning",
					statement: "Will anyone pay for a pilot?",
					decision: "Whether to build the paid tier",
					doneRule: "Three pilots signed or ten refusals",
				},
				idempotencyKey: freshKey(),
			}),
		);

		const assumptionKey = freshKey("assumption");

		const assumed = {
			ventureId,
			objectiveId: objective.body.result.id,
			statement: "They will pay",
			impact: "high",
			function: "sales",
		};

		const tied = await json<{ result: { id: string }; seq: number }>(
			database.post("assumption.create", { payload: assumed, idempotencyKey: assumptionKey }),
		);

		const replayed = await json<{ result: { id: string }; seq: number }>(
			database.post("assumption.create", { payload: assumed, idempotencyKey: assumptionKey }),
		);

		expect(replayed).toEqual(tied);

		const conflict = await json<{ error: { code: string } }>(
			database.post("assumption.create", {
				payload: { ...assumed, statement: "They will pay a lot" },
				idempotencyKey: assumptionKey,
			}),
		);

		expect(conflict).toMatchObject({ status: 409, body: { error: { code: "idempotency_conflict" } } });

		await database.post("assumption.create", {
			payload: { ventureId, objectiveId: null, statement: "Word of mouth carries it", function: "marketing" },
			idempotencyKey: freshKey(),
		});

		const edited = await json<{ result: { statement: string } }>(
			database.post("assumption.update", {
				payload: { ventureId, assumptionId: tied.body.result.id, statement: "Five of ten will pay" },
				idempotencyKey: freshKey(),
			}),
		);

		expect(edited.body.result.statement).toBe("Five of ten will pay");

		const cockpit = await json<Cockpit>(database.app.request(`/api/ventures/${slug}`));

		expect(cockpit.body.strategy.version).toBe(2);
		expect(cockpit.body.objectives).toHaveLength(1);

		expect(cockpit.body.assumptions.map((item) => [item.statement, item.objectiveId, item.confidence])).toEqual([
			["Five of ten will pay", objective.body.result.id, 1],
			["Word of mouth carries it", null, 1],
		]);

		const holding = await json<{
			ventures: { id: string; objective: string | null; openAssumptions: number; strategyVersion: number }[];
		}>(database.app.request("/api/ventures"));

		expect(holding.body.ventures.find((row) => row.id === ventureId)).toMatchObject({
			objective: "Will anyone pay for a pilot?",
			openBets: 0,
			openAssumptions: 1,
			strategyVersion: 2,
		});

		const history = await json<{ versions: StrategyVersion[] }>(
			database.app.request(`/api/ventures/${slug}/strategy/versions`),
		);

		expect(history.body.versions.map((version) => [version.version, version.status, version.reason])).toEqual([
			[2, "active", "Learned it is urgent"],
			[1, "superseded", null],
		]);

		const activity = await json<{ events: DomainEvent[] }>(database.app.request(`/api/ventures/${slug}/events`));

		expect(activity.body.events.map((event) => [event.seq, event.type, event.actor])).toEqual([
			[6, "assumption.updated", "owner"],
			[5, "assumption.created", "owner"],
			[4, "assumption.created", "owner"],
			[3, "objective.created", "owner"],
			[2, "strategy.revised", "owner"],
			[1, "venture.created", "owner"],
		]);

		expect(activity.body.events[0]?.payload).toMatchObject({
			changes: { statement: { from: "They will pay", to: "Five of ten will pay" } },
		});

		const recent = await json<{ events: (DomainEvent & { ventureSlug: string })[] }>(
			database.app.request("/api/events?limit=200"),
		);

		expect(recent.body.events.filter((event) => event.ventureSlug === slug).map((event) => event.seq)).toEqual([
			6, 5, 4, 3, 2, 1,
		]);

		const page = await json<{ events: DomainEvent[] }>(
			database.app.request(`/api/ventures/${slug}/events?before=3&limit=1`),
		);

		expect(page.body.events.map((event) => event.seq)).toEqual([2]);
	});

	it("streams a hint for each committed command", async () => {
		const response = await database.app.request("/api/stream");

		const reader = response.body?.getReader();

		if (reader === undefined) throw new Error("The stream has no body");

		await readUntil(reader, "event: ready");

		const created = await json<{ result: Cockpit; seq: number }>(
			database.post("venture.create", {
				payload: { name: `Live ${crypto.randomUUID().slice(0, 8)}`, kind: "for_profit", why: "W", what: "X" },
				idempotencyKey: freshKey("live"),
			}),
		);

		const hint = JSON.stringify({ ventureId: created.body.result.venture.id, seq: 1 });

		expect(await readUntil(reader, hint)).toContain(`event: hint\ndata: ${hint}`);

		await reader.cancel();
	});

	it("answers unknown ventures and commands with stable error codes", async () => {
		expect(await json(database.app.request("/api/ventures/does-not-exist"))).toMatchObject({
			status: 404,
			body: { error: { code: "not_found" } },
		});

		expect(await json(database.post("venture.explode", { payload: {}, idempotencyKey: freshKey() }))).toMatchObject({
			status: 404,
			body: { error: { code: "not_found" } },
		});
	});
});
