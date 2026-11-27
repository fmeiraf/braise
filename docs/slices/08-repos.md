# Slice 8: Repos, sandboxed checkouts and pull requests

Status: **in progress** 2026-11-26. This is the build spec; the rules in `docs/architecture.md` apply
throughout. It gives ventures their GitHub repos and lets agents change code: each thread works in its
own checkout, runs commands in a sandbox, and hands its work to the owner as a pull request.

## Goal

Until now agents could plan work but not do engineering work. This slice connects braise to GitHub
through a GitHub App the owner creates once, attaches repos to ventures, and gives every thread that
needs it a checkout of its own, made from a local mirror. Agents read, write and edit files and run
commands there, inside srt (`@anthropic-ai/sandbox-runtime`), on both runtimes through one set of
braise tools. Pushing and opening pull requests are braise commands under a new capability, `code`, so
the owner grants them like any other access. The App, not the owner's account, authors the pull
requests, so the owner can review, approve and merge them on GitHub. braise never merges.

Local only. Cloud is deferred; the slice keeps the cheap seams listed under Seams.

## Demo scenario (acceptance)

1. Open the example venture's cockpit. Its Repos panel says GitHub isn't connected. "Connect GitHub"
   goes to GitHub with a prepared App manifest; the owner creates the App and is sent on to install it,
   choosing "Only select repositories" and one repo. braise comes back to the cockpit.
2. "Add repo" lists the repos the App can reach, read live from GitHub. Picking one attaches it to the
   venture. It shows Cloning, then Ready with its default branch and the time it was fetched.
3. Start a thread with Claude: "Add a CONTRIBUTING.md and make sure the tests still pass". The agent
   calls `checkout_repo`. The thread's Code strip shows the checkout on branch `braise/<thread-slug>`
   from the default branch's SHA.
4. The agent reads and edits files and runs `npm test` in the sandbox. A command that tries to write
   outside the thread folder, read `~/.braise/keys` or reach github.com fails with the sandbox's error.
5. The agent commits and calls `open_pull_request`. `code` isn't granted, so the owner gets an access
   request in the inbox. Approving it grants `code`; the agent (or the owner's "go ahead") retries, braise
   pushes the branch and opens the PR as `<app>[bot]`, a braise line in the thread links it, and the
   Code strip shows #N Open.
6. Ask the agent for the PR's status: `pull_request_status` reads checks and review comments.
7. The owner reviews and merges on GitHub. Opening the thread again shows #N Merged; braise removes the
   thread's checkout because all its pull requests are closed or merged.
8. Removing the repo from the venture is refused while a braise PR on it is open (422
   `repo_has_open_prs`), and allowed once none is.

## In / out of scope

**In:** the GitHub App (manifest flow, one key, installations read live), `venture_repos` with a bare
mirror per repo, per-thread checkouts with `git clone --shared`, srt for every bash command, braise's
own `read`/`write`/`edit`/`bash` tools on both runtimes, `checkout_repo`, `pull_request_status`, the
`code` capability with `repo.push`, `pr.open` and `pr.update`, `pull_requests`, PR state read on
demand, checkout cleanup, the prompt's repos and checkouts, the cockpit's Repos panel, the thread's
Code strip, coding tool rows in the trace.

**Out:** cloud runners and any remote sandbox; GitLab; webhooks (no public URL locally); a merge
command (merge is the owner's, on GitHub); scheduled fetches; Pi's codemode; per-repo setup recipes;
srt's credential masking; a repo shared by two ventures; editing a PR's base branch; Docker or other
sandbox adapters.

## Decisions (from the owner's plan, 2026-11-26; leans marked)

- A venture has zero or more GitHub repos; a repo belongs to exactly one venture (lean: a second
  venture adding it gets 422 `repo_taken`). The Holding has none.
- A repo is keyed by `github_repo_id`, which survives renames; `full_name` and `default_branch` are
  refreshed on each fetch.
- The GitHub App is created with the manifest flow (webhooks off, redirect to `localhost:4400`) with
  contents and pull requests read-write, checks and statuses read, metadata read. Its private key is a
  login like Pi's `auth.json`: `~/.braise/keys/github-app.pem`, mode 0600, never in Postgres and never
  readable from the sandbox. The App's id and slug are in Postgres.
- Installations and the repos each installation can reach are read live from GitHub with the App's
  JWT; braise keeps no copy. A repo records the installation it was added through.
- Every GitHub operation mints an installation token (at most an hour) scoped to the one repo and the
  permissions it needs. Deselecting a repo on GitHub makes the mint fail: the repo turns `no_access`
  and the tools say so.
- A bare mirror per repo at `~/.braise/mirrors/<github-repo-id>.git` (not `<owner>/<repo>.git`: a
  rename would move the mirror out from under the checkouts that borrow its objects), heads only, with
  `gc.pruneExpire=never` because checkouts borrow its objects. It is fetched when a thread checks the
  repo out and by the owner's Fetch button; no schedule (lean).
- One checkout per thread per repo at `~/.braise/threads/<thread-id>/<dir>`, made lazily by the
  `checkout_repo` tool with `git clone --shared` from the mirror (not `git worktree`, whose commits
  would land in the shared mirror the sandbox must not write). Branch `braise/<thread-slug>`. A thread
  may hold several repos: one branch and one pull request per repo.
- Checkouts persist across runs and restarts. Postgres keeps the base SHA and the checkpoint SHA at
  each run's end, plus a relative `dir`; no absolute path is stored (the root comes from `BRAISE_HOME`,
  default `~/.braise`).
- Cleanup (lean): a thread's checkouts are removed when the thread is archived, or once all its pull
  requests are merged or closed.
- The agent commits as it goes; git works inside the sandbox, which has no network to GitHub.
- srt 0.0.83, pinned exactly. It wraps only bash commands, never the worker. Policy per thread: write
  only the thread's folder; read everywhere except `~/.braise/keys`, `~/.pi`, `~/.claude`,
  `~/.config/gh`, `~/.ssh` and other threads' folders (the mirrors stay readable, `--shared` needs
  them); `HOME` is the thread's `home/`; the environment is rebuilt from scratch (no `DATABASE_URL`, no
  tokens); network is a package registry allowlist, github.com denied, localhost unreachable. A repo may
  add domains to the allowlist (lean: fixed default plus per-repo additions).
