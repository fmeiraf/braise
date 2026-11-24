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
   and the idempotency record.
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
3. Agent thread on a work item, streaming live (Claude Agent SDK).
4. Agent proposal → inbox → owner approves.
5. Grants and access requests; Pi runner as the second adapter.

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
