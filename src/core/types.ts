export const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;

export type MediaType = 'movie' | 'tv';
export type ProviderName = 'tmdb';
export type DailySnapshotSource = 'trending' | 'popular';

export interface AppConfig {
  tmdbToken: string;
  defaultLanguage: string;
  supportedLanguages: readonly string[];
  cacheTtlSeconds: number;
  dailyRefreshTimeZone: string;
}

export interface LookupParams {
  type: MediaType;
  title: string;
  year?: number;
  language: string;
}

export interface OverviewTranslationParams {
  type: MediaType;
  remoteId: string;
  language: string;
}

export interface OverviewTranslation {
  overview: string;
  language: string;
}

export interface DailySnapshotParams {
  language: string;
  now: Date;
}

export interface MediaMetadata {
  type: MediaType;
  provider: ProviderName;
  remoteId: string;
  title: string;
  year?: number;
  overview: string;
  posterPath?: string;
}

export interface DailySnapshotItem extends MediaMetadata {
  source: DailySnapshotSource;
}

export interface DailySnapshot {
  generatedAt: string;
  language: string;
  items: DailySnapshotItem[];
}
