#!/usr/bin/env node
// create-klein: copies the template, keeps only the chosen platform/database/storage code, and wires it up.
//
//   bun create klein my-app                              Bun + SQLite
//   bun create klein my-app --db pg --storage s3         Bun + Postgres + S3-compatible storage
//   bun create klein my-app --db d1 --storage r2         Cloudflare Workers + D1 + R2
//   bun create klein my-app --db pg --platform cloudflare  Workers + Postgres via Hyperdrive
//   bun create klein my-app --auth github                 + sign-in with GitHub and database sessions
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

type Platform = "cloudflare" | "bun";
type Db = "d1" | "sqlite" | "pg";
type StorageOption = "r2" | "s3" | "none";
type AuthOption = "github" | "google" | "none";

export interface Options {
  name: string;
  platform: Platform;
  db: Db;
  storage: StorageOption;
  auth: AuthOption;
}

// Exact versions: every generated project gets what `bun run check` tested. Bump deliberately.
const VERSIONS = { wrangler: "4.153.0", postgres: "3.4.9" };

const HELP = `Usage: create-klein <dir> [--db sqlite|pg|d1] [--platform bun|cloudflare] [--storage r2|s3] [--auth github|google] [--no-install]

  --db        sqlite (default), pg (Postgres) or d1 (Cloudflare D1)
  --platform  where the server runs: bun (default) or cloudflare (default when --db d1)
  --storage   optional object storage: r2 (Cloudflare R2) or s3 (any S3-compatible bucket)
  --auth      optional sign-in: github or google (OAuth), with users and sessions in the database
  --no-install  skip bun install`;

// ---------------------------------------------------------------- options

export function resolveOptions(argv: string[]): Options & { dir: string; install: boolean } {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      db: { type: "string" },
      platform: { type: "string" },
      storage: { type: "string" },
      auth: { type: "string" },
      "no-install": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) fail(HELP, 0);
  const dir = positionals[0];
  if (!dir || positionals.length > 1) fail(HELP);

  const db = pick("--db", values.db?.toLowerCase().replace(/^postgres(ql)?$/, "pg"), ["sqlite", "pg", "d1"] as const)
    ?? (values.platform?.toLowerCase() === "cloudflare" ? "d1" : "sqlite");
  const platform = pick("--platform", values.platform?.toLowerCase(), ["bun", "cloudflare"] as const)
    ?? (db === "d1" ? "cloudflare" : "bun");
  const storage = pick("--storage", values.storage?.toLowerCase(), ["r2", "s3"] as const) ?? "none";
  const auth = pick("--auth", values.auth?.toLowerCase(), ["github", "google"] as const) ?? "none";

  if (db === "d1" && platform !== "cloudflare") fail("D1 only runs on Cloudflare. On Bun use --db sqlite (also SQLite).");
  if (db === "sqlite" && platform === "cloudflare") fail("On Cloudflare, SQLite is D1: use --db d1.");
  if (storage === "s3" && platform === "cloudflare") fail("On Cloudflare use --storage r2 (a Worker binding).");

  const name = basename(resolve(dir)).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "app";
  return { dir, name, platform, db, storage, auth, install: !values["no-install"] };
}

function pick<T extends string>(flag: string, value: string | undefined, allowed: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  if (!allowed.includes(value as T)) fail(`${flag} must be one of: ${allowed.join(", ")}`);
  return value as T;
}

function fail(message: string, code = 1): never {
  (code === 0 ? console.log : console.error)(message);
  process.exit(code);
}

// ---------------------------------------------------------------- template overlays

/** Template folders copied on top of each other, in this order. */
export function overlays(o: Options): string[] {
  const list = ["base", o.platform, o.db === "pg" ? "postgres" : o.db];
  if (o.db !== "d1") list.push("sql"); // scripts/migrate.ts + scripts/sample.ts
  if (o.storage !== "none") list.push(o.platform === "cloudflare" ? "r2" : "s3"); // on Bun, R2 is used through its S3 API
  if (o.auth !== "none") list.push("auth");
  return list;
}

const SKIP = new Set(["node_modules", ".wrangler", ".wrangler-build", "bun.lock", "data", ".env"]);
const SKIP_FILES = /^public\/assets\/(client\.js.*|styles\.css)$/;

function templateDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, "template"), join(here, "..", "template"), join(here, "..", "..", "template")]) {
    if (existsSync(join(candidate, "base"))) return candidate;
  }
  fail("Template folder not found next to create-klein.");
}

