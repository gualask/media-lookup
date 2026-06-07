import type { MediaType } from '../core/types';

export type MetricsRoute =
  | 'lookup'
  | 'lookup_batch'
  | 'translate'
  | 'daily'
  | 'page'
  | 'daily_refresh';
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
}

export interface MetricsPort {
  record(event: MetricsEvent): void | Promise<void>;
}
