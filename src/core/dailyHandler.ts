import { readDailySnapshot } from './dailySnapshot';
import type { Deps } from './deps';
import { errorResponse, jsonResponse } from './responses';

export async function handleDaily(deps: Deps, language: string): Promise<Response> {
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