// ---------------------------------------------------------------- generated files

function title(name: string): string {
  return name.split("-").filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");
}

function flags(o: Options): string {
  const storage = o.storage === "none" ? "" : ` --storage ${o.storage}`;
  const auth = o.auth === "none" ? "" : ` --auth ${o.auth}`;
  return `--db ${o.db} --platform ${o.platform}${storage}${auth}`;
}

const AUTH = {
  github: { label: "GitHub", env: "GITHUB", console: "github.com → Settings → Developer settings → OAuth Apps → New OAuth App" },
  google: { label: "Google", env: "GOOGLE", console: "console.cloud.google.com → APIs & Services → Credentials → Create OAuth client ID (Web application)" },
} as const;

export function servicesFile(o: Options): string {
  const imports: string[] = [];
  const setup: string[] = [];
  const fields: string[] = [];
  let db: string;

  if (o.db === "d1") {
    imports.push(`import { d1Database } from "./platform/db/d1";`);
    db = `d1Database(env.DB)`;
  } else if (o.db === "sqlite") {
    imports.push(`import { sqliteDatabase } from "./platform/db/sqlite";`);
    db = `sqliteDatabase(process.env.DATABASE_PATH ?? "data/app.sqlite")`;
  } else if (o.platform === "cloudflare") {
    imports.push(`import postgres from "postgres";`, `import { postgresDatabase } from "./platform/db/postgres";`);
    setup.push(
      `// Hyperdrive pools connections close to the database, so a small client per request is cheap.`,
      `const sql = postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });`,
    );
    db = `postgresDatabase(sql)`;
  } else {
    imports.push(`import { SQL } from "bun";`, `import { postgresDatabase } from "./platform/db/postgres";`);
    setup.push(
      `const url = process.env.DATABASE_URL;`,
      `if (!url) throw new Error("Set DATABASE_URL, e.g. in .env (see .env.example).");`,
    );
    db = `postgresDatabase(new SQL(url))`;
  }
  if (o.auth === "none") {
    fields.push(`db: ${db},`);
  } else {
    setup.push(`const db = ${db};`);
    fields.push(`db,`);
  }
  if (o.db === "pg" && o.platform === "cloudflare") fields.push(`close: () => sql.end(), // after the response (src/worker.ts)`);

  if (o.storage !== "none" && o.platform === "cloudflare") {
    imports.push(`import { r2Storage } from "./platform/storage/r2";`);
    fields.push(`storage: r2Storage(env.STORAGE),`);
  } else if (o.storage !== "none") {
    imports.push(`import { s3Storage } from "./platform/storage/s3";`);
    fields.push(`storage: s3Storage(), // S3_* variables, see .env.example`);
  }

  if (o.auth !== "none") {
    const { env } = AUTH[o.auth];
    const source = o.platform === "cloudflare" ? "env" : "process.env";
    imports.push(`import { ${o.auth}, sessionAuth } from "./server/auth";`);
    fields.push(
      `// Sign-in with ${AUTH[o.auth].label}; ${env}_CLIENT_ID / ${env}_CLIENT_SECRET, see ${o.platform === "cloudflare" ? ".dev.vars.example" : ".env.example"}.`,
      `auth: sessionAuth({`,
      `  db,`,
      `  provider: ${o.auth}({ clientId: ${source}.${env}_CLIENT_ID || undefined, clientSecret: ${source}.${env}_CLIENT_SECRET || undefined }),`,
      `}),`,
    );
  }

  imports.push(`import type { Services } from "./platform/types";`);
  const signature = o.platform === "cloudflare" ? "createServices(env: Env)" : "createServices()";
  const body = [...setup, `return {`, ...fields.map((f) => `  ${f}`), `};`].map((l) => `  ${l}`).join("\n");
  return `// The database, storage and sign-in this app uses (created with ${flags(o)}).
// Loaders and handlers only see the interfaces in ./platform/types.
${imports.join("\n")}

export function ${signature}: Services {
${body}
}
`;
}

