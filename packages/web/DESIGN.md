---
name: braise
description: The owner's holding console as a city at night. Deep violet dark, saturated venture colour, lifted cards, state that glows.
colors:
  space: "#0c0a14"
  stage: "#12101a"
  sunk: "#0e0c16"
  card: "#18161f"
  raise: "#211e2a"
  hover: "#28252f"
  ink: "#f2f0f7"
  ink-2: "#c5c2cf"
  ink-3: "#9a97a6"
  ink-4: "#6c6979"
  acc-ink: "#120f18"
  hue-lime: "#3ddc84"
  hue-cyan: "#4aa8ff"
  hue-violet: "#8f6bff"
  hue-tangerine: "#ff8a2a"
  hue-pink: "#ff4f9a"
  hue-blue: "#5b7cff"
  hue-lime-light: "#c3f6d8"
  hue-cyan-light: "#cfe6ff"
  hue-violet-light: "#ddd3ff"
  hue-tangerine-light: "#ffd9b8"
  hue-pink-light: "#ffc9df"
  hue-blue-light: "#d3dcff"
  holding: "#8b96ff"
  beacon: "#ffc93c"
  danger: "#ff6b6b"
  ok: "#7cd591"
  sky-top: "#160f2c"
  sky-mid: "#0f0b1e"
  sky-glow: "#3b2477"
typography:
  hero:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Display, system-ui, sans-serif"
    fontSize: "56px"
    fontWeight: 800
    lineHeight: 1.06
    letterSpacing: "-0.035em"
  hero-sub:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Display, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Display, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.022em"
  figure:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Display, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.045em"
    fontFeature: "tnum"
  section:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Display, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.03em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Display, system-ui, sans-serif"
    fontSize: "16.5px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  kicker:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.3em"
  status:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.12em"
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
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  control: "9px"
  row: "9px"
  field: "10px"
  dock: "10px"
  tile: "16px"
  card: "18px"
  rail-item: "18px"
  sheet: "24px"
  pill: "99px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "24px"
  6: "36px"
components:
  button:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "30px"
    padding: "0 12px"
  button-hover:
    backgroundColor: "{colors.hover}"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.acc-ink}"
    rounded: "{rounded.control}"
    height: "30px"
    padding: "0 12px"
  card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.card}"
    padding: "17px"
  stat-tile:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.tile}"
    padding: "15px 16px"
  status-label:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "9px 14px 9px 12px"
  dock-slot:
    textColor: "{colors.ink-3}"
    rounded: "{rounded.dock}"
    height: "40px"
    padding: "0 13px"
---

# Design System: braise (v7, the Valley)

## Overview

**Creative North Star: "The Valley at Night"**

The holding is a city block after dark. Each venture is a building with its lights on, agents
are working the night shift, and anything that waits for the owner glows amber until they deal
with it. The app around the city is the same night: deep violet-black surfaces, saturated
venture colour, cards that lift off the ground, and state that pulses and glows. It is an
operator's console with a sense of occasion, not a marketing page. Density and scanability
still win on every working screen.

The approved comp is `valley-mock.html` at the repo root (owner, 2026-11-27, after the
assessment in `docs/valley-assessment.md`). It replaces v6 (`ui-prototype-6.html`, no longer
in the repo) app-wide. When this file and the comp disagree, the comp's computed result is
the reference, except where the owner's decisions below override it: running is the venture
hue (not the comp's blue), the Inbox stays the only place to approve (no one-click approve or
confetti), and the venture states are needs you, running, queued and quiet (the comp's
shipped and crashed states are dropped). The visual reference for the city is the owner's
banner image `the-holding-banner.png`.

`src/styles.css` moves to this system in phases (the plan is in `docs/valley-assessment.md`
§6). Until a phase lands, the screens it hasn't reached still show v6, and that is expected.

**Key Characteristics:**
- Deep violet-black night with a purple sky glow at the top of the two Overviews.
- Six saturated venture hues, always derived from the slug.
- An app-icon tile per venture: a dark glass tile, a hue wash, a gradient line glyph.
- Lifted cards with soft drop shadows and a hover rise.
- State carried by tone everywhere: venture hue running, amber needs you, hollow grey queued.
- The system type stack only. Big, tight headlines on the Overviews; calm chrome elsewhere.

## Colors

A night palette: violet-tinted neutrals for every surface, six loud venture hues, and three
signal colours.

