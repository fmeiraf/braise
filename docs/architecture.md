# Braise architecture

Living document. Rules change only through a recorded decision (see Decisions log).
Review the rules whenever a slice lands.

## What braise is

A local-first holding for all of the owner's product ventures. It covers the why and
what, the strategy, and the execution of each venture. Agents (Pi + Codex, Claude Agent
SDK) work on ventures in threads, with live feedback, within permissions the owner
grants and revokes.

Builds parts of Linear (project management) and Slack (threads, bots) as building
blocks, not as products in their own right.

## Vocabulary

- **Venture**: a product project (for profit or not) with its own GitHub repo(s).
  Identity only: name, slug, kind.
- **Strategy**: versioned per venture (Rumelt kernel): why, what, diagnosis, guiding
  policy. Exactly one active version; agent proposals are drafts.
- **Bet**: a hypothesis + action + kill criteria, with its own lifecycle
  (open/won/lost/killed). Belongs to the venture, records the strategy version that
  introduced it.
- **Goal**: an outcome with a measurable signal and a horizon (date). Optionally tests
  a bet; goals without a bet are flagged in the UI.
- **Work item**: recursive tree (initiative → task → subtask), linked to a goal and
  tagged by function (engineering, marketing, ops, ...).
- **Thread**: a conversation tied to a venture, work item or proposal; humans and
  agents post in it.
- **Agent profile**: role/playbook, runtime, model, tools and grants.
- **Run**: an agent working within a thread; emits run events.
- **Proposal**: a change set proposed by an agent; applied only when the owner approves.
- **Inbox**: items needing the owner: `proposal`, `access_request`, `needs_input`,
  `decision`.
- **Slice**: an end-to-end step in building braise itself. Not venture vocabulary.

## Architecture

```
 UI (SPA) ───────┐
 CLI / MCP tools ┼──▶  braise API  ──▶  Postgres
 Agent runners ──┘     (only writer)    (state · events · job queue)
       ▲                    │
       └── pull jobs ───────┘       Filesystem = venture repos + run worktrees only
```

- Postgres (Docker locally), Drizzle, plain SQL migrations.
- State tables + append-only event log (not full event sourcing).
- Knowledge/strategy/goals are versioned through append-only revision tables.
- Snapshot = `(venture_id, seq)` + repo commit SHAs.

### Event logs

**Domain events** (`events`): permanent, low volume.
- PK `(venture_id, seq)`; `seq` is per venture, gapless and in commit order, assigned
  by `UPDATE ventures SET last_seq = last_seq + 1 RETURNING last_seq` inside the
  command transaction. Never order by `bigserial`, because commit order differs from
  id order under concurrency.
- Columns: `type`, `subject`, `payload jsonb`, `actor`, `run_id`, `causation_id`,
  `idempotency_key` (unique), `created_at`.

**Run events** (`run_events`): high volume, prunable. `(run_id, seq, type, payload)`.
Stores finished messages and tool calls; token deltas are live-only or batched.

**Delivery**
- Live: after commit, `NOTIFY` with ids only (payload limit about 8KB); SSE to the UI
  with `seq` as `Last-Event-ID`.
- Reactions: each consumer keeps an offset in `consumer_offsets`.
- Jobs: pg-boss, separate from events.

## Rules

### Architecture invariants
1. The API is the only writer. The UI, CLI, MCP tools and runners are all clients.
2. Every change is a command: one transaction covers the state change, its event(s)
   and the idempotency record. The one exception is a run's own lifecycle (run status,
   run events, the agent's saved reply), which the runner writes directly; anything an
   agent changes in braise is still a command.
3. Postgres holds all state. The filesystem holds only repos and run worktrees.
4. Grants are enforced in the API, not in the tools. An out-of-grant attempt becomes
   an inbox `access_request`, never a silent failure.
5. Agents never directly change knowledge, strategy or big decisions. They propose,
   and the owner approves.
6. Every change records its actor, run and reason.
7. Runners don't depend on the runtime or on where they run. They emit normalised
   run events and pull jobs from the queue.
