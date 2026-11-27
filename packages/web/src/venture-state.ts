import type { RunStatus } from "@braise/core";
import type { VentureTone } from "./marks.tsx";

export interface VentureSignals {
	pending: readonly { venture: { id: string } | null }[];
	runs: readonly { ventureSlug: string | null; status: RunStatus }[];
}

/** A venture's state, by precedence: waiting on the owner, then an agent running, then a run queued; `null` when nothing is going on. */
export function ventureTone(venture: { id: string; slug: string }, signals: VentureSignals) {
	if (signals.pending.some((item) => item.venture?.id === venture.id)) return "needs" satisfies VentureTone;

	const runs = signals.runs.filter((run) => run.ventureSlug === venture.slug);

	if (runs.some((run) => run.status === "running")) return "live" satisfies VentureTone;

	return runs.some((run) => run.status === "queued") ? ("wait" satisfies VentureTone) : null;
}

export const toneWords = { needs: "needs you", live: "running", wait: "queued" } as const satisfies Record<
	VentureTone,
	string
>;
