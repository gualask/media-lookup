import { describe, expect, it } from 'vitest';
import { TmdbMediaProvider } from '../../src/core/tmdbClient';

describe('TmdbMediaProvider daily snapshot', () => {
  it('builds temporal item sources and filters titles without latin letters', async () => {
    const requestedUrls: URL[] = [];
    const fetchFn = async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      requestedUrls.push(url);

      if (url.pathname === '/3/trending/movie/day') {
        return jsonResponse({
          results: [
            {
              id: 10,
              title: 'Matrix',
              release_date: '1999-03-31',
              overview: 'Old trending title.',
              poster_path: '/matrix.jpg',
            },
            {
              id: 6,
              title: 'Hail Mary',
              release_date: '2026-03-20',
              overview: 'Recent trending title.',
              poster_path: '/hail-mary.jpg',
            },
          ],
        });
      }

      if (
        url.pathname === '/3/discover/movie' &&
        url.searchParams.get('release_date.gte') === '2026-04-19' &&
        url.searchParams.get('release_date.lte') === '2026-06-03'
      ) {
        return jsonResponse({
          results: [
            {
              id: 1,
              title: 'கர',
              release_date: '2026-01-01',
              overview: 'Non latin title',
              poster_path: '/nonlatin.jpg',
            },
            {
              id: 2,
              title: 'Dune - Parte due',
              release_date: '2026-05-01',
              overview: 'Trama completa.',
              poster_path: '/dune.jpg',
            },
            {
              id: 9,
              title: 'Terminator 2 - Il giorno del giudizio',
              release_date: '1991-07-01',
              overview: 'Riedizione in sala.',
              poster_path: '/t2.jpg',
            },
          ],
        });
      }

      if (
        url.pathname === '/3/discover/movie' &&
        url.searchParams.get('release_date.gte') === '2026-06-04' &&
        url.searchParams.get('release_date.lte') === '2026-07-18'
      ) {
        return jsonResponse({
          results: [
            {
              id: 3,
              title: 'One Battle After Another',
              release_date: '2026-07-01',
              overview: 'Film in arrivo.',
              poster_path: '/one-battle.jpg',
            },
          ],
        });
      }

      if (
        url.pathname === '/3/discover/movie' &&
        url.searchParams.get('release_date.gte') === '2026-02-03' &&
        url.searchParams.get('release_date.lte') === '2026-06-03'
      ) {
        return jsonResponse({
          results: [
            {
              id: 6,
              title: 'Hail Mary',
              release_date: '2026-04-15',
              overview: 'Uscita digitale recente.',
              poster_path: '/streaming.jpg',
            },
          ],
        });
      }

      if (
        url.pathname === '/3/discover/tv' &&
        url.searchParams.get('first_air_date.gte') === '2026-04-04' &&
        url.searchParams.get('first_air_date.lte') === '2026-06-03'
      ) {
        return jsonResponse({
          results: [
            {
              id: 7,
              name: 'Lanterns',
              first_air_date: '2026-05-10',
              overview: 'Serie appena iniziata.',
              poster_path: '/lanterns.jpg',
            },
          ],
        });
      }

      if (
        url.pathname === '/3/discover/tv' &&
        url.searchParams.get('air_date.gte') === '2026-05-20' &&
        url.searchParams.get('air_date.lte') === '2026-06-03' &&
        url.searchParams.get('first_air_date.gte') === '2016-06-03'
      ) {
        return jsonResponse({
          results: [
            {
              id: 7,
              name: 'Lanterns',
              first_air_date: '2026-05-10',
              overview: 'Gia tra le serie nuove.',
              poster_path: '/lanterns.jpg',
            },
            {
              id: 4,
              name: 'The Last of Us',
              first_air_date: '2023-01-15',
              overview: 'Serie gia iniziata, nuovo episodio recente.',
              poster_path: '/last-of-us.jpg',
            },
          ],
        });
      }

      if (
        url.pathname === '/3/discover/tv' &&
        url.searchParams.get('first_air_date.gte') === '2026-06-04' &&
        url.searchParams.get('first_air_date.lte') === '2026-08-02'
      ) {
        return jsonResponse({
          results: [
            {
              id: 8,
              name: 'Blade Runner 2099',
              first_air_date: '2026-07-01',
              overview: 'Serie in arrivo.',
              poster_path: '/blade-runner.jpg',
            },
          ],
        });
      }

      return jsonResponse({ results: [] });
    };
    const provider = new TmdbMediaProvider('token', fetchFn as typeof fetch);

    const snapshot = await provider.buildDailySnapshot({
      language: 'it-IT',
      now: new Date('2026-06-03T10:00:00.000Z'),
      timeZone: 'Europe/Rome',
    });

    expect(snapshot.items).toEqual([
      expect.objectContaining({
        remoteId: '6',
        title: 'Hail Mary',
        source: 'movie_home_release_recent',
      }),
      expect.objectContaining({
        remoteId: '2',
        title: 'Dune - Parte due',
        source: 'movie_theatrical_recent',
      }),
      expect.objectContaining({
        remoteId: '3',
        title: 'One Battle After Another',
        source: 'movie_theatrical_upcoming',
      }),
      expect.objectContaining({
        remoteId: '7',
        title: 'Lanterns',
        source: 'tv_premiere_recent',
      }),
      expect.objectContaining({
        remoteId: '4',
        title: 'The Last of Us',
        year: 2023,
        source: 'tv_recent_episodes',
      }),
      expect.objectContaining({
        remoteId: '8',
        title: 'Blade Runner 2099',
        source: 'tv_premiere_upcoming',
      }),
    ]);
    expect(snapshot.items.some((item) => item.title.startsWith('Terminator'))).toBe(false);
    expect(snapshot.items.some((item) => item.title === 'கர')).toBe(false);
    expect(snapshot.items.some((item) => item.title === 'Matrix')).toBe(false);
    expect(snapshot.items.filter((item) => item.title === 'Hail Mary')).toHaveLength(1);
    expect(requestedUrls).toHaveLength(7);
    expect(requestedUrls.every((url) => url.searchParams.get('language') === 'it-IT')).toBe(true);
    expect(
      requestedUrls
        .find((url) => url.pathname === '/3/trending/movie/day')
        ?.searchParams.get('page'),
    ).toBe('1');
    expect(
      requestedUrls
        .filter((url) => url.pathname === '/3/discover/movie')
        .every(
          (url) =>
            url.searchParams.get('region') === 'IT' &&
            url.searchParams.get('sort_by') === 'popularity.desc',
        ),
    ).toBe(true);
    expect(
      requestedUrls
        .filter((url) => url.pathname === '/3/discover/tv')
        .every(
          (url) =>
            url.searchParams.get('timezone') === 'Europe/Rome' &&
            url.searchParams.get('with_type') === '2|4' &&
            url.searchParams.get('without_genres') === '10766',
        ),
    ).toBe(true);
    expect(
      requestedUrls
        .filter((url) => url.pathname === '/3/discover/movie')
        .map((url) => url.searchParams.get('with_release_type')),
    ).toEqual(['2|3', '4|5', '2|3']);
    expect(
      requestedUrls
        .filter((url) => url.pathname === '/3/discover/movie')
        .map((url) => url.searchParams.get('watch_region')),
    ).toEqual([null, 'IT', null]);
    expect(
      requestedUrls
        .filter((url) => url.pathname === '/3/discover/movie')
        .map((url) => url.searchParams.get('with_watch_monetization_types')),
    ).toEqual([null, 'flatrate|rent|buy', null]);
  });
});

