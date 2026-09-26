import { useEffect, useRef, useState, type ReactNode } from "react";
import { lc, lcMaxWidth } from "../theme";

const STICKY_TOP = 88;
const QUERY = "(min-width: 861px) and (prefers-reduced-motion: no-preference)";

function useRailEnabled() {
  const [enabled, setEnabled] = useState(() => typeof window !== "undefined" && window.matchMedia(QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const on = () => setEnabled(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return enabled;
}

const gutter = `max(24px, calc((100vw - ${lcMaxWidth}px) / 2 + 24px))`;

// Vertical scroll drives the card track sideways while the section stays
// pinned. Below 861px (or with reduced motion) it falls back to the plain
// native scroll-snap carousel.
export function ScrollRail({ header, children }: { header: ReactNode; children: ReactNode }) {
  const enabled = useRailEnabled();
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const stage = stageRef.current;
    const track = trackRef.current;
    if (!enabled || !wrap || !stage || !track) return;

    let travel = 0;
    let raf = 0;

    const measure = () => {
      travel = Math.max(0, track.scrollWidth - stage.clientWidth);
      wrap.style.height = `${stage.offsetHeight + travel}px`;
    };
    const update = () => {
      raf = 0;
      const rect = wrap.getBoundingClientRect();
      const p = travel > 0 ? Math.min(1, Math.max(0, (STICKY_TOP - rect.top) / travel)) : 0;
      track.style.transform = `translate3d(${(-p * travel).toFixed(1)}px, 0, 0)`;
      if (barRef.current) barRef.current.style.transform = `scaleX(${p.toFixed(3)})`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    const onResize = () => {
      measure();
      onScroll();
    };

    measure();
    update();
    const ro = new ResizeObserver(onResize);
    ro.observe(stage);
    ro.observe(track);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      if (raf) cancelAnimationFrame(raf);
      wrap.style.height = "";
      track.style.transform = "";
    };
  }, [enabled]);

  if (!enabled) {
    return (
      <div style={{ maxWidth: lcMaxWidth, margin: "0 auto", padding: "0 24px" }}>
        {header}
        <div className="lc-carousel">{children}</div>
      </div>
    );
  }

  return (
    <div ref={wrapRef}>
      <div ref={stageRef} style={{ position: "sticky", top: STICKY_TOP, overflow: "hidden" }}>
        <div style={{ maxWidth: lcMaxWidth, margin: "0 auto", padding: "0 24px" }}>{header}</div>
        <div data-no-reveal>
          <div ref={trackRef} style={{ display: "flex", gap: 18, width: "max-content", padding: "8px 24px 10px", paddingLeft: gutter, willChange: "transform" }}>
            {children}
          </div>
        </div>
        <div style={{ maxWidth: lcMaxWidth, margin: "28px auto 0", padding: "0 24px" }}>
          <div style={{ height: 3, borderRadius: 3, background: lc.line, overflow: "hidden" }}>
            <div ref={barRef} style={{ height: "100%", background: lc.forest, transformOrigin: "left", transform: "scaleX(0)" }} />
          </div>
        </div>
      </div>
    </div>
  );
}
