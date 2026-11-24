# Slice 3: Agent threads, streaming live

Status: **draft**, awaiting the owner's OK. This is the build spec; the rules in
`docs/architecture.md` apply throughout.

## Goal

Talk to an agent about the work. The owner opens a thread (anchored to nothing, or
linked to work items, goals, bets and ventures), posts a message, and a Claude agent
replies live, token by token. The agent can read everything in braise and change
work items, with every write going through the command pipeline under its own actor
and run. This slice also sets the contract every agent runtime plugs into: threads,
runs, run events and jobs in Postgres. The Claude Agent SDK is the first adapter;
Codex (GPT) and Pi (pi-durable) come later behind the same contract.

## Demo scenario (acceptance)

1. `docker compose up -d`, `npm run dev` (the `claude` CLI logged in locally), then
   open http://127.0.0.1:5400. The rail shows **Threads**.
2. In Holding scope, start a thread with no link: "What ventures do we have and what
   are their goals?". A run starts (the rail shows `1 running`). The reply streams in
   token by token; a collapsed row shows the agent's query. When it finishes, the run
   footer shows the model, duration and tokens.
3. In the Corner Bakery venture's Work view, open a task. Its detail pane shows
   **Threads** with "New thread". Start one there (pre-linked to the task); in the
   composer type `@` and link a goal too. Both links show on the thread header, and the
   thread shows up on both items.
4. Ask the agent to "split this task into two subtasks and mark it doing". It creates
   the subtasks and sets the status; the Work tree in a second tab updates live, and
   Activity shows `work.*` events with actor `agent:claude` and a link to the run.
5. Ask the agent to change the venture's strategy: it has no tool for that and says
   so (proposals arrive in slice 4).
6. Post a long question and press **Stop** mid-reply: the run ends `cancelled`, the
   partial reply stays visible and marked as stopped.
7. Post again, then restart the API (`rs` in the watcher or kill it) mid-reply. After
   restart the run shows `interrupted` with **Retry**; Retry starts a new run for the
   same message and it completes.

## In / out of scope

**In:** threads (Holding or venture scope, unanchored or linked to many items), owner
messages, agent replies streamed live, the Claude Agent SDK runtime adapter, pg-boss
jobs, runs and run events, the agent's braise tools (read-only SQL, schema, work item
writes, thread links), cancel and retry, the Threads view, threads on the work item
pane, the rail's live-runs count.

**Out:** repo access and file/bash tools (repos are not connected yet), proposals and
the inbox (slice 4), grants and access requests (slice 5; slice 3 ships one fixed
allowlist), Codex and Pi adapters, agent profiles as data (one built-in profile in
code), several agents per thread, the agent posting unprompted, editing or deleting
messages, attachments, reactions, run-event pruning, auto-resume of interrupted runs,
moving a thread between scopes, mobile layout. Archive only, never hard-delete.

## Decisions (from the owner, 2026-11-24)

- **Threads:** a thread belongs to the Holding (`venture_id` null) or one venture,
  chosen by the scope it was started in. It starts with no link or with links, and
  links can be added and removed anytime. Links point at work items, goals, bets or
  ventures; the autocomplete ranks work items first. One thread holds many messages;
  the owner posts and the agent replies.
- **Runtimes:** each model family runs on its own runtime behind one braise contract:
  Anthropic models on the Claude Agent SDK (this slice), GPT on its own runtime, the
  rest on Pi + pi-durable. Each runtime owns its loop and durability; braise owns
  threads, runs, run events and jobs. pi-durable has no Postgres storage today
  (checked at 1.6.0: SQLite, JSONL, IndexedDB, memory, Chord store on SQLite), so the
  Pi adapter's storage is decided in slice 5.
- **Run engine:** posting a message writes a `queued` run in the command's
  transaction and sends a pg-boss job right after commit (pg-boss can only join our
  transaction through a custom adapter; the run row is the durable record, startup
  re-sends a job for every queued run, and the worker claims a run atomically, so a
  duplicate job is a no-op). A worker inside the API process runs the agent and saves each finished message and
  tool call as it completes. On startup, runs left `running` become `interrupted`, and
  the thread offers Retry (a new run for the same message). There is no auto-resume and
  no durability library on top of the Agent SDK. One active run per thread; at most 2
  runs at once across braise. The owner can cancel a run.