8. Domain events and run events stay separate.

### Process rules (building braise)
1. Each slice runs end to end and has a demo scenario as its acceptance test.
2. No speculative schema. A table or column arrives with the slice that uses it.
3. When a slice lands, review these rules and log any change below.
4. A rule changes only by a recorded decision. Breaking a rule means changing the
   rule first.
5. Every UI step (design, structure, code, copy, polish) goes through the
   `impeccable` skill, which is installed in the repo at `.agents/skills/impeccable`.
   It is mandatory; see `AGENTS.md`.
6. Code must pass the landmines oxlint rules (`recommended`, `restriction`, `style`;
   warnings fail) in pre-commit and CI. Tests use real implementations, never test
   doubles. See `AGENTS.md`.

## Slices

Planned (order may change):
1. **Strategy spine:** venture → strategy (versioned) → bets → goals; command
   pipeline, event log, live updates, history. Spec: `docs/slices/01-strategy-spine.md`.
2. **Work items under goals:** initiative → task → subtask under goals, function
   tags, manual order, the Work view. Spec: `docs/slices/02-work-items.md`.
3. **Agent threads, streaming live (Claude Agent SDK):** threads linked to work, runs
   and run events, the Claude runner. Spec: `docs/slices/03-agent-threads.md`.
4. **Agent proposal → inbox → owner approves:** agent change sets for strategy, bets
   and goals, the global inbox, owner edits, staleness. Spec:
   `docs/slices/04-proposals-inbox.md`.
5. **Grants, access requests and the Pi runner:** agent profiles in Postgres,
   capabilities granted per profile, access requests in the inbox, the Agents view, GPT
   on Pi. Spec: `docs/slices/05-grants-pi.md`.

Milestone: braise manages itself as a venture (dogfooding).

### Slice log
- **Slice 1, Strategy spine** (2026-11-24): ventures, versioned strategy, bets, goals;
  the command pipeline (idempotency on `commands`, venture row lock, gapless `seq`,
  NOTIFY in the transaction); reads; SSE hints; the web app (Holding table, cockpit,
  strategy history with word diff, activity). Demo scenario 1–7 verified in the
  running app; the spec's tests pass against real Postgres.
  Rule review (process rule 3): the invariants and process rules held unchanged. The
  decisions dated 2026-11-24 below record what the slice settled.
- **Slice 2, Work items under goals** (2026-11-24): `work_items` (at most three
  levels under a goal, fixed function list, priority, dense manual order); commands
  `work.create/update/set_status/move/archive` through the unchanged pipeline;
  `goal_has_work`; the Work view (venture and Holding scope, keyboard tree, detail
  pane) and goal progress in the cockpit. Demo scenario 1–7 verified in the running
  app; the spec's tests pass against real Postgres.
  Rule review (process rule 3): the invariants and process rules held unchanged; the
  slice added only handlers, events and one table. The decisions below record what it
  settled.
- **Slice 3, Agent threads** (2026-11-24): threads in Holding or venture scope, linked
  to work items, goals, bets and ventures; runs and run events; the pg-boss worker and
  the Claude Agent SDK adapter with braise tools (read-only SQL, work item writes,
  thread links); per-thread live streaming; the Threads view, threads on the work
  item pane and the rail's live-runs count. Demo scenario 1–7 verified in the running
  app with real Claude runs; the spec's tests pass against real Postgres.
  Rule review (process rule 3): invariant 2 changed (a run's own lifecycle is written
  by the runner, not as commands; recorded below). Invariant 6 now holds for agents:
  commands and events carry `run_id`. Invariants 4 and 5 hold through a fixed agent
  command allowlist enforced in the pipeline until grants (slice 5) and proposals
  (slice 4) replace it. Invariant 7 holds through the runtime contract
  (`packages/api/src/agent/runtime.ts`). The process rules held unchanged.
