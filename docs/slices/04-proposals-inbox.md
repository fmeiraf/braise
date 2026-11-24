# Slice 4: Agent proposals, the inbox, owner approval

Status: **landed** 2026-11-24. This is the build spec; the rules in
`docs/architecture.md` apply throughout.

## Goal

Agents change strategy only through the owner (invariant 5). An agent in a thread
proposes a change set (a strategy revision, new or changed bets, goals) instead of
saying it can't. The proposal lands in a global **Inbox**. The owner reviews it as a
diff against the current state, edits fields or drops changes if needed, and approves
or rejects it, with an optional note. Approving applies every kept change atomically
through the command pipeline. The decision is posted back to the proposing thread, so
the agent sees it the next time the owner writes.

## Demo scenario (acceptance)

1. `docker compose up -d`, `npm run dev`, open http://127.0.0.1:5400. The rail shows
   **Inbox** with no count.
2. In Corner Bakery's Threads view, ask the agent: "Our diagnosis should mention the
   new competitor. Propose a strategy revision, plus a bet on a loyalty card with one
   goal that tests it." The run calls `propose_changes`. Its tool row reads
   "Proposed “…” · 3 changes" and links to the inbox item. The rail shows **Inbox 1**
   in every tab, live, and the cockpit's **Needs you** list shows the proposal.
3. Open the Inbox. The proposal shows the venture, the agent, the thread, the reason
   and three changes: the strategy revision as a word diff against the active version,
   the new bet, and the new goal pointing at "the bet above".
4. Edit the goal's signal, drop nothing, keep the prefilled reason, add the note
   "Signal tightened", then **Approve**. Strategy goes to the next version, the bet and
   goal exist and the goal tests the new bet. Activity shows `proposal.approved` and the
   applied events. The strategy history shows the version with the proposal's reason.
   The thread gets a braise line: "Approved “…” with edits · Signal tightened". The
   inbox count drops to 0.
5. Ask for another proposal that changes the same strategy. Before approving it, edit
   the strategy in the cockpit yourself. The proposal shows **Stale** on that change and
   Approve is refused. **Reject** with the note "Redo on the current version". The thread
   gets the braise line, and the next owner message gives the agent that context.
6. Ask the agent to archive a goal or rename the venture. It has no tool for that and
   says so.

## In / out of scope

**In:** the `proposals` table, the commands `proposal.create`, `proposal.approve` and
`proposal.reject`, the agent's `propose_changes` tool (with a dry run), per-change
staleness, owner edits and dropped changes, decision notes as braise messages in the
proposing thread, the global Inbox view, the rail's pending count, the cockpit's
**Needs you** list, live updates.

**Out:** `needs_input` (the agent asking mid-run), `access_request` and grants
(slice 5), `decision` items, proposals for venture fields, archives or work items, the
owner adding changes to a proposal, withdrawing or superseding proposals, rebasing
stale proposals, a run that starts by itself after a decision, proposals by the owner,
notifications outside the app.

## Decisions (from the owner, 2026-11-24)

- **Git:** `main` fast-forwarded locally to the Growth Rings commits, and slice 4 is built
  on `feat/slice-4-proposals-inbox`.
- **Proposable:** `strategy.revise`, `bet.create`, `bet.update`, `bet.set_status`,
  `goal.create`, `goal.update`. Work item writes stay direct, as in slice 3. Archives
  and venture fields stay owner-only.
- **Shape:** one proposal is an ordered change set for one venture, applied atomically
  on approve. The owner can edit the fields of each change and drop changes, but can't
  add any. Approve and reject take an optional note.
- **Staleness:** each change records what it was based on. If that changed, the
  change shows **Stale** and approving is refused (422 `proposal_stale`). The owner
  rejects and asks again; there is no rebase.
- **Inbox:** global (never scoped), with a pending count in the rail. The venture
  cockpit also lists that venture's pending proposals under **Needs you**, linking into
  the inbox.
- **`needs_input`:** later.
- **Outcome:** approve and reject post a braise message to the proposing thread. No
  run starts by itself; the agent reads the message in its transcript next time.

## Schema

