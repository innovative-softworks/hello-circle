import { useEffect, useState, type SetStateAction } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { createGame, fetchCentres, fetchGame, fetchGameParticipantsForManage, setGameLifecycle, updateGame } from "../api";
import { signInHref } from "../authRedirect";
import { BackLink } from "../components/BackLink";
import { GuidedFlow } from "../components/GuidedFlow";
import { NumberStepper, useUnsavedChangesGuard } from "../components/form";
import { ShareButton } from "../components/ShareButton";
import { SingleImageUpload } from "../components/SingleImageUpload";
import { CheckCircleIcon } from "../components/icons";
import { Button, Card, inputStyle, labelStyle } from "../components/ui";
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
  // Edit mode (HelloCircle Manage's /manage Activities tab) — same two-step wizard,
  // reused for an existing game instead of a new one. `/games/host` (no id)
  // stays create-only, untouched.
  const { gameId } = useParams<{ gameId: string }>();

  // "Do it again" (GameDetail.tsx) and IntentCaptureForm's "start it
  // yourself" link both carry activity/venue forward via query params.
  // HelloCircle Manage Phase 23 extended "Do it again" to also carry every
  // other "what this activity is" field (price/capacity/skill/description/
  // etc.) — date/time are still always deliberately left blank for the host
  // to re-enter (a re-host always needs a new date), same as
  // soloFriendly/minParticipants/confirmationDeadline/circleId, which stay
  // situational rather than carried over. Not applicable in edit mode, where
  // the form is instead populated from the existing game below.
  const qp = (key: string) => (gameId ? "" : searchParams.get(key) ?? "");
  const initialActivity = qp("activity");
  const initialCentreId = qp("centreId");
  const initialLocationText = qp("locationText");
  // HelloCircle Manage Phase 4 — a Circle organiser's "Create plan" deep-link
  // carries the circle id through so the new game gets tagged games.circle_id.
  // Not part of the editable `form` state — it's contextual, not a field the
  // host chooses, and isn't relevant to edit mode (a game's circle isn't
  // reassignable from this wizard).
  const circleId = gameId ? undefined : searchParams.get("circleId") ?? undefined;
  // Phase 2 "Circles V2" — a plan-idea's "Create Activity" deep-link carries
  // planId through so the server can atomically convert it (see
  // games.ts's createGameRow). Unlike the "do it again" query params above,
  // date/time genuinely SHOULD prefill here — the whole point of a
  // confirmed plan is that the circle already agreed on them (brief §20).
  const planId = gameId ? undefined : searchParams.get("planId") ?? undefined;
  const initialDate = planId ? searchParams.get("date") ?? "" : "";
  const initialTime = planId ? searchParams.get("time") ?? "" : "";

  const [step, setStep] = useState(1);
  const [centres, setCentres] = useState<Centre[]>([]);
  const [loadingGame, setLoadingGame] = useState(!!gameId);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [priceLocked, setPriceLocked] = useState(false);
  // Same client-side bulk-create pattern as VendorPrograms.tsx's Repeat
  // selector — no recurrence schema anywhere on `games`, just N individually
  // created rows with computed dates. Create-only; doesn't apply in edit mode.
  const [repeat, setRepeat] = useState<"none" | "weekly" | "biweekly" | "monthly">("none");
  const [occurrences, setOccurrences] = useState(4);
  const initialPriceCents = qp("priceCents");
  const initialIndoorOutdoor = qp("indoorOutdoor");
  const [form, setFormRaw] = useState({
    activityLabel: initialActivity,
    centreId: initialCentreId,
    locationText: initialLocationText,
    date: initialDate,
    time: initialTime,
    capacity: qp("capacity") ? Number(qp("capacity")) : 4,
    priceCents: initialPriceCents ? String(Number(initialPriceCents) / 100) : "",
    soloFriendly: false,
    skillLevel: qp("skillLevel"),
    minParticipants: "",
    confirmationDeadline: "",
    description: qp("description"),
    durationMinutes: qp("durationMinutes"),
    equipmentNeeded: qp("equipmentNeeded"),
    minAge: qp("minAge"),
    surfaceType: qp("surfaceType"),
    indoorOutdoor: (initialIndoorOutdoor === "indoor" || initialIndoorOutdoor === "outdoor" || initialIndoorOutdoor === "mixed" ? initialIndoorOutdoor : "") as "" | "indoor" | "outdoor" | "mixed",
    meetingInstructions: qp("meetingInstructions"),
    cancellationPolicy: qp("cancellationPolicy"),
    imageUrl: null as string | null,
    lifecycle: "active" as "draft" | "coming_soon" | "active" | "paused" | "archived",
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
  // Host Experience Polish — a brief "You're live." confirmation instead of
  // silently navigating away after a plain create. Only for the plain path:
  // a plan-idea conversion returns to the Circle (see the comment at its
  // navigate() call below) and a circleId-only create returns to Manage's
  // Circles tab — both already land somewhere with their own confirmation
  // context, so this state stays null on those paths.
  const [justCreated, setJustCreated] = useState<{ id: string } | null>(null);
  const [justCreatedImageUrl, setJustCreatedImageUrl] = useState<string | null>(null);

  useEffect(() => {
    fetchCentres().then(setCentres);
  }, []);

  useEffect(() => {
    if (!gameId || !resident) return;
    setLoadingGame(true);
    Promise.all([fetchGame(gameId), fetchGameParticipantsForManage(gameId)])
      .then(([game, participants]) => {
        if (game.hostResidentId !== resident.id) {
          setLoadError("Only the host can edit this session");
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
          imageUrl: game.imageUrl ?? null,
          lifecycle: game.lifecycle,
        });
        setPriceLocked(participants.some((p) => p.residentId !== resident.id && (p.status === "joined" || p.status === "pending_payment")));
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Couldn't load this session"))
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
      const baseInput = {
        activityLabel: form.activityLabel,
        centreId: form.centreId || undefined,
        locationText: form.centreId ? undefined : form.locationText,
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
        planId,
        // The radio control (below) only ever sets one of these three
        // values, and is hidden entirely in edit mode — the wider type on
        // form.lifecycle exists only so loading an existing (possibly
        // paused/archived) game into the form for display doesn't need a
        // separate field.
        lifecycle: gameId ? undefined : (form.lifecycle as "draft" | "coming_soon" | "active"),
      };
      if (gameId) {
        // "" (not undefined) when cleared — the edit form always loads and
        // resubmits the current value, so there's no "untouched" case to
        // preserve via COALESCE here; an explicit empty string is what
        // actually clears the cover (see games.ts's PUT /:id).
        await updateGame(gameId, { ...baseInput, date: form.date, imageUrl: form.imageUrl ?? "" });
        setDirty(false);
        navigate("/manage?tab=activities");
        return;
      }
      const count = repeat === "none" ? 1 : Math.max(1, Math.min(52, occurrences));
      let firstGame: { id: string } | null = null;
      for (let i = 0; i < count; i++) {
        const d = new Date(`${form.date}T00:00:00`);
        if (repeat === "weekly") d.setDate(d.getDate() + 7 * i);
        else if (repeat === "biweekly") d.setDate(d.getDate() + 14 * i);
        else if (repeat === "monthly") d.setMonth(d.getMonth() + i);
        const occurrenceDate = d.toISOString().slice(0, 10);
        const game = await createGame({ ...baseInput, date: occurrenceDate });
        if (i === 0) firstGame = game;
      }
      setDirty(false);
      // Converting a plan-idea returns to the public Circle page (where the
      // plan now shows "Activity ready"), not the organiser's Manage tool —
      // this is the community-facing flow, distinct from circleId-only
      // creation via Manage's own "Create a plan" button. Only the plain
      // create path (no circleId/planId) gets the "You're live." confirmation
      // — the other two paths already land somewhere with their own context.
      if (planId) navigate(`/circles/${circleId}`);
      else if (circleId) navigate(`/manage/circles/${circleId}`);
      else setJustCreated(firstGame);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : `Couldn't ${gameId ? "update" : "create"} this session — any earlier occurrences in this batch were still created`);
    } finally {
      setCreating(false);
    }
  };

  // SingleImageUpload on the "You're live." card uploads straight to R2 and
  // hands back a url, but (unlike the edit form above) there's no later
  // save step on this screen to persist it — so this attaches it right
  // away via the same updateGame() the edit path uses, resending the
  // fields the just-created game already has (form state is untouched
  // between create and this screen).
  const handleJustCreatedImageChange = async (url: string | null) => {
    if (!justCreated) return;
    setJustCreatedImageUrl(url);
    await updateGame(justCreated.id, {
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
      description: form.description || undefined,
      durationMinutes: form.durationMinutes ? parseInt(form.durationMinutes, 10) : undefined,
      equipmentNeeded: form.equipmentNeeded || undefined,
      minAge: form.minAge ? parseInt(form.minAge, 10) : undefined,
      surfaceType: form.surfaceType || undefined,
      indoorOutdoor: form.indoorOutdoor || undefined,
      meetingInstructions: form.meetingInstructions || undefined,
      cancellationPolicy: form.cancellationPolicy || undefined,
      imageUrl: url ?? "",
    });
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
          justCreated ? (
            <Card style={{ maxWidth: 480, margin: "40px auto 0", textAlign: "center", padding: "36px 28px" }}>
              <CheckCircleIcon size={36} style={{ color: colors.greenText }} />
              <h2 style={{ margin: "14px 0 4px" }}>You're live.</h2>
              <p style={{ fontSize: 14, color: colors.muted, margin: "0 0 22px" }}>
                {form.activityLabel} is posted — share it to help fill it up.
              </p>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
                <SingleImageUpload
                  value={justCreatedImageUrl}
                  onChange={handleJustCreatedImageChange}
                  mediaEntityType="activity-cover"
                  mediaEntityId={justCreated.id}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "stretch" }}>
                <ShareButton entityType="game" entityId={justCreated.id} label="Share" variant="primary" />
                <Button
                  variant="ghost"
                  onClick={() => {
                    setJustCreated(null);
                    setJustCreatedImageUrl(null);
                    setStepError(null);
                    setFormRaw((f) => ({ ...f, date: "", time: "" }));
                    setStep(1);
                  }}
                >
                  Add another date
                </Button>
                <Button variant="ghost" onClick={() => navigate(`/games/${justCreated.id}`)}>Manage activity</Button>
              </div>
            </Card>
          ) : step === 1 ? (
            <GuidedFlow
              title={gameId ? "Edit your session." : "Host a session."}
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
                {!gameId && !planId && (
                  <div>
                    <label style={labelStyle}>Repeat (optional)</label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <select value={repeat} onChange={(e) => setRepeat(e.target.value as typeof repeat)} style={inputStyle}>
                        <option value="none">Doesn't repeat</option>
                        <option value="weekly">Every week</option>
                        <option value="biweekly">Every 2 weeks</option>
                        <option value="monthly">Monthly</option>
                      </select>
                      {repeat !== "none" && (
                        <input
                          type="number"
                          min={1}
                          max={52}
                          value={occurrences}
                          onChange={(e) => setOccurrences(Number(e.target.value))}
                          placeholder="Times"
                          style={{ ...inputStyle, maxWidth: 90 }}
                        />
                      )}
                    </div>
                    {repeat !== "none" && (
                      <p style={{ fontSize: 11.5, color: colors.mutedLight, margin: "4px 0 0" }}>
                        Creates {Math.max(1, Math.min(52, occurrences))} separate sessions, starting {form.date || "on the date above"} — each is editable/cancellable on its own.
                      </p>
                    )}
                  </div>
                )}
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
              {gameId && (
                <div style={{ marginTop: 14 }}>
                  <SingleImageUpload
                    value={form.imageUrl}
                    onChange={(url) => setForm((f) => ({ ...f, imageUrl: url }))}
                    mediaEntityType="activity-cover"
                    mediaEntityId={gameId}
                  />
                </div>
              )}
              {gameId && (
                <PublishingStatusPanel
                  lifecycle={form.lifecycle}
                  onChange={async (next) => {
                    await setGameLifecycle(gameId, next);
                    setForm((f) => ({ ...f, lifecycle: next }));
                  }}
                />
              )}
              {form.minParticipants && (
                <>
                  <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "8px 0 0" }}>
                    This session stays "pending", but still joinable, until {form.minParticipants} players (including you) have joined.
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
              continueLabel={gameId ? "Save changes" : repeat === "none" ? "Create session" : `Create ${Math.max(1, Math.min(52, occurrences))} sessions`}
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
                {!gameId && (
                  <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${colors.border}` }}>
                    <label style={labelStyle}>Publishing</label>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {(
                        [
                          { value: "active" as const, title: "Publish now", body: "Make this live and available to book right away." },
                          { value: "coming_soon" as const, title: "Coming soon", body: "Show this publicly, but bookings open later — you can open them any time from Manage." },
                          { value: "draft" as const, title: "Save as draft", body: "Only you can see this until you publish it." },
                        ]
                      ).map((opt) => (
                        <label
                          key={opt.value}
                          style={{
                            display: "flex",
                            gap: 10,
                            alignItems: "flex-start",
                            border: `1px solid ${form.lifecycle === opt.value ? colors.green : colors.border}`,
                            borderRadius: radius.control,
                            padding: "10px 12px",
                            cursor: "pointer",
                            background: form.lifecycle === opt.value ? colors.greenBg : "transparent",
                          }}
                        >
                          <input type="radio" name="lifecycle" checked={form.lifecycle === opt.value} onChange={() => setForm((f) => ({ ...f, lifecycle: opt.value }))} style={{ marginTop: 3 }} />
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 13.5 }}>{opt.title}</div>
                            <div style={{ fontSize: 12.5, color: colors.mutedLight }}>{opt.body}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </GuidedFlow>
          )
        ) : (
          <div style={{ background: colors.greenBg, border: `1px solid ${colors.green}`, borderRadius: radius.card, padding: "16px 20px", fontSize: 14, marginTop: 20 }}>
            <button onClick={() => navigate(signInHref())} style={{ background: "none", border: "none", padding: 0, color: colors.greenText, fontWeight: 700, cursor: "pointer" }}>
              Sign in
            </button>{" "}
            to host a session of your own.
          </div>
        )}
      </section>
      {unsavedDialog}
    </div>
  );
}

// §27/§31 — manual override for an existing activity's publishing state.
// Deliberately compact (not the full "STATUS / Public since … / Bookings
// open …" mockup from §31) — just the current state plus whichever actions
// are actually valid from it, reusing the exact same transition rules the
// server enforces (POST /:id/lifecycle) so this never offers a button that
// would 409. Cancel/Archive aren't offered here — those already have their
// own dedicated, confirmed flows elsewhere (GameJoinCard's "Cancel this
// session"), and §29 wants real participant-count confirmation UX for a
// dangerous transition that this compact panel isn't the place to build.
function PublishingStatusPanel({ lifecycle, onChange }: { lifecycle: "draft" | "coming_soon" | "active" | "paused" | "archived"; onChange: (next: "draft" | "coming_soon" | "active" | "paused") => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = statusLabel[lifecycle];

  const act = async (next: "draft" | "coming_soon" | "active" | "paused") => {
    setBusy(true);
    setError(null);
    try {
      await onChange(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update the publishing state");
    } finally {
      setBusy(false);
    }
  };

  const actions: { next: "draft" | "coming_soon" | "active" | "paused"; label: string }[] =
    lifecycle === "draft" ? [{ next: "coming_soon", label: "Announce (Coming soon)" }, { next: "active", label: "Publish now" }]
    : lifecycle === "coming_soon" ? [{ next: "active", label: "Open bookings now" }]
    : lifecycle === "active" ? [{ next: "paused", label: "Pause bookings" }]
    : lifecycle === "paused" ? [{ next: "active", label: "Resume bookings" }]
    : [];

  return (
    <div style={{ marginTop: 14, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase", color: colors.mutedLight, marginBottom: 6 }}>Status</div>
      <div style={{ fontWeight: 700, marginBottom: actions.length ? 10 : 0 }}>{label}</div>
      {error && <p style={{ color: colors.danger, fontSize: 12.5, margin: "0 0 8px" }}>{error}</p>}
      {actions.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {actions.map((a) => (
            <Button key={a.next} variant="ghost" disabled={busy} onClick={() => act(a.next)}>
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

const statusLabel: Record<"draft" | "coming_soon" | "active" | "paused" | "archived", string> = {
  draft: "Draft — only you can see this",
  coming_soon: "Coming soon — public, bookings not open yet",
  active: "Live",
  paused: "Bookings paused",
  archived: "Archived",
};
