import type { DraftHint, RunDelta, StreamHint, ThreadHint } from "@braise/core";
import { Cause, Context, Deferred, Effect, Layer, PubSub, Schedule, type Scope } from "effect";
import pg from "pg";
import { z } from "zod";
import {
	accessChannel,
	capacityChannel,
	codeChannel,
	deltaChannel,
	draftChannel,
	notifyChannel,
	runControlChannel,
	threadChannel,
} from "./channels.ts";

export type HubMessage =
	| ({ type: "hint" } & StreamHint)
	| ({ type: "thread" } & ThreadHint)
	| ({ type: "delta" } & RunDelta)
	| { type: "control"; runId: string }
	| { type: "access" }
	| { type: "capacity"; heldRunId: string | null }
	| { type: "code"; ventureId: string; threadId: string | null }
	| ({ type: "draft" } & DraftHint)
	| { type: "reset" };

const reconnectDelay = "1 second";

const threadHint = z.object({ threadId: z.uuid(), ventureId: z.uuid().nullable() });

const codeHint = z.object({ ventureId: z.uuid(), threadId: z.uuid().nullable() });

const draftHint = z.object({
	ventureId: z.uuid(),
	version: z.number().int().min(0),
	changeId: z.uuid().nullable(),
	action: z.enum(["add", "revise", "remove", "keep", "drop", "discard"]),
});

const runDelta = z.object({
	threadId: z.uuid(),
	runId: z.uuid(),
	block: z.number().int().min(0),
	offset: z.number().int().min(0),
	text: z.string(),
});

function parseJson(payload: string) {
	try {
		return JSON.parse(payload) as unknown;
	} catch (error) {
		console.error("hint stream: notification is not JSON", payload, error);

		return null;
	}
}

export function parseHubMessage(channel: string, payload: string) {
	switch (channel) {
		case notifyChannel: {
			const hint = parseNotification(payload);

			return hint === null ? null : ({ type: "hint", ...hint } satisfies HubMessage);
		}
		case threadChannel: {
			const parsed = threadHint.safeParse(parseJson(payload));

			return parsed.success ? ({ type: "thread", ...parsed.data } satisfies HubMessage) : null;
		}
		case deltaChannel: {
			const parsed = runDelta.safeParse(parseJson(payload));

			return parsed.success ? ({ type: "delta", ...parsed.data } satisfies HubMessage) : null;
		}
		case accessChannel:
			return { type: "access" } satisfies HubMessage;
		case codeChannel: {
			const parsed = codeHint.safeParse(parseJson(payload));

			return parsed.success ? ({ type: "code", ...parsed.data } satisfies HubMessage) : null;
		}
		case draftChannel: {
			const parsed = draftHint.safeParse(parseJson(payload));

			return parsed.success ? ({ type: "draft", ...parsed.data } satisfies HubMessage) : null;
		}
		case capacityChannel:
			return {
				type: "capacity",
				heldRunId: z.uuid().safeParse(payload).success ? payload : null,
			} satisfies HubMessage;
		case runControlChannel:
			return z.uuid().safeParse(payload).success ? ({ type: "control", runId: payload } satisfies HubMessage) : null;
		default:
			return null;
	}
}

export function parseNotification(payload: string) {
	const [ventureId, seq] = payload.split(":");
	const parsedSeq = Number(seq);

	if (ventureId === undefined || ventureId === "" || !Number.isSafeInteger(parsedSeq)) return null;

	return { ventureId, seq: parsedSeq } satisfies StreamHint;
}

const channels = [
	notifyChannel,
	threadChannel,
	deltaChannel,
	runControlChannel,
	accessChannel,
	capacityChannel,
	codeChannel,
	draftChannel,
];

function listen(connectionString: string, pubsub: PubSub.PubSub<HubMessage>, ended: Deferred.Deferred<void>) {
	return Effect.promise(async () => {
		const client = new pg.Client({ connectionString });

		client.on("notification", (message) => {
			const parsed = message.payload === undefined ? null : parseHubMessage(message.channel, message.payload);

			if (parsed === null) {
				console.error("hint stream: ignored malformed notification", message.channel, message.payload);

				return;
			}

			PubSub.publishUnsafe(pubsub, parsed);
		});

		client.on("error", (error) => {
			console.error("hint stream: LISTEN connection failed", error);
		});

		client.on("end", () => {
			Deferred.doneUnsafe(ended, Effect.void);
		});

		await client.connect();

		for (const channel of channels) await client.query(`LISTEN ${channel}`);

		return client;
	});
}

export interface HintHubShape {
	readonly subscribe: Effect.Effect<PubSub.Subscription<HubMessage>, never, Scope.Scope>;
}

export class HintHub extends Context.Service<HintHub, HintHubShape>()("braise/HintHub") {
	static layer(connectionString: string) {
		return Layer.effect(
			HintHub,
			Effect.gen(function* () {
				const pubsub = yield* Effect.acquireRelease(PubSub.unbounded<HubMessage>(), PubSub.shutdown);
				const connected = yield* Deferred.make<void, never>();

				const session = Effect.scoped(
					Effect.gen(function* () {
						const ended = yield* Deferred.make<void>();

						yield* Effect.acquireRelease(listen(connectionString, pubsub, ended), (client) =>
							Effect.promise(() => client.end()),
						);

						const first = yield* Deferred.succeed(connected, undefined);

						if (!first) yield* PubSub.publish(pubsub, { type: "reset" });

						yield* Deferred.await(ended);
					}),
				);

				yield* session.pipe(
					Effect.onError((cause) => Deferred.failCause(connected, cause)),
					Effect.catchCause((cause) =>
						Effect.sync(() => console.error("hint stream: reconnect failed", Cause.pretty(cause))),
					),
					Effect.repeat(Schedule.spaced(reconnectDelay)),
					Effect.forkScoped,
				);

				yield* Deferred.await(connected);

				return { subscribe: PubSub.subscribe(pubsub) } satisfies HintHubShape;
			}),
		);
	}
}
