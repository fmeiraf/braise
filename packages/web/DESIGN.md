---
name: braise
description: The owner's holding console. Calm, dark, and coloured only where colour means something.
colors:
  space: "#0a0807"
  stage: "#110f0e"
  sunk: "#0d0b0a"
  card: "#171513"
  raise: "#1f1d1b"
  hover: "#252220"
  ink: "#e9e8e4"
  ink-2: "#bcbab6"
  ink-3: "#8e8c88"
  ink-4: "#65635f"
  hue-lime: "#b2e28b"
  hue-cyan: "#7dd7e9"
  hue-violet: "#bba8f5"
  hue-tangerine: "#f3b473"
  hue-pink: "#f49cba"
  hue-blue: "#89b7f3"
  beacon: "#f6cf6d"
  danger: "#f07f77"
  ok: "#7cd591"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Display, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.022em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Display, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1
    letterSpacing: "-0.012em"
  reading:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "-0.011em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.47
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.3
  data:
    fontFamily: "ui-monospace, SF Mono, SFMono-Regular, Menlo, monospace"
    fontSize: "11.5px"
    fontWeight: 400
    letterSpacing: "-0.01em"
  quote:
    fontFamily: "ui-serif, New York, Georgia, serif"
    fontSize: "16.5px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  control: "8px"
  row: "9px"
  field: "10px"
  card: "14px"
  dock: "10px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "24px"
  6: "36px"
---

# braise design system (v6)

## Overview

The approved comp is `ui-prototype-6.html` at the repo root. `src/styles.css` is that
prototype's stylesheet, consolidated into one cascade, followed by the rules the real
screens need that the prototype lacks (forms, inline editing, errors, loading, Markdown).
When the two disagree, the prototype's computed result is the reference.

Five principles, settled by the owner:

1. **Calm attention.** One emphasised thing per row or tile (its title) and one quiet
   grey meta line. No coloured pills for plain facts; counts are plain numbers.
2. **Colour is alive but means something.** The venture hue appears on the crest,
   selection, live state, the primary button, status diamonds, progress and small
   references such as bet numbers. Amber (`beacon`) means "needs you". Green and red are
   for diffs and outcomes.
3. **No top bar.** Location is carried by the rail, the dock and each page's own title.
4. **The dock sits on the ground, like the rail.** No capsule, border or shadow: flat 10px tabs with a sliding selection. Keyboard keys (1–5, I, A, H, ⌘K) live in
   tooltips.
5. **Reading sizes for things you read.** Strategy, messages and proposed changes are
   set at 15.5–16px; chrome stays at 12–13.5px.

History: v4 was "everything screaming", v5 "toned down way too much, missing life"; v6
is the balance.

## Colors

One warm near-black world. Surfaces step up in lightness: `space` (behind everything),
`stage` (the main panel), `card`, `raise` (menus, toasts). Lines are warm white at 4.5%,
7% and 12% alpha.

### Venture hue

Each venture has one of six hues (`lime`, `cyan`, `violet`, `tangerine`, `pink`,
`blue`), picked from its slug by `hueOf(slug)` in `src/marks.tsx`. Set it on a subtree
with `style={accent(slug)}`, which defines `--acc`; everything below reads `--acc`. In
Holding scope `--acc` is `ink`, so the Holding is neutral.

### Signals

- `beacon` (amber): something waits for the owner. The inbox count and the `need` dot.
- `ok` / `danger`: inserted and removed text, granted capabilities, approved and
  rejected marks, errors.

### State tones (slice 7)