describe('TmdbMediaProvider lookup', () => {
  it('searches tv by any air date year, not only the first air date', async () => {
    const requestedUrls: URL[] = [];
    const fetchFn = async (input: RequestInfo | URL) => {
      requestedUrls.push(new URL(input.toString()));

      return jsonResponse({
        results: [{ id: 1396, name: 'Breaking Bad', first_air_date: '2008-01-20' }],
      });
    };
    const provider = new TmdbMediaProvider('token', fetchFn as typeof fetch);

    const metadata = await provider.lookup({
      type: 'tv',
      title: 'Breaking Bad',
      year: 2012,
      language: 'it-IT',
    });

    expect(requestedUrls[0]?.pathname).toBe('/3/search/tv');
    expect(requestedUrls[0]?.searchParams.get('year')).toBe('2012');
    expect(requestedUrls[0]?.searchParams.has('first_air_date_year')).toBe(false);
    expect(metadata).toMatchObject({ remoteId: '1396', year: 2008, match: 'year' });
  });

  it('marks a title-only match as certain when no other result shares the title', async () => {
    const provider = searchProvider([
      { id: 1396, name: 'Breaking Bad', first_air_date: '2008-01-20' },
      { id: 2000, name: 'Breaking Bad: The Movie', first_air_date: '2019-10-11' },
    ]);

    await expect(
      provider.lookup({ type: 'tv', title: 'breaking  bad', language: 'it-IT' }),
    ).resolves.toMatchObject({ remoteId: '1396', match: 'title' });
  });

  it('matches the original title as well as the localized one', async () => {
    const provider = searchProvider([
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

  it('marks a title-only match as uncertain when several results share the title', async () => {
    const provider = searchProvider([
      { id: 2316, name: 'The Office', first_air_date: '2005-03-24' },
      { id: 2996, name: 'The Office', first_air_date: '2001-07-09' },
    ]);

    await expect(
      provider.lookup({ type: 'tv', title: 'The Office', language: 'it-IT' }),
    ).resolves.toMatchObject({ remoteId: '2316', match: 'uncertain' });
  });

  it('prefers the only exact title over a more relevant result with another title', async () => {
    const provider = searchProvider([
      { id: 693134, title: 'Dune - Parte due', release_date: '2024-02-27' },
      { id: 438631, title: 'Dune', release_date: '2021-09-15' },
    ]);

    await expect(
      provider.lookup({ type: 'movie', title: 'Dune', language: 'it-IT' }),
    ).resolves.toMatchObject({ remoteId: '438631', match: 'title' });
  });

  it('keeps a title-only match uncertain when the results have no exact title', async () => {
    const provider = searchProvider([
      { id: 693134, title: 'Dune - Parte due', release_date: '2024-02-27' },
    ]);

    await expect(
      provider.lookup({ type: 'movie', title: 'Dune', language: 'it-IT' }),
    ).resolves.toMatchObject({ remoteId: '693134', match: 'uncertain' });
  });

  it('searches movies by any release year and prefers the exact title', async () => {
    const requestedUrls: URL[] = [];
    const fetchFn = async (input: RequestInfo | URL) => {
      requestedUrls.push(new URL(input.toString()));
      return jsonResponse({
        results: [
          { id: 1, title: 'El indefinido. La crítica de La la land', release_date: '2017-02-01' },
          { id: 313369, title: 'La La Land', release_date: '2016-12-01' },
        ],
      });
    };
    const provider = new TmdbMediaProvider('token', fetchFn as typeof fetch);

    const metadata = await provider.lookup({
      type: 'movie',
      title: 'La La Land',
      year: 2017,
      language: 'it-IT',
    });

    expect(requestedUrls[0]?.searchParams.get('year')).toBe('2017');
    expect(requestedUrls[0]?.searchParams.has('primary_release_year')).toBe(false);
    expect(metadata).toMatchObject({ remoteId: '313369', year: 2016, match: 'year' });
  });
});

function searchProvider(results: unknown[]): TmdbMediaProvider {
  const fetchFn = async () => jsonResponse({ results });
  return new TmdbMediaProvider('token', fetchFn as typeof fetch);
}

describe('TmdbMediaProvider rate limiting', () => {
  it('waits as told and retries once after a 429', async () => {
    const waits: number[] = [];
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      return calls === 1
        ? new Response('', { status: 429, headers: { 'Retry-After': '2' } })
        : jsonResponse({ results: [{ id: 1396, name: 'Breaking Bad' }] });
    };
    const provider = new TmdbMediaProvider('token', fetchFn as typeof fetch, async (ms) => {
      waits.push(ms);
    });

    await expect(
      provider.lookup({ type: 'tv', title: 'Breaking Bad', language: 'it-IT' }),
    ).resolves.toMatchObject({ remoteId: '1396' });
    expect(calls).toBe(2);
    expect(waits).toEqual([2000]);
  });

  it('fails after a second 429 and caps the wait', async () => {
    const waits: number[] = [];
    const fetchFn = async () => new Response('', { status: 429, headers: { 'Retry-After': '60' } });
    const provider = new TmdbMediaProvider('token', fetchFn as typeof fetch, async (ms) => {
      waits.push(ms);
    });

    await expect(
      provider.lookup({ type: 'tv', title: 'Breaking Bad', language: 'it-IT' }),
    ).rejects.toMatchObject({ status: 429 });
    expect(waits).toEqual([3000]);
  });
});

describe('TmdbMediaProvider overview fallback', () => {
  it('fetches a non empty overview for the requested language', async () => {
    const fetchFn = async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());

      expect(url.pathname).toBe('/3/movie/693134');
      expect(url.searchParams.get('language')).toBe('en-US');

      return jsonResponse({
        overview: 'English overview.',
      });
    };
    const provider = new TmdbMediaProvider('token', fetchFn as typeof fetch);

    const translation = await provider.findOverviewTranslation({
      type: 'movie',
      remoteId: '693134',
      language: 'en-US',
    });

    expect(translation).toEqual({
      overview: 'English overview.',
      language: 'en-US',
    });
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}