### Primary (venture hues)
- **Signal Lime** (`hue-lime`), **Night Cyan** (`hue-cyan`), **Neon Violet** (`hue-violet`),
  **Ember Tangerine** (`hue-tangerine`), **Hot Pink** (`hue-pink`), **Electric Blue**
  (`hue-blue`): each venture owns one, picked from its slug by `hueOf(slug)` in
  `src/marks.tsx`. Set it on a subtree with `style={accent(slug)}`, which defines `--acc`.
  Used on the venture's app icon wash, its building, selection, running state, the primary
  button, progress tracks, card washes and small references such as bet numbers. All six pass
  4.5:1 as text on `card` and `stage`.
- **The light tints** (`hue-*-light`): the top stop of the app icon glyph gradient and the
  highlight on lit glass. Never used as text colour on their own.
- **Holding Periwinkle** (`holding`): the Holding's own icon tile. In Holding scope `--acc`
  is `ink`, so the Holding's chrome stays neutral.

### Secondary (signals)
- **Beacon Amber** (`beacon`): something waits for the owner. The needs-you dot, the
  attention count, the Needs you tile, the inbox count in the dock, the left bar on a waiting
  item.
- **Done Green** (`ok`): a finished run, inserted text, granted capabilities, approved marks,
  the live-connection dot. Deliberately softer than `hue-lime`, so a lime venture's running
  state never reads as "done".
- **Alarm Red** (`danger`): failed or interrupted runs, removed text, rejected marks, errors.

### Neutral
- **Night** (`space`): behind everything: the rail, the deck, the page edge.
- **Stage** (`stage`): the main panel and the sheet that rises over the hero.
- **Sunk** (`sunk`): wells inside cards: diffs, code, an idle cast strip.
- **Card** (`card`), **Raise** (`raise`), **Hover** (`hover`): cards, then menus, toasts,
  buttons, then hover fills.
- **Ink** (`ink` to `ink-4`): text from titles down to quiet meta. `ink-4` is under 4.5:1 and
  is for hollow pips, dashed outlines and disabled glyphs, never for text.
- **Lines**: cool white at 4.5%, 7% and 12% alpha (`--line-soft`, `--line`, `--line-2`:
  `rgb(240 236 255 / …)`). No warm-white literals.
- **The sky** (`sky-top`, `sky-mid`, `sky-glow`): the hero gradient on the two Overviews only.

### Named Rules

**The Hue Means Venture Rule.** A venture hue is that venture's identity, and running is shown
in it. Never pick a hue by hand and never use one to mean a status.

**The Amber Means You Rule.** `beacon` is only for things waiting on the owner.

**The Night Has No Warmth Rule.** Every surface, line and shadow is in the violet-black
family; warm-white alphas from v6 go.

## Typography

**Display Font:** SF Pro Display through the system stack
**Body Font:** SF Pro Text through the system stack
**Label/Mono Font:** SF Mono (`ui-monospace`) for data; New York (`ui-serif`) italic for quotes

**Character:** One family at two optical sizes carries everything: tight and heavy for the
Overviews' headlines and figures, calm and small for chrome. No web fonts.

