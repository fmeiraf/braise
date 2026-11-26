# Slice 7: Spaces, capacity and needs-you

Status: **landed** 2026-11-26. This is the build spec; the rules in `docs/architecture.md` apply
throughout. It changes the thread model of slice 3 and the run engine's concurrency.

## Goal

Move from one-on-one threads to **spaces**: a group of threads around one theme, with an
orchestrating agent that starts threads, messages them and hears back from them. The owner's own
threads, with any agent, can join or leave a space. Spaces follow Amp's design
(ampcode.com/docs/spaces), minus the team features braise has no use for.

The fan-out needs room to run and a way to see what it costs. So this slice also replaces the global
two-runs limit with a limit per runtime, adds instrumentation on runs, watches the subscription
limits of each login and pauses a runtime until its window resets. It also lands the deferred
`needs_input` inbox item, so a thread can ask the owner for help.

## Demo scenario (acceptance)

1. Open the example venture's Threads. The list shows spaces first, then loose threads.
2. Create a space "Pricing page" with a goal, linked to an open bet, orchestrated by Claude. Ask
   it to "research three competitors' pricing and draft our page copy". It starts four threads
   (three research threads on GPT, one copy thread on Claude), each shown as a card in the chat and
   in the side panel under Running.
3. Two threads run at once on each runtime up to its limit; the others show as Queued with their
   wait time. The Agents view shows running/limit, queue depth and window use per runtime.
4. One research thread asks a question. Its card turns amber, the inbox shows a Needs you item,
   and answering it in the thread resumes that thread's work.
5. As threads finish, a report line lands in the space chat for each, and the space agent wakes
   once to act on the reports, not once per report.
6. Drag a loose thread you started earlier with GPT into the space; it shows as a member. Remove
   it again; its history is untouched.
7. Restart braise mid-run. The interrupted threads report to the space as interrupted; the space
   agent wakes and retries them. A retried thread picks up where it stopped: work items it created
   before the restart are not created again.
8. Seed a Claude limit reading at 95% of the five-hour window. The Claude runtime shows Paused
   until the reset time; Claude runs stay queued, GPT runs keep going. Resume by hand, or wait
   for the reset.

## In / out of scope

**In:** spaces (create, edit, archive, members), the space chat, orchestration tools, report
lines, auto-wake with coalescing and a wake cap, `needs_input`, per-runtime concurrency and
priority, run instrumentation, limit readings and the pause gate, retries that don't repeat
work, the Spaces UI, the capacity panel.

**Out:** sharing, roles, Slack links, huddles and comments (single owner); nested spaces; agents in
member threads delegating further; automatic model or agent routing (the owner picks for now;
routing guidelines on capacity, budget and preference come later); a durability layer for runs;
a progress chart over time.

## Decisions (from the owner, 2026-11-26)

- A space is its own table with its own id. Membership is `threads.space_id`, so adding or
  removing a thread changes one column and never moves a thread's history.
- A thread is in at most one space. Spaces do not nest. A member is in the space's scope (the
  Holding or the same venture).
- Each thread picks its own agent: the owner when starting one by hand, the space agent when
  starting one through `thread.start`. There is no per-space model lock.
- Finished, failed, interrupted and asking threads report to the space, and the space agent wakes
  on reports.
- Concurrency is limited per runtime, with instrumentation to check performance.
- Subscription limits are watched between tasks, and a runtime pauses until its window resets.

## Schema

- `spaces`: `id`, `venture_id` (null for the Holding), `title`, `goal` (nullable),
  `agent_profile_id` (the orchestrator), `chat_thread_id` (unique, references `threads`),
  `wakes_since_owner` (int, default 0), `created_by`, `created_at`, `updated_at`, `archived_at`.
- `threads.space_id` (nullable, references `spaces`); `threads.started_by_run_id` (nullable,
  references `runs`: set when a space agent started it). A space's chat thread has no
  `space_id`, and it can never be a member.
