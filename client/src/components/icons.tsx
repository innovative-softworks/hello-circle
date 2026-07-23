import type { CSSProperties } from "react";

// Single source of truth for every icon in the app — plain line/flat SVGs
// (no emoji) so everything renders with consistent weight and can be
// themed with currentColor. Import icons from here, never inline emoji.

export interface IconProps {
  size?: number;
  style?: CSSProperties;
  className?: string;
}

const stroke = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export function HomeIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10v9a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1v-9" />
    </svg>
  );
}

export function PinIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M12 21s-7-6.4-7-11.5A7 7 0 0 1 19 9.5C19 14.6 12 21 12 21Z" />
      <circle cx={12} cy={9.5} r={2.4} />
    </svg>
  );
}

export function CalendarIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <rect x={3.5} y={5} width={17} height={15} rx={2.5} />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" />
    </svg>
  );
}

export function SearchIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <circle cx={10.5} cy={10.5} r={6.5} />
      <path d="M20 20l-4.8-4.8" />
    </svg>
  );
}

export function BellIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function MenuIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function CloseIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function EditIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="M13.5 8 16 10.5" />
    </svg>
  );
}

export function TrashIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0-1 13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 7" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export function EyeIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx={12} cy={12} r={3} />
    </svg>
  );
}

export function BookmarkIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M6 4h12v16l-6-4-6 4Z" />
    </svg>
  );
}

export function ChatIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M4 5.5h16v11H9L4 20V5.5Z" />
    </svg>
  );
}

export function CameraIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1-2h7l1 2h2A1.5 1.5 0 0 1 20 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18V8.5Z" />
      <circle cx={12} cy={13} r={3.4} />
    </svg>
  );
}

export function DoorIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M6 21V4a1 1 0 0 1 1-1h6l4 3v15" />
      <path d="M4 21h16M14.5 13v1.5" />
    </svg>
  );
}

export function AwardIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <circle cx={12} cy={9} r={5} />
      <path d="M9 13.5 8 21l4-2 4 2-1-7.5" />
    </svg>
  );
}

export function CheckCircleIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <circle cx={12} cy={12} r={9} />
      <path d="M8 12.5 11 15.5 16 9.5" />
    </svg>
  );
}

export function UsersIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <circle cx={9} cy={8.5} r={3} />
      <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <path d="M16 8.8a2.7 2.7 0 1 1 0-5.4" />
      <path d="M15 14.7c2.7.4 4.5 2.4 4.5 5.3" />
    </svg>
  );
}

export function HeartIcon({ size = 18, filled = false, style, className }: IconProps & { filled?: boolean }) {
  return (
    <svg {...stroke(size)} fill={filled ? "currentColor" : "none"} style={style} className={className}>
      <path d="M12 20s-7.5-4.7-9.8-9.3C.8 7.3 2.6 4 6.2 4c2 0 3.4 1 5.8 3.2C14.4 5 15.8 4 17.8 4c3.6 0 5.4 3.3 4 6.7C19.5 15.3 12 20 12 20Z" />
    </svg>
  );
}

export function BuildingIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <rect x={4} y={9} width={9} height={12} />
      <rect x={13} y={3} width={7} height={18} />
      <path d="M7 13h2M7 17h2M16 7h2M16 11h2M16 15h2" />
    </svg>
  );
}

export function BallIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <circle cx={12} cy={12} r={9} />
      <path d="M12 8.3 15.2 10.6l-1.2 3.7H10L8.8 10.6ZM12 8.3V4.5M13.9 14.3 17 17M10.1 14.3 7 17M9 10.6 4.9 9.2M15 10.6l4.1-1.4" />
    </svg>
  );
}

export function GraduationCapIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M2.5 9 12 4.5 21.5 9 12 13.5 2.5 9Z" />
      <path d="M6.5 11v4.5c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5V11" />
      <path d="M21.5 9v6" />
    </svg>
  );
}

export function IdCardIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <rect x={3} y={5.5} width={18} height={13} rx={2} />
      <circle cx={8.3} cy={11} r={1.9} />
      <path d="M5.5 15.5c.4-1.5 1.5-2.3 2.8-2.3s2.4.8 2.8 2.3M14 9.5h5M14 12.5h5M14 15.5h3" />
    </svg>
  );
}

export function StethoscopeIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M6 4v6a4 4 0 0 0 8 0V4" />
      <path d="M6 4H4.5M14 4h1.5" />
      <path d="M10 14v2.5a4.5 4.5 0 0 0 9 0v-1" />
      <circle cx={19.5} cy={13.5} r={1.6} />
    </svg>
  );
}

