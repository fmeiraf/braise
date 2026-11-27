# Slice 9: The operator

Status: **landed** 2026-11-27 (planned 2026-11-26). This is the build spec; the rules in
`docs/architecture.md` apply throughout. It turns slice 4's fixed proposals into a draft that grows
while the owner talks to an agent, and shows that draft on the venture's pages as it grows.

## Goal

Give each venture an **operator**: a chat with an agent that runs the venture's board the way you
would drive Linear's API. The agent creates, edits, moves, closes and archives objectives,
assumptions, bets, readings and work items, revises the strategy and fills in the venture's basic
details. It does whatever the owner asks.

Nothing it does applies by itself. Every change goes into the venture's **draft**, and the pages show
that draft in place as it grows: new cards slide in, edited fields change, archived rows fade. The
owner keeps, edits or drops changes one at a time or all at once. Invariant 5 holds as written: the
agent operates, and only the owner's keep applies a change.

## Demo scenario (acceptance)

1. Open the example venture and press `O`. The operator panel opens beside the Overview on the
   venture's current session, and it stays open when the owner switches to Strategy or Work.
2. Type "Rename the venture to Kiln and tighten the what to one sentence". The draft bar shows "Draft · 2
   changes". The venture name in the header and the strategy's what show their new text marked as
   draft, with the old text faintly behind.
3. Go to Strategy and type "We want to know if teams will pay. Set that up as a learning objective with
   two assumptions and a bet on the riskiest one". Within about a second of each tool call, an
   objective card slides in, then two assumptions under it, then a bet. Each step appears in the chat
   as a row, and hovering the row highlights the card and the reverse.
4. Edit the bet's deadline inline on the draft card. Type "make the pass mark 20 instead". The agent
   reads the owner's edit, changes only the pass mark, and keeps the owner's deadline.
5. Type "add work for the bet: a landing page and a pricing survey, with two tasks each". The chat shows
   "6 changes in Work →". Open Work: the initiatives and tasks sit under the drafted bet in the tree.
6. Type "archive the old onboarding initiative". Its row fades with a strike in the Work tree.
7. Keep only the bet's work. braise also keeps the bet, the assumption it tests and the objective,
   and says so before applying. Those cards turn solid in place without remounting. The other assumption
   and the archive stay in the draft.
8. Change a drafted-against objective by hand. The draft change that touched it shows as stale and
   Keep refuses it. The agent sees it is stale on its next turn and revises it.
9. Leave the venture. The inbox shows a Draft item with 2 changes for the venture. Drop the archive
   from the inbox and keep the assumption. The draft closes.
10. Come back after more than 4 hours, or press New session. The next message starts a fresh session;
    the agent still knows the board and any open draft. The earlier session stays readable.

## In / out of scope

**In:** one operator chat per venture, in sessions; the draft (any operable command, grown change by change,
pointers to earlier creates, owner edits); keep and drop with dependencies; the draft view of the
cockpit and the work tree; the `draft` hint; the operator tools and prompt mode; `venture.update`;
the operator panel, draft states on Overview, Strategy and Work, the draft bar, the draft in the inbox.

**Out:** operators at the Holding level or working across ventures; `venture.create`,
`venture.archive` and repo commands; grants, threads and spaces as operable commands; streaming tool
input so fields type themselves in (a follow-up); undo after keep; more than one draft per venture;
a voice interface.

## Decisions (from the owner, 2026-11-26)

- The agent operates everything on a venture's board, and the owner approves every change. "Our
  assumptions that only owner can change things will be maintained on approval, but operating is the
  agent."
- One operator chat per venture, made of sessions. A session ends on New session or after 4 hours
  without a message, and the next message opens a fresh one. This bounds the agent's transcript
  without a fixed message count.
- A draft is presented as a state of its item: a drafted bet has its real id from the moment it is
  drafted and keeps it when it is kept. Drafts are stored as changes, not as flagged rows, because
  edits, moves and archives of existing rows would need shadow copies, every query and limit would
  have to skip draft rows, and agents would write into the real tables.
- The draft shows both on the venture's pages, as it grows, and in the inbox.
- Creating and archiving ventures stays out; renaming and filling in basic information is in.
- Work item writes go through the draft in the operator chat, so the board shows one consistent
  draft. Other threads keep their direct `work` writes.
- Archives of objectives, assumptions, bets and work items become draftable. They were owner-only
  (2026-11-24); the owner still decides each one by keeping it.

