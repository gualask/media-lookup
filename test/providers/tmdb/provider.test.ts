import { describe, expect, it } from 'vitest';
import type { DiscoverQuery } from '../../../src/ports/mediaProvider';
import { TmdbHttpClient } from '../../../src/providers/tmdb/client';
import { TmdbMediaProvider } from '../../../src/providers/tmdb/provider';

function providerReturning(results: unknown[]) {
  const urls: URL[] = [];
  const fetchFn = async (input: RequestInfo | URL) => {
    urls.push(new URL(input.toString()));
    return new Response(JSON.stringify({ results }));
  };
  return {
    urls,
    provider: new TmdbMediaProvider(new TmdbHttpClient('token', fetchFn as typeof fetch)),
  };
}

describe('TmdbMediaProvider lookup', () => {
  it('searches movies by any release year and prefers the exact title', async () => {
    const { urls, provider } = providerReturning([
      { id: 1, title: 'El indefinido. La crítica de La la land', release_date: '2017-02-01' },
      { id: 313369, title: 'La La Land', release_date: '2016-12-01' },
    ]);

    const metadata = await provider.lookup({
      type: 'movie',
      title: 'La La Land',
      year: 2017,
      language: 'it-IT',
    });

    expect(urls[0]?.pathname).toBe('/3/search/movie');
    expect(urls[0]?.searchParams.get('year')).toBe('2017');
    expect(urls[0]?.searchParams.has('primary_release_year')).toBe(false);
    expect(metadata).toEqual({
      type: 'movie',
      provider: 'tmdb',
      remoteId: '313369',
      title: 'La La Land',
      year: 2016,
      overview: '',
      posterPath: undefined,
      match: 'year',
    });
  });

  it('searches series by any air date year', async () => {
    const { urls, provider } = providerReturning([
      { id: 1396, name: 'Breaking Bad', first_air_date: '2008-01-20' },
    ]);

    await expect(
      provider.lookup({ type: 'tv', title: 'Breaking Bad', year: 2012, language: 'it-IT' }),
    ).resolves.toMatchObject({ remoteId: '1396', year: 2008, match: 'year' });
    expect(urls[0]?.pathname).toBe('/3/search/tv');
    expect(urls[0]?.searchParams.get('year')).toBe('2012');
  });

  it('marks a title-only match as certain when exactly one result has the title', async () => {
    const { provider } = providerReturning([
      { id: 693134, title: 'Dune - Parte due', release_date: '2024-02-27' },
      { id: 438631, title: 'Dune', release_date: '2021-09-15' },
    ]);

    await expect(
      provider.lookup({ type: 'movie', title: 'dune', language: 'it-IT' }),
    ).resolves.toMatchObject({ remoteId: '438631', match: 'title' });
  });

  it('matches the original title as well as the localized one', async () => {
    const { provider } = providerReturning([
      {
        id: 8587,
        title: 'Il re leone',
        original_title: 'The Lion King',
        release_date: '1994-06-23',
      },
    ]);

    await expect(
      provider.lookup({ type: 'movie', title: 'The Lion King', language: 'it-IT' }),
    ).resolves.toMatchObject({ remoteId: '8587', match: 'title' });
  });

  it('marks a title-only match as uncertain when several or no results share the title', async () => {
    const homonyms = providerReturning([
      { id: 2316, name: 'The Office', first_air_date: '2005-03-24' },
      { id: 2996, name: 'The Office', first_air_date: '2001-07-09' },
    ]);
    const noExactTitle = providerReturning([
      { id: 693134, title: 'Dune - Parte due', release_date: '2024-02-27' },
    ]);

    await expect(
      homonyms.provider.lookup({ type: 'tv', title: 'The Office', language: 'it-IT' }),
    ).resolves.toMatchObject({ remoteId: '2316', match: 'uncertain' });
    await expect(
      noExactTitle.provider.lookup({ type: 'movie', title: 'Dune', language: 'it-IT' }),
    ).resolves.toMatchObject({ remoteId: '693134', match: 'uncertain' });
  });

  it('skips results without an id or title', async () => {
    const { provider } = providerReturning([
      { title: 'No id' },
      { id: 438631, title: 'Dune', release_date: '2021-09-15' },
    ]);

    await expect(
      provider.lookup({ type: 'movie', title: 'Dune', language: 'it-IT' }),
    ).resolves.toMatchObject({ remoteId: '438631' });
  });
});

describe('TmdbMediaProvider discover', () => {
  async function paramsFor(query: DiscoverQuery) {
    const { urls, provider } = providerReturning([
      {
        id: 7,
        name: 'Lanterns',
        title: 'Lanterns',
        first_air_date: '2026-05-10',
        release_date: '2026-05-10',
      },
    ]);
    const results = await provider.discover(query);
    const url = urls[0];
    return { path: url?.pathname, params: Object.fromEntries(url?.searchParams ?? []), results };
  }

  it('translates movie queries for theatrical and home releases', async () => {
    const theatrical = await paramsFor({
      kind: 'movies',
      release: 'theatrical',
      from: '2026-04-19',
      to: '2026-06-03',
      language: 'it-IT',
      region: 'IT',
    });
    const home = await paramsFor({
      kind: 'movies',
      release: 'home',
      from: '2026-02-03',
      to: '2026-06-03',
      language: 'it-IT',
      region: 'IT',
    });

    expect(theatrical).toMatchObject({
      path: '/3/discover/movie',
      params: {
        language: 'it-IT',
        region: 'IT',
        sort_by: 'popularity.desc',
        with_release_type: '2|3',
        'release_date.gte': '2026-04-19',
        'release_date.lte': '2026-06-03',
      },
    });
    expect(theatrical.params).not.toHaveProperty('watch_region');
    expect(home.params).toMatchObject({
      with_release_type: '4|5',
      watch_region: 'IT',
      with_watch_monetization_types: 'flatrate|rent|buy',
    });
    expect(home.results[0]).toMatchObject({ type: 'movie', releaseDate: '2026-05-10' });
  });

  it('translates fiction series queries', async () => {
    const tv = await paramsFor({
      kind: 'tv',
      language: 'it-IT',
      timeZone: 'Europe/Rome',
      airedFrom: '2026-05-20',
      airedTo: '2026-06-03',
      firstAiredFrom: '2016-06-03',
    });

    expect(tv).toMatchObject({
      path: '/3/discover/tv',
      params: {
        timezone: 'Europe/Rome',
        with_type: '2|4',
        without_genres: '10766',
        'air_date.gte': '2026-05-20',
        'air_date.lte': '2026-06-03',
        'first_air_date.gte': '2016-06-03',
      },
    });
    expect(tv.params).not.toHaveProperty('first_air_date.lte');
    expect(tv.results[0]).toMatchObject({ type: 'tv', title: 'Lanterns', year: 2026 });
  });

  it('asks for the daily trending movies', async () => {
    const trending = await paramsFor({ kind: 'trending_movies', language: 'it-IT' });

    expect(trending).toMatchObject({
      path: '/3/trending/movie/day',
      params: { language: 'it-IT', page: '1' },
    });
  });
});
