import { lookupCacheKey, overviewFallbackCacheKey } from './cacheKeys';
import { ensureDailySnapshot, readDailySnapshot } from './dailySnapshot';
import type { Deps } from './deps';
import { ProviderConfigurationError, UpstreamProviderError } from './errors';
import { renderPreviewPage } from './htmlPage';
import { cacheHeaders, errorResponse, htmlResponse, jsonResponse } from './responses';
import { parseRoute } from './routes';
import type { DailySnapshot, DailySnapshotItem, MediaMetadata, OverviewTranslation } from './types';

const OVERVIEW_NOT_FOUND_TTL_SECONDS = 60 * 60 * 24;

type OverviewTranslationCacheEntry =
  | ({ status: 'found' } & OverviewTranslation)
  | { status: 'not_found' };

export async function handleRequest(request: Request, deps: Deps): Promise<Response> {
  const parsed = parseRoute(request, deps.config);

  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    switch (parsed.route.kind) {
      case 'page':
        return await handlePage(deps);
      case 'lookup':
        return await handleLookup(deps, parsed.route);
      case 'translate':
        return await handleTranslate(deps, parsed.route);
      case 'daily':
        return await handleDaily(deps, parsed.route.language);
    }
  } catch (error) {
    return handleError(error);
  }
}

async function handlePage(deps: Deps): Promise<Response> {
  const { refreshed, snapshot } = await ensureDailySnapshot(deps, deps.config.defaultLanguage);
  const displaySnapshot = await hydrateSnapshotOverviewFallbacks(deps, snapshot);

  await deps.metrics.record({
    route: 'page',
    cache: refreshed ? 'miss' : 'hit',
    provider: 'none',
    tmdbCalls: 0,
    status: 'ok',
    mediaType: 'none',
    language: deps.config.defaultLanguage,
  });

  return htmlResponse(renderPreviewPage(displaySnapshot));
}

async function handleLookup(
  deps: Deps,
  route: Extract<ReturnType<typeof parseRoute>, { ok: true }>['route'] & { kind: 'lookup' },
): Promise<Response> {
  const cacheKey = lookupCacheKey(route);
  const cached = await safeLookupCacheGet(deps, cacheKey);

  if (cached) {
    await deps.metrics.record({
      route: 'lookup',
      cache: 'hit',
      provider: 'tmdb',
      tmdbCalls: 0,
      status: 'ok',
      mediaType: route.type,
      language: route.language,
    });

    return jsonResponse(cached, { status: 200 }, cacheHeaders(deps.config.cacheTtlSeconds));
  }

  const metadata = await deps.provider.lookup(route);
  const response = metadata
    ? jsonResponse(metadata, { status: 200 }, cacheHeaders(deps.config.cacheTtlSeconds))
    : errorResponse(404, 'not_found', 'Media metadata not found');

  if (metadata) {
    await safeLookupCachePut(deps, cacheKey, metadata);
  }

  await deps.metrics.record({
    route: 'lookup',
    cache: 'miss',
    provider: 'tmdb',
    tmdbCalls: 1,
    status: metadata ? 'ok' : 'not_found',
    mediaType: route.type,
    language: route.language,
  });

  return response;
}

async function handleTranslate(
  deps: Deps,
  route: Extract<ReturnType<typeof parseRoute>, { ok: true }>['route'] & { kind: 'translate' },
): Promise<Response> {
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

async function handleDaily(deps: Deps, language: string): Promise<Response> {
  const snapshot = await readDailySnapshot(deps, language);

  await deps.metrics.record({
    route: 'daily',
    cache: 'bypass',
    provider: 'none',
    tmdbCalls: 0,
    status: snapshot ? 'ok' : 'not_found',
    mediaType: 'none',
    language,
  });

  if (!snapshot) {
    return errorResponse(404, 'not_found', 'Daily snapshot not found');
  }

  return jsonResponse(snapshot);
}

async function hydrateSnapshotOverviewFallbacks(
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

function handleError(error: unknown): Response {
  console.error(error);

  if (error instanceof ProviderConfigurationError) {
    return errorResponse(500, 'provider_configuration_error', error.message);
  }

  if (error instanceof UpstreamProviderError) {
    return errorResponse(502, 'upstream_provider_error', error.message);
  }

  return errorResponse(500, 'internal_error', 'Internal server error');
}

async function safeLookupCacheGet(deps: Deps, key: string) {
  try {
    return await deps.lookupCache.get(key);
  } catch (error) {
    console.warn('Lookup cache get failed', error);
    return null;
  }
}

async function safeLookupCachePut(deps: Deps, key: string, metadata: MediaMetadata): Promise<void> {
  try {
    await deps.lookupCache.put(key, metadata, deps.config.cacheTtlSeconds);
  } catch (error) {
    console.warn('Lookup cache put failed', error);
  }
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
