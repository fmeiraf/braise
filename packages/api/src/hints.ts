import type { StreamHint } from "@braise/core";
import pg from "pg";
import { notifyChannel } from "./pipeline.ts";

export type HubMessage = ({ type: "hint" } & StreamHint) | { type: "reset" };

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
			const hint = message.payload === undefined ? null : parseNotification(message.payload);

			if (hint === null) {
				console.error("hint stream: ignored malformed notification", message.payload);

				return;
			}

			broadcast({ type: "hint", ...hint });
		});

		next.on("error", (error) => {
			console.error("hint stream: LISTEN connection failed", error);
		});

		next.on("end", () => {
			if (client === next) client = null;

			scheduleReconnect();
		});

		await next.connect();

		await next.query(`LISTEN ${notifyChannel}`);

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
