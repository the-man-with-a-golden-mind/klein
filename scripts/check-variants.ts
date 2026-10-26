// Generates every supported combination with create-klein and checks each one:
// typecheck, tests, client/CSS build, Wrangler dry-run (Cloudflare) or a live smoke test (Bun).
//
//   bun run check [outDir]          CHECK_DATABASE_URL=postgres://… enables the Postgres variants' DB tests
import { SQL } from "bun";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const VARIANTS = [
  "--db d1",
  "--db d1 --storage r2",
  "--db pg --platform cloudflare",
  "--db pg --platform cloudflare --storage r2",
  "--db sqlite",
  "--db sqlite --storage r2",
  "--db sqlite --storage s3",
  "--db pg",
  "--db pg --storage s3",
  "--db d1 --auth google",
  "--db pg --platform cloudflare --auth github",
  "--db sqlite --auth github",
  "--db pg --auth google",
];

const out = process.argv[2] ?? mkdtempSync(join(tmpdir(), "klein-check-"));
mkdirSync(out, { recursive: true });
const pgAdmin = process.env.CHECK_DATABASE_URL;
const cli = join(import.meta.dir, "..", "create-klein", "index.ts");
const failures: string[] = [];

async function sh(cmd: string[], cwd: string, env: Record<string, string> = {}): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`${cmd.join(" ")} exited ${code}\n${stdout}\n${stderr}`.slice(-4000));
}

