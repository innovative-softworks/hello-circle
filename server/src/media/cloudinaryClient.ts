import { v2 as cloudinaryV2 } from "cloudinary";
import { mediaConfig } from "./config.js";

/** Null when Cloudinary credentials aren't set — every call site must check
 * for null and treat Cloudinary as unavailable (same convention as
 * r2Client.ts). Configuring the SDK does not itself enable uploads; that's
 * gated separately by mediaConfig.cloudinaryUploadsEnabledByEnv AND the
 * `cloudinary_uploads_enabled` app_settings runtime flag (see
 * mediaService.ts's isCloudinaryUploadEnabled()) — this client only decides
 * whether Cloudinary CAN be reached at all. */
export const cloudinary = mediaConfig.cloudinary
  ? (() => {
      cloudinaryV2.config({
        cloud_name: mediaConfig.cloudinary!.cloudName,
        api_key: mediaConfig.cloudinary!.apiKey,
        api_secret: mediaConfig.cloudinary!.apiSecret,
        secure: true,
      });
      return cloudinaryV2;
    })()
  : null;
