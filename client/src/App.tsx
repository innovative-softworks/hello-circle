import { PartnerOrgGate } from "./components/OrgSuspendedView";
import { LAUNCH_GATE_ENABLED } from "./launchMode";
import { BookingChangePage } from "./pages/BookingChangePage";
import { AdminInviteAccept } from "./pages/AdminInviteAccept";
import { lazy, Suspense, useEffect, useRef } from "react";
import { AppUpdateBoundary } from "./components/AppUpdateBoundary";
import { VENUE_PAGES_PUBLIC } from "./venueLaunch";
import { RouteTitleManager } from "./pageTitle";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AuthProvider } from "./AuthContext";
import { ConfirmProvider } from "./components/ConfirmProvider";
import { ToastProvider } from "./components/Toast";
import { BottomChromeSync } from "./components/BottomChromeSync";
import { useCardTilt } from "./useCardTilt";
import { logReferralLand } from "./api/public";
import { AccountSetupGate } from "./components/AccountSetupGate";
import { PolicyAcceptanceGate } from "./components/PolicyAcceptanceGate";
import { CookieNotice } from "./components/CookieNotice";
import { PageSpinner } from "./components/ui";
import { DashboardNavProvider } from "./DashboardNavContext";
import { Footer } from "./components/Footer";
import { GuestProvider } from "./GuestContext";
import { Header } from "./components/Header";
import { MobileTabBar } from "./components/MobileTabBar";
import { NativePushSync } from "./components/NativePushSync";
import { NativeShellSync } from "./components/NativeShellSync";
import { SessionExpiryBanner } from "./components/SessionExpiryBanner";
import { hideSplashScreen, setupAppUrlListener, setupBackButton } from "./native";
import { MyStuffProvider } from "./MyStuffContext";
import { ComingSoon } from "./pages/ComingSoon";
import { NotFound } from "./pages/NotFound";
import { ThemeProvider } from "./ThemeContext";

