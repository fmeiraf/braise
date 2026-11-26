import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { RunUsage } from "@braise/core";
import type { LimitSignal, RunSignal } from "./runtime.ts";

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

type RateLimitInfo = Extract<SDKMessage, { type: "rate_limit_event" }>["rate_limit_info"];

interface WindowInfo {
	status?: string;
	utilization?: number;
	resetsAt?: number;
}

function limitStatus(status: string | undefined) {
	if (status === "rejected") return "rejected";

	return status === "allowed_warning" ? "warning" : "allowed";
}

function clampUtilization(value: number | undefined) {
	return value === undefined || !Number.isFinite(value) ? null : Math.min(1, Math.max(0, value));
}

function limitReading(window: string, info: WindowInfo) {
	return {
		window,
		status: limitStatus(info.status),
		utilization: clampUtilization(info.utilization),
		resetsAt: info.resetsAt === undefined ? null : new Date(info.resetsAt * 1000),
	} satisfies LimitSignal;
}

export function claudeLimitReadings(info: RateLimitInfo) {
	const windows =
		"unifiedWindows" in info ? (info.unifiedWindows as Record<string, WindowInfo> | undefined) : undefined;

	const readings =
		windows === undefined ? [] : Object.entries(windows).map(([window, found]) => limitReading(window, found));

	const headline = info.rateLimitType ?? "five_hour";

	if (!readings.some((reading) => reading.window === headline)) readings.push(limitReading(headline, info));

	return readings.map((reading) =>
		reading.window === headline && info.status === "rejected" ? { ...reading, status: "rejected" as const } : reading,
	);
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
			case "rate_limit_event":
				return claudeLimitReadings(message.rate_limit_info).map(
					(reading) => ({ type: "limit", reading }) satisfies RunSignal,
				);
			case "result":
				return [finished(message)];
			default:
				return [] satisfies RunSignal[];
		}
	};
}
