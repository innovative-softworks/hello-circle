import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider } from "./AuthContext";
import { logReferralLand } from "./api/public";
import { CookieNotice } from "./components/CookieNotice";
import { DashboardNavProvider } from "./DashboardNavContext";
import { Footer } from "./components/Footer";
import { GuestProvider } from "./GuestContext";
import { Header } from "./components/Header";
import { MobileTabBar } from "./components/MobileTabBar";
import { MyStuffProvider } from "./MyStuffContext";
import { AcceptInvite } from "./pages/AcceptInvite";
import { AdminDashboard } from "./pages/AdminDashboard";
import { AskHelloCircle } from "./pages/AskHelloCircle";
import { Browse } from "./pages/Browse";
import { CentreDetail } from "./pages/CentreDetail";
import { CircleDetail } from "./pages/CircleDetail";
import { Circles } from "./pages/Circles";
import { ClubDetail } from "./pages/ClubDetail";
import { BookingFlow } from "./pages/BookingFlow";
import { CookiePolicy } from "./pages/CookiePolicy";
import { Adventures } from "./pages/Adventures";
import { ExperienceDetail } from "./pages/ExperienceDetail";
import { Experiences } from "./pages/Experiences";
import { Explore } from "./pages/Explore";
import { ForgotPassword } from "./pages/ForgotPassword";
import { ForVenues } from "./pages/ForVenues";
import { FreeTimeMode } from "./pages/FreeTimeMode";
import { GameDetail } from "./pages/GameDetail";
import { Games } from "./pages/Games";
import { Home } from "./pages/Home";
import { HostProfilePage } from "./pages/HostProfile";
import { Login } from "./pages/Login";
import { MakeItHappen } from "./pages/MakeItHappen";
import { MyBookings } from "./pages/MyBookings";
import { NotFound } from "./pages/NotFound";
import { Onboarding } from "./pages/Onboarding";
import { PaymentCancel } from "./pages/PaymentCancel";
import { PaymentSuccess } from "./pages/PaymentSuccess";
import { PrivacyPolicy } from "./pages/PrivacyPolicy";
import { Profile } from "./pages/Profile";
import { SuggestPlacePage } from "./pages/SuggestPlace";
import { LandingPage } from "./landing/LandingPage";
import { LocalActivity } from "./pages/LocalActivity";
import { ProgramDetail } from "./pages/ProgramDetail";
import { ProviderProfilePage } from "./pages/ProviderProfile";
import { RegistrationFlow } from "./pages/RegistrationFlow";
import { ResetPassword } from "./pages/ResetPassword";
import { SearchRedirect } from "./pages/SearchRedirect";
import { SignIn } from "./pages/SignIn";
import { SignUp } from "./pages/SignUp";
import { EmailLinkSignIn } from "./pages/EmailLinkSignIn";
import { ThemeProvider } from "./ThemeContext";
import { VendorDashboard } from "./pages/VendorDashboard";
import { VendorSignup } from "./pages/VendorSignup";
import { VendorCentreEditPage } from "./pages/VendorCentreEditPage";
import { VendorClubEditPage } from "./pages/VendorClubEditPage";
import { VendorProgramEditPage } from "./pages/VendorProgramEditPage";
import { VendorExperienceEditPage } from "./pages/VendorExperienceEditPage";
import { HostGamePage } from "./pages/HostGamePage";
import { ManageActivities } from "./pages/ManageActivities";
import { ManageCircle } from "./pages/ManageCircle";
import { StartCirclePage } from "./pages/StartCirclePage";

