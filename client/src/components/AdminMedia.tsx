import { useEffect, useRef, useState } from "react";
import {
  deleteEditorialImage,
  fetchCloudinaryUploadsEnabled,
  fetchEditorialImages,
  fetchMediaUploadsEnabled,
  fetchMediaUsage,
  setCloudinaryUploadsEnabled,
  setMediaUploadsEnabled,
  uploadEditorialImage,
  type EditorialImage,
  type MediaUsageResponse,
} from "../api/admin";
import { getMediaUrl } from "../media";
import { colors, fonts, radius } from "../theme";
import { Button, ManageCard as Card } from "./ui";

// Media architecture pass — usage visibility (application-measured, never
// presented as provider billing), the pause switches, and the small
// Cloudinary editorial-image pilot. See server/src/media/mediaService.ts
// and routes/adminMedia.ts for the actual enforcement; this tab only
// surfaces/toggles what's already server-enforced.

function bytesToMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function ToggleRow({ label, hint, checked, onChange, disabled }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding: "10px 0", borderBottom: `1px solid ${colors.border}` }}>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 12, color: colors.mutedLight, marginTop: 2 }}>{hint}</div>
      </div>
      <label style={{ display: "inline-flex", alignItems: "center", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1, flex: "none" }}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: colors.green, width: 18, height: 18 }} />
      </label>
    </div>
  );
}