- **Slice 4, Proposals and the inbox** (2026-11-24): `proposals` (a change set of
  `strategy.revise`, `bet.*` and `goal.*` commands with a base per change); commands
  `proposal.create` (agent, dry-run in a savepoint), `proposal.approve` (owner edits
  and drops, applied atomically through the existing handlers, stale changes refused)
  and `proposal.reject`; decision lines in the proposing thread; the agent's
  `propose_changes` tool; the Inbox view, the rail's pending count and the cockpit's
  Needs you list. Demo scenario 1–6 verified in the running app with real Claude runs;
  the spec's tests pass against real Postgres.
  Rule review (process rule 3): invariant 5 now holds through proposals rather than
  only by refusal; agents still can't apply strategy, bet or goal changes, and
  `proposal.approve`/`reject` are owner-only in the pipeline. Invariant 6 holds:
  applied changes are recorded under the owner with the approve command's reason, and
  their events carry `proposalId`, which leads back to the agent's run. Invariant 2
  holds: approve is one command, so the applied events share one transaction and
  one `seq` range. The process rules held unchanged.
- **Slice 5, Grants, access requests and Pi** (2026-11-24): `agent_profiles` (moved
  from code), `agent_grants` and `access_requests`; the fixed allowlist replaced by
  capabilities checked per command in the pipeline; `access.request` filed by the API on
  every out-of-grant attempt; `access.approve/deny` and `grant.add/revoke` as global
  commands with braise lines in the requesting thread; access requests in the inbox, the
  Agents view, the agent picker on new threads; GPT on Pi (`pi-agent-core` + `pi-ai`,
  `openai-codex` over SSE) behind the unchanged runtime contract, with the worker
  choosing the runtime per run. Demo scenario 1–6 verified in the running app with real
  GPT and Claude runs; the spec's tests pass against real Postgres, and the Pi adapter
  runs in-process against MSW serving a recorded Codex stream.
  Rule review (process rule 3): invariant 4 now holds as written: grants are enforced
  in the pipeline and an out-of-grant attempt becomes an inbox `access_request`; owner-only
  commands are refused outright, since no grant could allow them. Invariant 7 holds with
  a second runtime: the Pi adapter needed no change to the contract. Invariant 3 holds:
  Pi runs without durability, and its OAuth tokens stay in Pi's own login file (a login,
  not braise state). Invariant 8 holds: grant and access commands write no domain events,
  and their record is the `commands` table plus the grant and request rows. The process
  rules held unchanged.

## Decisions log

- 2026-11-23: All state in Postgres; filesystem is repos only (replaces a files-first
  idea).
- 2026-11-23: Postgres over SQLite, for robustness, idempotency and a later move to
  the cloud. Docker locally.
- 2026-11-23: Drizzle for data access.
- 2026-11-23: Event log is a Postgres table written in the command transaction, with
  per-venture gapless `seq`. Domain and run events are kept separate.
- 2026-11-23: Owner approves all knowledge/strategy/big-decision changes via the inbox.
- 2026-11-23: Agent permissions are grants enforced by the API, revocable at any time.
- 2026-11-23: Strategy is a separate, versioned entity (why/what/diagnosis/guiding
  policy); bets link strategy to goals. Goal → bet is nullable.
- 2026-11-23: Idempotency key on `commands` (stores the result for replay; same key +
  different payload → 409), not on `events`.
- 2026-11-24: The impeccable skill is mandatory for all UI work; it is vendored into the repo
  (`.agents/skills/impeccable`, v4.10.0, symlinked from `.claude/skills`).
- 2026-11-24: UI topology: persistent sidebar; scope (Holding or a venture) filters
  views; attention (inbox, live runs) is global and never scoped.
- 2026-11-24: Local dev: only Postgres runs in Docker; the API and web run natively;
  seeding is manual.
- 2026-11-24: oxlint + @interfere/landmines (recommended, restriction, style) runs
  alongside Biome, with `--deny-warnings`. oxlint's built-in rules are off, because
  Biome owns general linting. Scripts renamed to standard names: `check` → `lint` +
  `typecheck`, and `test:watch` dropped (use `npx vitest`).
- 2026-11-24: Local ports: Postgres `127.0.0.1:54329`, API `4400`, web `5400`
  (strict). `3000` and `5173` are taken by other local projects.
