import type { RunUsage } from "@braise/core";
import type { z } from "zod";

export interface ToolOutput {
	text: string;
	isError: boolean;
}

export interface AgentTool {
	name: string;
	description: string;
	input: z.ZodRawShape;
	execute(args: unknown): Promise<ToolOutput>;
}

export type RunSignal =
	| { type: "delta"; block: number; offset: number; text: string }
	| { type: "message"; block: number; text: string }
	| { type: "tool.call"; toolUseId: string; name: string; input: unknown }
	| { type: "tool.result"; toolUseId: string; output: string; isError: boolean }
	| { type: "finished"; status: "succeeded" | "failed"; usage: RunUsage | null; error: string | null };

export interface RunInput {
	model: string;
	systemPrompt: string;
	prompt: string;
	tools: AgentTool[];
	workDir: string;
}

export interface AgentRuntime {
	name: string;
	run(input: RunInput, onSignal: (signal: RunSignal) => Promise<void>, abort: AbortSignal): Promise<void>;
}
