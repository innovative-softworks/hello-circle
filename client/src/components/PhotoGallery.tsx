import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, GridIcon } from "./icons";
import { getMediaUrl } from "../media";
import { cardImageRatio, colors, radius } from "../theme";

interface PhotoGalleryProps {
  /** Cover photos in order; empty/null entries are ignored. */
  images: (string | null | undefined)[];
  alt: string;
  /** Placeholder background while loading or when there's no photo. */
  ph: string;
  /** Glyph shown on the placeholder when there's no photo at all. */
  icon?: ReactNode;
  iconColor?: string;
  /** Pills painted over the cover (date, spots left…), top of the frame. */
  overlay?: ReactNode;
  /** Upper bound on the cover height in px (default 460). */
  maxHeight?: number;
  /** Space under the cover. */
  style?: CSSProperties;
}

/** The one cover for every detail page (Batch 2, owner 2026-10-22): the
 * same 16:9 frame (capped at `maxHeight`) whether a listing has one photo or
 * many. Several photos slide — swipe on touch, arrows, dots, a "1 / N"
 * counter — and "Show all photos" (or a tap on the photo) opens the
 * full-screen viewer. One photo: the same frame, no controls. While a photo
 * loads the frame shows the skeleton shimmer; nothing fades, zooms or morphs. */
