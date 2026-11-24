# Slice 1: Strategy spine

Status: **specified**, not started. This is the build spec; the rules in
`docs/architecture.md` apply throughout.

## Goal

Prove the backbone every later slice depends on: one write path (command →
transaction → state + event → NOTIFY → UI), built once on the simplest real domain:
venture → strategy (versioned) → bets → goals.

## Demo scenario (acceptance)

1. `npm run db:up`, `npm run dev`, then open the app.
2. First run: the empty state is the create-venture form. Create a venture with name,
   kind, why and what (diagnosis and guiding policy may be left empty).
3. Revise the strategy with a reason. Strategy history shows v1 → v2 with a
   word-level diff and the reason.
4. Add a bet, then add two goals: one tied to the bet, one not tied to a bet (shown in
   the quiet "Not tied to a bet" group).
5. Edit a goal inline. The activity feed shows the events with actor `owner`.
6. With two tabs open, a change in one appears in the other without a refresh.
7. Sending the same command twice with the same idempotency key creates one goal.
   Reusing the key with a different payload returns 409.

## In / out of scope

**In:** ventures, versioned strategy, bets, goals, command pipeline, event log, live
hints, activity and history, the Holding table, the cockpit.

**Out:** auth (actor hardcoded to `owner`), grants, inbox, proposals, work items,
agents and threads, linking repos, the ⌘K palette, mobile layouts, goal status.
Archive only, never hard-delete.

## Packages

```
packages/core  @braise/core  command/event/entity zod schemas, pure types; no I/O
packages/api   @braise/api   Hono server, pipeline, handlers, queries, SSE, Drizzle schema + migrations
packages/web   @braise/web   Vite + React SPA
```

`web` talks to `api` only over HTTP. The database lives inside `api`, so nothing else
can import it (invariant 1 enforced by package structure).

## Schema

```sql
ventures
  id uuid PK (UUIDv7, generated in the app) · slug text UNIQUE · name text
  kind text CHECK (kind IN ('for_profit','non_profit'))
  last_seq bigint NOT NULL DEFAULT 0
  created_at, updated_at timestamptz · archived_at timestamptz NULL

strategy_versions
  id uuid PK · venture_id FK · version int (per venture)
  status text CHECK (status IN ('draft','active','superseded'))
  why text NOT NULL · what text NOT NULL
  diagnosis text NOT NULL DEFAULT '' · guiding_policy text NOT NULL DEFAULT ''
  created_by text · created_at · activated_at NULL
  UNIQUE (venture_id, version)
  UNIQUE (venture_id) WHERE status = 'active'     -- hand-written SQL

bets
  id uuid PK · venture_id FK
  hypothesis text · action text · kill_criteria text
  status text CHECK (status IN ('open','won','lost','killed')) DEFAULT 'open'
  introduced_in uuid FK → strategy_versions
  created_at, updated_at · archived_at NULL

goals
  id uuid PK · venture_id FK · bet_id uuid NULL FK → bets
  outcome text · signal text · horizon date NULL
  created_at, updated_at · archived_at NULL

commands
  id uuid PK · idempotency_key text UNIQUE · name text · venture_id uuid NULL
  actor text · reason text NULL · payload jsonb · payload_hash text · result jsonb
  created_at

events
  venture_id FK · seq bigint · command_id FK → commands
  type text · subject text · payload jsonb · actor text · created_at
  PRIMARY KEY (venture_id, seq)
```

- Update events store `{ field: { from, to } }` for each changed field.
- `venture.created` is seq 1 of each venture's log.
- A goal's `bet_id` must reference a bet in the same venture (422 otherwise).

## Commands

| Command | Effect | Notes |
|---|---|---|
| `venture.create` | venture + strategy v1 (active) | slug derived from name, editable |
| `venture.archive` | sets `archived_at` | |
| `strategy.revise` | new active version; previous → superseded | **`reason` required** |
| `bet.create` / `bet.update` / `bet.archive` | | |
| `bet.set_status` | open → won/lost/killed | UI asks whether to archive its goals; never automatic |
| `goal.create` / `goal.update` / `goal.archive` | | |

Owner edits apply immediately. Draft strategy versions exist only for agent
proposals (slice 4).

### Pipeline

```
POST /api/commands/:name  { payload, idempotencyKey, reason? }
 1. look up the command and validate the payload against its zod schema     → 400 validation_failed
 2. BEGIN (READ COMMITTED)
 3. INSERT commands … ON CONFLICT (idempotency_key) DO NOTHING
      conflict + same hash → return the stored result · different hash     → 409 idempotency_conflict
 4. SELECT ventures … FOR UPDATE (lock before reading)                      → 404 not_found
 5. handler(tx, payload, actor) → { result, events[] }                      → 422 rule_violated
 6. UPDATE ventures SET last_seq = last_seq + n RETURNING · INSERT events
 7. UPDATE commands SET result
 8. pg_notify('venture_events', '<venture_id>:<last_seq>')
 9. COMMIT → { result: <full entity>, seq }
```

