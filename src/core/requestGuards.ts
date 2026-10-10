import type { Deps } from './deps';
import { errorResponse } from './responses';
import type { ParsedRoute } from './routes';

const RATE_LIMIT_RETRY_AFTER_SECONDS = 60;

type RouteKind = ParsedRoute['kind'];

export async function enforceRateLimit(
  request: Request,
  deps: Deps,
  routeKind: RouteKind,
): Promise<Response | null> {
  if (routeKind === 'favicon') {
    return null;
  }

  const scope = routeKind === 'page' ? 'public' : 'api';
  const result = await deps.rateLimiter.limit({
    scope,
    key: rateLimitKey(request, routeKind),
  });

  if (result.success) {
    return null;
  }

  return errorResponse(429, 'rate_limited', 'Rate limit exceeded', {
    'Retry-After': RATE_LIMIT_RETRY_AFTER_SECONDS.toString(),
  });
}

export function enforceAuthorization(
  request: Request,
  deps: Deps,
  routeKind: RouteKind,
): Response | null {
  if (routeKind === 'page' || routeKind === 'favicon' || !deps.config.apiBearerToken) {
    return null;
  }

  if (constantTimeEqual(bearerToken(request) ?? '', deps.config.apiBearerToken)) {
    return null;
  }

  return errorResponse(401, 'unauthorized', 'Missing or invalid bearer token', {
    'WWW-Authenticate': 'Bearer',
  });
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('Authorization');
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? '');

  return match?.[1]?.trim() || null;
}

// Compares every byte so the response time does not reveal how much of the token matched.
function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

function rateLimitKey(request: Request, routeKind: RouteKind): string {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';

  return `${routeKind}:${ip}`;
}
