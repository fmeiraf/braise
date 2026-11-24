---
name: braise
description: The owner's holding console, where strategy is the spine of every venture.
colors:
  rail: "#242423"
  rail-ink: "#f7f2e6"
  rail-muted: "#b3ada0"
  rail-dim: "#8c877c"
  rail-quiet: "#5d5a53"
  rail-hover: "#2f2f2d"
  rail-active: "#3a3935"
  ground: "#fbf9f4"
  ground-sunk: "#f5f1e8"
  raised: "#fffefb"
  ink: "#242423"
  ink-2: "#57544d"
  ink-3: "#6e6a62"
  line: "#e9e4d8"
  line-strong: "#d8d0bf"
  ember: "#ec693a"
  ember-deep: "#ce4d27"
  ember-light: "#fa8851"
  ember-wash: "#fbe6dc"
  ember-wash-strong: "#f8d4c3"
  error: "#a93b19"
  won: "#3d7a4c"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-0.02em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.5
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.5
  data:
    fontFamily: "ui-monospace, SF Mono, Menlo, DejaVu Sans Mono, monospace"
    fontSize: "12px"
    fontWeight: 400
    letterSpacing: "-0.01em"
    fontFeature: "tnum"
rounded:
  hairline: "2px"
  sm: "4px"
  md: "6px"
  lg: "8px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
  "7": "48px"
components:
  button-primary:
    backgroundColor: "{colors.ember}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "28px"
  button-primary-hover:
    backgroundColor: "{colors.ember-light}"
  button-primary-active:
    backgroundColor: "{colors.ember-deep}"
    textColor: "{colors.rail-ink}"
  button-secondary:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "28px"
  button-secondary-hover:
    backgroundColor: "{colors.ground-sunk}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "28px"
  button-ghost-hover:
    backgroundColor: "{colors.ground-sunk}"
    textColor: "{colors.ink}"
  input:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
    height: "32px"
  tag:
    backgroundColor: "{colors.ground-sunk}"
    textColor: "{colors.ink-2}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    padding: "0 7px"
    height: "20px"
  status-pill:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "22px"
  rail-item:
    backgroundColor: "transparent"
    textColor: "{colors.rail-muted}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "28px"
  rail-item-hover:
    backgroundColor: "{colors.rail-hover}"
    textColor: "{colors.rail-ink}"
  rail-item-current:
    backgroundColor: "{colors.rail-active}"
    textColor: "{colors.rail-ink}"
  table-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    padding: "0 12px"
    height: "40px"
  table-row-hover:
    backgroundColor: "{colors.ground-sunk}"
---

# Design System: braise

## Overview

**Creative North Star: "The Holding Console"**

