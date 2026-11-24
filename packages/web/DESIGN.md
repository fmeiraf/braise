---
name: braise
description: The owner's holding console, where every venture is a living cross-section of its strategy.
colors:
  pith: "#131a16"
  pith-2: "#1d2721"
  rail-hover: "#1b241f"
  rail-line: "#26302a"
  rail-muted: "#a9b5ad"
  rail-dim: "#7d8a81"
  rail-quiet: "#4d5a52"
  sage: "#e8ede5"
  ground: "#f4f5f1"
  ground-sunk: "#eceee8"
  paper: "#ffffff"
  ink: "#151b18"
  ink-2: "#47504b"
  ink-3: "#5f6963"
  line: "#e2e5de"
  line-strong: "#cdd2c9"
  resin: "#f0a63a"
  resin-light: "#f6c071"
  resin-deep: "#b8720f"
  resin-wash: "#fdf1dd"
  resin-wash-strong: "#fadfb4"
  on-resin: "#1b1306"
  moss: "#4f7a45"
  bark: "#b23a24"
  ring-1: "#7c6cf0"
  ring-2: "#e0566b"
  ring-3: "#2fa58a"
  ring-4: "#3b8fe0"
  ring-5: "#b35cc9"
  ring-6: "#6e9b2f"
  ring-7: "#4f5bd5"
  ring-8: "#d14d9b"
typography:
  display:
    fontFamily: "Bricolage Grotesque Variable, Geist Variable, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 640
    lineHeight: 1.1
    letterSpacing: "-0.03em"
    fontVariation: "\"opsz\" 48"
  headline:
    fontFamily: "Bricolage Grotesque Variable, Geist Variable, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 640
    lineHeight: 1.15
    letterSpacing: "-0.03em"
    fontVariation: "\"opsz\" 48"
  wordmark:
    fontFamily: "Bricolage Grotesque Variable, Geist Variable, system-ui, sans-serif"
    fontSize: "21px"
    fontWeight: 640
    lineHeight: 1
    letterSpacing: "-0.03em"
    fontVariation: "\"opsz\" 48"
  venture-name:
    fontFamily: "Bricolage Grotesque Variable, Geist Variable, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 640
    lineHeight: 1.2
    letterSpacing: "-0.02em"
    fontVariation: "\"opsz\" 48"
  title:
    fontFamily: "Geist Variable, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Geist Variable, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist Variable, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.5
  caption:
    fontFamily: "Geist Variable, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.5
  data:
    fontFamily: "Geist Mono Variable, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    letterSpacing: "-0.01em"
    fontFeature: "\"tnum\""
rounded:
  tick: "2px"
  sm: "4px"
  tag: "10px"
  control: "8px"
  panel: "14px"
  round: "50%"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
  "7": "48px"
components:
  button:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "30px"
  button-hover:
    backgroundColor: "{colors.ground-sunk}"
  button-primary:
    backgroundColor: "{colors.resin}"
    textColor: "{colors.on-resin}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "30px"
  button-primary-hover:
    backgroundColor: "{colors.resin-light}"
  button-primary-active:
    backgroundColor: "{colors.resin-deep}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.control}"
    height: "30px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
    height: "32px"
  tag:
    backgroundColor: "{colors.ground-sunk}"
    textColor: "{colors.ink-2}"
    typography: "{typography.caption}"
    rounded: "{rounded.tag}"
    padding: "0 7px"
    height: "20px"
  status-pill:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "22px"
  rail:
    backgroundColor: "{colors.pith}"
    textColor: "{colors.sage}"
    width: "232px"
  rail-item:
    textColor: "{colors.rail-muted}"
    rounded: "{rounded.control}"
    padding: "0 8px"
    height: "28px"
  rail-item-active:
    backgroundColor: "{colors.pith-2}"
    textColor: "{colors.sage}"
  cross-section:
    rounded: "{rounded.panel}"
    padding: "12px 16px 12px 12px"
    width: "300px"
  cross-section-hover:
    backgroundColor: "{colors.paper}"
  progress:
    backgroundColor: "{colors.line}"
    rounded: "{rounded.tick}"
    width: "40px"
    height: "3px"
---

# Design System: braise

## Overview

**Creative North Star: "The Growth Rings"**

