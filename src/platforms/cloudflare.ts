import type { Deps } from '../core/deps';
import { TmdbMediaProvider } from '../core/tmdbClient';
import { type AppConfig, CACHE_TTL_SECONDS, type MediaMetadata } from '../core/types';
import type { LookupCachePort } from '../ports/lookupCache';
import type { MetricsEvent, MetricsPort } from '../ports/metrics';
import type { StoragePort, StoragePutOptions } from '../ports/storage';

export interface CloudflareEnv {
  TMDB_TOKEN?: string;
  DEFAULT_LANGUAGE?: string;
  SUPPORTED_LANGUAGES?: string;
  DAILY_REFRESH_TIME_ZONE?: string;
  DAILY_KV: KVNamespace;
}

export function createCloudflareDeps(env: CloudflareEnv): Deps {
  const config = createAppConfig(env);

  return {
    config,
    lookupCache: new CloudflareKvLookupCache(env.DAILY_KV),
    storage: new CloudflareKvStorage(env.DAILY_KV),
    metrics: new ConsoleMetricsPort(),
    provider: new TmdbMediaProvider(config.tmdbToken, (input, init) => fetch(input, init)),
    now: () => new Date(),
  };
}

function createAppConfig(env: CloudflareEnv): AppConfig {
  return {
    tmdbToken: env.TMDB_TOKEN ?? '',
    defaultLanguage: env.DEFAULT_LANGUAGE ?? 'it-IT',
    supportedLanguages: parseCsv(env.SUPPORTED_LANGUAGES ?? 'it-IT,en-US'),
    cacheTtlSeconds: CACHE_TTL_SECONDS,
    dailyRefreshTimeZone: env.DAILY_REFRESH_TIME_ZONE ?? 'Europe/Rome',
  };
}

function parseCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

class CloudflareKvStorage implements StoragePort {
  constructor(private readonly kv: KVNamespace) {}

  getText(key: string): Promise<string | null> {
    return this.kv.get(key);
  }

  putText(key: string, value: string, options: StoragePutOptions = {}): Promise<void> {
    return this.kv.put(key, value, {
      ...(options.ttlSeconds ? { expirationTtl: options.ttlSeconds } : {}),
    });
  }
}

class CloudflareKvLookupCache implements LookupCachePort {
  constructor(private readonly kv: KVNamespace) {}

  async get(key: string): Promise<MediaMetadata | null> {
    const value = await this.kv.get(key);

    if (!value) {
      return null;
    }

    const parsed = JSON.parse(value) as unknown;
    return isMediaMetadata(parsed) ? parsed : null;
  }

  put(key: string, metadata: MediaMetadata, ttlSeconds: number): Promise<void> {
    return this.kv.put(key, JSON.stringify(metadata), {
      expirationTtl: ttlSeconds,
    });
  }
}

function isMediaMetadata(value: unknown): value is MediaMetadata {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<MediaMetadata>;
  return (
    (candidate.type === 'movie' || candidate.type === 'tv') &&
    candidate.provider === 'tmdb' &&
    typeof candidate.remoteId === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.overview === 'string'
  );
}

class ConsoleMetricsPort implements MetricsPort {
  record(event: MetricsEvent): void {
    console.log(JSON.stringify(event));
  }
}