async function freshPostgres(name: string): Promise<string | undefined> {
  if (!pgAdmin) return undefined;
  const admin = new SQL({ url: pgAdmin, max: 1 });
  await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`);
  await admin.unsafe(`CREATE DATABASE ${name}`);
  await admin.close();
  const url = new URL(pgAdmin);
  url.pathname = `/${name}`;
  return url.href;
}

/** Creates a user and a session straight in the project's database; returns the cookie token. */
async function seedSession(dir: string, env: Record<string, string>): Promise<string> {
  const script = `
    import { createServices } from "./src/services";
    import { createSession } from "./src/server/auth/sessions";
    const { db } = createServices();
    const now = new Date().toISOString();
    await db.run("INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)", "smoke-user", "Smoke Tester", now);
    console.log(await createSession(db, "smoke-user", "check"));
    process.exit(0);`;
  const proc = Bun.spawn(["bun", "-e", script], { cwd: dir, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`seeding a session failed\n${err}`);
  return out.trim();
}

async function smokeAuth(base: string, dir: string, env: Record<string, string>) {
  const account = await fetch(`${base}/account`, { redirect: "manual" });
  if (account.status !== 303 || account.headers.get("Location") !== "/auth/sign-in?next=%2Faccount") {
    throw new Error(`GET /account (anonymous) → ${account.status} ${account.headers.get("Location")}`);
  }
  const start = await fetch(`${base}/auth/sign-in?next=/account`, { redirect: "manual" });
  const location = start.headers.get("Location") ?? "";
  if (start.status !== 303 || !/^https:\/\/(github\.com|accounts\.google\.com)\//.test(location) || !location.includes("code_challenge=")) {
    throw new Error(`GET /auth/sign-in → ${start.status} ${location}`);
  }
  if (!start.headers.get("Set-Cookie")?.includes("HttpOnly")) throw new Error("sign-in: no HttpOnly state cookie");

  const token = await seedSession(dir, env);
  const headers = { Cookie: `session=${token}` };
  const page = await fetch(`${base}/account`, { headers });
  if (page.status !== 200 || !(await page.text()).includes("Smoke Tester")) throw new Error(`GET /account (signed in) → ${page.status}`);
  if (page.headers.get("Cache-Control") !== "private, no-cache") throw new Error(`/account Cache-Control: ${page.headers.get("Cache-Control")}`);
  const out = await fetch(`${base}/auth/sign-out`, {
    method: "POST",
    redirect: "manual",
    headers: { ...headers, Origin: base, "Content-Type": "application/x-www-form-urlencoded" },
  });
  if (out.status !== 303) throw new Error(`POST /auth/sign-out → ${out.status}`);
  if ((await fetch(`${base}/account`, { headers, redirect: "manual" })).status !== 303) throw new Error("session still valid after sign-out");
}

async function smoke(dir: string, env: Record<string, string>, hasStorage: boolean, hasAuth: boolean) {
  await sh(["bun", "run", "db:migrate"], dir, env);
  await sh(["bun", "run", "db:migrate"], dir, env); // second run is a no-op
  await sh(["bun", "run", "db:sample"], dir, env);
  const port = String(20000 + Math.floor(Math.random() * 20000));
  // Placeholder OAuth credentials: enough for /auth/sign-in to build the provider redirect.
  const credentials = hasAuth ? { GITHUB_CLIENT_ID: "check", GITHUB_CLIENT_SECRET: "check", GOOGLE_CLIENT_ID: "check", GOOGLE_CLIENT_SECRET: "check" } : {};
  const server = Bun.spawn(["bun", "src/bun.ts"], { cwd: dir, env: { ...process.env, ...env, ...credentials, PORT: port }, stdout: "pipe", stderr: "pipe" });
  try {
    const base = `http://localhost:${port}`;
    for (let i = 0; i < 50; i++) {
      if (await fetch(base).then(() => true, () => false)) break;
      await Bun.sleep(100);
    }
    const expectations: [string, number, string?][] = [
      ["/", 200, "<title>"],
      ["/notes", 200, "Small and fast"],
      ["/notes/hello-world", 200, "Hello, world"],
      ["/notes/nope", 404],
      ["/api/page?path=/notes/small-and-fast", 200, '"id":"note"'],
      ["/assets/styles.css", 200],
      ["/assets/client.js", 200],
      ["/assets/../package.json", 404],
      ["/favicon.ico", 200],
    ];
    // Without storage /media is a 404; with storage but no S3 credentials here, it can only fail.
    if (!hasStorage) expectations.push(["/media/x.txt", 404]);
    for (const [path, status, text] of expectations) {
      const res = await fetch(base + path);
      const body = await res.text();
      if (res.status !== status || (text && !body.includes(text))) throw new Error(`GET ${path} → ${res.status}, expected ${status} ${text ?? ""}`);
    }

    // Writes: a plain form post (no JavaScript) and the token-protected admin API.
    const signed = await fetch(`${base}/api/guestbook`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: base },
      body: "name=Smoke&message=Signed+by+the+check",
    });
    if (signed.status !== 303) throw new Error(`POST /api/guestbook → ${signed.status}`);
    if (!(await (await fetch(`${base}/guestbook`)).text()).includes("Signed by the check")) throw new Error("guestbook entry missing");

    const token = (await Bun.file(join(dir, ".env")).text()).match(/^ADMIN_TOKEN=(.+)$/m)?.[1];
    const note = await fetch(`${base}/api/admin/notes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "smoke", title: "Smoke", body: "From the check." }),
    });
    if (note.status !== 201) throw new Error(`POST /api/admin/notes → ${note.status} ${await note.text()}`);
    if ((await fetch(`${base}/notes/smoke`)).status !== 200) throw new Error("admin note missing");

    if (hasAuth) await smokeAuth(base, dir, env);
  } finally {
    server.kill();
  }
}

for (const flags of VARIANTS) {
  const slug = flags.replace(/--\w+ /g, "").replace(/ /g, "-");
  const dir = join(out, slug);
  rmSync(dir, { recursive: true, force: true });
  const started = Date.now();
  try {
    await sh(["bun", cli, dir, ...flags.split(" ")], out);
    const pg = flags.includes("pg") ? await freshPostgres(`check_${slug.replace(/-/g, "_")}`) : undefined;
    const env: Record<string, string> = pg ? { DATABASE_URL: pg, TEST_DATABASE_URL: pg } : {};
    await sh(["bun", "run", "typecheck"], dir);
    await sh(["bun", "test"], dir, env);
    if (flags.includes("cloudflare") || flags.includes("d1")) {
      await sh(["bun", "run", "build"], dir);
    } else {
      await sh(["bun", "run", "build"], dir);
      if (!flags.includes("pg") || pg) await smoke(dir, env, flags.includes("--storage"), flags.includes("--auth"));
    }
    console.log(`✔ ${flags.padEnd(45)} ${((Date.now() - started) / 1000).toFixed(1)}s${flags.includes("pg") && !pg ? "  (no CHECK_DATABASE_URL: DB tests skipped)" : ""}`);
  } catch (error) {
    failures.push(flags);
    console.log(`✘ ${flags}\n${(error as Error).message}`);
  }
}

// The published package, as a user gets it: npm drops some files (e.g. .gitignore), so create a
// project from the packed tarball with Node and check it like the others.
const packStarted = Date.now();
try {
  const packDir = join(out, "package");
  rmSync(packDir, { recursive: true, force: true });
  mkdirSync(packDir);
  await sh(["npm", "pack", "--pack-destination", packDir], join(import.meta.dir, "..", "create-klein"));
  await sh(["sh", "-c", "tar -xzf create-klein-*.tgz"], packDir);
  const dir = join(out, "from-package");
  rmSync(dir, { recursive: true, force: true });
  await sh(["node", join(packDir, "package", "dist", "index.js"), dir, "--auth", "github"], out);
  if (!(await Bun.file(join(dir, ".gitignore")).exists())) throw new Error("generated project has no .gitignore");
  await sh(["bun", "run", "typecheck"], dir);
  await sh(["bun", "test"], dir);
  console.log(`✔ ${"packed create-klein (Node)".padEnd(45)} ${((Date.now() - packStarted) / 1000).toFixed(1)}s`);
} catch (error) {
  failures.push("packed create-klein");
  console.log(`✘ packed create-klein\n${(error as Error).message}`);
}

const total = VARIANTS.length + 1;
console.log(`\n${total - failures.length}/${total} checks OK — projects in ${out}`);
process.exit(failures.length ? 1 : 0);
