import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('worker', () => {
  it('serves the HTML root in the Cloudflare test runtime', async () => {
    const response = await SELF.fetch('https://media-lookup.example/');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
  });
});
