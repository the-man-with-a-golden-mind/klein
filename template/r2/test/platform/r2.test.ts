import { describe, expect, test } from "bun:test";
import { r2Storage } from "../../src/platform/storage/r2";

/** Just enough of the R2 binding, in memory. */
function fakeR2(): R2Bucket {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  return {
    async get(key: string) {
      const o = objects.get(key);
      if (!o) return null;
      return { body: new Response(o.bytes as Uint8Array<ArrayBuffer>).body, size: o.bytes.byteLength, httpMetadata: { contentType: o.contentType }, httpEtag: '"e"' };
    },
    async put(key: string, body: string | Uint8Array, options: { httpMetadata?: { contentType?: string } }) {
      const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
      objects.set(key, { bytes, contentType: options.httpMetadata?.contentType });
    },
    async delete(key: string) {
      objects.delete(key);
    },
  } as unknown as R2Bucket;
}

describe("r2 adapter", () => {
  test("put / get / delete", async () => {
    const storage = r2Storage(fakeR2());
    expect(await storage.get("a.txt")).toBeNull();
    await storage.put("a.txt", "hello", { contentType: "text/plain" });
    const object = (await storage.get("a.txt"))!;
    expect(object.size).toBe(5);
    expect(object.contentType).toBe("text/plain");
    expect(object.etag).toBe('"e"');
    expect(await new Response(object.body).text()).toBe("hello");
    await storage.delete("a.txt");
    expect(await storage.get("a.txt")).toBeNull();
  });
});
