import { describe, expect, test } from "bun:test";
import { S3Client } from "bun";
import { s3Storage } from "../../src/platform/storage/s3";

// Runs against a real bucket when TEST_S3_BUCKET is set (with the usual S3_* credentials).
const bucket = process.env.TEST_S3_BUCKET;
describe.skipIf(!bucket)("s3 adapter", () => {
  test("put / get / delete", async () => {
    const storage = s3Storage(new S3Client({ bucket }));
    const key = `test/${Date.now()}.txt`;
    await storage.put(key, "hello", { contentType: "text/plain" });
    const object = (await storage.get(key))!;
    expect(object.size).toBe(5);
    expect(await new Response(object.body).text()).toBe("hello");
    await storage.delete(key);
    expect(await storage.get(key)).toBeNull();
  });
});