- `thread_messages.meta` (jsonb, nullable): a report line carries
  `{ kind: "report", threadId, runId, outcome }`, where outcome is `succeeded`, `failed`,
  `interrupted`, `cancelled` or `needs_input`.
- `input_requests`: `id`, `thread_id`, `run_id`, `question`, `status` (`pending`, `answered`),
  `created_at`, `answered_at`. One pending request per thread.
- `runs.first_token_at` (nullable): the time to first token, for instrumentation.
- `limit_readings`: `id`, `runtime`, `window` (`five_hour`, `seven_day`, `seven_day_opus`,
  `primary`, `secondary`, ...), `status` (`allowed`, `warning`, `rejected`), `utilization`
  (0–1, nullable), `resets_at` (nullable), `run_id`, `observed_at`. Append-only.
- `runtime_pauses`: `runtime`, `reason` (`limit`, `owner`), `until` (nullable), `created_at`,
  `lifted_at`. At most one open pause per runtime.

`space_threads` was considered and dropped: a thread has one space, so a column is enough.

## Commands

Owner:
- `space.create` (title, goal, scope, orchestrator profile): creates the space and its chat thread.
- `space.update` (title, goal, profile); `space.archive` (members stay, with `space_id` cleared).
- `space.add_thread` / `space.remove_thread`: refuses a chat thread, a thread already in another
  space, and a thread outside the space's scope.
- `thread.create` takes an optional `spaceId`.
- `runtime.pause` / `runtime.resume`.

Agent, under a new capability `delegate` ("Start and direct threads"), allowed only in a run whose
thread is a space's chat:
- `thread.start` (profile, title, first message): a member thread, with `started_by_run_id` set.
  At most 8 per run.
- `thread.message` (thread, body): posts with author `agent:<name>` into a member thread and
  queues a run there.
- `space.add_thread` / `space.remove_thread` on threads the owner could add.

Any agent: `input.request` (question) opens a `needs_input` item and ends the run. The owner's next
message in that thread answers it.

Commands from a member thread's agent never include `delegate`: the pipeline refuses them with
403 `not_in_space_chat`, which is not an access request.

## Reports and waking

- When a member run ends, or opens an input request, the worker posts a report line (author
  `braise`, with `meta`) in the space's chat thread, inside the transaction that finishes the run.
- That transaction also queues a wake run for the space agent unless one is already queued, so
  reports that arrive while it runs or waits are read in one wake. A wake run's prompt lists the
  reports since its last run.
- Each wake increments `wakes_since_owner`; an owner message in the space resets it. At 5, no
  wake is queued and the space shows "Paused: needs you" until the owner writes.
- An owner `needs_input` answer in a member thread queues that thread's run, not a wake.

## Run engine: concurrency, priority and limits

- One pg-boss queue per runtime (`runs.claude`, `runs.pi`), each with its own `localConcurrency`:
  Claude 3 and Pi 4 by default, overridden by `BRAISE_CLAUDE_CONCURRENCY` and
  `BRAISE_PI_CONCURRENCY`. One active run per thread stays.
- Runs in a space chat are sent with a higher pg-boss priority than member runs, so an orchestrator
  is never stuck behind its own workers. It never holds a slot while waiting: it starts threads and
  its run ends.
- **Claude limits:** the Agent SDK emits `rate_limit_event` (`status`, `utilization`,
  `resetsAt`, `rateLimitType`) for subscription logins. Each event becomes a `limit_readings`
  row.
- **Pi limits:** pi-ai's `onResponse` hook gives each response's status and headers. Codex
  usage headers become readings. The header names are to be confirmed against a recorded
  response before the parser is written. A 429 `usage_limit_reached` with `resets_at` always
  becomes a `rejected` reading.
- **The gate:** before claiming a job, the worker checks for an open pause on the job's runtime.
  A `rejected` reading, or a utilization of 0.9 or more (`BRAISE_LIMIT_PAUSE_AT`), opens a pause
  until `resets_at`, plus a pg-boss job scheduled for that time that lifts it. Paused jobs stay
  queued. The owner can pause or resume by hand.