// SEO Phase 6 — every route below used to be a static top-level import, so
// react-router's own per-route code splitting never kicked in: visiting the
// homepage downloaded the entire app (every dashboard, every wizard, every
// help-guide page) in one ~1.5MB JS chunk before anything could render. Each
// of these now becomes its own chunk, fetched only when its route is
// actually visited (a returning vendor never pays for the resident Circle
// pages' code, a resident never pays for AdminDashboard's, etc.) — the
// `.then(m => ({ default: m.X }))` shape is just adapting this codebase's
// named exports to what `React.lazy` requires (a default export).
// ComingSoon/NotFound are the two exceptions, kept as ordinary eager
// imports: ComingSoon is what most visitors currently see first on every
// single pre-launch page load (the LAUNCH_GATE_ENABLED redirect below), and
// NotFound is the catch-all `*` route — lazy-loading either would add a
// waterfall (render fallback, then fetch, then render for real) to the most
// common and the most already-degraded paths respectively, which is the
// opposite of what code-splitting is for.
const AcceptInvite = lazy(() => import("./pages/AcceptInvite").then((m) => ({ default: m.AcceptInvite })));
const ManageLinkConfirm = lazy(() => import("./pages/ManageLinkConfirm").then((m) => ({ default: m.ManageLinkConfirm })));
const InvitationLanding = lazy(() => import("./pages/InvitationLanding").then((m) => ({ default: m.InvitationLanding })));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard").then((m) => ({ default: m.AdminDashboard })));
const Browse = lazy(() => import("./pages/Browse").then((m) => ({ default: m.Browse })));
const CentreDetail = lazy(() => import("./pages/CentreDetail").then((m) => ({ default: m.CentreDetail })));
const CircleDetail = lazy(() => import("./pages/CircleDetail").then((m) => ({ default: m.CircleDetail })));
const Circles = lazy(() => import("./pages/Circles").then((m) => ({ default: m.Circles })));
const ClubDetail = lazy(() => import("./pages/ClubDetail").then((m) => ({ default: m.ClubDetail })));
const BookingFlow = lazy(() => import("./pages/BookingFlow").then((m) => ({ default: m.BookingFlow })));
const CookiePolicy = lazy(() => import("./pages/CookiePolicy").then((m) => ({ default: m.CookiePolicy })));
const Adventures = lazy(() => import("./pages/Adventures").then((m) => ({ default: m.Adventures })));
const Events = lazy(() => import("./pages/Events").then((m) => ({ default: m.Events })));
const Volunteer = lazy(() => import("./pages/Volunteer").then((m) => ({ default: m.Volunteer })));
const Programs = lazy(() => import("./pages/Programs").then((m) => ({ default: m.Programs })));
const ExperienceDetail = lazy(() => import("./pages/ExperienceDetail").then((m) => ({ default: m.ExperienceDetail })));
const Experiences = lazy(() => import("./pages/Experiences").then((m) => ({ default: m.Experiences })));
const Explore = lazy(() => import("./pages/Explore").then((m) => ({ default: m.Explore })));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword").then((m) => ({ default: m.ForgotPassword })));
const ForVenues = lazy(() => import("./pages/ForVenues").then((m) => ({ default: m.ForVenues })));
const Pricing = lazy(() => import("./pages/Pricing").then((m) => ({ default: m.Pricing })));
const BecomeAHost = lazy(() => import("./pages/BecomeAHost").then((m) => ({ default: m.BecomeAHost })));
const FreeTimeMode = lazy(() => import("./pages/FreeTimeMode").then((m) => ({ default: m.FreeTimeMode })));
const GameDetail = lazy(() => import("./pages/GameDetail").then((m) => ({ default: m.GameDetail })));
const Games = lazy(() => import("./pages/Games").then((m) => ({ default: m.Games })));
const Home = lazy(() => import("./pages/Home").then((m) => ({ default: m.Home })));
const HostProfilePage = lazy(() => import("./pages/HostProfile").then((m) => ({ default: m.HostProfilePage })));
const HelpGuideIndex = lazy(() => import("./pages/helpGuide/HelpGuideIndex").then((m) => ({ default: m.HelpGuideIndex })));
const HelpGuideExplore = lazy(() => import("./pages/helpGuide/HelpGuideExplore").then((m) => ({ default: m.HelpGuideExplore })));
const HelpGuideCircles = lazy(() => import("./pages/helpGuide/HelpGuideCircles").then((m) => ({ default: m.HelpGuideCircles })));
const HelpGuideMyLife = lazy(() => import("./pages/helpGuide/HelpGuideMyLife").then((m) => ({ default: m.HelpGuideMyLife })));
const HelpGuideStart = lazy(() => import("./pages/helpGuide/HelpGuideStart").then((m) => ({ default: m.HelpGuideStart })));
const Login = lazy(() => import("./pages/Login").then((m) => ({ default: m.Login })));
const ActivityPassport = lazy(() => import("./pages/ActivityPassport").then((m) => ({ default: m.ActivityPassport })));
const ForMe = lazy(() => import("./pages/ForMe").then((m) => ({ default: m.ForMe })));
const PlanMyDay = lazy(() => import("./pages/PlanMyDay").then((m) => ({ default: m.PlanMyDay })));
const MakeItHappen = lazy(() => import("./pages/MakeItHappen").then((m) => ({ default: m.MakeItHappen })));
const MyBookings = lazy(() => import("./pages/MyBookings").then((m) => ({ default: m.MyBookings })));
const PaymentCancel = lazy(() => import("./pages/PaymentCancel").then((m) => ({ default: m.PaymentCancel })));
const PaymentSuccess = lazy(() => import("./pages/PaymentSuccess").then((m) => ({ default: m.PaymentSuccess })));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy").then((m) => ({ default: m.PrivacyPolicy })));
// Booking kit preview (UX plan Phase 1) — dev builds only; tree-shaken from production.
// Card redesign preview (2026-10-22) — dev builds only; tree-shaken from production.
const CardKitPreview = import.meta.env.DEV ? lazy(() => import("./pages/CardKitPreview").then((m) => ({ default: m.CardKitPreview }))) : null;
const BookingKitPreview = import.meta.env.DEV ? lazy(() => import("./pages/BookingKitPreview").then((m) => ({ default: m.BookingKitPreview }))) : null;
const PolicyIndex = lazy(() => import("./pages/Policies").then((m) => ({ default: m.PolicyIndex })));
const PolicyPage = lazy(() => import("./pages/Policies").then((m) => ({ default: m.PolicyPage })));
const CmsPolicy = lazy(() => import("./pages/Policies").then((m) => ({ default: m.CmsPolicy })));
const CookieChoiceControl = lazy(() => import("./pages/CookiePolicy").then((m) => ({ default: m.CookieChoiceControl })));
const About = lazy(() => import("./pages/About").then((m) => ({ default: m.About })));
const Contact = lazy(() => import("./pages/Contact").then((m) => ({ default: m.Contact })));
const Complaints = lazy(() => import("./pages/Complaints").then((m) => ({ default: m.Complaints })));
const Chats = lazy(() => import("./pages/Chats").then((m) => ({ default: m.Chats })));
const Profile = lazy(() => import("./pages/Profile").then((m) => ({ default: m.Profile })));
const SuggestPlacePage = lazy(() => import("./pages/SuggestPlace").then((m) => ({ default: m.SuggestPlacePage })));
const LocalActivity = lazy(() => import("./pages/LocalActivity").then((m) => ({ default: m.LocalActivity })));
const ProgramDetail = lazy(() => import("./pages/ProgramDetail").then((m) => ({ default: m.ProgramDetail })));
const ProviderProfilePage = lazy(() => import("./pages/ProviderProfile").then((m) => ({ default: m.ProviderProfilePage })));
const RegistrationFlow = lazy(() => import("./pages/RegistrationFlow").then((m) => ({ default: m.RegistrationFlow })));
const ResetPassword = lazy(() => import("./pages/ResetPassword").then((m) => ({ default: m.ResetPassword })));
const SearchRedirect = lazy(() => import("./pages/SearchRedirect").then((m) => ({ default: m.SearchRedirect })));
const SignIn = lazy(() => import("./pages/SignIn").then((m) => ({ default: m.SignIn })));
const SignUp = lazy(() => import("./pages/SignUp").then((m) => ({ default: m.SignUp })));
const EmailLinkSignIn = lazy(() => import("./pages/EmailLinkSignIn").then((m) => ({ default: m.EmailLinkSignIn })));
const VendorDashboard = lazy(() => import("./pages/VendorDashboard").then((m) => ({ default: m.VendorDashboard })));
const VendorSignup = lazy(() => import("./pages/VendorSignup").then((m) => ({ default: m.VendorSignup })));
const VendorCentreEditPage = lazy(() => import("./pages/VendorCentreEditPage").then((m) => ({ default: m.VendorCentreEditPage })));
const VendorClubEditPage = lazy(() => import("./pages/VendorClubEditPage").then((m) => ({ default: m.VendorClubEditPage })));
const VendorProgramEditPage = lazy(() => import("./pages/VendorProgramEditPage").then((m) => ({ default: m.VendorProgramEditPage })));
const VendorExperienceEditPage = lazy(() => import("./pages/VendorExperienceEditPage").then((m) => ({ default: m.VendorExperienceEditPage })));
const VendorDoorHome = lazy(() => import("./pages/VendorDoor").then((m) => ({ default: m.VendorDoorHome })));
const VendorDoorScreen = lazy(() => import("./pages/VendorDoor").then((m) => ({ default: m.VendorDoorScreen })));
const HostGamePage = lazy(() => import("./pages/HostGamePage").then((m) => ({ default: m.HostGamePage })));
// Stage 5f — Pro details and reward history (one shared page per concept, scope by route).
const VendorProPage = lazy(() => import("./pages/ProDetailsPage").then((m) => ({ default: m.VendorProPage })));
const HostProPage = lazy(() => import("./pages/ProDetailsPage").then((m) => ({ default: m.HostProPage })));
const VendorRewardsPage = lazy(() => import("./pages/RewardsHistoryPage").then((m) => ({ default: m.VendorRewardsPage })));
const HostRewardsPage = lazy(() => import("./pages/RewardsHistoryPage").then((m) => ({ default: m.HostRewardsPage })));
const ManageCircle = lazy(() => import("./pages/ManageCircle").then((m) => ({ default: m.ManageCircle })));
const ManageHome = lazy(() => import("./pages/ManageHome").then((m) => ({ default: m.ManageHome })));
const ReceiptPage = lazy(() => import("./pages/ReceiptPage").then((m) => ({ default: m.ReceiptPage })));
const VendorOrderPage = lazy(() => import("./pages/VendorOrderPage").then((m) => ({ default: m.VendorOrderPage })));
const BookingDetailPage = lazy(() => import("./pages/BookingDetailPage").then((m) => ({ default: m.BookingDetailPage })));
const StartCirclePage = lazy(() => import("./pages/StartCirclePage").then((m) => ({ default: m.StartCirclePage })));

