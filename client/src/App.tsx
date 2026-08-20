import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider } from "./AuthContext";
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
import { ForgotPassword } from "./pages/ForgotPassword";
import { FreeTimeMode } from "./pages/FreeTimeMode";
import { GameDetail } from "./pages/GameDetail";
import { Games } from "./pages/Games";
import { Home } from "./pages/Home";
import { Login } from "./pages/Login";
import { MakeItHappen } from "./pages/MakeItHappen";
import { MyBookings } from "./pages/MyBookings";
import { Onboarding } from "./pages/Onboarding";
import { PaymentCancel } from "./pages/PaymentCancel";
import { PaymentSuccess } from "./pages/PaymentSuccess";
import { PrivacyPolicy } from "./pages/PrivacyPolicy";
import { ProgramDetail } from "./pages/ProgramDetail";
import { RegistrationFlow } from "./pages/RegistrationFlow";
import { ResetPassword } from "./pages/ResetPassword";
import { Search } from "./pages/Search";
import { VendorDashboard } from "./pages/VendorDashboard";
import { VendorSignup } from "./pages/VendorSignup";

export function App() {
  const location = useLocation();
  const hideHeader = location.pathname === "/login" || location.pathname === "/onboarding";
  // The bottom tab bar is participant-facing primary nav (IA spec's
  // Home/Explore/Create/Circles/My Life) — the vendor/admin dashboards
  // already have their own nav model (NavSidebar, see CLAUDE.md), so it
  // would either duplicate or conflict with that, not complement it.
  const hideTabBar = hideHeader || location.pathname.startsWith("/vendor") || location.pathname.startsWith("/admin");

  return (
    <AuthProvider>
      <GuestProvider>
        <MyStuffProvider>
          <DashboardNavProvider>
            {!hideHeader && <Header />}
            <main className={hideTabBar ? undefined : "mobile-tab-bar-space"} style={{ minHeight: "70vh" }}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/browse/:category" element={<Browse />} />
                <Route path="/centres/:id" element={<CentreDetail />} />
                <Route path="/clubs/:id" element={<ClubDetail />} />
                <Route path="/book/:centreId" element={<BookingFlow />} />
                <Route path="/register/:clubId" element={<RegistrationFlow />} />
                <Route path="/games" element={<Games />} />
                <Route path="/free-time" element={<FreeTimeMode />} />
                <Route path="/make-it-happen" element={<MakeItHappen />} />
                <Route path="/ask" element={<AskHelloCircle />} />
                <Route path="/games/:id" element={<GameDetail />} />
                <Route path="/circles" element={<Circles />} />
                <Route path="/circles/:id" element={<CircleDetail />} />
                <Route path="/bookings" element={<MyBookings />} />
                <Route path="/programs/:id" element={<ProgramDetail />} />
                <Route path="/adventures" element={<Adventures />} />
                <Route path="/adventures/:id" element={<ExperienceDetail />} />
                <Route path="/experiences" element={<Experiences />} />
                <Route path="/experiences/:id" element={<ExperienceDetail />} />
                <Route path="/search" element={<Search />} />
                <Route path="/onboarding" element={<Onboarding />} />
                <Route path="/payment/success" element={<PaymentSuccess />} />
                <Route path="/payment/cancel" element={<PaymentCancel />} />
                <Route path="/login" element={<Login />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/accept-invite" element={<AcceptInvite />} />
                <Route path="/vendor/signup" element={<VendorSignup />} />
                <Route path="/vendor" element={<VendorDashboard />} />
                <Route path="/admin" element={<AdminDashboard />} />
                <Route path="/privacy" element={<PrivacyPolicy />} />
                <Route path="/cookies" element={<CookiePolicy />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </main>
            <Footer />
            <CookieNotice />
            {!hideTabBar && <MobileTabBar />}
          </DashboardNavProvider>
        </MyStuffProvider>
      </GuestProvider>
    </AuthProvider>
  );
}
