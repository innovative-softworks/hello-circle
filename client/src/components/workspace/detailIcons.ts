import {
  ArrowLeftRight,
  BadgeCheck,
  Building2,
  CalendarCheck,
  CalendarDays,
  ClipboardCheck,
  Clock,
  Copy,
  DoorOpen,
  Euro,
  Eye,
  FileText,
  Flag,
  Gavel,
  History,
  Hourglass,
  Image,
  Info,
  Landmark,
  LayoutList,
  List,
  ListOrdered,
  Lock,
  MapPin,
  MessageSquare,
  Reply,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Star,
  Timer,
  ToggleRight,
  Undo2,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";

// One icon and colour per kind of fact on the detail pages (2026-10-20), picked
// from the heading or label text so every record page gets them consistently.
// Tones: green = money and good states, blue = dates and bookings, amber =
// ratings and waiting, violet = people and reach, rose = refunds, disputes,
// reports and places, neutral = reference details.

export type DetailTone = "green" | "blue" | "amber" | "violet" | "rose" | "neutral";

const RULES: [RegExp, LucideIcon, DetailTone][] = [
  // Specific phrases first, so a general word later doesn't claim them.
  [/details$/i, Info, "neutral"],
  [/review checks|checks$/i, ClipboardCheck, "amber"],
  [/pending|waiting|open for|decided|place held/i, Hourglass, "amber"],
  [/partner since|joined|signed up/i, CalendarDays, "blue"],
  [/message|wrote|description|reply sent|about them/i, FileText, "neutral"],
  [/checked in|attend/i, BadgeCheck, "green"],
  [/membership|spent|net to/i, Euro, "green"],
  [/refund|revers/i, Undo2, "rose"],
  [/dispute|evidence/i, ShieldAlert, "rose"],
  [/report|no-show/i, Flag, "rose"],
  [/duplicate|similar/i, Copy, "amber"],
  [/rating|review/i, Star, "amber"],
  [/waitlist/i, ListOrdered, "amber"],
  [/view/i, Eye, "violet"],
  [/role|permission/i, ShieldCheck, "violet"],
  [/member|team|staff|owner|partner|customer|contact|requester|claimed by|host|organiser|identity|guest|going|group size|enrolled|who it's for|circle/i, Users, "violet"],
  [/account|login/i, User, "violet"],
  [/organisation/i, Building2, "violet"],
  [/settlement/i, Landmark, "green"],
  [/transfer/i, ArrowLeftRight, "green"],
  [/price|from|membership|amount|paid|spent|net to|total|received|agreed|money|payment|pricing/i, Euro, "green"],
  [/status|live listing/i, BadgeCheck, "green"],
  [/booking|registration|order|reservation|obligation/i, CalendarCheck, "blue"],
  [/when|date|next|placed|created|since|submitted|filed|this month|upcoming|processed/i, CalendarDays, "blue"],
  [/session|hours|availability|schedule|timeline/i, Clock, "blue"],
  [/duration/i, Timer, "blue"],
  [/room|facilit/i, DoorOpen, "blue"],
  [/location|place|where|area/i, MapPin, "rose"],
  [/photo|cover/i, Image, "neutral"],
  [/decision/i, Gavel, "neutral"],
  [/activity|history|recent/i, History, "neutral"],
  [/reply/i, Reply, "neutral"],
  [/request|privacy|consent|investigation/i, Lock, "neutral"],
  [/feature flag/i, ToggleRight, "neutral"],
  [/listing|club|experience|centre|type/i, LayoutList, "neutral"],
  [/item/i, List, "neutral"],
  [/manage|settings|what you can do/i, Settings2, "neutral"],
  [/chat/i, MessageSquare, "neutral"],
  [/detail|reference|case/i, Info, "neutral"],
];

export function detailIcon(text: string): { Icon: LucideIcon; tone: DetailTone } {
  const hit = RULES.find(([re]) => re.test(text));
  return hit ? { Icon: hit[1], tone: hit[2] } : { Icon: Info, tone: "neutral" };
}
