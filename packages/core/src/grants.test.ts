import { describe, expect, it } from "vitest";
import { accessDecisionLine, attemptSummary, capabilityOf } from "./grants.ts";

describe("capabilityOf", () => {
	it("maps agent commands to their capability", () => {
		expect(capabilityOf("work.create")).toBe("work");
		expect(capabilityOf("reading.record")).toBe("work");
		expect(capabilityOf("thread.unlink")).toBe("links");
		expect(capabilityOf("proposal.create")).toBe("propose");
	});

	it("has no capability for owner-only commands", () => {
		expect(capabilityOf("proposal.approve")).toBeNull();
		expect(capabilityOf("work.archive")).toBeNull();
		expect(capabilityOf("bet.close")).toBeNull();
	});
});

describe("accessDecisionLine", () => {
	it("names the grant", () => {
		expect(accessDecisionLine({ status: "approved", capability: "work", agentName: "GPT", note: null })).toBe(
			"Granted Work and readings to GPT",
		);
	});

	it("adds the note to a denial", () => {
		expect(accessDecisionLine({ status: "denied", capability: "links", agentName: "GPT", note: "Not now" })).toBe(
			"Denied Thread links to GPT · Not now",
		);
	});
});

describe("attemptSummary", () => {
	it("quotes the title", () => {
		expect(attemptSummary("work.create", { title: "Print loyalty cards" })).toBe(
			"create work item “Print loyalty cards”",
		);
	});

	it("names a status change", () => {
		expect(attemptSummary("work.set_status", { status: "doing" })).toBe("set the status of work item to doing");
	});

	it("names a link type", () => {
		expect(attemptSummary("thread.link", { link: { type: "work_item", id: "x" } })).toBe(
			"link this thread to a work item",
		);
	});

	it("falls back to the command", () => {
		expect(attemptSummary("work.move", { index: 0 })).toBe("move work item");
	});
});

describe("the code capability", () => {
	it("covers pushing and pull requests, not repo management", () => {
		expect(capabilityOf("repo.push")).toBe("code");

		expect(capabilityOf("pr.open")).toBe("code");

		expect(capabilityOf("pr.update")).toBe("code");

		expect(capabilityOf("venture.add_repo")).toBeNull();

		expect(capabilityOf("venture.remove_repo")).toBeNull();
	});

	it("summarises an attempt to open a pull request", () => {
		expect(attemptSummary("pr.open", { title: "Add CONTRIBUTING.md" })).toBe(
			"open a pull request “Add CONTRIBUTING.md”",
		);
	});
});
