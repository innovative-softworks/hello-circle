import { useEffect, useRef } from "react";

const OVERSCAN = 0.15;

export function ParallaxImage({
  src,
  alt,
  aspectRatio,
  minHeight,
  children,
}: {
  src: string;
  alt: string;
  aspectRatio: string;
  minHeight?: number;
  children?: React.ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const frame = frameRef.current;
    const img = imgRef.current;
    if (!frame || !img) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = frame.getBoundingClientRect();
      const vh = window.innerHeight;
      if (rect.bottom < 0 || rect.top > vh) return;
      const progress = (vh - rect.top) / (vh + rect.height);
      const shift = (progress - 0.5) * 2 * OVERSCAN * rect.height;
      img.style.transform = `translate3d(0, ${shift.toFixed(1)}px, 0)`;
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
    };
  }, []);

  return (
    <div ref={frameRef} data-no-reveal style={{ position: "relative", overflow: "hidden", width: "100%", aspectRatio, minHeight }}>
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        style={{
          position: "absolute",
          left: 0,
          top: `${-OVERSCAN * 100}%`,
          width: "100%",
          height: `${(1 + OVERSCAN * 2) * 100}%`,
          objectFit: "cover",
          display: "block",
          willChange: "transform",
        }}
      />
      {children}
    </div>
  );
}
