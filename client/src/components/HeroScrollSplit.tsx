import { useRef } from "react";

export interface HeroScrollImage {
  src: string;
  alt: string;
  /** CSS object-position (e.g. "50% 40%") — the hero band's aspect ratio
   * is very wide/short, so a plain center crop can cut through a subject
   * that isn't centered in the source photo (see Home.tsx's hiking-trail
   * image comment). Defaults to center when omitted. */
  focus?: string;
}

/** Hero image strip — each image at full width, one filling the band at a
 * time; horizontally scrollable/draggable to move between them (native
 * overflow-x for trackpad/touch, plus a pointer-drag handler for a plain
 * desktop mouse), with scroll-snap so it always settles on a full image
 * rather than stopping mid-frame. Earlier versions split the width between
 * two images (70/30, flipping on page scroll) — dropped in favor of
 * showing each photo at its full size, which also removes the per-frame
 * scroll-linked style mutation entirely (nothing left to animate). */
export function HeroScrollSplit({ images }: { images: HeroScrollImage[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startScroll: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    dragRef.current = { startX: e.clientX, startScroll: el.scrollLeft };
    el.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !scrollRef.current) return;
    scrollRef.current.scrollLeft = dragRef.current.startScroll - (e.clientX - dragRef.current.startX);
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  if (images.length === 0) return null;

  return (
    <div
      ref={scrollRef}
      className="hide-scrollbar"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        overflowX: "auto",
        overflowY: "hidden",
        scrollSnapType: "x mandatory",
        cursor: images.length > 1 ? "grab" : "default",
      }}
    >
      {images.map((img) => (
        <div key={img.src} style={{ flex: "0 0 100%", position: "relative", overflow: "hidden", scrollSnapAlign: "start" }}>
          <img
            src={img.src}
            alt={img.alt}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: img.focus ?? "center",
              display: "block",
              filter: "saturate(1.3) contrast(1.05)",
              pointerEvents: "none",
            }}
            draggable={false}
          />
        </div>
      ))}
    </div>
  );
}