```sql
proposals
  id uuid PK (UUIDv7) · venture_id uuid NOT NULL FK → ventures
  thread_id uuid NOT NULL FK → threads · run_id uuid NOT NULL FK → runs
  created_by text NOT NULL                 -- 'agent:claude'
  title text NOT NULL                      -- ≤ 120 chars
  reason text NOT NULL                     -- the agent's rationale
  changes jsonb NOT NULL                   -- [{ command, payload, base }], as proposed
  status text NOT NULL CHECK IN ('pending','approved','rejected')
  applied jsonb NULL                       -- [{ command, payload } | null] as approved (null = dropped)
  note text NULL                           -- the owner's decision note
  created_at · decided_at NULL
  INDEX (status, created_at) · INDEX (venture_id) · INDEX (thread_id)
```

- `base` is set by the API when the proposal is created, never by the agent:
  `{ strategyVersion }` for `strategy.revise`, `{ updatedAt }` of the bet or goal for
  `bet.update`, `bet.set_status` and `goal.update`, and `null` for creates.
- A change is **stale** when its base no longer matches: the active strategy version
  moved, or the bet or goal was updated or archived. Staleness is computed on read and
  checked again inside the approve transaction, before anything is applied.
- **References:** `goal.create` and `goal.update` may set `betId` to
  `{ "ref": <index> }`, pointing at an earlier `bet.create` in the same proposal.
  Applying resolves it to the new bet's id. You can't drop a `bet.create` that a kept
  change refers to (422 `proposal_ref_dropped`).
- The reader role gets `SELECT` on `proposals`.
- Thread messages gain the author `braise` for decision lines. They are not owner
  messages and start no run.

## Commands

All three are venture-scoped and go through the unchanged pipeline: one transaction,
the venture lock and gapless `seq`. Their events land in the venture's log.

| Command | Who | Effect | Notes |
|---|---|---|---|
| `proposal.create` | agent | validates the changes, dry-runs them, stores a `pending` proposal | `{ ventureId, threadId, title, reason, changes: [{ command, payload }] }`, 1–10 changes; each payload is validated by that command's schema (with `ref` allowed for `betId`); `ventureId` in each payload must equal the proposal's; the thread must be live and, when it has a venture, the same one (`proposal_out_of_scope`); the run comes from the request's `runId` (required: `proposal_needs_run`) |
| `proposal.approve` | owner | applies the kept changes in order, marks `approved`, posts the braise line | `{ ventureId, proposalId, changes: [{ payload } \| null], note? }` aligned with the proposal's changes (same length; commands can't change; at least one kept); **requires a reason**, which the UI prefills with the proposal's reason (it becomes the strategy revision's reason); refused if not `pending` (`proposal_decided`) or any kept change is stale (`proposal_stale`, details list the indexes) |
| `proposal.reject` | owner | marks `rejected`, posts the braise line | `{ ventureId, proposalId, note? }` |

- **Dry run:** `proposal.create` runs each change's handler inside a savepoint and
  rolls it back, so the agent gets rule errors (an unknown bet, `bet_not_open`,
  `no_changes`) as its tool result right away, not at approval time.