- 2026-11-24: Operational tasks live in a `braise` bin shipped by `@braise/api`
  (`serve [--watch]`, `migrate`, `reset`, `seed`), not in package scripts, so
  landmines `package-scripts` stays at its defaults. `reset` refuses non-local hosts;
  `seed` goes through the command pipeline with fixed idempotency keys, so rerunning
  it is a no-op.
- 2026-11-24: Postgres suites in `packages/api/test/` are named
  `*.integration.test.ts` / `*.e2e.test.ts`, which landmines
  `test-dir-only-cross-functional` recognises as cross-functional.
- 2026-11-24: `bet.archive` is refused (422 `bet_has_goals`) while the bet has live
  goals; archive or move them first, so no goal points at an archived bet.
- 2026-11-24: `GET /api/events?limit=` returns recent events across ventures, for
  the Holding-scope Activity view.
- 2026-11-24: The SSE stream sends a `ping` every 15s; the client treats 35s of
  silence as down and reopens the stream itself when the browser gives up, so the
  reconnect indicator is truthful behind proxies.
- 2026-11-24: The web app uses native controls (select, radio groups, plain
  disclosure) instead of Radix or Base UI; slice 1 needs no headless primitives.
- 2026-11-24: Visual direction for the app pinned by the owner: Linear and Slack
  craft level on the braise.exe brand kit (charcoal rail, near-cream work area, ember
  for actions/selection/state, pixel-square status markers, the strategy spine).
  Contract: `packages/web/.impeccable/surfaces/index-html.md`.
- 2026-11-24: New identity, chosen by the owner from four directions: Growth Rings.
  Replaces braise.exe and the pinned visual direction above. Pith rail, sage-white
  ground, resin for primary action and live state, a ring hue per venture, round
  markers, Bricolage Grotesque / Geist / Geist Mono self-hosted via `@fontsource-variable`.
  Live state is shown by rings growing (mark, venture glyph, cockpit core sample).
- 2026-11-24: Work item model, chosen by the owner: status `todo`/`doing`/`done` set
  by hand (parents show derived progress, no roll-up); a root names a goal and
  children inherit it; at most three levels, kind named by depth; one function from a
  fixed list (children default to the parent's); priority; manual order.
- 2026-11-24: Every work item stores its root's `goal_id`, a fixed `depth` and a dense
  sibling `position`. Children are never reparented in slice 2, so depth never changes;
  moving a root to another goal moves its subtree in the same command.
- 2026-11-24: `goal.archive` is refused (422 `goal_has_work`) while the goal has live
  work. `work.archive` archives the item's subtree and emits one `work.archived`
  event carrying the archived ids.
- 2026-11-24: Web clients derive the idempotency key from the user's intent: the
  key is kept while the same payload is retried and replaced when the payload
  changes or the command succeeds. It lives in a ref, not React state, so two quick
  commands never share a key.
- 2026-11-24: Agent runtimes by model family, behind one braise contract: Anthropic
  models on the Claude Agent SDK, GPT on its own runtime, the rest on Pi + pi-durable
  (superseded for GPT in slice 5: GPT runs on Pi).
  Each runtime owns its loop and durability; braise owns threads, runs, run events and
  jobs. pi-durable stores only in SQLite/JSONL/IndexedDB/Chord (checked at 1.6.0), so
  the Pi adapter's storage is decided in slice 5.
- 2026-11-24: Threads belong to the Holding or one venture and link to many work
  items, goals, bets or ventures (`thread_links`); a venture thread links only to its
  venture's items. Thread commands go through the pipeline but are sequenced per
  thread and write no domain events (chat is not domain history).
- 2026-11-24: Invariant 2 narrowed: a run's lifecycle (status, run events, the saved
  reply) is written by the runner directly. Commands for each tool call and message
  would add a transaction per token-burst for no audit gain; what agents change in
  braise stays a command with actor `agent:<name>` and the run id.
