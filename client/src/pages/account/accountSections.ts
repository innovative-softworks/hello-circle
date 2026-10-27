import { BellRing, CreditCard, House, KeyRound, LifeBuoy, ShieldCheck, Sparkles, UserRound, type LucideIcon } from "lucide-react";

// The account area's single section list (account redesign 2026-10-24,
// docs/account-redesign/01-audit.md §5). Keys are the `/profile?tab=` values —
// ~20 places deep-link them (header menu, footer, notification links, My Life,
// help guide), so an existing key must never be renamed. `security` and `data`
// are new keys split out of the old all-in-one "account" section.

export type AccountSectionKey =
  | "account" | "preferences" | "notificationPrefs" | "privacy" | "security" | "payment" | "credit"
  | "household"
  | "favourites" | "following" | "routines" | "passes" | "receipts" | "inbox"
  | "hosting"
  | "safety" | "help" | "data";

export interface AccountSectionDef {
  key: AccountSectionKey;
  label: string;
  /** One line under the label on the phone account home. */
  hint: string;
  icon: LucideIcon;
}

// Sidebar 2026-10-24 (owner: "too many sidebar menus"): settings only, one flat
// list. Activity moved to My Life tabs (Saved / Following / Routines), the
// inbox is the header bell's page, Payments holds cards + receipts + passes +
// credit, and Safety / Your data were folded into Privacy / Sign-in. The old
// keys still resolve — see ACCOUNT_REDIRECTS in pages/Profile.tsx.
export const ACCOUNT_SECTIONS: AccountSectionDef[] = [
  { key: "account", label: "Profile", hint: "Photo, name and home county", icon: UserRound },
  { key: "preferences", label: "Interests & discovery", hint: "What you're into and when you're free", icon: Sparkles },
  { key: "notificationPrefs", label: "Notifications", hint: "What we tell you about", icon: BellRing },
  { key: "privacy", label: "Privacy & safety", hint: "Who can find you, blocking and reports", icon: ShieldCheck },
  { key: "security", label: "Sign-in & data", hint: "Password, Google, your data", icon: KeyRound },
  { key: "payment", label: "Payments", hint: "Cards, receipts and passes", icon: CreditCard },
  { key: "household", label: "Household", hint: "Children and people you book for", icon: House },
];

/** Shown under the list, set apart: not a setting. */
export const ACCOUNT_HELP: AccountSectionDef = { key: "help", label: "Help & support", hint: "Answers and how to reach us", icon: LifeBuoy };

/** Reachable by URL but not listed: the inbox (header bell) and hosting (account menu). */
export const ACCOUNT_HIDDEN: AccountSectionKey[] = ["inbox", "hosting"];

export const ACCOUNT_SECTION_KEYS: AccountSectionKey[] = [...ACCOUNT_SECTIONS.map((s) => s.key), "help", ...ACCOUNT_HIDDEN];

export function accountHref(key: AccountSectionKey): string {
  return `/profile?tab=${key}`;
}
