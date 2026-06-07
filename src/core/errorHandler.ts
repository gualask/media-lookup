import { ProviderConfigurationError, UpstreamProviderError } from './errors';
import { errorResponse } from './responses';

export function handleError(error: unknown): Response {
  console.error(error);

  if (error instanceof ProviderConfigurationError) {
    return errorResponse(500, 'provider_configuration_error', error.message);
  }

  if (error instanceof UpstreamProviderError) {
    return errorResponse(502, 'upstream_provider_error', error.message);
  }

  return errorResponse(500, 'internal_error', 'Internal server error');
}
