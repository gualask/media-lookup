import type { Deps } from '../core/deps';
import { type AppConfig, CACHE_TTL_SECONDS } from '../core/types';
import type { MetricsEvent, MetricsPort } from '../ports/metrics';
import type { RateLimiterPort, RateLimitScope } from '../ports/rateLimiter';
import type { StoragePort, StoragePutOptions } from '../ports/storage';
import { TmdbHttpClient } from '../providers/tmdb/client';
import { TmdbMediaProvider } from '../providers/tmdb/provider';

interface CloudflareRateLimitBinding {
  limit(params: { key: string }): Promise<{ success: boolean }>;
}

export interface CloudflareEnv {
  TMDB_TOKEN?: string;
  API_BEARER_TOKEN?: string;
  DEFAULT_LANGUAGE?: string;
  SUPPORTED_LANGUAGES?: string;
  DAILY_REFRESH_TIME_ZONE?: string;
  PUBLIC_RATE_LIMITER?: CloudflareRateLimitBinding;
  API_RATE_LIMITER?: CloudflareRateLimitBinding;
  DAILY_KV: KVNamespace;
}

export function createCloudflareDeps(env: CloudflareEnv): Deps {
  const config = createAppConfig(env);

  return {
    config,
    storage: new CloudflareKvStorage(env.DAILY_KV),
    metrics: new ConsoleMetricsPort(),
    rateLimiter: new CloudflareRateLimiterPort({
      public: env.PUBLIC_RATE_LIMITER,
      api: env.API_RATE_LIMITER,
    }),
    provider: new TmdbMediaProvider(
      new TmdbHttpClient(config.tmdbToken, (input, init) => fetch(input, init)),
    ),
    now: () => new Date(),
  };
}

function createAppConfig(env: CloudflareEnv): AppConfig {
  return {
    tmdbToken: env.TMDB_TOKEN ?? '',
    apiBearerToken: env.API_BEARER_TOKEN ?? '',
    defaultLanguage: env.DEFAULT_LANGUAGE ?? 'it-IT',
    supportedLanguages: parseCsv(env.SUPPORTED_LANGUAGES ?? 'it-IT,en-US,es-ES,fr-FR,de-DE'),
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

class ConsoleMetricsPort implements MetricsPort {
  record(event: MetricsEvent): void {
    console.log(JSON.stringify(event));
  }
}

class CloudflareRateLimiterPort implements RateLimiterPort {
  constructor(
    private readonly bindings: Partial<Record<RateLimitScope, CloudflareRateLimitBinding>>,
  ) {}

  async limit(params: { scope: RateLimitScope; key: string }): Promise<{ success: boolean }> {
    const binding = this.bindings[params.scope];

    if (!binding) {
      return { success: true };
    }

    return binding.limit({ key: params.key });
  }
}
