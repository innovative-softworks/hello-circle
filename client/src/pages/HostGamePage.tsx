import { useEffect, useState, type SetStateAction } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { createGame, fetchCentres, fetchGame, fetchGameParticipantsForManage, updateGame } from "../api";
import { signInHref } from "../authRedirect";
import { BackLink } from "../components/BackLink";
import { GuidedFlow } from "../components/GuidedFlow";
import { NumberStepper, useUnsavedChangesGuard } from "../components/form";
import { Button, inputStyle, labelStyle } from "../components/ui";
import { useGuest } from "../GuestContext";
import { colors, radius } from "../theme";
import { SKILL_LEVELS } from "../constants";
import type { Centre } from "../types";

// ISO UTC -> the local wall-clock string a datetime-local input expects —
// the reverse of handleSubmit's `new Date(form.confirmationDeadline).toISOString()`.
function isoToDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

// Host-a-game form, split out of Games.tsx into its own page. Two-step
// Guided Flow (Basics -> Details) instead of one long scrolling form with a
// collapsible "+ Add more detail" section (Form System Audit follow-up, same
// pattern as CentreCreationWizard.tsx/VendorSignup.tsx) — the step boundary
// is exactly where that collapsible section used to be: step 1 is the
// always-required "post a pickup game quickly" fields, step 2 is everything
// that only feeds GameDetail.tsx's optional About/What to bring/Good to
// know/Location/Cancellation sections. Like VendorSignup, this is a single
// atomic POST createGame() call — no draft row to persist between steps, so
// step 1's "Continue" is pure client-side validation.

const STEP_LABELS = ["Basics", "Details"];

