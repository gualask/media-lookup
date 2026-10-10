import { normalizeTitle } from './cacheKeys';
import { ProviderConfigurationError, UpstreamProviderError } from './errors';
import type {
  DailySnapshot,
  DailySnapshotItem,
  DailySnapshotParams,
  DailySnapshotSource,
  LookupMatch,
  LookupMetadata,
  LookupParams,
  MediaMetadata,
  MediaType,
  OverviewTranslation,
  OverviewTranslationParams,
} from './types';

const API_BASE_URL = 'https://api.themoviedb.org/3';
const DAILY_LIMIT_PER_SOURCE = 20;
const MOVIE_TRENDING_PAST_DAYS = 180;
const MOVIE_TRENDING_FUTURE_DAYS = 365;
const MOVIE_RECENT_DAYS = 45;
const MOVIE_HOME_RELEASE_DAYS = 120;
const MOVIE_UPCOMING_DAYS = 45;
// A first release older than this is a re-release, not news.
const MOVIE_FIRST_RELEASE_MAX_AGE_DAYS = 365;
const TV_RECENT_DAYS = 14;
const TV_PREMIERE_RECENT_DAYS = 60;
const TV_PREMIERE_UPCOMING_DAYS = 60;
// New episodes count only for series that started within this many years, so long-running
// shows and decades-old soaps do not fill the section.
const TV_RECENT_EPISODES_MAX_SERIES_AGE_YEARS = 10;
const THEATRICAL_RELEASE_TYPES = '2|3';
const HOME_RELEASE_TYPES = '4|5';
const WATCH_MONETIZATION_TYPES = 'flatrate|rent|buy';
// Miniseries (2) and scripted series (4): no news, reality, talk shows or documentaries.
const TV_TYPES = '2|4';
// Daily soaps air every weekday and would fill the new episodes section.
const TV_EXCLUDED_GENRES = '10766';
const LAST_DATE_KEY = '9999-12-31';
const DEFAULT_RETRY_AFTER_SECONDS = 1;
const MAX_RETRY_AFTER_SECONDS = 3;

interface TmdbSearchResponse<T> {
  results?: T[];
}

interface TmdbMovieResult {
  id?: number;
  title?: string;
  original_title?: string;
  release_date?: string;
  overview?: string;
  poster_path?: string | null;
}

interface TmdbTvResult {
  id?: number;
  name?: string;
  original_name?: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string | null;
}

type TmdbResult = TmdbMovieResult | TmdbTvResult;

