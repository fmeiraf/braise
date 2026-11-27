import type { GitHubConnection, ReachableRepo, VentureRepo } from "@braise/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Editable } from "./editable.tsx";
import { describeError } from "./errors.ts";
import { keys, queries } from "./live.ts";
import { Icon } from "./marks.tsx";
import { Sec, Skeleton } from "./parts.tsx";
import { ago } from "./time.ts";
import { useCommand } from "./use-command.ts";

const tones = { cloning: "live", ready: "ok", failed: "bad", no_access: "needs" } as const;

function repoMeta(repo: VentureRepo, now: number) {
	if (repo.status === "cloning") return "Cloning the mirror…";

	if (repo.status !== "ready") return repo.error ?? "braise can't use this repo";

	const parts = [repo.defaultBranch, repo.fetchedAt === null ? "not fetched" : `fetched ${ago(repo.fetchedAt, now)}`];

	if (repo.openPullRequests > 0) {
		parts.push(`${repo.openPullRequests} open ${repo.openPullRequests === 1 ? "pull request" : "pull requests"}`);
	}

	return parts.join(" · ");
}

function ConnectGitHub({ slug }: { slug: string }) {
	return (
		<div className="gh-connect">
			<p>
				Connect GitHub so agents can work in this venture's code. Their pull requests come from braise's own GitHub
				App; you review and merge them on GitHub.
			</p>
			<a className="btn pri sm" href={`/api/github/connect?return=${encodeURIComponent(`/v/${slug}/settings`)}`}>
				Connect GitHub
			</a>
		</div>
	);
}

function RepoPicker({
	ventureId,
	connection,
	close,
}: {
	ventureId: string;
	connection: GitHubConnection;
	close: () => void;
}) {
	const reachable = useQuery(queries.reachableRepos());
	const client = useQueryClient();

	const add = useCommand("venture.add_repo", () => {
		void client.invalidateQueries({ queryKey: keys.reachableRepos });

		close();
	});

	const free = (reachable.data?.repos ?? []).filter((repo) => repo.ventureId === null);

	const pick = (repo: ReachableRepo) =>
		add.mutate({
			payload: {
				ventureId,
				githubRepoId: repo.githubRepoId,
				installationId: repo.installationId,
				fullName: repo.fullName,
				defaultBranch: repo.defaultBranch,
			},
		});

	return (
		<div className="repo-pick">
			{reachable.isPending ? (
				<Skeleton label="Asking GitHub for the App's repositories…" widths={[80, 60]} />
			) : reachable.isError ? (
				<p className="err">{describeError(reachable.error)}</p>
			) : free.length === 0 ? (
				<p className="cap">Every repository the App can reach is already on a venture.</p>
			) : (
				<ul>
					{free.map((repo) => (
						<li key={repo.githubRepoId}>
							<button type="button" disabled={add.isPending} onClick={() => pick(repo)}>
								<b>{repo.fullName}</b>
								<span className="cap">
									{repo.private ? "Private" : "Public"} · {repo.defaultBranch}
								</span>
							</button>
						</li>
					))}
				</ul>
			)}
			{add.isError ? <p className="err">{describeError(add.error)}</p> : null}
			<div className="repo-pick-foot">
				{connection.installUrl === null ? null : (
					<a className="cap" href={connection.installUrl} target="_blank" rel="noreferrer">
						Not listed? Choose repositories on GitHub
					</a>
				)}
				<button type="button" className="btn ghost sm" onClick={close}>
					Cancel
				</button>
			</div>
		</div>
	);
}

