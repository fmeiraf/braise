import { hueNameOf, pickOf } from "../marks.tsx";
import type { grounds, sprites } from "./sprites.ts";

export const archetypes = ["tower", "warehouse", "courtyard", "drum", "timber"] as const;

export type Archetype = (typeof archetypes)[number];

export type GridSize = keyof typeof grounds;

export type SpriteName = keyof typeof sprites;

/** The building a venture gets, picked from its slug. */
export function archetypeOf(slug: string) {
	return archetypes[pickOf(slug, "building", archetypes.length)] ?? archetypes[0];
}

export function spriteOf(slug: string) {
	return `${archetypeOf(slug)}-${hueNameOf(slug)}` satisfies SpriteName;
}

/** The smallest square city that fits every venture and leaves at least one lot free. */
export function gridFor(count: number) {
	if (count <= 8) return "3" as const;

	return count <= 15 ? ("4" as const) : ("5" as const);
}

/** Lots from the middle of the city outwards, so the first ventures stand in the centre. */
export function lotOrder(size: number) {
	const middle = (size - 1) / 2;
	const lots = Array.from({ length: size * size }, (_, index) => ({ i: Math.floor(index / size), j: index % size }));

	return lots.toSorted((a, b) => {
		const ring = Math.hypot(a.i - middle, a.j - middle) - Math.hypot(b.i - middle, b.j - middle);

		if (Math.abs(ring) > 1e-9) return ring;

		return Math.atan2(a.j - middle, a.i - middle) - Math.atan2(b.j - middle, b.i - middle);
	});
}

export type Plot =
	| { kind: "venture"; slug: string; sprite: SpriteName; i: number; j: number }
	| { kind: "park" | "pond"; sprite: "park" | "pond"; i: number; j: number };

/** One venture on a lot of its own, for its Overview. */
export function planOne(venture: { slug: string }) {
	const plot: Plot = { kind: "venture", slug: venture.slug, sprite: spriteOf(venture.slug), i: 0, j: 0 };

	return { grid: "1" as const, plots: [plot] };
}

/** Places ventures (oldest first) on the city's lots, fills the rest with parks and one pond, and lists everything back to front. */
export function plan(ventures: readonly { id: string; slug: string }[]) {
	const grid = gridFor(ventures.length);
	const size = Number(grid);
	const order = lotOrder(size);
	const placed = ventures.toSorted((a, b) => a.id.localeCompare(b.id)).slice(0, order.length - 1);

	const plots: Plot[] = order.map((lot, index) => {
		const venture = placed[index];

		if (venture !== undefined) return { kind: "venture", slug: venture.slug, sprite: spriteOf(venture.slug), ...lot };

		return index === order.length - 1
			? { kind: "pond", sprite: "pond", ...lot }
			: { kind: "park", sprite: "park", ...lot };
	});

	return { grid, plots: plots.toSorted((a, b) => a.i + a.j - (b.i + b.j) || a.i - b.i) };
}
