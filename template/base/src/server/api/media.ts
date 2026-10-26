// Files in object storage (R2 or S3, see src/services.ts).
//   GET    /media/<key>            public, cached for an hour
//   PUT    /api/admin/media/<key>  upload (bearer token), body = file bytes, Content-Type kept
//   DELETE /api/admin/media/<key>  remove (bearer token)
import type { Storage } from "../../platform/types";
import type { RouteContext } from "../app";
import { HttpError, json, readBytes, requireBearer } from "../http";

const KEY = /^(?!.*\.\.)[A-Za-z0-9._/-]{1,512}$/;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function validKey(key: string | undefined): string | null {
  return key && KEY.test(key) ? key : null;
}

export async function getMedia({ app, params }: RouteContext): Promise<Response> {
  const key = validKey(params.key);
  const storage = app.services.storage;
  if (!storage || !key) throw new HttpError(404, "not_found");
  const object = await storage.get(key);
  if (!object) throw new HttpError(404, "not_found");
  const headers: Record<string, string> = {
    "Content-Type": object.contentType ?? "application/octet-stream",
    "Content-Length": String(object.size),
    "Cache-Control": "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    // Uploaded files are never run as pages on our origin, whatever their type.
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  if (object.etag) headers.ETag = object.etag;
  return new Response(object.body, { headers });
}

async function adminStorage({ request, app, params }: RouteContext): Promise<{ storage: Storage; key: string }> {
  await requireBearer(request, app.secrets.adminToken);
  const storage = app.services.storage;
  if (!storage) throw new HttpError(501, "storage_not_configured");
  const key = validKey(params.key);
  if (!key) throw new HttpError(400, "invalid_key");
  return { storage, key };
}

export async function putMedia(ctx: RouteContext): Promise<Response> {
  const { storage, key } = await adminStorage(ctx);
  const bytes = await readBytes(ctx.request, MAX_UPLOAD_BYTES);
  if (bytes.byteLength === 0) throw new HttpError(400, "empty_body");
  const contentType = ctx.request.headers.get("Content-Type") ?? "application/octet-stream";
  await storage.put(key, bytes, { contentType });
  return json({ key, url: `/media/${key}` }, { status: 201 });
}

export async function deleteMedia(ctx: RouteContext): Promise<Response> {
  const { storage, key } = await adminStorage(ctx);
  await storage.delete(key);
  return new Response(null, { status: 204 });
}
