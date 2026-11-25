# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vite + React SPA (`packages/web`), TanStack Router + TanStack Query, zod schemas shared
from `@braise/core`, and plain CSS with the app's own controls (`packages/web/DESIGN.md`;
no component or icon library). Talks only to the braise API over HTTP + SSE.
Local-first: runs on the owner's machine; cloud deployment is possible later but out of
scope. See `docs/architecture.md`.

## Users

One user: the owner, a solo founder running several product ventures at once. The
other actors are AI agents (Pi + Codex, Claude Agent SDK) that work on ventures
within the permissions the owner grants. There are no other human roles. The UI can
be dense and expert-oriented.

## Product Purpose

braise is the owner's holding for all their product ventures, whether for profit or
not. It is the single place where each venture's why and what, its strategy, and its
execution live and are worked on. Agents do much of the work in threads with live
feedback. The owner steers, approves and decides.

Success: the owner always knows the state of every venture, strategy translates into
work without gaps, and agents make real progress with little of the owner's attention.

## Positioning

Not a generic project manager or chat tool. braise links **strategy → bets → goals →
work → agent runs** in one model. Every piece of work traces back to a bet and a
diagnosis, and agents operate inside that context under revocable, owner-granted
permissions. It deliberately rebuilds parts of Linear (work) and Slack (threads,
bots) as building blocks for that loop.

## Operating Context

- Desktop-first. Long working sessions (planning strategy, steering agents) mixed
  with quick check-ins (triaging the inbox, approving proposals, answering agents).
- Strategy follows Rumelt's kernel: why, what, diagnosis, guiding policy. Bets carry
  a hypothesis, an action and kill criteria. Goals have an outcome, a signal and a
  horizon.
- The **inbox** collects everything that needs the owner: proposals, access
  requests, agents waiting for input, and decisions.
- Each venture has its own GitHub repo(s); agents work in git worktrees.

## Capabilities and Constraints

- The owner's edits apply immediately. Agent changes to knowledge, strategy or big
  decisions are proposals that the owner approves.
- Strategy is versioned. A revision needs a reason, and history and diffs are
  first-class.
- Live updates: changes appear without a refresh, and agent runs stream in real time.
- Terminology: venture, strategy, bet, goal, work item, thread, run, proposal, inbox,
  agent profile.
- Undecided: mobile support beyond check-ins; any multi-user future.

## Brand Commitments

The Growth Rings brand kit in `assets/` (chosen by the owner 2026-11-24, replacing
braise.exe) is binding for the app UI: pith #131a16 rail, sage-white ground #f4f5f1,
resin #f0a63a only for the primary action and live state, moss #4f7a45 for done, bark
#b23a24 for errors, and one ring hue per venture. The growth-ring mark (off-centre
pith, two rings, an outer ring still being drawn), the Bricolage Grotesque wordmark,
Geist for UI and Geist Mono for data. Motion is the outer ring growing, and only when
something is actually live. Usage rules are in `assets/README.md`.

## Evidence on Hand

The Growth Rings brand kit (`assets/`). No real venture data yet; do not invent ventures, metrics
or testimonials beyond clearly labeled examples.

## Product Principles

1. Minimize the owner's attention: surface only what needs a decision. Everything
   else stays quiet and inspectable.
2. Strategy is the spine: every view reads along strategy → bets → goals → work.
3. Owner sovereignty: agents propose, and the owner approves. Permissions are
   visible and revocable.
4. Show the truth live: real state, real history, real agent activity, never stale
   or simulated.
5. Expert density over hand-holding: a single expert user, so prefer precision and
   speed to explanation.
