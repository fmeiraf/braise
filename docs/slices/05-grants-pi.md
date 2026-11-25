# Slice 5: Grants, access requests, and Pi as the second runner

Status: **landed** 2026-11-24. This is the build spec; the
rules in `docs/architecture.md` apply throughout.

## Goal

The owner decides what each agent may change, can see it at a glance and can take it back
(invariant 4, "Permissions are visible and revocable"). The fixed agent allowlist gives
way to **grants**: named capabilities held by an agent profile. When an agent tries
something it isn't granted, the API refuses it and files an **access request** in the
inbox instead of failing silently. Approving it grants the capability until the owner
revokes it in the new **Agents** view.

A second agent proves the runtime contract (invariant 7): **GPT**, running on Pi
(`pi-agent-core` + `pi-ai`) with the owner's Codex login, chosen per thread when the
thread starts. It starts with no grants, which is what the demo uses.

## Demo scenario (acceptance)

1. `docker compose up -d`, `npm run dev`, open http://127.0.0.1:5400. The rail shows
   **Agents**. The Agents view lists **Claude** (Claude Agent SDK · `claude-opus-5-5`)
   with Work items, Thread links and Proposals granted, and **GPT** (Pi · the Codex model)
   with nothing granted.
2. In Corner Bakery's Threads view, start a thread with **GPT** picked in the composer:
   "Add a work item 'Print loyalty cards' under the loyalty card goal." GPT streams
   live. Its `create_work_item` call is refused, and the tool row reads "Access requested ·
   Work items". GPT tells the owner it asked. The inbox count goes up by one in every tab,
   live.
3. Open the Inbox. The access request shows GPT, the capability (Work items, with
   the commands it covers), what it tried ("create work item “Print loyalty cards”"),
   the thread and the age. **Approve** with the note "Fine for work". The thread gets a braise
   line: "Granted Work items to GPT · Fine for work". The Agents view shows the grant,
   live.
4. In the thread: "Try again." GPT creates the work item. The Work view shows it, and
   Activity records it under GPT with the run.
5. In the Agents view, revoke Work items from GPT. Ask GPT to mark the item doing. It is
   refused, and a new access request appears. **Deny** it with the note "Not now". The
   thread gets the braise line, and GPT reads it the next time the owner writes.
6. Claude threads are unaffected: Claude still creates work items. Stopping braise
   during a GPT run marks it interrupted, and **Retry** runs it again, just as with Claude.

## In / out of scope

**In:** `agent_profiles` (moved from code) and `agent_grants`, `access_requests`;
capabilities replacing the allowlist in the pipeline; an access request filed by the
API on every out-of-grant attempt (deduplicated while pending); the commands
`access.request`, `access.approve`, `access.deny`, `grant.add`, `grant.revoke`; braise lines
in the requesting thread; access requests in the inbox and the rail count; the Agents view
with grant toggles; the agent picker on a new thread; the Pi runtime adapter with the
`openai-codex` provider; the system prompt listing the agent's grants; live updates.

