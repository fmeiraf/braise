import type { Cockpit, DomainEvent, StrategyVersion } from "@braise/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshKey, openTestDatabase } from "./database.test-utils.ts";

const database = openTestDatabase();

beforeAll(() => database.hub.start());

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
	it("creates, revises, bets, sets goals, edits, dedupes and keeps history", async () => {
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

		const bet = await json<{ result: { id: string } }>(
			database.post("bet.create", {
				payload: { ventureId, hypothesis: "They will pay", action: "Offer a pilot", killCriteria: "No pilots" },
				idempotencyKey: freshKey(),
			}),
		);

		const goalKey = freshKey("goal");

		const tiedGoal = {
			ventureId,
			betId: bet.body.result.id,
			outcome: "Three pilots",
			signal: "Signed",
			horizon: null,
		};

		const tied = await json<{ result: { id: string }; seq: number }>(
			database.post("goal.create", { payload: tiedGoal, idempotencyKey: goalKey }),
		);

		const replayed = await json<{ result: { id: string }; seq: number }>(
			database.post("goal.create", { payload: tiedGoal, idempotencyKey: goalKey }),
		);

		expect(replayed).toEqual(tied);

		const conflict = await json<{ error: { code: string } }>(
			database.post("goal.create", { payload: { ...tiedGoal, outcome: "Four" }, idempotencyKey: goalKey }),
		);

		expect(conflict).toMatchObject({ status: 409, body: { error: { code: "idempotency_conflict" } } });

		await database.post("goal.create", {
			payload: { ventureId, betId: null, outcome: "Get known", signal: "Mentions", horizon: "2027-03-31" },
			idempotencyKey: freshKey(),
		});

		const edited = await json<{ result: { outcome: string } }>(
			database.post("goal.update", {
				payload: { ventureId, goalId: tied.body.result.id, outcome: "Five pilots" },
				idempotencyKey: freshKey(),
			}),
		);

		expect(edited.body.result.outcome).toBe("Five pilots");

		const cockpit = await json<Cockpit>(database.app.request(`/api/ventures/${slug}`));

		expect(cockpit.body.strategy.version).toBe(2);
		expect(cockpit.body.bets).toHaveLength(1);

		expect(cockpit.body.goals.map((goal) => [goal.outcome, goal.betId])).toEqual([
			["Five pilots", bet.body.result.id],
			["Get known", null],
		]);

		const holding = await json<{
			ventures: { id: string; openBets: number; goals: number; unlinkedGoals: number }[];
		}>(database.app.request("/api/ventures"));

		expect(holding.body.ventures.find((row) => row.id === ventureId)).toMatchObject({
			openBets: 1,
			goals: 2,
			unlinkedGoals: 1,
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
			[6, "goal.updated", "owner"],
			[5, "goal.created", "owner"],
			[4, "goal.created", "owner"],
			[3, "bet.created", "owner"],
			[2, "strategy.revised", "owner"],
			[1, "venture.created", "owner"],
		]);

		expect(activity.body.events[0]?.payload).toMatchObject({
			changes: { outcome: { from: "Three pilots", to: "Five pilots" } },
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