- 2026-11-24: Run engine: the command writes a `queued` run; the pg-boss job is sent
  after commit (pg-boss can join our transaction only through a custom adapter), is
  re-sent for every queued run at startup, and the worker claims runs atomically, so
  duplicate jobs are no-ops. One active run per thread, two at once overall. A restart
  marks running runs `interrupted` (keeping their partial text) and the owner retries;
  there is no auto-resume and no durability layer on top of the Agent SDK.
- 2026-11-24: Claude runs with `claude-opus-5-5` (override `BRAISE_AGENT_MODEL`, removed
  in slice 5) on the
  owner's local Claude Code login; no API key. The Agent SDK runs with built-in tools
  off, `persistSession: false` (no transcripts on disk, invariant 3) and the braise
  tools as an in-process MCP server; each run rebuilds its context from Postgres. The
  SDK's alpha `sessionStore` is the upgrade path if tool context across runs matters.
- 2026-11-24: Agent access until grants (slice 5): reads through one read-only SQL tool
  as the `braise_agent_reader` role (no `commands` table, 5s timeout, 200 rows) plus a
  schema tool; writes through `work.create/update/set_status/move` and
  `thread.link/unlink` only. Any other command from an agent actor is refused with 403
  `not_granted` in the pipeline. Write tools are idempotent per (run, tool payload).
- 2026-11-24: Token deltas are live only: the worker sends them over `NOTIFY` (chunks
  under the 8KB limit) to a per-thread SSE stream; finished messages, tool calls and
  results are `run_events`, and the agent's reply is a thread message. A stopped or
  interrupted run saves its unfinished text block. No run-event pruning yet.
- 2026-11-24: The Agent SDK is not exercised in automated tests (it runs Claude Code as
  a child process, out of reach of in-process MSW): the SDK-message mapping is
  unit-tested against recorded fixtures, everything else against real Postgres.
- 2026-11-24: Threads UI: a Threads rail entry with a list and a Slack-style
  conversation; each round of tool calls folds into one collapsed toggle before the
  reply text; live state uses a slow ember pulse on square pixels.
- 2026-11-24: Proposals (owner): agents propose `strategy.revise`, `bet.create/update/
  set_status` and `goal.create/update` as one change set per venture; work item writes
  stay direct; archives and venture fields stay owner-only. The owner approves (editing
  fields or dropping changes, never adding) or rejects, with an optional note. A goal
  may test a new bet of the same proposal through `{ "ref": <index> }`.
