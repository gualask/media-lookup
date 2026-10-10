import { ProviderConfigurationError, UpstreamProviderError } from '../../core/errors';

const API_BASE_URL = 'https://api.themoviedb.org/3';
const DEFAULT_RETRY_AFTER_SECONDS = 1;
const MAX_RETRY_AFTER_SECONDS = 3;

export type Sleep = (ms: number) => Promise<void>;

const sleepWithTimer: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** TMDB API v3 over HTTP, authenticated with a read access token. */
export class TmdbHttpClient {
  private requests = 0;

  constructor(
    private readonly token: string,
    private readonly fetchFn: typeof fetch,
    private readonly sleep: Sleep = sleepWithTimer,
  ) {}

  /** Requests sent so far, retries included. */
  get requestCount(): number {
    return this.requests;
  }

  async get<T>(path: string, params: Record<string, string>): Promise<T> {
    if (!this.token) {
      throw new ProviderConfigurationError('TMDB_TOKEN is missing');
    }

    const url = new URL(`${API_BASE_URL}${path}`);

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    let response = await this.send(url);

    // TMDB asks clients to respect 429: wait as told, within a bound, and try once more.
    if (response.status === 429) {
      await this.sleep(retryAfterMs(response.headers.get('Retry-After')));
      response = await this.send(url);
    }

    if (!response.ok) {
      throw new UpstreamProviderError('TMDB API request failed', response.status);
    }

    return response.json() as Promise<T>;
  }

  private send(url: URL): Promise<Response> {
    this.requests += 1;

    return this.fetchFn(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
    });
  }
}

function retryAfterMs(header: string | null): number {
  // `Number(null)` and `Number('')` are 0: a missing header must not mean "retry at once".
  const seconds = header?.trim() ? Number(header) : Number.NaN;
  const bounded = Number.isFinite(seconds) && seconds >= 0 ? seconds : DEFAULT_RETRY_AFTER_SECONDS;

  return Math.min(bounded, MAX_RETRY_AFTER_SECONDS) * 1000;
}