export class TmdbMediaProvider {
  constructor(
    private readonly token: string,
    private readonly fetchFn: typeof fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async lookup(params: LookupParams): Promise<LookupMetadata | null> {
    if (params.type === 'movie') {
      const response = await this.request<TmdbSearchResponse<TmdbMovieResult>>('/search/movie', {
        query: params.title,
        language: params.language,
        include_adult: 'false',
        page: '1',
        // `year` matches every release date, including the local one a release name often
        // carries; `primary_release_year` would miss those and return other films instead.
        ...(params.year ? { year: params.year.toString() } : {}),
      });

      const picked = pickBestResult(response.results ?? [], params, 'movie');
      return withMatch(picked && mapMovie(picked.result), picked?.match);
    }

    const response = await this.request<TmdbSearchResponse<TmdbTvResult>>('/search/tv', {
      query: params.title,
      language: params.language,
      include_adult: 'false',
      page: '1',
      ...(params.year ? { year: params.year.toString() } : {}),
    });

    const picked = pickBestResult(response.results ?? [], params, 'tv');
    return withMatch(picked && mapTv(picked.result), picked?.match);
  }

  async findOverviewTranslation(
    params: OverviewTranslationParams,
  ): Promise<OverviewTranslation | null> {
    const response = await this.request<{ overview?: string }>(
      `/${params.type}/${params.remoteId}`,
      {
        language: params.language,
      },
    );
    const overview = response.overview?.trim() ?? '';

    if (!overview) {
      return null;
    }

    return {
      overview,
      language: params.language,
    };
  }

  async buildDailySnapshot(params: DailySnapshotParams): Promise<DailySnapshot> {
    const today = dateKeyInTimeZone(params.now, params.timeZone);
    const region = regionFromLanguage(params.language);
    const movieListParams = {
      language: params.language,
      page: '1',
    };
    const movieBaseParams = {
      ...movieListParams,
      include_adult: 'false',
      include_video: 'false',
      sort_by: 'popularity.desc',
      ...(region ? { region } : {}),
    };
    const tvBaseParams = {
      language: params.language,
      page: '1',
      include_adult: 'false',
      include_null_first_air_dates: 'false',
      sort_by: 'popularity.desc',
      timezone: params.timeZone,
      with_type: TV_TYPES,
      without_genres: TV_EXCLUDED_GENRES,
    };
    const trendingMovieStart = addDaysToDateKey(today, -MOVIE_TRENDING_PAST_DAYS);
    const trendingMovieEnd = addDaysToDateKey(today, MOVIE_TRENDING_FUTURE_DAYS);
    const firstReleaseStart = addDaysToDateKey(today, -MOVIE_FIRST_RELEASE_MAX_AGE_DAYS);
    const notReReleased = (results: readonly TmdbMovieResult[]) =>
      filterMoviesByReleaseWindow(results, firstReleaseStart, LAST_DATE_KEY);
    const [
      trendingMovies,
      recentTheatricalMovies,
      recentHomeReleaseMovies,
      upcomingTheatricalMovies,
      recentTvPremieres,
      recentTvEpisodes,
      upcomingTvPremieres,
    ] = await Promise.all([
      this.list<TmdbMovieResult>('/trending/movie/day', movieListParams),
      this.list<TmdbMovieResult>('/discover/movie', {
        ...movieBaseParams,
        with_release_type: THEATRICAL_RELEASE_TYPES,
        'release_date.gte': addDaysToDateKey(today, -MOVIE_RECENT_DAYS),
        'release_date.lte': today,
      }),
      this.list<TmdbMovieResult>('/discover/movie', {
        ...movieBaseParams,
        with_release_type: HOME_RELEASE_TYPES,
        with_watch_monetization_types: WATCH_MONETIZATION_TYPES,
        ...(region ? { watch_region: region } : {}),
        'release_date.gte': addDaysToDateKey(today, -MOVIE_HOME_RELEASE_DAYS),
        'release_date.lte': today,
      }),
      this.list<TmdbMovieResult>('/discover/movie', {
        ...movieBaseParams,
        with_release_type: THEATRICAL_RELEASE_TYPES,
        'release_date.gte': addDaysToDateKey(today, 1),
        'release_date.lte': addDaysToDateKey(today, MOVIE_UPCOMING_DAYS),
      }),
      this.list<TmdbTvResult>('/discover/tv', {
        ...tvBaseParams,
        'first_air_date.gte': addDaysToDateKey(today, -TV_PREMIERE_RECENT_DAYS),
        'first_air_date.lte': today,
      }),
      this.list<TmdbTvResult>('/discover/tv', {
        ...tvBaseParams,
        'air_date.gte': addDaysToDateKey(today, -TV_RECENT_DAYS),
        'air_date.lte': today,
        'first_air_date.gte': addYearsToDateKey(today, -TV_RECENT_EPISODES_MAX_SERIES_AGE_YEARS),
      }),
      this.list<TmdbTvResult>('/discover/tv', {
        ...tvBaseParams,
        'first_air_date.gte': addDaysToDateKey(today, 1),
        'first_air_date.lte': addDaysToDateKey(today, TV_PREMIERE_UPCOMING_DAYS),
      }),
    ]);

    return {
      generatedAt: params.now.toISOString(),
      language: params.language,
      items: [
        ...dedupeAndLimit('movie', [
          { source: 'movie_home_release_recent', results: notReReleased(recentHomeReleaseMovies) },
          {
            source: 'movie_trending_recent',
            results: filterMoviesByReleaseWindow(
              trendingMovies,
              trendingMovieStart,
              trendingMovieEnd,
            ),
          },
          { source: 'movie_theatrical_recent', results: notReReleased(recentTheatricalMovies) },
          {
            source: 'movie_theatrical_upcoming',
            results: notReReleased(upcomingTheatricalMovies),
          },
        ]),
        ...dedupeAndLimit('tv', [
          { source: 'tv_premiere_recent', results: recentTvPremieres },
          { source: 'tv_recent_episodes', results: recentTvEpisodes },
          { source: 'tv_premiere_upcoming', results: upcomingTvPremieres },
        ]),
      ],
    };
  }

  private async list<T extends TmdbResult>(
    path: string,
    params: Record<string, string>,
  ): Promise<T[]> {
    const response = await this.request<TmdbSearchResponse<T>>(path, params);

    return response.results ?? [];
  }

  private async request<T>(path: string, params: Record<string, string>): Promise<T> {
    if (!this.token) {
      throw new ProviderConfigurationError('TMDB_TOKEN is missing');
    }

    const url = new URL(`${API_BASE_URL}${path}`);

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const init = {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
    };
    let response = await this.fetchFn(url, init);

    // TMDB asks clients to respect 429: wait as told, within a bound, and try once more.
    if (response.status === 429) {
      await this.sleep(retryAfterMs(response.headers.get('Retry-After')));
      response = await this.fetchFn(url, init);
    }

    if (!response.ok) {
      throw new UpstreamProviderError('TMDB API request failed', response.status);
    }

    return response.json() as Promise<T>;
  }
}

function pickBestResult<T extends TmdbResult>(
  results: readonly T[],
  params: LookupParams,
  type: MediaType,
): { result: T; match: LookupMatch } | null {
  const first = results[0];

  if (!first) {
    return null;
  }

  const query = normalizeTitle(params.title);
  const sameTitle = results.filter((result) => hasTitle(result, query, type));

  // TMDB already narrows the search by year, so any result is a year match. Among them, prefer
  // the exact title, then the exact year: the first result can be another work with those words.
  if (params.year) {
    const isSameYear = (result: T) => extractYear(resultDate(result, type)) === params.year;
    const result = sameTitle.find(isSameYear) ?? sameTitle[0] ?? results.find(isSameYear) ?? first;

    return { result, match: 'year' };
  }

  return {
    result: sameTitle[0] ?? first,
    match: sameTitle.length === 1 ? 'title' : 'uncertain',
  };
}

function retryAfterMs(header: string | null): number {
  const seconds = Number(header);
  const bounded = Number.isFinite(seconds) && seconds >= 0 ? seconds : DEFAULT_RETRY_AFTER_SECONDS;

  return Math.min(bounded, MAX_RETRY_AFTER_SECONDS) * 1000;
}

function hasTitle(result: TmdbResult, normalizedQuery: string, type: MediaType): boolean {
  const titles =
    type === 'movie'
      ? [(result as TmdbMovieResult).title, (result as TmdbMovieResult).original_title]
      : [(result as TmdbTvResult).name, (result as TmdbTvResult).original_name];

  return titles.some((title) => title !== undefined && normalizeTitle(title) === normalizedQuery);
}

function withMatch(
  metadata: MediaMetadata | null,
  match: LookupMatch | undefined,
): LookupMetadata | null {
  return metadata && match ? { ...metadata, match } : null;
}

function dedupeAndLimit(
  type: MediaType,
  groups: readonly {
    source: DailySnapshotSource;
    results: readonly TmdbResult[];
  }[],
): DailySnapshotItem[] {
  const items = new Map<string, DailySnapshotItem>();

  for (const group of groups) {
    let acceptedFromGroup = 0;

    for (const result of group.results) {
      const metadata =
        type === 'movie' ? mapMovie(result as TmdbMovieResult) : mapTv(result as TmdbTvResult);

      if (!metadata || !hasLatinLetter(metadata.title)) {
        continue;
      }

      const item = {
        ...metadata,
        source: group.source,
      };
      const itemKey = `${type}:${item.remoteId}`;

      if (!items.has(itemKey)) {
        items.set(itemKey, item);
        acceptedFromGroup += 1;
      }

      if (acceptedFromGroup >= DAILY_LIMIT_PER_SOURCE) {
        break;
      }
    }
  }

  return [...items.values()];
}

function filterMoviesByReleaseWindow(
  results: readonly TmdbMovieResult[],
  startDate: string,
  endDate: string,
): TmdbMovieResult[] {
  return results.filter((result) =>
    isDateKeyInRange(result.release_date ?? '', startDate, endDate),
  );
}

function isDateKeyInRange(dateKey: string, startDate: string, endDate: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && dateKey >= startDate && dateKey <= endDate;
}

function hasLatinLetter(value: string): boolean {
  return /\p{Script=Latin}/u.test(value);
}

function mapMovie(result: TmdbMovieResult): MediaMetadata | null {
  if (!result.id || !result.title) {
    return null;
  }

  return {
    type: 'movie',
    provider: 'tmdb',
    remoteId: result.id.toString(),
    title: result.title,
    year: extractYear(result.release_date),
    overview: result.overview ?? '',
    posterPath: result.poster_path ?? undefined,
  };
}

function mapTv(result: TmdbTvResult): MediaMetadata | null {
  if (!result.id || !result.name) {
    return null;
  }

  return {
    type: 'tv',
    provider: 'tmdb',
    remoteId: result.id.toString(),
    title: result.name,
    year: extractYear(result.first_air_date),
    overview: result.overview ?? '',
    posterPath: result.poster_path ?? undefined,
  };
}

function extractYear(date: string | undefined): number | undefined {
  if (!date) {
    return undefined;
  }

  const match = /^(\d{4})/.exec(date);
  return match ? Number(match[1]) : undefined;
}

function resultDate(result: TmdbResult, type: MediaType): string | undefined {
  return type === 'movie'
    ? (result as TmdbMovieResult).release_date
    : (result as TmdbTvResult).first_air_date;
}

function dateKeyInTimeZone(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addYearsToDateKey(dateKey: string, years: number): string {
  const year = Number(dateKey.slice(0, 4));

  return Number.isInteger(year) ? `${year + years}${dateKey.slice(4)}` : dateKey;
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);

  if (!match) {
    return dateKey;
  }

  const [, yearText, monthText, dayText] = match;
  if (!yearText || !monthText || !dayText) {
    return dateKey;
  }

  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));

  return shifted.toISOString().slice(0, 10);
}

function regionFromLanguage(language: string): string | undefined {
  const match = /^[a-z]{2,3}-([a-z]{2})$/i.exec(language);
  return match?.[1]?.toUpperCase();
}