- srt's credential masking is not used for GitHub: it would protect the token, not the action. braise
  pushes, so the grant governs the action.
- Each bash call is a fresh process in the thread folder with a timeout (default 2 minutes, at most
  10), capped output, and is killed when the run is stopped or ends.
- Dependencies are installed inside the sandbox, one `node_modules` per checkout (lean: acceptable).
- **Worker git never runs in an agent's checkout.** The agent can write `.git/hooks` and `.git/config`,
  so any git command the worker ran there outside the sandbox could run the agent's code with the token
  at hand. Reading a checkout's SHAs runs inside srt; a push copies nothing and runs nothing from the
  checkout: it uses a temporary worker-owned bare repository that borrows the checkout's objects through
  `objects/info/alternates`, points one ref at the SHA read in the sandbox, and pushes that ref. The
  token reaches git through `GIT_CONFIG_*` environment variables (`http.extraHeader`), never on disk or
  on a command line.
- File tools run in the worker, outside srt, behind a path guard: the real path, with symlinks
  resolved, must stay inside the thread's folder.
- One set of coding tools, `read`, `write`, `edit` (`old_string`/`new_string`) and `bash`, shaped like
  Claude Code's, used by Claude and Pi alike. Claude keeps built-in tools off and gets these through
  the braise MCP server, with `toolAliases` routing `Read`, `Write`, `Edit` and `Bash` to them.
  Coding tools appear only in threads of a venture with repos.
- A new capability `code` ("Push branches and open PRs") covers `repo.push`, `pr.open` and `pr.update`.
  Out of grant becomes an access request (invariant 4). Migration `0009` grants it to no profile (lean):
  pushing is outward-facing, so the owner turns it on, through the first access request or the Agents
  view.
- `repo.push` pushes only the thread's `braise/…` branch, never with force. `pr.open` pushes and opens
  the pull request in one command; a second open PR for the same thread and repo is refused (422
  `pr_exists`). The GitHub calls happen inside the command's transaction, so a GitHub failure records
  nothing; a retry after a lost commit finds the open PR for the branch instead of opening another.
- Merging is the owner's, on GitHub; braise has no merge command.
- PR state is read from GitHub on demand: when the thread's Code strip loads and through
  `pull_request_status`. Mirror status, checkouts, checkpoints and PR state are written by the API and
  worker as a record of the filesystem and of GitHub, not as commands (invariant 2's exception widens;
  what an agent or the owner changes stays a command).
- The GitHub connection shows in the venture cockpit's Repos panel (lean), not in a new Settings view.

## Seams for the deferred cloud move

Workspace-relative paths in tools; no absolute paths in Postgres; git SHAs as the durable state of a
checkout; credentials behind one interface (`GitHubApp`) that never reaches the sandbox; the workspace
root and git and API bases are configuration, not constants.

## Schema (migration `0009_repos`)

- `github_app`: `id` (bigint, the App id), `slug`, `owner_login`, `html_url`, `created_at`. At most one
  row; connecting again replaces it.
- `venture_repos`: `id`, `venture_id`, `github_repo_id` (bigint), `installation_id` (bigint),
  `full_name`, `default_branch`, `status` (`cloning`, `ready`, `failed`, `no_access`), `error`
  (nullable), `mirror_head_sha` (nullable), `fetched_at` (nullable), `allowed_domains` (text[], default
  `{}`), `added_by`, `created_at`, `updated_at`, `removed_at`. One live row per `github_repo_id`.
- `checkouts`: `id`, `thread_id`, `repo_id`, `dir` (relative to the thread folder), `branch`,
  `base_sha`, `checkpoint_sha` (nullable), `created_at`, `updated_at`, `removed_at`. One live row per
  thread and repo.
