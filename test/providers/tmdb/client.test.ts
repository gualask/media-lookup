import { describe, expect, it } from 'vitest';
import { ProviderConfigurationError } from '../../../src/core/errors';
import { TmdbHttpClient } from '../../../src/providers/tmdb/client';

function stubFetch(responses: Response[]) {
  const urls: URL[] = [];
  const fetchFn = async (input: RequestInfo | URL) => {
    urls.push(new URL(input.toString()));
    return responses.shift() ?? new Response('{}');
  };
  return { urls, fetchFn: fetchFn as typeof fetch };
}

function recordingSleep() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
}

describe('TmdbHttpClient', () => {
  it('sends query parameters and counts requests', async () => {
    const { urls, fetchFn } = stubFetch([new Response('{"results":[]}')]);
    const client = new TmdbHttpClient('token', fetchFn);

    await expect(client.get('/search/tv', { query: 'Breaking Bad' })).resolves.toEqual({
      results: [],
    });
    expect(urls[0]?.toString()).toBe('https://api.themoviedb.org/3/search/tv?query=Breaking+Bad');
    expect(client.requestCount).toBe(1);
  });

  it('waits as told and retries once after a 429', async () => {
    const { fetchFn } = stubFetch([
      new Response('', { status: 429, headers: { 'Retry-After': '2' } }),
      new Response('{"ok":true}'),
    ]);
    const { waits, sleep } = recordingSleep();
    const client = new TmdbHttpClient('token', fetchFn, sleep);

    await expect(client.get('/trending/movie/day', {})).resolves.toEqual({ ok: true });
    expect(waits).toEqual([2000]);
    expect(client.requestCount).toBe(2);
  });

  it('waits one second when Retry-After is missing, and at most three', async () => {
    const { fetchFn } = stubFetch([
      new Response('', { status: 429 }),
      new Response('', { status: 429 }),
      new Response('', { status: 429, headers: { 'Retry-After': '60' } }),
      new Response('', { status: 429 }),
    ]);
    const { waits, sleep } = recordingSleep();
    const client = new TmdbHttpClient('token', fetchFn, sleep);

    await expect(client.get('/a', {})).rejects.toMatchObject({ status: 429 });
    await expect(client.get('/b', {})).rejects.toMatchObject({ status: 429 });
    expect(waits).toEqual([1000, 3000]);
  });

  it('refuses to call TMDB without a token', async () => {
    const { urls, fetchFn } = stubFetch([]);
    const client = new TmdbHttpClient('', fetchFn);

    await expect(client.get('/a', {})).rejects.toBeInstanceOf(ProviderConfigurationError);
    expect(urls).toHaveLength(0);
  });
});
