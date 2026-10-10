import type { MediaType } from '../core/types';

export type MetricsRoute = 'lookup' | 'lookup_batch' | 'daily' | 'page' | 'daily_refresh';
export type MetricsCache = 'hit' | 'miss' | 'bypass';
export type MetricsStatus = 'ok' | 'error' | 'not_found';

export interface MetricsEvent {
  route: MetricsRoute;
  cache: MetricsCache;
  provider: 'tmdb' | 'none';
  tmdbCalls: number;
  status: MetricsStatus;
  mediaType: MediaType | 'none';
  language: string;
  // Lookup routes only: how many items were requested and how many came from the KV cache.
  items?: number;
  errors?: number;
  cacheHits?: number;
  warmupHits?: number;
}

export interface MetricsPort {
  record(event: MetricsEvent): void | Promise<void>;
}
