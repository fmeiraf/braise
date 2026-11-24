# Braise

TypeScript workspace based on `~/projects/pi`: npm workspaces, ESM, strict
TypeScript, Biome, oxlint with [landmines](https://github.com/interfere-inc/landmines),
Vitest, and Husky. See `docs/architecture.md` and `AGENTS.md`.

Requires Node.js 22.19 or newer and npm.

```sh
npm ci --ignore-scripts
npm run prepare
npm run lint
npm run typecheck
npm run build
npm test
```

`npm run prepare` enables the pre-commit lint and typecheck locally. CI installs with lifecycle
scripts disabled.

## Structure

- `packages/core/src/index.ts`: empty entry point for `@braise/core`.
- `tsconfig.base.json`: shared compiler settings.
- `tsconfig.json`: type checking for source, tests, and test configuration.
- `packages/core/tsconfig.build.json`: JavaScript, declarations, and source maps in `dist/`.
- `vitest.config.ts`: Node tests with workspace source resolution.

Unit tests sit beside their subject (`src/foo.ts` → `src/foo.test.ts`). A package's
`test/` directory holds only integration and end-to-end suites. The test command allows
an empty suite until tests are added. Use `.ts` extensions
for relative imports; TypeScript rewrites them to `.js` during builds.

## Commands

- `npm run lint`: Biome (format + lint) and oxlint/landmines, with warnings treated as
  errors.
- `npm run typecheck`: TypeScript, with no emit.
- `npm run format`: apply Biome formatting and oxlint autofixes.
- `npm run build`: build workspace packages.
- `npm run clean`: remove workspace build output.
- `npm test`: run tests once.

For another package, follow `packages/core`, give it a unique name, and add its
source path to the root TypeScript `paths`. Add workspace dependencies with exact
versions, matching the local package version. Keep dependency versions pinned;
`.npmrc` enables exact saves.
