# Slice 2: Work items under goals

Status: **draft**. This is the build spec; the rules in `docs/architecture.md` apply
throughout.

## Goal

Turn goals into execution: a venture's work as a shallow tree (initiative → task →
subtask) hanging off its goals, tagged by function, ordered by hand, and visible as
progress on the strategy spine. It reuses slice 1's write path unchanged (new
commands are handlers + events) and gives slice 3 a stable thing to attach agent
threads to.

## Demo scenario (acceptance)

1. `docker compose up -d`, `npm run dev`, then open http://127.0.0.1:5400 and pick a
   venture with two goals (A and B). The rail shows **Work**.
2. In Work, under goal A, add an initiative with function `engineering`. Under it add
   a task (it inherits `engineering`), and under the task a subtask. The subtask row
   offers no "add" (three levels is the limit; the API refuses a fourth with 422
   `depth_exceeded`).
3. Set the subtask to doing, then done. The task shows `1/1` done children, and the
   cockpit's goal A shows `1/3 done`.
4. Open the task: edit its title inline (Enter saves, Esc cancels), write a
   description, set priority `high`, change its function to `design`.
5. Add a second initiative under goal A and move it above the first. Move the first
   initiative to goal B: its whole subtree moves with it.
6. Archive goal B in the cockpit: refused inline (`goal_has_work`). Archive the
   initiative (its subtree goes with it), then archiving goal B succeeds.
7. With two tabs open, a change in one appears in the other without a refresh. The
   Holding-scope Work view shows work across ventures; Activity shows the work events
   with actor `owner`.

## In / out of scope

**In:** work items (create, edit, status, priority, function, description, ordering,
move a root between goals, archive with subtree), the Work view in venture and Holding
scope, goal progress in the cockpit, `goal_has_work`, seed data for the example
venture.

**Out:** assignees (agents arrive in slice 3), due dates, reparenting a child under a
different parent, drag and drop, status roll-up, filters and saved views, a board
view, owner-defined function lists, threads and comments, ⌘K. Archive only, never
hard-delete.

## Model decisions (from the owner, 2026-11-24)

- **Status:** `todo` · `doing` · `done`, set by hand on every item. Parents show
  derived child progress; nothing rolls up into a stored status.
- **Goal link:** a root item must name a live goal of the same venture. Children
  always belong to their root's goal and can't set their own. Moving a root moves its
  subtree.
- **Depth:** at most three levels. The kind is named by depth (0 initiative, 1 task,
  2 subtask); there is no kind column.
- **Function:** one of a fixed list (`product`, `design`, `engineering`, `marketing`,
  `sales`, `ops`), required on every item. A child defaults to its parent's function
  when created without one. Changing the list is a migration.
- **Fields:** title, description, status, function, priority (`none`, `low`,
  `medium`, `high`, `urgent`), manual order among siblings.
- **Archiving:** `goal.archive` is refused (422 `goal_has_work`) while the goal has
  live work. Archiving a work item archives its whole subtree.

## Schema

```sql
work_items
  id uuid PK (UUIDv7) · venture_id FK → ventures
  goal_id uuid NOT NULL FK → goals        -- the root's goal, copied to every descendant
  parent_id uuid NULL FK → work_items
  depth smallint NOT NULL CHECK (depth BETWEEN 0 AND 2)
  position integer NOT NULL               -- dense 0..n-1 among live siblings
  title text NOT NULL · description text NOT NULL DEFAULT ''
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done'))
  function text NOT NULL CHECK (function IN ('product','design','engineering','marketing','sales','ops'))
  priority text NOT NULL DEFAULT 'none' CHECK (priority IN ('none','low','medium','high','urgent'))
  created_at, updated_at timestamptz · archived_at timestamptz NULL
  INDEX (goal_id) · INDEX (parent_id) · INDEX (venture_id)
```

- `goal_id` on every row (not only roots) keeps per-goal reads, progress counts and
  `goal_has_work` single-table queries. The API keeps it equal to the root's goal; a
  root move updates the subtree in the same transaction.
- `depth` is stored because a child is never reparented in this slice, so it never
  changes after insert.
- Siblings are the live items with the same `parent_id`, or for roots the same
  `goal_id` and `parent_id IS NULL`. Creating appends; moving and archiving renumber
  the affected sibling group in the transaction (groups are small; the venture lock
  serialises writers).
- Update events store `{ field: { from, to } }` as in slice 1.

## Commands