export function ChevronLeftIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M15 5 8 12l7 7" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function ArrowRightIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M4 12h16M13 5l7 7-7 7" />
    </svg>
  );
}

export function StarIcon({ size = 18, filled = true, style, className }: IconProps & { filled?: boolean }) {
  return (
    <svg {...stroke(size)} fill={filled ? "currentColor" : "none"} style={style} className={className}>
      <path d="M12 3.5 14.6 9l6 .9-4.3 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.4 9.9l6-.9Z" strokeLinejoin="round" />
    </svg>
  );
}

export function CheckIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M5 12.5 10 17.5 19 7.5" />
    </svg>
  );
}

export function ClockIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <circle cx={12} cy={12} r={9} />
      <path d="M12 7v5.3l3.5 2" />
    </svg>
  );
}

export function BanIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <circle cx={12} cy={12} r={9} />
      <path d="M6 6l12 12" />
    </svg>
  );
}

export function ClipboardIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <rect x={5.5} y={4.5} width={13} height={16} rx={2} />
      <rect x={9} y={2.5} width={6} height={4} rx={1.3} />
      <path d="M8.5 11h7M8.5 14.5h7M8.5 18h4.5" />
    </svg>
  );
}

export function GridIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <rect x={3.5} y={3.5} width={7.5} height={7.5} rx={1.5} />
      <rect x={13} y={3.5} width={7.5} height={7.5} rx={1.5} />
      <rect x={3.5} y={13} width={7.5} height={7.5} rx={1.5} />
      <rect x={13} y={13} width={7.5} height={7.5} rx={1.5} />
    </svg>
  );
}

export function WheelchairIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <circle cx={11} cy={4.5} r={1.6} />
      <path d="M11 8v5l5 3M11 13H7.5L9 6" />
      <path d="M8 13a5 5 0 1 0 6.8 6.6" />
    </svg>
  );
}

export function RepeatIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.5" />
      <path d="M20 4.5v4h-4" />
      <path d="M20 12a8 8 0 0 1-13.7 5.7L4 15.5" />
      <path d="M4 19.5v-4h4" />
    </svg>
  );
}

export function ClockConfirmIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <circle cx={12} cy={12} r={9} />
      <path d="M8.5 12.3 11 14.7l4.5-5" />
    </svg>
  );
}

export function HandshakeIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M2.5 11.5 6 8l3.2 2.7a1.3 1.3 0 0 0 1.7-2l-2-2.2 1.6-1.4a2 2 0 0 1 2.6 0L17 8.5" />
      <path d="M2.5 11.5 7 16l1.6-1.4 1.7 1.7a1.6 1.6 0 0 0 2.5-2l.4.4a1.6 1.6 0 0 0 2.5-2l-.4-.4" />
      <path d="M17 8.5 21.5 12 17 16.5l-2-2" />
    </svg>
  );
}

export function TreeIconSmall({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M12 3 6 12h3l-4 6h5v3M12 3l6 9h-3l4 6h-5" />
    </svg>
  );
}

export function CloudIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M7 18a4 4 0 0 1-.5-8 5 5 0 0 1 9.6-1.6A4.2 4.2 0 0 1 17.5 18Z" />
    </svg>
  );
}

export function TrendUpIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M3.5 16.5 10 10l4 4 6.5-6.5" />
      <path d="M15 7.5h5.5V13" />
    </svg>
  );
}

export function PlusIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function DoctorIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <circle cx={12} cy={7} r={3.2} />
      <path d="M5 21v-2.5a7 7 0 0 1 14 0V21" />
      <path d="M9.3 12.2v1.6a2.7 2.7 0 0 0 5.4 0v-1.6" />
      <circle cx={14.7} cy={13.8} r={1.1} />
    </svg>
  );
}

export function SchoolIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M4.5 11 12 5l7.5 6" />
      <rect x={5.5} y={11} width={13} height={9} rx={1} />
      <rect x={10} y={15} width={4} height={5} />
      <path d="M12 5V2.3M12 2.3h3.2l-1.8 1.7 1.8 1.7H12" />
    </svg>
  );
}

export function BookOpenIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M12 7c-2-1.4-4.6-1.9-7.2-1.6v12.6c2.6-.3 5.2.2 7.2 1.6" />
      <path d="M12 7c2-1.4 4.6-1.9 7.2-1.6v12.6c-2.6-.3-5.2.2-7.2 1.6" />
      <path d="M12 7v13.6" />
    </svg>
  );
}

/** Small circular brand mark — house + person + community wave inside a
 * ring, echoing the full illustrated Hello Circle badge at a size that still reads
 * clearly in the header/footer (31px and below). */
