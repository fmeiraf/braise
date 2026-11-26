import type { RunUsage } from "@braise/core";
import { Agent, type AgentEvent, type AgentMessage, type AgentTool as PiTool } from "@earendil-works/pi-agent-core";
import { type AssistantMessage, type CredentialStore, createModels } from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { z } from "zod";
import { type AgentTool, promiseRuntime, type RunSignal } from "./runtime.ts";

export const piProvider = "openai-codex";

const maxTurns = 30;

export const turnLimitMessage = `GPT stopped after ${maxTurns} turns without finishing`;

export const piLoginHint = "GPT isn't logged in. Log in with `pi` (run `pi`, then `/login`, OpenAI Codex) and retry.";

function isAssistant(message: AgentMessage): message is AssistantMessage {
	return typeof message === "object" && message !== null && "role" in message && message.role === "assistant";
}

function textOf(result: unknown) {
	if (typeof result !== "object" || result === null || !("content" in result) || !Array.isArray(result.content)) {
		return typeof result === "string" ? result : JSON.stringify(result ?? null);
	}

	return result.content
		.map((part: unknown) =>
			typeof part === "object" && part !== null && "text" in part && typeof part.text === "string" ? part.text : "",
		)
		.join("");
}

export function usageOf(messages: readonly AgentMessage[], durationMs: number) {
	const replies = messages.filter(isAssistant);

	const sum = (pick: (message: AssistantMessage) => number) =>
		replies.reduce((total, message) => total + pick(message), 0);

	return {
		inputTokens: sum((message) => message.usage.input),
		outputTokens: sum((message) => message.usage.output),
		cacheReadTokens: sum((message) => message.usage.cacheRead),
		cacheCreationTokens: sum((message) => message.usage.cacheWrite),
		costUsd: sum((message) => message.usage.cost.total),
		durationMs,
		turns: replies.length,
	} satisfies RunUsage;
}

export function createPiTranslator(clock: () => number = Date.now) {
	const startedAt = clock();
	const blocks = new Map<number, { block: number; offset: number }>();
	let nextBlock = 0;

	return (event: AgentEvent) => {
		switch (event.type) {
			case "message_start":
				blocks.clear();

				return [];
			case "message_update": {
				const update = event.assistantMessageEvent;

				if (update.type === "text_start") {
					blocks.set(update.contentIndex, { block: nextBlock, offset: 0 });

					nextBlock += 1;

					return [];
				}

				const current = "contentIndex" in update ? blocks.get(update.contentIndex) : undefined;

				if (current === undefined) return [];

				if (update.type === "text_delta") {
					const signal = {
						type: "delta",
						block: current.block,
						offset: current.offset,
						text: update.delta,
					} as const;

					current.offset += update.delta.length;

					return [signal satisfies RunSignal];
				}

				if (update.type === "text_end" && update.content !== "") {
					return [{ type: "message", block: current.block, text: update.content } satisfies RunSignal];
				}

				return [];
			}
			case "tool_execution_start":
				return [
					{
						type: "tool.call",
						toolUseId: event.toolCallId,
						name: event.toolName,
						input: event.args,
					} satisfies RunSignal,
				];
			case "tool_execution_end":
				return [
					{
						type: "tool.result",
						toolUseId: event.toolCallId,
						output: textOf(event.result),
						isError: event.isError,
					} satisfies RunSignal,
				];
			case "agent_end": {
				const usage = usageOf(event.messages, clock() - startedAt);
				const last = event.messages.filter(isAssistant).at(-1);

				if (last === undefined) {
					return [
						{ type: "finished", status: "failed", usage, error: "The agent stopped without a reply" } as const,
					];
				}

				if (last.stopReason === "error" || last.stopReason === "aborted") {
					return [
						{
							type: "finished",
							status: "failed",
							usage,
							error: last.errorMessage ?? `The model stopped (${last.stopReason})`,
						} satisfies RunSignal,
					];
				}

				return [{ type: "finished", status: "succeeded", usage, error: null } satisfies RunSignal];
			}
			default:
				return [];
		}
	};
}

function toPiTool(tool: AgentTool) {
	return {
		name: tool.name,
		label: tool.name,
		description: tool.description,
		parameters: z.toJSONSchema(z.object(tool.input), { io: "input" }),
		async execute(_toolCallId, args) {
			const output = await tool.execute(args);

			return { content: [{ type: "text", text: output.text }], details: undefined, isError: output.isError };
		},
	} satisfies PiTool;
}

export function createPiRuntime(credentials: CredentialStore) {
	const models = createModels({ credentials });

	models.setProvider(openaiCodexProvider());

	return promiseRuntime("pi", async (input, onSignal, abort) => {
		if (abort.aborted) return;

		const model = models.getModel(piProvider, input.model);

		if (model === undefined) throw new Error(`Pi has no ${piProvider} model ${input.model}`);

		if ((await credentials.read(piProvider)) === undefined) throw new Error(piLoginHint);

		let turns = 0;

		let limited = false;

		const agent = new Agent({
			initialState: { systemPrompt: input.systemPrompt, model, tools: input.tools.map(toPiTool), messages: [] },
			streamFn: (streamModel, context, options) =>
				models.streamSimple(streamModel, context, { ...options, transport: "sse" }),
			transport: "sse",
			toolExecution: "sequential",
			finishTurn: () => {
				turns += 1;

				if (turns < maxTurns) return undefined;

				limited = true;

				return { action: "end" };
			},
		});

		const translate = createPiTranslator();

		const unsubscribe = agent.subscribe(async (event) => {
			for (const signal of translate(event)) {
				await onSignal(
					limited && signal.type === "finished" && signal.status === "succeeded"
						? { ...signal, status: "failed", error: turnLimitMessage }
						: signal,
				);
			}
		});

		const stop = () => agent.abort();

		abort.addEventListener("abort", stop, { once: true });

		try {
			if (abort.aborted) return;

			await agent.prompt(input.prompt);
		} finally {
			abort.removeEventListener("abort", stop);

			unsubscribe();
		}
	});
}
