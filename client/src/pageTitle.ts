import { useEffect, useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";

// HC-QA-065 — descriptive document titles during SPA navigation (WCAG 2.4.2).
//
// Two layers, ordered by React itself:
//   1. RouteTitleManager (in App) sets a route-level title in a LAYOUT effect
//      on every path change — a static page name, or a neutral placeholder
//      for an entity route ("Activity", "Circle", …) that reveals nothing.
//   2. A page calls usePageTitle(entityName) once its data has loaded. That's
//      a passive effect, which always runs after layout effects, so the real
//      name wins and a later navigation always resets it (no stale titles).
// Pages pass only data the server already returned to this viewer, so a title
// never shows private information before authorization.

export const SITE_NAME = "HelloCircle";

export function formatTitle(name: string | null | undefined): string {
  const clean = (name ?? "").trim();
  return clean ? `${clean} | ${SITE_NAME}` : SITE_NAME;
}

const STATIC_TITLES: Record<string, string> = {
  "/": "",
  "/home": "",
  "/for-venues": "For venues",
  "/landing": "",
  "/coming-soon": "Coming soon",
  "/explore": "Explore",
  "/games": "Activities",
  "/games/host": "Host an activity",
  "/free-time": "Free time",
  "/make-it-happen": "Make it happen",
  "/suggest-place": "Suggest a place",
  "/ask": "Ask HelloCircle",
  "/circles": "Circles",
  "/circles/start": "Start a Circle",
  "/bookings": "My Life",
  "/my-life": "My Life",
  "/profile": "Profile",
  "/chats": "Chats",
  "/signin": "Sign in",
  "/signin/create": "Create your account",
  "/signin/email-link": "Sign in",
  "/programs": "Programmes",
  "/adventures": "Adventures",
  "/volunteer": "Volunteer",
  "/experiences": "Experiences",
  "/payment/success": "Payment confirmed",
  "/payment/cancel": "Payment cancelled",
  "/login": "Log in",
  "/forgot-password": "Forgot password",
  "/reset-password": "Reset password",
  "/accept-invite": "Accept invitation",
  "/manage/link-confirm": "Link accounts",
  "/become-a-host": "Become a host",
  "/vendor/signup": "Become a provider",
  "/manage": "Manage",
  "/vendor": "Vendor Dashboard",
  "/admin": "Admin",
  "/privacy": "Privacy policy",
  "/cookies": "Cookie policy",
  "/help-guide": "Help guide",
  "/help-guide/explore": "Help guide: Explore",
  "/help-guide/circles": "Help guide: Circles",
  "/help-guide/my-life": "Help guide: My Life",
  "/help-guide/start": "Help guide: Start",
  "/browse/centres": "Community centres",
  "/browse/clubs": "Sports clubs",
};

// Neutral placeholders for entity routes until the page knows (and may show)
// the entity's real name.
const PATTERN_TITLES: [RegExp, string][] = [
  [/^\/games\/host\/[^/]+$/, "Edit activity"],
  [/^\/games\/[^/]+$/, "Activity"],
  [/^\/circles\/[^/]+$/, "Circle"],
  [/^\/adventures\/[^/]+$/, "Adventure"],
  [/^\/experiences\/[^/]+$/, "Experience"],
  [/^\/programs\/[^/]+$/, "Programme"],
  [/^\/centres\/[^/]+$/, "Community centre"],
  [/^\/clubs\/[^/]+$/, "Sports club"],
  [/^\/book\/[^/]+$/, "Book a space"],
  [/^\/register\/[^/]+$/, "Register"],
  [/^\/host\/[^/]+$/, "Host"],
  [/^\/provider\/[^/]+$/, "Provider"],
  [/^\/i\/[^/]+$/, "Invitation"],
  [/^\/manage\/circles\/[^/]+$/, "Manage Circle"],
  [/^\/vendor\/(centres|clubs|programs|experiences)\/[^/]+$/, "Edit listing"],
  [/^\/browse\/[^/]+$/, "Browse"],
];

export function routeTitle(pathname: string): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path in STATIC_TITLES) return formatTitle(STATIC_TITLES[path]);
  for (const [re, name] of PATTERN_TITLES) if (re.test(path)) return formatTitle(name);
  return SITE_NAME;
}

/** Mounted once in App: resets the title on every route change. */
export function RouteTitleManager() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    document.title = routeTitle(pathname);
  }, [pathname]);
  return null;
}

/** A page's own, more specific title (e.g. the entity's name once loaded).
 * `null`/`undefined` keeps the route-level title. */
export function usePageTitle(name: string | null | undefined) {
  useEffect(() => {
    if (name) document.title = formatTitle(name);
  }, [name]);
}
