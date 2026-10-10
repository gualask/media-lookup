import type { LookupMetadata } from '../core/types';

export type LookupCacheOrigin = 'lookup' | 'warmup';

export type LookupCacheEntry =
  | { status: 'found'; metadata: LookupMetadata; origin?: LookupCacheOrigin }
  | { status: 'not_found' };

export interface LookupCachePort {
  get(key: string): Promise<LookupCacheEntry | null>;
  put(key: string, entry: LookupCacheEntry, ttlSeconds: number): Promise<void>;
}
