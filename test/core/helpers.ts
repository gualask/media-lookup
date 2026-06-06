import type { Deps } from '../../src/core/deps';
import {
  type AppConfig,
  CACHE_TTL_SECONDS,
  type DailySnapshot,
  type DailySnapshotParams,
  type MediaMetadata,
  type OverviewTranslation,
} from '../../src/core/types';
import type { LookupCachePort } from '../../src/ports/lookupCache';
import type { MediaProviderPort } from '../../src/ports/mediaProvider';
import type { MetricsEvent, MetricsPort } from '../../src/ports/metrics';
import type {
  RateLimiterPort,
  RateLimitParams,
  RateLimitResult,
} from '../../src/ports/rateLimiter';
import type { StoragePort } from '../../src/ports/storage';

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
    lookupCache: new MemoryLookupCachePort(),
    storage: new MemoryStoragePort(),
    metrics: new MemoryMetricsPort(),
    rateLimiter: new MemoryRateLimiterPort(),
    provider: new FakeMediaProvider(),
    now: () => new Date('2026-06-03T00:00:00.000Z'),
    ...overrides,
  };
}

export class MemoryLookupCachePort implements LookupCachePort {
  readonly entries = new Map<string, MediaMetadata>();

  get(key: string): Promise<MediaMetadata | null> {
    return Promise.resolve(this.entries.get(key) ?? null);
  }

  put(key: string, metadata: MediaMetadata): Promise<void> {
    this.entries.set(key, metadata);
    return Promise.resolve();
  }
}

export class MemoryStoragePort implements StoragePort {
  private readonly entries = new Map<string, string>();
  putCalls = 0;

  getText(key: string): Promise<string | null> {
    return Promise.resolve(this.entries.get(key) ?? null);
  }

  putText(key: string, value: string): Promise<void> {
    this.putCalls += 1;
    this.entries.set(key, value);
    return Promise.resolve();
  }
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
  lookupCalls = 0;
  translationCalls = 0;
  snapshotCalls = 0;
  lookupResult: MediaMetadata | null = {
    type: 'movie' as const,
    provider: 'tmdb' as const,
    remoteId: '693134',
    title: 'Dune - Parte due',
    year: 2024,
    overview: 'Trama localizzata se disponibile',
    posterPath: '/abc123.jpg',
  };
  translationResult: OverviewTranslation | null = {
    overview: 'English overview recovered from TMDB',
    language: 'en-US',
  };

  async lookup() {
    this.lookupCalls += 1;
    return this.lookupResult;
  }

  async findOverviewTranslation() {
    this.translationCalls += 1;
    return this.translationResult;
  }

  async buildDailySnapshot(params: DailySnapshotParams): Promise<DailySnapshot> {
    this.snapshotCalls += 1;
    return {
      generatedAt: params.now.toISOString(),
      language: params.language,
      items: this.lookupResult ? [{ ...this.lookupResult, source: 'movie_theatrical_recent' }] : [],
    };
  }
}