- **Model and auth:** `claude-opus-5-5` (override with `BRAISE_AGENT_MODEL`), through
  the local Claude Code login: the Agent SDK's CLI subprocess uses the owner's stored
  credentials, and braise holds no API key.
- **Agent access:** reads through a read-only SQL tool (a dedicated read-only Postgres
  role) plus a schema tool; writes through typed tools that run braise commands with
  actor `agent:claude`, the run id and an idempotency key per tool call. Allowed
  writes: `work.create`, `work.update`, `work.set_status`, `work.move`, `thread.link`,
  `thread.unlink`. Strategy, bets, goals, ventures and archiving stay owner-only;
  strategy changes become proposals in slice 4 (invariant 5).
- **Streaming:** saved: finished messages, tool calls and results, run status and
  usage. Live only: token deltas, sent by the worker over Postgres `NOTIFY` in chunks
  under the 8KB limit, and served per thread at `GET /api/threads/:id/stream`. The
  global `/api/stream` carries only thread and run hints. No pruning in this slice.
- **UI:** a **Threads** rail entry (follows scope) with a thread list and a Slack-like
  conversation, an `@` autocomplete in the composer, threads listed on the work item
  pane with "New thread" pre-linked, and a global `n running` in the rail's live-runs
  slot.
- **Tests:** the Agent SDK is not exercised in automated tests. The mapping from SDK
  messages to run events and deltas is a pure function, unit-tested with recorded
  SDK message fixtures. Everything else (commands, runs, tools, recovery, reads,
  streams) is tested against real Postgres without a model.

## Runtime contract (invariant 7)

```ts
interface AgentRuntime {
  name: "claude-agent-sdk";
  run(input: RunInput, sink: RunSink, signal: AbortSignal): Promise<RunOutcome>;
}
// RunInput: system prompt, transcript (prior messages), the new message, tools, model
// RunSink: delta(text, offset) · message(text) · toolCall(id, name, input) ·
//          toolResult(id, output, isError)
// RunOutcome: { status: "succeeded" | "failed", usage, error? }
```

The worker owns the job, persistence and cancellation; the adapter only translates.
The Claude adapter calls `query()` from `@anthropic-ai/claude-agent-sdk` with:
`model`, `systemPrompt` (braise context), built-in tools disabled (`tools: []`), the
braise tools as an in-process MCP server (`createSdkMcpServer`),
`includePartialMessages: true` (for deltas), `persistSession: false` (no transcripts
on disk; invariant 3), `settingSources: []`, the run's `AbortController`, and
`cwd` set to an empty per-run temporary directory. The SDK messages
are mapped by `normalize.ts` (pure, unit-tested).

**Context per run:** braise rebuilds it from Postgres every time: a system prompt
(braise's role, the scope's venture and active strategy, the thread's linked items
with their goal chain, the tool rules) and the thread's transcript (owner messages and
agent replies). The SDK's own session `resume` is not used; its alpha `sessionStore`
(transcripts mirrored into a store of ours) is the later route if tool context across
runs proves necessary.

## Schema

```sql
threads
  id uuid PK (UUIDv7) · venture_id uuid NULL FK → ventures
  title text NOT NULL                      -- first message, trimmed to 80 chars; renamable
  last_seq bigint NOT NULL DEFAULT 0       -- gapless per-thread sequence of messages
  created_by text NOT NULL · created_at, updated_at · archived_at NULL
  INDEX (venture_id, updated_at DESC)

thread_links
  thread_id FK → threads · subject_type text CHECK IN ('work_item','goal','bet','venture')
  subject_id uuid · created_by text · created_at
  PK (thread_id, subject_type, subject_id) · INDEX (subject_type, subject_id)

thread_messages
  id uuid PK · thread_id FK → threads · seq bigint     -- UNIQUE (thread_id, seq)
  author text NOT NULL                     -- 'owner' | 'agent:claude'
  run_id uuid NULL FK → runs               -- set on agent replies
  body text NOT NULL · created_at

runs
  id uuid PK · thread_id FK → threads · message_id FK → thread_messages  -- the owner message it answers
  retry_of uuid NULL FK → runs
  runtime text NOT NULL · model text NOT NULL · actor text NOT NULL       -- 'claude-agent-sdk' · 'claude-opus-5-5' · 'agent:claude'
  status text NOT NULL CHECK IN ('queued','running','succeeded','failed','cancelled','interrupted')
  error jsonb NULL · usage jsonb NULL      -- tokens, cost as reported by the runtime
  created_at · started_at NULL · finished_at NULL
  UNIQUE INDEX (thread_id) WHERE status IN ('queued','running')  -- one active run per thread

run_events
  run_id FK → runs · seq integer · type text · payload jsonb · created_at
  PK (run_id, seq)
  -- types: run.started, message, tool.call, tool.result, run.finished

commands, events (changed): + run_id uuid NULL   -- invariant 6: actor, run and reason
```