- `pull_requests`: `id`, `thread_id`, `repo_id`, `run_id` (nullable), `number`, `url`, `title`,
  `branch`, `state` (`open`, `closed`, `merged`), `head_sha`, `created_by`, `created_at`,
  `updated_at`. Unique per repo and number.
- `agent_grants` and `access_requests` accept `code`.
- The agent reader role can select the new tables.

## Commands

Owner:
- `github.connect` (appId, slug, ownerLogin, htmlUrl): global, run by the manifest callback once the
  key is saved.
- `venture.add_repo` (ventureId, githubRepoId, installationId, fullName, defaultBranch): refuses a repo
  already live on a venture (`repo_taken`); queues the mirror job; event `repo.added`.
- `venture.update_repo` (ventureId, repoId, allowedDomains): event `repo.updated`.
- `venture.remove_repo` (ventureId, repoId): refused while a braise PR on it is open
  (`repo_has_open_prs`); removes the thread checkouts of the repo; event `repo.removed`.
- `repo.fetch` (repoId): global; queues the mirror job.

Agent, under `code`:
- `repo.push` (ventureId, threadId, repoId): pushes the thread's branch; event `repo.pushed`.
- `pr.open` (ventureId, threadId, repoId, title, body, draft): pushes, opens the PR, records it, posts a
  braise line in the thread; event `pr.opened`.
- `pr.update` (ventureId, pullRequestId, title, body): edits the PR on GitHub; event `pr.updated`.

All three are owner-allowed too (the owner may push or open from a thread), but only agents use them in
this slice.

## Tools

For every thread of a venture with repos: `checkout_repo(repo)`, `read(file_path, offset, limit)`,
`write(file_path, content)`, `edit(file_path, old_string, new_string, replace_all)`,
`bash(command, timeout)`, `push_branch(repo)`, `open_pull_request(repo, title, body, draft)`,
`update_pull_request(repo, title, body)` and `pull_request_status(repo)`. Paths are relative to the
thread folder (`<dir>/src/x.ts`) or absolute inside it. `repo` is the full name or the repo id.

## Reads

- `GET /api/github`: the App (or null), its installations read live, and the install URL.
- `GET /api/github/repos`: the repos every installation can reach, with the venture each is on.
- `GET /api/ventures/:slug/repos`: a venture's repos.
- `GET /api/threads/:id/code`: the thread's checkouts and pull requests, with PR state refreshed from
  GitHub.
- `GET /api/github/connect`, `/api/github/callback`, `/api/github/installed`: the manifest flow's
  browser steps.

## UI requirements

Designed through `impeccable` against `ui-prototype-6.html` and `packages/web/DESIGN.md` (the
prototype wins on conflict):
- Cockpit aside: a Repos panel. Not connected: one line of why and "Connect GitHub". Connected: each
  repo with its status (Cloning, Ready, Failed with the error, No access with a link to the App's
  repository selection), default branch, fetched time, Fetch, and Remove in its menu; "Add repo" opens
  a picker of reachable repos; "Choose repositories on GitHub" links to the installation.
- Thread: a Code strip under the header when the thread has checkouts or pull requests: repo, branch,
  base → checkpoint SHAs, and each PR as `#N title` with its state, linking to GitHub.
- Trace: `bash` rows show the command and its output; `edit`/`write` rows the file.
- Agents view: the `code` switch comes with the capability list.

## Tests (against real Postgres, real git, real srt; GitHub's API on MSW)

- Repo rules: owner-only, `repo_taken`, `repo_has_open_prs`, removal removes checkouts; events.
- `github.connect` stores the App; the key file is written 0600 outside Postgres.
- The App JWT verifies with the App's public key; token mint requests are scoped to one repo and the
  permissions asked; a 404 or 422 mint turns the repo `no_access`.
- Mirror job against a local bare "GitHub" repo: status ready, SHA and fetched time; a failed clone is
  `failed` with the error.
- `checkout_repo` makes a `--shared` clone on `braise/<slug>`, records base SHA, and is idempotent.
- Path guard: `..`, absolute paths outside, and symlinks out of the folder are refused.
- `edit` refuses a missing or ambiguous `old_string`.
- Sandbox (real srt): writes in the thread folder succeed; writes elsewhere, reads of the keys folder and
  of another thread's folder fail; github.com is denied; `DATABASE_URL` is not in the environment; a
  timeout kills the command.
- `repo.push` and `pr.open` without `code` file one access request; with `code`, the branch lands in the
  local "GitHub" repo, a malicious `pre-push` hook in the checkout does not run, the PR request body
  reaches MSW, `pull_requests` has the row, the thread has the braise line; a second `pr.open` is
  `pr_exists`.
- `pull_request_status` reads checks and comments from MSW and refreshes the state; all PRs merged
  removes the thread's checkouts, as does archiving the thread.
- Checkpoints: a run's end records the checkout's HEAD.
