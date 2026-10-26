import { afterEach, describe, expect, test } from "bun:test";
import { renderToString } from "preact-render-to-string";
import { App } from "../src/app";
import { decodeBootstrap, type Bootstrap } from "../src/bootstrap";
import { PAGES, pageDescription, pageTitle, type ResolvedPage } from "../src/pages/registry";
import { resolvePage } from "../src/server/loaders";
import type { SiteInfo } from "../src/shared/types";
import { renderDocument } from "../src/ssr";
import { NOTES, testDb } from "./test-app";

const site: SiteInfo = { name: "Klein", description: "A small, fast website.", origin: "https://example.com", build: "b1" };

async function render(path: string) {
  const url = new URL(path, site.origin);
  const page = await resolvePage({ db: testDb() }, url);
  const response = renderDocument(page, site, url);
  return { page, response, html: await response.text() };
}

describe("renderDocument", () => {
  test("renders page content inside the shell", async () => {
    const { response, html } = await render("/notes");
    expect(response.status).toBe(200);
    expect(html).toContain("<h1");
    expect(html).toContain("Second note");
    expect(html).toContain('id="main"');
    expect(html).toContain('href="#main"');
    expect(html).toContain('<link rel="canonical" href="https://example.com/notes">');
    expect(html).toContain('href="/assets/styles.css?v=b1"');
    expect(html).toContain('<script type="module" src="/assets/client.js?v=b1"></script>');
  });

  test("bootstrap is an attribute, never an inline script", async () => {
    const { html } = await render("/notes/second");
    const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) ?? [];
    expect(scripts).toEqual(['<script type="module" src="/assets/client.js?v=b1"></script>']);
    const encoded = html.match(/data-bootstrap="([A-Za-z0-9_-]+)"/)?.[1];
    expect(encoded).toBeDefined();
    const bootstrap = decodeBootstrap(encoded!);
    expect(bootstrap.initialUrl).toBe("/notes/second");
    expect(bootstrap.page.id).toBe("note");
  });

  test("</script> in data is harmless", async () => {
    const { html } = await render("/notes/second");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;/script>&lt;script>alert(1)&lt;/script>");
    const encoded = html.match(/data-bootstrap="([^"]+)"/)![1]!;
    const page = decodeBootstrap(encoded).page as { data: { note: { body: string } } };
    expect(page.data.note.body).toBe(NOTES[0]!.body);
  });

  test("titles and descriptions come from the registry", async () => {
    const home = await render("/");
    expect(home.html).toContain("<title>Klein</title>");
    expect(home.html).toContain('<meta name="description" content="A small, fast website.">');

    const notes = await render("/notes");
    expect(notes.html).toContain("<title>Notes — Klein</title>");

    const note = await render("/notes/second");
    expect(note.html).toContain(`<title>${pageTitle(note.page)} — Klein</title>`);
    expect(pageTitle(note.page)).toBe("Second note");
    expect(note.html).toContain('<meta name="description" content="The newer one.">');
    expect(pageDescription(note.page)).toBe("The newer one.");
  });

  test("not found is a 404 page with no-store", async () => {
    const { response, html } = await render("/notes/missing");
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(html).toContain("Page not found");
  });

  test("security headers", async () => {
    const { response } = await render("/");
    const csp = response.headers.get("Content-Security-Policy")!;
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60, stale-while-revalidate=300");
  });

  test("per-page cache: guestbook is never cached", async () => {
    expect((await render("/guestbook")).response.headers.get("Cache-Control")).toBe("no-store");
  });

  test("no inline style attributes", async () => {
    for (const path of ["/", "/notes", "/notes/second", "/guestbook", "/nope"]) {
      const { html } = await render(path);
      expect(html).not.toMatch(/\sstyle=/);
    }
  });
});

describe("hydration parity", () => {
  const realLocation = (globalThis as { location?: unknown }).location;
  afterEach(() => {
    (globalThis as { location?: unknown }).location = realLocation;
  });

  function stubLocation(path: string) {
    const url = new URL(path, site.origin);
    (globalThis as { location?: unknown }).location = {
      href: url.href,
      origin: url.origin,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
    };
  }

  const cases: [string, ResolvedPage["id"]][] = [
    ["/", "home"],
    ["/notes", "notes"],
    ["/notes/first", "note"],
    ["/notes/missing", "not-found"],
    ["/guestbook", "guestbook"],
    ["/guestbook?notice=signed", "guestbook"],
    ["/no/such/page", "not-found"],
  ];

  for (const [path, id] of cases) {
    test(`${path} (${id}): browser tree equals server tree`, async () => {
      const page = await resolvePage({ db: testDb() }, new URL(path, site.origin));
      expect(page.id).toBe(id);
      const bootstrap: Bootstrap = { page, initialUrl: path, site, user: null };
      const server = renderToString(<App {...bootstrap} server />);
      stubLocation(path);
      const browser = renderToString(<App {...bootstrap} />);
      expect(browser).toBe(server);
      expect(server.length).toBeGreaterThan(100);
    });
  }

  test("every public registry page is covered", () => {
    // Pages with `auth` (projects created with --auth) are covered in test/auth.test.ts.
    const ids = (Object.keys(PAGES) as (keyof typeof PAGES)[]).filter((id) => !PAGES[id].auth);
    expect(ids.sort()).toEqual(["guestbook", "home", "note", "notes"]);
  });
});
