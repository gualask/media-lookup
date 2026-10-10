import { lookupCacheKey } from '../../src/core/cacheKeys';
import type { Deps } from '../../src/core/deps';
import { UpstreamProviderError } from '../../src/core/errors';
import type { LookupCacheEntry } from '../../src/core/lookupCache';
import {
  type AppConfig,
  CACHE_TTL_SECONDS,
  type LookupMetadata,
  type LookupParams,
} from '../../src/core/types';
import type {
  DiscoveredMedia,
  DiscoverQuery,
  MediaProviderPort,
} from '../../src/ports/mediaProvider';
import type { MetricsEvent, MetricsPort } from '../../src/ports/metrics';
import type {
  RateLimiterPort,
  RateLimitParams,
  RateLimitResult,
} from '../../src/ports/rateLimiter';
import type { StoragePort, StoragePutOptions } from '../../src/ports/storage';

export const testConfig: AppConfig = {
  tmdbToken: 'test-token',
  apiBearerToken: '',
  defaultLanguage: 'it-IT',
  supportedLanguages: ['it-IT', 'en-US'],
  cacheTtlSeconds: CACHE_TTL_SECONDS,
  dailyRefreshTimeZone: 'Europe/Rome',
};

export function createTestDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    config: testConfig,
    storage: new MemoryStoragePort(),
    metrics: new MemoryMetricsPort(),
    rateLimiter: new MemoryRateLimiterPort(),
    provider: new FakeMediaProvider(),
    now: () => new Date('2026-06-03T00:00:00.000Z'),
    ...overrides,
  };
}

export class MemoryStoragePort implements StoragePort {
  readonly entries = new Map<string, string>();
  readonly ttls = new Map<string, number | undefined>();
  putCalls = 0;

  getText(key: string): Promise<string | null> {
    return Promise.resolve(this.entries.get(key) ?? null);
  }

  putText(key: string, value: string, options: StoragePutOptions = {}): Promise<void> {
    this.putCalls += 1;
    this.entries.set(key, value);
    this.ttls.set(key, options.ttlSeconds);
    return Promise.resolve();
  }
}

/** The lookup cache entry stored for these lookup params, if any. */
export function storedLookup(
  storage: MemoryStoragePort,
  params: Omit<LookupParams, 'language'> & { language?: string },
): LookupCacheEntry | undefined {
  const value = storage.entries.get(lookupCacheKey({ language: 'it-IT', ...params }));
  return value ? (JSON.parse(value) as LookupCacheEntry) : undefined;
}

export async function storeLookup(
  storage: MemoryStoragePort,
  params: Omit<LookupParams, 'language'> & { language?: string },
  entry: LookupCacheEntry,
): Promise<void> {
  await storage.putText(lookupCacheKey({ language: 'it-IT', ...params }), JSON.stringify(entry));
}

export class MemoryMetricsPort implements MetricsPort {
  readonly events: MetricsEvent[] = [];

  record(event: MetricsEvent): void {
    this.events.push(event);
  }
}

export class MemoryRateLimiterPort implements RateLimiterPort {
  success = true;
  readonly calls: RateLimitParams[] = [];

  limit(params: RateLimitParams): Promise<RateLimitResult> {
    this.calls.push(params);
    return Promise.resolve({ success: this.success });
  }
}

export class FakeMediaProvider implements MediaProviderPort {
  requestCount = 0;
  lookupCalls = 0;
  /** Daily snapshot builds, counted by their trending query (one per build). */
  snapshotCalls = 0;
  readonly lookupResults = new Map<string, LookupMetadata | null>();
  readonly failingTitles = new Set<string>();
  discoverFails = false;
  lookupResult: LookupMetadata | null = {
    type: 'movie' as const,
    provider: 'tmdb' as const,
    remoteId: '693134',
    title: 'Dune - Parte due',
    year: 2024,
    overview: 'Trama localizzata se disponibile',
    posterPath: '/abc123.jpg',
    match: 'year',
  };

  async lookup(params: { title: string }) {
    this.requestCount += 1;
    this.lookupCalls += 1;
    if (this.failingTitles.has(params.title)) {
      throw new UpstreamProviderError('TMDB API request failed', 429);
    }
    if (this.lookupResults.has(params.title)) {
      return this.lookupResults.get(params.title) ?? null;
    }
    return this.lookupResult;
  }

  /** Answers the trending query with `lookupResult`, recently released; every other one is empty. */
  async discover(query: DiscoverQuery): Promise<DiscoveredMedia[]> {
    this.requestCount += 1;
    if (this.discoverFails) {
      throw new UpstreamProviderError('TMDB API request failed', 503);
    }
    if (query.kind !== 'trending_movies') {
      return [];
    }

    this.snapshotCalls += 1;
    if (!this.lookupResult) {
      return [];
    }

    const { match: _match, ...media } = this.lookupResult;
    return [{ ...media, releaseDate: '2026-05-01' }];
  }
}
