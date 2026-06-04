import { describe, expect, it } from 'vitest';
import { lookupCacheKey, overviewFallbackCacheKey } from '../../src/core/cacheKeys';
import { dailySnapshotKey } from '../../src/core/dailySnapshot';
import { handleRequest } from '../../src/core/handleRequest';
import {
  createTestDeps,
  FakeMediaProvider,
  MemoryLookupCachePort,
  MemoryMetricsPort,
  MemoryStoragePort,
} from './helpers';

describe('handleRequest', () => {
  it('serves the root HTML page', async () => {
    const response = await handleRequest(new Request('https://example.com/'), createTestDeps());

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('media-lookup');
    expect(html).toContain('https://image.tmdb.org/t/p/w185/abc123.jpg');
    expect(html).toContain(
      'https://www.youtube.com/results?search_query=Dune%20-%20Parte%20due%202024%20trailer%20italiano',
    );
    expect(html).not.toContain('posterPath=');
  });

  it('renders a lazy overview recovery button when the overview is missing', async () => {
    const provider = new FakeMediaProvider();
    provider.lookupResult = {
      type: 'movie',
      provider: 'tmdb',
      remoteId: '693134',
      title: 'Dune - Parte due',
      year: 2024,
      overview: '',
      posterPath: '/abc123.jpg',
    };

    const response = await handleRequest(
      new Request('https://example.com/'),
      createTestDeps({ provider }),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('data-overview-button');
    expect(html).toContain('data-type="movie"');
    expect(html).toContain('data-id="693134"');
    expect(html).toContain('data-language="en-US"');
    expect(html).toContain('Recupera trama EN');
  });

  it('returns lookup metadata and caches the response', async () => {
    const provider = new FakeMediaProvider();
    const lookupCache = new MemoryLookupCachePort();
    const deps = createTestDeps({ lookupCache, provider });
    const url = 'https://example.com/?type=movie&title=Dune&year=2024&language=it-IT';

    const first = await handleRequest(new Request(url), deps);
    const second = await handleRequest(new Request(url), deps);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(provider.lookupCalls).toBe(1);
    expect(
      lookupCache.entries.has(
        lookupCacheKey({
          type: 'movie',
          title: 'Dune',
          year: 2024,
          language: 'it-IT',
        }),
      ),
    ).toBe(true);
    await expect(first.json()).resolves.toMatchObject({
      provider: 'tmdb',
      remoteId: '693134',
      posterPath: '/abc123.jpg',
    });
  });

  it('returns 404 when metadata is not found', async () => {
    const provider = new FakeMediaProvider();
    provider.lookupResult = null;
    const response = await handleRequest(
      new Request('https://example.com/?type=movie&title=Missing&language=it-IT'),
      createTestDeps({ provider }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'not_found' },
    });
  });

  it('returns an english overview fallback from TMDB and caches it', async () => {
    const provider = new FakeMediaProvider();
    const storage = new MemoryStoragePort();
    const deps = createTestDeps({ provider, storage });
    const url = 'https://example.com/translate?type=movie&id=693134&language=en-US';

    const first = await handleRequest(new Request(url), deps);
    const second = await handleRequest(new Request(url), deps);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(provider.translationCalls).toBe(1);
    await expect(first.json()).resolves.toEqual({
      overview: 'English overview recovered from TMDB',
      language: 'en-US',
    });
    await expect(
      storage.getText(
        overviewFallbackCacheKey({
          type: 'movie',
          remoteId: '693134',
          language: 'en-US',
        }),
      ),
    ).resolves.toContain('"status":"found"');
  });

  it('returns 404 when english overview fallback is not found', async () => {
    const provider = new FakeMediaProvider();
    provider.translationResult = null;
    const response = await handleRequest(
      new Request('https://example.com/translate?type=movie&id=693134&language=en-US'),
      createTestDeps({ provider }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'not_found' },
    });
  });

  it('returns 404 when the daily snapshot is missing', async () => {
    const response = await handleRequest(
      new Request('https://example.com/daily?language=it-IT'),
      createTestDeps(),
    );

    expect(response.status).toBe(404);
  });

  it('serves the daily snapshot from storage', async () => {
    const storage = new MemoryStoragePort();
    await storage.putText(
      dailySnapshotKey('it-IT'),
      JSON.stringify({
        generatedAt: '2026-06-03T00:00:00.000Z',
        language: 'it-IT',
        items: [],
      }),
    );

    const response = await handleRequest(
      new Request('https://example.com/daily?language=it-IT'),
      createTestDeps({ storage }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      language: 'it-IT',
      items: [],
    });
  });

  it('refreshes the default daily snapshot from the home once per day', async () => {
    const metrics = new MemoryMetricsPort();
    const storage = new MemoryStoragePort();
    const provider = new FakeMediaProvider();
    let now = new Date('2026-06-03T10:00:00.000Z');
    const deps = createTestDeps({
      metrics,
      now: () => now,
      provider,
      storage,
    });

    await handleRequest(new Request('https://example.com/'), deps);
    await handleRequest(new Request('https://example.com/'), deps);

    await expect(storage.getText(dailySnapshotKey('it-IT'))).resolves.toContain('"items"');
    await expect(storage.getText(dailySnapshotKey('en-US'))).resolves.toBeNull();
    expect(provider.snapshotCalls).toBe(1);

    now = new Date('2026-06-04T10:00:00.000Z');
    await handleRequest(new Request('https://example.com/'), deps);

    expect(provider.snapshotCalls).toBe(2);
  });

  it('warms lookup cache with the same keys used by irc-news lookup requests', async () => {
    const provider = new FakeMediaProvider();
    const deps = createTestDeps({ provider });

    await handleRequest(new Request('https://example.com/'), deps);

    const response = await handleRequest(
      new Request(
        'https://example.com/?type=movie&title=Dune%20Parte%20Due&year=2024&language=it-IT',
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(provider.lookupCalls).toBe(0);
    await expect(response.json()).resolves.toMatchObject({
      provider: 'tmdb',
      remoteId: '693134',
      title: 'Dune - Parte due',
    });
  });
});