Every venture is a living cross-section. Each strategy revision lays down a ring, and agents at work grow the outer ring while you watch. The console is a calm instrument for one owner: a dark pith rail on the left that holds the identity and the venture list, and a pale sage-white work area where strategy, bets and goals read as plain, dense, hairline-ruled text. Colour is earned. Resin amber means "act here" or "something is alive right now"; each venture's own ring hue identifies it everywhere it appears; everything else is sage, ink and line.

Density is desktop-console dense (13px body, 28px rail rows, 30px buttons, 40px table rows) with generous section gaps (32px) so the hierarchy comes from weight, ink and space rather than boxes. Bricolage Grotesque carries the identity at the few places a name is spoken (wordmark, page and venture titles); Geist does all the work; Geist Mono appears only where the content is data.

The world replaces the charcoal-and-cream terminal kit it grew out of and refuses the flat grey productivity-app clone: no square pixel markers, no all-system type, no grey-on-grey with a single blue accent.

**Key Characteristics:**
- Pith green-black rail against a cool sage-white ground, white raised surfaces.
- Resin amber reserved for the primary action and live state.
- One full-strength ring hue per venture, carried by `--ring` on every venture-scoped surface.
- Growth-ring geometry (off-centre pith, concentric rings) as the signature, in the mark, the venture glyph and the core sample.
- Motion is ring motion: outer rings draw, glyph rings turn, nodes pulse a ring outward. All of it stops under reduced motion.
- Hairline rules and tonal sinks instead of shadows and cards.

## Colors

A cool, green-tinted neutral world with one warm signal colour and eight venture hues.

### Primary
- **Resin Amber** (`resin`): the primary button, the mark's pith and outer ring, the core sample's growth ring, live status dots, focus rings and the text caret. Hover lifts to **Light Resin** (`resin-light`); press sinks to **Deep Resin** (`resin-deep`), which also colours the "Claude is working" meta text on the ground. **Resin Wash** (`resin-wash`, `resin-wash-strong`) is the input focus halo, the fresh-row flash and text selection.
- **On-Resin** (`on-resin`): the near-black brown used for text on any resin fill. Never put white on resin.

### Secondary
- **Venture Rings** (`ring-1` to `ring-8`: violet, rose, teal, blue, orchid, leaf, indigo, magenta): each venture is hashed from its id to one hue and keeps it everywhere. A venture-scoped container sets `--ring` to its hue; inside it, the venture glyph, core sample rings, bet nodes, goal nodes, status-pill dots and progress fills all read `--ring`. Ring hues identify; they never signal state.

### Tertiary
- **Moss** (`moss`): done. Won bets' nodes and status dots.
- **Bark** (`bark`): error. Invalid field borders and error text.

### Neutral
- **Pith** (`pith`): the rail's ground and the darkest surface in the system. **Pith Raised** (`pith-2`) is the active rail row; `rail-hover` the hover row; `rail-line` the rail divider.
- **Sage Ink** (`sage`): primary text on the rail and the wordmark. `rail-muted` for resting rail rows and headings, `rail-dim` for counts and disabled rows, `rail-quiet` for dormant markers.
- **Sage-White Ground** (`ground`): the page ground. **Sunk Ground** (`ground-sunk`) is the right-hand aside, hover rows, tags and inline reason rows.
- **Paper** (`paper`): raised controls and the hover state of cross-section tiles.
- **Ink** (`ink`, `ink-2`, `ink-3`): primary text, secondary text, and meta or label text.
- **Line** (`line`, `line-strong`): hairline rules between rows and sections; the stronger line for control borders, the trunk spine and ghost rings.

### Named Rules
**The Resin Is Alive Rule.** Resin appears only on the single primary action in view and on things that are live this second (a running agent, a growing ring, the focus ring). A static decoration in resin is a bug.

**The One Hue Per Venture Rule.** A venture's ring hue comes from `ringColor(id)` and nothing else. Never pick a ring hue by hand, never use one for status, never put two ventures' hues on one venture-scoped surface.

## Typography

**Display Font:** Bricolage Grotesque Variable (falls back to Geist)
**Body Font:** Geist Variable (with -apple-system, Segoe UI, system-ui)
**Label/Mono Font:** Geist Mono Variable (with ui-monospace, SF Mono, Menlo)

**Character:** a characterful, slightly wonky grotesque at optical size 48 for names, set tight and heavy (640), against a neutral, precise UI grotesque. One grotesque does the work at three sizes; rank comes from weight and ink, not from size jumps.

