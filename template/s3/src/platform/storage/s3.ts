import { S3Client } from "bun";
import type { Storage } from "../types";

/**
 * Any S3-compatible bucket (AWS S3, Cloudflare R2, MinIO…) via Bun's built-in client.
 * `new S3Client()` reads S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET, S3_ENDPOINT and S3_REGION.
 */
export function s3Storage(client: S3Client = new S3Client()): Storage {
  return {
    async get(key) {
      const file = client.file(key);
      if (!(await file.exists())) return null;
      const info = await file.stat();
      return { body: file.stream(), size: info.size, contentType: info.type, etag: info.etag };
    },
    async put(key, body, options = {}) {
      await client.write(key, body, { type: options.contentType });
    },
    async delete(key) {
      await client.delete(key);
    },
  };
}
