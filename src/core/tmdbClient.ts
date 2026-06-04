import { ProviderConfigurationError, UpstreamProviderError } from './errors';
import type {
  DailySnapshot,
  DailySnapshotItem,
  DailySnapshotParams,
  DailySnapshotSource,
  LookupParams,
  MediaMetadata,
  MediaType,
  OverviewTranslation,
  OverviewTranslationParams,
} from './types';

const API_BASE_URL = 'https://api.themoviedb.org/3';
const DAILY_LIMIT_PER_TYPE = 50;

interface TmdbSearchResponse<T> {
  results?: T[];
}

interface TmdbMovieResult {
  id?: number;
  title?: string;
  release_date?: string;
  overview?: string;
  poster_path?: string | null;
}

interface TmdbTvResult {
  id?: number;
  name?: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string | null;
}

type TmdbResult = TmdbMovieResult | TmdbTvResult;

export class TmdbMediaProvider {
  constructor(
    private readonly token: string,
    private readonly fetchFn: typeof fetch,
  ) {}

  async lookup(params: LookupParams): Promise<MediaMetadata | null> {
    if (params.type === 'movie') {
      const response = await this.request<TmdbSearchResponse<TmdbMovieResult>>('/search/movie', {
        query: params.title,
        language: params.language,
        include_adult: 'false',
        page: '1',
        ...(params.year ? { primary_release_year: params.year.toString() } : {}),
      });

      const result = pickBestResult(response.results ?? [], params.year, 'movie');
      return result ? mapMovie(result) : null;
    }

    const response = await this.request<TmdbSearchResponse<TmdbTvResult>>('/search/tv', {
      query: params.title,
      language: params.language,
      include_adult: 'false',
      page: '1',
      ...(params.year ? { first_air_date_year: params.year.toString() } : {}),
    });

    const result = pickBestResult(response.results ?? [], params.year, 'tv');
    return result ? mapTv(result) : null;
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
    const [trendingMovies, popularMovies, trendingTv, popularTv] = await Promise.all([
      this.list<TmdbMovieResult>('/trending/movie/day', params.language),
      this.list<TmdbMovieResult>('/movie/popular', params.language),
      this.list<TmdbTvResult>('/trending/tv/day', params.language),
      this.list<TmdbTvResult>('/tv/popular', params.language),
    ]);

    return {
      generatedAt: params.now.toISOString(),
      language: params.language,
      items: [
        ...dedupeAndLimit('movie', [
          { source: 'trending', results: trendingMovies },
          { source: 'popular', results: popularMovies },
        ]),
        ...dedupeAndLimit('tv', [
          { source: 'trending', results: trendingTv },
          { source: 'popular', results: popularTv },
        ]),
      ],
    };
  }

  private async list<T extends TmdbResult>(path: string, language: string): Promise<T[]> {
    const response = await this.request<TmdbSearchResponse<T>>(path, {
      language,
      page: '1',
    });

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

    const response = await this.fetchFn(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
    });

    if (!response.ok) {
      throw new UpstreamProviderError('TMDB API request failed', response.status);
    }

    return response.json() as Promise<T>;
  }
}

function pickBestResult<T extends TmdbResult>(
  results: readonly T[],
  year: number | undefined,
  type: MediaType,
): T | null {
  if (results.length === 0) {
    return null;
  }

  if (year) {
    const exactYear = results.find((result) => extractYear(resultDate(result, type)) === year);

    if (exactYear) {
      return exactYear;
    }
  }

  return results[0] ?? null;
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

      items.set(`${type}:${item.remoteId}`, item);

      if (items.size >= DAILY_LIMIT_PER_TYPE) {
        return [...items.values()];
      }
    }
  }

  return [...items.values()];
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
