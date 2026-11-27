import { Context, Effect, Layer } from "effect";
import { Database } from "../db/effect.ts";
import type { CodeConfig } from "./config.ts";
import { type CodeHost, createCodeHost } from "./host.ts";

export class Code extends Context.Service<Code, CodeHost>()("braise/Code") {
	static layer(config: CodeConfig) {
		return Layer.effect(
			Code,
			Effect.gen(function* () {
				return createCodeHost(config, yield* Database);
			}),
		);
	}
}
