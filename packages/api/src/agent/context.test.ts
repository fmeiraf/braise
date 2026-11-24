import { describe, expect, it } from "vitest";
import { type RunContext, renderPrompt, renderSystemPrompt } from "./context.ts";

const base = {
	today: "2026-11-24",
	thread: { id: "thread-1", title: "Launch plan" },
	scope: null,
	ventures: [{ id: "v-1", slug: "corner-bakery", name: "Corner Bakery" }],
	links: [],
	transcript: [],
	message: "What should we do next?",
	pendingProposals: [],
} satisfies RunContext;

describe("renderSystemPrompt", () => {
	it("describes a Holding thread with its ventures and no links", () => {
		const prompt = renderSystemPrompt(base);

		expect(prompt).toContain("belongs to the Holding");

		expect(prompt).toContain("- Corner Bakery (id v-1)");

		expect(prompt).toContain("not linked to anything yet");

		expect(prompt).toContain("Today is 2026-11-24.");
	});

	it("includes the venture's active strategy and the links", () => {
		const prompt = renderSystemPrompt({
			...base,
			scope: {
				id: "v-1",
				slug: "corner-bakery",
				name: "Corner Bakery",
				strategy: { why: "Bread", what: "A bakery", diagnosis: "", guidingPolicy: "Local first" },
			},
			links: [
				{
					type: "work_item",
					id: "w-1",
					label: "Bake sourdough",
					ventureId: "v-1",
					ventureSlug: "corner-bakery",
					ventureName: "Corner Bakery",
					archived: false,
				},
			],
		});

		expect(prompt).toContain("venture Corner Bakery (id v-1)");

		expect(prompt).toContain("- Diagnosis: (none)\n- Guiding policy: Local first");

		expect(prompt).toContain('- work item "Bake sourdough" (id w-1, venture Corner Bakery)');
	});

	it("lists the thread's pending proposals", () => {
		expect(renderSystemPrompt(base)).toContain("No proposals from this thread are waiting");

		expect(
			renderSystemPrompt({ ...base, pendingProposals: [{ id: "p-1", title: "Loyalty card", changeCount: 3 }] }),
		).toContain('- "Loyalty card" (id p-1, 3 changes)');
	});
});

describe("renderPrompt", () => {
	it("sends a first message as it is", () => {
		expect(renderPrompt(base)).toBe("What should we do next?");
	});

	it("replays the transcript before the new message", () => {
		expect(
			renderPrompt({
				...base,
				transcript: [
					{ author: "owner", body: "Hi" },
					{ author: "agent:claude", body: "Hello" },
				],
			}),
		).toBe(
			"The conversation so far:\n\nOwner:\nHi\n\nYou (agent):\nHello\n\nThe owner's new message:\nWhat should we do next?",
		);
	});
});
