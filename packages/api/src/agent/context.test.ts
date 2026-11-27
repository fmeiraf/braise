import { describe, expect, it } from "vitest";
import { type LoopState, type RunContext, renderLoop, renderPrompt, renderSystemPrompt } from "./context.ts";

const base = {
	today: "2026-11-24",
	agent: { name: "Claude", actor: "agent:claude", grants: ["work", "links", "propose"] },
	thread: { id: "thread-1", title: "Launch plan" },
	seenSeq: 0,
	rootRunId: "run-1",
	profiles: [
		{ id: "claude", name: "Claude", actor: "agent:claude", runtime: "claude-agent-sdk" },
		{ id: "gpt", name: "GPT", actor: "agent:gpt", runtime: "pi" },
	],
	space: null,
	reports: [],
	retry: null,
	trigger: { author: "owner" },
	scope: null,
	ventures: [{ id: "v-1", slug: "corner-bakery", name: "Corner Bakery" }],
	links: [],
	transcript: [],
	message: "What should we do next?",
	pendingProposals: [],
	code: null,
} satisfies RunContext;

const withCode = {
	...base,
	code: {
		repos: [{ id: "repo-1", fullName: "owner/bakery", defaultBranch: "main", status: "ready", error: null }],
		checkouts: [
			{
				dir: "bakery",
				fullName: "owner/bakery",
				branch: "braise/launch-plan-abc123",
				baseSha: "a".repeat(40),
				checkpointSha: "b".repeat(40),
			},
		],
		pullRequests: [
			{
				number: 7,
				fullName: "owner/bakery",
				url: "https://github.com/owner/bakery/pull/7",
				state: "open",
				title: "Add menu",
			},
		],
	},
} satisfies RunContext;

