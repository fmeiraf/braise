import { describe, expect, it } from "vitest";
import { slugPattern } from "./commands.ts";
import { slugify } from "./slug.ts";

describe("slugify", () => {
	it("lowercases and joins words with hyphens", () => {
		expect(slugify("Braise Holding Co")).toBe("braise-holding-co");
	});

	it("drops accents and punctuation", () => {
		expect(slugify("  Café — São Paulo!  ")).toBe("cafe-sao-paulo");
	});

	it("produces slugs the command schema accepts", () => {
		expect(slugify(`${"A".repeat(70)} b`)).toMatch(slugPattern);
	});

	it("returns an empty string when nothing is usable", () => {
		expect(slugify("!!!")).toBe("");
	});
});