### Hierarchy
- **Display** (640, 30px, 1.1, -0.03em, opsz 48): the venture title beside its core sample.
- **Headline** (640, 24px, 1.15, -0.03em, opsz 48): page titles (work, first run).
- **Wordmark** (640, 21px, 1, -0.03em, opsz 48): "braise" in the rail beside the mark.
- **Venture Name** (640, 18px, 1.2, -0.02em, opsz 48): venture names on holding cross-section tiles.
- **Title** (600, 14px, -0.01em, Geist): section heads, topbar titles, strategy head.
- **Body** (400, 13px, 1.5): everything else. Kernel definitions run at 1.55 and preserve line breaks.
- **Label** (600, 12px): field labels and rail headings, in sentence case.
- **Caption** (500, 11px): tags, counts, timestamps, keyboard hints.
- **Data** (400, 12px Geist Mono, tabular numerals, -0.01em): ids, durations, costs, run metadata.

### Named Rules
**The Names Only Rule.** Bricolage is for names: the wordmark, page titles and venture titles. Section heads, buttons, labels and body stay in Geist.

**The Data Is Mono Rule.** Geist Mono marks content that is data (ids, numbers, durations). It is never used for labels, headings or decoration. Plain numbers in prose use Geist with tabular numerals.

## Layout

A fixed two-column shell: a 232px pith rail and a fluid main column. The main column carries a sticky 52px topbar (ground at 92% with an 8px backdrop blur and a hairline bottom rule) holding the breadcrumb and right-aligned actions. Pages pad 32px. The venture cockpit splits into a fluid main column and a 300px sunk aside (240px below 1280px), separated by a hairline. The body has a 1024px minimum width; this is a desktop console.

Spacing runs on a 4px base (4, 8, 12, 16, 24, 32, 48). Sections inside the cockpit stack at 32px; rows within a section are separated by hairlines, not gaps. Bets hang off a vertical trunk: a 1px `line-strong` spine 9px in from a 28px left gutter, with each bet's node sitting on it. The strategy kernel is a two-column definition list (128px terms).

## Elevation & Depth

Flat. Depth comes from tone and hairlines: the pith rail is the darkest plane, the sage-white ground is the page, the sunk ground recedes (aside, hover, tags), and white paper comes forward (controls, hovered tiles). There are no card shadows. The only shadows are functional: the 2px ground plus 2px resin focus ring, the 3px resin-wash halo on a focused input, a 1px warm drop under the primary button, the ground-coloured gap ring around trunk nodes, and inset 1.5px strokes that draw hollow markers.

### Shadow Vocabulary
- **Focus ring** (`0 0 0 2px ground, 0 0 0 4px resin`): every `:focus-visible` element.
- **Input halo** (`0 0 0 3px resin-wash`): focused inputs and the composer.
- **Primary lift** (`0 1px 2px rgb(120 70 0 / 0.25)`): the resin button only.
- **Node gap ring** (`0 0 0 3px ground, 0 0 0 4px ring`): a bet node sits on the trunk with a ground-coloured gap, then a ring in the venture hue.
- **Hollow stroke** (`inset 0 0 0 1.5px currentColor`): settled, loose and pending markers.

### Named Rules
**The Hairline Not Card Rule.** Group with a 1px `line` rule or a tonal sink. Do not wrap sections in bordered, shadowed cards.

## Shapes

Gently rounded controls (8px) and softer panels (14px, the holding cross-section tiles). Small inline chips like status pills, version links and inline code use 4px; tags are fully pill-shaped at 20px height (10px radius); progress bars are 3px tall with 2px ends. Every marker is round: venture glyphs, trunk nodes, goal nodes, status dots and the mark itself are circles. Ring geometry is always off-centre: the pith sits low-left and each successive ring shifts its centre up and right, so the rings read as grown rather than drawn with a compass.

## Components

### Buttons
Quiet by default, warm when it matters.
- **Shape:** gently rounded (8px), 30px tall, 12px side padding, 14px icons at stroke 2.
- **Default:** paper fill, `line-strong` 1px border, ink text at 500. Hover sinks to `ground-sunk`.
- **Primary:** resin fill and border, on-resin text at 600, a 1px warm drop. Hover lightens to `resin-light`, press deepens to `resin-deep`. One per view.
- **Ghost:** transparent, `ink-2` text; hover sinks to `ground-sunk` and darkens to ink.
- **Icon button:** 26px square, transparent, `ink-3` glyph at stroke 1.75.
- **Disabled:** 55% opacity.