- **Apply:** `proposal.approve` calls the existing handlers in the same transaction
  with the same handler context (actor `owner`, the approve command's reason).
  Their events follow `proposal.approved` in one `seq` range, and each one carries
  `proposalId` in its payload. The events the dry run would have produced are never
  written.
- **Events:** `proposal.created` `{ proposalId, title, changeCount, threadId }` (actor
  `agent:claude`, the run), `proposal.approved` `{ proposalId, title, applied,
  dropped, edited }`, `proposal.rejected` `{ proposalId, title }`.
- **Thread line:** approve and reject lock the proposing thread, append a `braise`
  message ("Approved “title”", plus " with edits" and/or " · 1 change dropped",
  and the note), and `NOTIFY` the thread. If the thread is archived, no message is posted.
- **Grants:** `proposal.create` joins the agent allowlist. `proposal.approve` and
  `proposal.reject` stay owner-only, and the pipeline refuses agents (403
  `not_granted`).

## Agent tool

| Tool | Does |
|---|---|
| `propose_changes` | `{ ventureId, title, reason, changes }`, where `changes` is a list discriminated by `command` (the six proposable commands, the same fields as their payloads, without `ventureId`, and `betId` may be `{ ref }`). Runs `proposal.create` for the current thread and run. Returns the proposal id, each change's summary, and the inbox link, or the command's error. |

The system prompt changes from "proposals are coming later" to the following: strategy, bet
and goal changes go through `propose_changes`. Group related changes in one proposal and
give a reason. Don't apply them yourself, and don't propose the same change twice while
one is pending (the prompt lists the thread's pending proposals). The transcript renders
`braise` messages as "braise:" lines.

## Reads and live updates

| Endpoint | Returns |
|---|---|
| `GET /api/inbox` | `{ pending, decided }`: pending proposals (oldest first) and the 20 most recently decided. Each has id, venture (id, slug, name), title, change count, stale count, thread (id, title), `createdBy`, `createdAt`, status, `decidedAt` |
| `GET /api/proposals/:id` | the proposal, plus for each change: `command`, the proposed payload, the current values of the fields it touches (`null` for creates), `stale`, resolved references, and `applied` once decided |

- The pipeline's existing venture hint fires on every proposal event. The web client
  invalidates `['inbox']`, `['proposal', id]` and the cockpit on any venture hint, so
  the count and the lists update in every tab.
- Query keys: `['inbox']`, `['proposal', id]`.

## UI brief (impeccable, inside the established world)

**Mode:** Operate, in the Growth Rings system (`packages/web/DESIGN.md`, contract
`packages/web/.impeccable/surfaces/index-html.md`). DESIGN.md changes only with the
owner's approval.

**Topology:** **Inbox** in the rail's attention section (above the runs slot) links to
`/inbox`, the same in every scope. The open item is `?proposal=<id>`. The count shows
pending proposals in resin. When nothing is pending, there is no count.

**Inbox view:** a list pane and a review pane, like Threads. List rows: the venture's
ring marker and name, the title, "n changes", the age and a **Stale** tag when any
change is stale. Below them is a quiet "Decided" group (approved in moss, rejected muted).
An empty state says nothing needs the owner.

**Review pane:** a header with the title, the venture, "proposed by Claude in
<thread link>" and the age, followed by the reason. Then one section per change, in
order, with a label ("Revise strategy", "New bet", "Update bet", "Settle bet", "New
goal", "Update goal") and its fields:
- Updates show before → after per changed field. Strategy text uses the existing word diff.
- Creates show the new fields, and `ref` bets read "the bet above (n)".
- Each change has **Include** (on by default) and **Edit**, which turns its fields into the
  same inputs the cockpit uses.
- A stale change shows **Stale**, with what moved ("strategy is now v5"), and
  Approve is disabled with that explanation.

The footer holds a reason field (prefilled, required), an optional note, **Approve** (resin,
the only primary) and **Reject**. Decided proposals render read-only with the
decision, the note and what was applied.

**Cockpit:** a **Needs you** list in the right column: that venture's pending
proposals (title, n changes, age), each linking to the inbox item. It is hidden when there
are none.

**Thread:** the `propose_changes` tool row reads "Proposed “title” · n changes" with
a link to the inbox item. `braise` messages render as a quiet centred system line,
not as a chat bubble.

**States:** loading skeletons, the empty inbox, a refused approve inline (stale or
decided elsewhere), and a proposal decided in another tab updating live.

**Boundaries:** desktop-first (about 1024px minimum), rendered verification and the
craft-floor check through impeccable before the slice lands.

## Local dev deltas

- One Drizzle migration (`proposals`, the reader grant). No new dependencies.

## Tests (against real Postgres; no model)

- Unit: proposal change summaries and the braise line text; staleness from a base and
  the current rows; `ref` resolution and drop rules; the context renders `braise`
  messages and pending proposals; new event labels in the web.
- Integration (`proposals.integration.test.ts`): `proposal.create` stores a pending
  proposal with bases and a `proposal.created` event carrying the run, and writes nothing
  else (the dry run leaves no rows or events). Also:
  - a failing dry run returns the handler's error;
  - out-of-scope venture or thread, non-proposable commands and a missing run are refused;
  - approve applies the kept changes atomically with gapless `seq`, edits included, a `ref`
    resolved, the reason on the strategy revision, and the braise message in the thread;
  - a stale change → 422 `proposal_stale` with nothing applied;
  - a second approve → `proposal_decided`;
  - dropping a referenced bet → `proposal_ref_dropped`;
  - reject posts its line;
  - agents get 403 `not_granted` on approve and reject.
- Agent tool: `propose_changes` records actor `agent:claude` and the run, and replaying
  a tool call is idempotent.
- Reads through the HTTP app: the inbox's pending and decided lists, and proposal detail
  with current values and stale flags.