/** Circular brand badge — two houses, a goal + ball, a shop, a group of
 * people and a wave inside a ring, echoing the full illustrated Hello Circle mark. */
export function LogoMark({ size = 31, style, className }: IconProps) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} style={style} className={className} role="img" aria-label="Hello Circle">
      <circle cx={50} cy={50} r={42} fill="#fff" stroke="#1E7A4C" strokeWidth={4.4} />

      {/* green house (front) */}
      <polygon points="14,42 22,34 30,42" fill="#5CB85C" />
      <rect x={15.5} y={42} width={13} height={16} fill="#5CB85C" />
      <rect x={19.5} y={49} width={5} height={9} fill="#fff" />

      {/* teal house (behind, taller) */}
      <polygon points="27,29 36.5,21 46,29" fill="#2E9B9B" />
      <rect x={28.5} y={29} width={16} height={29} fill="#2E9B9B" />
      <rect x={31} y={33.5} width={4.4} height={4.4} fill="#fff" />
      <rect x={38} y={33.5} width={4.4} height={4.4} fill="#fff" />
      <rect x={34} y={48} width={5} height={10} fill="#fff" />

      {/* goal + ball + flag */}
      <path d="M54 58 V30 H72 V58" fill="none" stroke="#175f3b" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M54 36 L64 30 M54 44 L69 32 M54 52 L71.5 38 M60 58 L72 45" fill="none" stroke="#175f3b" strokeWidth={1} opacity={0.55} />
      <path d="M63 30 V17.5" stroke="#175f3b" strokeWidth={2.2} strokeLinecap="round" />
      <path d="M63 17.5 L71 20.5 L63 23.5 Z" fill="#E8622A" />
      <circle cx={61.5} cy={49} r={7.2} fill="#fff" stroke="#1E2420" strokeWidth={2} />
      <polygon points="61.5,44.3 65.2,47 63.8,51.5 59.2,51.5 57.8,47" fill="#1E2420" />

      {/* shop */}
      <path d="M70 32 L88 32 L90 38 L68 38 Z" fill="#8DC63F" />
      <path d="M70.5 32 L73.5 38 M75.5 32 L78.5 38 M80.5 32 L83.5 38 M85.5 32 L88 38" stroke="#fff" strokeWidth={1.3} />
      <rect x={69} y={38} width={19} height={20} fill="#8DC63F" />
      <rect x={73} y={46} width={11} height={12} fill="#fff" />

      {/* people (celebrating together) */}
      <path d="M32 66c0-6.5 5-9.5 11-9.5s11 3 11 9.5v2.5c-3.4-4.6-6.9-6-11-6s-7.6 1.4-11 6Z" fill="#8DC63F" />
      <circle cx={43} cy={54.5} r={5.4} fill="#8DC63F" />
      <path d="M68 66c0-6.5-5-9.5-11-9.5s-11 3-11 9.5v2.5c3.4-4.6 6.9-6 11-6s7.6 1.4 11 6Z" fill="#2E9B9B" />
      <circle cx={57} cy={54.5} r={5.4} fill="#2E9B9B" />
      <path d="M32.5 70c0-9.5 7.5-13.5 17.5-13.5s17.5 4 17.5 13.5v3c-4.4-6.4-10-8.4-17.5-8.4s-13.1 2-17.5 8.4Z" fill="#1E7A4C" />
      <circle cx={50} cy={53} r={7.6} fill="#1E7A4C" />

      {/* wave */}
      <path d="M16 74c10 6.5 21 9 34 9s24-2.5 34-9" fill="none" stroke="#5CB85C" strokeWidth={5.2} strokeLinecap="round" />
    </svg>
  );
}

export function TagIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M11.5 3.5 20 3.5 20 12 12.5 19.5a1.4 1.4 0 0 1-2 0l-6.6-6.6a1.4 1.4 0 0 1 0-2Z" />
      <circle cx={15.7} cy={7.8} r={1.6} />
    </svg>
  );
}

export function PhotoStackIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <rect x={3.5} y={7} width={13} height={13} rx={2} />
      <path d="M7 7V5.5a1.5 1.5 0 0 1 1.5-1.5h10a1.5 1.5 0 0 1 1.5 1.5V17a1.5 1.5 0 0 1-1.5 1.5H18" />
      <circle cx={7.7} cy={11.7} r={1.3} />
      <path d="M4.5 18l3.3-3.3a1 1 0 0 1 1.4 0l1.6 1.6 2.6-2.6a1 1 0 0 1 1.4 0L16.5 15" />
    </svg>
  );
}
