import type { LimitStatus, RunUsage } from "@braise/core";
import { Data, Effect } from "effect";
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
	| { type: "limit"; reading: LimitSignal }
	| { type: "finished"; status: "succeeded" | "failed"; usage: RunUsage | null; error: string | null };

export interface LimitSignal {
	window: string;
	status: LimitStatus;
	utilization: number | null;
	resetsAt: Date | null;
}

export interface RunInput {
	model: string;
	systemPrompt: string;
	prompt: string;
	tools: AgentTool[];
	workDir: string;
}

export class RuntimeError extends Data.TaggedError("RuntimeError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export interface AgentRuntime {
	name: string;
	run<E>(input: RunInput, onSignal: (signal: RunSignal) => Effect.Effect<void, E>): Effect.Effect<void, RuntimeError>;
}

export type PromiseRun = (
	input: RunInput,
	onSignal: (signal: RunSignal) => Promise<void>,
	abort: AbortSignal,
) => Promise<void>;

export function promiseRuntime(name: string, run: PromiseRun) {
	return {
		name,
		run: (input, onSignal) =>
			Effect.callback<void, RuntimeError>((resume, abort) => {
				const settled = run(input, (signal) => Effect.runPromise(onSignal(signal)), abort).then(
					() => resume(Effect.void),
					(cause: unknown) =>
						resume(
							Effect.fail(
								new RuntimeError({ message: cause instanceof Error ? cause.message : String(cause), cause }),
							),
						),
				);

				return Effect.promise(() => settled);
			}),
	} satisfies AgentRuntime;
}
