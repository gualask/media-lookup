import type { MediaMetadata } from '../core/types';

export type LookupCacheEntry =
  | { status: 'found'; metadata: MediaMetadata }
  | { status: 'not_found' };

export interface LookupCachePort {
  get(key: string): Promise<LookupCacheEntry | null>;
  put(key: string, entry: LookupCacheEntry, ttlSeconds: number): Promise<void>;
}
