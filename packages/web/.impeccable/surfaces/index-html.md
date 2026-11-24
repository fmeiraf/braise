---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: []
---

# braise app shell

Mode: Operate. Desktop-first (~1024px min). One expert user, the owner.

Audience and job: the owner steering several ventures. Two scenes, equally: long planning sessions in the cockpit (read and revise strategy, bets, goals; steer agent threads) and quick check-ins (what moved, what needs me, one edit, leave).
Surfaces: Holding, venture cockpit, work, threads with live agent runs, strategy history, activity, first-run create form.
Constraints: no modals, no ⌘K, no mobile layout. Live updates without refresh; a reconnect indicator only while the stream is down.
User steer (quoted, 2026-11-24): "completely blow me out... minimalistic with very proper spacing and typography... no life no movement even on the branding and the logo... I love linear... every time I look at it I'm proud I'm excited that things are happening that things are moving... you can even create a new logo a new identity". Earlier steer still holds: "A mixture of Linear and Slack UI, very modern and minimalist on details". Not a big animated blob: motion is small, purposeful and tied to real state.

## Direction contract

THESIS: every venture is a living cross-section. Each strategy revision lays down a ring; agents at work grow the outer ring live. Refuses the flat grey Linear clone and the charcoal-and-cream terminal kit it replaces.
OWN-WORLD: pith green-black rail (#131a16) with pale sage ink, a cool sage-white ground (#f4f5f1) and white raised panels; resin amber (#f0a63a) only for the primary action and live state; moss for done, bark for error. Each venture owns one full-strength hue (violet, rose, teal, ...) that colours its ring glyph everywhere (raise: acetate manual). Bricolage Grotesque for the wordmark and page titles, Geist for UI, Geist Mono for data only. Rounded 8px controls, 14px panels, hairline rules, round markers.
STORY: the owner sees each venture's rings in the rail, knows which one is alive by its turning outer ring, opens it, reads the strategy under a ring core sample of its revisions, scans bets and goals, and watches agent runs whose steps are drawn to their exact duration (raise: labanotation). Agents carry a named glyph and fixed colour (raise: character catalog).
FIRST VIEWPORT: 244px pith rail (ring logo + braise wordmark, Inbox with resin count, Runs with live count, Holding, ventures with ring glyphs, venture sub-nav). Work area: breadcrumb bar with secondary New thread and resin Add bet; venture header with a 92px ring core sample beside the 30px Bricolage title and "Claude is working" meta; strategy kernel as a definition list; bets with goals and slim venture-hue progress bars. Right column: live run panel with duration-scaled step bars, Needs you, Activity.
FORM: assigned direction 5 of 7 (Growth Rings); seed:fe083d5136f1ba63. Raise from design annual: one grotesque at three sizes, rank from weight and ink.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
