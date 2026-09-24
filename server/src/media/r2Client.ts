import { S3Client } from "@aws-sdk/client-s3";
import { mediaConfig } from "./config.js";

/** Null when MEDIA_PROVIDER isn't "r2" (dev-without-Cloudflare fallback) —
 * every call site must check for null and fall back to the legacy local
 * upload routes (routes/uploads.ts, routes/residents.ts's avatar handler),
 * which stay untouched specifically so that fallback works. */
export const r2Client: S3Client | null =
  mediaConfig.provider === "r2" && mediaConfig.r2
    ? new S3Client({
        region: "auto",
        endpoint: mediaConfig.r2.endpoint,
        credentials: { accessKeyId: mediaConfig.r2.accessKeyId, secretAccessKey: mediaConfig.r2.secretAccessKey },
      })
    : null;
