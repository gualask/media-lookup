import { describe, expect, it } from 'vitest';
import { dailySnapshotKey } from '../../src/core/dailySnapshot';
import { handleRequest } from '../../src/core/handleRequest';
import {
  createTestDeps,
  FakeMediaProvider,
  MemoryMetricsPort,
  MemoryRateLimiterPort,
  MemoryStoragePort,
  storedLookup,
  storeLookup,
  testConfig,
} from './helpers';

describe('handleRequest', () => {
  it('serves the root HTML page', async () => {
    const response = await handleRequest(new Request('https://example.com/'), createTestDeps());

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('<title>Media lookup</title>');
    expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
    expect(html).toContain('https://image.tmdb.org/t/p/w185/abc123.jpg');
    expect(html).toContain(
      'https://www.youtube.com/results?search_query=Dune%20-%20Parte%20due%202024%20trailer%20italiano',
    );
    expect(html).not.toContain('posterPath=');
    expect(html).toContain('href="https://www.themoviedb.org"');
    expect(html).toContain(
      'This product uses the TMDB API but is not endorsed or certified by TMDB.',
    );
    expect(html).toContain('<svg');
  });

  it('serves a cacheable favicon', async () => {
    const response = await handleRequest(
      new Request('https://example.com/favicon.svg'),
      createTestDeps({
        config: {
          ...testConfig,
          apiBearerToken: 'api-secret',
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('image/svg+xml');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000');
    expect(await response.text()).toContain('<svg');
  });

  it('renders a missing overview notice', async () => {
    const provider = new FakeMediaProvider();
    provider.lookupResult = {
      type: 'movie',
      provider: 'tmdb',
      remoteId: '693134',
      title: 'Dune - Parte due',
      year: 2024,
      overview: '',
      posterPath: '/abc123.jpg',
      match: 'year',
    };

    const response = await handleRequest(
      new Request('https://example.com/'),
      createTestDeps({ provider }),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Trama italiana non disponibile.');
  });

  it('returns lookup metadata and caches the response', async () => {
    const provider = new FakeMediaProvider();
    const storage = new MemoryStoragePort();
    const deps = createTestDeps({ storage, provider });
    const url = 'https://example.com/lookup?type=movie&title=Dune&year=2024&language=it-IT';

    const first = await handleRequest(new Request(url), deps);
    const second = await handleRequest(new Request(url), deps);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers.get('Cache-Control')).toBe('private, max-age=2592000');
    expect(provider.lookupCalls).toBe(1);
    expect(storedLookup(storage, { type: 'movie', title: 'Dune', year: 2024 })).toMatchObject({
      status: 'found',
      origin: 'lookup',
    });
    await expect(first.json()).resolves.toMatchObject({
      provider: 'tmdb',
      remoteId: '693134',
      posterPath: '/abc123.jpg',
      match: 'year',
    });
  });

  it('returns lookup batch results and caches found and not found entries', async () => {
    const provider = new FakeMediaProvider();
    provider.lookupResults.set('Missing', null);
    const storage = new MemoryStoragePort();
    const deps = createTestDeps({ storage, provider });
    const request = () =>
      new Request('https://example.com/lookup/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          items: [
            { type: 'movie', title: 'Dune', year: 2024, language: 'it-IT' },
            { type: 'movie', title: 'Missing', language: 'it-IT' },
          ],
        }),
      });

    const first = await handleRequest(request(), deps);
    const second = await handleRequest(request(), deps);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(provider.lookupCalls).toBe(2);
    await expect(first.json()).resolves.toMatchObject({
      results: [
        {
          index: 0,
          status: 'found',
          metadata: {
            provider: 'tmdb',
            remoteId: '693134',
          },
        },
        {
          index: 1,
          status: 'not_found',
        },
      ],
    });
    expect(storedLookup(storage, { type: 'movie', title: 'Missing' })).toEqual({
      status: 'not_found',
    });
  });

  it('records cache and warmup hits per lookup batch', async () => {
    const provider = new FakeMediaProvider();
    const metrics = new MemoryMetricsPort();
    const storage = new MemoryStoragePort();
    const metadata = provider.lookupResult;

    if (!metadata) {
      throw new Error('Expected default lookup result');
    }

    await storeLookup(
      storage,
      { type: 'movie', title: 'Warm' },
      { status: 'found', metadata, origin: 'warmup' },
    );
    await storeLookup(
      storage,
      { type: 'movie', title: 'Seen' },
      { status: 'found', metadata, origin: 'lookup' },
    );

    await handleRequest(
      new Request('https://example.com/lookup/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            { type: 'movie', title: 'Warm' },
            { type: 'movie', title: 'Seen' },
            { type: 'movie', title: 'New' },
          ],
        }),
      }),
      createTestDeps({ storage, metrics, provider }),
    );

    expect(provider.lookupCalls).toBe(1);
    expect(metrics.events).toEqual([
      expect.objectContaining({
        route: 'lookup_batch',
        tmdbCalls: 1,
        items: 3,
        cacheHits: 2,
        warmupHits: 1,
      }),
    ]);
    expect(storedLookup(storage, { type: 'movie', title: 'New' })).toMatchObject({
      status: 'found',
      origin: 'lookup',
    });
  });

  it('fails only the batch item whose TMDB request failed', async () => {
    const provider = new FakeMediaProvider();
    provider.failingTitles.add('Busy');
    const metrics = new MemoryMetricsPort();
    const storage = new MemoryStoragePort();

    const response = await handleRequest(
      new Request('https://example.com/lookup/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            { type: 'movie', title: 'Dune', year: 2024 },
            { type: 'movie', title: 'Busy' },
          ],
        }),
      }),
      createTestDeps({ storage, metrics, provider }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      results: [
        expect.objectContaining({ index: 0, status: 'found' }),
        { index: 1, status: 'error', error: { message: 'TMDB API request failed (429)' } },
      ],
    });
    expect(storedLookup(storage, { type: 'movie', title: 'Busy' })).toBeUndefined();
    expect(metrics.events).toEqual([
      expect.objectContaining({
        route: 'lookup_batch',
        status: 'ok',
        tmdbCalls: 2,
        items: 2,
        errors: 1,
      }),
    ]);
  });

  it('accepts lookup batches up to 15 items and rejects larger ones', async () => {
    const provider = new FakeMediaProvider();
    const deps = createTestDeps({ provider });
    const batchRequest = (count: number) =>
      new Request('https://example.com/lookup/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: Array.from({ length: count }, (_, index) => ({
            type: 'movie',
            title: `Title ${index}`,
          })),
        }),
      });

    const accepted = await handleRequest(batchRequest(15), deps);
    const rejected = await handleRequest(batchRequest(16), deps);

    expect(accepted.status).toBe(200);
    expect(provider.lookupCalls).toBe(15);
    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toMatchObject({
      error: { code: 'batch_too_large' },
    });
  });

  it('validates the batch language like the lookup query parameter', async () => {
    const provider = new FakeMediaProvider();
    const deps = createTestDeps({ provider });
    const batch = (language: unknown) =>
      handleRequest(
        new Request('https://example.com/lookup/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: [{ type: 'movie', title: 'Dune', language }] }),
        }),
        deps,
      );

    const blank = await batch('  ');
    const notString = await batch(42);

    expect(blank.status).toBe(200);
    expect(notString.status).toBe(400);
    await expect(notString.json()).resolves.toMatchObject({
      error: { message: 'Lookup batch item 0: field "language" must be a string' },
    });
  });

  it('rejects lookup batch items with unsupported languages', async () => {
    const response = await handleRequest(
      new Request('https://example.com/lookup/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ type: 'movie', title: 'Dune', language: 'ja-JP' }],
        }),
      }),
      createTestDeps(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'unsupported_language' },
    });
  });

  it('requires bearer authorization for API routes when configured', async () => {
    const provider = new FakeMediaProvider();
    const deps = createTestDeps({
      config: {
        ...testConfig,
        apiBearerToken: 'api-secret',
      },
      provider,
    });
    const url = 'https://example.com/lookup?type=movie&title=Dune&year=2024&language=it-IT';

    const unauthorized = await handleRequest(new Request(url), deps);
    const authorized = await handleRequest(
      new Request(url, {
        headers: {
          Authorization: 'Bearer api-secret',
        },
      }),
      deps,
    );

    const wrongToken = await handleRequest(
      new Request(url, {
        headers: {
          Authorization: 'Bearer api-secreT',
        },
      }),
      deps,
    );
    const longerToken = await handleRequest(
      new Request(url, {
        headers: {
          Authorization: 'Bearer api-secret-extra',
        },
      }),
      deps,
    );

    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('WWW-Authenticate')).toBe('Bearer');
    expect(wrongToken.status).toBe(401);
    expect(longerToken.status).toBe(401);
    expect(authorized.status).toBe(200);
    expect(provider.lookupCalls).toBe(1);
  });

  it('keeps the root page public when bearer authorization is configured', async () => {
    const response = await handleRequest(
      new Request('https://example.com/'),
      createTestDeps({
        config: {
          ...testConfig,
          apiBearerToken: 'api-secret',
        },
      }),
    );

    expect(response.status).toBe(200);
  });

  it('returns 429 before expensive work when rate limited', async () => {
    const provider = new FakeMediaProvider();
    const rateLimiter = new MemoryRateLimiterPort();
    rateLimiter.success = false;

    const response = await handleRequest(
      new Request('https://example.com/lookup?type=movie&title=Dune&language=it-IT', {
        headers: {
          'CF-Connecting-IP': '203.0.113.10',
        },
      }),
      createTestDeps({ provider, rateLimiter }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(provider.lookupCalls).toBe(0);
    expect(rateLimiter.calls).toEqual([
      {
        scope: 'api',
        key: 'lookup:203.0.113.10',
      },
    ]);
  });

  it('returns 404 when metadata is not found', async () => {
    const provider = new FakeMediaProvider();
    provider.lookupResult = null;
    const response = await handleRequest(
      new Request('https://example.com/lookup?type=movie&title=Missing&language=it-IT'),
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

  it('rebuilds the daily snapshot when the stored one is corrupted', async () => {
    const storage = new MemoryStoragePort();
    const provider = new FakeMediaProvider();
    await storage.putText(dailySnapshotKey('it-IT'), '{not json');

    const response = await handleRequest(
      new Request('https://example.com/'),
      createTestDeps({ provider, storage }),
    );

    expect(response.status).toBe(200);
    expect(provider.snapshotCalls).toBe(1);
  });

  it('serves the rebuilt snapshot when storing it fails', async () => {
    const storage = new MemoryStoragePort();
    let writes = 0;
    storage.putText = () => {
      writes += 1;
      return Promise.reject(new Error('KV put() limit exceeded for the day.'));
    };

    const response = await handleRequest(
      new Request('https://example.com/'),
      createTestDeps({ storage }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Dune - Parte due');
    // Only the snapshot write was tried: the warmup would fail the same way.
    expect(writes).toBe(1);
  });

  it('serves the previous snapshot when the daily refresh fails', async () => {
    const storage = new MemoryStoragePort();
    const provider = new FakeMediaProvider();
    const metrics = new MemoryMetricsPort();
    provider.discoverFails = true;
    await storage.putText(
      dailySnapshotKey('it-IT'),
      JSON.stringify({
        generatedAt: '2026-06-02T08:00:00.000Z',
        language: 'it-IT',
        items: [
          {
            type: 'movie',
            provider: 'tmdb',
            remoteId: '1',
            title: 'Ieri al cinema',
            year: 2026,
            overview: '',
            source: 'movie_theatrical_recent',
          },
        ],
      }),
    );

    const response = await handleRequest(
      new Request('https://example.com/'),
      createTestDeps({ metrics, provider, storage }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Ieri al cinema');
    expect(metrics.events).toContainEqual(
      expect.objectContaining({ route: 'daily_refresh', status: 'error' }),
    );
  });

  it('answers 502 when the first daily refresh fails', async () => {
    const provider = new FakeMediaProvider();
    provider.discoverFails = true;

    const response = await handleRequest(
      new Request('https://example.com/'),
      createTestDeps({ provider }),
    );

    expect(response.status).toBe(502);
  });

  it('warms lookup cache with the same keys used by client lookup requests', async () => {
    const provider = new FakeMediaProvider();
    const deps = createTestDeps({ provider });

    await handleRequest(new Request('https://example.com/'), deps);

    const response = await handleRequest(
      new Request(
        'https://example.com/lookup?type=movie&title=Dune%20Parte%20Due&year=2024&language=it-IT',
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(provider.lookupCalls).toBe(0);
    await expect(response.json()).resolves.toMatchObject({
      provider: 'tmdb',
      remoteId: '693134',
      title: 'Dune - Parte due',
      match: 'year',
    });
  });
});