function RepoRow({ repo, ventureId, installUrl }: { repo: VentureRepo; ventureId: string; installUrl: string | null }) {
	const fetch = useCommand("repo.fetch", () => undefined);
	const remove = useCommand("venture.remove_repo", () => undefined);
	const domains = useCommand("venture.update_repo", () => undefined);
	const error = fetch.error ?? remove.error;

	return (
		<li data-tone={tones[repo.status]}>
			<span className="pip" data-tone={tones[repo.status]} aria-hidden="true" />
			<div className="repo-main">
				<b>{repo.fullName}</b>
				<span className={repo.status === "ready" || repo.status === "cloning" ? "cap" : "cap repo-why"}>
					{repoMeta(repo, Date.now())}
					{repo.status === "no_access" && installUrl !== null ? (
						<>
							{" "}
							<a href={installUrl} target="_blank" rel="noreferrer">
								Choose repositories
							</a>
						</>
					) : null}
				</span>
				<span className="cap repo-domains">
					<span>Sandbox network: package registries, plus </span>
					<Editable
						label={`extra sandbox domains for ${repo.fullName}`}
						value={repo.allowedDomains.join(", ")}
						placeholder="nothing else"
						display={repo.allowedDomains.length === 0 ? "nothing else" : repo.allowedDomains.join(", ")}
						save={(next) =>
							domains.mutateAsync({
								payload: {
									ventureId,
									repoId: repo.id,
									allowedDomains: next
										.split(/[\s,]+/u)
										.map((domain) => domain.trim())
										.filter((domain) => domain !== ""),
								},
							})
						}
					/>
				</span>
				{error === null ? null : <span className="err">{describeError(error)}</span>}
			</div>
			<span className="repo-acts">
				<button
					type="button"
					className="ib"
					aria-label={`Fetch ${repo.fullName}`}
					data-tip="Fetch|Update the mirror from GitHub"
					disabled={fetch.isPending || repo.status === "cloning"}
					onClick={() => fetch.mutate({ payload: { repoId: repo.id } })}
				>
					<Icon name="retry" />
				</button>
				<button
					type="button"
					className="ib"
					aria-label={`Remove ${repo.fullName} from this venture`}
					data-tip="Remove|Take the repo off this venture; GitHub is untouched"
					disabled={remove.isPending}
					onClick={() => remove.mutate({ payload: { ventureId, repoId: repo.id } })}
				>
					<Icon name="x" />
				</button>
			</span>
		</li>
	);
}

export function GitHubPanel({ slug }: { slug: string }) {
	const github = useQuery(queries.github());

	return (
		<section aria-labelledby="github-heading">
			<Sec title="GitHub" id="github-heading" />
			{github.isPending ? (
				<Skeleton label="Asking GitHub…" widths={[60, 40]} />
			) : github.isError ? (
				<p className="err">{describeError(github.error)}</p>
			) : github.data.app === null ? (
				<ConnectGitHub slug={slug} />
			) : (
				<div className="gh-app">
					<div className="gh-app-h">
						<b>{github.data.app.slug}</b>
						<span className="cap">
							braise's GitHub App, owned by {github.data.app.ownerLogin}. Agents push and open pull requests as{" "}
							{github.data.app.slug}[bot].
						</span>
					</div>
					{github.data.error === null ? null : <p className="err">GitHub: {github.data.error}</p>}
					{github.data.installations.length === 0 ? (
						<p className="cap">Not installed on any account yet.</p>
					) : (
						<ul className="gh-installs">
							{github.data.installations.map((installation) => (
								<li key={installation.id}>
									<span>{installation.account}</span>
									<span className="cap">
										{installation.selection === "all" ? "All repositories" : "Selected repositories"}
									</span>
									<a className="btn ghost sm" href={installation.settingsUrl} target="_blank" rel="noreferrer">
										Choose repositories
									</a>
								</li>
							))}
						</ul>
					)}
					{github.data.installUrl === null ? null : (
						<a className="btn sm gh-install" href={github.data.installUrl} target="_blank" rel="noreferrer">
							<Icon name="plus" />
							{github.data.installations.length === 0 ? "Install on GitHub" : "Install on another account"}
						</a>
					)}
				</div>
			)}
		</section>
	);
}

export function Repos({ slug, ventureId }: { slug: string; ventureId: string }) {
	const github = useQuery(queries.github());
	const repos = useQuery(queries.repos(slug));
	const [adding, setAdding] = useState(false);
	const connection = github.data;
	const installed = (connection?.installations.length ?? 0) > 0;
	const list = repos.data?.repos ?? [];

	if (connection?.app === null && list.length === 0) return null;

	return (
		<section aria-labelledby="repos-heading" className="repos-sec">
			<Sec title="Repos" id="repos-heading" count={list.length === 0 ? undefined : list.length}>
				{connection?.app !== null && installed && !adding ? (
					<button type="button" className="btn ghost sm" onClick={() => setAdding(true)}>
						<Icon name="plus" />
						Add repo
					</button>
				) : null}
			</Sec>
			{repos.isPending || github.isPending ? (
				<Skeleton label="Loading repos…" widths={[70, 50]} />
			) : repos.isError ? (
				<p className="err">{describeError(repos.error)}</p>
			) : (
				<>
					{adding && connection !== undefined ? (
						<RepoPicker ventureId={ventureId} connection={connection} close={() => setAdding(false)} />
					) : null}
					{list.length === 0 && !adding ? (
						<p className="empty">
							{installed
								? "No repo yet. Add one and agents in this venture's threads get their own checkout of it."
								: "Install the App on GitHub first; then this venture's repos can be added here."}
						</p>
					) : null}
					{list.length === 0 ? null : (
						<ul className="repos">
							{list.map((repo) => (
								<RepoRow
									key={repo.id}
									repo={repo}
									ventureId={ventureId}
									installUrl={connection?.installUrl ?? null}
								/>
							))}
						</ul>
					)}
				</>
			)}
		</section>
	);
}

