import type { LookupCacheEntry } from '../ports/lookupCache';
import { lookupCacheKey } from './cacheKeys';
import type { Deps } from './deps';
import { parseLookupBatchRequest } from './lookupBatch';
import { cacheHeaders, errorResponse, jsonResponse } from './responses';
import type { ParsedRoute } from './routes';
import type { LookupParams, MediaMetadata } from './types';

const LOOKUP_NOT_FOUND_TTL_SECONDS = 60 * 60 * 24;
const LOOKUP_BATCH_CONCURRENCY = 3;

type LookupRoute = Extract<ParsedRoute, { kind: 'lookup' }>;

type LookupResolution =
  | {
      status: 'found';
      metadata: MediaMetadata;
      cache: 'hit' | 'miss';
      tmdbCalls: number;
    }
  | {
      status: 'not_found';
      cache: 'hit' | 'miss';
      tmdbCalls: number;
    };

type LookupBatchResult =
  | {
      index: number;
      status: 'found';
      metadata: MediaMetadata;
    }
  | {
      index: number;
      status: 'not_found';
    };

export async function handleLookup(deps: Deps, route: LookupRoute): Promise<Response> {
  const resolution = await resolveLookup(deps, route);

  await deps.metrics.record({
    route: 'lookup',
    cache: resolution.cache,
    provider: 'tmdb',
    tmdbCalls: resolution.tmdbCalls,
    status: resolution.status === 'found' ? 'ok' : 'not_found',
    mediaType: route.type,
    language: route.language,
  });

  if (resolution.status === 'found') {
    return jsonResponse(
      resolution.metadata,
      { status: 200 },
      cacheHeaders(deps.config.cacheTtlSeconds),
    );
  }

  return errorResponse(404, 'not_found', 'Media metadata not found');
}

export async function handleLookupBatch(request: Request, deps: Deps): Promise<Response> {
  const parsed = await parseLookupBatchRequest(request, deps.config);

  if (!parsed.ok) {
    return parsed.response;
  }

  const resolutions = await mapWithConcurrency(parsed.items, LOOKUP_BATCH_CONCURRENCY, (item) =>
    resolveLookup(deps, item),
  );
  const results = resolutions.map((resolution, index): LookupBatchResult => {
    if (resolution.status === 'found') {
      return {
        index,
        status: 'found',
        metadata: resolution.metadata,
      };
    }

    return {
      index,
      status: 'not_found',
    };
  });

  await deps.metrics.record({
    route: 'lookup_batch',
    cache: resolutions.some((resolution) => resolution.cache === 'miss') ? 'miss' : 'hit',
    provider: 'tmdb',
    tmdbCalls: resolutions.reduce((sum, resolution) => sum + resolution.tmdbCalls, 0),
    status: results.some((result) => result.status === 'found') ? 'ok' : 'not_found',
    mediaType: commonValue(parsed.items.map((item) => item.type)) ?? 'none',
    language: commonValue(parsed.items.map((item) => item.language)) ?? 'mixed',
  });

  return jsonResponse({ results }, { status: 200 });
}

async function resolveLookup(deps: Deps, params: LookupParams): Promise<LookupResolution> {
  const cacheKey = lookupCacheKey(params);
  const cached = await safeLookupCacheGet(deps, cacheKey);

  if (cached) {
    return cached.status === 'found'
      ? {
          status: 'found',
          metadata: cached.metadata,
          cache: 'hit',
          tmdbCalls: 0,
        }
      : {
          status: 'not_found',
          cache: 'hit',
          tmdbCalls: 0,
        };
  }

  const metadata = await deps.provider.lookup(params);

  if (metadata) {
    await safeLookupCachePut(
      deps,
      cacheKey,
      { status: 'found', metadata },
      deps.config.cacheTtlSeconds,
    );

    return {
      status: 'found',
      metadata,
      cache: 'miss',
      tmdbCalls: 1,
    };
  }

  await safeLookupCachePut(deps, cacheKey, { status: 'not_found' }, LOOKUP_NOT_FOUND_TTL_SECONDS);

  return {
    status: 'not_found',
    cache: 'miss',
    tmdbCalls: 1,
  };
}

async function safeLookupCacheGet(deps: Deps, key: string) {
  try {
    return await deps.lookupCache.get(key);
  } catch (error) {
    console.warn('Lookup cache get failed', error);
    return null;
  }
}

async function safeLookupCachePut(
  deps: Deps,
  key: string,
  entry: LookupCacheEntry,
  ttlSeconds: number,
): Promise<void> {
  try {
    await deps.lookupCache.put(key, entry, ttlSeconds);
  } catch (error) {
    console.warn('Lookup cache put failed', error);
  }
}

async function mapWithConcurrency<T, U>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];

      if (item === undefined) {
        continue;
      }

      results[index] = await mapper(item, index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

function commonValue<T extends string>(values: readonly T[]): T | null {
  const first = values[0];

  if (!first) {
    return null;
  }

  return values.every((value) => value === first) ? first : null;
}
