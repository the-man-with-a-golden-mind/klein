import type { Storage } from "../types";

/** Cloudflare R2 through its Worker binding. */
export function r2Storage(bucket: R2Bucket): Storage {
  return {
    async get(key) {
      const object = await bucket.get(key);
      if (!object) return null;
      return {
        body: object.body,
        size: object.size,
        contentType: object.httpMetadata?.contentType,
        etag: object.httpEtag,
      };
    },
    async put(key, body, options = {}) {
      await bucket.put(key, body, { httpMetadata: { contentType: options.contentType } });
    },
    async delete(key) {
      await bucket.delete(key);
    },
  };
}
