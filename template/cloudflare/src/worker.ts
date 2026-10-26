// Cloudflare Workers entry. Bindings are declared in wrangler.jsonc; run `bun run types` after editing it.
// Secrets: .dev.vars locally, `wrangler secret put ADMIN_TOKEN` in production.
import { handleRequest, runScheduled } from "./server/app";
import { createServices } from "./services";

export default {
  async fetch(request, env, ctx) {
    const services = createServices(env);
    const response = await handleRequest(request, {
      services,
      build: env.CF_VERSION_METADATA.id,
      assets: (r) => env.ASSETS.fetch(r),
      secrets: { adminToken: env.ADMIN_TOKEN },
    });
    if (services.close) ctx.waitUntil(services.close());
    return response;
  },

  // Add schedules under "triggers.crons" in wrangler.jsonc.
  async scheduled(_controller, env, ctx) {
    const services = createServices(env);
    await runScheduled(services);
    if (services.close) ctx.waitUntil(services.close());
  },
} satisfies ExportedHandler<Env>;
