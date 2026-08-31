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

export function ChevronDownIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M5 8l7 7 7-7" />
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

export function MinusIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M5 12h14" />
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

export function TagIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M11.5 3.5 20 3.5 20 12 12.5 19.5a1.4 1.4 0 0 1-2 0l-6.6-6.6a1.4 1.4 0 0 1 0-2Z" />
      <circle cx={15.7} cy={7.8} r={1.6} />
    </svg>
  );
}

export function PersonIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <circle cx={12} cy={8} r={3.5} />
      <path d="M5 20c0-4 3.1-6.5 7-6.5s7 2.5 7 6.5" />
    </svg>
  );
}

export function MailIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <rect x={3.5} y={5.5} width={17} height={13} rx={2} />
      <path d="M4 7l8 6 8-6" />
    </svg>
  );
}

export function LockIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <rect x={5} y={11} width={14} height={9} rx={2} />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function PhoneIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M5 4.5h3.2l1.3 4-2 1.6a12 12 0 0 0 5.4 5.4l1.6-2 4 1.3V18a1.5 1.5 0 0 1-1.6 1.5A15.5 15.5 0 0 1 3.5 6.1 1.5 1.5 0 0 1 5 4.5Z" />
    </svg>
  );
}

export function EyeOffIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M3 3l18 18" />
      <path d="M9.9 5.1A10.6 10.6 0 0 1 12 5c6 0 9.5 6.5 9.5 6.5a15 15 0 0 1-3 3.7M6.5 6.6C3.9 8.3 2.5 11.5 2.5 11.5S6 18 12 18c1 0 2-.2 2.9-.5" />
      <path d="M9.9 12.5a2.4 2.4 0 0 0 3.4 3.3" />
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

export function LightbulbIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M9 18h6" />
      <path d="M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.44 1 1.16 1 1.95V16h5v-.15c0-.79.4-1.51 1-1.95A6 6 0 0 0 12 3Z" />
    </svg>
  );
}

export function SunIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <circle cx={12} cy={12} r={4.2} />
      <path d="M12 2.5v2.4M12 19.1v2.4M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7" />
    </svg>
  );
}

export function MoonIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M20.5 14.7A8.5 8.5 0 1 1 9.3 3.5a7 7 0 0 0 11.2 11.2Z" />
    </svg>
  );
}

export function CardIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <rect x={2.5} y={5.5} width={19} height={13} rx={2} />
      <path d="M2.5 9.5h19" />
      <path d="M6 14.5h4" />
    </svg>
  );
}

// Home's mood tiles (Get active / Meet people / Relax / Explore / Learn /
// Surprise me) use lucide-react icons directly (Dumbbell/Users/Sunrise/
// Compass/BookOpen/PartyPopper) rather than icons defined here — the
// only place in the app that reaches for an external icon library instead
// of this file's hand-rolled set, since these needed a more illustrative
// style than the rest of the app's simple geometric icons, and hand-
// drawing that blind (no SVG preview tool in this environment) didn't
// hold up. See Home.tsx's INTENT_CHIPS.

export function ShieldIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg {...stroke(size)} style={style} className={className}>
      <path d="M12 3.5 5 6v5.5c0 4.6 3 7.9 7 9 4-1.1 7-4.4 7-9V6l-7-2.5Z" />
      <path d="M9 12l2 2 4-4.2" />
    </svg>
  );
}

// Brand marks (Google/Apple) — the only two icons in this file with fixed
// brand colours rather than currentColor, since a single-tone Google "G"
// or Apple logo isn't recognisable at this size.
export function GoogleIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style} className={className}>
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.87c2.27-2.09 3.56-5.17 3.56-8.82Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.08.72-2.46 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.28A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.56.38-2.28v-3.1H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.38l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.76c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.62l4 3.1C6.22 6.87 8.87 4.76 12 4.76Z" />
    </svg>
  );
}

export function AppleIcon({ size = 18, style, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#000" style={style} className={className}>
      <path d="M16.4 1.5c.1 1.1-.33 2.16-1.02 2.94-.7.8-1.85 1.42-2.95 1.33-.13-1.06.4-2.17 1.05-2.9C14.2 2 15.42 1.4 16.4 1.5Zm3.63 16.3c-.42.98-.93 1.9-1.53 2.75-.83 1.16-1.5 1.96-2.02 2.4-.8.72-1.66 1.09-2.58 1.11-.66.01-1.46-.19-2.4-.6-.94-.4-1.8-.6-2.6-.6-.83 0-1.72.2-2.66.6-.94.41-1.7.62-2.28.64-.88.04-1.76-.34-2.63-1.15-.56-.5-1.26-1.34-2.12-2.53C.4 18.9-.12 17.24.03 15.6c.14-1.65.72-2.98 1.72-3.98.78-.79 1.72-1.19 2.83-1.21.6-.01 1.4.2 2.4.63 1 .43 1.65.65 1.95.65.22 0 .95-.25 2.17-.75 1.16-.46 2.14-.65 2.94-.58 2.17.18 3.8 1.03 4.9 2.56-1.94 1.18-2.9 2.83-2.88 4.96.02 1.66.62 3.04 1.8 4.13.53.5 1.12.89 1.77 1.17-.15.4-.3.78-.47 1.12Z" />
    </svg>
  );
}