describe("renderSystemPrompt", () => {
	it("says a thread without repos has no code tools", () => {
		expect(renderSystemPrompt(base)).toContain("this thread has no code repos");
	});

	it("lists the venture's repos, the thread's checkouts and pull requests, and marks code as not granted", () => {
		const prompt = renderSystemPrompt(withCode);

		expect(prompt).toContain("- owner/bakery (id repo-1, default branch main, ready)");

		expect(prompt).toContain(
			"- bakery/: owner/bakery on braise/launch-plan-abc123, from aaaaaaaaaaaa, last run ended at bbbbbbbbbbbb",
		);

		expect(prompt).toContain('- owner/bakery#7 "Add menu" (open) https://github.com/owner/bakery/pull/7');
		expect(prompt).toContain("Push branches and open PRs (not granted)");
	});

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
				loop: { objectives: [], assumptions: [], bets: [], learnings: [] },
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

describe("permissions in the system prompt", () => {
	it("names the agent and lists every capability as granted", () => {
		const prompt = renderSystemPrompt(base);

		expect(prompt).toContain("You are Claude, the agent inside braise");

		expect(prompt).toContain("Granted now: Work and readings, Thread links, Proposals. Not granted: nothing.");

		expect(prompt).not.toContain("(not granted)");
	});

	it("marks what isn't granted and explains access requests", () => {
		const prompt = renderSystemPrompt({ ...base, agent: { name: "GPT", actor: "agent:gpt", grants: ["links"] } });

		expect(prompt).toContain("- Work and readings (not granted): create");

		expect(prompt).toContain("Granted now: Thread links. Not granted: Work and readings, Proposals.");

		expect(prompt).toContain("braise files an access request in the owner's inbox");
	});
});

describe("renderLoop", () => {
	const loop = {
		objectives: [
			{
				id: "o-1",
				kind: "metric",
				statement: "Pre-orders cover a third of the bake",
				measure: "Pre-orders ÷ bake",
				unit: "%",
				baseline: 8,
				target: 33,
				decision: null,
				doneRule: null,
				doneList: [],
				byDate: "2027-02-28",
				guardrails: "Unsold bread under 5%",
				budget: "",
				latest: 19,
			},
			{
				id: "o-2",
				kind: "build",
				statement: "Evening screen",
				measure: null,
				unit: "",
				baseline: null,
				target: null,
				decision: null,
				doneRule: null,
				doneList: [{ id: "d-1", text: "Count by 9pm", done: true }],
				byDate: "2026-12-20",
				guardrails: "",
				budget: "",
				latest: null,
			},
		],
		assumptions: [
			{
				id: "a-1",
				objectiveId: "o-1",
				statement: "Sized from the count",
				impact: "medium",
				confidence: 3,
				function: "ops",
				status: "open",
				createdAt: "2026-11-01",
			},
			{
				id: "a-2",
				objectiveId: "o-1",
				statement: "Order in under a minute",
				impact: "high",
				confidence: 1,
				function: "product",
				status: "open",
				createdAt: "2026-11-02",
			},
			{
				id: "a-3",
				objectiveId: null,
				statement: "A loyalty card keeps regulars",
				impact: "medium",
				confidence: 1,
				function: "marketing",
				status: "open",
				createdAt: "2026-11-03",
			},
		],
		bets: [
			{
				id: "b-1",
				assumptionId: "a-2",
				action: "Ship the page.",
				signal: "Pre-orders a week",
				unit: "",
				passAt: 30,
				failAt: 12,
				method: "before_after",
				deadline: "2026-12-07",
				latest: 21,
			},
		],
		learnings: [{ assumptionId: "a-1", result: "pass", cause: null, statement: "Orders arrive after 9pm." }],
	} satisfies LoopState;

	it("lists objectives with their readings and ranks assumptions by the next move", () => {
		const text = renderLoop("Corner Bakery", loop);

		expect(text).toContain(
			"baseline 8%, latest reading 19%, target 33% by 2027-02-28. Guardrails: Unsold bread under 5%.",
		);

		expect(text.indexOf("Order in under a minute")).toBeLessThan(text.indexOf("Sized from the count"));

		expect(text).toContain(
			"open bet (id b-1): Ship the page. Signal: Pre-orders a week; pass at 30, fail past 12; method before_after (can earn confidence 3); deadline 2026-12-07; latest reading 21.",
		);

		expect(text).toContain("learned (pass): Orders arrive after 9pm.");
	});

	it("shows a build objective's done list and the hunches kept for later", () => {
		const text = renderLoop("Corner Bakery", loop);

		expect(text).toContain("  - [x] Count by 9pm (item d-1)");

		expect(text).toContain(
			'Worth testing later (assumptions not yet under an objective):\n  - "A loyalty card keeps regulars" (id a-3)',
		);
	});

	it("asks for an objective when there is none", () => {
		expect(renderLoop("Corner Bakery", { objectives: [], assumptions: [], bets: [], learnings: [] })).toContain(
			"has no objective yet",
		);
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

const chatSpace = {
	id: "space-1",
	title: "Pricing page",
	goal: "Ship the pricing page",
	ventureId: "v-1",
	role: "chat",
	agentName: "Claude",
	wakesLeft: 3,
	members: [
		{
			threadId: "t-2",
			title: "Research Acme",
			agent: "GPT",
			state: "needs_you",
			latestRunId: "r-2",
			latestStatus: "succeeded",
			question: "Which tier?",
		},
	],
} satisfies RunContext["space"];

describe("spaces in the prompt", () => {
	it("tells a space's agent how to direct threads and lists the members", () => {
		const prompt = renderSystemPrompt({ ...base, space: chatSpace });

		expect(prompt).toContain('you are the agent of the space "Pricing page"');

		expect(prompt).toContain("Claude (id claude), GPT (id gpt)");

		expect(prompt).toContain("(3 left)");

		expect(prompt).toContain(
			'- "Research Acme" (thread t-2, GPT): needs the owner: "Which tier?", latest run r-2 succeeded',
		);
	});

	it("tells a member who directs it", () => {
		const prompt = renderSystemPrompt({ ...base, space: { ...chatSpace, role: "member", members: [] } });

		expect(prompt).toContain('a member of the space "Pricing page", directed by Claude');
	});

	it("wakes the space's agent on its reports", () => {
		const prompt = renderPrompt({
			...base,
			space: chatSpace,
			trigger: { author: "braise" },
			message: "“Research Acme” finished",
			reports: ["“Research Acme” finished", "“Research Beta” failed: timeout"],
		});

		expect(prompt).toBe(
			"Reports from the space's threads since your last run:\n- “Research Acme” finished\n- “Research Beta” failed: timeout\n\nRead the reports and decide the next step for the space.",
		);
	});

	it("names the space's agent when it writes in a member thread", () => {
		const prompt = renderPrompt({
			...base,
			agent: { name: "GPT", actor: "agent:gpt", grants: [] },
			trigger: { author: "agent:claude" },
			message: "Find Acme's prices",
		});

		expect(prompt).toBe("New message from Claude (the space's agent):\nFind Acme's prices");
	});
});

describe("retries in the prompt", () => {
	it("lists what the earlier attempts already did", () => {
		const prompt = renderPrompt({
			...base,
			retry: {
				calls: [{ name: "create_work_item", input: { title: "Flyers" }, output: '{"id":"w-1"}' }],
				partial: "I created the flyers item and",
			},
		});

		expect(prompt).toContain(
			'Before braise stopped, your previous attempt already did:\n- create_work_item {"title":"Flyers"} → {"id":"w-1"}',
		);

		expect(prompt).toContain("What it had written so far:\nI created the flyers item and");

		expect(prompt).toContain("Continue from there; don't repeat these.");
	});
});
