import { errorResponse } from './responses';
import type { AppConfig, LookupParams } from './types';

const LOOKUP_BATCH_MAX_ITEMS = 10;

export async function parseLookupBatchRequest(
  request: Request,
  config: AppConfig,
): Promise<{ ok: true; items: LookupParams[] } | { ok: false; response: Response }> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      response: errorResponse(400, 'bad_request', 'Request body must be valid JSON'),
    };
  }

  if (!isRecord(body) || !Array.isArray(body.items)) {
    return {
      ok: false,
      response: errorResponse(400, 'bad_request', 'Request body must contain an items array'),
    };
  }

  if (body.items.length === 0) {
    return {
      ok: false,
      response: errorResponse(400, 'bad_request', 'Lookup batch items cannot be empty'),
    };
  }

  if (body.items.length > LOOKUP_BATCH_MAX_ITEMS) {
    return {
      ok: false,
      response: errorResponse(
        400,
        'batch_too_large',
        `Lookup batch cannot contain more than ${LOOKUP_BATCH_MAX_ITEMS} items`,
      ),
    };
  }

  const items: LookupParams[] = [];

  for (const [index, value] of body.items.entries()) {
    const parsed = parseLookupBatchItem(value, index, config);

    if (!parsed.ok) {
      return parsed;
    }

    items.push(parsed.item);
  }

  return { ok: true, items };
}

function parseLookupBatchItem(
  value: unknown,
  index: number,
  config: AppConfig,
): { ok: true; item: LookupParams } | { ok: false; response: Response } {
  if (!isRecord(value)) {
    return batchItemError(index, 'item must be an object');
  }

  const unexpected = Object.keys(value).find(
    (key) => key !== 'type' && key !== 'title' && key !== 'year' && key !== 'language',
  );

  if (unexpected) {
    return batchItemError(index, `unexpected field "${unexpected}"`);
  }

  const type = value.type;

  if (type !== 'movie' && type !== 'tv') {
    return batchItemError(index, 'field "type" must be "movie" or "tv"');
  }

  if (typeof value.title !== 'string' || value.title.trim() === '') {
    return batchItemError(index, 'field "title" is required');
  }

  const year = parseBatchYear(value.year, index);

  if (!year.ok) {
    return year;
  }

  const language =
    typeof value.language === 'string' ? value.language.trim() : config.defaultLanguage;

  if (!config.supportedLanguages.includes(language)) {
    return {
      ok: false,
      response: errorResponse(
        400,
        'unsupported_language',
        `Lookup batch item ${index}: field "language" is not supported`,
      ),
    };
  }

  return {
    ok: true,
    item: {
      type,
      title: value.title.trim(),
      year: year.value,
      language,
    },
  };
}

function parseBatchYear(
  value: unknown,
  index: number,
): { ok: true; value?: number } | { ok: false; response: Response } {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1000 || value > 9999) {
    return batchItemError(index, 'field "year" must be a four digit number');
  }

  return { ok: true, value };
}

function batchItemError(index: number, message: string): { ok: false; response: Response } {
  return {
    ok: false,
    response: errorResponse(400, 'bad_request', `Lookup batch item ${index}: ${message}`),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
