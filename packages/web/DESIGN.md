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
  work-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "0 8px 0 0"
    height: "34px"
  work-row-hover:
    backgroundColor: "{colors.ground-sunk}"
  work-row-selected:
    backgroundColor: "{colors.line}"
  button-small:
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "24px"
  thread-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "9px 8px 10px"
  thread-row-hover:
    backgroundColor: "{colors.ground-sunk}"
  thread-row-selected:
    backgroundColor: "{colors.line}"
  link-tag:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 2px 0 8px"
    height: "24px"
  link-option:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "30px"
  link-option-active:
    backgroundColor: "{colors.ember-wash}"
  composer:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "6px 6px 6px 12px"
---

# Design System: braise

## Overview

**Creative North Star: "The Holding Console"**

A working console for one expert owner steering several ventures. A committed charcoal rail (Slack's posture) sits beside a Linear-precise work area on a barely-cream ground. Everything reads top-down along one connected line, the spine: strategy kernel, then bets, then the goals testing them. Density is high and quiet: 13px system UI, hairline rules, 28px controls, no decoration that does not carry state.

The brand's simmering-terminal logo supplies exactly two devices and no more: the pixel-square bubble, which becomes every status and activity marker, and the ember orange, which is reserved for the one thing that matters on a screen. The app must never read as terminal cosplay or kitchen kitsch; monospace appears only where the content is literally data.

Liveness is shown, never claimed. Changes that arrive from elsewhere make the touched node and its rail square simmer once (an ember pulse that settles), and a blinking pixel appears in the rail foot only while the live stream is down.

Agent work is shown the same way. While Claude is running, its pixel pulses (the working pulse) in the rail, the thread list and the conversation, and its tool calls fold into quiet one-line rounds; when the run ends, everything settles back to neutral.

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
- **Work:** a main column capped at 1104px (cockpit padding, 32px between goal sections). Selecting an item opens a 360px detail pane at the right (320px below 1280px, where the keyboard hint in the title row is hidden). The pane is sticky under the top bar, full height, sunk ground with a left hairline, 16px padding. It reads top-down: kind tag and an Ink 3 "in <parent>" path with a close button; the 14px/600 title, editable in place; a 76px-label field grid (status as a compact segmented control with 24px segments carrying their markers, function and priority selects at 28px, goal for initiatives only, order as "n of m" with up/down icon buttons); the description below a hairline; and a foot pinned to the bottom with the added/edited line and a secondary Archive button that opens an inline confirm (ground fill on the sunk pane, no border) naming the item count.
- **Holding work:** the same page across ventures, each venture a 14px/600 section with its item count, divided by hairlines.
- **Threads:** a 320px thread list (280px below 1280px, 8px padding) with a right hairline beside a fluid conversation pane. The view fills the viewport under the 52px top bar and never scrolls as a page: the list and the conversation each scroll on their own, and the composer stays pinned at the bottom of the conversation. The conversation head pads 16px top, 32px sides, 12px bottom above a hairline; the scroll area pads 24px top, 32px sides. The timeline is capped at 760px with 24px between messages; message prose is capped at 72ch. The composer aligns to the timeline's measure.
- **Definition grids:** 128px label column for the kernel and diff fields; 96px for bet fields; 76px for the work pane.
- **Spacing scale:** 4 / 8 / 12 / 16 / 24 / 32 / 48. Rows are 28px (rail, controls), 32px (inputs, table headers, work goal heads), 34px (work rows), 36px (goal rows) and 40px (table rows).

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

Small, uniform corners: 6px on every control, rail item and reveal panel; 4px on tags, status pills and the editable hover; 8px on the segmented control track; 2px on diff insertions. Status markers are hard squares with no radius: 6px pixels, 7px spine nodes and work markers, 5px goal nodes. Hollow markers use a 1.5px inset stroke. Icons are Lucide strokes at 14-16px (1.75 stroke, 2 in buttons).

Threads follow the same geometry: 7px square author marks and streaming caret, 6px square tool and thread markers, 6px corners on thread rows, link chips, the composer and the link popover, and 4px corners on popover options, tool rows and inline code.

## Components

### Buttons
Compact and quiet; ember earns attention by being rare.
- **Shape:** gently rounded (6px), 28px tall, 12px side padding, 14px icon with 6px gap, 500 weight.
- **Primary:** ember fill and border, charcoal text at 600. Hover goes ember light; pressed goes ember deep with cream text.
- **Secondary:** raised fill, Line Strong border, ink text; hover fills sunk ground.
- **Ghost:** transparent, Ink 2 text; hover fills sunk ground and goes ink.
- **Icon button:** 26px square, transparent, Ink 3 icon at 15px; hover fills sunk ground.
- **Small:** any variant at 24px tall, 8px side padding, 12px text, 13px icon with a 4px gap. Used for in-context actions inside dense regions: Link, New thread, Retry.
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
- **Live runs slot:** while any agent run is active, the slot reads "n running" in cream with a pulsing ember pixel and links to the oldest running thread. It is never styled as the current page. With no runs it is a disabled "No runs" placeholder.
- **Threads** sits in the scope section between Work and Activity.

### The Spine (signature)
A 1px Line Strong vertical line runs down the left of the cockpit, 28px gutter, joining the strategy, every bet and the detached "Not tied to a bet" group.
- **Nodes:** 7px squares cut from the line by a 3px ground gap. Charcoal for strategy, ember for open bets, Won Green for won, hollow Ink 3 for settled bets and the loose group.
- **Bets:** rows separated by hairlines; 14px/500 title, a 96px-label definition grid (action, kill criteria) in Ink 2, row actions revealed on hover or focus.
- **Goals:** a six-column grid (marker, outcome, signal, horizon in mono, work, actions) with 5px hollow markers, 36px rows and sunk hover. The 76px work column is a right-aligned 12px Ink 3 "n/m done" link to the goal's section on the Work page (Line fill on hover); empty when the goal has no work.
- **Fresh:** a node arriving from elsewhere simmers (scales up from below in ember light and settles over 1.8s) while its row flashes ember wash.

### Work Tree
Linear-like rows under one section per goal (goals tied to bets first, then loose ones). No cards, no columns.
- **Goal head:** 32px, a hairline below. A 5px goal node (filled Ink 3; hollow when the goal is not tied to a bet), the outcome at 13px/600, the horizon in mono Ink 3, then right-aligned "n/m done" in 12px Ink 3 tabular and an add-initiative icon button. Arriving via a link flashes the outcome in ember wash (1.8s).
- **Rows:** 34px min, a hairline below, 6px gaps, 100ms sunk hover. Indent 22px per depth (initiative, task, subtask). From the left: a 16px disclosure chevron (13px Lucide, Ink 3, rotates 90deg open over 120ms; an empty slot on leaves), a 20px status button holding the marker, the title, then fixed meta slots.
- **Status markers:** 7px squares. To do is hollow (1.5px inset Ink 3), doing is ember fill, done is Ink 3 fill. Clicking the button cycles to do, doing, done; its hover fills Line Strong. The same markers lead the pane's status segments.
- **Titles:** 13px, ellipsized on one line; initiatives at 500. Done rows turn the title Ink 3.
- **Meta slots:** a 40px right-aligned tabular "n/m" of descendants done (empty on leaves); a 96px right-aligned slot for the function tag, shown on roots and only on children whose function differs from the parent; a 15px priority slot with Lucide signal-low, signal-medium, signal-high in Ink 3 and octagon-alert in ink for urgent; a 22px add-child icon button revealed on hover or focus.
- **Selected:** Line fill. **Keyboard focus:** a 1px inset ember ring with square corners, replacing the global focus ring. Arrows select and fold, Enter renames in place, Alt+arrows reorder.
- **Empty goal:** one line, 22px in, Ink 3 "No work yet." followed by an underlined Ink 2 "Add the first initiative".
- **Add:** an "Add initiative" add-row under the tree; the inline add form replaces it as a hairline-ruled row (28px compact input, a 140px function select on roots, primary and ghost buttons) with a hollow marker leading, revealing over 200ms.

### Table (Holding)
- Full width, hairline rows 40px tall, 12px cell padding. Sticky headers sit under the top bar: 32px, 12px/500 Ink 3, sortable buttons that turn ink when hovered or sorted.
- Numeric columns right-aligned and tabular. Whole rows are clickable with a 100ms sunk hover. Flagged rows show an ember pixel beside ink 600 text.

### Activity Feed
- A 6px pixel column beside the text, 8px row padding. Pixels are Line Strong, ember when fresh.
- Text in Ink 2 with actors and objects in ink 500; meta and detail in 12px Ink 3; seq in mono.
- A revision reason hangs under the item on a 1px Line Strong left rule.
- **Full page:** rows divided by hairlines with a right-aligned timestamp column.
- **Actors:** the owner is named "You" and the agent "Claude". Agent rows use a hollow pixel (1.5px inset), so agent and owner events read apart at a glance; fresh still turns it ember.

### Thread List
Slack-like rows of conversations. No cards.
- **Row:** 6px radius, 9px 8px 10px padding, 1px gaps, 100ms sunk hover; Line fill when selected (link tags inside go raised); keyboard focus is a 1px inset ember ring, replacing the global focus ring.
- **Marker:** a 6px pixel, Line Strong at rest, ember with the working pulse while a run is live.
- **Top line:** the title at 500, ellipsized on one line, then the time in 11px Ink 3, which reads "working" while a run is live.
- **Snippet:** the last message as plain text (Markdown stripped), 12px Ink 3, one line.
- **Links line:** in Holding scope the venture name (11px Ink 2 500) leads; then the first link as a tag and an Ink 3 "+n" for the rest.

### Conversation
- **Head:** the 14px/600 title, editable in place, with the venture name in 12px Ink 3 beside it in Holding scope. Below it, the thread's link chips and a ghost small "Link" button ("Link to work" when there are none) that opens the link search popover below.
- **Link chip:** 24px, raised fill, Line border, 6px radius; the kind in 11px/500 Ink 3, then the label in ink (underlined in Line Strong on hover when it links). A 20px remove button appears on hover or focus. Archived targets strike through in Ink 3.
- **Link popover:** 380px, raised fill, Line Strong border, 6px radius, no shadow. A compact 28px search field, then options 30px tall in a 64px kind column (11px/500 Ink 3), label and an Ink 3 venture; the active option sits on ember wash.
- **Messages:** Slack-style rows, no bubbles. A head line of a 7px square author mark, the author at 600 and the time in 11px mono Ink 3; the body hangs 22px in. The owner's mark is filled ink, the agent's hollow ink (1.5px inset), ember with the working pulse while its run is live. Owner bodies are plain text, pre-wrapped.
- **Prose (agent bodies):** Markdown at 1.6 line height, 10px between blocks. Square Ink 3 list markers; headings at 13px/600; links underlined in Line Strong; emphasis in Ink 2; inline code in 12px mono on sunk ground (4px radius); code blocks on sunk ground; quotes on a 1px Line Strong left rule; tables 12px tabular with Ink 3 500 headers and Line hairlines.
- **Run footer:** 11px Ink 3 under each agent reply. A status word in Ink 2 600 for Stopped, Failed, Interrupted and Waiting to start; the model id in mono; duration and token count tabular; a small secondary Retry on the latest failed or interrupted run. Failure reasons sit on their own line in 12px Error Rust; interruption notes in 11px Ink 3.
- **Stream down:** a per-thread line above the composer, 12px ember deep text on a top hairline with the blinking ember pixel.

### Tool Activity
Agent tool use stays quiet and inspectable.
- **Rounds:** each run of consecutive tool calls folds into one collapsed toggle placed before the reply text it led to. The summary is 24px, 12px Ink 3, "n steps · n changes · n failed", with a 13px chevron that rotates 90deg open over 120ms; sunk hover. When the round changed something the summary goes Ink 2.
- **Rows:** expanded calls hang on a 1px Line Strong left rule, 26px rows at 12px Ink 2. Each leads with a 6px square marker: hollow Ink 3 for reads, Ink 2 fill for writes (the action text then in ink 500), ember with the working pulse while pending, Error Rust for failed (with a rust "failed" detail).
- **Detail:** each row opens to its input and output on sunk ground: 11px/500 Ink 3 labels over 11px mono blocks on raised fill (4px radius, 240px max height). Errors set in Error Rust.

### Composer
- **Field:** raised fill, Line Strong border, 6px radius, 6px 6px 6px 12px padding. On focus-within the border turns ember with the 3px ember-wash halo. The textarea sizes to its content from 28px up to 220px.
- **Action:** at the right, a primary Send, or a secondary Stop while a run is active.
- **Links:** chips for the message's links sit above the field, remove buttons always shown.
- **Mention popover:** typing @ opens the link popover above the field.
- **Hint:** an 11px Ink 3 line below; keys in 11px/500 Ink 2 sans ("Enter to send · Shift+Enter for a new line · @ to link"). Errors replace it.

### Work Pane Threads
A Threads section in the work pane under the description, separated by a hairline: a field label with a ghost small "New thread" at the right, then 28px rows (6px radius) of pixel, ellipsized 12px title and 11px time, with a Line fill on hover. The pixel and the "working" time follow the thread list row.

### Diff (History)
- Fields as a 128px-label grid, values capped at 75ch at 1.6 line height. Unchanged fields go Ink 3.
- **Insertion:** ember-wash-strong fill with a 1.5px ember underline, 2px radius.
- **Deletion:** Ink 3 text with a 1.5px Ink 2 strike.
- The revision reason sits between hairlines above the fields. The versions list marks the current and active version with an ember pixel and selects with a Line fill.

### States
- **Loading:** 12px shimmer bars (Line to sunk ground, 1.4s linear) in 12px-gap stacks.
- **Empty:** a single line of Ink 3 text in place, no illustration.
- **Reveal panels:** reason and settle rows open in sunk ground with a 220ms rise (4px, ember-out easing).
- **Reduced motion:** simmer, flash, reveal, shimmer and blink are removed; the strategy collapse chevron stops rotating. On the Work page the add-form reveal and the target-goal flash are removed and the fold chevron stops rotating.
- **Working pulse:** live state for agent runs. Opacity 1 to 0.35 at 50%, 1.6s ease-in-out, infinite, on live pixels (rail, thread list, work pane), live author marks, pending tool markers and the streaming caret. It runs only while a run is active.
- **Streaming:** an ember 7px pixel caret pulses at the end of text as it arrives. Before any text, a "Waiting to start…", "Thinking…" or "Working…" line in Ink 3 leads with a live pixel.
- **Reduced motion (threads):** the working pulse is removed from live pixels, live author marks, pending tool markers and the streaming caret; the per-thread stream-down pixel stops blinking; the tool chevron stops rotating.

## Do's and Don'ts

### Do:
- **Do** keep ember (#ec693a) to the primary action, the current selection and live state; one primary button per section.
- **Do** mark every status and activity with a square pixel (5-7px), filled or hollow (1.5px inset), never a dot or icon.
- **Do** separate content with 1px hairlines (#e9e4d8) and sunk ground (#f5f1e8) instead of containers.
- **Do** set seq numbers, slugs, dates and versions in monospace at 12px with tabular numerals, and nothing else.
- **Do** hang new strategy-derived content off the spine: kernel, bets, goals, top-down on one line.
- **Do** show liveness with the 1.8s simmer on what changed, and the reconnect pixel only while the stream is down.
- **Do** keep work markers neutral: ember fills a work marker only while the item is doing.
- **Do** honor reduced motion by removing every animation listed under States.
- **Do** show agent work live with the 1.6s working pulse, and only while a run is active; when it ends the thread pixel returns to Line Strong and the author mark to ink. Ember stays for the primary action, selection and live state.

### Don't:
- **Don't** wrap content in cards, tiles or kanban columns; the only bordered box is the transient add-bet form.
- **Don't** use ember for headings, links, icons, borders at rest or decoration.
- **Don't** use monospace for prose, labels or headings; no terminal cosplay or kitchen kitsch.
- **Don't** add shadows for elevation; the focus ring, field halo, node gap and checked segment are the whole vocabulary.
- **Don't** add round status dots; markers are square.
- **Don't** go above 20px type or add a display face.
