import { errorResponse, methodNotAllowed } from './responses';
import type { AppConfig, LookupParams, OverviewTranslationParams } from './types';

export type ParsedRoute =
  | { kind: 'page' }
  | { kind: 'favicon' }
  | ({ kind: 'lookup' } & LookupParams)
  | ({ kind: 'translate' } & OverviewTranslationParams)
  | { kind: 'daily'; language: string };

export type RouteParseResult =
  | {
      ok: true;
      route: ParsedRoute;
    }
  | {
      ok: false;
      response: Response;
    };

const LOOKUP_PARAMS = new Set(['type', 'title', 'year', 'language']);
const TRANSLATE_PARAMS = new Set(['type', 'id', 'language']);
const DAILY_PARAMS = new Set(['language']);

export function parseRoute(request: Request, config: AppConfig): RouteParseResult {
  if (request.method !== 'GET') {
    return { ok: false, response: methodNotAllowed(['GET']) };
  }

  const url = new URL(request.url);

  if (url.pathname === '/') {
    if (!url.search) {
      return { ok: true, route: { kind: 'page' } };
    }

    return badRequest('Root route does not accept query parameters');
  }

  if (url.pathname === '/favicon.svg' || url.pathname === '/favicon.ico') {
    return { ok: true, route: { kind: 'favicon' } };
  }

  if (url.pathname === '/lookup') {
    return parseLookupRoute(url.searchParams, config);
  }

  if (url.pathname === '/daily') {
    const unexpected = findUnexpectedParam(url.searchParams, DAILY_PARAMS);

    if (unexpected) {
      return badRequest(`Unexpected query parameter: ${unexpected}`);
    }

    const language = parseLanguage(url.searchParams, config);

    if (!language.ok) {
      return language;
    }

    return { ok: true, route: { kind: 'daily', language: language.value } };
  }

  if (url.pathname === '/translate') {
    return parseTranslateRoute(url.searchParams, config);
  }

  return {
    ok: false,
    response: errorResponse(404, 'not_found', 'Route not found'),
  };
}

function parseLookupRoute(searchParams: URLSearchParams, config: AppConfig): RouteParseResult {
  const unexpected = findUnexpectedParam(searchParams, LOOKUP_PARAMS);

  if (unexpected) {
    return badRequest(`Unexpected query parameter: ${unexpected}`);
  }

  const type = searchParams.get('type');

  if (type !== 'movie' && type !== 'tv') {
    return badRequest('Query parameter "type" must be "movie" or "tv"');
  }

  const title = searchParams.get('title')?.trim();

  if (!title) {
    return badRequest('Query parameter "title" is required');
  }

  const year = parseYear(searchParams.get('year'));

  if (!year.ok) {
    return year;
  }

  const language = parseLanguage(searchParams, config);

  if (!language.ok) {
    return language;
  }

  return {
    ok: true,
    route: {
      kind: 'lookup',
      type,
      title,
      year: year.value,
      language: language.value,
    },
  };
}

function parseTranslateRoute(searchParams: URLSearchParams, config: AppConfig): RouteParseResult {
  const unexpected = findUnexpectedParam(searchParams, TRANSLATE_PARAMS);

  if (unexpected) {
    return badRequest(`Unexpected query parameter: ${unexpected}`);
  }

  const type = searchParams.get('type');

  if (type !== 'movie' && type !== 'tv') {
    return badRequest('Query parameter "type" must be "movie" or "tv"');
  }

  const remoteId = searchParams.get('id')?.trim();

  if (!remoteId || !/^\d+$/.test(remoteId)) {
    return badRequest('Query parameter "id" must be a TMDB numeric id');
  }

  const language = parseLanguage(searchParams, config);

  if (!language.ok) {
    return language;
  }

  return {
    ok: true,
    route: {
      kind: 'translate',
      type,
      remoteId,
      language: language.value,
    },
  };
}

function parseLanguage(
  searchParams: URLSearchParams,
  config: AppConfig,
): { ok: true; value: string } | { ok: false; response: Response } {
  const language = searchParams.get('language')?.trim() || config.defaultLanguage;

  if (!config.supportedLanguages.includes(language)) {
    return {
      ok: false,
      response: errorResponse(
        400,
        'unsupported_language',
        'Query parameter "language" is not supported',
      ),
    };
  }

  return { ok: true, value: language };
}

function parseYear(
  value: string | null,
): { ok: true; value?: number } | { ok: false; response: Response } {
  if (!value) {
    return { ok: true, value: undefined };
  }

  if (!/^\d{4}$/.test(value)) {
    return badRequest('Query parameter "year" must be a four digit year');
  }

  return { ok: true, value: Number(value) };
}

function findUnexpectedParam(
  searchParams: URLSearchParams,
  allowedParams: ReadonlySet<string>,
): string | null {
  for (const key of searchParams.keys()) {
    if (!allowedParams.has(key)) {
      return key;
    }
  }

  return null;
}

function badRequest(message: string): { ok: false; response: Response } {
  return {
    ok: false,
    response: errorResponse(400, 'bad_request', message),
  };
}
