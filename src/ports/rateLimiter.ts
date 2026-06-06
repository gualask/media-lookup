export type RateLimitScope = 'public' | 'api';

export interface RateLimitParams {
  scope: RateLimitScope;
  key: string;
}

export interface RateLimitResult {
  success: boolean;
}

export interface RateLimiterPort {
  limit(params: RateLimitParams): Promise<RateLimitResult>;
}
