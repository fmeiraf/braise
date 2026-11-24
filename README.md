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

## Run it locally

```sh
cp .env.example .env
docker compose up -d        # Postgres 17 on 127.0.0.1:54329 (braise + braise_test)
npm run dev                 # API on :4400 (migrates on start) + web on http://127.0.0.1:5400
```

Database tasks run through the `braise` bin from `@braise/api`:

- `npx braise migrate`: apply pending migrations.
- `npx braise reset`: drop and re-create the local schema, without seed data.
- `npx braise seed`: add the labelled example venture (safe to rerun).

`npm test` needs the Postgres container: the API suites run against `braise_test`.

## Structure

- `packages/core`: `@braise/core`, command schemas (zod) and shared types; no I/O.
- `packages/api`: `@braise/api`, the Hono API, command pipeline, Drizzle schema and
  migrations (`drizzle/`), SSE hints and the `braise` bin.
- `packages/web`: `@braise/web`, the Vite + React SPA. It talks to the API over HTTP
  only.
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
