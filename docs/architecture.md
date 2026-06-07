# Architecture

`media-lookup` is a small Cloudflare Worker. The code is organized so that HTTP
contract handling, application behavior, external provider access, and
Cloudflare-specific wiring stay separate.

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

- `src/core/routes.ts` owns URL, method, and query-string parsing.
- `src/core/requestGuards.ts` owns rate limiting and Bearer authorization.
- `src/core/lookupHandlers.ts` owns `/lookup`, `/lookup/batch`, lookup cache
  reads/writes, and TMDB lookup orchestration.
- `src/core/lookupBatch.ts` owns JSON body validation for `/lookup/batch`.
- `src/core/overviewFallback.ts` owns `/translate` and cached English overview
  hydration for the home page.
- `src/core/dailyHandler.ts` owns the `/daily` diagnostic endpoint.
- `src/core/dailySnapshot.ts` owns daily snapshot freshness and lookup cache
  warmup.
- `src/core/tmdbClient.ts` owns TMDB API calls and TMDB response mapping.
- `src/core/htmlPage.ts` owns public home page rendering.
- `src/core/responses.ts` owns response helpers and common error shapes.

## Ports And Adapters

Core code depends on ports in `src/ports/` instead of direct Cloudflare APIs:

- `lookupCache.ts`
- `storage.ts`
- `mediaProvider.ts`
- `rateLimiter.ts`
- `metrics.ts`

`src/platforms/cloudflare.ts` is the Cloudflare adapter layer. It reads env vars,
binds KV, adapts Worker Rate Limit bindings, creates the TMDB provider, and
writes metrics events to the console.

## Data Boundaries

All persistent application data uses the `DAILY_KV` binding:

- daily snapshots
- lookup cache entries
- English overview fallback cache entries

Lookup cache keys are built by `src/core/cacheKeys.ts`. Daily snapshot keys are
built by `src/core/dailySnapshot.ts`.

## Testing

Core behavior is tested with regular Vitest tests under `test/core/`.
Cloudflare runtime wiring is tested with `@cloudflare/vitest-pool-workers` under
`test/worker/`.
