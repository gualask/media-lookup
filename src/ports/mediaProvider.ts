import type { LookupMetadata, LookupParams, MediaMetadata } from '../core/types';

/**
 * What the daily snapshot asks a provider for. The core decides which windows and kinds of
 * titles count as news; the provider only translates them into its own API.
 */
export type DiscoverQuery =
  | { kind: 'trending_movies'; language: string }
  | {
      kind: 'movies';
      /** `theatrical` for cinema releases, `home` for streaming, rental or purchase. */
      release: 'theatrical' | 'home';
      /** Release date range, as `YYYY-MM-DD`. */
      from: string;
      to: string;
      language: string;
      /** ISO 3166-1 country whose release dates and availability count. */
      region?: string;
    }
  | {
      /** Fiction only: scripted series and miniseries, without news, talk shows or daily soaps. */
      kind: 'tv';
      language: string;
      timeZone: string;
      /** First air date range, as `YYYY-MM-DD`. */
      firstAiredFrom?: string;
      firstAiredTo?: string;
      /** Range in which any episode aired, as `YYYY-MM-DD`. */
      airedFrom?: string;
      airedTo?: string;
    };

export interface DiscoveredMedia extends MediaMetadata {
  /** Movie primary release date or series first air date, as `YYYY-MM-DD`. */
  releaseDate?: string;
}

export interface MediaProviderPort {
  lookup(params: LookupParams): Promise<LookupMetadata | null>;
  /** Results in the provider's popularity order. */
  discover(query: DiscoverQuery): Promise<DiscoveredMedia[]>;
  /** Upstream requests made so far, retries included, for metrics. */
  readonly requestCount: number;
}
