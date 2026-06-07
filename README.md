# media-lookup

`media-lookup` is a Cloudflare Worker that provides movie and TV metadata for
`irc-news` without exposing the TMDB token to browser clients.

The public home page is also used as a lazy warmup surface: visiting `/` builds
the daily media snapshot once per day and writes lookup-compatible cache entries.

## Features

- TMDB movie and TV lookup by title, type, optional year, and language.
- Lazy daily home snapshot for recent media discovery and lookup cache warmup.
- Cloudflare KV-backed lookup cache with 30 day TTL for found results and 1
  day TTL for misses.
- Direct TMDB image CDN usage for posters. The Worker does not proxy poster
  bytes.
- Lazy English overview fallback through TMDB detail lookup, not machine
  translation.
- Bearer-protected API routes for server-side `irc-news` integration.
- Worker Rate Limit bindings for public and API traffic.
- Inline SVG favicon served by the Worker.
- Console-based structured metrics events.

## Stack

- Cloudflare Workers, Module Worker mode.
- TypeScript strict.
- `pnpm`.
- Biome for format/lint.
- Vitest for core tests.
- `@cloudflare/vitest-pool-workers` for Worker runtime tests.
- Cloudflare KV through the `DAILY_KV` binding.

## Production URL

```text
https://media-lookup.gualask-dev.workers.dev
```

## HTTP Contract

`GET` is supported for public/read routes. Lookup batch uses `POST`. Other
methods return `405`.

Public routes:

- `GET /`
- `GET /favicon.svg`
- `GET /favicon.ico`

API routes:

- `GET /lookup`
- `POST /lookup/batch`
- `GET /translate`
- `GET /daily`

When `API_BEARER_TOKEN` is configured, every API route requires:

```http
Authorization: Bearer <API_BEARER_TOKEN>
```

Rate limiting runs before Bearer authorization. `/` uses the public rate limit
scope, API routes use the API rate limit scope, and favicon routes bypass both
rate limiting and authorization.

Common API error shapes:

```http
401
```

```json
{
  "error": {
    "code": "unauthorized",
    "message": "Missing or invalid bearer token"
  }
}
```

```http
429
```

```json
{
  "error": {
    "code": "rate_limited",
    "message": "Rate limit exceeded"
  }
}
```

## Home

```http
GET /
```

Serves the HTML preview page. The root route is public and does not accept query
parameters. Requests such as `/?type=movie&title=Dune` return `400`.

The home page refreshes the default-language daily snapshot lazily. If the
stored snapshot was generated on the current day in `DAILY_REFRESH_TIME_ZONE`,
it is reused from KV and TMDB is not called. If it is missing or stale, the
Worker calls TMDB, stores `daily:v4:<language>`, and warms lookup cache entries
with the same keys used by `/lookup`.

The rendered page:

- Shows `Media lookup`, item count, and `generatedAt` on the same header line.
- Groups items by source section.
- Uses direct TMDB poster URLs at size `w185`.
- Links each item to a YouTube search for `<title> <year> trailer italiano`.
- Shows the full localized overview in a fixed-height scrollable item body.
- Renders `Recupera trama EN` for empty localized overviews.

The fallback button calls `/translate` from browser JavaScript without a Bearer
token. In production, where `API_BEARER_TOKEN` is configured, that click cannot
authorize itself and will fail with `401`. The protected `/translate` endpoint
is still the intended server-side integration point for `irc-news`; if the
fallback has already been cached by an authorized call, the home page hydrates it
while rendering.

### Daily Sources

The home snapshot uses these TMDB sources in display and dedupe priority order:

1. Film recenti streaming e home video:
   `/discover/movie`, `release_date.gte=today-120`,
   `release_date.lte=today`, `with_release_type=4|5`,
   `watch_region=<region>`,
   `with_watch_monetization_types=flatrate|rent|buy`.
2. Film in tendenza recenti:
   `/trending/movie/day`, then local release-date filtering from `today-180` to
   `today+365`.
3. Film recenti al cinema:
   `/discover/movie`, `release_date.gte=today-45`,
   `release_date.lte=today`, `with_release_type=2|3`.
4. Film in arrivo al cinema:
   `/discover/movie`, `release_date.gte=today+1`,
   `release_date.lte=today+45`, `with_release_type=2|3`.