### Hierarchy
- **Hero** (`hero`, 800, 56px): the Overview headline over the city ("The Valley never
  sleeps."). One per page, only on the two Overviews. 44px under 1240px, 32px under 760px.
- **Hero sub** (`hero-sub`, 700, 34px, `ink-2`): the line under the hero ("2 ventures on
  shift.").
- **Kicker** (`kicker`, 700, 13px, 0.3em, uppercase, `ink-2`): the scope label above the hero
  ("THE HOLDING", or the venture's name), led by the live-connection dot.
- **Display** (`display`, 700, 32px): page titles on every other page (`.h1`).
- **Figure** (`figure`, 800, 28px, tabular): the number in a stat tile.
- **Section** (`section`, 700, 17px): section heads, with their count beside them in `data`.
- **Title** (`title`, 700, 16.5px): a card's name.
- **Status** (`status`, 700, 11px, 0.12em, uppercase, in `--tone`): the state word in a
  status label ("RUNNING", "NEEDS YOU", "QUEUED").
- **Reading** (`reading`, 16px): strategy text, messages and proposed changes.
- **Body** and **Caption** (`caption` is `.cap`, the one quiet meta style).
- **Data** (`.mono`): times, sequence numbers, counts like `3/8`, command names, tool I/O.
- **Quote** (serif italic, 15px): a venture's why, reasons, an agent's case for a change.

### Named Rules

**The One Hero Rule.** `hero` and `hero-sub` exist only on the Holding and venture Overviews.
Working pages use `display`.

## Layout

`.app` is a grid: an **84px rail** of venture app icons on the left, the main panel, and a
**68px deck** at the bottom holding the dock (centre) and the agent chips (right). The
operator panel is a 408px third column toggled from the rail. There is no top bar.

**The Overviews** are a full-bleed **hero** (620px on the Holding; shorter on a venture,
around 360px) holding the sky, the mountains, the city and the HUD, with a **sheet** that
rises 24px over its bottom edge on a 24px top radius. Inside the sheet: a stats row (four
tiles), then two columns: the campus (venture cards, two across) and a 360px sticky aside
(Needs you, On shift). The venture Overview keeps its own content in the sheet: venture
sheet, Integrations, At a glance, Needs you, recent activity.

**Working pages** keep their current structure: scrolling pages (`.page`, max 1160px;
`.page.narrow`, 800px) or fixed screens with their own scroll regions (`.split` for Threads
and Inbox, `.wk` for Work, `.wpage` for a work item).

**Responsive:** under 1500px the agent chips drop their "over <venture>" text; under 1240px
the hero type steps down; under 1100px the aside drops below the campus and the chips hide;
under 760px the rail hides, the dock shows icons only, cards go to one column, and the city's
labels and the legend hide.

## Elevation & Depth

Lifted. Cards, tiles and the sheet sit above the ground on a soft drop shadow with a faint
inner top highlight and a hairline ring; hovering a card raises it 3px and deepens the
shadow. Glows are reserved for light that means something: a pulsing running pip, an amber
needs-you dot, a hovered building's label ring in its tone, lamp light in the city.

### Shadow Vocabulary
- **Lift** (`--lift`: `0 1px 0 rgb(240 236 255 / 0.04) inset, 0 0 0 1px var(--line), 0 14px
  30px -18px rgb(0 0 0 / 0.8)`): every card and tile at rest, buttons' outer ring.
- **Lift high** (`--lift-hi`: `0 1px 0 rgb(240 236 255 / 0.06) inset, 0 0 0 1px var(--line-2),
  0 24px 44px -20px rgb(0 0 0 / 0.9)`): hovered cards, toasts, tooltips, menus, the command
  menu.
- **Sheet** (`0 -1px 0 var(--line-2), 0 -24px 50px -20px rgb(0 0 0 / 0.9)`): the sheet over
  the hero.
- **Press** (buttons): a 2px bottom ledge (`0 2px 0 …`) that collapses on `:active` with a 2px
  drop.

### Named Rules

**The Glow Means Live Rule.** A glow or pulse marks live state or waiting state. Static facts
never glow.

## Shapes

Soft, friendly corners scaled to the object: controls and rows 9px, fields 10px, dock slots
and agent chips 10px, stat tiles 16px, cards and rail items 18px, the sheet 24px, labels and
the legend fully round. App icons are squircle tiles (inner radius about 22% of the tile).
Status pips are round; a queued pip is a hollow ring. Agents keep the `Drone` mark (an open
ring around a round core for the Claude Agent SDK or a square core for Pi), the owner the
solid diamond (`You`), work status the diamonds (`Dia`), priority the stacked chevrons
(`Rank`).

## Components

All parts are the app's own; there is no component library and no icon library.
`src/marks.tsx` holds the one icon set, the app icon and the marks.

### App icon (signature)
The venture's mark everywhere a venture appears (rail, dock scope switcher, ⌘K, menus, cards,
labels, needs-you rows, cast strips). A near-black glass tile with a vertical dark gradient, a
wash of the venture hue rising from the bottom, a hairline edge fading into the hue, and a
line glyph stroked with a gradient from the hue's light tint to the hue. The glyph is picked
from the slug by hash, like the hue, so nothing is stored. An optional state dot sits at the
top right (31% of the tile) in `--tone`, ringed in `space`. Below about 20px the tile drops
its wash and edge and shows the glyph in the hue. Gradient ids are unique per instance.

### Rail and dock
- **Rail:** 84px on `space`. The Holding tile, then one 64px item per venture holding a 58px
  app icon with its state dot, a separator, the dashed "new venture" box, and at the bottom
  the operator toggle (venture scope), ⌘K and You. The current item has a 3px bar on its
  left edge; hover lifts the icon 2px and scales it 5%.
- **Dock:** flat 40px slots in `ink-3`, the current slot in `ink` with its glyph in `--acc`,
  and a `card` thumb with Lift that slides to the current slot. The scope switcher shows the
  scope's app icon and name. Keys (1–5, I, A, H, O, ⌘K) live in tooltips. The inbox count is
  an amber pill.
- **Agent chips:** a busy agent's chip is tinted with its venture's hue, with the `Drone`
  mark, its name, "over <venture>", and the elapsed time in `data`.

### Venture state
One state per venture, by precedence: **needs you** (`beacon`, bobbing dot) > **running**
(venture hue, pulsing) > **queued** (hollow `ink-4` ring) > **quiet / active** (no dot; the
meta line says "Quiet for 9 days" or "Active 2h ago"). Set it as `data-tone`
(`needs`, `live`, `wait`) so `--tone` resolves. Threads, spaces and report lines keep their
own tones, including `ok` and `bad`.

### The Valley (Overview hero)
- **Sky:** the gradient from `sky-glow` (a radial at the top right) through `sky-top` to
  `sky-mid` and down into `space`, a field of twinkling stars and a rare shooting star, and
  two ranges of violet mountains masked into the haze.
- **City:** an isometric block on a lot grid, one building per venture, drawn from
  pre-rendered images: one per archetype and hue, chosen from the slug. Roads, lamps, trees
  and a pond fill the free lots. A building lifts on hover; clicking it opens the venture.
- **Labels:** a round `raise`-dark chip above each building: a pip in its tone, the name in
  17px/650, and the status word after a hairline divider; a thin stem and a glowing foot
  point at the roof. A hovered building's label gets a 1.5px ring in its tone.
- **HUD:** kicker, hero, hero sub, and the attention line ("3 things need your attention",
  with the count in an amber disc). The legend sits bottom left in a blurred round capsule.

### Stat tiles
A card-coloured 16px tile: an app-icon-style glyph tile, a caption label, a `figure` number and
a caption beside it ("oldest 2h"). The Needs you tile has an amber wash and an amber number.
Holding tiles: Ventures, On shift, Needs you, Work done this week.

### Cards
18px corners, `card` background, Lift, a 100px wash of `--acc` at 11% across the top, 17px
padding. Hover rises 3px into Lift high; the card for a hovered building gets an inner ring in
its hue. A venture card: app icon, title, caption meta, the strategy version as a small
hue-tinted pill, the quoted why, the objective with its progress track in `--acc`, the work bar
(done, doing, todo in `ok`, `--acc`, a hollow segment) and the cast strip.

### Cast
The live strip of what an agent is doing: a hue-tinted band with a sweep, the agent and what
it's doing, and an elapsed clock in `data`. Idle ("Waiting on you") is a plain `sunk` band.

### Needs you
A card per waiting item with a 3px amber bar on its left edge, the kind in amber uppercase
caption, the venture and age, the title, and the quoted reason when the row has one. Each
opens the item in the Inbox; approving happens only there.

### Buttons
`.btn` on `raise` with a hairline ring and a 2px ledge that presses down on `:active`;
`.btn.pri` in `--acc` with `acc-ink` text and a ledge in the hue mixed toward black; `.btn.ghost`
with no fill until hover; `.btn.danger`; `.btn.sm`; `.ib` icon buttons, which always have an
`aria-label` and a `data-tip`.

### Unchanged parts, restyled by the tokens
The menu (`Select`), the command menu (⌘K), inline editing (`Editable`), Markdown
(`MarkdownText`, `MarkdownField`), tooltips (`data-tip`), toasts (`toast()`), objective cards,
bet blocks, the run trace, the work page, spaces, the operator panel and the draft states
(dashed outline, green new, struck red old value, red archive) keep their structure and
behaviour; they take the new tokens, shapes and shadows.

## Do's and Don'ts

### Do:
- **Do** set `--acc` with `accent(slug)` on every venture-scoped container.
- **Do** derive a venture's hue, glyph and building from its slug; never store or hand-pick
  them.
- **Do** keep `hueOf`'s hash and hue order fixed, so a venture's colour never moves.
- **Do** show state through `data-tone` (`live`, `needs`, `wait` for ventures; plus `ok` and
  `bad` for runs, threads and spaces).
- **Do** put every `animation` and `transition` in the
  `@media (prefers-reduced-motion: no-preference)` blocks in `styles.css`.
- **Do** prefix Overview-only classes with `vl-` under a `.valley` root; restyle shared rules
  (`.btn`, `.cast`, `.pip`, `.vc`) in place rather than adding a second rule.
- **Do** give each row one title and one grey meta line.

### Don't:
- **Don't** add a top bar or breadcrumbs.
- **Don't** add one-click approve, grant or answer buttons outside the Inbox.
- **Don't** use a fixed colour (the comp's blue) for running.
- **Don't** reintroduce shipped or crashed as venture states.
- **Don't** load web fonts, an icon library or a 3D engine.
- **Don't** hard-code the comp's example ventures (Nimbus, Kettle, Loopwell, Orbit Snacks,
  Grizzly) or v6's (Larder, Tidewater, Fieldnotes, Quorum).
- **Don't** bring back v6's warm near-black or the Growth Rings look (pith rail, sage ground,
  resin, ring glyphs, Bricolage and Geist).