**Out:** `needs_input`; per-venture or per-command grants; one-time grants; replaying the
refused command on approval; stopping running runs on revoke; changing a thread's agent
after it starts; editing profiles (model, name) or adding profiles in the UI; pi-durable
or any durability layer; GPT through an API key; read access as a grant (reads stay
open through the reader role); grants on owner-only commands (proposal decisions,
archives, venture fields stay owner-only, out of any grant's reach).

## Decisions (from the owner, 2026-11-24)

- **Git:** one branch, `feat/slice-5-grants-pi` from `main` (`4688d62`). Grants land
  first (api, then web), then the Pi runner as its own commit.
- **Grant model:** named capabilities held by an agent profile, across all ventures.
  Agent profiles move from code into a table. Agents always see every tool, and the API
  refuses what isn't granted.
- **Access requests:** the run continues; the tool result says access was requested.
  Approving gives a standing grant until revoked. The refused command isn't replayed. Approve
  and deny post a braise line in the requesting thread, as proposals do.
- **Revocation:** an Agents view in the rail, with each profile and its capabilities as
  toggles. Revoking takes effect on the agent's next command; running runs keep going.
- **Pi storage:** no durability, like Claude: Pi's agent loop runs behind the runtime
  contract with nothing stored outside Postgres, and restarts mark runs interrupted.
  pi-durable comes later. Invariant 3 holds.
- **Models:** Claude Code (the Agent SDK) runs Anthropic models, and Pi runs all GPT models.
  This replaces "GPT on its own runtime" in the 2026-11-24 runtime split.
- **GPT auth:** Pi's `openai-codex` provider on the owner's existing Pi login
  (`~/.pi/agent/auth.json`, ChatGPT subscription). No API key. Tokens stay in that file,
  never in Postgres or `.env`.
- **Agent choice:** per thread, chosen when it starts (default Claude). Every owner message in
  the thread runs that agent.
- **`needs_input`:** later.

## Capabilities

Fixed in code (`@braise/core`), the same way the allowlist was:

| Capability | Label | Commands |
|---|---|---|
| `work` | Work items | `work.create`, `work.update`, `work.set_status`, `work.move` |
| `links` | Thread links | `thread.link`, `thread.unlink` |
| `propose` | Proposals | `proposal.create` |

An agent actor may run a command only when its profile holds the command's capability.
`access.request` is the one agent command outside every capability: only the pipeline
issues it, and no tool exposes it. All other commands stay owner-only, and an agent gets
403 `not_granted` with no access request, because no grant could allow them.

## Schema

```sql
agent_profiles
  id text PK                               -- 'claude' | 'gpt'
  actor text NOT NULL UNIQUE               -- 'agent:claude' | 'agent:gpt'
  name text NOT NULL                       -- 'Claude' | 'GPT'
  runtime text NOT NULL                    -- 'claude-agent-sdk' | 'pi'
  model text NOT NULL                      -- 'claude-opus-5-5' | the Codex model id
  created_at

agent_grants                               -- one row per grant; revoking closes it
  id uuid PK (UUIDv7) · profile_id text NOT NULL FK → agent_profiles
  capability text NOT NULL CHECK IN ('work','links','propose')
  granted_by text NOT NULL · granted_at
  access_request_id uuid NULL FK → access_requests
  revoked_by text NULL · revoked_at NULL
  UNIQUE (profile_id, capability) WHERE revoked_at IS NULL

access_requests
  id uuid PK (UUIDv7) · profile_id text NOT NULL FK → agent_profiles
  capability text NOT NULL CHECK IN ('work','links','propose')
  thread_id uuid NOT NULL FK → threads · run_id uuid NOT NULL FK → runs
  venture_id uuid NULL FK → ventures       -- the attempted command's venture, if any
  command text NOT NULL · payload jsonb NOT NULL   -- the first refused attempt
  attempts int NOT NULL DEFAULT 1
  status text NOT NULL CHECK IN ('pending','approved','denied')
  note text NULL · created_at · decided_at NULL
  UNIQUE (profile_id, capability) WHERE status = 'pending'
  INDEX (status, created_at)

threads + agent_profile_id text NOT NULL DEFAULT 'claude' FK → agent_profiles
```

- The migration seeds both profiles and Claude's three grants (`granted_by 'braise'`), so
  Claude keeps exactly today's access. Existing threads get `claude`.
- `runs.runtime`, `runs.model` and `runs.actor` are copied from the thread's profile when
  a run is queued, as today. `BRAISE_AGENT_MODEL` goes away, and the model lives on the profile row.
- The reader role gets `SELECT` on `agent_profiles`, `agent_grants` and
  `access_requests`.

## Commands

The grant and access commands are global: no venture lock and no domain events, like
thread commands. They are recorded in `commands` (actor, run, reason; invariant 6), and
the pipeline gains a third outcome kind for them. Each one `NOTIFY`s a new `access` hint, and
approve and deny also lock and notify the requesting thread.

| Command | Who | Effect | Notes |
|---|---|---|---|
| `access.request` | pipeline, for an agent | stores a pending request, or bumps `attempts` on the pending one for the same profile and capability | `{ capability, threadId, command, payload }`; the run is the request's `runId`; idempotency key `access:<runId>:<command>:<payload hash>` |
| `access.approve` | owner | adds the grant (linked to the request), marks it `approved`, posts the braise line | `{ accessRequestId, note? }`; `access_decided` if not pending; if the grant already exists (owner granted it meanwhile), it just marks the request approved |
| `access.deny` | owner | marks it `denied`, posts the braise line | `{ accessRequestId, note? }` |
| `grant.add` | owner | adds a grant | `{ profileId, capability }`; `no_changes` if held; a pending request for it is marked approved |
| `grant.revoke` | owner | closes the grant | `{ profileId, capability }`; `no_changes` if not held |

- **Enforcement:** `assertGranted` becomes a query on the agent's active grants, run before
  the command's transaction. When the command needs a missing capability, the pipeline
  runs `access.request` as the agent, with the same run, then throws 403 `not_granted`
  with `{ command, capability, accessRequestId }`. An agent request without a `runId`
  is refused without filing (there is no thread to answer in).
- **Braise lines:** "Granted Work items to GPT" or "Denied Work items to GPT", plus
  " · note". They are posted only if the thread is live.

## Agent tools and prompt

- The tools are unchanged and every profile gets all of them. A tool whose command comes back
  `not_granted` with an `accessRequestId` returns a non-error text: "Access requested ·
  <label>. The owner decides in the inbox; carry on with what you can and tell the
  owner." The tool row renders it as "Access requested · Work items".
- The system prompt's "What you can do" lists the run's granted capabilities. It says
  that the rest are filed as access requests automatically when tried, and that you
  should tell the owner rather than retry. Reads are always available. The agent's name
  comes from its profile.

## Pi runtime adapter

`packages/api/src/agent/pi.ts` implements `AgentRuntime` (name `pi`) on
`@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` (1.6.0, pinned):

- The model comes from pi-ai's `openai-codex` catalog by `input.model`. Auth goes through
  pi-ai's OAuth support, reading and refreshing `~/.pi/agent/auth.json` the way Pi does.
  A missing login fails the run with "Log in with `pi` (OpenAI Codex) first".
- braise tools map to Pi tools (the zod shape becomes JSON Schema). Pi's event stream maps
  to `RunSignal`s: text deltas, finished text blocks, tool calls and results, and usage at the end.
- No session or durability storage. `abort` aborts the Pi agent. Each run rebuilds its
  context from Postgres, as Claude's does.
- The worker picks the runtime by `run.runtime` from a `{ "claude-agent-sdk", pi }` map.
  An unknown runtime fails the run.

## Reads and live updates

| Endpoint | Returns |
|---|---|
| `GET /api/inbox` | `{ pending, decided }` as before, but each item now has `kind: 'proposal' \| 'access_request'`. Access request items carry the profile (id, name), capability, command, a one-line summary of the attempt, attempts, the thread (id, title), the venture if any, status, note and the times |
| `GET /api/agents` | the profiles (id, name, runtime, model), each with every capability: `granted`, and the last change (`grantedAt`/`revokedAt`, by whom, via a request or directly) |

- A new SSE hint, `access`, is sent on every grant or access command. The web client
  invalidates `['inbox']` and `['agents']` on it (and keeps invalidating the inbox on
  venture hints for proposals).
- `thread.start` takes an optional `agentProfileId` (default `claude`). Thread reads
  include the profile (id, name).

## UI brief (impeccable, inside the established world)

**Mode:** Operate, in the Growth Rings system (`packages/web/DESIGN.md`, contract
`packages/web/.impeccable/surfaces/index-html.md`). DESIGN.md changes only with the
owner's approval.

**Rail:** an **Agents** entry in the global attention section, below the runs slot, with no
count. The Inbox count now includes pending access requests.

**Agents view (`/agents`):** one section per profile: the name, runtime and model in mono,
then one row per capability with its label, the commands it covers (muted, mono), the
last change ("granted 2h ago, approving a request" or "revoked yesterday by you") and a
switch. Switching runs `grant.add` or `grant.revoke` immediately: no confirmation,
because it's reversible and visible. A pending request for that capability shows an
inline link to it in the inbox.

**Inbox:** access request rows sit in the same list as proposals, oldest first. Each row
shows the agent's name, "asks for Work items", the venture (ring marker) or Holding, the
age, and "×n" when it was retried. The review pane shows the capability and its commands,
what was tried (the summary and the payload as a quiet key/value list), the thread link,
an optional note, then **Approve** (resin, the only primary) and **Deny**. Decided requests
are read-only, with the decision and the note.

**Threads:** the new-thread composer gets an agent picker (Claude / GPT, native select).
The thread header and the agent's message bylines use the profile name. The refused tool
row reads "Access requested · <label>" with a link to the inbox item.

**States:** loading skeletons; GPT not logged in (the run fails with the login hint); a
request decided in another tab updating live; a toggle that fails (inline error, switch
reverts).

**Boundaries:** desktop-first (about 1024px minimum), rendered verification and the
craft-floor check through impeccable before the slice lands.

## Local dev deltas

- One Drizzle migration (three tables, `threads.agent_profile_id`, seed rows, reader
  grants).
- New dependencies: `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` 1.6.0 and
  `proper-lockfile` (api), `msw` (dev, api) for the Pi adapter test.
- braise's workspace export condition is renamed from `source` to `@braise/source`: Pi's
  packages publish a `source` condition pointing at `src/` files that aren't in the tarball.
- The owner logs in to Pi's OpenAI Codex once (`pi`, then `/login`); this is already done
  on this machine.

## Tests (against real Postgres; no live model)

- Unit: the capability for each command and the label text; braise line text; the system
  prompt listing grants; the access-request summary of an attempt; the inbox and agents
  labels in the web.
- Integration (`grants.integration.test.ts`):
  - Claude's seeded grants allow today's commands;
  - GPT's `work.create` → 403 with an `accessRequestId`, a pending request with the run and
    thread, and nothing else written;
  - a second attempt bumps `attempts` on the same request;
  - an owner-only command → 403 with no request;
  - approve → the grant, the braise line, and the agent's retry succeeds;
  - revoke → refused again and a new request;
  - deny posts its line;
  - `access_decided` on a second decision;
  - `grant.add` approves a pending request;
  - agents get 403 on every access and grant command.
- Threads: `thread.start` with `agentProfileId: 'gpt'` queues a run with runtime `pi`, the
  Codex model and actor `agent:gpt`; later posts reuse the thread's agent.
- Pi adapter (`pi.test.ts`): runs in-process against MSW serving a recorded Codex
  Responses stream (text and one tool call), with credentials from a temp auth file; it
  asserts the `RunSignal` sequence, the tool executed, and abort.
- Reads through the HTTP app: the inbox with both kinds, and `GET /api/agents`.