| Command | Effect | Notes |
|---|---|---|
| `work.create` | new item, appended to its siblings | exactly one of `goalId` (root) or `parentId` (child); `function` required for a root, defaults to the parent's for a child |
| `work.update` | title, description, function, priority | at least one field |
| `work.set_status` | todo / doing / done | separate event so the feed reads "marked … done" |
| `work.move` | `{ workItemId, index, goalId? }` | reorders among siblings; `goalId` only on a root, moves the subtree to that goal |
| `work.archive` | archives the item and its live descendants | one `work.archived` event carrying the archived ids |
| `goal.archive` (changed) | | 422 `goal_has_work` while the goal has live work |

Rules (422 `rule_violated`, with `details.rule`):
`goal_not_in_venture` (root's goal missing, archived or in another venture),
`parent_not_in_venture`, `work_archived` (editing, moving or adding under an
archived item), `depth_exceeded`, `goal_on_child` (`work.move` with `goalId` on a
child), `index_out_of_range`, `no_changes`, `goal_has_work`.

Events: `work.created` `{ title, goalId, parentId, depth }`, `work.updated`
`{ title, changes }`, `work.status_set` `{ title, changes: { status } }`,
`work.moved` `{ title, changes: { index?, goalId? } }`, `work.archived`
`{ title, archivedIds }`. Subject `work:<id>`.

The pipeline is unchanged: schemas in `core/src/commands.ts`, handlers in
`api/src/handlers.ts`.

## Reads and live updates

| Endpoint | Returns |
|---|---|
| `GET /api/ventures/:slug` (changed) | cockpit + `workProgress: { [goalId]: { done, total } }` over live items |
| `GET /api/ventures/:slug/work` | `{ ventureId, lastSeq, goals, workItems }`: live goals and live items, flat, ordered by `depth, position` |
| `GET /api/work` | Holding scope: `{ ventures: [{ id, slug, name, lastSeq }], goals, workItems }` across live ventures |

- The client builds the tree from the flat list (a pure function with a unit test
  beside it).
- Query keys: `['venture', slug, 'work']` (invalidated by that venture's hints like
  every venture key) and `['work']` (invalidated by any hint, like `recent`).
- Command results are written into the cache or invalidate the work key; no
  optimistic updates.
- Event labels for `work.*` are rendered on the client like slice 1's.

## UI brief (impeccable: extend an existing surface)

**Mode:** Operate, inside the pinned "Holding Console" world
(`packages/web/DESIGN.md`). No new direction; system changes go into DESIGN.md only if
the owner approves them.

**Topology:** the rail's **Work** entry sits between Overview and Activity and follows
scope: `/v/:slug/work` for a venture, `/work` for the Holding.

**Work view (venture scope):**
- One section per live goal in spine order (goals under bets first, then the goals not
  tied to a bet). The header shows the outcome, horizon and `n/m done`.
- Under each goal a dense, Linear-like tree: disclosure, pixel-square status marker
  (todo hollow, doing ember, done filled and muted), title, function tag, priority
  glyph, and `n/m` child progress on parents. Done rows stay visible and muted.
- An "Add initiative" row at the end of each goal. Each initiative and task row
  offers "Add task" / "Add subtask" on hover and focus.
- Selecting a row opens a detail pane on the right (not a modal): title, description,
  status, function, priority, goal (roots only), Move up/down, Archive.
- Keyboard: ↑/↓ move the selection, ←/→ collapse/expand, Enter edits the title,
  Alt+↑/↓ reorders, Esc closes the pane.
- A goal with no work shows a quiet prompt to add the first initiative.

**Work view (Holding scope):** the same sections grouped venture → goal, with the
same editing.

**Cockpit:** each goal row shows `n/m done` (or nothing when it has no work), linking
to that goal's section in Work. Archiving a goal with live work shows the
`goal_has_work` error inline with a link to its work.

**States:** loading skeletons, inline errors keyed to API codes, empty venture (no
goals: point to the cockpit to add one), live updates via the existing hint stream.

**Boundaries:** desktop-first (about 1024px minimum width); no mobile layout. Rendered
verification and the craft-floor check through impeccable before the slice lands.

## Local dev deltas

- One Drizzle migration (`npx drizzle-kit generate --name work_items` in
  `packages/api`), committed.
- `npx braise seed` also creates a small work tree under the example venture's goals,
  through the pipeline with fixed idempotency keys (rerunning is still a no-op).

## Tests (against real Postgres)

- The demo scenario as an end-to-end API test: tree of three, fourth level refused,
  status changes, progress in the cockpit read, reorder, move a root to another goal
  (subtree follows), `goal_has_work`, archive subtree, then goal archive succeeds.
- Validation: both or neither of `goalId`/`parentId` → 400; a root without `function`
  → 400; a child inherits its parent's function.
- Cross-venture goal or parent → 422; adding under an archived item → 422.
- Positions stay dense and in order after create, move and archive.
- Unit: the tree builder (`work-tree.test.ts`) and the `work.*` event labels.