export function packageJson(base: Record<string, any>, o: Options): string {
  const pkg = structuredClone(base);
  pkg.name = o.name;
  const scripts: Record<string, string> = {};

  if (o.platform === "cloudflare") {
    Object.assign(scripts, {
      dev: "bun run build:assets && wrangler dev",
      build: "bun run build:assets && wrangler deploy --dry-run --outdir .wrangler-build",
      deploy: "bun run build:assets && wrangler deploy",
      types: "wrangler types",
    });
    pkg.devDependencies.wrangler = VERSIONS.wrangler;
  } else {
    Object.assign(scripts, {
      dev: "bun run build:assets && bun --watch src/bun.ts",
      start: "bun src/bun.ts",
      build: "bun run build:assets",
    });
  }

  if (o.db === "d1") {
    Object.assign(scripts, {
      "db:migrate:local": "wrangler d1 migrations apply DB --local",
      "db:migrate:remote": "wrangler d1 migrations apply DB --remote",
      "db:sample": "wrangler d1 execute DB --local --file db/sample.sql",
    });
  } else {
    Object.assign(scripts, { "db:migrate": "bun scripts/migrate.ts", "db:sample": "bun scripts/sample.ts" });
  }
  if (o.db === "pg" && o.platform === "cloudflare") pkg.dependencies.postgres = VERSIONS.postgres;

  pkg.scripts = { ...pkg.scripts, ...scripts };
  pkg.dependencies = sortKeys(pkg.dependencies);
  pkg.devDependencies = sortKeys(pkg.devDependencies);
  return JSON.stringify(pkg, null, 2) + "\n";
}

const sortKeys = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

const localPostgresUrl = (o: Options) => `postgres://postgres:postgres@localhost:5432/${o.name.replace(/-/g, "_")}`;

export function wranglerJsonc(o: Options): string {
  const blocks: string[] = [];
  if (o.db === "d1") {
    blocks.push(`  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "${o.name}",
      // Set after \`wrangler d1 create ${o.name}\`. Changing it switches local D1 to a fresh database.
      "database_id": "00000000-0000-0000-0000-000000000000",
      "migrations_dir": "migrations"
    }
  ],`);
  }
  if (o.db === "pg") {
    blocks.push(`  "hyperdrive": [
    {
      "binding": "HYPERDRIVE",
      // Set after \`wrangler hyperdrive create ${o.name} --connection-string=postgres://…\`.
      "id": "00000000000000000000000000000000",
      // Used by \`wrangler dev\`; keep it equal to DATABASE_URL in .env.
      "localConnectionString": "${localPostgresUrl(o)}"
    }
  ],`);
  }
  if (o.storage === "r2") {
    blocks.push(`  "r2_buckets": [
    // Create with \`wrangler r2 bucket create ${o.name}\`. wrangler dev simulates it locally.
    { "binding": "STORAGE", "bucket_name": "${o.name}" }
  ],`);
  }
  const compat = o.db === "pg" ? `\n  // The postgres driver needs Node's net/tls APIs.\n  "compatibility_flags": ["nodejs_compat"],` : "";
  return `{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "${o.name}",
  "main": "src/worker.ts",
  "compatibility_date": "2026-10-01",${compat}
  "observability": { "enabled": true },
  "assets": {
    "directory": "public",
    "binding": "ASSETS",
    // Everything goes to the Worker except files that are always static.
    "run_worker_first": ["/*", "!/assets/*", "!/favicon.ico"]
  },
  // Its id busts the browser cache for /assets/client.js and /assets/styles.css on each deploy.
  "version_metadata": { "binding": "CF_VERSION_METADATA" },
${blocks.join("\n")}
  // Cron schedules call scheduled() in src/worker.ts, e.g. ["0 * * * *"].
  "triggers": { "crons": [] }
}
`;
}

export interface EnvFile {
  path: string;
  content: string;
}

/**
 * `.env.example` (and `.dev.vars.example` on Cloudflare) document every variable. `.env` / `.dev.vars`
 * get working local values, including a random ADMIN_TOKEN for the /api/admin/* examples. Both are gitignored.
 */
