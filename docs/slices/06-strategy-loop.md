# Slice 6: The strategy loop

Status: **landed** 2026-11-26. This is the build spec; the rules in `docs/architecture.md` apply
throughout. It replaces the bets and goals of slice 1 and re-homes the work items of slice 2.

## Goal

Turn the strategy spine into a loop a venture can climb, and an agent can run: an **objective**
says where the venture is going, **assumptions** list what must be true to get there, each **bet**
tests one assumption against marks fixed in advance, and closing a bet leaves a **learning** that
moves the assumption's confidence and decides the next step. Work that is led by vision rather
than by measurement gets the same top-level slot through a **build objective**, with no
assumptions or bets.

## Demo scenario (acceptance)

1. `docker compose up -d`, `npm run dev`, `npx braise seed`, then open the example venture. The
   overview shows a metric objective with its readings, four assumptions ranked next move first,
   an open bet, a learning from a closed bet, a build objective and one hunch under "Worth testing
   later".
2. Open the bet: it reads as one sentence. Record a reading at the pass mark; the row says so.
   Close the bet as passed with a learning. Confidence rises to what the method can earn, the
   learning appears on the assumption and in the aside, and Activity shows both events.
3. Try to close another bet as passed with no reading, and as "the idea was wrong" with a reading
   between the marks: both are refused with a sentence that says why.
4. Change a registered bet's pass mark: the form asks for a reason before it saves.
5. Add a build objective with a done list and a time box. Tick a line. In Work, add an initiative
   under it; the cockpit shows the progress.
6. In Work, filter by function: groups without work of that function fold away. Move an
   initiative to Upkeep from its inspector.
7. Ask an agent to plan the next step. It proposes an assumption and a bet in one proposal; the
   bet shows on its assumption as waiting; approving applies both.

## In / out of scope

**In:** objectives (metric, learning, build), readings, assumptions (including unattached ones),
bets with marks, method and deadline, learnings, work homes (bet, build objective, Upkeep), the
function filter, proposals for all of it, the agent's tools and prompt, the data migration, the
example seed.

**Out:** Holding-level rules promoted from learnings; spend tracking against a budget and
guardrails as measured numbers (both are text for now); integrations that record readings;
automatic stop rules (the agent is told them; braise does not enforce them); reopening a closed
objective or bet.

## Decisions

Taken from the proposal the owner approved ("great lets implement this", 2026-11-26), with the
leans it listed. Each is recorded in `docs/architecture.md`.

- The top level is called **objective**. A venture climbs at most two metric or learning
  objectives at once; build objectives are not limited.
- Work hangs off a bet, a build objective or **Upkeep** (work that tests nothing).
- Agents propose objectives, assumptions and bets; the owner approves. Recording a reading and
  ticking a done list are direct, under the `work` capability.
- A hunch is an assumption with no objective. It becomes testable when it is attached.
- Confidence (0 to 4) moves only when a bet closes.

## Schema

`objectives(id, venture_id, kind, statement, measure, unit, baseline, target, decision, done_rule,
done_list jsonb, by_date, guardrails, budget, status, created_at, updated_at, closed_at,
archived_at)`; `assumptions(id, venture_id, objective_id null, statement, impact, confidence,
function, status, created_by, …)`; `bets(id, venture_id, assumption_id, function, action, signal,
unit, baseline, pass_at, fail_at, method, budget, deadline, status, closed_at, …)`;
`learnings(id, venture_id, bet_id unique, assumption_id, result, cause, statement, value,
confidence_from, confidence_to, function, created_by, created_at)`; `readings(id, venture_id,
subject_type, subject_id, value, taken_on, source, entered_by, created_at)`. `work_items` loses
`goal_id` and gains nullable `bet_id` and `objective_id` (never both; neither means Upkeep).
`goals` is dropped.

Migration `0007_strategy_loop.sql` carries existing data over: each goal becomes a build
objective with the same id (its signal is the one done-list line, its horizon the date), each old
bet becomes an unattached assumption with the same id (won → holds, lost → false, killed →
dropped), work keeps its place under what was its goal, thread links follow, and pending
proposals are closed. An old bet's action and kill criteria stay only in `commands` and `events`.

## Commands

`objective.create/update/check/close/archive`, `assumption.create/update/archive`,
`bet.create/update/close/archive`, `reading.record`; `work.create` and `work.move` take a `home`
(`bet`, `objective` or `upkeep`) instead of a goal. Removed: `goal.*`, `bet.set_status`.

Rules (422 `rule_violated`): `objective_limit`, `field_not_for_kind`, `by_date_required`,
`target_equals_baseline`, `done_item_unknown`, `objective_closed`, `objective_has_open_bets`,
`objective_has_work`, `objective_has_assumptions`, `objective_not_climbing`,
`assumption_not_open`, `assumption_not_attached`, `assumption_has_open_bets`,
`assumption_has_bets`, `bet_not_open`, `reason_required` (changing a registered bet's signal,
unit, baseline, marks, method or deadline), `marks_equal`, `bet_not_passed`, `bet_not_failed`,
`confidence_out_of_range`, `bet_has_work`, `reading_needs_metric`, `home_not_available`,
`home_on_child`.

Closing a bet: `pass` needs the latest reading at the pass mark; `fail` with cause `idea` needs it
past the fail mark; `fail` with cause `execution` and `inconclusive` are always allowed. The
confidence it may leave: on a pass, from the current value up to the method's ceiling
(`existing_data` 1, `interviews` 2, `fake_door`, `concierge`, `before_after` 3,
`staggered_rollout`, `ab_test` 4); on a wrong idea, anything lower; otherwise unchanged. At 0 the
assumption is marked false. The direction of a signal is read off the marks (pass above fail
means higher is better).

Proposable: `strategy.revise`, `objective.create/update/close`, `assumption.create/update`,
`bet.create/update/close`. A change may point at an earlier one with `{ "ref": n }` in
`objectiveId` or `assumptionId`.

## Reads

The cockpit returns objectives, assumptions, bets, learnings, readings, the bets waiting in
pending proposals, and work progress keyed by home (`bet:<id>`, `objective:<id>`, `upkeep`). The
work reads return objectives and bets in place of goals. No new endpoints.

## Agent

Tools: `create_work_item` and `move_work_item` take a home; `record_reading`, `check_done_item`;
`propose_changes` covers the proposable commands. The system prompt describes the loop, the test
ladder, the closing rules and the stop rules, and a venture thread carries the venture's current
state: objectives with their latest readings, assumptions ranked next move first with their open
bets and learnings, and the hunches.

## UI

Inside the v6 world (`packages/web/DESIGN.md`). The overview leads with objectives: a metric
objective shows its readings against baseline and target; a build objective shows its time box
and done list; assumptions carry four confidence diamonds and nest their bets and learnings. The
aside adds "Worth testing later" and "Learnings". Work groups by bet, build objective and Upkeep,
with a function filter. The inbox reviews and edits the new change types and still renders
proposals decided under the earlier model.

## Tests (against real Postgres)

`loop.integration.test.ts` covers the rules above and the seed; the proposal, work, grants,
threads, pipeline and demo suites are ported; `loop.test.ts` (core) and `loop-view.test.ts`
(web) cover the pure parts.
