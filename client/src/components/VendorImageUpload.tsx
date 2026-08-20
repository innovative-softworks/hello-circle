import { useState } from "react";
import { uploadImage } from "../api";
import { CameraIcon, CloseIcon, PlusIcon } from "./icons";
import { labelStyle } from "./ui";
import { colors } from "../theme";

// Used identically by both VendorCentreEditor.tsx and VendorClubEditor.tsx
// — extracted once rather than living inside either. Split out of the
// original single VendorDashboard.tsx (see CLAUDE.md).

export function MultiImageUpload({ images, onChange }: { images: string[]; onChange: (urls: string[]) => void }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded: string[] = [];
      for (const file of Array.from(files)) {
        const { url } = await uploadImage(file);
        uploaded.push(url);
      }
      onChange([...images, ...uploaded]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const removeAt = (i: number) => onChange(images.filter((_, idx) => idx !== i));

  return (
    <div>
      <label style={labelStyle}>Photos</label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 10 }}>
        {images.map((url, i) => (
          <div key={i} style={{ position: "relative", height: 90, borderRadius: 10, overflow: "hidden", background: colors.bg }}>
            <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            <button
              onClick={() => removeAt(i)}
              aria-label="Remove photo"
              style={{ position: "absolute", top: 5, right: 5, width: 22, height: 22, borderRadius: "50%", border: "none", background: "rgba(20,22,20,.7)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
            >
              <CloseIcon size={12} />
            </button>
            {i === 0 && (
              <span style={{ position: "absolute", left: 5, bottom: 5, background: "rgba(20,22,20,.7)", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 5, padding: "2px 6px" }}>
                Cover
              </span>
            )}
          </div>
        ))}
        <label
          className="image-drop"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            height: 90,
            border: `1.5px dashed ${colors.borderStrong}`,
            borderRadius: 10,
            background: colors.bg,
            color: colors.mutedLight,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {uploading ? <CameraIcon size={18} /> : <PlusIcon size={18} />}
          {uploading ? "Uploading…" : "Add photo"}
          <input type="file" accept="image/*" multiple onChange={(e) => onFiles(e.target.files)} disabled={uploading} style={{ display: "none" }} />
        </label>
      </div>
      {error && <p style={{ color: colors.danger, fontSize: 12, margin: "6px 0 0" }}>{error}</p>}
    </div>
  );
}
