// The platform-neutral server: one function from Request to Response.
// Entries (src/worker.ts on Cloudflare, src/bun.ts on Bun) build an App and call handleRequest().
import { PAGE_IDS, PAGES, pageCacheControl } from "../pages/registry";
import type { Services, Session } from "../platform/types";
import { signInPath } from "../shared/auth";
import type { SiteInfo, User } from "../shared/types";
import { SITE } from "../site";
import { renderDocument, SECURITY_HEADERS } from "../ssr";
import { pruneGuestbook, signGuestbook } from "./api/guestbook";
import { deleteMedia, getMedia, putMedia } from "./api/media";
import { createNote } from "./api/notes";
import { HttpError, json, redirect } from "./http";
import { resolvePage } from "./loaders";

export interface App {
  services: Services;
  /** Cache-busting version for /assets/client.js and /assets/styles.css. */
  build: string;
  /** Static files from public/. Must return a 404 response for missing files. */
  assets?: (request: Request) => Promise<Response>;
  /** Public origin when running behind a proxy; defaults to the request's origin. */
  origin?: string;
  /** Values that must never reach the browser. Unset → the endpoints that need them answer 401. */
  secrets: { adminToken?: string };
}

export interface RouteContext {
  request: Request;
  app: App;
  url: URL;
  params: Record<string, string>;
  /** The signed-in user and session (--auth); null for anonymous requests and apps without auth. */
  user: User | null;
  session: Session | null;
}
export type Handler = (ctx: RouteContext) => Promise<Response> | Response;

const route = (method: string, pathname: string, handler: Handler) =>
  [method, new URLPattern({ pathname }), handler] as const;

// Non-page endpoints. Everything else that is a GET goes to the page registry.
// /api/* responses are private + no-store unless the handler sets its own Cache-Control.
const ROUTES = [
  route("GET", "/api/page", pageData),
  route("POST", "/api/guestbook", signGuestbook),
  route("POST", "/api/admin/notes", createNote),
  route("PUT", "/api/admin/media/:key+", putMedia),
  route("DELETE", "/api/admin/media/:key+", deleteMedia),
  route("GET", "/media/:key+", getMedia),
  route("GET", "/robots.txt", robots),
  route("GET", "/sitemap.xml", sitemap),
];

const siteInfo = (app: App, url: URL): SiteInfo => ({ ...SITE, origin: app.origin ?? url.origin, build: app.build });

/** Page data for client-side navigation: GET /api/page?path=/notes/x → { id, data }. */
async function pageData({ app, url, session }: RouteContext): Promise<Response> {
  const path = url.searchParams.get("path");
  if (!path || !path.startsWith("/") || path.startsWith("//")) throw new HttpError(400, "invalid_path");
  const target = new URL(path, url.origin);
  if (target.origin !== url.origin) throw new HttpError(400, "invalid_path");
  const page = await resolvePage(app.services, target, session); // 401 for auth: "required" pages
  if (page.id === "not-found") throw new HttpError(404, "not_found");
  // Same caching as the page's HTML (the registry's `cache` setting).
  return json(page, { headers: { "Cache-Control": pageCacheControl(page) } });
}

function robots({ app, url }: RouteContext): Response {
  const origin = app.origin ?? url.origin;
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}

function sitemap({ app, url }: RouteContext): Response {
  // Public registry paths without :params. Loaders can contribute extra URLs here later.
  const origin = app.origin ?? url.origin;
  const paths = PAGE_IDS.filter((id) => !PAGES[id].auth)
    .map((id) => PAGES[id].path)
    .filter((path) => !path.includes(":"));
  const urls = paths.map((path) => `  <url><loc>${origin}${path}</loc></url>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}

async function handle(request: Request, app: App, url: URL): Promise<Response> {
  const method = request.method === "HEAD" ? "GET" : request.method;
  const { auth } = app.services;

  if (auth && url.pathname.startsWith("/auth/")) {
    const response = await auth.handle(request, app.origin ?? url.origin);
    if (response) return response;
  }
  const session = auth ? await auth.session(request) : null;
  const user = session?.user ?? null;

  const allowed: string[] = [];
  for (const [routeMethod, pattern, handler] of ROUTES) {
    const match = pattern.exec({ pathname: url.pathname });
    if (!match) continue;
    if (routeMethod === method) {
      return handler({ request, app, url, params: match.pathname.groups as Record<string, string>, user, session });
    }
    allowed.push(routeMethod === "GET" ? "GET, HEAD" : routeMethod);
  }
  if (allowed.length > 0) throw new HttpError(405, "method_not_allowed", { Allow: allowed.join(", ") });

  if (url.pathname.startsWith("/api/")) throw new HttpError(404, "not_found");
  if (method !== "GET") throw new HttpError(405, "method_not_allowed", { Allow: "GET, HEAD" });

  // Resolve once: the same result decides between a static file, the page and the 404 page.
  let page;
  try {
    page = await resolvePage(app.services, url, session);
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) return redirect(signInPath(url.pathname + url.search));
    throw error;
  }
  if (page.id === "not-found" && app.assets) {
    const asset = await app.assets(request);
    if (asset.status !== 404) return asset;
  }
  const response = renderDocument(page, siteInfo(app, url), url, user);
  if (auth && response.headers.get("Cache-Control") !== "no-store") {
    // Every page shows who is signed in, so no shared cache may keep it and browsers must revalidate.
    response.headers.set("Cache-Control", "private, no-cache");
    response.headers.append("Vary", "Cookie");
  }
  return response;
}

export async function handleRequest(request: Request, app: App): Promise<Response> {
  const url = new URL(request.url);
  let response: Response;
  try {
    response = await handle(request, app, url);
  } catch (error) {
    if (error instanceof HttpError) {
      response = json({ error: error.code }, { status: error.status, headers: error.headers });
    } else {
      console.error(
        JSON.stringify({
          level: "error",
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          method: request.method,
          path: url.pathname,
        }),
      );
      return new Response("Internal Server Error", {
        status: 500,
        headers: { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
  }

  if (url.pathname.startsWith("/api/") && !response.headers.has("Cache-Control")) {
    response = new Response(response.body, response);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.append("Vary", "Origin");
  }
  return response;
}

/** Periodic jobs. Cloudflare calls this from cron triggers; on Bun, src/bun.ts runs it hourly. */
export async function runScheduled(services: Services): Promise<void> {
  const removed = await pruneGuestbook(services.db);
  const sessionsRemoved = services.auth ? await services.auth.prune() : 0;
  console.log(JSON.stringify({ level: "info", message: "scheduled run", guestbookRemoved: removed, sessionsRemoved }));
}
