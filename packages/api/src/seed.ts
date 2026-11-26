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

	const objective = await send(db, "objective.create", "loop:objective", {
		ventureId,
		kind: "metric",
		statement: "Pre-orders cover a third of the morning bake",
		measure: "Pre-orders ÷ loaves baked",
		unit: "%",
		baseline: 8,
		target: 33,
		byDate: "2027-02-28",
		guardrails: "Unsold bread stays under 5% of the bake.",
		budget: "€400",
	});

	const objectiveId = objective.result.id;

	const assume = (key: string, statement: string, impact: string, fn: string) =>
		send(db, "assumption.create", `loop:assumption-${key}`, {
			ventureId,
			objectiveId,
			statement,
			impact,
			function: fn,
		});

	const minute = await assume(
		"minute",
		"Regulars will order the night before if it takes under a minute",
		"high",
		"product",
	);

	await assume("counter", "Regulars find out at the counter, not online", "high", "marketing");

	await assume("adds", "Pre-orders add to sales and do not replace walk-ins", "medium", "sales");

	const sizing = await assume("sizing", "The 5am bake can be sized from the order count", "medium", "ops");

	await send(db, "assumption.create", "loop:hunch-loyalty", {
		ventureId,
		objectiveId: null,
		statement: "A loyalty card keeps regulars when a competitor opens nearby",
		function: "marketing",
	});

	const sized = await send(db, "bet.create", "loop:bet-sizing", {
		ventureId,
		assumptionId: sizing.result.id,
		function: "ops",
		action: "Size one week's bake from the 9pm order count and write down the gap each morning.",
		signal: "Loaves short or left over per day",
		baseline: 22,
		passAt: 6,
		failAt: 15,
		method: "concierge",
		budget: "1 week",
		deadline: "2026-11-09",
	});

	await send(db, "reading.record", "loop:reading-sizing", {
		ventureId,
		subject: { type: "bet", id: sized.result.id },
		value: 4,
		takenOn: "2026-11-08",
		source: "Baker's morning notes, average of seven days",
	});

	await send(db, "bet.close", "loop:close-sizing", {
		ventureId,
		betId: sized.result.id,
		result: "pass",
		statement:
			"The 9pm count sizes the bake to within four loaves. Most orders arrive after 9pm, so the cutoff has to stay late.",
	});

	const bet = await send(db, "bet.create", "loop:bet-page", {
		ventureId,
		assumptionId: minute.result.id,
		function: "product",
		action: "Ship a one-screen pre-order page and hand flyers to the first 200 customers.",
		signal: "Pre-orders a week",
		baseline: 0,
		passAt: 30,
		failAt: 12,
		method: "before_after",
		budget: "€140, 4 weeks",
		deadline: "2026-12-07",
	});

	const betHome = { type: "bet", id: bet.result.id };

	for (const [day, value] of [
		["2026-11-09", 9],
		["2026-11-16", 14],
		["2026-11-23", 21],
	] as const) {
		await send(db, "reading.record", `loop:reading-page-${day}`, {
			ventureId,
			subject: betHome,
			value,
			takenOn: day,
			source: "Order sheet, Monday count",
		});
	}

	for (const [day, value] of [
		["2026-11-09", 12],
		["2026-11-16", 15],
		["2026-11-23", 19],
	] as const) {
		await send(db, "reading.record", `loop:reading-objective-${day}`, {
			ventureId,
			subject: { type: "objective", id: objectiveId },
			value,
			takenOn: day,
			source: "Order sheet ÷ bake log",
		});
	}

	const page = await send(db, "work.create", "loop:work-page", {
		ventureId,
		home: betHome,
		title: "One-screen pre-order page",
		function: "engineering",
		priority: "high",
	});

	const form = await send(db, "work.create", "loop:work-form", {
		ventureId,
		parentId: page.result.id,
		title: "Order form with tomorrow's bake",
	});

	await send(db, "work.create", "loop:work-form-sms", {
		ventureId,
		parentId: form.result.id,
		title: "Text a pickup reminder at 7am",
	});

	await send(db, "work.create", "loop:work-flyers", {
		ventureId,
		home: betHome,
		title: "Flyers for the first 200 customers",
		function: "marketing",
	});

	await send(db, "work.create", "loop:work-count", {
		ventureId,
		home: betHome,
		title: "Count pre-orders every Monday",
		function: "ops",
		priority: "high",
	});

	const build = await send(db, "objective.create", "loop:build", {
		ventureId,
		kind: "build",
		statement: "The baker's evening screen shows tomorrow's orders",
		doneList: [
			"Tomorrow's count is visible by 9pm",
			"An order can be marked collected",
			"It works on the shop tablet",
		],
		byDate: "2026-12-20",
	});

	await send(db, "work.create", "loop:work-screen", {
		ventureId,
		home: { type: "objective", id: build.result.id },
		title: "Evening count screen",
		function: "engineering",
	});

	const learning = await send(db, "objective.create", "loop:learning", {
		ventureId,
		kind: "learning",
		statement: "Would offices nearby order bread for the whole team?",
		decision: "Whether to add a weekly office delivery round",
		doneRule: "Eight office managers interviewed, or three ask to start",
		byDate: "2027-01-15",
		budget: "Two afternoons",
	});

	const offices = await send(db, "assumption.create", "loop:assumption-offices", {
		ventureId,
		objectiveId: learning.result.id,
		statement: "Office managers already buy breakfast for their teams at least weekly",
		impact: "high",
		function: "sales",
	});

	await send(db, "assumption.create", "loop:assumption-delivery", {
		ventureId,
		objectiveId: learning.result.id,
		statement: "One delivery round before 8am can serve five offices",
		impact: "medium",
		function: "ops",
	});

	const interviews = await send(db, "bet.create", "loop:bet-offices", {
		ventureId,
		assumptionId: offices.result.id,
		function: "sales",
		action: "Interview eight office managers within a ten-minute walk about how they buy breakfast.",
		signal: "Managers who buy team breakfast weekly",
		unit: "of 8",
		passAt: 5,
		failAt: 2,
		method: "interviews",
		budget: "Two afternoons",
		deadline: "2026-12-18",
	});

	await send(db, "work.create", "loop:work-interviews", {
		ventureId,
		home: { type: "bet", id: interviews.result.id },
		title: "Book and run the eight interviews",
		function: "sales",
	});

	const tally = await send(db, "work.create", "loop:work-tally", {
		ventureId,
		home: { type: "upkeep" },
		title: "Count leftover loaves at closing",
		function: "ops",
	});

	await send(db, "work.set_status", "loop:work-tally-doing", {
		ventureId,
		workItemId: tally.result.id,
		status: "doing",
	});

	return created.result.venture;
}