export function envFiles(o: Options, adminToken = randomBytes(24).toString("base64url")): EnvFile[] {
  const files: EnvFile[] = [];
  const example: string[] = [];
  const local: string[] = [];
  const adminDoc = "# Bearer token for /api/admin/* (create notes, upload media). Unset → those endpoints answer 401.";
  if (o.platform === "bun") {
    example.push("# Server", "PORT=3000", "# Public origin when behind a proxy (canonical links, sitemap)", "ORIGIN=", "");
    example.push(adminDoc, "ADMIN_TOKEN=", "");
    local.push(`ADMIN_TOKEN=${adminToken}`);
  } else {
    files.push(
      { path: ".dev.vars.example", content: `${adminDoc}\n# Production: npx wrangler secret put ADMIN_TOKEN\nADMIN_TOKEN=\n` },
      { path: ".dev.vars", content: `ADMIN_TOKEN=${adminToken}\n` },
    );
  }
  if (o.db === "sqlite") example.push("# SQLite file", "DATABASE_PATH=data/app.sqlite", "");
  if (o.db === "pg") {
    const comment = o.platform === "cloudflare" ? "# Postgres for bun run db:migrate / db:sample (the Worker uses Hyperdrive)" : "# Postgres";
    example.push(comment, `DATABASE_URL=${localPostgresUrl(o)}`, "");
    local.push(`DATABASE_URL=${localPostgresUrl(o)}`);
  }
  if (o.storage !== "none" && o.platform === "bun") {
    example.push(
      o.storage === "r2" ? "# Cloudflare R2 through its S3 API (R2 → Manage API tokens)" : "# S3-compatible bucket",
      "S3_ACCESS_KEY_ID=",
      "S3_SECRET_ACCESS_KEY=",
      `S3_BUCKET=${o.name}`,
      o.storage === "r2" ? "S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com" : "S3_ENDPOINT=",
      o.storage === "r2" ? "S3_REGION=auto" : "S3_REGION=us-east-1",
      "",
    );
  }
  if (o.auth !== "none") {
    const { label, env, console: where } = AUTH[o.auth];
    const lines = [
      `# Sign-in with ${label}. Create the OAuth client at: ${where}`,
      `# Callback URL: ${o.platform === "cloudflare" ? "http://localhost:8787" : "http://localhost:3000"}/auth/callback locally, https://<your-domain>/auth/callback in production.`,
      `# Unset → /auth/sign-in explains what is missing.`,
      ...(o.platform === "cloudflare" ? [`# Production: npx wrangler secret put ${env}_CLIENT_ID (and ${env}_CLIENT_SECRET)`] : []),
      `${env}_CLIENT_ID=`,
      `${env}_CLIENT_SECRET=`,
    ];
    if (o.platform === "cloudflare") {
      const vars = files.find((f) => f.path === ".dev.vars")!;
      const varsExample = files.find((f) => f.path === ".dev.vars.example")!;
      varsExample.content += `\n${lines.join("\n")}\n`;
      vars.content += `${env}_CLIENT_ID=\n${env}_CLIENT_SECRET=\n`;
    } else {
      example.push(...lines, "");
      local.push(`${env}_CLIENT_ID=`, `${env}_CLIENT_SECRET=`);
    }
  }
  if (example.length) files.push({ path: ".env.example", content: example.join("\n") });
  if (local.length) files.push({ path: ".env", content: local.join("\n") + "\n" });
  return files;
}

function gitignoreExtra(o: Options): string[] {
  return o.platform === "cloudflare" ? [".wrangler", ".wrangler-build", ".dev.vars"] : ["data/"];
}

