import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));

const schema = z.object({
	DATABASE_URL: z.url(),
	PORT: z.coerce.number().int().positive().default(4400),
});

export function readEnv() {
	if (existsSync(envFile)) process.loadEnvFile(envFile);

	return schema.parse(process.env);
}

export function testDatabaseUrl(databaseUrl: string) {
	const url = new URL(databaseUrl);

	url.pathname = "/braise_test";

	return url.toString();
}
