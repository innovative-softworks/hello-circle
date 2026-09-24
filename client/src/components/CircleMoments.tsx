import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "./icons";
import { fetchCircleMoments } from "../api";
import { getMediaUrl } from "../media";
import type { Circle, CircleMoment } from "../types";
import { radius } from "../theme";

// "Moments" (Circle Detail full rewrite §07) — an asymmetric photo mosaic,
// not four identical thumbnails. Sourced from the linked venue's own real
// gallery (centre_images) rather than per-game images: every game sharing
// this Circle's activity label carries the identical seeded photo (see
// routes/circles.ts's GET /:id/moments comment), so pulling "recent game
// photos" would just repeat one image N times. Clicking one opens a plain
// enlarge-only lightbox — no likes/comments/reactions.

const MOSAIC_AREAS: React.CSSProperties[] = [
  { gridColumn: "1 / 2", gridRow: "1 / 3" }, // large, spans both rows
  { gridColumn: "2 / 3", gridRow: "1 / 2" },
  { gridColumn: "3 / 4", gridRow: "1 / 2" },
  { gridColumn: "2 / 4", gridRow: "2 / 3" }, // wide
];

export function CircleMoments({ circle }: { circle: Circle }) {
  const [moments, setMoments] = useState<CircleMoment[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetchCircleMoments(circle.id)
      .then(setMoments)
      .catch(() => setMoments([]));
  }, [circle.id]);

  if (moments.length === 0) return null;

  return (
    <div>
      <div
        className="circle-moments-grid"
        style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr", gridTemplateRows: "repeat(2, 170px)", gap: 10 }}
      >
        {moments.slice(0, 4).map((m, i) => (
          <button
            key={m.id}
            className="circle-moments-item"
            onClick={() => setOpen(m.imageUrl)}
            style={{ ...MOSAIC_AREAS[i], background: `url(${getMediaUrl(m.imageUrl, "thumbnail")}) center/cover`, borderRadius: radius.control, border: "none", padding: 0, cursor: "pointer" }}
            aria-label="Enlarge photo"
          />
        ))}
      </div>

      {open &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            onClick={() => setOpen(null)}
            style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(20,22,20,.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
          >
            <button
              onClick={() => setOpen(null)}
              aria-label="Close"
              style={{ position: "absolute", top: 20, right: 20, width: 40, height: 40, borderRadius: "50%", border: "none", background: "rgba(255,255,255,.15)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
            >
              <CloseIcon size={18} />
            </button>
            <img src={getMediaUrl(open, "card")} alt="" style={{ maxWidth: "90vw", maxHeight: "85vh", borderRadius: 12, objectFit: "contain" }} onClick={(e) => e.stopPropagation()} />
          </div>,
          document.body
        )}
    </div>
  );
}