### Chips
- **Tag:** sunk ground, `ink-2` caption text, pill radius, 20px tall.
- **Status pill:** paper, `line` border, 4px radius, 22px tall, with a round 6px dot in `--ring` (active), moss (won) or a hollow `ink-3` ring (settled). The pill wraps a native select.

### Cards / Containers
- **Cross-section tile** (holding): 300px wide, 14px radius, transparent at rest with a 76px core sample beside the Bricolage venture name and a muted meta line; hover raises it to paper.
- **Aside:** sunk ground with a hairline left border, no radius.
- **Reason row:** sunk ground, 8px radius, 12px padding, revealed with a 4px slide.

### Inputs / Fields
- **Style:** paper fill, `line-strong` border, 8px radius, 32px minimum, 6px 10px padding. Labels sit above in 12px/600 `ink-2`, hints below in 12px `ink-3`.
- **Focus:** border turns resin with a 3px resin-wash halo. The caret is resin everywhere.
- **Error:** border turns bark; error text in 12px bark.

### Navigation
- **Rail:** pith ground, 16px top padding. Brand row: the 30px growth-ring mark and the Bricolage wordmark. Rows are 28px, 8px radius, `rail-muted` text; hover lifts to `rail-hover` and sage, the current page sits on `pith-2`. Counts are right-aligned captions in `rail-dim`. Ventures list with their 18px ring glyphs; dormant ventures' glyphs drop to 45% opacity.
- **Topbar:** sticky, translucent ground with blur; breadcrumb crumbs in `ink-3` hover to ink, the current crumb at 500.

### Growth-Ring Mark (signature)
Three stacked circles drawn off-centre in sage around a resin pith, closed by a resin outer arc (322 degrees, round caps, stroke 4). When any run is live, the outer arc redraws itself over 5s on the out-expo ease, on loop.

### Venture Ring Glyph (signature)
An 18px glyph in the venture's hue: a filled pith, an inner ring once the strategy reaches version 2, and an outer ring. While an agent works on the venture, the outer ring turns dashed (3 / 2.2) and rotates once every 9s.

### Core Sample (signature)
A venture's strategy history as a cross-section: an off-centre pith in the venture hue with one ring per strategy version (up to eight). At least three rings are always drawn; rings the strategy has not reached are faint ghosts in the venture hue at 16% opacity. Reached rings fade in from 40% opacity at the core to full at the bark. While an agent works, a resin growth ring draws around the whole sample on the same 5s grow loop as the mark. 92px in the cockpit header, 76px on holding tiles.

### Trunk and Nodes
Bets hang on a hairline trunk. Each bet's node is a 9px circle in `--ring` separated from the trunk by a ground-coloured gap ring; won bets turn moss, settled and loose ones go hollow. Goal nodes are 6px. A freshly arrived bet or goal simmers: its node throws a ring of its hue outward (10px at 35%, settling over 1.8s) while its row flashes resin-wash and fades.

### Progress
A 40px by 3px bar on a `line` track, filled in `--ring`, easing width changes over 600ms.

## Do's and Don'ts

### Do:
- **Do** set `--ring` to `ringColor(venture.id)` on every venture-scoped container and let glyphs, nodes, dots and progress read it.
- **Do** keep resin to the one primary action in view and to live state; pair resin fills with on-resin text.
- **Do** draw every marker round, and draw rings off-centre (pith low-left, rings shifting up-right).
- **Do** express liveness as ring motion: the mark's outer arc grows, venture glyph rings turn, the core sample's resin ring grows, fresh nodes pulse a ring.
- **Do** list every animated selector in the `prefers-reduced-motion` block; under reduce, live rings rest fully drawn and simmer pulses do not play.
- **Do** group with hairline rules and tonal sinks; keep the work area flat.

### Don't:
- **Don't** use square pixel markers, charcoal-and-cream surfaces or an all-system type stack; that is the replaced world.
- **Don't** set Bricolage on section heads, buttons, labels or body copy, and don't use Geist Mono for anything that is not data.
- **Don't** use a venture ring hue to signal status, or resin as decoration.
- **Don't** wrap sections in shadowed cards; the only shadows are focus, halo, the primary lift and node gap rings.
- **Don't** pick ring hues by hand; they come from the venture id.