## Schema (migration `0010_operator`)

- `threads.operator_venture_id` (nullable, references `ventures`): marks a thread as one session of
  that venture's operator chat. At most one open (unarchived) session per venture, by a partial unique
  index. A session is never a space member and never in a space. Ending a session archives its thread.
- `proposals.status` gains `drafting`. A partial unique index allows at most one `drafting` proposal
  per venture. `proposals.run_id` becomes the run that opened the draft; each change records its own.
- `proposals.version` (int, default 0): incremented by every change to a draft, so clients and the
  draft view cache know when a draft moved.
- A change in a draft adds `id` (uuid, stable while other changes come and go), `runId`, `note` (the
  agent's one-line reason), `state` (`open`, `kept`, `dropped`), `editedBy` (null or `owner`) and
  `entityId` (see "Stable ids"). Pending slice 4 proposals keep their index-based shape.
- `ventures` gets no new info columns: "basic info" is `name`, `kind` and the strategy kernel, which
  `venture.update` and `strategy.revise` already cover. `slug` stays fixed, because a venture's colour
  and crest come from it.

## Commands

The **operable set**: `venture.update`, `strategy.revise`, `objective.create/update/check/close/archive`,
`assumption.create/update/archive`, `bet.create/update/close/archive`, `reading.record`, and
`work.create/update/set_status/move/archive`. It lives in `@braise/core` beside `proposableCommands`.

New owner command:
- `venture.update` (name, kind): emits `venture.updated`. It is also operable.

Agent, under `propose`, allowed only in a run whose thread is a venture's operator chat. Anywhere else
the pipeline answers 403 `not_in_operator_chat`, which files no access request:
- `draft.add` (command, payload, note): opens the venture's draft if there is none and appends a change.
  The payload is checked against the command's schema, then every open change is replayed through the
  real handlers in a savepoint and rolled back. A rule error is reported against the new change, and
  nothing is stored. Returns the change id, the entity id and a label (`B3`, `Landing page`).
- `draft.revise` (changeId, payload, note): replaces an open change's payload, with the same replay.
- `draft.remove` (changeId): withdraws an open change, and with it every open change that points at it.

Owner:
- `operator.open` (ventureId): returns the venture's open session. If there is none, or the open one's
  last message is older than `BRAISE_OPERATOR_IDLE` (default 4 hours), it archives the old one and opens
  a new one. The check runs when the owner opens the panel or posts, so no timer job is needed.
- `operator.new_session` (ventureId): ends the open session and opens a new one.
- `draft.revise` (also the owner's): marks the change `editedBy: owner`.
- `draft.keep` (changeIds): applies the changes together with everything they depend on, through the
  existing handlers in one transaction and one `seq` range. Events carry `proposalId` and `changeId`.
  Afterwards, pointers in the still-open changes are rewritten to the real ids. The reason recorded for
  each change is its note (the owner can edit it); `strategy.revise` still requires a reason, and the
  note is used. A stale change is refused with 422 `proposal_stale`.
- `draft.drop` (changeIds): drops the changes and every open change that depends on them.
- `draft.discard`: drops every open change.
- When no change is open, the draft closes: `approved` if anything was kept, `rejected` otherwise. A
  `braise` line in the operator chat records what was kept and dropped.

**Pointers.** Any id field may name an earlier open create in the same draft as `{ "change": "<id>" }`:
`objectiveId` → `objective.create`, `assumptionId` → `assumption.create`, `betId` and a bet `home` →
`bet.create`, an objective `home` → `objective.create`, and `parentId` → `work.create`. Updating an item
that is itself still a draft is refused (422 `draft_revise_create`) with the change to revise
instead, so a draft never holds a create and a separate update of the same row. A pointer to a change
that was kept in the meantime, for example while the agent was mid-run, resolves to the kept row's real
id instead of failing.

**Bases and staleness.** Each change records the base of the row it touches, as in slice 4, with work
items' `updated_at` added. A change whose base moved is shown as stale and cannot be kept until the agent
or the owner revises it. The same check settles overlap with slice 4 proposals from other threads:
whichever the owner applies first changes the row, and the other becomes stale.

**Dependencies.** A change depends on the changes its pointers name, and on the create of the row it
moves under. Keeping a change keeps everything it depends on. Dropping a change drops everything that
depends on it. The API returns this closure before applying it, so the UI can name it ("Keeping this
also keeps B3 and its assumption").

## Stable ids

A drafted create gets its entity id when the change is added (`entityId`). The replay hands that id to
the handler instead of a random one, and `draft.keep` uses the same id. So a drafted card and its real
row share a React key: keeping a change turns the card solid in place, and the draft view keeps the
same ids from one refetch to the next. The create handlers for objectives, assumptions, bets, readings
and work items (`handlers.ts`, today each calls `uuidv7()` itself) take an optional preset id for this;
it is accepted only from the draft replay and `draft.keep`, never from a client payload.

## The draft view

- `GET /api/ventures/:slug/cockpit?draft=current` and `GET /api/ventures/:slug/work?draft=current`
  replay the draft's open changes in a savepoint, run the normal cockpit and work queries, and roll
  back. The pages render drafts with their usual components, so a draft looks exactly like its result.
- The response adds `draft`: the draft's id, version and changes, plus `marks` keyed by entity id
  (`created`, `updated` with fields and earlier values, `moved` with the earlier home or parent,
  `status`, `archived`). Changes whose replay fails, such as stale ones, are listed with their error
  and left out of the view.
- The replay takes the venture lock the way a command does, briefly. Results are cached by draft
  version and the venture's `last_seq`, so many tabs and refetches cost one replay.
- `GET /api/ventures/:slug/draft` returns the draft alone, for the inbox and the panel.

## Live

- Every draft command `NOTIFY`s a `draft` hint (`ventureId`, `version`, `changeId`, `action`) over the
  existing SSE stream. Clients refetch the draft view for that venture; the new marks then animate in.
- Keep and drop emit domain events through the normal pipeline, so the cockpit's own hints update the
  real views too.
- Operator chat runs are sent with pg-boss priority 1, like space chats.

## Agent

- Tools: `draft(command, payload, note)`, `draft_revise(changeId, payload, note)` and
  `draft_remove(changeId)`. The `draft` tool's description lists the operable commands with their
  fields, generated from the zod schemas (`z.toJSONSchema`), so new commands reach the operator without
  new tools.
- `board`: the venture's draft view as compact text. Drafted rows are marked with their change id, so
  the agent sees the same board as the owner. The read-only SQL tool stays.
- Context: the current session's messages only, the draft's open changes, what the owner kept, dropped or edited since the agent's last run,
  and stale changes with their error.
- Prompt mode for the operator chat: do what was asked by drafting it straight away rather than
  describing it; ask only when the request is ambiguous; one short reply per turn saying what changed;
  never claim a change is applied; keep the owner's edits; follow the strategy loop's stop rules. The
  `propose_changes` tool and the direct `work` tools are not offered in the operator chat.

## Reads

- The venture's draft (above) and the draft view of the cockpit and work tree.
- The inbox gains a `draft` kind: the venture, the number of open changes, the latest change time and
  a review pane with the same Keep and Drop as the panel. It counts in the rail's pending badge while
  the draft has open changes.
- The Overview's Needs you list shows the open draft.

## UI requirements

Designed through `impeccable` against `ui-prototype-6.html` (the prototype wins on conflict), starting
with a prototype of the Strategy view with the panel open and a growing draft, for the owner to
approve before building:
- **Operator panel:** a right-hand panel in the shell for the current venture, opened with `O`, an
  operator button in the rail above search (the deck has no room for another control at 1280px) and ⌘K. It stays open across Overview, Strategy and Work, and closes in Holding scope. It
  reuses the thread timeline, composer and stream from `threads.tsx` in a compact form. Each draft step
  is a row with its label; hovering a row highlights its card on the page and the reverse. When changes
  land in another view, a pill such as "6 changes in Work →" opens it.
- **Draft states in place:** created items slide in with the draft accent, updated fields flash with
  the earlier value faint behind them, moved items animate to their new place, and archived items fade
  with a strike. Each one has Keep, Edit and Drop. Editing a draft card calls the owner's
  `draft.revise`. Stale changes show their reason. Draft look (first guess, to iterate): a dashed outline means
  "not real yet" and solidifies when kept; colour carries the kind of change with the existing diff
  colours (green for new, the old value struck in red for edits, red for archives), so no new hue
  competes with venture hues or the amber of "needs you".
- **Draft bar:** above the page, "Draft · N changes · Keep all · Review"; Keep all is also ⌘↵ in the
  panel. Keep and Drop name their dependencies before applying.
- **Inbox:** the Draft item and its review pane.
- All motion stays inside `prefers-reduced-motion: no-preference`.

## Build order

1. **Spike** (before the rest): replay a draft of 50 mixed changes and time the draft view under the
   venture lock; confirm the generated `draft` tool schema (zod `toJSONSchema`, which drops
   refinements; the server still validates) is accepted by both the Claude SDK and Pi.
2. The draft, its commands, preset ids and the draft view, tested against real Postgres.
3. Keep and drop with dependencies and pointer rewriting.
4. Sessions, the operator tools and prompt mode.
5. The UI, from the approved prototype (`ui-prototype-operator.html` at the repo root).

The migration number follows whatever slice 8 ends on (it is `0010_operator`).

## As built (2026-11-27)

- **Spike.** Replaying 50 mixed changes (two objectives, eight assumptions, eight bets, 32 work items)
  through the real handlers in a savepoint took 90–130 ms, and the cockpit and work queries 10 ms more,
  all under the venture lock. The draft is capped at **50 open changes** (`maxDraftChanges`, 422
  `draft_full`). `z.toJSONSchema` handles all 20 operable schemas (about 21 KB together). The Claude SDK
  turns the `draft` tool's shape (`enum`, `record`, `string`) into its MCP schema without complaint, and
  Pi's Codex provider sends tools non-strict (`strict: null`), so a free-form payload passes there too;
  the server validates every payload against the command's zod schema.
- The draft view of the cockpit is `GET /api/ventures/:slug?draft=current` (the cockpit's existing
  route), not `/cockpit?draft=current`. `GET /api/ventures/:slug/operator` returns the sessions and the
  state of recent drafted changes, which the panel's step rows show.
- A change's base is the `updated_at` of every real row it touches, the rows it points at included
  (an assumption's objective, a bet's assumption, a work item's home and parent), so editing an objective
  by hand makes a drafted assumption under it stale (scenario step 8). Keeping a change re-bases the
  open changes that were fresh before it, so a draft never goes stale on its own keeps.
- Pointers also work in a reading's subject. A raw id of a drafted create is turned into a pointer, and
  a pointer to a change kept in an earlier, closed draft resolves to its real id.
- A kept change's note is stored as `reason` in its events' payload and read back as the recorded
  reason (the keep command itself carries none).
- `operator.open` and `operator.new_session` take an optional `agentProfileId` (default Claude, or the
  previous session's agent). Sessions are left out of the Threads list; earlier ones are read from the
  panel's history menu.
- Inbox: a `draft` kind (open and closed drafts), with a review pane of the open changes, each with
  Keep and Drop. The Overview's Needs you lists the open draft.
- Known gap: the keep closure follows pointers only. A change that needs another one for a rule rather
  than a pointer (a new climbing objective that fits only once another objective closes) fails on keep
  with that rule's error until the owner keeps the other change first.

## Tests (against real Postgres; no live model)

- `draft.add` validates the payload and replays every open change. A rule error is reported against
  the new change and nothing is stored. The draft version increments on each change.
- `not_in_operator_chat` outside the operator chat, with no access request. At most one draft per
  venture.
- Pointers: each pointer field resolves to its create type and is refused otherwise. Updating a
  drafted row is refused with `draft_revise_create`. `draft.remove` withdraws the changes that point at
  the removed one.
- Keep: the dependency closure is applied in one transaction and one `seq` range. Events carry
  `proposalId` and `changeId`. Kept creates keep their preset `entityId`. Pointers in the open changes
  are rewritten to real ids. The draft closes when nothing is open.
- Drop and discard drop the changes that depend on them. Stale changes are refused on keep and listed
  as failed in the draft view.
- Draft view: the projected cockpit and work tree equal what applying the draft would produce, with the
  expected marks for create, update, move, status and archive. The cache is invalidated by version and
  `last_seq`. The real tables are unchanged after a read.
- `venture.update` changes the name and kind and never the slug.
- Sessions: `operator.open` reuses an open session, replaces one idle past `BRAISE_OPERATOR_IDLE`, and
  never leaves two open for a venture. A run's context holds only its session's messages.
- A pointer to a change kept mid-run resolves to the real id.
- Worker end to end (Pi against MSW): an operator chat run calls `draft` three times. Three `draft` hints
  arrive in order, and the run's context next turn lists the owner's edit.
