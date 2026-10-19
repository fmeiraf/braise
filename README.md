# Braise

TypeScript workspace boilerplate based on `~/projects/pi`: npm workspaces, ESM,
strict TypeScript, Biome, Vitest, and Husky.

Requires Node.js 22.19 or newer and npm.

```sh
npm ci --ignore-scripts
npm run prepare
npm run check
npm run build
npm test
```

`npm run prepare` enables the pre-commit check locally. CI installs with lifecycle
scripts disabled.

## Structure

- `packages/core/src/index.ts`: empty entry point for `@braise/core`.
- `tsconfig.base.json`: shared compiler settings.
- `tsconfig.json`: type checking for source, tests, and test configuration.
- `packages/core/tsconfig.build.json`: JavaScript, declarations, and source maps in `dist/`.
- `vitest.config.ts`: Node tests with workspace source resolution.

Add code under `packages/core/src/` and tests under `packages/core/test/*.test.ts`.
The test command allows an empty suite until tests are added. Use `.ts` extensions
for relative imports; TypeScript rewrites them to `.js` during builds.

## Commands

- `npm run check`: check formatting, lint, and types without changing files.
- `npm run format`: apply Biome formatting and safe lint fixes.
- `npm run build`: build workspace packages.
- `npm run clean`: remove workspace build output.
- `npm test`: run tests once.
- `npm run test:watch`: watch tests during development.

For another package, follow `packages/core`, give it a unique name, and add its
source path to the root TypeScript `paths`. Add workspace dependencies with exact
versions, matching the local package version. Keep dependency versions pinned;
`.npmrc` enables exact saves.
