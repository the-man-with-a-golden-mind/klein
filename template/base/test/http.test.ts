import { describe, expect, test } from "bun:test";
import { decodeParams, HttpError, readJsonBody, requireBearer, sameOrigin } from "../src/server/http";

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("https://example.com/api/x", { method: "POST", body, headers });

async function status(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
    return 200;
  } catch (error) {
    if (error instanceof HttpError) return error.status;
    throw error;
  }
}

describe("http helpers", () => {
  test("readJsonBody accepts objects only, capped at 8 KB", async () => {
    expect(await readJsonBody(post('{"a":1}'))).toEqual({ a: 1 });
    expect(await status(readJsonBody(post("[1]")))).toBe(400);
    expect(await status(readJsonBody(post("not json")))).toBe(400);
    expect(await status(readJsonBody(post(JSON.stringify({ a: "x".repeat(9000) }))))).toBe(413);
  });

  test("decodeParams decodes and rejects malformed escapes", () => {
    expect(decodeParams({ slug: "a%20b", missing: undefined })).toEqual({ slug: "a b" });
    expect(decodeParams({ slug: "%E0%A4%A" })).toBeNull();
  });

  test("sameOrigin uses Sec-Fetch-Site, then Origin", () => {
    expect(sameOrigin(post("", { "Sec-Fetch-Site": "same-origin" }))).toBe(true);
    expect(sameOrigin(post("", { "Sec-Fetch-Site": "cross-site", Origin: "https://example.com" }))).toBe(false);
    expect(sameOrigin(post("", { Origin: "https://example.com" }))).toBe(true);
    expect(sameOrigin(post("", { Origin: "https://evil.com" }))).toBe(false);
    expect(sameOrigin(post(""))).toBe(false);
  });

  test("requireBearer", async () => {
    const auth = (token: string) => post("", { Authorization: `Bearer ${token}` });
    expect(await status(requireBearer(auth("s3cret"), "s3cret"))).toBe(200);
    expect(await status(requireBearer(auth("wrong"), "s3cret"))).toBe(401);
    expect(await status(requireBearer(auth("s3cret"), undefined))).toBe(401);
    expect(await status(requireBearer(post(""), "s3cret"))).toBe(401);
  });
});
