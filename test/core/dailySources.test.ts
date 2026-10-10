import { describe, expect, it } from 'vitest';
import { buildDailySnapshot, dailySources } from '../../src/core/dailySources';
import type {
  DiscoveredMedia,
  DiscoverQuery,
  MediaProviderPort,
} from '../../src/ports/mediaProvider';

const params = {
  language: 'it-IT',
  now: new Date('2026-06-03T10:00:00.000Z'),
  timeZone: 'Europe/Rome',
};

function media(
  overrides: Partial<DiscoveredMedia> & Pick<DiscoveredMedia, 'remoteId' | 'title'>,
): DiscoveredMedia {
  return {
    type: 'movie',
    provider: 'tmdb',
    overview: '',
    releaseDate: '2026-05-01',
    year: 2026,
    ...overrides,
  };
}

/** Answers each query with the results registered for the first matching predicate. */
function fakeProvider(
  routes: [(query: DiscoverQuery) => boolean, DiscoveredMedia[]][],
): MediaProviderPort & { queries: DiscoverQuery[] } {
  const queries: DiscoverQuery[] = [];
  return {
    queries,
    requestCount: 0,
    lookup: async () => null,
    discover: async (query) => {
      queries.push(query);
      return routes.find(([matches]) => matches(query))?.[1] ?? [];
    },
  };
}

describe('dailySources', () => {
  it('asks for each home section with windows around today in the refresh time zone', () => {
    expect(dailySources(params).map(({ source, query }) => ({ source, query }))).toEqual([
      {
        source: 'movie_home_release_recent',
        query: {
          kind: 'movies',
          release: 'home',
          from: '2026-02-03',
          to: '2026-06-03',
          language: 'it-IT',
          region: 'IT',
        },
      },
      { source: 'movie_trending_recent', query: { kind: 'trending_movies', language: 'it-IT' } },
      {
        source: 'movie_theatrical_recent',
        query: {
          kind: 'movies',
          release: 'theatrical',
          from: '2026-04-19',
          to: '2026-06-03',
          language: 'it-IT',
          region: 'IT',
        },
      },
      {
        source: 'movie_theatrical_upcoming',
        query: {
          kind: 'movies',
          release: 'theatrical',
          from: '2026-06-04',
          to: '2026-07-18',
          language: 'it-IT',
          region: 'IT',
        },
      },
      {
        source: 'tv_premiere_recent',
        query: {
          kind: 'tv',
          language: 'it-IT',
          timeZone: 'Europe/Rome',
          firstAiredFrom: '2026-04-04',
          firstAiredTo: '2026-06-03',
        },
      },
      {
        source: 'tv_recent_episodes',
        query: {
          kind: 'tv',
          language: 'it-IT',
          timeZone: 'Europe/Rome',
          airedFrom: '2026-05-20',
          airedTo: '2026-06-03',
          firstAiredFrom: '2016-06-03',
        },
      },
      {
        source: 'tv_premiere_upcoming',
        query: {
          kind: 'tv',
          language: 'it-IT',
          timeZone: 'Europe/Rome',
          firstAiredFrom: '2026-06-04',
          firstAiredTo: '2026-08-02',
        },
      },
    ]);
  });
});

describe('buildDailySnapshot', () => {
  it('drops re-releases, old trending titles and non Latin titles, and dedupes in order', async () => {
    const isTheatricalRecent = (query: DiscoverQuery) =>
      query.kind === 'movies' && query.release === 'theatrical' && query.to === '2026-06-03';
    const provider = fakeProvider([
      [
        (query) => query.kind === 'trending_movies',
        [
          media({ remoteId: '10', title: 'Matrix', releaseDate: '1999-03-31', year: 1999 }),
          media({ remoteId: '2', title: 'Dune - Parte due' }),
        ],
      ],
      [
        isTheatricalRecent,
        [
          media({ remoteId: '1', title: 'கர' }),
          media({ remoteId: '2', title: 'Dune - Parte due' }),
          media({ remoteId: '9', title: 'Terminator 2', releaseDate: '1991-07-01', year: 1991 }),
          media({ remoteId: '3', title: 'One Battle After Another' }),
        ],
      ],
      [
        (query) => query.kind === 'tv' && query.firstAiredTo === '2026-06-03',
        [media({ type: 'tv', remoteId: '7', title: 'Lanterns' })],
      ],
      [
        (query) => query.kind === 'tv' && query.airedFrom !== undefined,
        [
          media({ type: 'tv', remoteId: '7', title: 'Lanterns' }),
          media({ type: 'tv', remoteId: '4', title: 'The Last of Us', releaseDate: '2023-01-15' }),
        ],
      ],
    ]);

    const snapshot = await buildDailySnapshot(provider, params);

    expect(provider.queries).toHaveLength(7);
    expect(snapshot.generatedAt).toBe('2026-06-03T10:00:00.000Z');
    expect(snapshot.items.map(({ remoteId, source }) => `${source}:${remoteId}`)).toEqual([
      'movie_trending_recent:2',
      'movie_theatrical_recent:3',
      'tv_premiere_recent:7',
      'tv_recent_episodes:4',
    ]);
    expect(snapshot.items[0]).not.toHaveProperty('releaseDate');
  });

  it('keeps at most 20 new titles per section', async () => {
    const provider = fakeProvider([
      [
        (query) => query.kind === 'trending_movies',
        Array.from({ length: 25 }, (_, index) =>
          media({ remoteId: `${index}`, title: `Film ${index}` }),
        ),
      ],
    ]);

    const snapshot = await buildDailySnapshot(provider, params);

    expect(snapshot.items).toHaveLength(20);
  });
});
