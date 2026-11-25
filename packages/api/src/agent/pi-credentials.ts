import { randomUUID } from "node:crypto";
import { readFile, realpath, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Credential, CredentialStore } from "@earendil-works/pi-ai";
import lockfile from "proper-lockfile";

const lockStaleMs = 30_000;

const lockWait = { retries: 40, factor: 1.3, minTimeout: 20, maxTimeout: 1_000 };

export function piAuthFile() {
	return join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "auth.json");
}

function isMissing(error: unknown) {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function readAll(path: string) {
	try {
		return JSON.parse((await readFile(path, "utf8")).replace(/^﻿/u, "") || "{}") as Record<string, Credential>;
	} catch (error) {
		if (isMissing(error)) return {};

		throw error;
	}
}

export function fileCredentialStore(path: string) {
	const locked = async <Result>(work: (all: Record<string, Credential>) => Promise<Result>) => {
		const release = await lockfile.lock(path, { stale: lockStaleMs, retries: lockWait });

		try {
			return await work(await readAll(path));
		} finally {
			await release();
		}
	};

	const save = async (all: Record<string, Credential>) => {
		const target = await realpath(path);

		const staged = join(dirname(target), `.auth.json.${randomUUID()}.tmp`);

		await writeFile(staged, JSON.stringify(all, null, 2), { mode: 0o600 });

		await rename(staged, target);
	};

	return {
		async read(providerId) {
			return (await readAll(path))[providerId];
		},
		async list() {
			return Object.entries(await readAll(path)).map(([providerId, credential]) => ({
				providerId,
				type: credential.type,
			}));
		},
		modify(providerId, change) {
			return locked(async (all) => {
				const next = await change(all[providerId]);

				if (next === undefined) return all[providerId];

				await save({ ...all, [providerId]: next });

				return next;
			});
		},
		async delete(providerId) {
			await locked(async (all) => {
				const { [providerId]: _removed, ...rest } = all;

				await save(rest);
			});
		},
	} satisfies CredentialStore;
}
