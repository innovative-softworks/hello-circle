import { useEffect, useRef, useState } from "react";
import { radius } from "../theme";

export interface HeroCarouselSlide {
  src: string;
  alt: string;
}

/** Auto-advancing crossfade carousel for the homepage hero. Hand-rolled to
 * match this app's existing inline-style/theme.ts system (see CLAUDE.md —
 * no CSS framework) rather than pulling in a carousel library for one
 * section. Pauses on hover so the fade doesn't fight a reader's mouse. */
export function HeroCarousel({ slides }: { slides: HeroCarouselSlide[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    setIndex(0);
  }, [slides.length]);

  useEffect(() => {
    if (paused || slides.length <= 1) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % slides.length), 4500);
    return () => clearInterval(id);
  }, [paused, slides.length]);

  const touchStartX = useRef<number | null>(null);

  const goTo = (i: number) => setIndex(((i % slides.length) + slides.length) % slides.length);

  if (slides.length === 0) return null;

  return (
    <div
      style={{ position: "relative", width: "100%", height: "100%" }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={(e) => {
        touchStartX.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        if (touchStartX.current === null) return;
        const delta = e.changedTouches[0].clientX - touchStartX.current;
        if (Math.abs(delta) > 40) goTo(index + (delta < 0 ? 1 : -1));
        touchStartX.current = null;
      }}
    >
      {slides.map((slide, i) => (
        <img
          key={slide.src + i}
          src={slide.src}
          alt={slide.alt}
          style={{
            position: i === 0 ? "relative" : "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
            opacity: i === index ? 1 : 0,
            transition: "opacity 900ms ease",
            // A bit more color/vibrancy than the raw source photos —
            // this carousel is the hero's dominant visual, so flat/muted
            // stock shots read as lifeless next to the bold headline type.
            filter: "saturate(1.3) contrast(1.05)",
          }}
        />
      ))}

      {slides.length > 1 && (
        <div
          style={{
            position: "absolute",
            bottom: 14,
            left: 0,
            right: 0,
            zIndex: 3,
            display: "flex",
            justifyContent: "center",
            gap: 7,
          }}
        >
          {slides.map((slide, i) => (
            <button
              key={slide.src + i}
              onClick={() => goTo(i)}
              aria-label={`Show image ${i + 1}: ${slide.alt}`}
              aria-current={i === index}
              style={{
                width: i === index ? 18 : 7,
                height: 7,
                borderRadius: radius.pill,
                border: "none",
                padding: 0,
                cursor: "pointer",
                background: i === index ? "#fff" : "rgba(255,255,255,.5)",
                boxShadow: "0 1px 3px rgba(0,0,0,.35)",
                transition: "width 250ms ease, background 250ms ease",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
