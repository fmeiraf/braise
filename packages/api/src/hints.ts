import type { RunDelta, StreamHint, ThreadHint } from "@braise/core";
import pg from "pg";
import { z } from "zod";
import { deltaChannel, notifyChannel, runControlChannel, threadChannel } from "./channels.ts";

export type HubMessage =
	| ({ type: "hint" } & StreamHint)
	| ({ type: "thread" } & ThreadHint)
	| ({ type: "delta" } & RunDelta)
	| { type: "control"; runId: string }
	| { type: "reset" };

const threadHint = z.object({ threadId: z.uuid(), ventureId: z.uuid().nullable() });

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
		case runControlChannel:
			return z.uuid().safeParse(payload).success ? ({ type: "control", runId: payload } satisfies HubMessage) : null;
		default:
			return null;
	}
}

type Listener = (message: HubMessage) => void;

const reconnectDelayMs = 1_000;

export function parseNotification(payload: string) {
	const [ventureId, seq] = payload.split(":");
	const parsedSeq = Number(seq);

	if (ventureId === undefined || ventureId === "" || !Number.isSafeInteger(parsedSeq)) return null;

	return { ventureId, seq: parsedSeq } satisfies StreamHint;
}

export function createHintHub(connectionString: string) {
	const listeners = new Set<Listener>();
	let client: pg.Client | null = null;
	let closed = false;
	let reconnectTimer: NodeJS.Timeout | null = null;

	const broadcast = (message: HubMessage) => {
		for (const listener of listeners) listener(message);
	};

	const scheduleReconnect = () => {
		if (closed || reconnectTimer !== null) return;

		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;

			connect().then(
				() => broadcast({ type: "reset" }),
				(error: unknown) => {
					console.error("hint stream: reconnect failed", error);

					scheduleReconnect();
				},
			);
		}, reconnectDelayMs);
	};

	const connect = async () => {
		const next = new pg.Client({ connectionString });

		next.on("notification", (message) => {
			const parsed = message.payload === undefined ? null : parseHubMessage(message.channel, message.payload);

			if (parsed === null) {
				console.error("hint stream: ignored malformed notification", message.channel, message.payload);

				return;
			}

			broadcast(parsed);
		});

		next.on("error", (error) => {
			console.error("hint stream: LISTEN connection failed", error);
		});

		next.on("end", () => {
			if (client === next) client = null;

			scheduleReconnect();
		});

		await next.connect();

		for (const channel of [notifyChannel, threadChannel, deltaChannel, runControlChannel]) {
			await next.query(`LISTEN ${channel}`);
		}

		client = next;
	};

	return {
		start: connect,
		subscribe(listener: Listener) {
			listeners.add(listener);

			return () => listeners.delete(listener);
		},
		async close() {
			closed = true;

			if (reconnectTimer !== null) clearTimeout(reconnectTimer);

			listeners.clear();

			await client?.end();
		},
	};
}

export type HintHub = ReturnType<typeof createHintHub>;
