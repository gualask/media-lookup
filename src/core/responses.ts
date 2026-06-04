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
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');

  if (extraHeaders) {
    for (const [key, value] of new Headers(extraHeaders)) {
      headers.set(key, value);
    }
  }

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

export function htmlResponse(body: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');

  return new Response(body, {
    ...init,
    headers,
  });
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

export function responseWithHeaders(response: Response, headersInit: HeadersInit): Response {
  const headers = new Headers(response.headers);

  for (const [key, value] of new Headers(headersInit)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function cacheHeaders(ttlSeconds: number): HeadersInit {
  return {
    'Cache-Control': `public, max-age=${ttlSeconds}`,
  };
}