- A run that is refused mid-flight ends `interrupted` with the error `limit`, keeping its partial
  text, and reports to its space like any interrupted run.

## Retries that don't repeat work

A retry is a new run. Today its context holds only the thread's messages, and the write
idempotency key holds the run id and call index, so a retry can repeat a write the interrupted run
already made. Space agents retry interrupted threads unattended, so this slice fixes it in two
layers:
- **Context:** when a run has `retry_of`, `loadRunContext` reads the successful tool calls and
  results of every earlier run in the retry chain from `run_events`. The prompt lists them as
  already done ("Before braise stopped, your previous attempt already did: ... Continue from
  there; don't repeat these."), together with the saved partial text. This works the same on
  Claude and Pi. Passing Pi the real tool messages as history, and Claude's `sessionStore`, are
  later upgrades.
- **Creates:** `*.create` commands from an agent are keyed by the retry chain's root run and the
  payload digest, with no call index (`run:<rootRunId>:create:<digest>`), so an identical create
  on a retry returns the original result. Updates and status changes keep the per-run key: setting
  a value again is harmless, while de-duplicating them across a chain would drop a real change
  (doing → todo → doing).

## Instrumentation

Derived from `runs` (`created_at`, `started_at`, `first_token_at`, `finished_at`, `usage`) and
`limit_readings`, with no extra service:
- Per runtime and day: runs, queue wait p50/p95, time to first token p50/p95, duration p50/p95,
  tokens, cost, and failed or interrupted counts.
- Live: running/limit, queue depth and the oldest queued run's wait, per runtime.
- Per window: the latest utilization and reset time, and the readings over the last 7 days.
- Per space: runs, tokens and cost.
- Each run's row shows its queue wait and time to first token.

## Reads

- Space list (venture or Holding scope) with member counts by state: running, queued, needs you,
  done.
- Space detail: the space, its chat, and its members with their latest run status and agent.
- `needs_input` items join the global inbox and the rail's pending count.
- Capacity: the live and daily figures above. SSE `capacity` hints on pauses and on new readings.

## UI requirements

Designed through `impeccable` against `ui-prototype-6.html` (the prototype wins on conflict),
starting with a prototype of the space screen for the owner to approve:
- Threads: spaces first, then loose threads. A new thread can start in a space.
- Space screen: the chat in the middle with thread cards inline (title, agent, live status, amber
  when it needs you), report lines as system lines, and a side panel of members grouped Needs you,
  Running, Queued, Done. A card opens its thread, and the thread shows its space with a way back.
  Members can be added and removed by drag or menu.
- Agents view: a capacity panel per runtime with running/limit, queue, window use with reset time,
  the paused state with Resume, and the daily performance figures.

## Tests (against real Postgres; no live model)

- Membership rules: one space per thread, no chat thread as a member, scope match, archive
  clears members.
- `delegate` is refused outside a space chat and in member threads; `thread.start` caps at 8 per
  run.
- A member run's end writes one report line and queues at most one wake. Coalescing and the wake cap.
- `input.request` opens one pending item; the owner's reply answers it and queues the thread's run.
- Per-runtime limits: the worker end-to-end suite runs more than the old cap at once and never more
  than a runtime's limit. Chat runs are claimed before member runs.
- Limit readings: Claude `rate_limit_event` fixtures map to readings. A Pi MSW response with
  usage headers and a 429 with `resets_at` map to readings. A rejected reading opens a pause, and
  the scheduled job lifts it at `resets_at`. Queued runs of a paused runtime are not claimed while
  the other runtime's are.
- Instrumentation queries over seeded runs return the expected percentiles.
- Retries (worker end-to-end, Pi against MSW): interrupt a run right after a `work.create` and
  retry it. The retry's prompt lists the earlier create, an identical create returns the same id,
  and the work item exists once. A retry chain of three runs lists the calls of both earlier runs.
  Within one run, doing → todo → doing on one item applies all three changes.