// Pre-launch lockdown (no real vendor/resident data yet — see CLAUDE.md's
// "Dev vs. prod database" section). Defaults ON (gated) until a deploy
// explicitly sets VITE_LAUNCH_MODE=public, so a forgotten env var fails
// closed rather than open. Flip to "public" once real Dublin/Cork vendors
// are onboarded and Phase 0-3 of the launch plan are done. The switch itself
// lives in launchMode.ts (shared with pages, e.g. ForVenues — PUB-10).

// Routes that must stay reachable by direct URL while gated: the vendor-
// recruitment landing page (root + /for-venues), the waitlist splash itself,
// vendor onboarding/auth (signup, dashboard, listing edit pages all live
// under /vendor), the admin dashboard, and the legal pages. Everything
// consumer-facing (Browse, Games, Circles, booking flows, etc.) is not
// exempt, since there's no real data to show there yet.
//
// The resident *hosting* flow is exempt too, so supply can be built up before
// launch the same way vendor supply already is: a resident signs in, applies
// for Host verification, hosts a Game or Circle, and (once verified) opens a
// provider account from /profile. Without this the whole path is unreachable
// while gated — /profile bounced to /coming-soon, so the Host panels there
// could never be seen.
//
// The "/games/" and "/circles/" prefixes deliberately carry a trailing slash:
// they match /games/host and /circles/start, plus the detail page a host lands
// on right after creating one, while leaving the bare /games and /circles
// browse listings gated — those are the "no real data to show" discovery
// surfaces this gate exists for, and neither detail page is reachable without
// already holding an id.
function isExemptFromLaunchGate(pathname: string): boolean {
  if (pathname === "/" || pathname === "/for-venues" || pathname === "/partners" || pathname === "/pricing" || pathname === "/become-a-host" || pathname === "/coming-soon") return true;
  if (pathname === "/login" || pathname === "/forgot-password" || pathname === "/reset-password" || pathname === "/accept-invite") return true;
  // OG-11 — a venue's proposed booking change, linked from an email.
  if (pathname === "/booking-change") return true;
  if (pathname === "/privacy" || pathname === "/cookies") return true;
  // Who runs the site and how to reach them — must be reachable pre-launch too (sitemap audit P1-02).
  if (pathname === "/about" || pathname === "/contact") return true;
  if (pathname.startsWith("/vendor") || pathname.startsWith("/admin")) return true;
  if (pathname === "/signin" || pathname.startsWith("/signin/") || pathname === "/onboarding") return true; // /onboarding now just redirects to /bookings?setup=1
  // /bookings is "My Life", the resident's own account home — not a discovery
  // surface, so the gate's "no real data yet" rationale doesn't apply. It also
  // has to be exempt for sign-in to work at all: safeReturnTo() defaults there
  // after a successful magic-link sign-in, so leaving it gated dead-ends every
  // resident on /coming-soon the moment they log in.
  // /my-life is the same page as /bookings under a second route (Phase 1
  // "Connect" — see the route table below), so it needs the same exemption.
  if (pathname === "/profile" || pathname === "/bookings" || pathname === "/my-life" || pathname.startsWith("/manage") || pathname.startsWith("/receipts/")) return true;
  if (pathname.startsWith("/games/") || pathname.startsWith("/circles/")) return true;
  if (pathname.startsWith("/host/")) return true;
  // A personal invitation link (Universal Sharing system §12) is real
  // content for one specific person, not a "no real data yet" discovery
  // surface — same rationale as /games/ and /circles/ above, regardless of
  // which entity type it points to.
  if (pathname.startsWith("/i/")) return true;
  return false;
}

