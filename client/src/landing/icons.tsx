import type { CSSProperties } from "react";

// A handful of bespoke icons the landing page needs that ../components/icons.tsx
// doesn't have — kept local so the shared icon set stays untouched.

interface Props {
  size?: number;
  style?: CSSProperties;
  className?: string;
}

export function BikeIcon({ size = 18, style, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={style} className={className}>
      <circle cx="5.5" cy="17.5" r="3.5" />
      <circle cx="18.5" cy="17.5" r="3.5" />
      <path d="M5.5 17.5 10 8h4l3 5.5" />
      <path d="M9 8h3" />
      <path d="M13 8l3 5.5h2.5" />
    </svg>
  );
}

export function CompassIcon({ size = 18, style, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={style} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M14.8 9.2 12.7 14a1 1 0 0 1-.6.6L7 16.8l2.1-4.8a1 1 0 0 1 .6-.6z" />
    </svg>
  );
}

export function SparkleIcon({ size = 18, style, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={style} className={className}>
      <path d="M12 2.5 13.9 9l6.5 1.9-6.5 1.9L12 19.4 10.1 12.8 3.6 10.9 10.1 9z" />
    </svg>
  );
}

export function ArrowUpRightIcon({ size = 18, style, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={style} className={className}>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}
