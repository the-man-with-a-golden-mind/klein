// HTTP helpers for handlers in src/server. Handlers throw HttpError; app.ts turns it into `{ error: code }`.
import type { User } from "../shared/types";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly headers: HeadersInit = {},
  ) {
    super(code);
  }
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(data), { ...init, headers });
}

/** 303 See Other: after a form post, the browser follows it with a GET. */
export function redirect(location: string, status = 303): Response {
  return new Response(null, { status, headers: { Location: location, "Cache-Control": "no-store" } });
}

const MAX_BODY_BYTES = 8 * 1024;

/** Reads the whole body, streaming with a hard size cap (Content-Length can lie). 413 when larger. */
export async function readBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > maxBytes) throw new HttpError(413, "body_too_large");
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, "body_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Reads a JSON object body (8 KB unless `maxBytes` says otherwise). */
export async function readJsonBody(request: Request, maxBytes = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  const text = new TextDecoder().decode(await readBytes(request, maxBytes));
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "invalid_body");
  }
  return body as Record<string, unknown>;
}

/** True for a plain HTML <form> post (the no-JavaScript path). */
export const isFormPost = (request: Request) =>
  request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded") ?? false;

/** Reads a JSON object or an urlencoded form (8 KB cap), so one handler serves fetch() and plain forms. */
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!isFormPost(request)) return readJsonBody(request);
  const text = new TextDecoder().decode(await readBytes(request, MAX_BODY_BYTES));
  return Object.fromEntries(new URLSearchParams(text));
}

// Shared with the browser router, so it lives outside src/server.
export { decodeParams } from "../shared/params";

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function requireId(value: unknown, code = "invalid_id"): string {
  if (typeof value !== "string" || !ID.test(value)) throw new HttpError(400, code);
  return value;
}

export function requireOneOf<T extends string>(value: unknown, allowed: readonly T[], code = "invalid_value"): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new HttpError(400, code);
  return value as T;
}

/** True when the request comes from a page on our own origin. */
export function sameOrigin(request: Request): boolean {
  const site = request.headers.get("Sec-Fetch-Site");
  if (site !== null) return site === "same-origin";
  const origin = request.headers.get("Origin");
  return origin !== null && origin === new URL(request.url).origin;
}

/**
 * Use at the start of every state-changing handler called from the browser: rejects cross-site
 * requests (CSRF) and anything that is neither JSON nor a plain form post.
 */
export function guardMutation(request: Request): void {
  if (!sameOrigin(request)) throw new HttpError(403, "cross_origin");
  const type = request.headers.get("Content-Type") ?? "";
  if (!type.startsWith("application/json") && !isFormPost(request)) {
    throw new HttpError(415, "unsupported_media_type");
  }
}

/** A trimmed string of 1..max characters, else 400 with `code`. */
export function requireText(value: unknown, max: number, code = "invalid_text"): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length === 0 || text.length > max) throw new HttpError(400, code);
  return text;
}

/** The signed-in user (`ctx.user`), else 401. For endpoints that act on behalf of someone (--auth). */
export function requireUser(user: User | null): User {
  if (!user) throw new HttpError(401, "sign_in_required");
  return user;
}

/** For machine-to-machine endpoints. Compares SHA-256 digests so timing reveals nothing. */
export async function requireBearer(request: Request, secret: string | undefined): Promise<void> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!secret || !token) throw new HttpError(401, "unauthorized", { "WWW-Authenticate": "Bearer" });
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(token)),
    crypto.subtle.digest("SHA-256", encoder.encode(secret)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  if (diff !== 0) throw new HttpError(401, "unauthorized", { "WWW-Authenticate": "Bearer" });
}
