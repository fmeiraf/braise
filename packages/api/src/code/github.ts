import { createSign, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { GitHubInstallation } from "@braise/core";
import type { Database } from "../db/client.ts";
import { githubApp } from "../db/schema.ts";
import { AppError } from "../errors.ts";
import { appKeyFile, type CodeConfig, keysDir } from "./config.ts";

export const appPermissions = {
	contents: "write",
	pull_requests: "write",
	checks: "read",
	statuses: "read",
	metadata: "read",
} as const;

export type Permissions = Partial<Record<keyof typeof appPermissions, "read" | "write">>;

export const pushPermissions = { contents: "write", metadata: "read" } as const satisfies Permissions;

export const pullPermissions = {
	contents: "write",
	pull_requests: "write",
	metadata: "read",
} as const satisfies Permissions;

export const statusPermissions = {
	contents: "read",
	pull_requests: "read",
	checks: "read",
	statuses: "read",
	metadata: "read",
} as const satisfies Permissions;

export const mirrorPermissions = { contents: "read", metadata: "read" } as const satisfies Permissions;

export class GitHubError extends Error {
	readonly status: number;
	readonly body: unknown;

	constructor(status: number, message: string, body: unknown) {
		super(message);

		this.name = "GitHubError";
		this.status = status;
		this.body = body;
	}
}

function base64url(value: string | Buffer) {
	return Buffer.from(value).toString("base64url");
}

export function appJwt(appId: number, privateKey: string, nowSeconds = Math.floor(Date.now() / 1000)) {
	const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
	const payload = base64url(JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 9 * 60, iss: String(appId) }));
	const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(privateKey);

	return `${header}.${payload}.${base64url(signature)}`;
}

export function appManifest(config: CodeConfig, name: string) {
	return {
		name,
		url: config.webUrl,
		description: "braise, the owner's holding: agents push branches and open pull requests for review.",
		hook_attributes: { url: `${config.apiUrl}/api/github/hook`, active: false },
		redirect_url: `${config.apiUrl}/api/github/callback`,
		setup_url: `${config.apiUrl}/api/github/installed`,
		setup_on_update: true,
		public: false,
		default_permissions: appPermissions,
		default_events: [],
	};
}

export function appName() {
	return `braise-${randomBytes(3).toString("hex")}`;
}