Work that is in flight carries its state as colour wherever it shows (space rows, the
space header's status bar, member rows, thread cards, report lines), set with
`data-tone` on the element so `--tone` resolves:

- `live` (running): the venture hue, pulsing.
- `needs` (waiting for the owner): `beacon`.
- `ok` (finished): `ok`.
- `bad` (failed or interrupted): `danger`.
- `wait` (queued or idle): `ink-3`, drawn as a hollow pip.

A space is its own object, never drawn like a thread: a tinted `SpaceMark` tile of its
members' states, a venture-tinted header band with a segmented status bar, and a tinted
"Part of the space" band on each member thread. Added after the owner found the first
spaces screen too bland to tell what was happening (2026-11-26).

### Named rules

- **The Hue Means Venture Rule.** Never use a venture hue for status, and never pick a
  hue by hand.
- **The Amber Means You Rule.** `beacon` is only for things waiting on the owner.
- **The Plain Number Rule.** Counts are grey numbers beside a heading, not badges. The
  one exception is the inbox count in the dock.

## Typography

The system stack only; no web fonts. San Francisco's optical sizes do the work.

- `display` for page titles (`.h1`), `title` for section heads and bars.
- `reading` for strategy text, messages and proposed changes.
- `body` and `caption` for everything else; `caption` (`.cap`) is the one quiet meta
  style.
- `data` (`.mono`) for times, sequence numbers, counts like `3/8`, command names, tool
  input and output.
- `quote` (serif italic) for reasons: why a strategy was revised, why an agent proposes
  a change.

## Layout

`.app` is a grid: a 56px rail of ventures on the left, the main panel, and a 64px deck
at the bottom holding the dock (centre) and the agent chips (right). Pages are either
scrolling (`.page`, max 1160px; `.page.narrow`, 800px) or fixed with their own scroll
regions (`.split` for Threads and Inbox, `.wk` for Work).

A work item opens as a full page inside the stage (`.wpage`, Linear-style): a bar with
back, position and previous/next, a 680px reading column (title, the Markdown "What done
looks like", tasks, threads) and a 340px card-coloured side column with status,
properties as label/value rows, the trace chain and archive. ↑↓ or J/K step through
items in list order; Esc returns to the list with the row focused.

## Elevation & Depth

Flat by default: surfaces are separated by a 1px line and a lightness step. Shadows are
kept for things that float: menus (`.pop`), the command menu, toasts, tooltips, the
inspector and the sticky verdict bar.

## Shapes

Controls 8px, rows 9px, fields 10px, cards 14px, the dock tabs and agent chips 10px, the same as rail items.
Status marks are diamonds (`Dia`), priority is stacked chevrons (`Rank`), agents are an
open ring around a round (Claude Agent SDK) or square (Pi) core (`Drone`), the owner is
a solid diamond (`You`).

## Components

All parts are the app's own; there is no component library and no icon library
(`src/marks.tsx` holds the 16px icon set and the marks).

- **Rail and dock** (`src/shell.tsx`): venture crests in the rail; the dock's scope
  switcher, the scoped views (Overview, Strategy in a venture only, Work, Threads,
  Activity), Inbox and Agents, with a thumb that slides to the current view.
- **Venture pages** (`src/cockpit.tsx`, `src/settings.tsx`): Overview is the venture's home:
  an Integrations band led by GitHub (highlighted in the venture hue until it's connected
  and a repo is added), then "At a glance", one topic row each for Strategy, Objectives,
  Bets, Work and Threads with a figure and a link to its page, and Needs you and recent
  activity in the aside. No objective detail on the Overview. Strategy holds the kernel and the full objective →
  assumption → bet cards, hunches and learnings. Settings (a gear on the Overview header
  and ⌘K, not the dock) holds GitHub, repos with their sandbox domains, and archiving.
- **Crest** (`Crest`): a symmetric dot pattern drawn from the venture's slug. Dots
  twinkle while an agent works in that venture.
- **Cast** (`Cast`): the live strip (what an agent is doing, with a sweep and a clock).
- **Menu** (`Select` in `src/menu.tsx`): a button and a listbox with a gliding
  highlight; arrows, Enter, number keys and Escape.
- **Command menu** (`src/palette.tsx`): ⌘K, ventures, views and threads.
- **Buttons**: `.btn` (quiet), `.btn.pri` (the one primary action, in the venture hue),
  `.btn.ghost`, `.btn.danger`, `.btn.sm`, and `.ib` for icon buttons, which always have
  an `aria-label` and a `data-tip`.
- **Inline editing** (`Editable`): text that turns into a field on click; Enter saves,
  Escape cancels.
- **Markdown** (`src/markdown.tsx`): `MarkdownText` renders GFM through react-markdown
  with the shared `.md` styles (thread prose uses it too); `MarkdownField` edits in place:
  click the rendered text and its source opens in the same reading type, with no box,
  border or buttons; clicking away or ⌘↵ saves, Escape cancels. The work page's title,
  task list and thread list are frameless too (Linear-style: content flows, rows only
  tint on hover).
- **Tooltips**: `data-tip="Label|hint"` on any element, `data-side="r"` to place it at
  the right.
- **Toasts** (`toast()` in `src/toast.ts`): short confirmations above the dock.
- **Objective card** (`src/objectives.tsx`): one card per active objective. A metric
  objective draws its readings from baseline toward the target (`Trend`); a build
  objective shows its time box and done list. Assumptions nest inside, each with `Conf`
  (four diamonds lit by confidence) and its bets (`BetBlock` in `src/bets.tsx`), which
  open to the registered test as one sentence.
- **Trace**: an agent run in a thread is a vertical line of steps (text, tool calls,
  proposals and access requests, the end line).

## Do's and Don'ts

### Do:

- Do set `--acc` with `accent(slug)` on every venture-scoped container.
- Do give each row one title and one grey meta line.
- Do put every `animation` and `transition` in the
  `@media (prefers-reduced-motion: no-preference)` block at the end of `styles.css`.
- Do keep the prototype's class names when adding to a screen, so it stays comparable
  with `ui-prototype-6.html`.

### Don't:

- Don't add a top bar or breadcrumbs.
- Don't add coloured pills or badges for plain facts.
- Don't load web fonts or an icon library.
- Don't hard-code example data from the prototype (Larder, Tidewater, Fieldnotes,
  Quorum).
- Don't use the Growth Rings look (pith rail, sage ground, resin, ring glyphs,
  Bricolage and Geist); v6 replaced it in the app.
