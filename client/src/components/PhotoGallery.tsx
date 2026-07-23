import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, GridIcon } from "./icons";
import { colors } from "../theme";

interface PhotoGalleryProps {
  images: string[];
  alt: string;
  ph: string;
}

/** Airbnb-style hero: one big photo + a 2x2 thumbnail grid, with a "Show all
 * photos" button that opens a full-screen, keyboard-navigable lightbox. */
export function PhotoGallery({ images, alt, ph }: PhotoGalleryProps) {
  const [openAt, setOpenAt] = useState<number | null>(null);
  const photos = images;

  return (
    <>
      <div
        className="hero-photo"
        style={{
          position: "relative",
          height: 380,
          borderRadius: 20,
          overflow: "hidden",
          display: "grid",
          gridTemplateColumns: photos.length > 1 ? "1.5fr 1fr" : "1fr",
          gap: 4,
          background: ph,
        }}
      >
        <div
          style={{ position: "relative", cursor: photos.length ? "pointer" : "default", background: ph }}
          onClick={() => photos.length && setOpenAt(0)}
        >
          {photos[0] && (
            <img
              src={photos[0]}
              alt={alt}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          )}
        </div>
        {photos.length > 1 && (
          <div className="hide-mobile" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 4 }}>
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                style={{ position: "relative", cursor: photos[i] ? "pointer" : "default", background: ph }}
                onClick={() => photos[i] && setOpenAt(i)}
              >
                {photos[i] && (
                  <img
                    src={photos[i]}
                    alt={`${alt} photo ${i + 1}`}
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        )}
        {photos.length > 1 && (
          <button
            onClick={() => setOpenAt(0)}
            style={{
              position: "absolute",
              right: 16,
              bottom: 16,
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              background: "#fff",
              border: `1.5px solid ${colors.text}`,
              borderRadius: 10,
              padding: "9px 14px",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "0 2px 10px rgba(0,0,0,.14)",
            }}
          >
            <GridIcon size={15} /> Show all photos
          </button>
        )}
      </div>
      {openAt !== null &&
        photos.length > 0 &&
        createPortal(
          <Lightbox photos={photos} alt={alt} index={openAt} onIndex={setOpenAt} onClose={() => setOpenAt(null)} />,
          document.body
        )}
    </>
  );
}

const navBtnStyle: CSSProperties = {
  position: "absolute",
  top: "50%",
  transform: "translateY(-50%)",
  background: "rgba(255,255,255,.14)",
  border: "none",
  borderRadius: "50%",
  width: 44,
  height: 44,
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

function Lightbox({
  photos,
  alt,
  index,
  onIndex,
  onClose,
}: {
  photos: string[];
  alt: string;
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onIndex((index - 1 + photos.length) % photos.length);
      if (e.key === "ArrowRight") onIndex((index + 1) % photos.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, photos.length, onIndex, onClose]);

  return (
    <div
      className="pop-in"
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(20,22,20,.94)", display: "flex", flexDirection: "column" }}
      onClick={onClose}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 22px", color: "#fff", flex: "none" }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          {index + 1} / {photos.length}
        </span>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{ background: "rgba(255,255,255,.14)", border: "none", borderRadius: "50%", width: 38, height: 38, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
        >
          <CloseIcon size={18} />
        </button>
      </div>
      <div
        style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", padding: "0 20px 20px", minHeight: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        {photos.length > 1 && (
          <button onClick={() => onIndex((index - 1 + photos.length) % photos.length)} aria-label="Previous photo" style={{ ...navBtnStyle, left: 12 }}>
            <ChevronLeftIcon size={20} />
          </button>
        )}
        <img
          src={photos[index]}
          alt={`${alt} photo ${index + 1}`}
          style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 12, objectFit: "contain" }}
        />
        {photos.length > 1 && (
          <button onClick={() => onIndex((index + 1) % photos.length)} aria-label="Next photo" style={{ ...navBtnStyle, right: 12 }}>
            <ChevronRightIcon size={20} />
          </button>
        )}
      </div>
    </div>
  );
}