export function HostGamePage() {
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [searchParams] = useSearchParams();
  // Edit mode (HelloCircle Manage /manage/activities) — same two-step wizard,
  // reused for an existing game instead of a new one. `/games/host` (no id)
  // stays create-only, untouched.
  const { gameId } = useParams<{ gameId: string }>();

  // "Do it again" (GameDetail.tsx) and IntentCaptureForm's "start it
  // yourself" link both carry activity/venue forward via query params —
  // date/time/capacity are deliberately left for the host to re-enter.
  // Not applicable in edit mode, where the form is instead populated from
  // the existing game below.
  const initialActivity = gameId ? "" : searchParams.get("activity") ?? "";
  const initialCentreId = gameId ? "" : searchParams.get("centreId") ?? "";
  const initialLocationText = gameId ? "" : searchParams.get("locationText") ?? "";
  // HelloCircle Manage Phase 4 — a Circle organiser's "Create plan" deep-link
  // carries the circle id through so the new game gets tagged games.circle_id.
  // Not part of the editable `form` state — it's contextual, not a field the
  // host chooses, and isn't relevant to edit mode (a game's circle isn't
  // reassignable from this wizard).
  const circleId = gameId ? undefined : searchParams.get("circleId") ?? undefined;

  const [step, setStep] = useState(1);
  const [centres, setCentres] = useState<Centre[]>([]);
  const [loadingGame, setLoadingGame] = useState(!!gameId);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [priceLocked, setPriceLocked] = useState(false);
  const [form, setFormRaw] = useState({
    activityLabel: initialActivity,
    centreId: initialCentreId,
    locationText: initialLocationText,
    date: "",
    time: "",
    capacity: 4,
    priceCents: "",
    soloFriendly: false,
    skillLevel: "",
    minParticipants: "",
    confirmationDeadline: "",
    description: "",
    durationMinutes: "",
    equipmentNeeded: "",
    minAge: "",
    surfaceType: "",
    indoorOutdoor: "" as "" | "indoor" | "outdoor" | "mixed",
    meetingInstructions: "",
    cancellationPolicy: "",
  });
  const [createError, setCreateError] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const setForm = (updater: SetStateAction<typeof form>) => {
    setFormRaw(updater);
    setStepError(null);
    setDirty(true);
  };
  const { requestNavigation, dialog: unsavedDialog } = useUnsavedChangesGuard(dirty);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchCentres().then(setCentres);
  }, []);

  useEffect(() => {
    if (!gameId || !resident) return;
    setLoadingGame(true);
    Promise.all([fetchGame(gameId), fetchGameParticipantsForManage(gameId)])
      .then(([game, participants]) => {
        if (game.hostResidentId !== resident.id) {
          setLoadError("Only the host can edit this game");
          return;
        }
        setFormRaw({
          activityLabel: game.activityLabel,
          centreId: game.centreId ?? "",
          locationText: game.locationText ?? "",
          date: game.date,
          time: game.time,
          capacity: game.capacity,
          priceCents: game.priceCents ? String(game.priceCents / 100) : "",
          soloFriendly: game.soloFriendly,
          skillLevel: game.skillLevel ?? "",
          minParticipants: game.minParticipants ? String(game.minParticipants) : "",
          confirmationDeadline: game.confirmationDeadline ? isoToDatetimeLocal(game.confirmationDeadline) : "",
          description: game.description ?? "",
          durationMinutes: game.durationMinutes ? String(game.durationMinutes) : "",
          equipmentNeeded: game.equipmentNeeded ?? "",
          minAge: game.minAge ? String(game.minAge) : "",
          surfaceType: game.surfaceType ?? "",
          indoorOutdoor: (game.indoorOutdoor as "" | "indoor" | "outdoor" | "mixed") ?? "",
          meetingInstructions: game.meetingInstructions ?? "",
          cancellationPolicy: game.cancellationPolicy ?? "",
        });
        setPriceLocked(participants.some((p) => p.residentId !== resident.id && (p.status === "joined" || p.status === "pending_payment")));
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Couldn't load this game"))
      .finally(() => setLoadingGame(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, resident?.id]);

  const goNext = () => {
    if (!form.activityLabel.trim()) return setStepError("What are you planning? Give it a name.");
    if (!form.centreId && !form.locationText.trim()) return setStepError("Add a venue or a location");
    if (!form.date) return setStepError("Pick a date");
    if (!form.time) return setStepError("Pick a time");
    setStepError(null);
    setStep(2);
  };
  const goBack = () => {
    setStepError(null);
    setStep(1);
  };

  const handleSubmit = async () => {
    setCreateError(null);
    setCreating(true);
    try {
      const input = {
        activityLabel: form.activityLabel,
        centreId: form.centreId || undefined,
        locationText: form.centreId ? undefined : form.locationText,
        date: form.date,
        time: form.time,
        capacity: form.capacity,
        priceCents: form.priceCents ? Math.round(parseFloat(form.priceCents) * 100) : undefined,
        soloFriendly: form.soloFriendly,
        skillLevel: form.skillLevel || undefined,
        minParticipants: form.minParticipants ? parseInt(form.minParticipants, 10) : undefined,
        confirmationDeadline: form.minParticipants && form.confirmationDeadline ? new Date(form.confirmationDeadline).toISOString() : undefined,
        description: form.description || undefined,
        durationMinutes: form.durationMinutes ? parseInt(form.durationMinutes, 10) : undefined,
        equipmentNeeded: form.equipmentNeeded || undefined,
        minAge: form.minAge ? parseInt(form.minAge, 10) : undefined,
        surfaceType: form.surfaceType || undefined,
        indoorOutdoor: form.indoorOutdoor || undefined,
        meetingInstructions: form.meetingInstructions || undefined,
        cancellationPolicy: form.cancellationPolicy || undefined,
        circleId,
      };
      const game = gameId ? await updateGame(gameId, input) : await createGame(input);
      setDirty(false);
      navigate(gameId ? "/manage/activities" : circleId ? `/manage/circles/${circleId}` : `/games/${game.id}`);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : `Couldn't ${gameId ? "update" : "create"} this game`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fade-panel">
      <section className="section-pad" style={{ maxWidth: 900, margin: "0 auto", padding: "36px 24px 90px" }}>
        <BackLink onClick={() => requestNavigation(() => navigate(-1))}>Back</BackLink>

        {resident && loadingGame ? null : resident && loadError ? (
          <div style={{ background: colors.dangerBg, border: `1px solid ${colors.danger}`, borderRadius: radius.card, padding: "16px 20px", fontSize: 14, marginTop: 20, color: colors.danger }}>
            {loadError}
          </div>
        ) : resident ? (
          step === 1 ? (
            <GuidedFlow
              title={gameId ? "Edit your game." : "Host a game."}
              subtitle="The basics — what, where, and when."
              stepLabels={STEP_LABELS}
              currentStep={1}
              accent="green"
              showBack={false}
              onBack={() => {}}
              onContinue={goNext}
              continueLabel="Continue →"
              error={stepError}
            >
              <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <label style={labelStyle}>Activity</label>
                  <input id="game-activity" value={form.activityLabel} onChange={(e) => setForm((f) => ({ ...f, activityLabel: e.target.value }))} placeholder="e.g. Badminton" style={inputStyle} autoFocus />
                </div>
                <div>
                  <label style={labelStyle}>Venue (optional)</label>
                  <select value={form.centreId} onChange={(e) => setForm((f) => ({ ...f, centreId: e.target.value }))} style={inputStyle}>
                    <option value="">Pick a location instead</option>
                    {centres.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                {!form.centreId && (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={labelStyle}>Location</label>
                    <input id="game-location" value={form.locationText} onChange={(e) => setForm((f) => ({ ...f, locationText: e.target.value }))} placeholder="e.g. Phoenix Park, main gate" style={inputStyle} />
                  </div>
                )}
                <div>
                  <label style={labelStyle}>Date</label>
                  <input id="game-date" type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Time</label>
                  <input id="game-time" type="time" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} style={inputStyle} />
                </div>
                <NumberStepper
                  label="How many players can join?"
                  helper="Including you."
                  value={form.capacity}
                  onChange={(n) => setForm((f) => ({ ...f, capacity: n }))}
                  min={2}
                />
                <div>
                  <label style={labelStyle}>Price per player (optional)</label>
                  <input
                    value={form.priceCents}
                    onChange={(e) => setForm((f) => ({ ...f, priceCents: e.target.value }))}
                    placeholder="e.g. 5"
                    style={{ ...inputStyle, maxWidth: 140 }}
                    disabled={priceLocked}
                  />
                  {priceLocked && <p style={{ fontSize: 11.5, color: colors.mutedLight, margin: "4px 0 0" }}>Locked — someone has already joined at this price.</p>}
                </div>
                <div>
                  <label style={labelStyle}>Skill level (optional)</label>
                  <select value={form.skillLevel} onChange={(e) => setForm((f) => ({ ...f, skillLevel: e.target.value }))} style={inputStyle}>
                    <option value="">Any level</option>
                    {SKILL_LEVELS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <NumberStepper
                  label="Minimum to run (optional)"
                  value={form.minParticipants ? Number(form.minParticipants) : 0}
                  onChange={(n) => setForm((f) => ({ ...f, minParticipants: n ? String(n) : "" }))}
                  min={0}
                  max={form.capacity}
                />
              </div>
              {form.minParticipants && (
                <>
                  <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "8px 0 0" }}>
                    This game stays "pending", but still joinable, until {form.minParticipants} players (including you) have joined.
                  </p>
                  <div style={{ marginTop: 10 }}>
                    <label style={labelStyle}>Confirm by (optional)</label>
                    <input
                      type="datetime-local"
                      value={form.confirmationDeadline}
                      onChange={(e) => setForm((f) => ({ ...f, confirmationDeadline: e.target.value }))}
                      style={{ ...inputStyle, maxWidth: 240 }}
                    />
                    <p style={{ fontSize: 12, color: colors.faint, margin: "4px 0 0" }}>Shown to players as a target - not automatically enforced.</p>
                  </div>
                </>
              )}
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13.5, color: colors.muted, cursor: "pointer" }}>
                <input type="checkbox" checked={form.soloFriendly} onChange={(e) => setForm((f) => ({ ...f, soloFriendly: e.target.checked }))} />
                Solo friendly - welcome someone who doesn't have a partner or group
              </label>
            </GuidedFlow>
          ) : (
            <GuidedFlow
              title="A few more details."
              subtitle="All optional — post now, or add more to help people know what to expect."
              stepLabels={STEP_LABELS}
              currentStep={2}
              accent="green"
              onBack={goBack}
              onContinue={handleSubmit}
              continueLabel={gameId ? "Save changes" : "Create game"}
              continueBusy={creating}
              error={createError}
            >
              <div>
                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>About this plan (optional)</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="What's the pace, format and vibe? e.g. A relaxed, social ride at an easy-to-moderate pace."
                    rows={3}
                    style={{ ...inputStyle, resize: "vertical" }}
                  />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>What to bring (optional)</label>
                  <textarea
                    value={form.equipmentNeeded}
                    onChange={(e) => setForm((f) => ({ ...f, equipmentNeeded: e.target.value }))}
                    placeholder="e.g. Your bike, helmet, water bottle and lights if you have them."
                    rows={2}
                    style={{ ...inputStyle, resize: "vertical" }}
                  />
                </div>
                <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 12 }}>
                  <div>
                    <label style={labelStyle}>Duration in minutes (optional)</label>
                    <input type="number" min={1} value={form.durationMinutes} onChange={(e) => setForm((f) => ({ ...f, durationMinutes: e.target.value }))} placeholder="e.g. 60" style={{ ...inputStyle, maxWidth: 140 }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Minimum age (optional)</label>
                    <input type="number" min={0} value={form.minAge} onChange={(e) => setForm((f) => ({ ...f, minAge: e.target.value }))} placeholder="e.g. 18" style={{ ...inputStyle, maxWidth: 140 }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Surface (optional)</label>
                    <input value={form.surfaceType} onChange={(e) => setForm((f) => ({ ...f, surfaceType: e.target.value }))} placeholder="e.g. Road & trail" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Indoor or outdoor (optional)</label>
                    <select value={form.indoorOutdoor} onChange={(e) => setForm((f) => ({ ...f, indoorOutdoor: e.target.value as typeof form.indoorOutdoor }))} style={inputStyle}>
                      <option value="">Not specified</option>
                      <option value="outdoor">Outdoor</option>
                      <option value="indoor">Indoor</option>
                      <option value="mixed">Mixed</option>
                    </select>
                  </div>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>Meeting instructions (optional)</label>
                  <textarea
                    value={form.meetingInstructions}
                    onChange={(e) => setForm((f) => ({ ...f, meetingInstructions: e.target.value }))}
                    placeholder="Exact meeting point — only shown to the host and joined players, e.g. Meet by the north gate, past the car park."
                    rows={2}
                    style={{ ...inputStyle, resize: "vertical" }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Cancellation policy (optional)</label>
                  <textarea
                    value={form.cancellationPolicy}
                    onChange={(e) => setForm((f) => ({ ...f, cancellationPolicy: e.target.value }))}
                    placeholder="e.g. Free to cancel any time before the day of the plan."
                    rows={2}
                    style={{ ...inputStyle, resize: "vertical" }}
                  />
                </div>
              </div>
            </GuidedFlow>
          )
        ) : (
          <div style={{ background: colors.greenBg, border: `1px solid ${colors.green}`, borderRadius: radius.card, padding: "16px 20px", fontSize: 14, marginTop: 20 }}>
            <button onClick={() => navigate(signInHref())} style={{ background: "none", border: "none", padding: 0, color: colors.greenText, fontWeight: 700, cursor: "pointer" }}>
              Sign in
            </button>{" "}
            to start a game of your own.
          </div>
        )}
      </section>
      {unsavedDialog}
    </div>
  );
}