function escapeHtml(value: string) {
	return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function manifestPage(config: CodeConfig, options: { state: string; org: string | null }) {
	const target =
		options.org === null
			? `${config.githubWeb}/settings/apps/new`
			: `${config.githubWeb}/organizations/${encodeURIComponent(options.org)}/settings/apps/new`;

	const manifest = JSON.stringify(appManifest(config, appName()));

	return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Connecting braise to GitHub</title>
<style>body{background:#16130f;color:#e8e2d9;font:15px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}button{font:inherit;padding:8px 14px;border-radius:6px;border:1px solid #5b5348;background:#2a251f;color:inherit;cursor:pointer}</style>
</head>
<body>
<form method="post" action="${escapeHtml(`${target}?state=${encodeURIComponent(options.state)}`)}">
<input type="hidden" name="manifest" value="${escapeHtml(manifest)}">
<p>Taking you to GitHub to create braise's App…</p>
<button type="submit">Continue to GitHub</button>
</form>
<script>document.forms[0].submit()</script>
</body>
</html>`;
}

const jsonHeaders = {
	accept: "application/vnd.github+json",
	"x-github-api-version": "2022-11-28",
	"user-agent": "braise",
};

async function parseBody(response: Response) {
	const text = await response.text();

	if (text === "") return null;

	try {
		return JSON.parse(text) as unknown;
	} catch (error) {
		throw new GitHubError(response.status, `GitHub answered with something that isn't JSON: ${String(error)}`, text);
	}
}

function messageOf(body: unknown, status: number) {
	if (typeof body === "object" && body !== null && "message" in body && typeof body.message === "string") {
		return `GitHub ${status}: ${body.message}`;
	}

	return `GitHub ${status}`;
}

export async function githubFetch(
	config: CodeConfig,
	auth: string | null,
	method: string,
	path: string,
	body?: unknown,
) {
	const response = await fetch(`${config.apiBase}${path}`, {
		method,
		headers: {
			...jsonHeaders,
			...(auth === null ? {} : { authorization: auth }),
			...(body === undefined ? {} : { "content-type": "application/json" }),
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});

	const parsed = await parseBody(response);

	if (!response.ok) throw new GitHubError(response.status, messageOf(parsed, response.status), parsed);

	return parsed;
}

export interface ManifestConversion {
	id: number;
	slug: string;
	pem: string;
	owner: { login: string };
	html_url: string;
}

export async function convertManifest(config: CodeConfig, code: string) {
	const converted = (await githubFetch(
		config,
		null,
		"POST",
		`/app-manifests/${encodeURIComponent(code)}/conversions`,
	)) as ManifestConversion;

	return converted;
}

export async function saveAppKey(config: CodeConfig, pem: string) {
	await mkdir(keysDir(config), { recursive: true, mode: 0o700 });

	await writeFile(appKeyFile(config), pem, { mode: 0o600 });
}

interface RawInstallation {
	id: number;
	account: { login: string; type: string } | null;
	repository_selection: "all" | "selected";
	html_url: string;
}

interface RawRepo {
	id: number;
	full_name: string;
	default_branch: string;
	private: boolean;
}

export interface RepoInfo {
	githubRepoId: number;
	fullName: string;
	defaultBranch: string;
	private: boolean;
}

function repoInfo(raw: RawRepo) {
	return {
		githubRepoId: raw.id,
		fullName: raw.full_name,
		defaultBranch: raw.default_branch,
		private: raw.private,
	} satisfies RepoInfo;
}

/** braise's GitHub App: the JWT, scoped installation tokens and the REST calls made with them. */
export function createGitHub(config: CodeConfig, db: Database) {
	async function app() {
		const [row] = await db.select().from(githubApp).limit(1);

		return row ?? null;
	}

	async function credentials() {
		const row = await app();

		if (row === null) {
			throw new AppError("rule_violated", "GitHub isn't connected yet; connect it from a venture's Repos panel", {
				rule: "github_not_connected",
			});
		}

		const privateKey = await readFile(appKeyFile(config), "utf8").catch((error: unknown) => {
			throw new AppError("rule_violated", `braise can't read the GitHub App's key at ${appKeyFile(config)}`, {
				rule: "github_key_missing",
				cause: String(error),
			});
		});

		return { app: row, privateKey };
	}

	async function asApp(method: string, path: string, body?: unknown) {
		const { app: row, privateKey } = await credentials();

		return githubFetch(config, `Bearer ${appJwt(row.id, privateKey)}`, method, path, body);
	}

	async function installationToken(
		installationId: number,
		scope: { repositoryIds?: number[]; permissions?: Permissions } = {},
	) {
		const minted = (await asApp("POST", `/app/installations/${installationId}/access_tokens`, {
			...(scope.repositoryIds === undefined ? {} : { repository_ids: scope.repositoryIds }),
			...(scope.permissions === undefined ? {} : { permissions: scope.permissions }),
		})) as { token: string; expires_at: string };

		return minted.token;
	}

	async function installations() {
		const raw = (await asApp("GET", "/app/installations?per_page=100")) as RawInstallation[];

		return raw.map(
			(installation) =>
				({
					id: installation.id,
					account: installation.account?.login ?? "unknown",
					accountType: installation.account?.type ?? "User",
					selection: installation.repository_selection,
					settingsUrl: installation.html_url,
				}) satisfies GitHubInstallation,
		);
	}

	async function installationRepos(installationId: number) {
		const token = await installationToken(installationId, { permissions: { metadata: "read" } });

		const listed = (await githubFetch(
			config,
			`token ${token}`,
			"GET",
			"/installation/repositories?per_page=100",
		)) as {
			repositories: RawRepo[];
		};

		return listed.repositories.map(repoInfo);
	}

	async function asInstallation(
		repo: { installationId: number; githubRepoId: number },
		permissions: Permissions,
		method: string,
		path: string,
		body?: unknown,
	) {
		const token = await installationToken(repo.installationId, {
			repositoryIds: [repo.githubRepoId],
			permissions,
		});

		return githubFetch(config, `token ${token}`, method, path, body);
	}

	async function repoToken(repo: { installationId: number; githubRepoId: number }, permissions: Permissions) {
		return installationToken(repo.installationId, { repositoryIds: [repo.githubRepoId], permissions });
	}

	async function repository(repo: { installationId: number; githubRepoId: number }) {
		return repoInfo(
			(await asInstallation(repo, mirrorPermissions, "GET", `/repositories/${repo.githubRepoId}`)) as RawRepo,
		);
	}

	return { app, credentials, installations, installationRepos, asInstallation, repoToken, repository };
}

export type GitHub = ReturnType<typeof createGitHub>;

export function isAccessLoss(error: unknown) {
	return error instanceof GitHubError && [401, 403, 404, 422].includes(error.status);
}
