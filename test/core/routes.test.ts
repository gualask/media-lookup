import { describe, expect, it } from 'vitest';
import { parseRoute } from '../../src/core/routes';
import { testConfig } from './helpers';

describe('parseRoute', () => {
  it('routes GET / without query params to the HTML page', () => {
    const parsed = parseRoute(new Request('https://example.com/'), testConfig);

    expect(parsed).toEqual({ ok: true, route: { kind: 'page' } });
  });

  it('routes favicon requests', () => {
    expect(parseRoute(new Request('https://example.com/favicon.svg'), testConfig)).toEqual({
      ok: true,
      route: { kind: 'favicon' },
    });
    expect(parseRoute(new Request('https://example.com/favicon.ico'), testConfig)).toEqual({
      ok: true,
      route: { kind: 'favicon' },
    });
  });

  it('routes lookup requests and applies the default language', () => {
    const parsed = parseRoute(
      new Request('https://example.com/lookup?type=movie&title=Dune&year=2024'),
      testConfig,
    );

    expect(parsed).toEqual({
      ok: true,
      route: {
        kind: 'lookup',
        type: 'movie',
        title: 'Dune',
        year: 2024,
        language: 'it-IT',
      },
    });
  });

  it('rejects unsupported languages', async () => {
    const parsed = parseRoute(
      new Request('https://example.com/lookup?type=movie&title=Dune&language=fr-FR'),
      testConfig,
    );

    expect(parsed.ok).toBe(false);

    if (!parsed.ok) {
      expect(parsed.response.status).toBe(400);
      await expect(parsed.response.json()).resolves.toMatchObject({
        error: { code: 'unsupported_language' },
      });
    }
  });

  it('rejects legacy root lookup query params', async () => {
    const parsed = parseRoute(
      new Request('https://example.com/?type=movie&title=Dune&year=2024'),
      testConfig,
    );

    expect(parsed.ok).toBe(false);

    if (!parsed.ok) {
      expect(parsed.response.status).toBe(400);
      await expect(parsed.response.json()).resolves.toMatchObject({
        error: { code: 'bad_request' },
      });
    }
  });

  it('routes overview translation requests', () => {
    const parsed = parseRoute(
      new Request('https://example.com/translate?type=movie&id=693134&language=en-US'),
      testConfig,
    );

    expect(parsed).toEqual({
      ok: true,
      route: {
        kind: 'translate',
        type: 'movie',
        remoteId: '693134',
        language: 'en-US',
      },
    });
  });

  it('rejects overview translation requests with non numeric ids', async () => {
    const parsed = parseRoute(
      new Request('https://example.com/translate?type=movie&id=abc&language=it-IT'),
      testConfig,
    );

    expect(parsed.ok).toBe(false);

    if (!parsed.ok) {
      expect(parsed.response.status).toBe(400);
      await expect(parsed.response.json()).resolves.toMatchObject({
        error: { code: 'bad_request' },
      });
    }
  });

  it('rejects obsolete poster query params', async () => {
    const parsed = parseRoute(
      new Request('https://example.com/?posterPath=%2Fabc123.jpg&size=w185'),
      testConfig,
    );

    expect(parsed.ok).toBe(false);

    if (!parsed.ok) {
      expect(parsed.response.status).toBe(400);
      await expect(parsed.response.json()).resolves.toMatchObject({
        error: { code: 'bad_request' },
      });
    }
  });
});
