import { z } from "zod";

const text = z.string().trim().min(1).max(10_000);
const longText = z.string().trim().max(10_000);
const id = z.uuid();
const isoDate = z.iso.date();

export const ventureKinds = ["for_profit", "non_profit"] as const;
export const betStatuses = ["open", "won", "lost", "killed"] as const;

export const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const ventureScoped = { ventureId: id };

export const commandSchemas = {
	"venture.create": z.strictObject({
		name: text.max(120),
		slug: z.string().regex(slugPattern).max(64).optional(),
		kind: z.enum(ventureKinds),
		why: text,
		what: text,
		diagnosis: longText.default(""),
		guidingPolicy: longText.default(""),
	}),
	"venture.archive": z.strictObject({ ...ventureScoped }),
	"strategy.revise": z.strictObject({
		...ventureScoped,
		why: text,
		what: text,
		diagnosis: longText,
		guidingPolicy: longText,
	}),
	"bet.create": z.strictObject({
		...ventureScoped,
		hypothesis: text,
		action: text,
		killCriteria: text,
	}),
	"bet.update": z
		.strictObject({
			...ventureScoped,
			betId: id,
			hypothesis: text.optional(),
			action: text.optional(),
			killCriteria: text.optional(),
		})
		.refine((value) => [value.hypothesis, value.action, value.killCriteria].some((field) => field !== undefined), {
			message: "Change at least one field",
		}),
	"bet.archive": z.strictObject({ ...ventureScoped, betId: id }),
	"bet.set_status": z.strictObject({
		...ventureScoped,
		betId: id,
		status: z.enum(["won", "lost", "killed"]),
		archiveGoals: z.boolean(),
	}),
	"goal.create": z.strictObject({
		...ventureScoped,
		betId: id.nullable(),
		outcome: text,
		signal: text,
		horizon: isoDate.nullable(),
	}),
	"goal.update": z
		.strictObject({
			...ventureScoped,
			goalId: id,
			betId: id.nullable().optional(),
			outcome: text.optional(),
			signal: text.optional(),
			horizon: isoDate.nullable().optional(),
		})
		.refine(
			(value) => [value.betId, value.outcome, value.signal, value.horizon].some((field) => field !== undefined),
			{ message: "Change at least one field" },
		),
	"goal.archive": z.strictObject({ ...ventureScoped, goalId: id }),
};

export type CommandName = keyof typeof commandSchemas;

export type CommandInput<Name extends CommandName> = z.input<(typeof commandSchemas)[Name]>;

export type CommandPayload<Name extends CommandName> = z.output<(typeof commandSchemas)[Name]>;

export const commandsRequiringReason = new Set<CommandName>(["strategy.revise"]);

export const commandEnvelope = z.strictObject({
	payload: z.unknown(),
	idempotencyKey: z.string().min(8).max(200),
	reason: z.string().trim().min(1).max(2_000).optional(),
});

export type CommandEnvelope = z.infer<typeof commandEnvelope>;

export function isCommandName(name: string): name is CommandName {
	return Object.hasOwn(commandSchemas, name);
}
