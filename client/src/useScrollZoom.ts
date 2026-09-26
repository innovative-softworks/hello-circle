import { useEffect, type RefObject } from "react";

const MAX_EXTRA = 0.1;

// Slowly scales the first <img> inside `frameRef` from 1 to 1+MAX_EXTRA as
// the frame scrolls through the viewport. The frame must clip its overflow.
export function useScrollZoom(frameRef: RefObject<HTMLElement>, enabled = true) {
  useEffect(() => {
    const frame = frameRef.current;
    if (!enabled || !frame) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    const update = () => {
      raf = 0;
      const img = frame.querySelector("img");
      if (!img) return;
      const rect = frame.getBoundingClientRect();
      const vh = window.innerHeight;
      if (rect.bottom < 0 || rect.top > vh) return;
      const p = Math.min(1, Math.max(0, (vh - rect.top) / (vh + rect.height)));
      img.style.transform = `scale(${(1 + p * MAX_EXTRA).toFixed(4)})`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
      frame.querySelector("img")?.style.removeProperty("transform");
    };
  }, [frameRef, enabled]);
}
