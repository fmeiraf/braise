import { describe, expect, it } from "vitest";
import { isAgentActor, threadTitle } from "./commands.ts";

describe("threadTitle", () => {
	it("uses the first line of the message", () => {
		expect(threadTitle("  Plan the launch\nwith details below")).toBe("Plan the launch");
	});

	it("trims long first lines to 80 characters with an ellipsis", () => {
		const title = threadTitle("word ".repeat(40));

		expect([...title]).toHaveLength(80);

		expect(title.endsWith("…")).toBe(true);
	});

	it("counts code points, not UTF-16 units", () => {
		expect(threadTitle("🍞".repeat(80))).toBe("🍞".repeat(80));
	});
});

describe("isAgentActor", () => {
	it("tells agents from the owner", () => {
		expect(isAgentActor("agent:claude")).toBe(true);

		expect(isAgentActor("owner")).toBe(false);
	});
});