- Errors use the shape `{ error: { code, message, details } }` with stable codes.
- Failed commands roll back completely, so the key can be retried.
- Clients generate one idempotency key per user intent.
- Command schemas live in `core`; handlers live in `api`. Validation, idempotency,
  locking, seqs and NOTIFY are written once, in the pipeline.

## Reads and live updates

| Endpoint | Returns |
|---|---|
| `GET /api/ventures` | Holding table rows |
| `GET /api/ventures/:slug` | cockpit: venture, active strategy, bets, goals |
| `GET /api/ventures/:slug/strategy/versions[?version=n]` | version history |
| `GET /api/ventures/:slug/events?before=<seq>&limit=50` | activity, newest first |
| `GET /api/stream` | global SSE hints |

- **Hints, not data:** SSE sends `{ ventureId, seq }`. The client invalidates
  `['venture', id]` queries, skipping hints older than the seq it already has. On
  reconnect it invalidates everything.
- One dedicated LISTEN connection, outside the pool. If it drops: reconnect and
  broadcast "invalidate all".
- Command results are written into the query cache. No optimistic updates.
- Event labels are rendered on the client from event payloads.

## UI brief (impeccable: shape)

**Mode:** Operate on every surface. Precision and restraint; the brand
(`assets/brand.css`, binding) shows in the details. Ember is used only for primary
actions, selection and state.

**Topology:** a persistent left sidebar.

```
Inbox (n)        global, never scoped                (slice 4: placeholder only now)
● n running      global live runs                    (slice 3)
──────────
Holding          scope: all ventures
<ventures…>      every venture; picking one sets the scope (dot = activity)
──────────
Overview         cockpit, or the Holding table
Threads          (slice 3) · Work (slice 2)
Activity         scoped event feed
```

Scope filters the views; attention (inbox, live runs) is never scoped. Picking a
venture always opens its cockpit.

**Surfaces:**
- **Holding table:** name, kind, open bets, goals, goals not tied to a bet, last
  activity. Sortable and dense.
- **Cockpit:**
  - Strategy panel at the top (why, what, diagnosis, guiding policy, "v3 · revised 2d
    ago"), collapsible.
  - Bets below, each with its goals nested under it and its status visible; killed
    and lost bets are muted and collapsed.
  - A quiet "Not tied to a bet" group at the end.
  - The recent activity feed (last 10) in the right column.
- **Strategy history:** a version list with a word-level diff between any two
  versions, plus each change's reason.
- **Activity:** the full scoped event log, paged.

**Interaction:**
- Inline editing for bets and goals: Enter saves, Esc cancels.
- Strategy is edited in place as a whole. **Save as v(n+1)** reveals the required
  reason inline. No modals.

**States:**
- First run: the empty state is the create form.
- Empty diagnosis or policy: shown as prompts.
- A bet with no goals.
- Loading skeletons.
- Inline errors keyed to the API error codes.
- A reconnect indicator, shown only while SSE is down.

**Boundaries:** desktop-first (about 1024px minimum width); no mobile layout, no ⌘K.
The visual world (the brand kit turned into an app UI) is set at build time through
impeccable's new-work step, followed by its craft-floor check and a rendered
verification.

## Local dev

- `docker-compose.yml`: Postgres 17 only (named volume, healthcheck). Databases
  `braise` and `braise_test`. The API and web run natively.
- Drizzle Kit generates SQL migrations, which are committed and reviewed. Hand-written
  SQL covers partial indexes. The API runs pending migrations at startup in dev.
- Tasks: start the database, migrate, reset (clean, no seed), seed (manual; one
  labelled example venture), `dev` (API watch + Vite, proxying `/api`), `test`.
  landmines `package-scripts` rejects bespoke names like `db:up`. Prefer the
  tools' native commands (`docker compose up -d`, `drizzle-kit migrate`). For reset
  and seed, decide at build time: a standard name, or a recorded `names` allowlist
  entry.
- Tests: unit tests sit beside their subject; the Postgres integration and e2e suites
  go in `packages/api/test/`.
- `.env` (`DATABASE_URL`, `PORT`) with a committed `.env.example`.

## Tests (against real Postgres)

- The demo scenario as an end-to-end API test: create → revise → bet → goals →
  duplicate key → 409 → history.
- Concurrency: N parallel commands on one venture produce gapless, consecutive seqs.
- Concurrent duplicate idempotency keys produce one effect and the same result for
  both.
- Rollback: a 422 command leaves no `commands` row and no event.
- NOTIFY fires only after commit.
