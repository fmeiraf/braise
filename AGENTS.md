# Braise agent instructions

Read `docs/architecture.md` before proposing or making changes. Its rules are binding.

## Code honesty: landmines

`npm run lint` runs oxlint with the
[landmines](https://github.com/interfere-inc/landmines) `recommended`, `restriction`
and `style` layers (`.oxlintrc.json`). Warnings fail too. The pre-commit hook and CI
enforce it. Follow each rule's message instead of working around it:

- No test doubles: no module mocks, `vi.fn(impl)` or stubbed globals. Test against
  real implementations (real Postgres) and use MSW for outside network calls.
  Observation-only spies are fine.
- No fixed sleeps, unsignaled polls, retries or raised timeouts. Await the operation
  or the signal it emits. A flaky test is a bug to fix.
- No silent catches and no conditional assertions.
- No prose comments. Rationale goes in the commit or PR. Exceptions: functional
  directives, single-line `// WARNING:` comments, and TSDoc on public API.
- Unit tests sit beside their subject (`foo.test.ts`). A package's `test/` directory
  holds only integration and end-to-end suites. Use the `.test.ts`, `.fixture.ts`
  and `.test-utils.ts` file names.
- Use standard `package.json` script names (`build`, `dev`, `lint`, `test`,
  `typecheck`, ...). No `scripts/` folders. Explicit package `exports`.
- No explicit return types on implementations; use `satisfies` to pin a contract.
- Never disable a rule inline to get green. Changing the config is a recorded
  decision in `docs/architecture.md`.

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
