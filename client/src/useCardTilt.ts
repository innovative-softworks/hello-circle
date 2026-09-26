import { useEffect } from "react";

const MAX_DEG = 2.5;

// Tilts whichever .card-hover card the pointer is over toward the cursor.
// The transform itself lives in index.css; this only feeds it --tilt-x/y.
export function useCardTilt() {
  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let current: HTMLElement | null = null;
    const reset = (el: HTMLElement) => {
      el.style.removeProperty("--tilt-x");
      el.style.removeProperty("--tilt-y");
    };
    const onMove = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest<HTMLElement>(".card-hover") ?? null;
      if (current && current !== el) reset(current);
      current = el;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      el.style.setProperty("--tilt-y", `${(x * 2 * MAX_DEG).toFixed(2)}deg`);
      el.style.setProperty("--tilt-x", `${(-y * 2 * MAX_DEG).toFixed(2)}deg`);
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      if (current) reset(current);
    };
  }, []);
}
