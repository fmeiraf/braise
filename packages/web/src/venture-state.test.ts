import { describe, expect, it } from "vitest";
import { ventureTone } from "./venture-state.ts";

const bakery = { id: "v1", slug: "bakery" };
const other = { id: "v2", slug: "other" };

describe("ventureTone", () => {
	it("is null when nothing waits, runs or queues", () => {
		expect(ventureTone(bakery, { pending: [{ venture: other }, { venture: null }], runs: [] })).toBeNull();
	});

	it("puts waiting on the owner before a running agent", () => {
		expect(
			ventureTone(bakery, {
				pending: [{ venture: bakery }],
				runs: [{ ventureSlug: "bakery", status: "running" }],
			}),
		).toBe("needs");
	});

	it("puts a running agent before a queued run", () => {
		expect(
			ventureTone(bakery, {
				pending: [],
				runs: [
					{ ventureSlug: "bakery", status: "queued" },
					{ ventureSlug: "bakery", status: "running" },
				],
			}),
		).toBe("live");
	});

	it("shows a queued run of its own venture only", () => {
		const signals = { pending: [], runs: [{ ventureSlug: "other", status: "queued" as const }] };

		expect(ventureTone(bakery, signals)).toBeNull();
		expect(ventureTone(other, signals)).toBe("wait");
	});
});
