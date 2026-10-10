export const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;

export type MediaType = 'movie' | 'tv';
export type ProviderName = 'tmdb';
export type DailySnapshotSource =
  | 'movie_trending_recent'
  | 'movie_theatrical_recent'
  | 'movie_home_release_recent'
  | 'movie_theatrical_upcoming'
  | 'tv_recent_episodes'
  | 'tv_upcoming_episodes';

export interface AppConfig {
  tmdbToken: string;
  apiBearerToken: string;
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
  timeZone: string;
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

// How the lookup picked its result:
// - year: a requested year narrowed the TMDB search;
// - title: no year, and the chosen result is the only one whose title matches exactly;
// - uncertain: no year, and the title is shared by several results or does not match exactly.
export type LookupMatch = 'year' | 'title' | 'uncertain';

export interface LookupMetadata extends MediaMetadata {
  match: LookupMatch;
}

export interface DailySnapshotItem extends MediaMetadata {
  source: DailySnapshotSource;
}

export interface DailySnapshot {
  generatedAt: string;
  language: string;
  items: DailySnapshotItem[];
}
