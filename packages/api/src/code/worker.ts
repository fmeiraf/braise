import { Effect, Layer } from "effect";
import { Boss } from "../agent/queue.ts";
import { query } from "../db/effect.ts";
import { type CodeJob, codeQueue } from "./host.ts";
import { Code } from "./service.ts";

const codeConcurrency = 2;

export const codeWorkerLayer = Layer.effectDiscard(
	Effect.gen(function* () {
		const boss = yield* Boss;
		const code = yield* Code;

		yield* query(() =>
			boss.work<CodeJob>(codeQueue, { localConcurrency: codeConcurrency, batchSize: 1 }, async ([job]) => {
				if (job === undefined) return;

				await code.runJob(job.data);
			}),
		);
	}),
);
