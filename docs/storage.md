# Storage

You only get file storage if you ask for it. Create the project with `--storage r2` or
`--storage s3` and you'll have somewhere to keep images, uploads and downloads.

```ts
// src/platform/types.ts
interface Storage {
  get(key: string): Promise<StoredObject | null>;   // { body: ReadableStream, size, contentType?, etag? }
  put(key: string, body: string | Uint8Array | ArrayBuffer, options?: { contentType?: string }): Promise<void>;
  delete(key: string): Promise<void>;
}
```

You reach it through `services.storage`. The type marks it as optional, because projects created
without `--storage` don't have it, so check for it first:

```ts
const storage = app.services.storage;
if (!storage) throw new HttpError(501, "storage_not_configured");
```

## Adapters

| Option | Platform | Adapter | How it connects |
| --- | --- | --- | --- |
| `--storage r2` | Cloudflare | `src/platform/storage/r2.ts` | the `STORAGE` R2 binding in `wrangler.jsonc` |
| `--storage r2` | Bun | `src/platform/storage/s3.ts` | R2's S3-compatible API |
| `--storage s3` | Bun | `src/platform/storage/s3.ts` | any S3-compatible service: AWS S3, MinIO, Backblaze B2 and so on |

On Bun, the adapter uses Bun's built-in `S3Client`, which reads these variables. They're also listed
in `.env.example`:

```sh
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
S3_BUCKET=my-app
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com   # R2; leave empty for AWS
S3_REGION=auto                                               # R2: auto
```

On Cloudflare, `wrangler dev` pretends to be R2 while you develop and keeps the files in
`.wrangler/`. When you're ready for the real thing, create a bucket with
`npx wrangler r2 bucket create <name>`.

## Serving files

`src/server/api/media.ts` serves whatever is stored under a key at `/media/<key>`. You can use those
URLs in pages like any other image:

```tsx
<img src="/media/photos/cover.webp" alt="…" width={1200} height={630} />
```

The response gets the stored `Content-Type`, an `ETag`, and `Cache-Control: public, max-age=3600`.

It also gets `Content-Security-Policy: default-src 'none'; sandbox`. This one matters if you ever
store files that other people upload. Without it, someone could upload an HTML or SVG file with a
script inside. That script would run on your domain, and it could do anything on your site that the
visitor who opened the file is allowed to do. With the header, the browser treats the file as an
isolated document that can't run anything.

Keys may only contain `A–Z a–z 0–9 . _ / -`, can be at most 512 characters long, and can't contain
`..`. Anything else gets a 404.

## Uploading

The admin API lets a script upload and delete files:

```sh
# upload (the Content-Type is stored with the file; 10 MB at most)
curl -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: image/webp" \
     --data-binary @cover.webp http://localhost:3000/api/admin/media/photos/cover.webp
# → 201 {"key":"photos/cover.webp","url":"/media/photos/cover.webp"}

# delete
curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/api/admin/media/photos/cover.webp
# → 204
```

If storage isn't set up, both answer `501 storage_not_configured`. If the token is wrong, `401`.

## Tips

Neither platform recompresses images for you. Upload WebP or AVIF at the size you'll display them
(twice that for high-density screens), and set `width` and `height` on the `<img>` so the page
doesn't jump around while it loads.

Files under `/media/` are cached for an hour. If you overwrite a key, some visitors will keep seeing
the old file until that hour is up. It's easier to upload changed files under a new key, like
`cover-v2.webp`.

Uploads are read into memory, with a 10 MB limit (`MAX_UPLOAD_BYTES` in `media.ts`). For bigger
files, upload straight to the bucket with presigned URLs or the provider's own tools.

The admin API is meant for scripts. If you want people to upload from a page, add an endpoint that
calls `guardMutation()`, checks who the person is, reads the body with `readBytes()` and passes it to
`storage.put()`.
