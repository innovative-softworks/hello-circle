import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CircleCreationBanner } from "../components/circle/CircleCreationBanner";
import { fetchVendorExperience, publishVendorExperience } from "../api";
import { useAuth } from "../AuthContext";
import { BackLink } from "../components/BackLink";
import { PartnerWorkspace } from "../components/workspace/PartnerWorkspace";
import { ListingMeta } from "../components/workspace/ListingMeta";
import { DetailStats } from "../components/workspace/DetailParts";
import { irelandToday } from "../irelandDate";
import { dateLabel } from "../euro";
import { BookingsPanel, ExperienceEditor, SessionsManager } from "../components/VendorExperiences";
import { ExperienceCreationWizard } from "../components/ExperienceCreationWizard";
import { useUnsavedChangesGuard } from "../components/form";
import { ListingReviewNotice } from "../components/ListingReviewNotice";
import { LoadErrorState, PageSpinner, Tabs } from "../components/ui";
import { fonts } from "../theme";
import type { Experience } from "../types";
import { OptionsEditor } from "../components/experience/OptionsEditor";
import { QuestionsEditor } from "../components/experience/QuestionsEditor";
import { AttendeesPanel } from "../components/experience/AttendeesPanel";
import { useParticipationFeatures } from "../circleFeatures";

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

type ExperienceTab = "details" | "departures" | "registration" | "questions" | "attendees" | "bookings";

export function VendorExperienceEditPage() {
  const { id } = useParams<{ id: string }>();
  const experienceId = id === "new" ? "new" : (id as string);
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<ExperienceTab>("details");
  const [experience, setExperience] = useState<Experience | null>(null);
  const [loading, setLoading] = useState(experienceId !== "new");
  const [loadError, setLoadError] = useState(false);
  const [wizardMode, setWizardMode] = useState(experienceId === "new");
  const [dirty, setDirty] = useState(false);
  const { requestNavigation, dialog: unsavedDialog } = useUnsavedChangesGuard(dirty);
  // Participation Phase 1 — the Registration tab shows while options are on,
  // or whenever the listing already sells options (so they stay visible).
  const participation = useParticipationFeatures();

  const loadExperience = () => {
    setLoadError(false);
    fetchVendorExperience(experienceId)
      .then((e) => {
        setExperience(e);
        setWizardMode(e.status === "draft");
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (experienceId !== "new") loadExperience();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experienceId]);

  const onSaved = (savedId: string) => {
    if (experienceId === "new") navigate(`/vendor/experiences/${savedId}${window.location.search}`, { replace: true });
    else fetchVendorExperience(experienceId).then(setExperience);
  };

  // See VendorDashboard.tsx's identical comment — navigate() belongs in an
  // effect, not called directly during render.
  useEffect(() => {
    if (!authLoading && (!user || user.role !== "vendor" || user.status !== "approved")) navigate("/login");
  }, [authLoading, user, navigate]);

  if (authLoading || loading) return <PageSpinner />;
  if (!user || user.role !== "vendor" || user.status !== "approved") return null;

  const title = experienceId === "new" ? (participation["participation.events"] ? "New adventure, experience or event" : "New adventure/experience") : (experience?.title ?? "Edit listing");
  if (loadError) {
    return (
      <PartnerWorkspace user={user} active="experiences" title={title}>
        <BackLink onClick={() => navigate("/vendor?tab=experiences")}>Back to Adventures & Experiences</BackLink>
        <LoadErrorState title="Couldn't load this listing" onRetry={loadExperience} />
      </PartnerWorkspace>
    );
  }

  return (
    <PartnerWorkspace
      user={user}
      active="experiences"
      title={title}
      guard={requestNavigation}
      subtitle={!wizardMode && experience ? <ListingMeta status={experience.status} kind={experience.kind === "adventure" ? "Adventure" : experience.kind === "volunteer" ? "Volunteer" : experience.kind === "event" ? "Community event" : "Experience"} place={[experience.area, experience.county].filter(Boolean).join(", ")} /> : undefined}
    >
      <div>
        <CircleCreationBanner type="experience" listingId={experienceId === "new" ? null : experienceId} />
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
            <ListingReviewNotice
              listing={{ type: "experience", id: experienceId }}
              status={experience?.status}
              dirty={dirty}
              onResubmit={async () => {
                await publishVendorExperience(experienceId);
                setExperience(await fetchVendorExperience(experienceId));
              }}
            />
            {experience && (
              <DetailStats
                items={[
                  { label: "Price", value: experience.priceCents ? `€${(experience.priceCents / 100).toFixed(2)}` : "Free", sub: experience.registration?.mode === "options" ? "from · several options" : "per person" },
                  { label: "Group size", value: `Up to ${experience.capacity}`, sub: experience.difficulty || undefined },
                  { label: "Duration", value: `${Math.round(experience.durationMinutes / 6) / 10} h`, sub: experience.meetingPoint || undefined },
                  (() => {
                    const next = (experience.sessions ?? []).filter((x) => x.date >= irelandToday());
                    return { label: "Upcoming dates", value: String(next.length), sub: next[0] ? `Next ${dateLabel(next[0].date)} · ${next[0].time}` : "None scheduled" };
                  })(),
                ]}
              />
            )}
            <div style={{ marginBottom: 22 }}>
              <Tabs
                value={tab}
                onChange={setTab}
                options={[
                  { key: "details", label: "Details" },
                  { key: "departures", label: experience?.kind === "event" ? "Dates" : "Departures" },
                  ...(participation["participation.options"] || experience?.registration?.mode === "options" ? [{ key: "registration" as const, label: "Registration" }] : []),
                  // Participation Phase 2 — questions while attendee details are on; attendees whenever either Phase 2 switch is.
                  ...(participation["participation.attendees"] ? [{ key: "questions" as const, label: "Questions" }] : []),
                  ...(participation["participation.attendees"] || participation["participation.checkin"] ? [{ key: "attendees" as const, label: "Attendees" }] : []),
                  { key: "bookings", label: "Bookings" },
                ]}
              />
            </div>

            {tab === "details" && <ExperienceEditor id={experienceId} onSaved={onSaved} onDirtyChange={setDirty} />}
            {tab === "departures" && <SessionsManager experienceId={experienceId} />}
            {tab === "registration" && experience && <OptionsEditor experienceId={experienceId} kind={experience.kind} />}
            {tab === "questions" && <QuestionsEditor experienceId={experienceId} />}
            {tab === "attendees" && <AttendeesPanel experienceId={experienceId} checkinOn={participation["participation.checkin"]} />}
            {tab === "bookings" && <BookingsPanel experienceId={experienceId} />}
          </>
        )}
      </div>
      {unsavedDialog}
    </PartnerWorkspace>
  );
}
