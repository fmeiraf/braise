import { describe, expect, it } from "vitest";
import { archetypeOf, gridFor, lotOrder, plan } from "./layout.ts";

const ventures = (count: number) =>
	Array.from({ length: count }, (_, index) => ({
		id: `id-${String(index).padStart(3, "0")}`,
		slug: `venture-${index}`,
	}));

describe("gridFor", () => {
	it("grows the city so one lot always stays free", () => {
		expect(gridFor(1)).toBe("3");
		expect(gridFor(8)).toBe("3");
		expect(gridFor(9)).toBe("4");
		expect(gridFor(16)).toBe("5");
	});
});

describe("lotOrder", () => {
	it("starts in the middle and visits every lot once", () => {
		const order = lotOrder(3);

		expect(order[0]).toEqual({ i: 1, j: 1 });
		expect(new Set(order.map((lot) => `${lot.i}:${lot.j}`)).size).toBe(9);
	});
});

describe("plan", () => {
	it("gives every venture its own lot and the rest to parks and one pond", () => {
		const { grid, plots } = plan(ventures(3));
		const kinds = plots.map((plot) => plot.kind);

		expect(grid).toBe("3");
		expect(kinds.filter((kind) => kind === "venture")).toHaveLength(3);
		expect(kinds.filter((kind) => kind === "pond")).toHaveLength(1);
		expect(new Set(plots.map((plot) => `${plot.i}:${plot.j}`)).size).toBe(9);
	});

	it("keeps existing ventures where they stand when a newer one arrives", () => {
		const lotOf = (count: number, slug: string) => {
			const plot = plan(ventures(count)).plots.find(
				(candidate) => candidate.kind === "venture" && candidate.slug === slug,
			);

			return plot === undefined ? null : `${plot.i}:${plot.j}`;
		};

		expect(lotOf(4, "venture-0")).toBe(lotOf(3, "venture-0"));
		expect(lotOf(4, "venture-2")).toBe(lotOf(3, "venture-2"));
	});

	it("lists plots back to front", () => {
		const depths = plan(ventures(5)).plots.map((plot) => plot.i + plot.j);

		expect(depths).toEqual(depths.toSorted((a, b) => a - b));
	});

	it("picks the same building for a slug every time", () => {
		expect(archetypeOf("example-corner-bakery")).toBe(archetypeOf("example-corner-bakery"));
	});
});
