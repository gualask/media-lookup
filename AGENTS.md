# Repository Guidelines

## Project Structure

`media-lookup` is a Cloudflare Worker that resolves movie and TV metadata from TMDB for a desktop client kept in a separate private repository. `README.md` documents the HTTP contract, cache and configuration; `docs/architecture.md` the module layout.

This repository is public. Do not name the client application or its files in code, docs, tests or commit messages; write "the client" or "the desktop client". Local, uncommitted notes about the client live in `CLAUDE.local.md` (Git-ignored); if it is missing, ask the user where the client repository is.

- `src/index.ts` builds Cloudflare dependencies (`src/platforms/cloudflare.ts`) and hands every request to `src/core/handleRequest.ts`, which only dispatches: parse route, rate limit, authorize, call the handler, map errors.
- Core code in `src/core/` depends on the interfaces in `src/ports/`, never on Cloudflare APIs directly. Cloudflare specifics (KV, rate limit bindings, env vars) stay in `src/platforms/cloudflare.ts`.
- Core tests in `test/core/` run on Node with fake ports from `test/core/helpers.ts`; `test/worker/` runs inside workerd through `@cloudflare/vitest-plugin`.

## Commands

- `pnpm check`: format and lint with Biome, applying fixes. `pnpm lint` checks without writing.
- `pnpm type-check`: regenerates `worker-configuration.d.ts` with `wrangler types`, then runs `tsc`. Run it after any change to `wrangler.jsonc`.
- `pnpm test` and `pnpm test:worker`: core and Worker runtime tests.
- `pnpm dev`: local Worker with secrets from `.dev.vars`.
- `pnpm run deploy`: deploys to production (`media-lookup.gualask-dev.workers.dev`). Deploy only when the user asks.
- `pnpm analytics [--days=N]`: cache hits per route from Workers Logs and daily requests, errors and CPU from the GraphQL Analytics API.

## Credentials

- Wrangler commands use the `wrangler login` OAuth session. In a non-interactive shell an expired session cannot be renewed: ask the user to run `! pnpm exec wrangler login`.
- `.env.cloudflare` holds `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`, used only by `pnpm analytics`. The OAuth session cannot query Workers Logs; this token can.
- Never rename `.env.cloudflare` to `.env`. Wrangler loads `.env` on every command, so the token would replace the OAuth session for deploys, and `wrangler dev` can expose `.env` values to the Worker's `env`. Wrangler reads `.env.<name>` only with `--env <name>`, and there is no `cloudflare` environment.
- `.dev.vars` holds local `TMDB_TOKEN` and `API_BEARER_TOKEN`.
- The production bearer token is embedded in the client (see `CLAUDE.local.md`). For checks against production, read it into a shell variable; never print a token or secret value.

## Contract With The Client

The desktop client is the only caller. These values must change together in both repositories (client-side locations are in `CLAUDE.local.md`):

- Batch size: `LOOKUP_BATCH_MAX_ITEMS` in `src/core/lookupBatch.ts` must be at least the client's batch size (15). An oversized batch fails as a whole with 400, and the client marks every item as an error.
- Languages: `SUPPORTED_LANGUAGES` in `wrangler.jsonc` must include every metadata language the client's settings offer.
- Response shape: for `match: "uncertain"` the client drops the remote id and the year, so it neither auto-merges media nor overwrites an unknown year.
- Batch items can fail on their own with `status: "error"`; the client stores them as errors and retries them with backoff.
- The client ignores unknown response fields. Additive changes are safe in either deploy order; removals and renames are not.

## Cache And Data

- The remote `DAILY_KV` namespace is live production data: `wrangler kv ... --remote` commands act on it. `pnpm dev` uses local simulated storage. Do not write or delete remote keys by hand unless the user asks.
- Lookup cache keys carry a version (`lookup:v3` in `src/core/cacheKeys.ts`). Bump it whenever the cached entry shape or the way results are chosen changes, so old entries are no longer read and expire on their TTL.
- Count KV writes in any new feature: the Free plan allows 1,000 per day. Each lookup miss writes one key; a daily snapshot refresh writes about 90 warmup keys.

## TMDB

- TMDB is used only by this Worker, and the home page is the product that shows its data: keep the footer attribution (approved logo from `src/core/tmdbLogo.ts`, unmodified and smaller than the page title, link to themoviedb.org, required notice).
- Movie searches send `year`, not `primary_release_year`: release names often carry the local release year.
- TMDB allows about 40 requests per second; on `429` the client waits for `Retry-After` and retries once.

## Cloudflare Free Plan Limits

- CPU: 10 ms per request. A batch of 15 uncached lookups measured about 12 ms, and the daily snapshot refresh 10 to 15 ms; no request has failed yet. Check `pnpm analytics` for a status other than `success` after changes that add work per request.
- Subrequests: 50 external `fetch` calls per request. A batch makes at most one TMDB call per item, two with a `429` retry; the snapshot makes 7.
- Workers Logs keeps 3 days of events.
- Verify limits in the current Cloudflare docs before relying on them; they change.

## Deploy And Verify

- Right after a deploy, the previous version can still answer for a few seconds. Repeat a check before concluding that it failed.
- Verify production behavior with `curl` against the routes in `README.md`, and with `pnpm exec wrangler tail --format json` for per-request CPU and metrics. macOS has no `timeout` command; stop a tail by ending its process.

## Changes And Commits

- Keep README, `docs/architecture.md` and this file aligned with behavior changes.
- Commit messages: imperative, sentence case, no prefix (for example "Add pnpm analytics for cache and CPU figures"), with a body explaining why.
- Library updates follow the shared notes in `../README.md`. Major upgrades go in their own commit, and that file's tables and log are updated afterwards.
