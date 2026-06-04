import { describe, expect, it } from 'vitest';
import { TmdbMediaProvider } from '../../src/core/tmdbClient';

describe('TmdbMediaProvider daily snapshot', () => {
  it('adds item sources and filters titles without latin letters', async () => {
    const fetchFn = async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());

      if (url.pathname === '/3/trending/movie/day') {
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
              release_date: '2024-03-01',
              overview: 'Trama completa.',
              poster_path: '/dune.jpg',
            },
          ],
        });
      }

      if (url.pathname === '/3/movie/popular') {
        return jsonResponse({
          results: [
            {
              id: 3,
              title: 'One Piece',
              release_date: '2026-01-01',
              overview: 'Avventura.',
              poster_path: '/one-piece.jpg',
            },
          ],
        });
      }

      return jsonResponse({ results: [] });
    };
    const provider = new TmdbMediaProvider('token', fetchFn as typeof fetch);

    const snapshot = await provider.buildDailySnapshot({
      language: 'it-IT',
      now: new Date('2026-06-03T00:00:00.000Z'),
    });

    expect(snapshot.items).toEqual([
      expect.objectContaining({
        remoteId: '2',
        title: 'Dune - Parte due',
        source: 'trending',
      }),
      expect.objectContaining({
        remoteId: '3',
        title: 'One Piece',
        source: 'popular',
      }),
    ]);
    expect(snapshot.items.some((item) => item.title === 'கர')).toBe(false);
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
