import { useEffect, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { fetchMyCredits } from "../api";
import { Button } from "../components/ui";
import { signInHref } from "../authRedirect";
import { useGuest } from "../GuestContext";
import { fonts, colors } from "../theme";
import { resolveUrlTab } from "../useUrlTab";
import { AccountShell } from "./account/AccountShell";
import { ACCOUNT_SECTIONS, ACCOUNT_SECTION_KEYS, type AccountSectionKey } from "./account/accountSections";
import { UnsavedChangesProvider } from "./account/accountUi";
import { HelpPage } from "./account/HelpPage";
import { HostingPage } from "./account/HostingPage";
import { HouseholdPage } from "./account/HouseholdPage";
import { InboxPage } from "./account/InboxPage";
import { InterestsPage } from "./account/InterestsPage";
import { NotificationSettingsPage } from "./account/NotificationSettingsPage";
import { PaymentsPage } from "./account/PaymentsPage";
import { PrivacyPage } from "./account/PrivacyPage";
import { ProfilePage } from "./account/ProfilePage";
import { SecurityPage } from "./account/SecurityPage";
import { useMediaQuery } from "./account/useMediaQuery";

// Account, Profile, Settings & My Life (account redesign 2026-10-24,
// docs/account-redesign/). One route, /profile, with the section in ?tab= —
// the same keys as before, which ~20 places deep-link (header menu, footer,
// notification links, My Life, help guide). `security` and `data` are new
// keys split out of the old all-in-one "account" section. Each section is
// its own page component under pages/account/; this file only routes.
//
// Phones: /profile with no ?tab= is the account home (every section as a
// row). Desktop: it opens Profile, with the grouped nav beside it.

type ShownKey = "account" | "preferences" | "notificationPrefs" | "privacy" | "security" | "payment" | "household" | "inbox" | "hosting" | "help";

const PAGES: Record<ShownKey, (p: { creditsEnabled: boolean }) => JSX.Element> = {
  account: ProfilePage,
  preferences: InterestsPage,
  notificationPrefs: NotificationSettingsPage,
  privacy: PrivacyPage,
  security: SecurityPage,
  payment: PaymentsPage,
  household: HouseholdPage,
  inbox: InboxPage,
  hosting: HostingPage,
  help: HelpPage,
};

/** Sidebar merge 2026-10-24 — keys that moved. Old links (header menu,
 * footer, emails, notification links, help guide) keep working. */
const ACCOUNT_REDIRECTS: Partial<Record<AccountSectionKey, string>> = {
  favourites: "/bookings?tab=saved",
  following: "/bookings?tab=saved&show=following",
  routines: "/bookings?tab=plans&view=routines",
  receipts: "/profile?tab=payment&view=receipts",
  passes: "/profile?tab=payment&view=passes",
  credit: "/profile?tab=payment&view=credit",
  safety: "/profile?tab=privacy",
  data: "/profile?tab=security",
};

export function Profile() {
  const navigate = useNavigate();
  const { resident, loading: guestLoading } = useGuest();
  const [params] = useSearchParams();
  const rawTab = params.get("tab");
  const section = resolveUrlTab<AccountSectionKey>(rawTab, [...ACCOUNT_SECTION_KEYS, ...(Object.keys(ACCOUNT_REDIRECTS) as AccountSectionKey[])], "account");
  const phone = useMediaQuery("(max-width: 1024px)");

  // PUB-22 — the Credit tab (inside Payments) only appears when credits are
  // switched on (the server's `enabled` flag). Hidden while unknown or on
  // failure; a direct ?view=credit link still shows the wallet's own note.
  const [creditsEnabled, setCreditsEnabled] = useState(false);
  useEffect(() => {
    if (!resident) return;
    let live = true;
    fetchMyCredits()
      .then((c) => live && setCreditsEnabled(!!c.enabled))
      .catch(() => live && setCreditsEnabled(false));
    return () => {
      live = false;
    };
  }, [resident?.id]);

  // Each section starts at the top of the page, like any other page change.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [section]);

  const redirect = ACCOUNT_REDIRECTS[section];
  if (redirect) return <Navigate to={redirect} replace />;

  if (!guestLoading && !resident) {
    return (
      <section className="section-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(24px, 2.4vw, 30px)", margin: "0 0 10px" }}>Sign in to see your account.</h1>
        <p style={{ color: colors.mutedLight, marginBottom: 20 }}>Your profile, household, saved things and settings are here once you're signed in.</p>
        <Button onClick={() => navigate(signInHref())}>Sign in</Button>
      </section>
    );
  }

  const Page = PAGES[section as ShownKey];
  return (
    <UnsavedChangesProvider>
      <AccountShell sections={ACCOUNT_SECTIONS} active={section} showHome={phone && rawTab === null}>
        {/* key: a fresh page (and fresh unsaved-changes state) per section. */}
        <Page key={section} creditsEnabled={creditsEnabled} />
      </AccountShell>
    </UnsavedChangesProvider>
  );
}
