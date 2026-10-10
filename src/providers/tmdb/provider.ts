import { yearOfDate } from '../../core/dates';
import { normalizeTitle } from '../../core/titles';
import type {
  LookupMatch,
  LookupMetadata,
  LookupParams,
  MediaMetadata,
  MediaType,
} from '../../core/types';
import type { DiscoveredMedia, DiscoverQuery, MediaProviderPort } from '../../ports/mediaProvider';
import type { TmdbHttpClient } from './client';

const THEATRICAL_RELEASE_TYPES = '2|3';
const HOME_RELEASE_TYPES = '4|5';
const WATCH_MONETIZATION_TYPES = 'flatrate|rent|buy';
// Miniseries (2) and scripted series (4): no news, reality, talk shows or documentaries.
const FICTION_TV_TYPES = '2|4';
const SOAP_GENRE = '10766';

interface TmdbListResponse {
  results?: TmdbResult[];
}

interface TmdbResult {
  id?: number;
  overview?: string;
  poster_path?: string | null;
  // Movies
  title?: string;
  original_title?: string;
  release_date?: string;
  // Series
  name?: string;
  original_name?: string;
  first_air_date?: string;
}

/** A TMDB result in one shape for movies and series. */
interface Candidate {
  media: DiscoveredMedia;
  /** Localized and original titles. */
  titles: string[];
}

export class TmdbMediaProvider implements MediaProviderPort {
  constructor(private readonly client: TmdbHttpClient) {}

  get requestCount(): number {
    return this.client.requestCount;
  }

  async lookup(params: LookupParams): Promise<LookupMetadata | null> {
    const response = await this.client.get<TmdbListResponse>(`/search/${params.type}`, {
      query: params.title,
      language: params.language,
      include_adult: 'false',
      page: '1',
      // `year` matches every release date of a movie, including the local one a release name
      // often carries (`primary_release_year` would miss those and return other films), and
      // every episode air date of a series.
      ...(params.year ? { year: params.year.toString() } : {}),
    });
    const picked = pickBestCandidate(candidates(response, params.type), params);

    return picked ? { ...withoutReleaseDate(picked.candidate.media), match: picked.match } : null;
  }

  async discover(query: DiscoverQuery): Promise<DiscoveredMedia[]> {
    const type: MediaType = query.kind === 'tv' ? 'tv' : 'movie';
    const [path, params] = discoverRequest(query);
    const response = await this.client.get<TmdbListResponse>(path, params);

    return candidates(response, type).map((candidate) => candidate.media);
  }
}

function discoverRequest(query: DiscoverQuery): [string, Record<string, string>] {
  switch (query.kind) {
    case 'trending_movies':
      return ['/trending/movie/day', { language: query.language, page: '1' }];
    case 'movies':
      return [
        '/discover/movie',
        {
          language: query.language,
          page: '1',
          include_adult: 'false',
          include_video: 'false',
          sort_by: 'popularity.desc',
          ...(query.region ? { region: query.region } : {}),
          ...(query.release === 'theatrical'
            ? { with_release_type: THEATRICAL_RELEASE_TYPES }
            : {
                with_release_type: HOME_RELEASE_TYPES,
                with_watch_monetization_types: WATCH_MONETIZATION_TYPES,
                ...(query.region ? { watch_region: query.region } : {}),
              }),
          'release_date.gte': query.from,
          'release_date.lte': query.to,
        },
      ];
    case 'tv':
      return [
        '/discover/tv',
        {
          language: query.language,
          page: '1',
          include_adult: 'false',
          include_null_first_air_dates: 'false',
          sort_by: 'popularity.desc',
          timezone: query.timeZone,
          with_type: FICTION_TV_TYPES,
          without_genres: SOAP_GENRE,
          ...(query.firstAiredFrom ? { 'first_air_date.gte': query.firstAiredFrom } : {}),
          ...(query.firstAiredTo ? { 'first_air_date.lte': query.firstAiredTo } : {}),
          ...(query.airedFrom ? { 'air_date.gte': query.airedFrom } : {}),
          ...(query.airedTo ? { 'air_date.lte': query.airedTo } : {}),
        },
      ];
  }
}

function candidates(response: TmdbListResponse, type: MediaType): Candidate[] {
  return (response.results ?? []).flatMap((result) => {
    const candidate = toCandidate(result, type);
    return candidate ? [candidate] : [];
  });
}

function toCandidate(result: TmdbResult, type: MediaType): Candidate | null {
  const title = type === 'movie' ? result.title : result.name;
  const originalTitle = type === 'movie' ? result.original_title : result.original_name;
  const releaseDate = (type === 'movie' ? result.release_date : result.first_air_date) || undefined;

  if (!result.id || !title) {
    return null;
  }

  return {
    media: {
      type,
      provider: 'tmdb',
      remoteId: result.id.toString(),
      title,
      year: yearOfDate(releaseDate),
      overview: result.overview ?? '',
      posterPath: result.poster_path ?? undefined,
      releaseDate,
    },
    titles: originalTitle ? [title, originalTitle] : [title],
  };
}

function pickBestCandidate(
  results: readonly Candidate[],
  params: LookupParams,
): { candidate: Candidate; match: LookupMatch } | null {
  const first = results[0];

  if (!first) {
    return null;
  }

  const query = normalizeTitle(params.title);
  const sameTitle = results.filter((result) =>
    result.titles.some((title) => normalizeTitle(title) === query),
  );

  // TMDB already narrows the search by year, so any result is a year match. Among them, prefer
  // the exact title, then the exact year: the first result can be another work with those words.
  if (params.year) {
    const isSameYear = (result: Candidate) => result.media.year === params.year;
    const candidate =
      sameTitle.find(isSameYear) ?? sameTitle[0] ?? results.find(isSameYear) ?? first;

    return { candidate, match: 'year' };
  }

  return {
    candidate: sameTitle[0] ?? first,
    match: sameTitle.length === 1 ? 'title' : 'uncertain',
  };
}

function withoutReleaseDate({
  releaseDate: _releaseDate,
  ...media
}: DiscoveredMedia): MediaMetadata {
  return media;
}
