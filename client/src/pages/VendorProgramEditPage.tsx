import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchVendorListings, fetchVendorProgram } from "../api";
import { useAuth } from "../AuthContext";
import { BackLink } from "../components/BackLink";
import { ProgramCreateForm, ProgramManager } from "../components/VendorPrograms";
import { useUnsavedChangesGuard } from "../components/form";
import { PageSpinner } from "../components/ui";
import { fonts } from "../theme";
import type { VendorListingSummary } from "../types";

// Dedicated page for a Program — was two separate wide Drawers (create form,
// then a manage view with sessions/attendance/enrollments). Kept as a single
// scrolling page (no Tabs): the manage view's sections are sequential, not
// independent parallel concerns the way Rooms/Availability/Hours are for a
// centre.

export function VendorProgramEditPage() {
  const { id } = useParams<{ id: string }>();
  const programId = id === "new" ? "new" : (id as string);
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [listings, setListings] = useState<{ centres: VendorListingSummary[]; clubs: VendorListingSummary[] }>({ centres: [], clubs: [] });
  const [title, setTitle] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const { requestNavigation, dialog: unsavedDialog } = useUnsavedChangesGuard(dirty);

  useEffect(() => {
    if (programId === "new") fetchVendorListings().then(setListings);
    else fetchVendorProgram(programId).then((p) => setTitle(p.title));
  }, [programId]);

  if (authLoading) return <PageSpinner />;
  if (!user || user.role !== "vendor" || user.status !== "approved") {
    navigate("/login");
    return null;
  }

  return (
    <div className="fade-panel">
      <section className="section-pad" style={{ maxWidth: 920, margin: "0 auto", padding: "40px 24px 90px" }}>
        <BackLink onClick={() => requestNavigation(() => navigate("/vendor?tab=programs"))}>Back to programs</BackLink>
        <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 24, margin: "0 0 18px", letterSpacing: "-.01em" }}>
          {programId === "new" ? "New program" : (title ?? "Program")}
        </h2>

        {programId === "new" ? (
          <ProgramCreateForm listings={listings} onCreated={(newId) => navigate(`/vendor/programs/${newId}`, { replace: true })} onDirtyChange={setDirty} />
        ) : (
          <ProgramManager programId={programId} onChanged={() => fetchVendorProgram(programId).then((p) => setTitle(p.title))} />
        )}
      </section>
      {unsavedDialog}
    </div>
  );
}
