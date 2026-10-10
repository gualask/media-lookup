# Architecture

`media-lookup` is a small Cloudflare Worker. The code is organized so that HTTP
contract handling, application behavior, external provider access, and
Cloudflare-specific wiring stay separate.

```text
src/
  index.ts           Worker entry point
  core/              HTTP contract and application behavior, no Cloudflare or TMDB APIs
  ports/             interfaces the core depends on
  providers/tmdb/    TMDB adapter behind the media provider port
  platforms/         Cloudflare adapters and dependency wiring
scripts/analytics.mjs  cache and CPU figures from the Cloudflare APIs
```

## Runtime Flow

Every request enters through `src/index.ts`, which builds Cloudflare dependencies
with `src/platforms/cloudflare.ts` and passes the request to
`src/core/handleRequest.ts`.

`handleRequest.ts` is intentionally only a dispatcher:

1. Parse the route with `src/core/routes.ts`.
2. Apply request guards from `src/core/requestGuards.ts`.
3. Call the handler for the matched route.
4. Map provider/runtime errors through `src/core/errorHandler.ts`.

## Core Modules

- `routes.ts` owns URL, method, and query-string parsing.
- `requestGuards.ts` owns rate limiting and Bearer authorization.
- `lookupHandlers.ts` owns `/lookup` and `/lookup/batch`: cache reads and
  writes, provider calls, per-item batch failures, and lookup metrics.
- `lookupBatch.ts` owns JSON body validation for `/lookup/batch`.
- `lookupCache.ts` owns the lookup cache entry format and its validation on top
  of the storage port.
- `cacheKeys.ts` builds lookup cache keys; `titles.ts` normalizes titles for
  keys and for matching; `dates.ts` handles `YYYY-MM-DD` date keys.
- `dailySources.ts` decides what the home page calls news: which sections exist,
  their date windows, re-release and script filters, and dedupe order. It asks
  the provider through generic discover queries.
- `dailySnapshot.ts` owns snapshot freshness, storage, the fallback to the
  previous snapshot when a refresh fails, and the lookup cache warmup.
- `dailyHandler.ts` owns the `/daily` diagnostic endpoint.
- `pageHandlers.ts` owns `/` and the favicon routes.
- `htmlPage.ts` renders the home page; `homeStyles.ts` holds its stylesheet and
  `tmdbLogo.ts` the TMDB attribution logo.
- `responses.ts` owns response helpers and common error shapes.

## Ports And Adapters

Core code depends on ports in `src/ports/` instead of direct Cloudflare or TMDB
APIs:

- `storage.ts`: text values with an optional TTL. Daily snapshots and lookup
  cache entries both live there.
- `mediaProvider.ts`: title lookup, discover queries for the daily snapshot,
  and a request count for metrics.
- `rateLimiter.ts`
- `metrics.ts`

`src/providers/tmdb/` implements the media provider port: `client.ts` sends
authenticated requests to TMDB and retries once on `429`; `provider.ts` builds
search and discover requests, maps TMDB results, and picks the best search
result with its `match`.

`src/platforms/cloudflare.ts` is the Cloudflare adapter layer. It reads env vars,
binds KV, adapts Worker Rate Limit bindings, creates the TMDB provider, and
writes metrics events to the console, which Workers Logs keeps.

## Data Boundaries

All persistent application data uses the `DAILY_KV` binding:

- daily snapshots (`daily:v5:<language>`)
- lookup cache entries (`lookup:v3:...`), written by lookups and by the daily
  snapshot warmup

## Testing

Core behavior is tested with regular Vitest tests under `test/core/`, with
in-memory ports from `test/core/helpers.ts`. The TMDB adapter is tested under
`test/providers/` against a stubbed `fetch`. Cloudflare runtime wiring is tested
with `@cloudflare/vitest-plugin` under `test/worker/`.