export function setupSection(o: Options): string {
  const run = (lines: string[]) => "```sh\n" + lines.join("\n") + "\n```";
  const platform = o.platform === "cloudflare" ? "Cloudflare Workers" : "Bun (`Bun.serve`)";
  const db = { d1: "Cloudflare D1", sqlite: "SQLite (`bun:sqlite`)", pg: o.platform === "cloudflare" ? "Postgres via Hyperdrive" : "Postgres (Bun's built-in `SQL`)" }[o.db];
  const storage = o.storage === "none" ? "none" : o.platform === "cloudflare" ? "Cloudflare R2 (binding)" : o.storage === "r2" ? "Cloudflare R2 (S3 API)" : "S3-compatible bucket";

  const local: string[] = [];
  if (o.db === "pg") local.push(`createdb ${o.name.replace(/-/g, "_")}        # then check DATABASE_URL in .env${o.platform === "cloudflare" ? " and localConnectionString in wrangler.jsonc" : ""}`);
  local.push(o.db === "d1" ? "bun run db:migrate:local" : "bun run db:migrate", "bun run db:sample", "bun run dev");

  const deploy: string[] = [];
  if (o.platform === "cloudflare") {
    deploy.push("npx wrangler login");
    if (o.db === "d1") deploy.push(`npx wrangler d1 create ${o.name}          # copy database_id into wrangler.jsonc`);
    if (o.db === "pg") deploy.push(`npx wrangler hyperdrive create ${o.name} --connection-string="postgres://…"   # copy id into wrangler.jsonc`);
    if (o.storage === "r2") deploy.push(`npx wrangler r2 bucket create ${o.name}`);
    deploy.push("npx wrangler secret put ADMIN_TOKEN       # only if you use /api/admin/*");
    if (o.auth !== "none") {
      const { env } = AUTH[o.auth];
      deploy.push(`npx wrangler secret put ${env}_CLIENT_ID`, `npx wrangler secret put ${env}_CLIENT_SECRET`);
    }
    deploy.push("bun run types                       # after every wrangler.jsonc change");
    if (o.db === "d1") deploy.push("bun run db:migrate:local            # a new database_id means a fresh local DB", "bun run db:migrate:remote");
    if (o.db === "pg") deploy.push(`DATABASE_URL="postgres://…" bun run db:migrate`);
    deploy.push("bun run deploy");
  } else {
    const vars = o.auth === "none" ? "PORT, ORIGIN, ADMIN_TOKEN…" : `PORT, ORIGIN, ${AUTH[o.auth].env}_CLIENT_ID…`;
    deploy.push("bun install --production", "bun run build", "bun run db:migrate", `bun run start              # ${vars} come from the environment`);
  }

  return `
## Your setup

Created with \`${flags(o)}\`.

| | |
| --- | --- |
| Server | ${platform} — entry \`src/${o.platform === "cloudflare" ? "worker" : "bun"}.ts\` |
| Database | ${db} — \`src/platform/db/${o.db === "pg" ? "postgres" : o.db}.ts\` |
| Storage | ${storage}${o.storage === "none" ? "" : ` — \`src/platform/storage/${o.platform === "cloudflare" ? "r2" : "s3"}.ts\`, served at \`/media/<key>\``} |
| Sign-in | ${o.auth === "none" ? "none" : `${AUTH[o.auth].label} (OAuth) + database sessions — \`src/server/auth/\`, \`/account\``} |

\`src/services.ts\` connects them; everything else only uses the interfaces in \`src/platform/types.ts\`.
To switch later, copy an adapter from the framework's \`template/\` folder and change \`src/services.ts\`.

### Run locally

${run(local)}

Open ${o.platform === "cloudflare" ? "http://localhost:8787" : "http://localhost:3000"}. While editing pages, also run \`bun run dev:client\` (and \`bun run dev:css\`).

${o.auth === "none" ? "" : authSection(o)}
### Deploy

${run(deploy)}
`;
}

function authSection(o: Options): string {
  const { label, env, console: where } = AUTH[o.auth as Exclude<AuthOption, "none">];
  const local = o.platform === "cloudflare" ? "http://localhost:8787" : "http://localhost:3000";
  const file = o.platform === "cloudflare" ? ".dev.vars" : ".env";
  return `
### Sign-in

1. Create an OAuth client: ${where}.
2. Set its callback (redirect) URL to \`${local}/auth/callback\`.${o.auth === "github" ? " GitHub allows one per app, so make a second app for production." : ""}
3. Put \`${env}_CLIENT_ID\` and \`${env}_CLIENT_SECRET\` in \`${file}\` and restart \`bun run dev\`.
4. Click **Sign in**. \`/account\` lists where you're signed in and signs you out.

In production, register \`https://<your-domain>/auth/callback\`${o.platform === "bun" ? " and set ORIGIN if you run behind a proxy" : ""}.
Sessions live in the \`sessions\` table (only token hashes); \`users\` and \`accounts\` hold who signed in with what.
`;
}

/** Inserts `text` before (or after) `anchor` in a template file; fails loudly if the template changed. */
function patch(content: string, file: string, anchor: string, text: string, where: "before" | "after" = "before"): string {
  const index = content.indexOf(anchor);
  if (index === -1) throw new Error(`create-klein: anchor not found in ${file}: ${JSON.stringify(anchor)}`);
  const at = where === "before" ? index : index + anchor.length;
  return content.slice(0, at) + text + content.slice(at);
}