A working console for one expert owner steering several ventures. A committed charcoal rail (Slack's posture) sits beside a Linear-precise work area on a barely-cream ground. Everything reads top-down along one connected line, the spine: strategy kernel, then bets, then the goals testing them. Density is high and quiet: 13px system UI, hairline rules, 28px controls, no decoration that does not carry state.

The brand's simmering-terminal logo supplies exactly two devices and no more: the pixel-square bubble, which becomes every status and activity marker, and the ember orange, which is reserved for the one thing that matters on a screen. The app must never read as terminal cosplay or kitchen kitsch; monospace appears only where the content is literally data.

Liveness is shown, never claimed. Changes that arrive from elsewhere make the touched node and its rail square simmer once (an ember pulse that settles), and a blinking pixel appears in the rail foot only while the live stream is down.

**Key Characteristics:**
- Charcoal rail (232px) + cream work area; desktop only (1024px minimum width).
- Hairline-ruled rows and definition grids instead of cards.
- Pixel-square markers (5-7px, square, never round) for every status.
- Ember on the primary action, selection and live state only.
- Monospace strictly for data: seq numbers, slugs, dates, versions.

## Colors

A warm neutral ground of cream and charcoal from the brand kit, with one hot accent family (ember) used sparingly and two semantic exceptions (error rust, won green).

### Primary
- **Ember** (#ec693a, brand `--braise-orange`): the primary action button, focus rings, caret, input focus border, selected-version and recently-active pixels, fresh feed markers, open-bet nodes and the diff insertion underline.
- **Ember Light** (#fa8851): primary hover; the peak color of the simmer pulse; reconnect text on the rail.
- **Ember Deep** (#ce4d27): primary pressed state (with cream text); text selection inside the rail.
- **Ember Wash** (#fbe6dc) and **Ember Wash Strong** (#f8d4c3): the 3px input focus halo and the fresh-row flash; page text selection and diff insertions.

### Neutral
- **Rail Charcoal** (#242423): the rail background; also the ink color and the primary button's text.
- **Cream Ink** (#f7f2e6): rail text for current and hovered items and the wordmark.
- **Rail Muted** (#b3ada0) / **Rail Dim** (#8c877c): resting rail items and headings / disabled items and counts. **Rail Quiet** (#5d5a53): a venture's pixel marker when it has had no activity in the last day.
- **Rail Hover** (#2f2f2d) / **Rail Active** (#3a3935): rail hover fill / current-page fill and the rail divider.
- **Ground** (#fbf9f4): the work area canvas.
- **Sunk Ground** (#f5f1e8): the activity aside, versions list, row hover, reveal panels (reason, settle), tags.
- **Raised** (#fffefb): field and secondary-button fills, the checked segment.
- **Ink 2** (#57544d) / **Ink 3** (#6e6a62): secondary text / labels, metadata, placeholders, quiet markers.
- **Line** (#e9e4d8) / **Line Strong** (#d8d0bf): row hairlines / control borders, the spine line, scrollbar thumb.

### Semantic
- **Error Rust** (#a93b19): error text and invalid field borders. Darker than ember deep so errors never read as an action.
- **Won Green** (#3d7a4c): the node and pill pixel of a won bet. The only non-brand hue.

### Named Rules
**The One Ember Rule.** Ember marks the primary action, the current selection, or live state. Nothing else. One ember button per view section; never on headings, icons, links or decoration.

**The Quiet Default Rule.** Resting UI is neutral. Ember appears on a pixel only when it means "active now" or "just changed"; otherwise the pixel is Line Strong, Ink 3 or the quiet rail grey.

## Typography

**UI Font:** system UI sans (-apple-system, BlinkMacSystemFont, Segoe UI, system-ui)
**Data Font:** ui-monospace (SF Mono, Menlo, DejaVu Sans Mono)

**Character:** the native sans keeps the console fast and familiar at small sizes; the monospace echoes the braise.exe wordmark but only where text is a value, never a voice. There is no display face: the largest type is the 20px venture title.

### Hierarchy
- **Headline** (600, 20px, -0.02em): venture title in the cockpit, first-run heading. One per page.
- **Title** (600, 14px, -0.01em): top bar page title, section heads (Strategy, Bets). Bet titles use 14px at 500.
- **Body** (400, 13px, 1.5): all running text, kernel values, rail items, buttons (500), table cells. Long prose capped at 75ch.
- **Label** (600, 12px): field labels and rail headings; at 400 for metadata, hints, feed meta and status pills.
- **Caption** (500, 11px): tags, rail counts, keyboard hints.
- **Data** (400, 12px mono, tabular, -0.01em): versions (v2), slugs (/v/quiet-ledger), seq numbers (#41), dates (Dec 15, 2026), slug inputs and version selects.

### Named Rules
**The Data-Only Mono Rule.** Monospace is for machine values: seq, slugs, dates, versions. Never for headings, labels, buttons or prose. If a human wrote it, it is sans.

**The Tabular Numbers Rule.** Numeric table columns are right-aligned with tabular numerals.

## Layout

A two-column app shell: a 232px rail and a fluid work area. The work area carries a 52px sticky top bar (ground at 92% with an 8px backdrop blur and a bottom hairline) holding breadcrumbs and page actions. Pages pad 32px.

- **Cockpit:** main column plus a 300px activity aside (240px below 1280px, where main padding drops to 24px). Main padding 24px top, 32px sides, 48px bottom; 32px between blocks.
- **History:** 260px versions list beside a diff page capped at 960px.
- **First run:** a single 560px column, centered, 48px top.
- **Definition grids:** 128px label column for the kernel and diff fields; 96px for bet fields.
- **Spacing scale:** 4 / 8 / 12 / 16 / 24 / 32 / 48. Rows are 28px (rail, controls), 32px (inputs, table headers), 36px (goal rows) and 40px (table rows).

No mobile layout exists; `body` holds a 1024px minimum width.

## Elevation & Depth

Flat. Depth comes from tone, not shadow: the charcoal rail, the cream ground, the sunk aside and lists, and raised fields. Separation is a 1px hairline.

### Shadow Vocabulary
- **Focus ring** (`box-shadow: 0 0 0 2px var(--ground), 0 0 0 4px var(--ember)`): every keyboard focus.
- **Field focus halo** (`box-shadow: 0 0 0 3px var(--ember-wash)`): inputs, textareas, selects, slug field.
- **Node gap** (`box-shadow: 0 0 0 3px var(--ground)`): cuts the spine line around each node.
- **Checked segment** (`box-shadow: 0 1px 2px rgb(36 36 35 / 0.1), 0 0 0 1px var(--line)`): the only lift in the system.

### Named Rules
**The No Cards Rule.** Content never sits in shadowed, bordered tiles. Group with hairline rules, definition grids and sunk-ground regions. The single bordered box is the transient add-bet form (10px radius) while it is open.

## Shapes

Small, uniform corners: 6px on every control, rail item and reveal panel; 4px on tags, status pills and the editable hover; 8px on the segmented control track; 2px on diff insertions. Status markers are hard squares with no radius: 6px pixels, 7px spine nodes, 5px goal nodes. Hollow markers use a 1.5px inset stroke. Icons are Lucide strokes at 14-16px (1.75 stroke, 2 in buttons).

## Components

### Buttons
Compact and quiet; ember earns attention by being rare.
- **Shape:** gently rounded (6px), 28px tall, 12px side padding, 14px icon with 6px gap, 500 weight.
- **Primary:** ember fill and border, charcoal text at 600. Hover goes ember light; pressed goes ember deep with cream text.
- **Secondary:** raised fill, Line Strong border, ink text; hover fills sunk ground.
- **Ghost:** transparent, Ink 2 text; hover fills sunk ground and goes ink.
- **Icon button:** 26px square, transparent, Ink 3 icon at 15px; hover fills sunk ground.
- **Disabled:** 55% opacity, default cursor. Transitions are 120ms on background and border.

### Tags and Status Pills
- **Tag:** 20px tall, sunk fill, Ink 2 caption text, 4px radius. Used for venture kind, bet status and "active" version.
- **Status pill:** 22px, raised fill, Line border, 4px radius, a leading pixel and a chevron; the native select inside is unstyled. Pixel is ember for open, Won Green for won, hollow Ink 3 for settled. Hover strengthens the border; focus puts the focus ring on the pill.

### Inputs / Fields
- **Style:** raised fill, Line Strong border, 6px radius, 32px min height, 6px 10px padding; textareas size to content from 64px.
- **Focus:** border turns ember with a 3px ember-wash halo.
- **Error:** border turns Error Rust; message below in 12px Error Rust.
- **Field:** 12px/600 Ink 2 label, 6px gap, optional 12px Ink 3 hint.
- **Segmented control:** sunk track with Line border and 8px radius; checked segment is raised with the checked-segment shadow.
- **Edit in place:** text renders as a button that shows a sunk fill on hover and turns into a compact field (28px) when editing. Empty values show their prompt in Ink 3.

### Navigation (the rail)
- Charcoal, 232px, wordmark at 150px. Items 28px, 6px radius, 16px icons, Rail Muted text.
- **Hover:** Rail Hover fill, cream text. **Current page:** Rail Active fill, cream text. **Current scope** (the venture or Holding in view): cream text at 500, no fill. **Disabled placeholders:** Rail Dim, no hover.
- Ventures list each with a pixel: ember when active in the last day, quiet grey otherwise; it simmers when a live change lands.
- **Reconnect foot:** shown only while the live stream is down: ember-light text with a blinking ember pixel.

### The Spine (signature)
A 1px Line Strong vertical line runs down the left of the cockpit, 28px gutter, joining the strategy, every bet and the detached "Not tied to a bet" group.
- **Nodes:** 7px squares cut from the line by a 3px ground gap. Charcoal for strategy, ember for open bets, Won Green for won, hollow Ink 3 for settled bets and the loose group.
- **Bets:** rows separated by hairlines; 14px/500 title, a 96px-label definition grid (action, kill criteria) in Ink 2, row actions revealed on hover or focus.
- **Goals:** a five-column grid (marker, outcome, signal, horizon in mono, actions) with 5px hollow markers, 36px rows and sunk hover.
- **Fresh:** a node arriving from elsewhere simmers (scales up from below in ember light and settles over 1.8s) while its row flashes ember wash.

### Table (Holding)
- Full width, hairline rows 40px tall, 12px cell padding. Sticky headers sit under the top bar: 32px, 12px/500 Ink 3, sortable buttons that turn ink when hovered or sorted.
- Numeric columns right-aligned and tabular. Whole rows are clickable with a 100ms sunk hover. Flagged rows show an ember pixel beside ink 600 text.

### Activity Feed
- A 6px pixel column beside the text, 8px row padding. Pixels are Line Strong, ember when fresh.
- Text in Ink 2 with actors and objects in ink 500; meta and detail in 12px Ink 3; seq in mono.
- A revision reason hangs under the item on a 1px Line Strong left rule.
- **Full page:** rows divided by hairlines with a right-aligned timestamp column.

### Diff (History)
- Fields as a 128px-label grid, values capped at 75ch at 1.6 line height. Unchanged fields go Ink 3.
- **Insertion:** ember-wash-strong fill with a 1.5px ember underline, 2px radius.
- **Deletion:** Ink 3 text with a 1.5px Ink 2 strike.
- The revision reason sits between hairlines above the fields. The versions list marks the current and active version with an ember pixel and selects with a Line fill.

### States
- **Loading:** 12px shimmer bars (Line to sunk ground, 1.4s linear) in 12px-gap stacks.
- **Empty:** a single line of Ink 3 text in place, no illustration.
- **Reveal panels:** reason and settle rows open in sunk ground with a 220ms rise (4px, ember-out easing).
- **Reduced motion:** simmer, flash, reveal, shimmer and blink are removed; the strategy collapse chevron stops rotating.

## Do's and Don'ts

### Do:
- **Do** keep ember (#ec693a) to the primary action, the current selection and live state; one primary button per section.
- **Do** mark every status and activity with a square pixel (5-7px), filled or hollow (1.5px inset), never a dot or icon.
- **Do** separate content with 1px hairlines (#e9e4d8) and sunk ground (#f5f1e8) instead of containers.
- **Do** set seq numbers, slugs, dates and versions in monospace at 12px with tabular numerals, and nothing else.
- **Do** hang new strategy-derived content off the spine: kernel, bets, goals, top-down on one line.
- **Do** show liveness with the 1.8s simmer on what changed, and the reconnect pixel only while the stream is down.
- **Do** honor reduced motion by removing every animation listed under States.

### Don't:
- **Don't** wrap content in cards, tiles or kanban columns; the only bordered box is the transient add-bet form.
- **Don't** use ember for headings, links, icons, borders at rest or decoration.
- **Don't** use monospace for prose, labels or headings; no terminal cosplay or kitchen kitsch.
- **Don't** add shadows for elevation; the focus ring, field halo, node gap and checked segment are the whole vocabulary.
- **Don't** add round status dots; markers are square.
- **Don't** go above 20px type or add a display face.
