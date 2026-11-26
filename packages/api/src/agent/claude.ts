import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { createTranslator, toolPrefix } from "./normalize.ts";
import { promiseRuntime } from "./runtime.ts";

const maxTurns = 30;

export const claudeRuntime = promiseRuntime("claude-agent-sdk", async (input, onSignal, abort) => {
	if (abort.aborted) return;

	const controller = new AbortController();

	abort.addEventListener("abort", () => controller.abort(), { once: true });

	const server = createSdkMcpServer({
		name: "braise",
		version: "1.0.0",
		tools: input.tools.map((braiseTool) =>
			tool(braiseTool.name, braiseTool.description, braiseTool.input, async (args) => {
				const output = await braiseTool.execute(args);

				return { content: [{ type: "text", text: output.text }], isError: output.isError };
			}),
		),
	});

	const translate = createTranslator();

	const messages = query({
		prompt: input.prompt,
		options: {
			model: input.model,
			systemPrompt: input.systemPrompt,
			tools: [],
			mcpServers: { braise: server },
			allowedTools: input.tools.map((braiseTool) => `${toolPrefix}${braiseTool.name}`),
			permissionMode: "dontAsk",
			includePartialMessages: true,
			persistSession: false,
			settingSources: [],
			cwd: input.workDir,
			maxTurns,
			abortController: controller,
		},
	});

	for await (const message of messages) {
		for (const signal of translate(message)) await onSignal(signal);
	}
});