const githubMark =
	"M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z";

function GitHubMark() {
	return (
		<svg className="gh-mark" viewBox="0 0 16 16" aria-hidden="true">
			<path d={githubMark} />
		</svg>
	);
}

/** The Overview's integrations band: GitHub first, because agents can't touch code without it. */
export function Integrations({ slug }: { slug: string }) {
	const github = useQuery(queries.github());
	const repos = useQuery(queries.repos(slug));
	const list = repos.data?.repos ?? [];
	const now = Date.now();
	const connected = github.data !== undefined && github.data.app !== null;
	const installed = (github.data?.installations.length ?? 0) > 0;
	const waiting = list.reduce((sum, repo) => sum + repo.openPullRequests, 0);
	const state = !connected ? "off" : list.length === 0 ? "empty" : "on";

	const status =
		github.isPending || repos.isPending
			? "Checking…"
			: !connected
				? "Not connected"
				: list.length === 0
					? `Connected as ${github.data?.app?.slug ?? "the App"} · no repo here yet`
					: `${list.length} ${list.length === 1 ? "repo" : "repos"} · as ${github.data?.app?.slug ?? "the App"}[bot]`;

	return (
		<section aria-labelledby="integrations-heading" className="integrations">
			<Sec title="Integrations" id="integrations-heading">
				<Link to="/v/$slug/settings" params={{ slug }} className="btn ghost sm">
					Manage
				</Link>
			</Sec>
			<div className="integ" data-state={state}>
				<span className="integ-logo">
					<GitHubMark />
				</span>
				<div className="integ-main">
					<div className="integ-h">
						<b>GitHub</b>
						<span className="cap">{status}</span>
					</div>
					{github.isError ? <p className="err">{describeError(github.error)}</p> : null}
					{state === "off" ? (
						<p className="integ-why">
							Connect it so agents can work in this venture's code. Each thread gets its own checkout, and its
							pull requests come from braise's own App for you to review and merge.
						</p>
					) : state === "empty" ? (
						<p className="integ-why">
							{installed
								? "Add this venture's repo and its threads can check it out."
								: "Install the App on your GitHub account, then add this venture's repo."}
						</p>
					) : (
						<ul className="integ-repos">
							{list.map((repo) => (
								<li key={repo.id} data-tone={tones[repo.status]}>
									<span className="pip" data-tone={tones[repo.status]} aria-hidden="true" />
									<b>{repo.fullName}</b>
									<span
										className={repo.status === "ready" || repo.status === "cloning" ? "cap" : "cap repo-why"}
									>
										{repoMeta(repo, now)}
									</span>
								</li>
							))}
						</ul>
					)}
					{waiting > 0 ? (
						<span className="integ-wait" data-tone="needs">
							<span className="pip" data-tone="needs" aria-hidden="true" />
							{waiting} {waiting === 1 ? "pull request waits" : "pull requests wait"} for your review on GitHub
						</span>
					) : null}
				</div>
				<div className="integ-act">
					{state === "off" ? (
						<a
							className="btn pri"
							href={`/api/github/connect?return=${encodeURIComponent(`/v/${slug}/settings`)}`}
						>
							Connect GitHub
						</a>
					) : state === "empty" ? (
						installed ? (
							<Link to="/v/$slug/settings" params={{ slug }} className="btn pri">
								Add a repo
							</Link>
						) : (
							<a className="btn pri" href={github.data?.installUrl ?? "#"}>
								Install on GitHub
							</a>
						)
					) : null}
				</div>
			</div>
		</section>
	);
}
