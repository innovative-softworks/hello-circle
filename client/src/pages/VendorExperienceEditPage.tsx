import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchVendorExperience } from "../api";
import { useAuth } from "../AuthContext";
import { BackLink } from "../components/BackLink";
import { BookingsPanel, ExperienceEditor, SessionsManager } from "../components/VendorExperiences";
import { ExperienceCreationWizard } from "../components/ExperienceCreationWizard";
import { useUnsavedChangesGuard } from "../components/form";
import { PageSpinner, Tabs } from "../components/ui";
import { fonts } from "../theme";
import type { Experience } from "../types";

// Dedicated page for the Adventure/Experience create/edit form — same
// reasoning as VendorCentreEditPage.tsx: fields + two independent
// sub-resource managers (Departures, Bookings) earn a page + tabs instead
// of a Drawer.
//
// "new" and any real listing still in 'draft' both render the Guided Flow
// creation wizard (Form System Audit, Phase 5 fast-follow) instead of the
// settings-style tabs below — see VendorCentreEditPage.tsx's identical
// wizardMode pattern and its comment on why this is sticky state, not a
// derived expression.

type ExperienceTab = "details" | "departures" | "bookings";

export function VendorExperienceEditPage() {
  const { id } = useParams<{ id: string }>();
  const experienceId = id === "new" ? "new" : (id as string);
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<ExperienceTab>("details");
  const [experience, setExperience] = useState<Experience | null>(null);
  const [loading, setLoading] = useState(experienceId !== "new");
  const [wizardMode, setWizardMode] = useState(experienceId === "new");
  const [dirty, setDirty] = useState(false);
  const { requestNavigation, dialog: unsavedDialog } = useUnsavedChangesGuard(dirty);

  useEffect(() => {
    if (experienceId !== "new") {
      fetchVendorExperience(experienceId).then((e) => {
        setExperience(e);
        setWizardMode(e.status === "draft");
        setLoading(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experienceId]);

  const onSaved = (savedId: string) => {
    if (experienceId === "new") navigate(`/vendor/experiences/${savedId}`, { replace: true });
    else fetchVendorExperience(experienceId).then(setExperience);
  };

  if (authLoading || loading) return <PageSpinner />;
  if (!user || user.role !== "vendor" || user.status !== "approved") {
    navigate("/login");
    return null;
  }

  const title = experienceId === "new" ? "New adventure/experience" : (experience?.title ?? "Edit listing");

  return (
    <div className="fade-panel">
      <section className="section-pad" style={{ maxWidth: 920, margin: "0 auto", padding: "40px 24px 90px" }}>
        <BackLink onClick={() => requestNavigation(() => navigate("/vendor?tab=experiences"))}>Back to Adventures & Experiences</BackLink>

        {wizardMode ? (
          <ExperienceCreationWizard
            initialExperienceId={experienceId}
            onDirtyChange={setDirty}
            onPublished={(publishedId) => {
              setWizardMode(false);
              fetchVendorExperience(publishedId).then(setExperience);
            }}
          />
        ) : (
          <>
            <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 24, margin: "0 0 18px", letterSpacing: "-.01em" }}>{title}</h2>
            <div style={{ marginBottom: 22 }}>
              <Tabs
                value={tab}
                onChange={setTab}
                options={[
                  { key: "details", label: "Details" },
                  { key: "departures", label: "Departures" },
                  { key: "bookings", label: "Bookings" },
                ]}
              />
            </div>

            {tab === "details" && <ExperienceEditor id={experienceId} onSaved={onSaved} onDirtyChange={setDirty} />}
            {tab === "departures" && <SessionsManager experienceId={experienceId} />}
            {tab === "bookings" && <BookingsPanel experienceId={experienceId} />}
          </>
        )}
      </section>
      {unsavedDialog}
    </div>
  );
}
