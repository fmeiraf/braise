import { describe, expect, it } from "vitest";
import { ago, dayLabel, shortDate } from "./time.ts";

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

describe("dayLabel", () => {
	const noon = new Date(2026, 10, 24, 12).getTime();

	it("names today and yesterday by the local calendar day", () => {
		expect(dayLabel(new Date(2026, 10, 24, 0, 5).toISOString(), noon)).toBe("Today");
		expect(dayLabel(new Date(2026, 10, 23, 23, 55).toISOString(), noon)).toBe("Yesterday");
	});

	it("gives older days a date, with the year only when it differs", () => {
		expect(dayLabel(new Date(2026, 10, 18, 9).toISOString(), noon)).toBe("Nov 18");
		expect(dayLabel(new Date(2025, 11, 31, 9).toISOString(), noon)).toBe("Dec 31, 2025");
	});
});

describe("shortDate", () => {
	it("drops the year for dates in the current year", () => {
		const noon = new Date(2026, 10, 24, 12).getTime();

		expect(shortDate("2026-12-19", noon)).toBe("Dec 19");
		expect(shortDate("2027-01-31", noon)).toBe("Jan 31, 2027");
	});
});
