export interface ErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export function jsonResponse(
  body: unknown,
  init: ResponseInit = {},
  extraHeaders?: HeadersInit,
): Response {
  return respond(JSON.stringify(body), 'application/json; charset=utf-8', init, extraHeaders);
}

export function htmlResponse(body: string, init: ResponseInit = {}): Response {
  return respond(body, 'text/html; charset=utf-8', init);
}

export function svgResponse(
  body: string,
  init: ResponseInit = {},
  extraHeaders?: HeadersInit,
): Response {
  return respond(body, 'image/svg+xml; charset=utf-8', init, extraHeaders);
}

function respond(
  body: string,
  contentType: string,
  init: ResponseInit,
  extraHeaders?: HeadersInit,
): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', contentType);

  for (const [key, value] of new Headers(extraHeaders)) {
    headers.set(key, value);
  }

  return new Response(body, { ...init, headers });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  headers?: HeadersInit,
): Response {
  return jsonResponse(
    {
      error: { code, message },
    } satisfies ErrorBody,
    { status },
    headers,
  );
}

export function methodNotAllowed(allowedMethods: readonly string[]): Response {
  return errorResponse(405, 'method_not_allowed', 'Method not allowed', {
    Allow: allowedMethods.join(', '),
  });
}

export function cacheHeaders(
  ttlSeconds: number,
  visibility: 'public' | 'private' = 'public',
): HeadersInit {
  return {
    'Cache-Control': `${visibility}, max-age=${ttlSeconds}`,
  };
}
