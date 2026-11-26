import { describe, expect, it } from "vitest";
import { memberStateOf, reportLine } from "./spaces.ts";

describe("reportLine", () => {
	it("names the thread and its outcome", () => {
		expect(reportLine({ title: "Research Acme", outcome: "succeeded", detail: null })).toBe(
			"“Research Acme” finished",
		);
	});

	it("adds the question or the error", () => {
		expect(reportLine({ title: "Research Acme", outcome: "needs_input", detail: "Which tier?" })).toBe(
			"“Research Acme” needs you: Which tier?",
		);
	});
});

describe("memberStateOf", () => {
	it("puts a waiting question first", () => {
		expect(memberStateOf("succeeded", true)).toBe("needs_you");
	});

	it("follows the latest run otherwise", () => {
		expect(memberStateOf("running", false)).toBe("running");
		expect(memberStateOf("queued", false)).toBe("queued");
		expect(memberStateOf("interrupted", false)).toBe("done");
		expect(memberStateOf(null, false)).toBe("done");
	});
});
