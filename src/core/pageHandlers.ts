import { ensureDailySnapshot } from './dailySnapshot';
import type { Deps } from './deps';
import { renderPreviewPage } from './htmlPage';
import { hydrateSnapshotOverviewFallbacks } from './overviewFallback';
import { cacheHeaders, htmlResponse, svgResponse } from './responses';

const FAVICON_CACHE_TTL_SECONDS = 60 * 60 * 24 * 365;
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#111318"/>
  <circle cx="28" cy="28" r="15" fill="none" stroke="#8fb7ff" stroke-width="6"/>
  <path d="M39 39L52 52" stroke="#8fb7ff" stroke-width="6" stroke-linecap="round"/>
  <path d="M25 20L37 28L25 36Z" fill="#f4f5f7"/>
</svg>`;

export async function handlePage(deps: Deps): Promise<Response> {
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

export function handleFavicon(): Response {
  return svgResponse(FAVICON_SVG, { status: 200 }, cacheHeaders(FAVICON_CACHE_TTL_SECONDS));
}