export function App() {
  const location = useLocation();

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
    location.pathname === "/vendor/signup";
  const hideHeader = isAuthPage || location.pathname === "/onboarding" || isStandaloneLanding;
  // The bottom tab bar is participant-facing primary nav (IA spec's
  // Home/Explore/Create/Circles/My Life) — the vendor/admin dashboards
  // already have their own nav model (NavSidebar, see CLAUDE.md), so it
  // would either duplicate or conflict with that, not complement it.
  const hideTabBar = hideHeader || location.pathname.startsWith("/vendor") || location.pathname.startsWith("/admin") || location.pathname.startsWith("/manage");

  return (
    <ThemeProvider><AuthProvider>
      <GuestProvider>
        <MyStuffProvider>
          <DashboardNavProvider>
            {!hideHeader && <Header />}
            <main className={hideTabBar ? undefined : "mobile-tab-bar-space"} style={isStandaloneLanding ? undefined : { minHeight: "70vh" }}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/landing" element={<LandingPage />} />
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
                <Route path="/suggest-place" element={<SuggestPlacePage />} />
                <Route path="/ask" element={<AskHelloCircle />} />
                <Route path="/games/:id" element={<GameDetail />} />
                <Route path="/circles" element={<Circles />} />
                <Route path="/circles/start" element={<StartCirclePage />} />
                <Route path="/circles/:id" element={<CircleDetail />} />
                <Route path="/bookings" element={<MyBookings />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/signin" element={<SignIn />} />
                <Route path="/signin/create" element={<SignUp />} />
                <Route path="/signin/email-link" element={<EmailLinkSignIn />} />
                <Route path="/programs/:id" element={<ProgramDetail />} />
                <Route path="/provider/:id" element={<ProviderProfilePage />} />
                <Route path="/host/:id" element={<HostProfilePage />} />
                <Route path="/explore" element={<Explore />} />
                {/* Compare was folded into Browse's centre-select mode
                    (post-audit hardening pass) — redirect any bookmarked link. */}
                <Route path="/compare" element={<Navigate to="/browse/centres" replace />} />
                <Route path="/adventures" element={<Adventures />} />
                <Route path="/adventures/:id" element={<ExperienceDetail />} />
                <Route path="/experiences" element={<Experiences />} />
                <Route path="/experiences/:id" element={<ExperienceDetail />} />
                {/* Search merged into Explore's Results Mode — preserve old
                    /search?q=... links/bookmarks (see SearchRedirect.tsx). */}
                <Route path="/search" element={<SearchRedirect />} />
                <Route path="/onboarding" element={<Onboarding />} />
                <Route path="/payment/success" element={<PaymentSuccess />} />
                <Route path="/payment/cancel" element={<PaymentCancel />} />
                <Route path="/login" element={<Login />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/accept-invite" element={<AcceptInvite />} />
                <Route path="/for-venues" element={<ForVenues />} />
                <Route path="/vendor/signup" element={<VendorSignup />} />
                <Route path="/vendor/centres/:id" element={<VendorCentreEditPage />} />
                <Route path="/vendor/clubs/:id" element={<VendorClubEditPage />} />
                <Route path="/vendor/programs/:id" element={<VendorProgramEditPage />} />
                <Route path="/vendor/experiences/:id" element={<VendorExperienceEditPage />} />
                {/* HelloCircle Manage — vendor is still the bare /manage
                    redirect target (Phase 1); /manage/activities (Phase 3)
                    and /manage/circles/:id (Phase 4) are the resident-
                    authenticated Manage surfaces. */}
                <Route path="/manage" element={<Navigate to="/vendor" replace />} />
                <Route path="/manage/activities" element={<ManageActivities />} />
                <Route path="/manage/circles/:id" element={<ManageCircle />} />
                <Route path="/vendor" element={<VendorDashboard />} />
                <Route path="/admin" element={<AdminDashboard />} />
                <Route path="/privacy" element={<PrivacyPolicy />} />
                <Route path="/cookies" element={<CookiePolicy />} />
                {/* Local SEO landing pages (participation-intent plan Phase 3) — kept
                    last among real routes; react-router v6 ranks static path segments
                    over dynamic ones regardless of declaration order, so this never
                    shadows an existing 2-segment route like /games/:id. */}
                <Route path="/:county/:activity" element={<LocalActivity />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </main>
            {!isStandaloneLanding && !isAuthPage && <Footer />}
            <CookieNotice />
            {!hideTabBar && <MobileTabBar />}
          </DashboardNavProvider>
        </MyStuffProvider>
      </GuestProvider>
    </AuthProvider></ThemeProvider>
  );
}