5. Serie con episodi recenti:
   `/discover/tv`, `air_date.gte=today-14`, `air_date.lte=today`,
   `with_type=4`.
6. Serie con episodi in arrivo:
   `/discover/tv`, `air_date.gte=today+1`, `air_date.lte=today+14`,
   `with_type=4`.

Movie discovery uses `sort_by=popularity.desc`, `include_adult=false`,
`include_video=false`, `page=1`, and the region inferred from the language tag,
for example `it-IT` -> `IT`. The home-video source also sends `watch_region`.

TV discovery uses `air_date`, not `first_air_date`, so long-running series can
appear when they have recent or upcoming episodes. It also sends
`include_adult=false`, `include_null_first_air_dates=false`,
`sort_by=popularity.desc`, `timezone=<DAILY_REFRESH_TIME_ZONE>`, and
`with_type=4` for scripted shows.

Daily snapshot items whose localized title contains no Latin letters are
excluded from the home and warmup flow.

The Worker accepts up to 20 new unique items per source. Movies are deduped by
TMDB id in this priority order: streaming/home video, trending recent, recent
theatrical, upcoming theatrical. TV items are deduped by TMDB id with recent
episodes before upcoming episodes.

## Favicon

```http
GET /favicon.svg
GET /favicon.ico
```

Both routes serve the same inline SVG favicon generated by the Worker. The home
page links `/favicon.svg`; `/favicon.ico` exists as a browser fallback. Both
responses are cacheable for one year.

## Lookup

```http
GET /lookup?type=movie&title=Dune&year=2024&language=it-IT
GET /lookup?type=tv&title=Breaking%20Bad&year=2008&language=it-IT
```

Query parameters:

- `type`: required, `movie` or `tv`.
- `title`: required.
- `year`: optional, four digits.
- `language`: optional, defaults to `DEFAULT_LANGUAGE`.

Unexpected query parameters return `400`. Unsupported languages return `400`.
Missing metadata returns `404`.

Response:

```json
{
  "type": "movie",
  "provider": "tmdb",
  "remoteId": "693134",
  "title": "Dune - Parte due",
  "year": 2024,
  "overview": "Trama localizzata se disponibile",
  "posterPath": "/abc123.jpg"
}
```

`posterPath` is a TMDB path, not a proxied media URL.

## Lookup Batch

```http
POST /lookup/batch
Content-Type: application/json
Authorization: Bearer <API_BEARER_TOKEN>
```

Request:

```json
{
  "items": [
    { "type": "movie", "title": "Dune", "year": 2024, "language": "it-IT" },
    { "type": "tv", "title": "Breaking Bad", "year": 2008, "language": "it-IT" }
  ]
}
```

Rules:

- `items` is required and cannot be empty.
- Maximum batch size is 10 items.
- Each item uses the same fields as `/lookup`.
- In JSON, `year` must be a four digit number, not a string.
- Internal provider concurrency is capped at 3.
- Results are returned item-by-item and keep the original input index.

Response:

```json
{
  "results": [
    {
      "index": 0,
      "status": "found",
      "metadata": {
        "type": "movie",
        "provider": "tmdb",
        "remoteId": "693134",
        "title": "Dune - Parte due",
        "year": 2024,
        "overview": "Trama localizzata se disponibile",
        "posterPath": "/abc123.jpg"
      }
    },
    { "index": 1, "status": "not_found" }
  ]
}
```

The batch route exists to reduce Worker request bursts from desktop clients. It
does not merge multiple TMDB searches into one upstream TMDB API call.

## English Overview Fallback

```http
GET /translate?type=movie&id=693134&language=en-US
GET /translate?type=tv&id=1399&language=en-US
```

This endpoint is intentionally lazy. Clients should call it only after explicit
user action when the localized `overview` is empty.

It does not perform machine translation. It asks TMDB for the media detail in
the requested language, normally `en-US`, and returns a non-empty overview when
TMDB has one.

Query parameters:

- `type`: required, `movie` or `tv`.
- `id`: required TMDB numeric id.
- `language`: optional, defaults to `DEFAULT_LANGUAGE`.

Unexpected query parameters return `400`. Unsupported languages return `400`.
Missing overview fallback returns `404`.

