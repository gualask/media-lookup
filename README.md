# media-lookup

`media-lookup` is a Cloudflare Worker that provides movie and TV metadata without exposing the TMDB token to client applications.

It is currently built for `irc-news`, but the HTTP contract is intentionally small and generic.

## Features

- TMDB movie and TV lookup by title, type, year, and language.
- KV-backed lookup cache with 30 day TTL.
- Lazy daily home snapshot used to warm the lookup cache.
- Minimal HTML home page grouped by temporal source: recent/trending movie releases, home releases, upcoming theatrical movies, and scripted TV episodes.
- Direct TMDB image CDN usage for posters. The Worker does not proxy poster bytes.
- Lazy English overview fallback for items whose localized overview is empty.
- Console-based structured metrics events, ready to be replaced by Analytics Engine later.

## Stack

- Cloudflare Workers, Module Worker mode.
- TypeScript strict.
- `pnpm`.
- Biome for format/lint.
- Vitest for core tests.
- `@cloudflare/vitest-pool-workers` for Worker runtime tests.
- Cloudflare KV for daily snapshots, lookup cache, and overview fallback cache.

## HTTP Contract

### Home

```http
GET /
```

Serves the HTML preview page.

The home page also performs the lazy daily refresh for the default language. If the daily snapshot for the current day already exists, it is served from KV without calling TMDB.

The current daily sources are temporal and intentionally avoid generic `popular` lists:

- Film recenti streaming e home video: `/discover/movie`, `release_date.gte=today-120`, `release_date.lte=today`, `with_release_type=4|5`, `watch_region=<region>`, `with_watch_monetization_types=flatrate|rent|buy`.
- Film in tendenza recenti: `/trending/movie/day`, then local release-date filtering from `today-180` to `today+365`.
- Film recenti al cinema: `/discover/movie`, `release_date.gte=today-45`, `release_date.lte=today`, `with_release_type=2|3`.
- Film in arrivo al cinema: `/discover/movie`, `release_date.gte=today+1`, `release_date.lte=today+45`, `with_release_type=2|3`.
- Serie con episodi recenti: `/discover/tv`, `air_date.gte=today-14`, `air_date.lte=today`, `with_type=4`.
- Serie con episodi in arrivo: `/discover/tv`, `air_date.gte=today+1`, `air_date.lte=today+14`, `with_type=4`.

Movie discovery uses the region inferred from the language tag, for example `it-IT` -> `IT`.

Movie dedupe keeps the first matching source in this priority order: streaming/home video, trending recent, recent theatrical, upcoming theatrical.

TV discovery uses `air_date`, not `first_air_date`, so a long-running series is included when it has recent or upcoming episodes. It also uses `with_type=4` to keep scripted shows and avoid talk shows, news, and reality-style daily programs.

Daily snapshot items whose localized title contains no Latin letters are excluded from the home/warmup flow.

### Lookup

```http
GET /lookup?type=movie&title=Dune&year=2024&language=it-IT
GET /lookup?type=tv&title=Breaking%20Bad&year=2008&language=it-IT
```

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

Not found:

```http
404
```

Supported languages are configured through `SUPPORTED_LANGUAGES`. Missing `language` falls back to `DEFAULT_LANGUAGE`.

### English Overview Fallback

```http
GET /translate?type=movie&id=693134&language=en-US
GET /translate?type=tv&id=1399&language=en-US
```

This endpoint is intentionally lazy. Clients should call it only after explicit user action when the localized `overview` is empty.

It does not perform machine translation. It asks TMDB for the media detail in the requested language, normally `en-US`.

Response:

```json
{
  "overview": "English overview from TMDB.",
  "language": "en-US"
}
```

Not found:

```http
404
```

The home page uses this endpoint behind the `Recupera trama EN` button.

When a fallback is already cached, the home page hydrates empty overviews from `overview_fallback` while rendering. The browser also stores successful click results in `localStorage`, so an immediate refresh keeps showing the recovered English overview even before KV propagation catches up.

### Daily Snapshot Diagnostic

```http
GET /daily?language=it-IT
```

Returns the currently stored daily snapshot. This endpoint is read-only: it does not generate a snapshot by itself.

If no snapshot exists:

```http
404
```

## Poster Handling

The Worker returns only `posterPath`. Clients should build TMDB image CDN URLs directly:

```text
https://image.tmdb.org/t/p/w185/<posterPath-without-leading-slash>
```

Recommended sizes:

- `w185` for lists and compact cards.
- `w342` or `w500` only for larger views.
- Avoid `original` by default.

If `irc-news` wants local filesystem caching, it should cache the final CDN size it actually displays.

## Cache

All application cache lives in Cloudflare KV through the `DAILY_KV` binding.

Lookup metadata:

```text
lookup:v1:<language>:<type>:<normalized-title>:<year-or-none>
```

Title normalization is shared by runtime lookup and daily warmup:

- lowercase
- accents removed
- repeated whitespace collapsed
- punctuation treated as separators

Example: `Dune - Parte due` and `Dune Parte Due` produce the same title key.

Daily snapshot:

```text
daily:v4:<language>
```

English overview fallback:

```text
overview_fallback:v1:<language>:<type>:<remoteId>
```

TTL:

- lookup metadata: 30 days
- overview fallback success: 30 days
- overview fallback not found: 1 day
- daily snapshot: one current snapshot per language, refreshed lazily by date

## irc-news Integration

Use lookup first:

```text
<WORKER_URL>/lookup?type=movie|tv&title=<title>&language=<language>&year=<optional>
```

Protected API routes require:

```http
Authorization: Bearer <API_BEARER_TOKEN>
```

Use the returned `posterPath` to build a direct TMDB CDN image URL.

If `overview` is empty, show a user-triggered action and call:

```text
<WORKER_URL>/translate?type=<movie|tv>&id=<remoteId>&language=en-US
```

Do not prefetch English fallbacks for every item. The endpoint is designed for explicit clicks so we do not waste TMDB calls on titles the user never opens.

## Configuration

Cloudflare secret:

```text
TMDB_TOKEN
API_BEARER_TOKEN
```

Set them with:

```sh
wrangler secret put TMDB_TOKEN
wrangler secret put API_BEARER_TOKEN
```

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
```

Required binding:

```text
DAILY_KV
PUBLIC_RATE_LIMITER
API_RATE_LIMITER
```

`PUBLIC_RATE_LIMITER` protects the public home page with a small per-IP fallback limit. `API_RATE_LIMITER` protects `/lookup`, `/translate`, and `/daily`. These limits run inside the Worker, so they do not replace WAF/rate limiting rules on a Cloudflare zone, but they remain useful as a second layer even when a custom domain is added later.

## Local Development

Install dependencies:

```sh
pnpm install
```

Create `.dev.vars` from `.dev.vars.example` and set `TMDB_TOKEN`.

Start the Worker locally:

```sh
pnpm dev -- --port 8787
```

Useful local URLs:

```text
http://127.0.0.1:8787/
http://127.0.0.1:8787/lookup?type=movie&title=Dune&year=2024&language=it-IT
http://127.0.0.1:8787/translate?type=movie&id=693134&language=en-US
http://127.0.0.1:8787/daily?language=it-IT
```

For protected API routes:

```sh
curl -H "Authorization: Bearer $API_BEARER_TOKEN" \
  "http://127.0.0.1:8787/lookup?type=movie&title=Dune&year=2024&language=it-IT"
```

Quality checks:

```sh
pnpm lint
pnpm type-check
pnpm test
pnpm test:worker
```

## Deployment Notes

The Worker includes in-code fallback protection:

- `/` is public and rate limited by `PUBLIC_RATE_LIMITER`.
- `/lookup`, `/translate`, and `/daily` are rate limited by `API_RATE_LIMITER`.
- `/lookup`, `/translate`, and `/daily` require `Authorization: Bearer <API_BEARER_TOKEN>` when the secret is configured.

If a custom domain is added later, still protect routes at the Cloudflare edge level:

- Home `/`: public with rate limiting.
- Lookup and `/translate`: protected or rate-limited depending on how `irc-news` calls them.
- `/daily`: diagnostic endpoint, should be protected.

Lookup uses the dedicated `/lookup` route so Cloudflare edge policies can distinguish it from the public home page with simple path-based rules.

In-code authorization still counts as a Worker invocation. Abuse protection that should avoid Worker credit consumption needs to happen before the Worker, for example with Cloudflare WAF, Access, or rate limiting rules.

## TMDB Attribution

This product uses the TMDB API but is not endorsed or certified by TMDB.
