import type { CSSProperties, ReactNode } from "react";

// Horizontal scroll-snap carousel — desktop shows several items at once via
// wrapping flex-wrap at wide viewports (see callers' style prop), mobile
// always gets the native horizontal-scroll behaviour. No carousel library:
// native scroll-snap covers the brief's "smooth snapping" requirement
// without the payload/complexity of one.
export function Carousel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="lc-carousel" style={style}>
      {children}
    </div>
  );
}
