import { normalizeTitle } from './titles';
import type { LookupParams } from './types';

export function lookupCacheKey(params: LookupParams): string {
  return [
    'lookup',
    'v3',
    params.language,
    params.type,
    encodeURIComponent(normalizeTitle(params.title)),
    params.year?.toString() ?? 'none',
  ].join(':');
}
