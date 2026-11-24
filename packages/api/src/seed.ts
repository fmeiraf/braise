import type { CommandResponse } from "@braise/core";
import type { Database } from "./db/client.ts";
import { handlers } from "./handlers.ts";
import { executeCommand } from "./pipeline.ts";

const actor = "owner";

function send(db: Database, name: string, key: string, payload: Record<string, unknown>, reason?: string) {
	return executeCommand(db, handlers, {
		name,
		body: { payload, idempotencyKey: `seed:example:${key}`, reason },
		actor,
	}) as Promise<CommandResponse<{ id: string } & Record<string, unknown>>>;
}

export async function seedExample(db: Database) {
	const created = (await send(db, "venture.create", "venture", {
		name: "Example: Corner Bakery",
		slug: "example-corner-bakery",
		kind: "for_profit",
		why: "Neighbourhoods deserve bread baked the same morning, within walking distance.",
		what: "A small bakery with a pre-order app, so nothing baked goes to waste.",
		diagnosis: "",
		guidingPolicy: "",
	})) as unknown as CommandResponse<{ venture: { id: string; slug: string } }>;

	const ventureId = created.result.venture.id;

	const bet = await send(db, "bet.create", "bet", {
		ventureId,
		hypothesis: "Regulars will pre-order the night before if it takes under a minute.",
		action: "Ship a one-screen pre-order page and hand flyers to the first 200 customers.",
		killCriteria: "Fewer than 30 pre-orders a week after four weeks.",
	});

	await send(db, "goal.create", "goal-preorders", {
		ventureId,
		betId: bet.result.id,
		outcome: "Pre-orders cover a third of the morning bake",
		signal: "Weekly pre-orders ÷ loaves baked",
		horizon: null,
	});

	await send(db, "goal.create", "goal-waste", {
		ventureId,
		betId: null,
		outcome: "Unsold bread under 5% of the bake",
		signal: "Loaves left at closing ÷ loaves baked",
		horizon: null,
	});

	return created.result.venture;
}
