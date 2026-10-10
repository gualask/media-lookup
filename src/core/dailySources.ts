import type { DiscoveredMedia, DiscoverQuery, MediaProviderPort } from '../ports/mediaProvider';
import {
  addDaysToDateKey,
  addYearsToDateKey,
  dateKeyInTimeZone,
  isDateKeyInRange,
  LAST_DATE_KEY,
} from './dates';
import { hasLatinLetter } from './titles';
import type {
  DailySnapshot,
  DailySnapshotItem,
  DailySnapshotParams,
  DailySnapshotSource,
  MediaType,
} from './types';

// What the home page calls news. Windows are in days around today, in the refresh time zone.
const ITEMS_PER_SOURCE = 20;
const MOVIE_HOME_RELEASE_DAYS = 120;
const MOVIE_TRENDING_PAST_DAYS = 180;
const MOVIE_TRENDING_FUTURE_DAYS = 365;
const MOVIE_THEATRICAL_RECENT_DAYS = 45;
const MOVIE_THEATRICAL_UPCOMING_DAYS = 45;
// A first release older than this is a re-release (back in cinemas, new home edition), not news.
const MOVIE_FIRST_RELEASE_MAX_AGE_DAYS = 365;
const TV_PREMIERE_RECENT_DAYS = 60;
const TV_PREMIERE_UPCOMING_DAYS = 60;
const TV_RECENT_EPISODES_DAYS = 14;
// New episodes count only for series that started within this many years, so long-running
// shows such as The Simpsons do not fill the section.
const TV_RECENT_EPISODES_MAX_SERIES_AGE_YEARS = 10;

interface DailySource {
  source: DailySnapshotSource;
  query: DiscoverQuery;
  /** Keeps only results whose release date falls in this range. */
  releasedBetween?: [string, string];
}

/**
 * The home page sources, in display and dedupe order: a title found by an earlier source of its
 * type is not repeated by a later one.
 */
export function dailySources(params: DailySnapshotParams): DailySource[] {
  const { language, timeZone } = params;
  const today = dateKeyInTimeZone(params.now, timeZone);
  const daysFromToday = (days: number) => addDaysToDateKey(today, days);
  const region = regionFromLanguage(language);
  const firstReleasedRecently: [string, string] = [
    daysFromToday(-MOVIE_FIRST_RELEASE_MAX_AGE_DAYS),
    LAST_DATE_KEY,
  ];
  const movies = (release: 'theatrical' | 'home', from: string, to: string): DiscoverQuery => ({
    kind: 'movies',
    release,
    from,
    to,
    language,
    region,
  });

  return [
    {
      source: 'movie_home_release_recent',
      query: movies('home', daysFromToday(-MOVIE_HOME_RELEASE_DAYS), today),
      releasedBetween: firstReleasedRecently,
    },
    {
      source: 'movie_trending_recent',
      query: { kind: 'trending_movies', language },
      releasedBetween: [
        daysFromToday(-MOVIE_TRENDING_PAST_DAYS),
        daysFromToday(MOVIE_TRENDING_FUTURE_DAYS),
      ],
    },
    {
      source: 'movie_theatrical_recent',
      query: movies('theatrical', daysFromToday(-MOVIE_THEATRICAL_RECENT_DAYS), today),
      releasedBetween: firstReleasedRecently,
    },
    {
      source: 'movie_theatrical_upcoming',
      query: movies('theatrical', daysFromToday(1), daysFromToday(MOVIE_THEATRICAL_UPCOMING_DAYS)),
      releasedBetween: firstReleasedRecently,
    },
    {
      source: 'tv_premiere_recent',
      query: {
        kind: 'tv',
        language,
        timeZone,
        firstAiredFrom: daysFromToday(-TV_PREMIERE_RECENT_DAYS),
        firstAiredTo: today,
      },
    },
    {
      source: 'tv_recent_episodes',
      query: {
        kind: 'tv',
        language,
        timeZone,
        airedFrom: daysFromToday(-TV_RECENT_EPISODES_DAYS),
        airedTo: today,
        firstAiredFrom: addYearsToDateKey(today, -TV_RECENT_EPISODES_MAX_SERIES_AGE_YEARS),
      },
    },
    {
      source: 'tv_premiere_upcoming',
      query: {
        kind: 'tv',
        language,
        timeZone,
        firstAiredFrom: daysFromToday(1),
        firstAiredTo: daysFromToday(TV_PREMIERE_UPCOMING_DAYS),
      },
    },
  ];
}

export async function buildDailySnapshot(
  provider: MediaProviderPort,
  params: DailySnapshotParams,
): Promise<DailySnapshot> {
  const sources = dailySources(params);
  const results = await Promise.all(sources.map(({ query }) => provider.discover(query)));
  const seen = new Set<string>();
  const items = sources.flatMap((source, index) =>
    pickSourceItems(source, results[index] ?? [], seen),
  );

  return {
    generatedAt: params.now.toISOString(),
    language: params.language,
    items,
  };
}

function pickSourceItems(
  source: DailySource,
  results: readonly DiscoveredMedia[],
  seen: Set<string>,
): DailySnapshotItem[] {
  const items: DailySnapshotItem[] = [];

  for (const { releaseDate, ...media } of results) {
    if (items.length >= ITEMS_PER_SOURCE) {
      break;
    }

    const key = mediaKey(media.type, media.remoteId);
    const released =
      !source.releasedBetween || isDateKeyInRange(releaseDate ?? '', ...source.releasedBetween);

    // Titles in other scripts cannot be matched against release names, which are in Latin script.
    if (!released || !hasLatinLetter(media.title) || seen.has(key)) {
      continue;
    }

    seen.add(key);
    items.push({ ...media, source: source.source });
  }

  return items;
}

function mediaKey(type: MediaType, remoteId: string): string {
  return `${type}:${remoteId}`;
}

function regionFromLanguage(language: string): string | undefined {
  const match = /^[a-z]{2,3}-([a-z]{2})$/i.exec(language);
  return match?.[1]?.toUpperCase();
}
