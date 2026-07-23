import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider } from "./AuthContext";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { MyStuffProvider } from "./MyStuffContext";
import { AdminDashboard } from "./pages/AdminDashboard";
import { Browse } from "./pages/Browse";
import { Checklist } from "./pages/Checklist";
import { CentreDetail } from "./pages/CentreDetail";
import { ClubDetail } from "./pages/ClubDetail";
import { BookingFlow } from "./pages/BookingFlow";
import { Home } from "./pages/Home";
import { Login } from "./pages/Login";
import { MyBookings } from "./pages/MyBookings";
import { PaymentCancel } from "./pages/PaymentCancel";
import { PaymentSuccess } from "./pages/PaymentSuccess";
import { RegistrationFlow } from "./pages/RegistrationFlow";
import { VendorDashboard } from "./pages/VendorDashboard";
import { VendorSignup } from "./pages/VendorSignup";

export function App() {
  const location = useLocation();
  const hideHeader = location.pathname === "/login";

  return (
    <AuthProvider>
      <MyStuffProvider>
        {!hideHeader && <Header />}
        <main style={{ minHeight: "70vh" }}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/browse/:category" element={<Browse />} />
            <Route path="/centres/:id" element={<CentreDetail />} />
            <Route path="/clubs/:id" element={<ClubDetail />} />
            <Route path="/book/:centreId/:roomId" element={<BookingFlow />} />
            <Route path="/register/:clubId" element={<RegistrationFlow />} />
            <Route path="/bookings" element={<MyBookings />} />
            <Route path="/payment/success" element={<PaymentSuccess />} />
            <Route path="/payment/cancel" element={<PaymentCancel />} />
            <Route path="/checklist" element={<Checklist />} />
            <Route path="/login" element={<Login />} />
            <Route path="/vendor/signup" element={<VendorSignup />} />
            <Route path="/vendor" element={<VendorDashboard />} />
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <Footer />
      </MyStuffProvider>
    </AuthProvider>
  );
}