// Partial-launch carve-out: Community centres/Sports clubs stay behind the
// coming-soon gate even once VITE_LAUNCH_MODE=public lifts the main gate
// everywhere else — their vendor supply isn't onboarded yet, unlike the
// resident-hosted/peer surfaces (Games, Circles, Adventures, Experiences,
// My Life, Start) which don't depend on any vendor being signed up first.
// Only checked when the main gate is already open (see `gated ||
// venueGated` below) — while it's closed this is redundant with it.
function isVenueGatedPath(pathname: string): boolean {
  if (VENUE_PAGES_PUBLIC) return false;
  return (
    pathname === "/browse/centres" ||
    pathname === "/browse/clubs" ||
    pathname.startsWith("/centres/") ||
    pathname.startsWith("/clubs/") ||
    pathname.startsWith("/book/") ||
    pathname.startsWith("/register/")
  );
}

/** Routes rendered inside the cream workspace shell (admin, partner, host). */
function isWorkspacePath(pathname: string): boolean {
  return pathname.startsWith("/admin") || (pathname.startsWith("/vendor") && pathname !== "/vendor/signup") || pathname.startsWith("/manage");
}

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const mainRef = useRef<HTMLElement>(null);
  useCardTilt();

  // Batch 2 (owner, 2026-10-22): no route-change fade — pages appear as soon as
  // they render, with skeletons while their data loads.

  // Hides the native splash screen (Capacitor's SplashScreen.hide(), no-op
  // on web) once the app shell has mounted, instead of relying on the
  // plugin's own auto-hide timer racing the app's real boot time.
  useEffect(() => {
    hideSplashScreen();
  }, []);

  // Android hardware back button (no-op on iOS/web) — pops the router
  // history first, only exits the app once there's nowhere left to go back
  // to. Registered once (a ref tracks the current pathname so the listener
  // itself doesn't need to be re-subscribed on every navigation).
  const pathnameRef = useRef(location.pathname);
  pathnameRef.current = location.pathname;
  useEffect(() => {
    return setupBackButton(
      () => navigate(-1),
      () => pathnameRef.current === "/"
    );
  }, [navigate]);

  // Universal/App Links (no-op on web) — a magic-link email, password-reset
  // link, or Stripe checkout redirect opened outside the app re-enters this
  // same router instead of a fresh page load. See native.ts for why only
  // the path/search/hash is passed through.
  useEffect(() => {
    return setupAppUrlListener((path) => navigate(path));
  }, [navigate]);

  // Referral attribution (participation-intent plan Phase 3) — captured once
  // on initial load only (empty deps), not on every in-app route change, so
  // a resident clicking around after landing doesn't re-log the same visit.
  // Never blocks rendering if it fails.
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref) logReferralLand(ref, "link").catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React Router doesn't reset scroll position on navigation by itself
  // (that's a browser-native behaviour for full page loads only) — without
  // this, following a link while scrolled down a long page lands on the
  // next page already scrolled down. Keyed on pathname only, not the full
  // location, so an in-page filter/query-param change (e.g. Explore's own
  // filters) doesn't yank the scroll position while staying on one page.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // /landing is a fully standalone marketing page with its own header/
  // footer (client/src/landing/) — it must never get the product app's own
  // chrome layered on top, same reasoning as hiding it for /login.
  const isStandaloneLanding = location.pathname === "/landing";
  // Pre-launch splash — same "no app chrome layered on top" treatment as
  // /landing, for the same reason: it's meant to stand alone, not read as
  // a page inside the product it's advertising.
  const isComingSoon = location.pathname === "/coming-soon";
  // Every full-page authentication surface (vendor/admin login + the
  // resident sign-in/forgot/reset trio, staff invite acceptance, and vendor
  // signup — same AuthEditorialShell split-screen treatment, design-system
  // unification pass) — auth should feel like its own focused moment, not a
  // form dropped into the middle of the app's normal nav/footer chrome.
  // Deliberately does NOT include /onboarding — that page already had its
  // own "hide header, keep footer" behaviour before this and isn't part of
  // what was asked for here, so it's left untouched via the separate
  // hideHeader check below rather than folded into this.
  const isAuthPage =
    location.pathname === "/login" ||
    location.pathname.startsWith("/signin") ||
    location.pathname === "/forgot-password" ||
    location.pathname === "/reset-password" ||
    location.pathname === "/accept-invite" ||
    location.pathname === "/admin-invite" ||
    location.pathname === "/vendor/signup";
  const hideHeader = isAuthPage || isStandaloneLanding || isComingSoon;
  // The bottom tab bar is participant-facing primary nav (IA spec's
  // Home/Explore/Create/Circles/My Life) — the vendor/admin dashboards
  // already have their own nav model (NavSidebar, see CLAUDE.md), so it
  // would either duplicate or conflict with that, not complement it.
  const hideTabBar = hideHeader || location.pathname.startsWith("/vendor") || location.pathname.startsWith("/admin") || location.pathname.startsWith("/manage");
  const gated = LAUNCH_GATE_ENABLED && !isExemptFromLaunchGate(location.pathname);
  const venueGated = !gated && isVenueGatedPath(location.pathname);

  return (
    <ThemeProvider><AuthProvider><ConfirmProvider><ToastProvider>
      <RouteTitleManager />
      <NativeShellSync />
      <BottomChromeSync />
      <GuestProvider>
        <NativePushSync />
        <MyStuffProvider>
          <DashboardNavProvider>
            {/* HC-QA-083 — first keyboard stop on every page: bypass the header. */}
            <a
              href="#main-content"
              className="skip-link"
              onClick={(e) => {
                e.preventDefault();
                mainRef.current?.focus();
              }}
            >
              Skip to main content
            </a>
            <SessionExpiryBanner />
            {!hideHeader && <Header />}
            {/* HC-QA-075 — main fills at least the viewport, so the footer starts
                below the fold. While a route's chunk and data load, the footer
                moves only off-screen, which isn't a visible layout shift (it
                was ~0.22 CLS on most routes at 70vh). */}
            <main ref={mainRef} id="main-content" tabIndex={-1} className={hideTabBar ? undefined : "mobile-tab-bar-space"} style={isStandaloneLanding || isComingSoon ? undefined : { minHeight: "100vh" }}>
              {gated || venueGated ? (
                <Routes>
                  <Route path="/coming-soon" element={<ComingSoon />} />
                  <Route path="*" element={<Navigate to="/coming-soon" replace />} />
                </Routes>
              ) : (
              <AppUpdateBoundary resetKey={location.pathname}>
              <Suspense fallback={<PageSpinner />}>
              <Routes>
                {/* "/" is the vendor pitch only while the pre-launch gate is
                    closed (per explicit request). Once VITE_LAUNCH_MODE=public
                    it is the consumer Home (sitemap audit P1-04), so the logo,
                    sign-out and every "/" link land on the product. /home stays
                    as a second route to the same page for existing links; the
                    pitch keeps /for-venues and gains /partners. */}
                <Route path="/" element={LAUNCH_GATE_ENABLED ? <ForVenues /> : <Home />} />
                <Route path="/home" element={<Home />} />
                {/* Sitemap audit P2-15 — the standalone /landing marketing page had no
                    way in; retired to a redirect (its code is still in client/src/landing/). */}
                <Route path="/landing" element={<Navigate to="/" replace />} />
                <Route path="/coming-soon" element={<ComingSoon />} />
                <Route path="/browse/:category" element={<Browse />} />
                <Route path="/centres/:id" element={<CentreDetail />} />
                <Route path="/clubs/:id" element={<ClubDetail />} />
                <Route path="/book/:centreId" element={<BookingFlow />} />
                <Route path="/register/:clubId" element={<RegistrationFlow />} />
                <Route path="/games" element={<Games />} />
                <Route path="/games/host" element={<HostGamePage />} />
                <Route path="/games/host/:gameId" element={<HostGamePage />} />
                <Route path="/free-time" element={<FreeTimeMode />} />
                <Route path="/make-it-happen" element={<MakeItHappen />} />
                {/* Experience 3.0 — each page shows a "not switched on" state while its switch is off. */}
                <Route path="/plan-my-day" element={<PlanMyDay />} />
                <Route path="/my-life/passport" element={<ActivityPassport />} />
                <Route path="/my-life/for-you" element={<ForMe />} />
                <Route path="/suggest-place" element={<SuggestPlacePage />} />
                {/* Sitemap audit P2-15 — Ask HelloCircle ran the same structured search
                    as Explore and was only reachable from /landing; folded into
                    Explore's search (?q= is forwarded). Page code kept in pages/AskHelloCircle.tsx. */}
                <Route path="/ask" element={<SearchRedirect />} />
                <Route path="/games/:id" element={<GameDetail />} />
                <Route path="/circles" element={<Circles />} />
                <Route path="/circles/start" element={<StartCirclePage />} />
                <Route path="/circles/:id" element={<CircleDetail />} />
                <Route path="/bookings" element={<MyBookings />} />
                {/* Phase 1 "Connect" — a second route to the same page, not a
                    redirect: /bookings stays canonical (confirmation/magic-link
                    emails already point there with ?ref=/?token= that a redirect
                    would have to remember to forward), while /my-life gives the
                    "My Life" nav label a URL that actually matches it. */}
                <Route path="/my-life" element={<MyBookings />} />
                {/* Batch 2 — one booking's details, all six participation types
                    (kind = booking | registration | program | experience | game | pass). */}
                <Route path="/bookings/:kind/:ref" element={<BookingDetailPage />} />
                <Route path="/receipts/:ref" element={<ReceiptPage />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/chats" element={<Chats />} />
                <Route path="/signin" element={<SignIn />} />
                <Route path="/signin/create" element={<SignUp />} />
                <Route path="/signin/email-link" element={<EmailLinkSignIn />} />
                <Route path="/programs" element={<Programs />} />
                <Route path="/programs/:id" element={<ProgramDetail />} />
                <Route path="/provider/:id" element={<ProviderProfilePage />} />
                <Route path="/host/:id" element={<HostProfilePage />} />
                <Route path="/explore" element={<Explore />} />
                {/* Compare was folded into Browse's centre-select mode
                    (post-audit hardening pass) — redirect any bookmarked link. */}
                <Route path="/compare" element={<Navigate to="/browse/centres" replace />} />
                <Route path="/adventures" element={<Adventures />} />
                <Route path="/volunteer" element={<Volunteer />} />
                <Route path="/adventures/:id" element={<ExperienceDetail />} />
                <Route path="/experiences" element={<Experiences />} />
                <Route path="/experiences/:id" element={<ExperienceDetail />} />
                {/* Participation Phase 1 — community events (same detail page). */}
                <Route path="/events" element={<Events />} />
                <Route path="/events/:id" element={<ExperienceDetail />} />
                {/* Search merged into Explore's Results Mode — preserve old
                    /search?q=... links/bookmarks (see SearchRedirect.tsx). */}
                <Route path="/search" element={<SearchRedirect />} />
                {/* Onboarding is a popup now (AccountSetupGate), not a page — old links/bookmarks land on My Life with it open. */}
                <Route path="/onboarding" element={<Navigate to="/bookings?setup=1" replace />} />
                <Route path="/payment/success" element={<PaymentSuccess />} />
                <Route path="/payment/cancel" element={<PaymentCancel />} />
                <Route path="/login" element={<Login />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/accept-invite" element={<AcceptInvite />} />
                <Route path="/admin-invite" element={<AdminInviteAccept />} />
                <Route path="/booking-change" element={<BookingChangePage />} />
                <Route path="/manage/link-confirm" element={<ManageLinkConfirm />} />
                <Route path="/i/:token" element={<InvitationLanding />} />
                <Route path="/for-venues" element={<ForVenues />} />
                <Route path="/partners" element={<ForVenues />} />
                <Route path="/pricing" element={<Pricing />} />
                <Route path="/become-a-host" element={<BecomeAHost />} />
                <Route path="/vendor/signup" element={<VendorSignup />} />
                <Route path="/vendor/centres/:id" element={<PartnerOrgGate><VendorCentreEditPage /></PartnerOrgGate>} />
                <Route path="/vendor/clubs/:id" element={<PartnerOrgGate><VendorClubEditPage /></PartnerOrgGate>} />
                <Route path="/vendor/programs/:id" element={<PartnerOrgGate><VendorProgramEditPage /></PartnerOrgGate>} />
                <Route path="/vendor/experiences/:id" element={<PartnerOrgGate><VendorExperienceEditPage /></PartnerOrgGate>} />
                <Route path="/vendor/orders/:source/:ref" element={<PartnerOrgGate><VendorOrderPage /></PartnerOrgGate>} />
                <Route path="/vendor/door" element={<PartnerOrgGate><VendorDoorHome /></PartnerOrgGate>} />
                <Route path="/vendor/door/:sessionId" element={<PartnerOrgGate><VendorDoorScreen /></PartnerOrgGate>} />
                {/* HelloCircle Manage — /manage is the resident (Host)
                    dashboard (Overview/Activities/Circles tabs, one page,
                    same shape as VendorDashboard.tsx; ManageHome.tsx
                    redirects a vendor/admin session on to /vendor itself,
                    preserving the old bare-/manage behavior for those
                    accounts). /manage/activities used to be its own page
                    (Phase 3) — kept as a redirect for old links/bookmarks.
                    /manage/circles/:id (Phase 4) is still its own route: a
                    specific Circle's own Plans/Members/Settings is
                    per-entity, the same way a vendor's centre/club editor
                    is its own route rather than a Listings sub-tab. */}
                <Route path="/manage" element={<ManageHome />} />
                <Route path="/manage/pro" element={<HostProPage />} />
                <Route path="/manage/rewards" element={<HostRewardsPage />} />
                <Route path="/manage/activities" element={<Navigate to="/manage?tab=activities" replace />} />
                <Route path="/manage/circles/:id" element={<ManageCircle />} />
                <Route path="/vendor" element={<VendorDashboard />} />
                <Route path="/vendor/pro" element={<PartnerOrgGate><VendorProPage /></PartnerOrgGate>} />
                <Route path="/vendor/rewards" element={<PartnerOrgGate><VendorRewardsPage /></PartnerOrgGate>} />
                <Route path="/admin" element={<AdminDashboard />} />
                {/* Revenue & Connect Stage 4 — CMS-published versions once they exist; the existing pages until then. */}
                <Route path="/privacy" element={<CmsPolicy docKey="privacy-policy" fallback={<PrivacyPolicy />} />} />
                <Route path="/cookies" element={<CmsPolicy docKey="cookie-policy" fallback={<CookiePolicy />} extra={<CookieChoiceControl />} />} />
                <Route path="/policies" element={<PolicyIndex />} />
                <Route path="/policies/:key" element={<PolicyPage />} />
                <Route path="/about" element={<About />} />
                <Route path="/contact" element={<Contact />} />
                <Route path="/complaints" element={<Complaints />} />
                <Route path="/help-guide" element={<HelpGuideIndex />} />
                <Route path="/help-guide/explore" element={<HelpGuideExplore />} />
                <Route path="/help-guide/circles" element={<HelpGuideCircles />} />
                <Route path="/help-guide/my-life" element={<HelpGuideMyLife />} />
                <Route path="/help-guide/start" element={<HelpGuideStart />} />
                {/* Local SEO landing pages (participation-intent plan Phase 3) — kept
                    last among real routes; react-router v6 ranks static path segments
                    over dynamic ones regardless of declaration order, so this never
                    shadows an existing 2-segment route like /games/:id. */}
                {BookingKitPreview && <Route path="/dev/booking-kit" element={<BookingKitPreview />} />}
                {CardKitPreview && <Route path="/dev/card-kit" element={<CardKitPreview />} />}
                <Route path="/:county/:activity" element={<LocalActivity />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
              </Suspense>
              </AppUpdateBoundary>
              )}
            </main>
            {/* Workspaces (admin, partner, host) are tools, not marketing pages —
                they render their own compact footer instead. */}
            {!isStandaloneLanding && !isAuthPage && !isComingSoon && !isWorkspacePath(location.pathname) && <Footer />}
            <AccountSetupGate />
            <PolicyAcceptanceGate />
            <CookieNotice />
            {!hideTabBar && <MobileTabBar />}
          </DashboardNavProvider>
        </MyStuffProvider>
      </GuestProvider>
    </ToastProvider></ConfirmProvider></AuthProvider></ThemeProvider>
  );
}
