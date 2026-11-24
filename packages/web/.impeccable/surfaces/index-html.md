---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: []
---

# braise app shell (slice 1)

Mode: Operate. Desktop-first (~1024px min). One expert user, the owner.

Audience and job: the owner steering several ventures. Two scenes, equally: long planning sessions in the cockpit (read and revise strategy, bets, goals) and quick check-ins on the Holding table (what moved, one edit, leave).
Surfaces: Holding table, venture cockpit, strategy history (word diff + reason), activity feed, first-run create form. Topology and states are fixed by docs/slices/01-strategy-spine.md § UI brief.
Constraints: ember only for primary actions, selection and state. No modals, no ⌘K, no mobile layout. Live updates without refresh; a reconnect indicator only while the stream is down.
User steer (quoted): "A mixture of Linear and Slack UI, very modern and minimalist on details (not in content of functionality)". Must not feel like terminal cosplay or kitchen kitsch.

## Direction contract

THESIS: a working holding console where strategy is visibly the spine: every venture reads top-down, kernel → bets → goals, on one connected line. It refuses the category default of card grids and kanban columns for strategy.
OWN-WORLD: Slack's committed charcoal rail (#242423) with cream ink, beside a Linear-precise work area on a barely-cream ground; system UI sans at 13px with tabular numerals, ui-monospace only for data (seq, slugs, dates, versions). Hairline rules, 6px control radii, no cards; the venture title (20px) heads the cockpit. Ember #EC693A only on the primary action, selection and live state; deep #CE4D27 for pressed states; errors use a darker rust #A93B19 so error text keeps 4.5:1; pixel-square markers (from the logo's bubbles) for every status and activity dot.
STORY: the owner sees every venture's state at a glance, opens one, reads why/what/diagnosis/policy, then the bets and the goals testing them; edits in place, revises the strategy with a reason, and trusts the screen is live.
FIRST VIEWPORT: left 232px charcoal rail (wordmark, Inbox placeholder, Holding, venture list with pixel activity squares, Overview / Activity). Work area: venture title row with "v2 · revised 2d ago" and the History link; strategy kernel as a four-field definition grid; below it the spine: bets as rows hanging off a vertical hairline, goals nested beneath each bet, "Not tied to a bet" detached at the end. Right column 300px: recent activity (last 10). Primary action "Add bet" in ember, top right of the bets section.
FORM: a pinned direction; seed: none (pinned). Pinned by the user's words "A mixture of Linear and Slack UI, very modern and minimalist on details (not in content of functionality)", plus the binding brand kit and the slice spec's topology. Signature move: the spine, a 1px vertical line with pixel-square nodes joining strategy, bets and goals down to the detached "Not tied to a bet" group; live changes arriving from elsewhere make the touched node simmer (a brief ember pulse) and the sidebar square light up.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