/** --auth: the account page in the registry and loaders, the user menu in the header, its data types. */
function addAuthToApp(read: (path: string) => string, write: (path: string, content: string) => void): void {
  let registry = read("src/pages/registry.tsx");
  registry = patch(registry, "registry.tsx", "GuestbookData, NoteData", "AccountData, ");
  registry = patch(registry, "registry.tsx", `import { GuestbookPage } from "./GuestbookPage";`, `import { AccountPage } from "./AccountPage";\n`);
  registry = patch(
    registry,
    "registry.tsx",
    "\n};\n\nexport type PageId",
    `\n  account: dataPage<AccountData>({ path: "/account", title: "Account", auth: "required", component: AccountPage }),`,
  );
  write("src/pages/registry.tsx", registry);

  let loaders = read("src/server/loaders.ts");
  loaders = patch(loaders, "loaders.ts", `import { decodeParams, HttpError } from "./http";`, `import { loadAccount } from "./auth/account";\n`);
  loaders = patch(
    loaders,
    "loaders.ts",
    "\n};\n\nconst PATTERNS",
    `\n\n  // auth: "required" in the registry, so \`session\` is always set here.\n  account: ({ services, session }) => loadAccount(services.db, session),`,
  );
  write("src/server/loaders.ts", loaders);

  let shell = read("src/components/layout/Shell.tsx");
  shell = patch(shell, "Shell.tsx", `import { isActive, NAV } from "./nav";`, `\nimport { UserMenu } from "./UserMenu";`, "after");
  shell = patch(shell, "Shell.tsx", "          </ul>", "            <li>\n              <UserMenu path={path} />\n            </li>\n");
  write("src/components/layout/Shell.tsx", shell);

  write(
    "src/shared/types.ts",
    read("src/shared/types.ts") +
      `
export interface AccountSession {
  current: boolean; // this browser
  userAgent: string | null;
  createdAt: string; // ISO 8601
  lastSeenAt: string;
}

export interface AccountData {
  providers: string[]; // "github", "google"
  sessions: AccountSession[];
}
`,
  );
}

// ---------------------------------------------------------------- create

export function create(target: string, o: Options): void {
  const root = templateDir();
  for (const overlay of overlays(o)) {
    const from = join(root, overlay);
    cpSync(from, target, {
      recursive: true,
      filter: (src) => {
        const rel = relative(from, src).split("\\").join("/");
        return !rel.split("/").some((part) => SKIP.has(part)) && !SKIP_FILES.test(rel);
      },
    });
  }
  // npm never publishes .gitignore files, so the packed template carries it as `gitignore` (see prepack).
  if (existsSync(join(target, "gitignore"))) renameSync(join(target, "gitignore"), join(target, ".gitignore"));

  const write = (path: string, content: string) => writeFileSync(join(target, path), content);
  const read = (path: string) => readFileSync(join(target, path), "utf8");

  write("src/services.ts", servicesFile(o));
  write("package.json", packageJson(JSON.parse(read("package.json")), o));
  if (o.platform === "cloudflare") write("wrangler.jsonc", wranglerJsonc(o));
  for (const file of envFiles(o)) write(file.path, file.content);
  write(".gitignore", read(".gitignore") + gitignoreExtra(o).join("\n") + "\n");
  write("README.md", read("README.md").replace(/^# klein\b/m, `# ${o.name}`) + setupSection(o));
  write("src/site.ts", read("src/site.ts").replace(`name: "Klein"`, `name: ${JSON.stringify(title(o.name))}`));
  if (o.auth !== "none") addAuthToApp(read, write);
}

function main() {
  const { dir, install, ...o } = resolveOptions(process.argv.slice(2));
  const target = resolve(dir);
  if (existsSync(target) && readdirSync(target).length > 0) fail(`${dir} already exists and is not empty.`);

  create(target, o);
  console.log(`Created ${dir} (${flags(o)}).`);

  if (install) {
    const sh = (cmd: string) => execSync(cmd, { cwd: target, stdio: "inherit" });
    try {
      sh("bun install");
      if (o.platform === "cloudflare") sh("bun run types");
    } catch {
      fail("Install failed. Bun is required: https://bun.sh");
    }
  }

  const steps = [`cd ${dir}`];
  if (!install) steps.push("bun install", ...(o.platform === "cloudflare" ? ["bun run types"] : []));
  if (o.db === "pg") steps.push(`createdb ${o.name.replace(/-/g, "_")}`);
  steps.push(o.db === "d1" ? "bun run db:migrate:local" : "bun run db:migrate", "bun run db:sample", "bun run dev");
  const signIn = o.auth === "none" ? "" : `\nSign-in needs ${AUTH[o.auth].label} OAuth credentials: README.md → Your setup → Sign-in.`;
  console.log(`\nNext:\n${steps.map((s) => `  ${s}`).join("\n")}\n${signIn}\nSee README.md for deploying.`);
}

if (import.meta.main ?? process.argv[1] === fileURLToPath(import.meta.url)) main();