- An agent reply is a `thread_messages` row (permanent, part of the transcript);
  `run_events` hold the run's detail (tool calls and results) and can be pruned
  later without losing the conversation.
- pg-boss installs its own `pgboss` schema at startup (`npx braise reset` drops it
  too); its queue `agent-run` carries `{ runId }` only, with `retryLimit: 0` (a retry is an owner decision, never
  automatic) and an expiry of 30 minutes.
- A read-only role `braise_agent_reader` (NOLOGIN) gets `SELECT` on the braise domain
  tables (not `commands`, not `pgboss`), and the app's user is granted it, so the
  query tool runs `SET LOCAL ROLE` inside a `READ ONLY` transaction.

## Commands

Thread commands run through the pipeline (validation, idempotency on `commands`,
reason, actor). They are **thread-scoped**: they lock the thread row and advance its
`last_seq` instead of a venture's, write no domain events (chat is not low-volume
domain history), and `NOTIFY thread_events` with `threadId:seq`. The pipeline gains
that scope next to the venture one.

| Command | Effect | Notes |
|---|---|---|
| `thread.start` | new thread with its first message and links, enqueues a run | `{ ventureId?, body, links? }`; title from the body |
| `thread.post` | owner message, enqueues a run | 422 `run_active` while a run is queued or running |
| `thread.link` / `thread.unlink` | add or remove one link | link target must exist and be live, and belong to the thread's venture when it has one (`link_out_of_scope`) |
| `thread.rename` | title | |
| `thread.archive` | archives the thread | refused while a run is active |
| `run.cancel` | queued: cancel the job, mark `cancelled`; running: signal the worker | the worker aborts, saves what finished, marks `cancelled` |
| `run.retry` | new run for the same owner message, `retry_of` set | only for `failed` and `interrupted` runs |

Agent writes go through the same handlers with `actor: 'agent:claude'` and `runId`;
work events land in the venture's domain events with that actor and run, so Activity
shows them. A command outside the allowlist from an agent actor is refused with 403
`not_granted` in the pipeline (the inbox `access_request` arrives in slice 5).

The worker's own state changes (run started, event appended, message saved, run
finished) are internal writes of the API process, not commands: they belong to the
run's lifecycle, carry no owner intent, and are recorded in `run_events`.

## Agent tools (in-process MCP server `braise`)

| Tool | Does |
|---|---|
| `describe_schema` | tables, columns and relations the reader role can see, with one-line notes |
| `query` | one `SELECT` as `braise_agent_reader`, `READ ONLY`, `statement_timeout` 5s, at most 200 rows returned (says when it truncated) |
| `create_work_item`, `update_work_item`, `set_work_item_status`, `move_work_item` | the `work.*` commands |
| `link_thread`, `unlink_thread` | the current thread only |

Write tools use the idempotency key `run:<runId>:<toolUseId>`, so a replayed call never
writes twice, and return the command's result or its API error as the tool result.

## Reads and live updates

