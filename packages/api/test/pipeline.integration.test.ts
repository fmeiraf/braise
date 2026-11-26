import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { notifyChannel } from "../src/channels.ts";
import { assumptions, commands, events } from "../src/db/schema.ts";
import { betPayload, createLoop, createVenture, freshKey, openTestDatabase, testUrl } from "./database.test-utils.ts";

const database = await openTestDatabase();

afterAll(() => database.close());

function hunchBody(ventureId: string, statement: string, idempotencyKey = freshKey("hunch")) {
	return {
		payload: { ventureId, objectiveId: null, statement, function: "product" },
		idempotencyKey,
	};
}

async function seqsOf(ventureId: string) {
	const rows = await database.db
		.select({ seq: events.seq })
		.from(events)
		.where(eq(events.ventureId, ventureId))
		.orderBy(events.seq);

	return rows.map((row) => row.seq);
}

describe("command pipeline", () => {
	it("assigns gapless, consecutive seqs to parallel commands on one venture", async () => {
		const venture = await createVenture(database);

		const count = 25;

		const responses = await Promise.all(
			Array.from({ length: count }, (_, index) =>
				database.command("assumption.create", hunchBody(venture.id, `Hunch ${index}`)),
			),
		);

		const expected = Array.from({ length: count + 1 }, (_, index) => index + 1);

		expect(responses.map((response) => response.seq).toSorted((a, b) => a - b)).toEqual(expected.slice(1));

		expect(await seqsOf(venture.id)).toEqual(expected);
	});

	it("applies concurrent duplicates of one idempotency key once and answers both alike", async () => {
		const venture = await createVenture(database);

		const body = hunchBody(venture.id, "Only once");

		const [first, second] = await Promise.all([
			database.command("assumption.create", body),
			database.command("assumption.create", body),
		]);

		expect(second).toEqual(first);

		const created = await database.db.select().from(assumptions).where(eq(assumptions.ventureId, venture.id));

		expect(created).toHaveLength(1);

		expect(await seqsOf(venture.id)).toEqual([1, 2]);
	});

	it("rejects a reused key with a different payload", async () => {
		const venture = await createVenture(database);

		const key = freshKey("reuse");

		await database.command("assumption.create", hunchBody(venture.id, "First", key));

		await expect(database.command("assumption.create", hunchBody(venture.id, "Second", key))).rejects.toMatchObject({
			code: "idempotency_conflict",
			status: 409,
		});
	});

	it("rolls back a rejected command completely, so its key can be retried", async () => {
		const venture = await createVenture(database);

		const other = await createLoop(database);

		const key = freshKey("rollback");

		await expect(
			database.command("bet.create", {
				payload: betPayload(venture.id, other.assumption.id),
				idempotencyKey: key,
			}),
		).rejects.toMatchObject({ code: "not_found", status: 404 });

		expect(await database.db.select().from(commands).where(eq(commands.idempotencyKey, key))).toEqual([]);

		expect(await seqsOf(venture.id)).toEqual([1]);

		const retried = await database.command("assumption.create", hunchBody(venture.id, "Retried", key));

		expect(retried.seq).toBe(2);
	});

	it("refuses to archive a bet that still has live work", async () => {
		const { ventureId, bet } = await createLoop(database);

		await database.command("work.create", {
			payload: { ventureId, home: { type: "bet", id: bet.id }, title: "Build it", function: "engineering" },
			idempotencyKey: freshKey(),
		});

		await expect(
			database.command("bet.archive", { payload: { ventureId, betId: bet.id }, idempotencyKey: freshKey() }),
		).rejects.toMatchObject({ code: "rule_violated", details: { rule: "bet_has_work" } });
	});

	it("rejects an invalid payload and a missing reason before touching the database", async () => {
		const venture = await createVenture(database);

		await expect(
			database.command("assumption.create", { payload: { ventureId: venture.id }, idempotencyKey: freshKey() }),
		).rejects.toMatchObject({ code: "validation_failed", status: 400 });

		await expect(
			database.command("strategy.revise", {
				payload: { ventureId: venture.id, why: "New why", what: "New what", diagnosis: "", guidingPolicy: "" },
				idempotencyKey: freshKey(),
			}),
		).rejects.toMatchObject({ code: "validation_failed", details: { issues: [{ path: "reason" }] } });

		expect(await seqsOf(venture.id)).toEqual([1]);
	});

	it("notifies only after commit, and never for a rolled-back command", async () => {
		const venture = await createVenture(database);

		const listener = new pg.Client({ connectionString: testUrl() });

		await listener.connect();

		await listener.query(`LISTEN ${notifyChannel}`);

		const observed: { payload: string; eventVisible: boolean }[] = [];

		const firstNotification = new Promise<void>((resolve, reject) => {
			listener.on("notification", (message) => {
				const [ventureId, seq] = (message.payload ?? "").split(":");

				if (ventureId !== venture.id) return;

				database.pool
					.query("SELECT 1 FROM events WHERE venture_id = $1 AND seq = $2", [ventureId, Number(seq)])
					.then((result) => {
						observed.push({ payload: message.payload ?? "", eventVisible: result.rowCount === 1 });

						resolve();
					}, reject);
			});
		});

		await expect(
			database.command("bet.update", {
				payload: { ventureId: venture.id, betId: crypto.randomUUID(), action: "Missing" },
				idempotencyKey: freshKey(),
			}),
		).rejects.toMatchObject({ code: "not_found" });

		const committed = await database.command("assumption.create", hunchBody(venture.id, "Visible"));

		await firstNotification;

		await listener.end();

		expect(observed).toEqual([{ payload: `${venture.id}:${committed.seq}`, eventVisible: true }]);
	});
});
