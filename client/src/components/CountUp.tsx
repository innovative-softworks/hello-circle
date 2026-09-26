import { useEffect, useRef, useState } from "react";

const DURATION_MS = 1300;

// Renders `text` with its first number ticking up from 0 when scrolled into
// view ("842 members" counts to 842). Falls back to the static text without
// IntersectionObserver or with reduced motion.
export function CountUp({ text }: { text: string }) {
  const match = text.match(/^([^\d]*)(\d[\d,]*)([\s\S]*)$/);
  const target = match ? Number(match[2].replace(/,/g, "")) : 0;
  const ref = useRef<HTMLSpanElement>(null);
  const animate =
    !!match &&
    typeof IntersectionObserver !== "undefined" &&
    typeof window !== "undefined" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [value, setValue] = useState(animate ? 0 : target);

  useEffect(() => {
    const el = ref.current;
    if (!animate || !el) return;
    let raf = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / DURATION_MS);
          setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
          if (t < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.6 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [animate, target]);

  if (!match) return <>{text}</>;
  return (
    <span ref={ref} style={{ fontVariantNumeric: "tabular-nums" }}>
      {match[1]}
      {value.toLocaleString("en-IE")}
      {match[3]}
    </span>
  );
}
