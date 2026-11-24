import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { RunUsage } from "@braise/core";
import type { RunSignal } from "./runtime.ts";

export const toolPrefix = "mcp__braise__";

type ResultMessage = Extract<SDKMessage, { type: "result" }>;

function textOf(content: unknown) {
	if (typeof content === "string") return content;

	if (!Array.isArray(content)) return "";

	return content
		.map((part: unknown) =>
			typeof part === "object" && part !== null && "text" in part && typeof part.text === "string" ? part.text : "",
		)
		.join("");
}

function usageOf(result: ResultMessage) {
	return {
		inputTokens: result.usage.input_tokens,
		outputTokens: result.usage.output_tokens,
		cacheReadTokens: result.usage.cache_read_input_tokens,
		cacheCreationTokens: result.usage.cache_creation_input_tokens,
		costUsd: result.total_cost_usd,
		durationMs: result.duration_ms,
		turns: result.num_turns,
	} satisfies RunUsage;
}

function finished(result: ResultMessage) {
	const usage = usageOf(result);

	if (result.subtype === "success" && !result.is_error) {
		return { type: "finished", status: "succeeded", usage, error: null } satisfies RunSignal;
	}

	const error =
		result.subtype === "success" ? result.result : result.errors.join("\n") || result.subtype.replaceAll("_", " ");

	return { type: "finished", status: "failed", usage, error } satisfies RunSignal;
}

export function createTranslator() {
	let nextBlock = 0;
	let streaming: { block: number; length: number } | null = null;

	return (message: SDKMessage) => {
		switch (message.type) {
			case "stream_event": {
				if (message.parent_tool_use_id !== null) return [];

				const { event } = message;

				if (event.type === "content_block_start" && event.content_block.type === "text") {
					streaming = { block: nextBlock, length: 0 };

					return [];
				}

				if (event.type === "content_block_delta" && event.delta.type === "text_delta" && streaming !== null) {
					const signal = {
						type: "delta",
						block: streaming.block,
						offset: streaming.length,
						text: event.delta.text,
					} satisfies RunSignal;

					streaming.length += event.delta.text.length;

					return [signal];
				}

				return [] satisfies RunSignal[];
			}
			case "assistant": {
				if (message.parent_tool_use_id !== null) return [];

				const signals: RunSignal[] = [];

				for (const block of message.message.content) {
					if (block.type === "text") {
						if (block.text.trim() !== "") signals.push({ type: "message", block: nextBlock, text: block.text });

						nextBlock += 1;

						streaming = null;
					} else if (block.type === "tool_use") {
						signals.push({
							type: "tool.call",
							toolUseId: block.id,
							name: block.name.startsWith(toolPrefix) ? block.name.slice(toolPrefix.length) : block.name,
							input: block.input,
						});
					}
				}

				return signals;
			}
			case "user": {
				if (message.parent_tool_use_id !== null || typeof message.message.content === "string") return [];

				return message.message.content.flatMap((block) =>
					block.type === "tool_result"
						? [
								{
									type: "tool.result",
									toolUseId: block.tool_use_id,
									output: textOf(block.content),
									isError: block.is_error === true,
								} satisfies RunSignal,
							]
						: [],
				);
			}
			case "result":
				return [finished(message)];
			default:
				return [] satisfies RunSignal[];
		}
	};
}
