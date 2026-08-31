import { useState } from "react";
import { uploadImage } from "../api";
import { CameraIcon, CloseIcon, PlusIcon, StarIcon } from "./icons";
import { labelStyle } from "./ui";
import { colors, radius } from "../theme";

// Used identically by both VendorCentreEditor.tsx and VendorClubEditor.tsx
// — extracted once rather than living inside either. Split out of the
// original single VendorDashboard.tsx (see CLAUDE.md).
//
// Form System Audit §19 — drag-to-reorder, an explicit "Set as cover"
// action (previously the first upload was silently the cover with no way
// to promote a later one), count-based upload progress, and real
// requirements text (JPEG/PNG/WebP/GIF, 8MB max — see server/src/routes/
// uploads.ts's multer config, which is what these numbers/types are
// actually enforced against).

export function MultiImageUpload({ images, onChange }: { images: string[]; onChange: (urls: string[]) => void }) {
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    setUploadProgress({ done: 0, total: list.length });
    setError(null);
    try {
      const uploaded: string[] = [];
      for (const file of list) {
        const { url } = await uploadImage(file);
        uploaded.push(url);
        setUploadProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
      }
      onChange([...images, ...uploaded]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadProgress(null);
    }
  };

  const removeAt = (i: number) => onChange(images.filter((_, idx) => idx !== i));
  const setCover = (i: number) => onChange([images[i], ...images.slice(0, i), ...images.slice(i + 1)]);
  const reorder = (from: number, to: number) => {
    if (from === to) return;
    const next = images.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  return (
    <div>
      <label style={labelStyle}>Photos</label>
      <p style={{ fontSize: 12, color: colors.mutedLight, margin: "-2px 0 8px" }}>
        JPEG, PNG, WebP or GIF, up to 8MB each. Drag to reorder — the first photo is your cover.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 10 }}>
        {images.map((url, i) => (
          <div
            key={url + i}
            draggable
            onDragStart={() => setDragIndex(i)}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragOverIndex !== i) setDragOverIndex(i);
            }}
            onDragLeave={() => setDragOverIndex((cur) => (cur === i ? null : cur))}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null) reorder(dragIndex, i);
              setDragIndex(null);
              setDragOverIndex(null);
            }}
            onDragEnd={() => {
              setDragIndex(null);
              setDragOverIndex(null);
            }}
            style={{
              position: "relative",
              height: 90,
              borderRadius: radius.control,
              overflow: "hidden",
              background: colors.bg,
              cursor: "grab",
              outline: dragOverIndex === i && dragIndex !== null && dragIndex !== i ? `2px solid ${colors.green}` : "none",
              outlineOffset: 2,
              opacity: dragIndex === i ? 0.4 : 1,
            }}
          >
            <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none" }} />
            <button
              onClick={() => removeAt(i)}
              aria-label="Remove photo"
              style={{ position: "absolute", top: 5, right: 5, width: 22, height: 22, borderRadius: "50%", border: "none", background: "rgba(20,22,20,.7)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
            >
              <CloseIcon size={12} />
            </button>
            {i === 0 ? (
              <span style={{ position: "absolute", left: 5, bottom: 5, background: "rgba(20,22,20,.7)", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 5, padding: "2px 6px", display: "inline-flex", alignItems: "center", gap: 3 }}>
                <StarIcon size={9} /> Cover
              </span>
            ) : (
              <button
                onClick={() => setCover(i)}
                style={{ position: "absolute", left: 5, bottom: 5, background: "rgba(20,22,20,.7)", color: "#fff", fontSize: 10, fontWeight: 700, border: "none", borderRadius: 5, padding: "2px 6px", cursor: "pointer" }}
              >
                Set as cover
              </button>
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
            borderRadius: radius.control,
            background: colors.bg,
            color: colors.mutedLight,
            fontSize: 12,
            cursor: uploadProgress ? "default" : "pointer",
            textAlign: "center",
            padding: "0 6px",
          }}
        >
          {uploadProgress ? <CameraIcon size={18} /> : <PlusIcon size={18} />}
          {uploadProgress ? `Uploading ${uploadProgress.done + 1} of ${uploadProgress.total}…` : "Add photo"}
          <input type="file" accept="image/*" multiple onChange={(e) => onFiles(e.target.files)} disabled={!!uploadProgress} style={{ display: "none" }} />
        </label>
      </div>
      {error && <p style={{ color: colors.danger, fontSize: 12, margin: "6px 0 0" }}>{error}</p>}
    </div>
  );
}
