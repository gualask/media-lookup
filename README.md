# media-lookup

`media-lookup` is a small media lookup service for movie and TV metadata.

It is designed to let apps fetch titles, release years, overviews, and posters without shipping a TMDB token inside the client application.

## What It Provides

- Movie and TV metadata lookup.
- Poster proxying and caching.
- A daily snapshot of useful titles.
- A minimal poster/title preview page.
- Lightweight traffic and cache observability.

## Why It Exists

Desktop and client-side apps should not embed third-party API tokens. `media-lookup` keeps provider credentials on the server side and exposes a small HTTPS API that clients can call safely.

The first provider target is TMDB, and the first deployment target is Cloudflare Workers. The project is intentionally named and structured so it can support other providers or deployment platforms later.

## Status

Planning stage. The technical direction and API contract are documented, but the Worker implementation has not been scaffolded yet.

## Documentation

- [Project plan](docs/project.md)

## TMDB Attribution

This product uses the TMDB API but is not endorsed or certified by TMDB.