export function AdminMediaTab() {
  const [usage, setUsage] = useState<MediaUsageResponse | null>(null);
  const [images, setImages] = useState<EditorialImage[] | null>(null);
  const [uploadsEnabled, setUploadsEnabledState] = useState<boolean | null>(null);
  const [cloudinaryState, setCloudinaryState] = useState<{ enabled: boolean; configuredByEnv: boolean; credentialsPresent: boolean } | null>(null);
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    fetchMediaUsage().then(setUsage);
    fetchEditorialImages().then((r) => setImages(r.images));
    fetchMediaUploadsEnabled().then((r) => setUploadsEnabledState(r.enabled));
    fetchCloudinaryUploadsEnabled().then(setCloudinaryState);
  };
  useEffect(load, []);

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      await uploadEditorialImage(files[0], caption);
      setCaption("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this editorial image? This can't be undone.")) return;
    await deleteEditorialImage(id);
    load();
  };

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <p style={{ fontSize: 13, color: colors.mutedLight, margin: 0, maxWidth: 680 }}>
        Every ordinary upload (avatars, listing galleries, covers) stays on Cloudflare R2 by default — this tab is
        about a small, admin-curated editorial image collection that can optionally use Cloudinary instead, plus
        application-level usage visibility and the pause switches for new uploads. Nothing here affects delivery of
        images that are already uploaded.
      </p>

      <Card>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 4px" }}>Uploads</h4>
        {uploadsEnabled === null || !cloudinaryState ? (
          <span style={{ fontSize: 12, color: colors.faint }}>Loading…</span>
        ) : (
          <>
            <ToggleRow
              label="New uploads enabled"
              hint="Global pause — turning this off blocks every new upload (any provider) but never touches images already stored."
              checked={uploadsEnabled}
              onChange={async (v) => setUploadsEnabledState((await setMediaUploadsEnabled(v)).enabled)}
            />
            <ToggleRow
              label="Cloudinary uploads enabled"
              hint={
                cloudinaryState.credentialsPresent
                  ? cloudinaryState.configuredByEnv
                    ? "Pauses new editorial uploads to Cloudinary specifically. Existing Cloudinary images keep rendering either way."
                    : "CLOUDINARY_UPLOADS_ENABLED is not set to true in this deployment — this can only be switched off here until an operator changes that env var."
                  : "No Cloudinary credentials configured for this deployment — nothing to enable yet."
              }
              checked={cloudinaryState.enabled}
              disabled={!cloudinaryState.credentialsPresent || !cloudinaryState.configuredByEnv}
              onChange={async (v) => {
                await setCloudinaryUploadsEnabled(v);
                setCloudinaryState(await fetchCloudinaryUploadsEnabled());
              }}
            />
          </>
        )}
      </Card>

      <Card>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 4px" }}>Usage (application-measured)</h4>
        {!usage ? (
          <span style={{ fontSize: 12, color: colors.faint }}>Loading…</span>
        ) : (
          <>
            <p style={{ fontSize: 11.5, color: colors.faint, margin: "0 0 12px" }}>{usage.application.note}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
              {usage.application.byProviderAndStatus.length === 0 ? (
                <span style={{ fontSize: 12, color: colors.faint }}>No recorded uploads yet.</span>
              ) : (
                usage.application.byProviderAndStatus.map((row) => (
                  <div key={`${row.provider}-${row.status}`} style={{ padding: "8px 12px", borderRadius: radius.control, background: colors.bg, fontSize: 12 }}>
                    <strong>{row.provider}</strong> · {row.status} — {row.count} file{row.count === 1 ? "" : "s"}, {bytesToMb(row.bytes)} MB
                  </div>
                ))
              )}
            </div>
            <div style={{ fontSize: 12, color: colors.mutedLight, display: "flex", flexDirection: "column", gap: 4 }}>
              <span>Cloudflare R2 account usage: {usage.providerReported.r2.note}</span>
              <span>Cloudinary account usage: {usage.providerReported.cloudinary.note}</span>
              {usage.hasPendingR2Cleanup && <span style={{ color: colors.danger }}>Pending uploads awaiting cleanup — run `npm run media-cleanup --workspace server`.</span>}
              {usage.hasPendingDeletionRetries && <span style={{ color: colors.danger }}>Failed provider deletions awaiting retry — run `npm run media-cleanup --workspace server`.</span>}
            </div>
          </>
        )}
      </Card>

      <Card>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 4px" }}>Editorial collection</h4>
        <p style={{ fontSize: 12, color: colors.mutedLight, margin: "0 0 12px" }}>
          A small set of platform/editorial images (e.g. county guides, homepage features) — not tied to any listing.
          JPEG/PNG/WebP, up to 8MB.
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Caption (optional)"
            style={{ flex: "1 1 220px", padding: "8px 10px", borderRadius: radius.control, border: `1px solid ${colors.border}`, fontSize: 13 }}
          />
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => onFiles(e.target.files)} disabled={uploading} style={{ fontSize: 12 }} />
        </div>
        {uploading && <p style={{ fontSize: 12, color: colors.mutedLight }}>Uploading…</p>}
        {error && <p style={{ fontSize: 12, color: colors.danger }}>{error}</p>}
        {!images ? (
          <span style={{ fontSize: 12, color: colors.faint }}>Loading…</span>
        ) : images.length === 0 ? (
          <span style={{ fontSize: 12, color: colors.faint }}>No editorial images yet.</span>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
            {images.map((img) => (
              <div key={img.id} style={{ position: "relative", borderRadius: radius.control, overflow: "hidden", background: colors.bg }}>
                <img src={getMediaUrl(img.url, "thumbnail")} alt={img.caption ?? ""} style={{ width: "100%", height: 100, objectFit: "cover", display: "block" }} />
                <div style={{ padding: "6px 8px" }}>
                  {img.caption && <div style={{ fontSize: 11.5, marginBottom: 2 }}>{img.caption}</div>}
                  <div style={{ fontSize: 10.5, color: colors.faint }}>{img.bytes ? `${bytesToMb(img.bytes)} MB` : ""}</div>
                </div>
                <button
                  onClick={() => remove(img.id)}
                  aria-label="Delete"
                  style={{ position: "absolute", top: 5, right: 5, width: 22, height: 22, borderRadius: "50%", border: "none", background: "rgba(20,22,20,.7)", color: "#fff", cursor: "pointer" }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
      <div>
        <Button variant="ghost" onClick={load}>Refresh</Button>
      </div>
    </div>
  );
}
