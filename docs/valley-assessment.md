# Assessment: the Valley mock in the real web UI

Status: assessment only, nothing implemented. First written 2026-11-27 against `main` at
`5f2e2fd` (slice 9), with the working tree as the owner left it (skill folder moves, untracked
`valley-mock.html` and `strategy-loop-report.html`; none of it touched). Revised the same day
after the owner answered the first round of open questions (section 1).

Subject: `valley-mock.html` at the repo root (untracked, one self-contained file, three.js r128
from cdnjs, fake data). Target: the web app in `packages/web`.

The original brief was "change only the Overview tab". The owner's answers widen that: **the
look changes app-wide**, while **features on every tab stay exactly as they are**. The
constraint that remains is "no feature regressions", not "no visual change outside Overview".

---

## 1. Owner decisions (2026-11-27)

| # | Question | Answer | What it means for the work |
|---|---|---|---|
| D1 | Holding Overview only, or the venture Overview too? | **Both.** The venture Overview keeps **the same content as now**, only in the new design. | `/` becomes the Valley. `/v/$slug` keeps the venture sheet, Integrations, At a glance, Needs you, recent activity, the Settings gear and the slice 9 draft states, restyled. Giving it a hero with the venture's own building is a design choice inside "new design" (Q-c). |
| D2 | Palette and icons app-wide or Overview-only? | **App-wide.** | The mock's tokens replace the v6 tokens in `:root`, and the app icon replaces `Crest` everywhere. Every tab changes visually, and all of them need a visual check. This replaces v6 as the design contract: a "v7" entry in the decisions log and a rewrite of `packages/web/DESIGN.md`. |
| D3 | How is a venture's building (and icon) chosen? | **From its slug.** | Same mechanism as `hueOf`: `hash(slug) % archetypes.length` and `hash(slug) % glyphs.length`. Nothing stored, no schema change, consistent with the 2026-11-25 decision. A glyph won't mean anything about the venture (the mock's cloud for Nimbus, kettle for Kettle were picked by hand). |
| D4 | "Shipped", "crashed", status precedence | **Remove those statuses.** | My reading: the venture-level **shipped** and **crashed** states go, along with "Shipped this week" and the "Shipped: …" lines. That leaves the states that exist today: **needs you**, **running**, **queued**, and the existing **quiet** for a venture with nothing going on. Thread and space tones (`ok`, `bad` in `[data-tone]`) are real and unaffected. **No API work is needed at all.** |
| D5 | Running colour | **Venture hue** | `live` stays `--acc`, pulsing, as DESIGN says now. The mock's `--run` blue goes. |
| D6 | Approving from the Overview | **Like today** | The Needs you rows link into the Inbox (`.quest` rows from `NeedsYou`). No inline Approve, Grant or Answer buttons, so no confetti or approval quips. Proposal review with its required reason stays in the Inbox. |
| D7 | three.js or something else | **"Whatever is fastest and low resource intensive."** | Decided here, section 4.3: **pre-rendered building sprites** placed on an isometric grid in the DOM, with no three.js and no WebGL at runtime. |

D4 also removes "Shipped" from the legend and the stats row. The second round of answers
(queued kept, full rail and dock, mock styling, copy, Ledger dropped) is in section 7.

## 2. Summary

- **The data is all there.** Once shipped and crashed are gone (D4), every element in the
  mock that carries information maps to data the Holding page already loads and keeps live
  over SSE: ventures, strategy version and why/what, open bets, the objective and its
  progress, work counts, who is working where, the inbox and agents. **No API, core or schema
  change.**
- **App-wide is a reskin, not a rewrite.** Swapping the `:root` tokens and replacing `Crest`
  with a slug-derived app icon changes every tab's look through the existing cascade. The
  risk is visual regressions (contrast, hue-on-hue text, diff colours, draft states), not
  broken features. Every screen has to be looked at.
- **The city doesn't need a 3D engine.** The scene sits at a fixed isometric angle, so the
  buildings can be pre-rendered once (from the mock's own three.js builders) into one image
  per archetype and hue. At runtime they are `<img>` elements on a grid, with HTML labels. That
  is the cheapest option at runtime, the fastest to build, and closest in fidelity to the
  reference. The obvious alternative, hand-drawn isometric SVG, risks the flat toy look the
  owner already rejected.
- **Rough effort:** phase 1 (tokens) about 1 day; phase 2 (app icon replaces Crest, rail and
  dock) about 1 day; phase 3 (Holding Valley, 2D hero and sheet) about 1–1.5 days; phase 4 (the
  city from sprites) about 2–3 days; phase 5 (venture Overview restyle) about 1 day. Section 6.

## 3. Element → data map

Legend: **A** = real data that exists today. **C** = decoration or copy. **Removed** = dropped
by D4 or D6. (No element is left in "B, needs new data".)

"Already loaded" means: `queries.ventures()` (`HoldingRow[]`), `queries.cockpit(slug)` per
venture (`Cockpit`), `useWorking()` (running runs with their agent), `queries.activeRuns()`,
`queries.inbox()`, `queries.agents()` and `queries.holdingWork()`. Every one is invalidated by
the SSE hints in `src/live.ts`, so anything derived from them stays live with no new work.

### 3.1 Per-venture state (labels, rail dot, card strip, legend)

One derived state per venture, with precedence **needs you > running > queued > quiet / active**:

| State | Class | Derivation | Tone |
|---|---|---|---|
| needs you | A | Some `inbox.pending` item whose `venture.id` matches | `needs` (beacon) |
| running | A | Some `useWorking()` run with this `ventureSlug` | `live` (venture hue, pulsing) |
| queued | A | Some `activeRuns` run with `status === "queued"` and this slug | `wait` (hollow) |
| quiet / active | A | Neither of the above; "Quiet for N" past a week, otherwise "Active N ago" (as today) | no dot |
| ~~shipped~~, ~~crashed~~ | Removed | D4 | — |

This is a pure function (`src/valley/state.ts`), unit-tested beside its subject.

### 3.2 Hero HUD

| Element | Class | Source |
|---|---|---|
| Kicker "THE HOLDING" | C | Static label. The mock's green dot means nothing under the colour rules; drop it, or make it the SSE connection state (Q-d). |
| "The Valley never sleeps." | C | Copy (Q-e). |
| "N ventures on shift." | A | Distinct `ventureSlug` among `useWorking()`. |
| "N things need your attention." | A | `inbox.pending.length` (global). |
| Legend | C | Needs you, Running, Queued only. |
| Building hover card: name, "strategy v6 · 7 bets live", quote, status line | A | `HoldingRow.name`, `strategyVersion`, `openBets`; `cockpit.strategy.why`; `workingLabel()` + `threadTitle`, or the venture's pending inbox count. |

### 3.3 The city

| Element | Class | Notes |
|---|---|---|
| A building per venture | C, chosen from the slug (D3) | Archetypes ported from the mock's builders (tower with ring, brick warehouse with sawtooth roof, courtyard with loop, glass drum with ring, timber with green glass), each pre-rendered in the six venture hues. |
| Lot placement | C (derived) | Deterministic: ventures in creation order fill lots spiralling out from the centre, so adding a venture never moves the others. Archiving one leaves its lot empty (a park) until the layout is rebuilt for the next visit. Beyond nine ventures the grid grows a ring. |
| Floating label: name + state | A | 3.1 |
| Hover lift ↔ card highlight | C | Local to the page: CSS `translate` on the `<img>`. |
| Click a building | C | Q-f: scroll to the card (mock) or open `/v/$slug`. |
| Roads, lamps, trees, pond | C | Baked into ground tiles. |
| Cars, smoke, orbiting satellite, blinking beacon | C, mostly lost | Sprites are still images. Small CSS overlays can bring back a few (a beacon blink, a soft lamp glow, an orbit dot on an ellipse path), each inside the reduced-motion block. Cars and smoke go. |
| Sky (stars, shooting star), mountains, purple gradient | C | CSS gradient + inline SVG. Twinkle as a CSS animation on a few dozen dots, not a per-frame canvas. |

### 3.4 Stats row

| Tile | Class | Source |
|---|---|---|
| Ventures | A | `ventures.length` |
| On shift "of N agents" | A | `useWorking()` and `agents.length` (Q-g: agent profiles or runtime slots) |
| Needs you "oldest 2h" | A | `inbox.pending`, oldest `createdAt` (`latestChangeAt` for drafts) |
| ~~Shipped this week~~ | Removed | D4. The row becomes three tiles, or takes another real figure (Q-h). |

### 3.5 Campus cards

| Element | Class | Source |
|---|---|---|
| App icon | A (D3) | `AppIcon` from the slug |
| Name, meta "N bets · N objectives · N work" | A | `openBets`; active objectives from the cockpit; work total via `workOf()` (exists in `holding.tsx`) |
| "v6" | A | `strategyVersion` (Q-i: pill or plain grey) |
| Quote | A | `cockpit.strategy.why` (today's cards show `what`) |
| Objective + progress track | A | `HoldingRow.objective`. Metric: latest reading against baseline and target (`latestOf`, `shareOfWay` in `src/loop-view.ts`); build: ticked over total in `doneList`; learning: no figure, show the statement only. |
| Work bar | A, reshaped | done / doing / todo counts from `holdingWork().workItems`, toned ok / live / wait. The mock's needs and bad segments go: work items don't have those states. |
| Cast strip | A | Running: `Cast` + `Elapsed` (exist). Needs you: "Waiting on you". Otherwise nothing, or quiet text. ~~Shipped line~~ removed. |
| New venture card | A | The existing link to `/new` |
| "Sort by heat" | C | Undefined; drop it, or reuse the existing sort by last activity (Q-j). |

### 3.6 Needs you aside (D6)

Holding-wide version of the existing `NeedsYou` (`inbox.tsx:1269`): the same `.quest` rows with
title, kind, venture and age, each linking into the Inbox. No inline actions, diffs or
confetti. The only change in `inbox.tsx` is accepting "all ventures" (or exporting its row
helpers); its behaviour stays the same.

### 3.7 On shift

The oldest running thread: title and `Elapsed` from `ActiveRun`; steps from
`queries.thread(id)` through `src/thread-timeline.ts`; live text from `src/thread-stream.ts`.
The mock's "+42 −17 / 128 passed" figures would mean parsing tool output; show the tool and
its input instead. The fake typewriter and the `setInterval` clock go.

### 3.8 Shell (now in scope, D2)

| Part | Change | Features that must survive |
|---|---|---|
| Rail | 84px, 58px app icons with a state dot (3.1), the mock's hover lift. Holding entry, new venture, operator toggle, ⌘K button and You stay. | Links, `aria-current`, tooltips, quiet state, live state (was crest twinkle, now the dot), operator toggle, the `op-open` third column |
| Dock | Mock's glyphs and the app-icon scope switcher | `Select` behaviour, the sliding thumb, keys 1–5 / I / A / H / O / ⌘K, inbox count, Strategy only in venture scope |
| Agent chips | Mock's styling; "over <venture>" is optional | Links to the thread, `Elapsed`, idle tooltips |

## 4. Risks and how to contain them

### 4.1 App-wide reskin (tokens, D2)

- **Token swap.** Replace the `:root` values in `styles.css` with the mock's (`--space`,
  `--stage`, `--card`, `--raise`, `--hover`, `--line*`, `--ink*`, `--h-*`, `--beacon`,
  `--danger`, `--ok`, `--acc-ink`). Names stay the same, so no component changes. Drop
  `--run`: D5 keeps running in the venture hue.
- **Contrast.** The saturated hues are darker than the v6 pastels in places (`--h-blue
  #5b7cff`, `--h-violet #8f6bff`). They are used as text (bet numbers, `.cast .mono`, links),
  as the primary button background under `--acc-ink`, and in diff `ins`/`del`. Check every
  hue against the card and stage surfaces, and against `--acc-ink` on `.btn.pri`. It may need
  lighter text variants per hue.
- **Hard-coded warm alphas.** `styles.css` has warm-white literals outside the tokens
  (`rgb(255 248 236 / …)` in `--line`, `--hi`, tracks and others). On a cool purple ground
  they read slightly yellow. Grep and move them to tokens.
- **Draft states** (slice 9: dashed outline, green new, struck red old value, red archive)
  and **diffs** (strategy history, Inbox) use `--ok` and `--danger`, which change shade.
  Check them against `ui-prototype-operator.html`'s intent.
- **Every tab must be looked at**: Holding, venture Overview, Strategy (with history), Work
  (list and the full work page), Threads (with spaces and a live run), Activity, Inbox (all
  four kinds), Agents (capacity panel), Settings, New venture, ⌘K, menus, toasts, tooltips,
  the operator panel and draft bar. This is impeccable's verification step, repeated across
  the app.

### 4.2 App icon replaces Crest

- `Crest` is used in the rail, the dock scope switcher, the ⌘K palette, `Select` options,
  Holding cards, the ledger, and venture pages. Replace it with an `AppIcon({ slug, size, state })`
  in `src/marks.tsx`. The glyph comes from `hash(slug) % glyphs.length` and the wash from
  `hueOf(slug)`.
- **Small sizes.** The real app draws crests at 14–20px; the mock's icons are 24–58px. A
  gradient glyph on a dark tile won't read at 14px. Below about 20px, use the glyph alone in
  the venture hue, or a solid tile.
- **Unique `<defs>` ids.** The mock builds gradient ids per key (`bg-${key}`), which collide
  when the same icon appears twice on a page. Use `useId()`, or one shared `<defs>` sprite.
- **Live state.** Crest dots twinkle while an agent works. The app icon shows it as the state
  dot instead, so the `.crest.live` rules go.
- The mock's 24px stroke glyphs for the dock (`pin`, `kanban`, `chat`, `stonks`, …) replace
  the 16px `Icon` paths for those slots. Keep `IconName` as the one icon registry, so there
  is still exactly one icon system.

### 4.3 The city: pre-rendered sprites (D7)

| Option | Runtime cost | Build effort | Fidelity to the reference | Verdict |
|---|---|---|---|---|
| three.js, live WebGL | ~130–170 kB gzip extra (estimate), a GPU context, a per-frame loop, context-loss handling | Highest: port r128 to current three, re-tune lighting, instancing, disposal under StrictMode and `key={pathname}` remounts | Highest | Fails "low resource" |
| Hand-drawn isometric SVG | Low | Medium–high: redraw five archetypes by hand | Lowest: glass, glow and lit windows get approximated, close to the flat toy look the owner rejected | Fidelity risk |
| **Pre-rendered sprites on an isometric grid** | **Lowest**: a few images (about 30–80 kB each as WebP) for the ventures on screen, no JS loop, no GPU context | **Lowest**: the builders already exist in the mock; render each once at the mock's camera angle | **Same as the mock** for buildings and ground; motion is mostly lost | **Chosen** |

How it works:

- **Render once, commit the images.** A reference page (a copy of the mock's scene code,
  kept at the repo root next to the other prototypes and ignored by Biome) renders each
  archetype × six hues, plus the ground tiles (lot, road, crossing, park, pond), on a
  transparent background at the fixed camera (azimuth π/4, elevation 0.56, orthographic) and
  2× resolution. The images go in `assets/web/valley/` (Vite's `publicDir`). With 5
  archetypes, that is 30 building images and a handful of tiles. Re-rendering is a manual,
  occasional step, not a build step: landmines bans `scripts/` folders and nonstandard
  package scripts, and a build that boots a browser would be heavy anyway.
- **Colour per hue at render time, not CSS tinting.** Glass and lit windows don't tint well
  with filters. The mock already picks building colours per venture; those become per-hue
  palettes in the reference page.
- **Place on a grid in the DOM.** An isometric projection is a fixed 2D transform: lot
  `(i, j)` → `x = (i − j)·w/2`, `y = (i + j)·h/2`. Tiles and buildings are absolutely
  positioned `<img>` elements, drawn back to front by `i + j`. Each label anchor is a
  per-archetype offset from the lot's screen point. All of this is pure math in
  `src/valley/layout.ts`, so it can be **unit-tested in node**, which fits the landmines
  no-doubles rule better than a WebGL scene ever could.
- **Motion** comes from a few CSS animations inside the reduced-motion block: star twinkle, a
  rare shooting star, label pulse on running, a beacon blink, lamp glow. There is no
  `requestAnimationFrame` loop, so there is nothing to pause when the hero is off screen, and
  reduced motion falls out of the existing CSS rule.
- **Hit testing**: `pointer-events` on each building `<img>` (its transparent pixels aren't
  excluded, which is acceptable at this density), or a hidden polygon per lot. Buildings can
  be real `<a>` or `<button>` elements, so keyboard focus and hover work alike.
- **Responsive**: scale the whole city with one CSS `transform: scale()` on its container from
  the hero's width. Hide labels and the legend below 760px, as the mock does.
- **Loading**: `loading="lazy"` and `decoding="async"` on the images, explicit `width` and
  `height` so nothing shifts. The ground for the current lot count shows first.

What this gives up: cars, smoke, the orbiting satellite and the moving camera sway. If the
owner later wants those, a lazy-loaded three.js scene can replace the sprite layer without
changing the rest of the page.

### 4.4 Class-name collisions

The mock's class names overlap with global rules in `styles.css` that mean something else:
`.hero` (`parts.tsx` `Hero`, every page title), `.vc` (Holding cards and `create-venture.tsx`),
`.page`, `.stat`, `.cols`, `.bar`, `.pip`, `.cast`, `.btn`, `.trace`, `.st`, `.say`, `.caret`,
`.chip`, `.sheet`, `.aside`, `.h1`, `.toast`, `.obj`.

Now that the look is app-wide, the shared ones (`.btn`, `.cast`, `.pip`, `.toast`, `.h1`) are
meant to change: restyle the existing rule, never add a second one. Valley-only parts (HUD,
labels, campus, city) get a `.vl-` prefix under a `.valley` root. Keep `.vc` working for
`/new`.

### 4.5 Features that must not regress

- The first-run branch (`CreateVenture firstRun` when there are no ventures) stays on `/`.
- The venture Overview's slice 9 draft rendering: drafted items keep their React keys and
  draft classes inside the restyled components (`OverviewView`, `Topics`, `VentureSheet`).
- Live updates: nothing changes in `src/live.ts`. The Valley reads only existing queries.
- Keys, ⌘K, the operator panel (`O`, the 408px third column), the draft bar, tooltips,
  toasts, menus.
- `<main key={pathname}>` remounts the page on each visit; with sprites there is no GPU
  context to dispose.

### 4.6 Testing under the landmines rules

- Unit tests run in node under `packages/*/src/**/*.test.ts`: `src/valley/state.test.ts`
  (state precedence) and `src/valley/layout.test.ts` (lot order and stability on add and
  archive, projection, depth order, label anchors), plus the archetype and glyph pick by slug.
- Visual checks in a real browser through impeccable, with reduced motion on and off, and at
  760px and 1100px.
- No prose comments (the mock's section banners go), no explicit return types, no fixed
  timers (the mock's `setInterval` and `setTimeout` typing go; `Elapsed` and the real stream
  replace them).

## 5. Rules: what the decisions settle and what is still open

Adopting D2 replaces v6. It needs a decisions log entry in `docs/architecture.md` (like
2026-11-25's v6 entry) and a rewrite of `packages/web/DESIGN.md` (front-matter tokens,
Colors, Components, Named rules). Process rule 4: change the rule first, then the code.

| # | Conflict with v6 | Status |
|---|---|---|
| C1 | Purple-navy world in place of warm near-black | Settled by D2: the new contract |
| C2 | Saturated hues | Settled by D2 |
| C3 | Hand-picked hues and per-slug building colours | Settled by D3: everything from the slug, so the Hue Means Venture Rule stays as written |
| C4 | Running in blue | Settled by D5: venture hue |
| C5 | App icon in place of Crest | Settled by D2 + D3 |
| C6 | A second icon set | Settled: the mock's glyphs replace the 16px set, and it stays one set |
| C13 | One-click approve with confetti | Settled by D6: not adopted |
| C14 | Fake venture names and per-slug builders | Settled by D3: archetypes, not slugs |
| C16 | three.js | Settled by D7: not added |
| C7 | Amber filled circle around the attention count | Settled by Q-k: like the mock: Plain Number Rule |
| C8 | Stat tiles, 56px/800 headline | Settled by Q-k: like the mock: Plain Number Rule, type scale |
| C9 | "v6" coloured pill | Settled by Q-i: like the mock: No Pills for plain facts |
| C10 | Uppercase letter-spaced kicker | Settled by Q-d: kept |
| C11 | Shadows and hover lift on all cards, glows | Settled by Q-k: like the mock: "flat by default" |
| C12 | Hue wash on card tops, glowing label feet | Settled by Q-k: like the mock |
| C15 | Prefixed Valley class names | Needs a DESIGN.md line (no owner question) |
| C17 | `valley-mock.html` and the sprite render page fail Biome | Needs `biome.json` ignores + a log entry (Q-l) |

## 6. Phased plan

Each phase ships on its own, keeps every feature working, passes `npm run lint`,
`npm run typecheck` and `npm test`, and goes through impeccable, including looking at every
screen it changes.

### Phase 0: write the rules down (no code, about 1–2 hours)

- A decisions log entry in `docs/architecture.md`: "UI v7 (the Valley)". It replaces the v6
  palette, adds the app icon in place of the crest and the sprite city, and records D1–D7.
- A `packages/web/DESIGN.md` rewrite for the new tokens, the app icon, the venture states
  (needs, running, queued, quiet) and the answers to Q-d, Q-i and Q-k.
- `biome.json` ignores for `valley-mock.html` and the sprite render page, if they are
  committed.
- Update AGENTS.md's "brand kit is the visual foundation" line if it is still meant to apply.

### Phase 1: tokens (about 1 day)

Swap the `:root` values and move the hard-coded warm alphas into tokens. Fix contrast where a
hue is used as text or behind `--acc-ink`. Look at every tab (4.1).
Touches: `src/styles.css` only.

### Phase 2: app icon, rail, dock, chips (about 1 day)

`AppIcon` in `src/marks.tsx` (glyph and hue from the slug, a state dot, a small-size variant)
replaces `Crest` at every call site. The rail goes to 84px with state dots and the dock gets
the new glyphs and scope switcher, both keeping every feature in 3.8.
Touches: `src/marks.tsx`, `src/shell.tsx`, `src/palette.tsx`, `src/menu.tsx` (glyph slots
only), `src/holding.tsx`, `src/cockpit.tsx` (crest call sites), `src/styles.css`, and a new
`src/valley/state.ts` + test (the rail needs the state).

### Phase 3: the Holding Valley, without the city (about 1–1.5 days)

The hero (sky gradient, mountains, HUD with real counts, legend), stats, campus cards, the
Holding-wide Needs you, and On shift. The city's place in the hero stays empty, or shows a
static image of the ground. Keep or drop the Ledger (Q-j).
Touches: `src/holding.tsx`, new `src/valley/{hud,campus,on-shift}.tsx`, `src/inbox.tsx`
(`NeedsYou` across all ventures, or exported helpers), `src/styles.css`.

### Phase 4: the city from sprites (about 2–3 days)

The render page (from the mock's builders, per-hue palettes, transparent background, fixed
camera) and the rendered images in `assets/web/valley/`. Then `src/valley/layout.ts` + test,
`src/valley/city.tsx` (tiles, buildings, labels, hover ↔ card, click), and the CSS motion
layer. Most of the time goes into rendering and checking 30 images against the reference
banner.
Touches: new files only, plus `src/holding.tsx` to mount the city and `src/styles.css`.

### Phase 5: the venture Overview in the new design (about 1 day)

Same content (D1): the venture sheet, Integrations, At a glance, Needs you, recent activity,
the Settings gear and draft states, restyled. Optionally a small hero with the venture's own
building on its lot (Q-c). Check with an open operator draft.
Touches: `src/cockpit.tsx` (`OverviewView`, `VentureSheet`, `Topics`), `src/styles.css`,
optionally `src/valley/city.tsx` in single-lot mode.

### Must not change in any phase

- `packages/api`, `packages/core`, migrations: no data changes (D4 removed the only gaps).
- `src/live.ts` hint handling and query keys; `src/api.ts`.
- `src/router.tsx` routes; every page's features, keys and commands.
- `src/draft.tsx`, `src/operator.tsx` behaviour (styling may follow the tokens).
- `hueOf`'s hash and hue order: a venture's colour must not change on upgrade. The hue
  *values* change; which hue each slug gets stays the same.

## 7. Second round: decided (2026-11-27)

Nothing is open. Work happens on branch `feat/valley-ui`.

| # | Answer |
|---|---|
| Q-a | **Show queued** as a venture state: needs you > running > queued > quiet / active. |
| Q-b | **The full mock rail and dock**: 84px rail with app icons and a state dot, app-icon scope switcher. Every current rail and dock feature stays. |
| Q-c | **The venture Overview gets a hero** with its own building (single-lot city), above all of today's content. |
| Q-d, Q-e | **Copy as in the mock**: the "THE HOLDING" kicker, "The Valley never sleeps.", "N ventures on shift", "Break ground". The kicker's dot becomes the live-connection indicator (`useHintStream` state: green when live). |
| Q-f | **Clicking a building opens the venture** (`/v/$slug`). |
| Q-g | Default taken: "of N" counts **agent profiles** (`agents.length`), the same set as the agent chips. |
| Q-h | **Fourth tile: work done this week**, from `holdingWork().workItems` with `status === "done"` and `updatedAt` within 7 days. This is approximate: `updatedAt` also moves when a done item is edited. An exact count would need `work.status_set` events per venture, which is a query change and goes against "no API work". |
| Q-i, Q-k | **Styling like the mock, app-wide**: card shadows and hover lift, glows, big-number stat tiles, the amber count badge, the coloured version pill. This replaces v6's flat, plain-number, no-pill rules (C7–C12): DESIGN.md's named rules are rewritten in phase 0. Amber Means You and Hue Means Venture stay. |
| Q-j | **Drop the Ledger table.** The sort state and `columns` in `holding.tsx` go with it. |
| Q-l | Default taken: commit `valley-mock.html` and the sprite render page as references with Biome ignores, since the sprites are rendered from them. |

The first-round list, for the record:

- **Q-a** Keep **queued** as a visible venture state, or show only needs you and running?
- **Q-b** Is the rail and dock restyle (84px rail, app icons with state dots) part of "app
  wide", or only the tokens and icons inside the current rail?
- **Q-c** Should the venture Overview get a hero with its own building, or just the restyled
  page?
- **Q-d** Keep the uppercase kicker "THE HOLDING"? Drop its green dot, or make it the live
  connection indicator?
- **Q-e** Does the HBO-flavoured copy ("The Valley never sleeps.", "Break ground", "on shift")
  ship?
- **Q-f** Clicking a building: scroll to its card, or open the venture?
- **Q-g** "On shift · of N": agent profiles or runtime slots?
- **Q-h** With "Shipped this week" gone, three stat tiles, or a fourth real figure (open bets,
  work done this week from `holdingWork`)?
- **Q-i** The "v6" version: a coloured pill as in the mock, or plain grey text?
- **Q-k** Adopt the mock's heavier styling app-wide (shadows and lift on cards, glows, stat
  tiles with big numbers, the amber count badge), or keep v6's flat, plain-number style in the
  new palette?
- **Q-j** The sortable Ledger table on the Holding: keep it below the campus, or drop it?
- **Q-l** Commit `valley-mock.html` (and the sprite render page) as references, with Biome
  ignores?
