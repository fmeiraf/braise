import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Where braise keeps repos, checkouts and the GitHub App's key, and where it reaches GitHub. */
export interface CodeConfig {
	home: string;
	gitBase: string;
	apiBase: string;
	githubWeb: string;
	apiUrl: string;
	webUrl: string;
	protectedPaths: string[];
}

const envFile = fileURLToPath(new URL("../../../../.env", import.meta.url));

const secretHomePaths = [
	".pi",
	".claude",
	".codex",
	".config/gh",
	".ssh",
	".aws",
	".gnupg",
	".docker",
	".netrc",
	".npmrc",
	".git-credentials",
];

export function readCodeConfig(env: NodeJS.ProcessEnv = process.env) {
	const home = env.BRAISE_HOME ?? join(homedir(), ".braise");
	const port = env.PORT ?? "4400";

	return {
		home,
		gitBase: env.BRAISE_GITHUB_GIT_BASE ?? "https://github.com/",
		apiBase: "https://api.github.com",
		githubWeb: "https://github.com",
		apiUrl: env.BRAISE_API_URL ?? `http://localhost:${port}`,
		webUrl: env.BRAISE_WEB_URL ?? "http://localhost:5400",
		protectedPaths: [
			...secretHomePaths.map((path) => join(homedir(), path)),
			...(env.PI_CODING_AGENT_DIR === undefined ? [] : [env.PI_CODING_AGENT_DIR]),
			envFile,
		],
	} satisfies CodeConfig;
}

export function keysDir(config: CodeConfig) {
	return join(config.home, "keys");
}

export function appKeyFile(config: CodeConfig) {
	return join(keysDir(config), "github-app.pem");
}

export function mirrorsDir(config: CodeConfig) {
	return join(config.home, "mirrors");
}

export function mirrorOf(config: CodeConfig, githubRepoId: number) {
	return join(mirrorsDir(config), `${githubRepoId}.git`);
}

export function threadsDir(config: CodeConfig) {
	return join(config.home, "threads");
}

export function threadDir(config: CodeConfig, threadId: string) {
	return join(threadsDir(config), threadId);
}

export function threadHome(config: CodeConfig, threadId: string) {
	return join(threadDir(config, threadId), "home");
}

export function remoteUrl(config: CodeConfig, fullName: string) {
	return `${config.gitBase}${fullName}.git`;
}
