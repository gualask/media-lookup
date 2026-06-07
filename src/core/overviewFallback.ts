import { overviewFallbackCacheKey } from './cacheKeys';
import type { Deps } from './deps';
import { cacheHeaders, errorResponse, jsonResponse } from './responses';
import type { ParsedRoute } from './routes';
import type { DailySnapshot, DailySnapshotItem, OverviewTranslation } from './types';

const OVERVIEW_NOT_FOUND_TTL_SECONDS = 60 * 60 * 24;

type TranslateRoute = Extract<ParsedRoute, { kind: 'translate' }>;

type OverviewTranslationCacheEntry =
  | ({ status: 'found' } & OverviewTranslation)
  | { status: 'not_found' };

export async function handleTranslate(deps: Deps, route: TranslateRoute): Promise<Response> {
  const cacheKey = overviewFallbackCacheKey(route);
  const cached = await safeOverviewTranslationCacheGet(deps, cacheKey);

  if (cached) {
    await deps.metrics.record({
      route: 'translate',
      cache: 'hit',
      provider: 'tmdb',
      tmdbCalls: 0,
      status: cached.status === 'found' ? 'ok' : 'not_found',
      mediaType: route.type,
      language: route.language,
    });

    if (cached.status === 'found') {
      return jsonResponse(
        {
          overview: cached.overview,
          language: cached.language,
        },
        { status: 200 },
        cacheHeaders(deps.config.cacheTtlSeconds),
      );
    }

    return errorResponse(404, 'not_found', 'Overview fallback not found');
  }

  const translation = await deps.provider.findOverviewTranslation(route);

  await deps.metrics.record({
    route: 'translate',
    cache: 'miss',
    provider: 'tmdb',
    tmdbCalls: 1,
    status: translation ? 'ok' : 'not_found',
    mediaType: route.type,
    language: route.language,
  });

  if (!translation) {
    await safeOverviewTranslationCachePut(
      deps,
      cacheKey,
      { status: 'not_found' },
      OVERVIEW_NOT_FOUND_TTL_SECONDS,
    );

    return errorResponse(404, 'not_found', 'Overview fallback not found');
  }

  await safeOverviewTranslationCachePut(
    deps,
    cacheKey,
    { status: 'found', ...translation },
    deps.config.cacheTtlSeconds,
  );

  return jsonResponse(translation, { status: 200 }, cacheHeaders(deps.config.cacheTtlSeconds));
}

export async function hydrateSnapshotOverviewFallbacks(
  deps: Deps,
  snapshot: DailySnapshot,
): Promise<DailySnapshot> {
  const items = await Promise.all(
    snapshot.items.map(async (item) => {
      if (item.overview.trim()) {
        return item;
      }

      const fallback = await safeOverviewTranslationCacheGet(
        deps,
        overviewFallbackCacheKey({
          type: item.type,
          remoteId: item.remoteId,
          language: 'en-US',
        }),
      );

      if (fallback?.status !== 'found') {
        return item;
      }

      return {
        ...item,
        overview: fallback.overview,
      } satisfies DailySnapshotItem;
    }),
  );

  return {
    ...snapshot,
    items,
  };
}

async function safeOverviewTranslationCacheGet(
  deps: Deps,
  key: string,
): Promise<OverviewTranslationCacheEntry | null> {
  try {
    const value = await deps.storage.getText(key);

    if (!value) {
      return null;
    }

    const parsed = JSON.parse(value) as unknown;
    return isOverviewTranslationCacheEntry(parsed) ? parsed : null;
  } catch (error) {
    console.warn('Overview translation cache get failed', error);
    return null;
  }
}

async function safeOverviewTranslationCachePut(
  deps: Deps,
  key: string,
  entry: OverviewTranslationCacheEntry,
  ttlSeconds: number,
): Promise<void> {
  try {
    await deps.storage.putText(key, JSON.stringify(entry), { ttlSeconds });
  } catch (error) {
    console.warn('Overview translation cache put failed', error);
  }
}

function isOverviewTranslationCacheEntry(value: unknown): value is OverviewTranslationCacheEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<OverviewTranslationCacheEntry>;

  if (candidate.status === 'not_found') {
    return true;
  }

  return (
    candidate.status === 'found' &&
    typeof candidate.overview === 'string' &&
    typeof candidate.language === 'string'
  );
}
