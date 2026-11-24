import { describe, expect, it } from "vitest";
import { ago } from "./time.ts";

const now = Date.parse("2026-11-24T12:00:00Z");

describe("ago", () => {
	it("says just now for the last few seconds", () => {
		expect(ago("2026-11-24T11:59:30Z", now)).toBe("just now");
	});

	it("uses the largest whole unit", () => {
		expect(ago("2026-11-22T12:00:00Z", now)).toBe("2d ago");
		expect(ago("2026-11-24T11:00:00Z", now)).toBe("1h ago");
	});
});