Response:

```json
{
  "overview": "English overview from TMDB.",
  "language": "en-US"
}
```

Successful fallbacks are cached for 30 days. Missing fallbacks are cached for 1
day.

## Daily Snapshot Diagnostic

```http
GET /daily?language=it-IT
```

Returns the currently stored daily snapshot. This endpoint is read-only: it does
not generate a snapshot by itself.

Query parameters:

- `language`: optional, defaults to `DEFAULT_LANGUAGE`.

Unexpected query parameters return `400`. Unsupported languages return `400`.
If no snapshot exists, the endpoint returns `404`.

## Poster Handling

The Worker returns only `posterPath`. Clients should build TMDB image CDN URLs
directly:

```text
https://image.tmdb.org/t/p/w185/<posterPath-without-leading-slash>
```

Recommended sizes:

- `w185` for lists and compact cards.
- `w342` or `w500` only for larger views.
- Avoid `original` by default.

If `irc-news` wants local filesystem caching, it should cache the final CDN size
it actually displays.

## Cache

All application cache lives in Cloudflare KV through `DAILY_KV`.

Lookup metadata:

```text
lookup:v1:<language>:<type>:<normalized-title>:<year-or-none>
```

Title normalization is shared by runtime lookup and daily warmup:

- trim
- lowercase
- accents removed
- punctuation and other non-letter/non-number characters treated as separators
- repeated whitespace collapsed
- normalized title URI-encoded inside the key

Example: `Dune - Parte due` and `Dune Parte Due` produce the same title segment.

Daily snapshot:

```text
daily:v4:<language>
```

The daily snapshot is stored without a KV expiration TTL. Freshness is decided
by comparing `generatedAt` with the current date in `DAILY_REFRESH_TIME_ZONE`.

English overview fallback:

```text
overview_fallback:v1:<language>:<type>:<remoteId>
```

Lookup cache entries store either a found metadata result or a short negative
`not_found` entry.

TTL:

- lookup metadata: 30 days
- lookup not found: 1 day
- overview fallback success: 30 days
- overview fallback not found: 1 day
- daily snapshot: refreshed lazily by date

## Metrics

Metrics currently use `ConsoleMetricsPort`, which writes one JSON object per
event with:

```text
route, cache, provider, tmdbCalls, status, mediaType, language
```

Current route values:

- `page`
- `daily_refresh`
- `lookup`
- `lookup_batch`
- `translate`
- `daily`

Cache values:

- `hit`
- `miss`
- `bypass`

Current behavior:

- `/` records `page` with `cache=hit` when the daily snapshot is reused.
- `/` records `page` with `cache=miss` when it triggered a refresh.
- A refresh also records `daily_refresh` with `tmdbCalls=6`.
- `/lookup`, `/lookup/batch`, and `/translate` record `hit` or `miss`.
- `/daily` records `bypass`.

Parse errors, authorization failures, rate-limit failures, and favicon requests
do not currently emit metrics events.

## irc-news Integration

Use lookup first from server-side code:

```text
<WORKER_URL>/lookup?type=movie|tv&title=<title>&language=<language>&year=<optional>
```

For desktop batch hydration, prefer:

```text
<WORKER_URL>/lookup/batch
```

with up to 10 items per request.

Protected API routes require:

```http
Authorization: Bearer <API_BEARER_TOKEN>
```

Use the returned `posterPath` to build a direct TMDB CDN image URL.

If `overview` is empty, expose a user-triggered action in `irc-news` and call:

```text
<WORKER_URL>/translate?type=<movie|tv>&id=<remoteId>&language=en-US
```

Do not prefetch English fallbacks for every item. The endpoint is designed for
explicit clicks so TMDB calls are not spent on titles the user never opens.

If `irc-news` persists movie or TV metadata, it should store the recovered
English overview after a successful fallback call. Future plain `/lookup`
responses can still have an empty localized overview, because `/lookup` returns
the localized TMDB search result and does not merge fallback cache entries.

## Configuration

Cloudflare secrets:

```text
TMDB_TOKEN
API_BEARER_TOKEN
```

Set them with:

```sh
pnpm exec wrangler secret put TMDB_TOKEN
pnpm exec wrangler secret put API_BEARER_TOKEN
```

