import { lookupCacheKey } from './cacheKeys';
import type { Deps } from './deps';
import type { DailySnapshot, DailySnapshotItem, MediaMetadata } from './types';

export function dailySnapshotKey(language: string): string {
  return `daily:v1:${language}`;
}

export async function readDailySnapshot(
  deps: Deps,
  language: string,
): Promise<DailySnapshot | null> {
  const value = await deps.storage.getText(dailySnapshotKey(language));

  if (!value) {
    return null;
  }

  const parsed = JSON.parse(value) as unknown;

  if (!isDailySnapshot(parsed)) {
    return null;
  }

  return parsed;
}

export interface EnsureDailySnapshotResult {
  snapshot: DailySnapshot;
  refreshed: boolean;
}

export async function ensureDailySnapshot(
  deps: Deps,
  language: string,
): Promise<EnsureDailySnapshotResult> {
  const existing = await readDailySnapshot(deps, language);
  const now = deps.now();

  if (existing && isSnapshotFresh(existing, now, deps.config.dailyRefreshTimeZone)) {
    return {
      snapshot: existing,
      refreshed: false,
    };
  }

  const snapshot = await deps.provider.buildDailySnapshot({
    language,
    now,
  });

  await deps.storage.putText(dailySnapshotKey(language), JSON.stringify(snapshot));
  await warmLookupCacheFromSnapshot(deps, snapshot);
  await deps.metrics.record({
    route: 'daily_refresh',
    cache: 'miss',
    provider: 'tmdb',
    tmdbCalls: 4,
    status: 'ok',
    mediaType: 'none',
    language,
  });

  return {
    snapshot,
    refreshed: true,
  };
}

export async function warmLookupCacheFromSnapshot(
  deps: Deps,
  snapshot: DailySnapshot,
): Promise<void> {
  await Promise.all(
    snapshot.items.map((item) => putLookupCacheItem(deps, snapshot.language, item)),
  );
}

async function putLookupCacheItem(
  deps: Deps,
  language: string,
  item: DailySnapshotItem,
): Promise<void> {
  const cacheKey = lookupCacheKey({
    type: item.type,
    title: item.title,
    year: item.year,
    language,
  });

  try {
    await deps.lookupCache.put(cacheKey, snapshotItemToMetadata(item), deps.config.cacheTtlSeconds);
  } catch (error) {
    console.warn('Lookup cache warmup failed', error);
  }
}

function snapshotItemToMetadata(item: DailySnapshotItem): MediaMetadata {
  return {
    type: item.type,
    provider: item.provider,
    remoteId: item.remoteId,
    title: item.title,
    year: item.year,
    overview: item.overview,
    posterPath: item.posterPath,
  };
}

function isDailySnapshot(value: unknown): value is DailySnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<DailySnapshot>;
  return (
    typeof candidate.generatedAt === 'string' &&
    typeof candidate.language === 'string' &&
    Array.isArray(candidate.items)
  );
}

function isSnapshotFresh(snapshot: DailySnapshot, now: Date, timeZone: string): boolean {
  return dayKey(new Date(snapshot.generatedAt), timeZone) === dayKey(now, timeZone);
}

function dayKey(date: Date, timeZone: string): string {
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
