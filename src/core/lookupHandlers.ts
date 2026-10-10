import { lookupCacheKey } from './cacheKeys';
import type { Deps } from './deps';
import { UpstreamProviderError } from './errors';
import { parseLookupBatchRequest } from './lookupBatch';
import { type LookupCacheOrigin, readLookupCache, writeLookupCache } from './lookupCache';
import { cacheHeaders, errorResponse, jsonResponse } from './responses';
import type { ParsedRoute } from './routes';
import type { LookupMetadata, LookupParams } from './types';

const LOOKUP_NOT_FOUND_TTL_SECONDS = 60 * 60 * 24;
const LOOKUP_BATCH_CONCURRENCY = 3;

type LookupRoute = Extract<ParsedRoute, { kind: 'lookup' }>;

type LookupResolution =
  | {
      status: 'found';
      metadata: LookupMetadata;
      cache: 'hit' | 'miss';
      origin?: LookupCacheOrigin;
    }
  | {
      status: 'not_found';
      cache: 'hit' | 'miss';
    };

// Only batch items can fail on their own; a single lookup still answers 502.
type BatchItemResolution = LookupResolution | { status: 'error'; cache: 'miss'; message: string };

type LookupBatchResult =
  | { index: number; status: 'found'; metadata: LookupMetadata }
  | { index: number; status: 'not_found' }
  | { index: number; status: 'error'; error: { message: string } };

export async function handleLookup(deps: Deps, route: LookupRoute): Promise<Response> {
  const requestsBefore = deps.provider.requestCount;
  const resolution = await resolveLookup(deps, route);

  await deps.metrics.record({
    route: 'lookup',
    cache: resolution.cache,
    provider: 'tmdb',
    tmdbCalls: deps.provider.requestCount - requestsBefore,
    status: resolution.status === 'found' ? 'ok' : 'not_found',
    mediaType: route.type,
    language: route.language,
    ...lookupCounts([resolution]),
  });

  if (resolution.status === 'found') {
    return jsonResponse(
      resolution.metadata,
      { status: 200 },
      cacheHeaders(deps.config.cacheTtlSeconds, 'private'),
    );
  }

  return errorResponse(404, 'not_found', 'Media metadata not found');
}

export async function handleLookupBatch(request: Request, deps: Deps): Promise<Response> {
  const parsed = await parseLookupBatchRequest(request, deps.config);

  if (!parsed.ok) {
    return parsed.response;
  }

  const requestsBefore = deps.provider.requestCount;
  const resolutions = await mapWithConcurrency(parsed.items, LOOKUP_BATCH_CONCURRENCY, (item) =>
    resolveBatchItem(deps, item),
  );
  const results = resolutions.map((resolution, index) => batchResult(resolution, index));

  await deps.metrics.record({
    route: 'lookup_batch',
    cache: resolutions.some((resolution) => resolution.cache === 'miss') ? 'miss' : 'hit',
    provider: 'tmdb',
    tmdbCalls: deps.provider.requestCount - requestsBefore,
    status: batchStatus(results),
    mediaType: commonValue(parsed.items.map((item) => item.type)) ?? 'none',
    language: commonValue(parsed.items.map((item) => item.language)) ?? 'mixed',
    ...lookupCounts(resolutions),
  });

  return jsonResponse({ results }, { status: 200 });
}

function batchResult(resolution: BatchItemResolution, index: number): LookupBatchResult {
  switch (resolution.status) {
    case 'found':
      return { index, status: 'found', metadata: resolution.metadata };
    case 'error':
      return { index, status: 'error', error: { message: resolution.message } };
    case 'not_found':
      return { index, status: 'not_found' };
  }
}

// One TMDB failure (a 429 that persists, a 5xx) fails only its own item: the client keeps the
// other results and retries the failed one with its own backoff.
async function resolveBatchItem(deps: Deps, params: LookupParams): Promise<BatchItemResolution> {
  try {
    return await resolveLookup(deps, params);
  } catch (error) {
    if (!(error instanceof UpstreamProviderError)) {
      throw error;
    }

    console.warn('Lookup batch item failed', error.status, error.message);
    return {
      status: 'error',
      cache: 'miss',
      message: error.status ? `${error.message} (${error.status})` : error.message,
    };
  }
}

function batchStatus(results: readonly LookupBatchResult[]): 'ok' | 'not_found' | 'error' {
  if (results.some((result) => result.status === 'found')) {
    return 'ok';
  }

  return results.some((result) => result.status === 'error') ? 'error' : 'not_found';
}

async function resolveLookup(deps: Deps, params: LookupParams): Promise<LookupResolution> {
  const cacheKey = lookupCacheKey(params);
  const cached = await readLookupCache(deps.storage, cacheKey);

  if (cached?.status === 'found') {
    return { status: 'found', metadata: cached.metadata, cache: 'hit', origin: cached.origin };
  }

  if (cached?.status === 'not_found') {
    return { status: 'not_found', cache: 'hit' };
  }

  const metadata = await deps.provider.lookup(params);

  if (metadata) {
    await writeLookupCache(
      deps.storage,
      cacheKey,
      { status: 'found', metadata, origin: 'lookup' },
      deps.config.cacheTtlSeconds,
    );

    return { status: 'found', metadata, cache: 'miss' };
  }

  await writeLookupCache(
    deps.storage,
    cacheKey,
    { status: 'not_found' },
    LOOKUP_NOT_FOUND_TTL_SECONDS,
  );

  return { status: 'not_found', cache: 'miss' };
}

async function mapWithConcurrency<T, U>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];

      if (item !== undefined) {
        results[index] = await mapper(item);
      }
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

function lookupCounts(resolutions: readonly BatchItemResolution[]) {
  return {
    items: resolutions.length,
    errors: resolutions.filter((resolution) => resolution.status === 'error').length,
    cacheHits: resolutions.filter((resolution) => resolution.cache === 'hit').length,
    warmupHits: resolutions.filter(
      (resolution) => resolution.status === 'found' && resolution.origin === 'warmup',
    ).length,
  };
}

function commonValue<T extends string>(values: readonly T[]): T | null {
  const first = values[0];

  if (!first) {
    return null;
  }

  return values.every((value) => value === first) ? first : null;
}
