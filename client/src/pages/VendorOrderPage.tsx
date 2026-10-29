import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { PageSpinner } from "../components/ui";
import { PartnerWorkspace } from "../components/workspace/PartnerWorkspace";
import { OrderRecordView } from "../components/workspace/OrderRecord";
import type { OrderSource } from "../types";

// Phase J — /vendor/orders/:source/:ref: one booking of any type as a record
// page (shareable, Back-safe). Linked from club registrations, programme
// enrolments, experience attendees and the hall booking record.

const SOURCES: OrderSource[] = ["experience", "registration", "program", "booking"];

export function VendorOrderPage() {
  const { source, ref } = useParams<{ source: string; ref: string }>();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  useEffect(() => {
    if (!loading && (!user || user.role !== "vendor" || user.status !== "approved")) navigate("/login");
  }, [loading, user, navigate]);
  if (loading) return <PageSpinner />;
  if (!user || user.role !== "vendor" || user.status !== "approved" || !ref) return null;
  const valid = SOURCES.includes(source as OrderSource);
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate("/vendor?tab=bookings"));
  return (
    <PartnerWorkspace user={user} active="bookings" title="Booking record">
      {valid ? <OrderRecordView source={source as OrderSource} orderRef={ref} backLabel="Bookings" onBack={back} /> : <p className="adm-note">Unknown kind of booking.</p>}
    </PartnerWorkspace>
  );
}
