import { handleRequest } from './core/handleRequest';
import { createCloudflareDeps } from './platforms/cloudflare';

export default {
  fetch(request, env) {
    return handleRequest(request, createCloudflareDeps(env));
  },
} satisfies ExportedHandler<Env>;
