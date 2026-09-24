import { getClientId } from "../clientId";
import { ApiError, request } from "./core";
import { uploadImage } from "./public";

export type MediaEntityType =
  | "resident-avatar"
  | "activity-cover"
  | "circle-cover"
  | "centre-gallery"
  | "club-gallery"
  | "club-session-cover"
  | "experience-gallery"
  | "program-cover"
  | "org-logo"
  | "vendor-draft-media";

interface AuthorizeResult {
  provider: "r2";
  objectKey: string;
  uploadUrl: string;
  method: "PUT";
  expiresAt: string;
  maxBytes: number;
}

interface FinalizeResult {
  objectKey: string;
  url: string;
  contentType: string;
  contentLength: number;
}

const NOT_CONFIGURED = "not configured";

/** Stage A+B of the two-step upload (media plan §6): authorize -> PUT
 * straight to R2 -> finalize. Returns null (rather than throwing) when
 * cloud media storage isn't configured (a 503 from /media/authorize means
 * MEDIA_PROVIDER=local server-side) — callers each fall back to their own
 * correct legacy route (they differ: galleries/logo use /api/uploads,
 * avatars use their own dedicated /api/residents/me/avatar pipeline), so
 * this doesn't bake in any one fallback itself. */
async function authorizeAndFinalize(file: File, entityType: MediaEntityType, entityId: string): Promise<{ url: string } | null> {
  let authorized: AuthorizeResult;
  try {
    authorized = await request<AuthorizeResult>("/media/authorize", {
      method: "POST",
      body: JSON.stringify({ entityType, entityId, contentType: file.type }),
    });
  } catch (e) {
    if (e instanceof ApiError && e.message.includes(NOT_CONFIGURED)) return null;
    throw e;
  }

  const putRes = await fetch(authorized.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
  if (!putRes.ok) throw new Error(`Upload to storage failed: ${putRes.status}`);

  const finalized = await request<FinalizeResult>("/media/finalize", {
    method: "POST",
    body: JSON.stringify({ entityType, entityId, objectKey: authorized.objectKey }),
  });
  return { url: finalized.url };
}

interface LocalProcessingResult {
  url: string;
  contentType: string;
  contentLength: number;
}

/** Local-processing upload (Cost Controls, Changeset 2) — one multipart
 * POST; the server decodes, generates every required size, AVIF-encodes
 * each, and returns the canonical (largest, or only) variant's url. A 503
 * means MEDIA_LOCAL_PROCESSING_ENABLED is off server-side — falls back to
 * the presigned flow below, same "try the newer path, fall back on 503"
 * idiom authorizeAndFinalize itself uses against the legacy uploader. */
async function uploadWithLocalProcessing(file: File, entityType: MediaEntityType, entityId: string): Promise<{ url: string } | null> {
  const form = new FormData();
  form.append("file", file);
  form.append("entityType", entityType);
  form.append("entityId", entityId);
  const res = await fetch(`/api/media/upload`, { method: "POST", credentials: "include", headers: { "X-Client-Id": getClientId() }, body: form });
  if (res.status === 503) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Upload failed: ${res.status}`);
  }
  const result = (await res.json()) as LocalProcessingResult;
  return { url: result.url };
}

/** For galleries (Centre/Club/Experience) and the org logo — same
 * shape/fallback (/api/uploads) as the legacy uploadImage() always had, so
 * every existing call site can swap in unconditionally. Tries the local-
 * processing path first (falls back automatically if it's not enabled),
 * then the presigned R2 flow, then the legacy local-disk uploader — three
 * tiers, each one just a config flag away from being the active one. */
export async function uploadMedia(file: File, entityType: MediaEntityType, entityId: string): Promise<{ url: string }> {
  const local = await uploadWithLocalProcessing(file, entityType, entityId);
  if (local) return local;
  const result = await authorizeAndFinalize(file, entityType, entityId);
  return result ?? uploadImage(file);
}

export { authorizeAndFinalize };

/** Best-effort release of a URL a caller no longer references (e.g.
 * replacing a gallery image) — a no-op in local mode, fire-and-forget
 * everywhere (never blocks or throws into the caller's own save flow). */
export function releaseMedia(entityType: MediaEntityType, entityId: string, url: string): void {
  if (!url.startsWith("http")) return; // legacy /uploads/... path — nothing in R2 to release
  request("/media/release", { method: "POST", body: JSON.stringify({ entityType, entityId, url }) }).catch(() => {});
}
