import { lookupCacheKey } from './cacheKeys';
import type { Deps } from './deps';
import type { DailySnapshot, DailySnapshotItem, LookupMetadata } from './types';

const DAILY_SNAPSHOT_TMDB_CALLS = 6;

export function dailySnapshotKey(language: string): string {
  return `daily:v4:${language}`;
}

export async function readDailySnapshot(
  deps: Deps,
  language: string,
): Promise<DailySnapshot | null> {
  const value = await deps.storage.getText(dailySnapshotKey(language));

  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isDailySnapshot(parsed) ? parsed : null;
  } catch (error) {
    console.warn('Daily snapshot parse failed', error);
    return null;
  }
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
    timeZone: deps.config.dailyRefreshTimeZone,
  });

  // A failed write (for example the daily KV write limit) still serves the fresh snapshot.
  // Warmup is skipped because its writes would fail the same way.
  if (await safeStorePut(deps, dailySnapshotKey(language), JSON.stringify(snapshot))) {
    await warmLookupCacheFromSnapshot(deps, snapshot);
  }

  await deps.metrics.record({
    route: 'daily_refresh',
    cache: 'miss',
    provider: 'tmdb',
    tmdbCalls: DAILY_SNAPSHOT_TMDB_CALLS,
    status: 'ok',
    mediaType: 'none',
    language,
  });

  return {
    snapshot,
    refreshed: true,
  };
}

async function safeStorePut(deps: Deps, key: string, value: string): Promise<boolean> {
  try {
    await deps.storage.putText(key, value);
    return true;
  } catch (error) {
    console.warn('Daily snapshot put failed', error);
    return false;
  }
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
    await deps.lookupCache.put(
      cacheKey,
      { status: 'found', metadata: snapshotItemToMetadata(item), origin: 'warmup' },
      deps.config.cacheTtlSeconds,
    );
  } catch (error) {
    console.warn('Lookup cache warmup failed', error);
  }
}

// Warmup keys carry the TMDB year when there is one, so a lookup that hits them sent that year.
function snapshotItemToMetadata(item: DailySnapshotItem): LookupMetadata {
  return {
    type: item.type,
    provider: item.provider,
    remoteId: item.remoteId,
    title: item.title,
    year: item.year,
    overview: item.overview,
    posterPath: item.posterPath,
    match: item.year ? 'year' : 'uncertain',
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