| Endpoint | Returns |
|---|---|
| `GET /api/threads?ventureId=&subject=` | thread list (Holding: all; venture: that venture's; `subject=work_item:<id>` for an item's threads): title, scope, links, last message snippet, active run status, `updatedAt` |
| `GET /api/threads/:id` | thread, links (with titles), messages, runs with their events |
| `GET /api/threads/:id/stream` | SSE: `hint` (`{ threadId, ventureId }` after any thread change, run event or run status change), `delta` (`{ threadId, runId, block, offset, text }`), `reset`, `ping` every 15s |
| `GET /api/runs/active` | running and queued runs across braise (for the rail) |
| `GET /api/link-targets?q=&ventureId=` | autocomplete: work items first, then goals, bets, ventures; matches on title |

- The global `/api/stream` also sends `thread` events (`{ threadId, ventureId }`), so
  lists and the rail's count refresh in every tab; deltas never go there.
- Deltas carry the text block's index within the run and the character offset of the
  block so far. A client that misses a chunk
  (reconnect) stops appending and shows the reply as in progress until the finished
  message arrives.
- Query keys: `['threads', scope]`, `['thread', id]`, `['runs', 'active']`.

## UI brief (impeccable: a new component inside the established world)

**Mode:** Operate, inside "The Holding Console" (`packages/web/DESIGN.md`); the
thread is new UI built from the existing system. DESIGN.md changes only with the
owner's approval.

**Topology:** **Threads** sits in the rail after Work and follows scope: `/threads`
and `/v/:slug/threads`, the open thread in `?thread=<id>`. The live-runs slot shows
`n running` (global) and links to the oldest running thread.

**Threads view:** a list pane (title, links as small chips, last message snippet,
time, a pulsing ember marker while a run is active) and the conversation pane.
"New thread" opens an empty conversation with focus in the composer.

**Conversation:** a header with the title (inline rename), links as chips (removable,
`+ Link` opens the same autocomplete). Messages Slack-style: author, time, body;
agent replies render Markdown (safe subset, no raw HTML). Under each agent reply its
run: tool calls as dense, collapsed rows ("Queried work_items · 12 rows", "Set
'Second initiative' to doing") that expand to input and output; a footer with model,
duration and tokens, and the status (`cancelled`, `failed` with the error,
`interrupted` with Retry). While running: a live caret on the streaming text and a
Stop button in the composer.

**Composer:** multiline, Enter sends, Shift+Enter breaks the line; `@` opens the
autocomplete (work items first, kind and venture shown), and choosing a target links
it and inserts its title. Disabled with an explanation while a run is active.

**Work item pane:** a **Threads** section listing linked threads (title, time, run
marker) and "New thread", which opens the Threads view with that item pre-linked.

**States:** loading skeletons, empty list prompt, run errors inline, the stream's
reconnect state, a clear message when the Claude login is missing (from the run's
error).

**Boundaries:** desktop-first (about 1024px minimum), rendered verification and the
craft-floor check through impeccable before the slice lands.

## Local dev deltas

- Dependencies: `pg-boss` and `@anthropic-ai/claude-agent-sdk` (api),
  `react-markdown` (web), pinned exactly.
- One Drizzle migration (`threads`), including the reader role and grants.
- The `claude` CLI must be logged in on the machine (`claude` then `/login`); no new
  `.env` variable is required. `.env.example` gains `BRAISE_AGENT_MODEL` (optional).
- pg-boss creates its schema on first start (also in `braise_test`).

## Tests (against real Postgres; no model)

- Unit: `normalize.test.ts` maps recorded SDK message fixtures (`*.fixture.ts`: a
  plain reply, a reply with tool calls, an error result, an aborted stream) to run
  events and deltas; the context builder (`context.test.ts`); thread title trimming;
  new event labels.
- Integration: `thread.start` creates the thread, message and run (`queued`) in one
  transaction and the pg-boss job right after; `thread.post` while a run is active → 422
  `run_active`; link scope rules; `run.cancel` on a queued run; `run.retry` only after
  `failed`/`interrupted`; startup recovery turns `running` into `interrupted`.
- Agent tools: `query` refuses writes (read-only transaction) and `commands`, times
  out, truncates at 200 rows; write tools record actor `agent:claude` and the run id
  on commands and events, replaying a tool call is idempotent, a command outside the
  allowlist → 403 `not_granted`.
- Reads and streams through the HTTP app: thread list by scope and by subject, thread
  detail, link targets ranking, a thread stream receives the hint after a post and a
  delta after a `NOTIFY`.
