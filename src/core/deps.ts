import type { LookupCachePort } from '../ports/lookupCache';
import type { MediaProviderPort } from '../ports/mediaProvider';
import type { MetricsPort } from '../ports/metrics';
import type { RateLimiterPort } from '../ports/rateLimiter';
import type { StoragePort } from '../ports/storage';
import type { AppConfig } from './types';

export interface Deps {
  config: AppConfig;
  lookupCache: LookupCachePort;
  storage: StoragePort;
  metrics: MetricsPort;
  rateLimiter: RateLimiterPort;
  provider: MediaProviderPort;
  now: () => Date;
}