`TMDB_TOKEN` is only used server-side by this Worker. `API_BEARER_TOKEN` is
shared with server-side `irc-news` calls and must never be exposed in browser
code.

If `API_BEARER_TOKEN` is missing, the code intentionally skips API
authorization. Production should configure it.

Local development uses `.dev.vars`, which must not be committed:

```text
TMDB_TOKEN=...
API_BEARER_TOKEN=...
```

Non-sensitive vars are configured in `wrangler.jsonc`:

```text
DEFAULT_LANGUAGE=it-IT
SUPPORTED_LANGUAGES=it-IT,en-US
DAILY_REFRESH_TIME_ZONE=Europe/Rome
workers_dev=true
preview_urls=true
```

Required bindings:

```text
DAILY_KV
PUBLIC_RATE_LIMITER
API_RATE_LIMITER
```

Configured limits:

- `PUBLIC_RATE_LIMITER`: 30 requests per 60 seconds.
- `API_RATE_LIMITER`: 120 requests per 60 seconds.

These limits run inside the Worker. They do not replace WAF or rate limiting
rules on a Cloudflare zone, but they remain useful as a second layer if a custom
domain is added later.

## Secret Hygiene

This repository is public. Real secret values must exist only in:

- `.dev.vars` for local development.
- Cloudflare Worker secrets.
- `irc-news` server-side environment for `API_BEARER_TOKEN`.

Never commit `.dev.vars`, `.env`, copied tokens, request examples with real
bearer values, or TMDB tokens. If a token is committed publicly, rotate it
immediately with `pnpm exec wrangler secret put`.

## Local Development

Install dependencies:

```sh
pnpm install
```

Create `.dev.vars` from `.dev.vars.example` and set both `TMDB_TOKEN` and
`API_BEARER_TOKEN`.

Start the Worker locally:

```sh
pnpm dev
```

Wrangler prints the actual local URL when it starts.

Useful local URLs:

```text
<WRANGLER_LOCAL_URL>/
<WRANGLER_LOCAL_URL>/lookup?type=movie&title=Dune&year=2024&language=it-IT
<WRANGLER_LOCAL_URL>/translate?type=movie&id=693134&language=en-US
<WRANGLER_LOCAL_URL>/daily?language=it-IT
```

For protected API routes, export or paste the local `API_BEARER_TOKEN` value
before using `curl`:

```sh
curl -H "Authorization: Bearer $API_BEARER_TOKEN" \
  "<WRANGLER_LOCAL_URL>/lookup?type=movie&title=Dune&year=2024&language=it-IT"
```

Batch example:

```sh
curl -X POST "<WRANGLER_LOCAL_URL>/lookup/batch" \
  -H "Authorization: Bearer $API_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"items":[{"type":"movie","title":"Dune","year":2024,"language":"it-IT"}]}'
```

Quality checks:

```sh
pnpm check
pnpm type-check
pnpm test
pnpm test:worker
```

## Deployment Notes

The Worker includes in-code fallback protection:

- `/` is public and rate limited by `PUBLIC_RATE_LIMITER`.
- `/lookup`, `/lookup/batch`, `/translate`, and `/daily` are rate limited by `API_RATE_LIMITER`.
- `/lookup`, `/lookup/batch`, `/translate`, and `/daily` require
  `Authorization: Bearer <API_BEARER_TOKEN>` when the secret is configured.
- `/favicon.svg` and `/favicon.ico` bypass rate limiting and authorization.

In-code authorization still counts as a Worker invocation. Abuse protection that
should avoid Worker credit consumption needs to happen before the Worker, for
example with Cloudflare WAF, Access, or rate limiting rules on a Cloudflare zone.

If a custom domain is added later, protect routes at the Cloudflare edge level:

- Home `/`: public with rate limiting.
- `/lookup`, `/lookup/batch`, and `/translate`: protected or rate-limited depending on how
  `irc-news` calls them.
- `/daily`: diagnostic endpoint, should stay protected.

Deploy:

```sh
pnpm run deploy
```

The Worker is currently deployed to `workers.dev`:

```text
https://media-lookup.gualask-dev.workers.dev
```

## TMDB Attribution

This product uses the TMDB API but is not endorsed or certified by TMDB.
