import type { MediaMetadata } from '../core/types';

export interface LookupCachePort {
  get(key: string): Promise<MediaMetadata | null>;
  put(key: string, metadata: MediaMetadata, ttlSeconds: number): Promise<void>;
}
