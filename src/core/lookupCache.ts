import type { StoragePort } from '../ports/storage';
import type { LookupMetadata } from './types';

/** Who wrote a found entry: a lookup that reached TMDB, or the daily snapshot warmup. */
export type LookupCacheOrigin = 'lookup' | 'warmup';

export type LookupCacheEntry =
  | { status: 'found'; metadata: LookupMetadata; origin?: LookupCacheOrigin }
  | { status: 'not_found' };

/** A missing, unreadable or malformed entry reads as a miss: the lookup simply asks TMDB again. */
export async function readLookupCache(
  storage: StoragePort,
  key: string,
): Promise<LookupCacheEntry | null> {
  try {
    const value = await storage.getText(key);
    return value ? parseLookupCacheEntry(JSON.parse(value) as unknown) : null;
  } catch (error) {
    console.warn('Lookup cache get failed', error);
    return null;
  }
}

/** A failed write (for example the daily KV write limit) only costs the next lookup a TMDB call. */
export async function writeLookupCache(
  storage: StoragePort,
  key: string,
  entry: LookupCacheEntry,
  ttlSeconds: number,
): Promise<boolean> {
  try {
    await storage.putText(key, JSON.stringify(entry), { ttlSeconds });
    return true;
  } catch (error) {
    console.warn('Lookup cache put failed', error);
    return false;
  }
}

function parseLookupCacheEntry(value: unknown): LookupCacheEntry | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as { status?: unknown; metadata?: unknown; origin?: unknown };

  if (candidate.status === 'not_found') {
    return { status: 'not_found' };
  }

  if (candidate.status !== 'found' || !isLookupMetadata(candidate.metadata)) {
    return null;
  }

  return {
    status: 'found',
    metadata: candidate.metadata,
    ...(candidate.origin === 'lookup' || candidate.origin === 'warmup'
      ? { origin: candidate.origin }
      : {}),
  };
}

function isLookupMetadata(value: unknown): value is LookupMetadata {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<LookupMetadata>;
  return (
    (candidate.type === 'movie' || candidate.type === 'tv') &&
    candidate.provider === 'tmdb' &&
    typeof candidate.remoteId === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.overview === 'string' &&
    (candidate.match === 'year' || candidate.match === 'title' || candidate.match === 'uncertain')
  );
}
