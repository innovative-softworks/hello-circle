import { useRef, useState } from "react";
import { releaseMedia, uploadMedia, type MediaEntityType } from "../api";
import { getMediaUrl } from "../media";
import { CameraIcon, CloseIcon, PlusIcon } from "./icons";
import { labelStyle } from "./ui";
import { colors, radius } from "../theme";

// Single-image counterpart to MultiImageUpload (media plan §22) — Activity/
// Program/Circle covers are deliberately single-image, not a gallery (media
// plan §21/§30/§31), so this is a separate, simpler component rather than
// MultiImageUpload with maxCount=1. Both share the same underlying upload
// service (client/src/api/media.ts's uploadMedia()/releaseMedia()).

export function SingleImageUpload({
  label = "Cover photo",
  value,
  onChange,
  mediaEntityType,
  mediaEntityId,
}: {
  label?: string;
  value: string | null;
  onChange: (url: string | null) => void;
  mediaEntityType: MediaEntityType;
  mediaEntityId: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // HC-QA-067 — one hidden file input opened by real <button>s. The old
  // pattern (a <label> wrapping a display:none input) dropped the control
  // out of the tab order entirely, so keyboard users could never upload.
  const inputRef = useRef<HTMLInputElement>(null);

  const onFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const previous = value;
      const { url } = await uploadMedia(file, mediaEntityType, mediaEntityId);
      onChange(url);
      if (previous) releaseMedia(mediaEntityType, mediaEntityId, previous);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const remove = () => {
    if (value) releaseMedia(mediaEntityType, mediaEntityId, value);
    onChange(null);
  };

  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <p style={{ fontSize: 12, color: colors.mutedLight, margin: "-2px 0 8px" }}>JPEG, PNG or WebP, up to 10MB.</p>
      {value ? (
        <div style={{ position: "relative", height: 140, width: 220, borderRadius: radius.control, overflow: "hidden", background: colors.bg }}>
          <img src={getMediaUrl(value, "card")} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          <button
            onClick={remove}
            aria-label="Remove photo"
            style={{ position: "absolute", top: 5, right: 5, width: 22, height: 22, borderRadius: "50%", border: "none", background: "rgba(20,22,20,.7)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            <CloseIcon size={12} />
          </button>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="image-drop"
            aria-label={`Replace ${label.toLowerCase()}`}
            style={{
              position: "absolute",
              left: 5,
              bottom: 5,
              border: "none",
              background: "rgba(20,22,20,.7)",
              color: "#fff",
              fontSize: 10,
              fontWeight: 700,
              borderRadius: 5,
              padding: "2px 6px",
              cursor: uploading ? "default" : "pointer",
            }}
          >
            {uploading ? "Uploading…" : "Replace"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="image-drop"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            height: 90,
            width: 220,
            border: `1.5px dashed ${colors.borderStrong}`,
            borderRadius: radius.control,
            background: colors.bg,
            color: colors.mutedLight,
            fontSize: 12,
            cursor: uploading ? "default" : "pointer",
            textAlign: "center",
            padding: "0 6px",
          }}
        >
          {uploading ? <CameraIcon size={18} /> : <PlusIcon size={18} />}
          {uploading ? "Uploading…" : "Add photo"}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        tabIndex={-1}
        onChange={(e) => { void onFile(e.target.files); e.target.value = ""; }}
        disabled={uploading}
      />
      {error && <p role="alert" style={{ color: colors.danger, fontSize: 12, margin: "6px 0 0" }}>{error}</p>}
    </div>
  );
}
