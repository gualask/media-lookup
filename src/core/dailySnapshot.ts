import { lookupCacheKey } from './cacheKeys';
import { buildDailySnapshot } from './dailySources';
import { dateKeyInTimeZone } from './dates';
import type { Deps } from './deps';
import { writeLookupCache } from './lookupCache';
import type { DailySnapshot, DailySnapshotItem, LookupMetadata } from './types';

export function dailySnapshotKey(language: string): string {
  return `daily:v5:${language}`;
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
  const timeZone = deps.config.dailyRefreshTimeZone;

  if (existing && isSnapshotFresh(existing, now, timeZone)) {
    return { snapshot: existing, refreshed: false };
  }

  const requestsBefore = deps.provider.requestCount;
  let snapshot: DailySnapshot;

  try {
    snapshot = await buildDailySnapshot(deps.provider, { language, now, timeZone });
  } catch (error) {
    await recordRefresh(deps, language, requestsBefore, 'error');

    // An older snapshot beats an error page; the next visit tries the refresh again.
    if (existing) {
      console.warn('Daily snapshot refresh failed, serving the previous one', error);
      return { snapshot: existing, refreshed: false };
    }

    throw error;
  }

  // A failed write (for example the daily KV write limit) still serves the fresh snapshot.
  // Warmup is skipped because its writes would fail the same way.
  if (await safeStorePut(deps, dailySnapshotKey(language), JSON.stringify(snapshot))) {
    await warmLookupCacheFromSnapshot(deps, snapshot);
  }

  await recordRefresh(deps, language, requestsBefore, 'ok');
  return { snapshot, refreshed: true };
}

async function recordRefresh(
  deps: Deps,
  language: string,
  requestsBefore: number,
  status: 'ok' | 'error',
): Promise<void> {
  await deps.metrics.record({
    route: 'daily_refresh',
    cache: 'miss',
    provider: 'tmdb',
    tmdbCalls: deps.provider.requestCount - requestsBefore,
    status,
    mediaType: 'none',
    language,
  });
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

/** Writes each snapshot item under the key a lookup with the same title and year would use. */
async function warmLookupCacheFromSnapshot(deps: Deps, snapshot: DailySnapshot): Promise<void> {
  await Promise.all(
    snapshot.items.map((item) =>
      writeLookupCache(
        deps.storage,
        lookupCacheKey({
          type: item.type,
          title: item.title,
          year: item.year,
          language: snapshot.language,
        }),
        { status: 'found', metadata: snapshotItemToMetadata(item), origin: 'warmup' },
        deps.config.cacheTtlSeconds,
      ),
    ),
  );
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
  return (
    dateKeyInTimeZone(new Date(snapshot.generatedAt), timeZone) === dateKeyInTimeZone(now, timeZone)
  );
}