- 2026-11-24: Each proposed change records its base (strategy version, or the bet's or
  goal's `updated_at`), set by the API. A change whose base moved is stale, and approve
  refuses it (422 `proposal_stale`); there is no rebase.
- 2026-11-24: `proposal.create` dry-runs the changes through the real handlers in a
  savepoint and rolls back, so the agent gets rule errors when it proposes, not at approval.
- 2026-11-24: `proposal.approve` requires a reason (prefilled from the agent's), which
  becomes the strategy revision's reason. Applied changes are recorded with actor `owner`, and
  their events carry `proposalId`.
- 2026-11-24: Decisions post a thread message with author `braise` (a system line, never
  an owner message); it starts no run, and the agent reads it in its transcript next
  time. `needs_input` is deferred.
- 2026-11-24: Inbox UI: a global `/inbox` list and review pane, a pending count in the
  rail (a resin badge: the one attention signal in the rail), and a per-venture Needs you
  list in the cockpit aside.
- 2026-11-24: Grants (owner): named capabilities (`work`, `links`, `propose`) held by
  an agent profile across all ventures, fixed in `@braise/core`. Agents see every tool;
  the pipeline refuses a command whose capability the profile doesn't hold. Owner-only
  commands belong to no capability and are refused without an access request. Reads
  stay open through the reader role and are not a grant.
- 2026-11-24: Agent profiles live in `agent_profiles` (seeded by migration: Claude with
  all three capabilities, keeping its slice 4 access, and GPT with none). The model is a
  column on the profile; `BRAISE_AGENT_MODEL` is gone. A thread picks its profile when it
  starts (default Claude) and every run in it uses that profile.
- 2026-11-24: Access requests (owner): an out-of-grant attempt runs `access.request` as
  the agent with the same run, then answers 403 `not_granted` with the request id; the
  tool turns that into a non-error "Access requested" result and the run continues. One
  pending request per profile and capability (later attempts bump `attempts`).
  Approving grants the capability until revoked; nothing is replayed. Approve and deny
  post a braise line in the requesting thread.
- 2026-11-24: Grant and access commands are global: no venture lock, no domain events, a
  third pipeline outcome that `NOTIFY`s an `access` hint over SSE. Grant history lives in
  `agent_grants` rows (revoking closes a row, granting adds one). Revoking takes effect on
  the agent's next command; running runs are not stopped.
- 2026-11-24: Pi runtime (owner): GPT models run on Pi (`@earendil-works/pi-agent-core`
  and `pi-ai` 1.6.0, pinned) with the `openai-codex` provider on the owner's Pi login, no
  API key, transport SSE. No pi-durable and no session storage: like Claude, a restart
  marks running runs interrupted and the owner retries. GPT's model is `gpt-6.2-sol`, the
  newest in pi-ai 1.6.0's Codex catalog.
- 2026-11-24: braise reads and refreshes Pi's `auth.json` through its own small
  `CredentialStore`, locked with `proper-lockfile` on the same file Pi locks, so braise and
  the `pi` CLI never write it at once. `PI_CODING_AGENT_DIR` moves it, as for Pi.
- 2026-11-24: The Pi adapter is tested in-process against MSW serving a recorded Codex
  stream (scrubbed of account identifiers), unlike the Claude adapter, whose SDK runs in a
  child process.
- 2026-11-24: braise's workspace export condition is `@braise/source`, not `source`,
  because published dependencies (Pi's packages) claim `source` for files they don't ship.
- 2026-11-24: Agents UI: an Agents entry in the rail's attention section with one switch
  per capability (no confirmation; reversible and recorded), access requests in the
  global inbox beside proposals, and a "with <agent>" picker on new threads.
- 2026-11-25: UI v6 (owner: "implement v6 fully as the new UI"): the web app follows
  `ui-prototype-6.html`. Dark warm-neutral surfaces, the system type stack, colour only
  where it means something (venture hue, amber for "needs you", green and red for diffs
  and outcomes). It replaces the Growth Rings look in the app (2026-11-24); the brand kit
  in `assets/` is unchanged and no longer drives the app's palette or fonts. Contract:
  `packages/web/DESIGN.md`. impeccable stays mandatory for UI work; where its guidance
  conflicts with the approved prototype, the prototype wins.
- 2026-11-25: UI topology: a rail of ventures, no top bar, and a bottom dock (scope
  switcher, Overview, Work, Threads, Activity, then Inbox and Agents) with agent chips
  beside it. Replaces the persistent sidebar (2026-11-24). Scope still filters views and
  attention stays global. Keys: 1–4, I, A, H and ⌘K for the command menu.
- 2026-11-25: The web app draws its own menu (a button with a listbox), tooltips, toasts
  and command menu instead of native selects and `title` attributes. Replaces "native
  controls" (2026-11-24); still no Radix or Base UI, and no icon library.
- 2026-11-25: A venture's colour (one of six hues) and its crest are derived from its
  slug in the web client; nothing is stored, and a slug never changes. Bets are numbered
  B1, B2, … by creation order among a venture's live bets, also in the client only.
- 2026-11-25: Threads UI: the owner's messages are bubbles and an agent run is a trace of
  steps; each tool call is its own row that opens to its input and output, and Stop sits
  on the live step. Replaces the folded tool rounds and square pixels (2026-11-24).
- 2026-11-25: No new endpoints for v6. The Holding reads each venture's cockpit for the
  card text and work totals; the agent behind a run is found through the thread list.
- 2026-11-25: `packages/web/src/styles.css` keeps every `animation` and `transition`
  inside `@media (prefers-reduced-motion: no-preference)`, so reduced motion needs no
  `!important`.
- 2026-11-25: Biome skips the design prototypes and sketches at the repo root
  (`ui-prototype*.html`, `model-sheet.html`). They are references, not shipped code.
