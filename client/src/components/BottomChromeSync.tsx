import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// Publishes the height of the fixed bar at the bottom of the viewport (the
// mobile tab bar) as `--bottom-chrome` on <html>, so floating UI (cookie
// banner, toasts) anchors above it instead of underneath. When there's no
// tab bar the value falls back to just the safe-area inset (index.css :root).
export function BottomChromeSync() {
  const { pathname } = useLocation();

  useEffect(() => {
    const root = document.documentElement;
    const measure = () => {
      const bar = document.querySelector<HTMLElement>(".mobile-tab-bar");
      const visible = bar && getComputedStyle(bar).display !== "none";
      if (visible) root.style.setProperty("--bottom-chrome", `${bar.offsetHeight}px`);
      else root.style.removeProperty("--bottom-chrome");
    };
    // The tab bar mounts/unmounts with the route, so measure after commit.
    const frame = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    const bar = document.querySelector<HTMLElement>(".mobile-tab-bar");
    const observer = bar && typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (bar) observer?.observe(bar);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [pathname]);

  return null;
}
