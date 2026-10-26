import { renderToString } from "preact-render-to-string";
import { App } from "./app";
import { encodeBootstrap, type Bootstrap } from "./bootstrap";
import { documentTitle, pageCacheControl, pageDescription, pageTitle, type ResolvedPage } from "./pages/registry";
import type { SiteInfo, User } from "./shared/types";

const CSP = [
  "default-src 'self'",
  "script-src 'self'", // only /assets/client.js; never inline scripts
  "style-src 'self'", // only /assets/styles.css; blocks style="…" in server HTML
  "img-src 'self' data:",
  "connect-src 'self'", // /api/* only; add third-party APIs here
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CSP,
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderDocument(page: ResolvedPage, site: SiteInfo, url: URL, user: User | null = null): Response {
  const bootstrap: Bootstrap = { page, initialUrl: url.pathname + url.search, site, user };
  const body = renderToString(<App {...bootstrap} server />);
  const title = documentTitle(pageTitle(page), site.name);
  const description = pageDescription(page) ?? site.description;
  const v = encodeURIComponent(site.build);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(site.origin + url.pathname)}">
<link rel="icon" href="/favicon.ico">
<link rel="preload" href="/assets/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/styles.css?v=${v}">
<script type="module" src="/assets/client.js?v=${v}"></script>
</head>
<body class="bg-background text-foreground font-sans antialiased">
<a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:bg-foreground focus:text-background focus:px-3 focus:py-2">Skip to content</a>
<div id="app" data-bootstrap="${encodeBootstrap(bootstrap)}">${body}</div>
</body>
</html>`;

  return new Response(html, {
    status: page.id === "not-found" ? 404 : 200,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": pageCacheControl(page),
    },
  });
}
