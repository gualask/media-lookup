import { handleDaily } from './dailyHandler';
import type { Deps } from './deps';
import { handleError } from './errorHandler';
import { handleLookup, handleLookupBatch } from './lookupHandlers';
import { handleTranslate } from './overviewFallback';
import { handleFavicon, handlePage } from './pageHandlers';
import { enforceAuthorization, enforceRateLimit } from './requestGuards';
import { parseRoute } from './routes';

export async function handleRequest(request: Request, deps: Deps): Promise<Response> {
  const parsed = parseRoute(request, deps.config);

  if (!parsed.ok) {
    return parsed.response;
  }

  const rateLimit = await enforceRateLimit(request, deps, parsed.route.kind);

  if (rateLimit) {
    return rateLimit;
  }

  const authorization = enforceAuthorization(request, deps, parsed.route.kind);

  if (authorization) {
    return authorization;
  }

  try {
    switch (parsed.route.kind) {
      case 'favicon':
        return handleFavicon();
      case 'page':
        return await handlePage(deps);
      case 'lookup':
        return await handleLookup(deps, parsed.route);
      case 'lookup_batch':
        return await handleLookupBatch(request, deps);
      case 'translate':
        return await handleTranslate(deps, parsed.route);
      case 'daily':
        return await handleDaily(deps, parsed.route.language);
    }
  } catch (error) {
    return handleError(error);
  }
}
