# Braise agent instructions

Read `docs/architecture.md` before proposing or making changes. Its rules are binding.

## UI work: impeccable is mandatory

Every step that touches UI must go through the `impeccable` skill
(`.agents/skills/impeccable`): designing screens, structure and flows, writing or
changing components, CSS, layout or copy, and critique or polish passes.

- Load the skill before starting, and follow its setup (run its `context` script once
  per session).
- The brand kit in `assets/` (`brand.css`, `brand-tokens.json`) is the visual
  foundation.
- No UI change is done without impeccable's verification: look at the rendered
  result.
