// Bun entry: Bun.serve() + static files from public/. Settings come from the environment (.env is loaded by Bun).
import { stat } from "node:fs/promises";
import { join, normalize } from "node:path";
import { handleRequest, runScheduled, type App } from "./server/app";
import { createServices } from "./services";

const PUBLIC_DIR = join(import.meta.dir, "..", "public");

/** Files under public/, or a 404. Never escapes PUBLIC_DIR. */
async function serveStatic(request: Request): Promise<Response> {
  let path: string;
  try {
    path = normalize(join(PUBLIC_DIR, decodeURIComponent(new URL(request.url).pathname)));
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!path.startsWith(PUBLIC_DIR + "/")) return new Response("Not found", { status: 404 });
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return new Response("Not found", { status: 404 });
  return new Response(Bun.file(path), {
    headers: { "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" },
  });
}

const services = createServices();
const app: App = {
  services,
  build: process.env.BUILD_ID ?? Date.now().toString(36),
  assets: serveStatic,
  origin: process.env.ORIGIN || undefined,
  secrets: { adminToken: process.env.ADMIN_TOKEN || undefined },
};

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  fetch(request) {
    const { pathname } = new URL(request.url);
    // Same split as Cloudflare's run_worker_first: these never reach the app.
    if (pathname.startsWith("/assets/") || pathname === "/favicon.ico") return serveStatic(request);
    return handleRequest(request, app);
  },
});

// Periodic jobs: hourly. Use an external cron instead if you run more than one process.
setInterval(() => void runScheduled(services).catch(console.error), 60 * 60 * 1000);

console.log(`Listening on ${server.url}`);
