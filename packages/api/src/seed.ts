import type { CommandResponse } from "@braise/core";
import type { Database } from "./db/client.ts";
import { handlers } from "./handlers.ts";
import { executeCommand, type Services } from "./pipeline.ts";

const actor = "owner";

const seedServices = {
	enqueueRun() {
		return Promise.reject(new Error("The seed does not start agent runs"));
	},
} satisfies Services;

function send(db: Database, name: string, key: string, payload: Record<string, unknown>, reason?: string) {
	return executeCommand(db, handlers, seedServices, {
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

	const preorders = await send(db, "goal.create", "goal-preorders", {
		ventureId,
		betId: bet.result.id,
		outcome: "Pre-orders cover a third of the morning bake",
		signal: "Weekly pre-orders ÷ loaves baked",
		horizon: null,
	});

	const waste = await send(db, "goal.create", "goal-waste", {
		ventureId,
		betId: null,
		outcome: "Unsold bread under 5% of the bake",
		signal: "Loaves left at closing ÷ loaves baked",
		horizon: null,
	});

	const page = await send(db, "work.create", "work-page", {
		ventureId,
		goalId: preorders.result.id,
		title: "One-screen pre-order page",
		function: "engineering",
		priority: "high",
	});

	const form = await send(db, "work.create", "work-form", {
		ventureId,
		parentId: page.result.id,
		title: "Order form with tomorrow's bake",
	});

	await send(db, "work.create", "work-form-sms", {
		ventureId,
		parentId: form.result.id,
		title: "Text a pickup reminder at 7am",
	});

	await send(db, "work.create", "work-flyers", {
		ventureId,
		goalId: preorders.result.id,
		title: "Flyers for the first 200 customers",
		function: "marketing",
	});

	const tally = await send(db, "work.create", "work-tally", {
		ventureId,
		goalId: waste.result.id,
		title: "Count leftover loaves at closing",
		function: "ops",
	});

	await send(db, "work.set_status", "work-tally-doing", {
		ventureId,
		workItemId: tally.result.id,
		status: "doing",
	});

	return created.result.venture;
}
