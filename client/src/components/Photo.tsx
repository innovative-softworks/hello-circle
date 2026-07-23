import type { CSSProperties, ReactNode } from "react";

interface PhotoProps {
  src: string | undefined;
  alt: string;
  ph: string;
  /** Sizing/shape for the outer box (height, borderRadius, etc). */
  style: CSSProperties;
  /** Layout for the overlay content (e.g. flex + alignment for a badge/label). */
  contentStyle?: CSSProperties;
  /** Fallback glyph shown (in a soft circle) when there's no photo, or it fails to load. */
  icon?: ReactNode;
  iconColor?: string;
  children?: ReactNode;
}

/** A placeholder-gradient box with a real photo layered on top, and optional
 * overlay content (badges/labels) painted above both. */
export function Photo({ src, alt, ph, style, contentStyle, icon, iconColor, children }: PhotoProps) {
  return (
    <div style={{ position: "relative", background: ph, ...style }}>
      {icon && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "rgba(255,255,255,.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: iconColor,
            }}
          >
            {icon}
          </div>
        </div>
      )}
      {src && (
        <img
          src={src}
          alt={alt}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", zIndex: 0 }}
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      )}
      {children && (
        <div style={{ position: "relative", zIndex: 1, width: "100%", height: "100%", ...contentStyle }}>
          {children}
        </div>
      )}
    </div>
  );
}
