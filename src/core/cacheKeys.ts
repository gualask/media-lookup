import type { LookupParams, OverviewTranslationParams } from './types';

export function lookupCacheKey(params: LookupParams): string {
  return [
    'lookup',
    'v2',
    params.language,
    params.type,
    encodeURIComponent(normalizeTitle(params.title)),
    params.year?.toString() ?? 'none',
  ].join(':');
}

export function overviewFallbackCacheKey(params: OverviewTranslationParams): string {
  return [
    'overview_fallback',
    'v1',
    params.language,
    params.type,
    encodeURIComponent(params.remoteId),
  ].join(':');
}

export function normalizeTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