export function PhotoGallery({ images, alt, ph, icon, iconColor, overlay, maxHeight = 460, style }: PhotoGalleryProps) {
  const photos = images.filter((p): p is string => !!p);
  const [openAt, setOpenAt] = useState<number | null>(null);
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState<Record<number, boolean>>({});
  const trackRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const many = photos.length > 1;
  // Tell the detail page how tall the cover is, so the booking box beside it
  // can match (owner 2026-10-27; used by .detail-grid's --cover-h on desktop).
  useEffect(() => {
    const frame = frameRef.current;
    const grid = frame?.closest<HTMLElement>(".detail-grid");
    if (!frame || !grid || typeof ResizeObserver === "undefined") return;
    const apply = () => grid.style.setProperty("--cover-h", `${Math.round(frame.getBoundingClientRect().height)}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(frame);
    return () => {
      ro.disconnect();
      grid.style.removeProperty("--cover-h");
    };
  }, []);

  useEffect(() => {
    setIndex(0);
    setLoaded({});
    trackRef.current?.scrollTo({ left: 0 });
  }, [photos.join("|")]);

  const goTo = (i: number) => {
    const track = trackRef.current;
    const next = (i + photos.length) % photos.length;
    setIndex(next);
    if (track) track.scrollTo({ left: next * track.clientWidth, behavior: "auto" });
  };

  return (
    <>
      <div
        ref={frameRef}
        className="cover-frame"
        role={many ? "region" : undefined}
        aria-roledescription={many ? "carousel" : undefined}
        aria-label={many ? `${alt} photos` : undefined}
        // No photo: a short band, not a tall empty 16:9 frame (detail-page redesign).
        style={{ position: "relative", width: "100%", aspectRatio: photos.length ? cardImageRatio.hero : "21 / 9", maxHeight: photos.length ? maxHeight : 200, borderRadius: radius.card, overflow: "hidden", background: ph, ...style }}
      >
        {photos.length === 0 && icon && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 72, height: 72, borderRadius: "50%", background: "rgba(255,255,255,.6)", display: "flex", alignItems: "center", justifyContent: "center", color: iconColor }}>{icon}</div>
          </div>
        )}
        {photos.length > 0 && (
          <div
            ref={trackRef}
            className="cover-track"
            onScroll={(e) => {
              const t = e.currentTarget;
              const i = Math.round(t.scrollLeft / Math.max(1, t.clientWidth));
              if (i !== index) setIndex(i);
            }}
            style={{ position: "absolute", inset: 0, display: "flex", overflowX: many ? "auto" : "hidden", scrollSnapType: "x mandatory" }}
          >
            {photos.map((src, i) => (
              <div
                key={`${src}-${i}`}
                className={loaded[i] ? undefined : "skeleton"}
                aria-hidden={i !== index}
                style={{ position: "relative", flex: "0 0 100%", height: "100%", scrollSnapAlign: "start", cursor: "zoom-in", borderRadius: 0 }}
                onClick={() => setOpenAt(i)}
              >
                <img
                  src={getMediaUrl(src, "hero")}
                  alt={many ? `${alt} — photo ${i + 1} of ${photos.length}` : alt}
                  loading={i === 0 ? "eager" : "lazy"}
                  onLoad={() => setLoaded((l) => ({ ...l, [i]: true }))}
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                    setLoaded((l) => ({ ...l, [i]: true }));
                  }}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                />
              </div>
            ))}
          </div>
        )}
        {overlay && (
          <div className="photo-content" style={{ position: "absolute", left: 0, right: 0, top: 0, padding: 16, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, zIndex: 1 }}>
            {overlay}
          </div>
        )}
        {many && (
          <>
            <button type="button" className="cover-arrow cover-arrow--prev" onClick={() => goTo(index - 1)} aria-label="Previous photo" style={{ ...coverArrowStyle, left: 12 }}>
              <ChevronLeftIcon size={18} />
            </button>
            <button type="button" className="cover-arrow cover-arrow--next" onClick={() => goTo(index + 1)} aria-label="Next photo" style={{ ...coverArrowStyle, right: 12 }}>
              <ChevronRightIcon size={18} />
            </button>
            {/* DP-11 — each dot is an 8px mark inside a 24px tap target (WCAG 2.5.8). */}
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 6, display: "flex", justifyContent: "center", gap: 0, zIndex: 1 }}>
              {photos.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => goTo(i)}
                  aria-label={`Photo ${i + 1} of ${photos.length}`}
                  aria-current={i === index ? "true" : undefined}
                  style={{ width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", border: "none", padding: 0, background: "transparent", cursor: "pointer" }}
                >
                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: i === index ? "#fff" : "rgba(255,255,255,.55)", boxShadow: "0 0 0 1px rgba(0,0,0,.15)" }} />
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setOpenAt(index)}
              style={{ position: "absolute", right: 12, bottom: 12, zIndex: 1, display: "inline-flex", alignItems: "center", gap: 6, background: colors.surface, color: colors.text, border: `1px solid ${colors.borderStrong}`, borderRadius: radius.pill, padding: "7px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
            >
              <GridIcon size={14} /> {index + 1} / {photos.length}
            </button>
          </>
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

const coverArrowStyle: CSSProperties = {
  position: "absolute",
  top: "50%",
  transform: "translateY(-50%)",
  zIndex: 1,
  width: 38,
  height: 38,
  borderRadius: "50%",
  border: "none",
  background: "rgba(255,255,255,.92)",
  color: "#172019",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  boxShadow: "0 1px 6px rgba(0,0,0,.18)",
};

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

/** Full-screen photo viewer. Also used by Circle Memories (owner,
 * 2026-10-24: "memories should be popup like in other areas"), which passes
 * a caption per photo. */
export function Lightbox({
  photos,
  alt,
  index,
  onIndex,
  onClose,
  captions,
}: {
  photos: string[];
  alt: string;
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  captions?: (string | null)[];
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
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(20,22,20,.94)", display: "flex", flexDirection: "column" }}
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
          src={getMediaUrl(photos[index], "hero")}
          alt={`${alt} photo ${index + 1}`}
          style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: radius.control, objectFit: "contain" }}
        />
        {photos.length > 1 && (
          <button onClick={() => onIndex((index + 1) % photos.length)} aria-label="Next photo" style={{ ...navBtnStyle, right: 12 }}>
            <ChevronRightIcon size={20} />
          </button>
        )}
      </div>
      {captions?.[index] && (
        <p style={{ margin: 0, padding: "0 24px 24px", color: "#fff", fontSize: 14.5, lineHeight: 1.5, textAlign: "center", flex: "none" }} onClick={(e) => e.stopPropagation()}>
          {captions[index]}
        </p>
      )}
    </div>
  );
}
