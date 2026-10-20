import { useEffect, useState, type SetStateAction } from "react";
import { useSearchParams } from "react-router-dom";
import { VendorParticipationEditor } from "./VendorParticipationEditor";
import {
  addProgramSession,
  createVendorProgram,
  deleteVendorProgram,
  fetchProgramEnrollments,
  fetchSessionAttendance,
  fetchVendorProgram,
  fetchVendorPrograms,
  fetchVendorRooms,
  fetchVendorScheduleItems,
  markSessionAttendance,
  removeProgramSession,
  updateVendorProgram,
  type ProgramEnrollment,
} from "../api";
import { CalendarIcon, PlusIcon, TrashIcon, UsersIcon } from "./icons";
import { SingleImageUpload } from "./SingleImageUpload";
import { VendorCheckInScreen } from "./VendorCheckInScreen";
import { DraftBanner, FieldError, FieldLabel, FormErrorSummary, RequiredNote, useFormDraft, useFormErrors } from "./form";
import { MonthCalendar } from "./MonthCalendar";
import { CalendarDays, GraduationCap, List, UsersRound } from "lucide-react";
import { ActionMenu } from "./ActionMenu";
import { dateLabel } from "../euro";
import { StatusChipText, WsListTable } from "./workspace/WsListTable";
import { formatDate } from "../vendorFormat";
import { AdminButton, AdminModal, Box, ErrorMessage, FormField, IconTabs, LoadingRows, Loaded, useAdminData } from "./admin/adminUi";
import { SourceTypeBadge, StatusPill } from "./VendorOverviewCards";
import { Button, ManageCard as Card, ConfirmDialog, EmptyState, inputStyle, labelStyle } from "./ui";
import { ACTIVITY_CATEGORIES, ATTENDANCE_STATUSES, ATTENDANCE_STATUS_LABELS, PROGRAM_STATUSES, SKILL_LEVELS } from "../constants";
import { formatScheduleCount, formatScheduleWhen, manageTargetFor, scheduleItemDateKey, todayDateKey, type VendorScheduleNavTarget } from "../vendorSchedule";
import { colors, fonts, radius } from "../theme";
import type { AttendanceStatus, Program, ProgramStatus, Room, VendorProgramSummary, VendorScheduleItem } from "../types";
import { formatPrice } from "../formatters";
import { irelandToday, occurrenceDates } from "../irelandDate";
import { DetailStats } from "./workspace/DetailParts";
import { PaidClosedPriceNotice } from "./PaidClosedPriceNotice";

const ATTENDANCE_STATUS_COLORS: Record<AttendanceStatus, { fg: string; bg: string }> = {
  present: { fg: colors.greenText, bg: colors.greenBg },
  late: { fg: "#9A6B00", bg: "#FFF3D6" },
  absent: { fg: colors.orangeDark, bg: colors.orangeBg },
  no_show: { fg: colors.danger, bg: colors.dangerBg },
  cancelled: { fg: colors.muted, bg: colors.panel },
};

// Program wizard + session/attendance management (Phase B) — the vendor
// side of the new Activity/Session model. Deliberately a plain create form
// + inline session list rather than a multi-step wizard — the fields are
// few enough that progressive disclosure isn't earning its complexity yet.

export function ProgramManager({ programId, onChanged }: { programId: string; onChanged: () => void }) {
  const [program, setProgram] = useState<Program | null>(null);
  const [enrollmentsState, setEnrollmentsState] = useState<{ rows: ProgramEnrollment[] | null; error: unknown }>({ rows: null, error: null });
  const enrollments = enrollmentsState.rows ?? [];
  const [programError, setProgramError] = useState<unknown>(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [duration, setDuration] = useState(60);
  const [capacity, setCapacity] = useState("");
  const [sessionInstructor, setSessionInstructor] = useState("");
  const [sessionRoomId, setSessionRoomId] = useState("");
  // Host Manage spec §17's recurring activities — no RRULE/interval column
  // exists on program_sessions (each is a plain, individually-created row,
  // see db/index.ts), and program_enrollments enrolls per-*program* not
  // per-session, so there's no per-session booking scope to split "this vs
  // future vs series" by. This is a client-side convenience only: bulk-call
  // the existing single-session endpoint N times with computed dates —
  // real individual rows, no new schema.
  const [repeat, setRepeat] = useState<"none" | "weekly" | "biweekly" | "monthly">("none");
  const [occurrences, setOccurrences] = useState(4);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [attendance, setAttendance] = useState<Record<string, Record<string, AttendanceStatus>>>({});
  const [error, setError] = useState<string | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const [confirmingSessionId, setConfirmingSessionId] = useState<string | null>(null);
  const [checkingInSession, setCheckingInSession] = useState<{ id: string; date: string; time: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const loadEnrollments = () => {
    setEnrollmentsState((prev) => ({ rows: prev.rows, error: null }));
    fetchProgramEnrollments(programId)
      .then((rows) => setEnrollmentsState({ rows, error: null }))
      .catch((error) => setEnrollmentsState({ rows: null, error }));
  };
  const load = () => {
    setProgramError(null);
    fetchVendorProgram(programId)
      .then((p) => {
        setProgram(p);
        // Rooms only fill the session form's room picker.
        if (p.listingType === "centre") fetchVendorRooms(p.listingId).then(setRooms).catch(() => {});
      })
      .catch(setProgramError);
    loadEnrollments();
  };
  useEffect(load, [programId]);

  const setStatus = async (status: ProgramStatus) => {
    setStatusSaving(true);
    try {
      await updateVendorProgram(programId, { status });
      load();
      onChanged();
    } finally {
      setStatusSaving(false);
    }
  };

  const addSession = async () => {
    if (!date) return;
    setError(null);
    try {
      const count = repeat === "none" ? 1 : Math.max(1, Math.min(52, occurrences));
      // HC-QA-100 — calendar arithmetic on the picked date; never via local midnight.
      const dates = occurrenceDates(date, repeat, count);
      for (let i = 0; i < dates.length; i++) {
        const occurrenceDate = dates[i];
        await addProgramSession(programId, {
          date: occurrenceDate,
          time,
          durationMinutes: duration,
          capacity: capacity ? Number(capacity) : undefined,
          instructorName: sessionInstructor || undefined,
          roomId: sessionRoomId || undefined,
        });
      }
      setDate("");
      setSessionInstructor("");
      setSessionRoomId("");
      setRepeat("none");
      setOccurrences(4);
      setAddOpen(false);
      load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that session — any earlier occurrences in this batch were still created");
    }
  };

  const removeSession = async (sessionId: string) => {
    setError(null);
    try {
      await removeProgramSession(programId, sessionId);
      load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove that session");
    } finally {
      setConfirmingSessionId(null);
    }
  };

  const loadAttendance = async (sessionId: string) => {
    const rows = await fetchSessionAttendance(programId, sessionId);
    const byEnrollment: Record<string, AttendanceStatus> = {};
    for (const r of rows) byEnrollment[r.enrollmentId] = r.status;
    setAttendance((a) => ({ ...a, [sessionId]: byEnrollment }));
  };

  const setAttendanceStatus = async (sessionId: string, enrollmentId: number, status: AttendanceStatus) => {
    setError(null);
    try {
      await markSessionAttendance(sessionId, enrollmentId, status);
      loadAttendance(sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't mark attendance");
    }
  };

  if (programError && !program) return <ErrorMessage error={programError} onRetry={load} title="Couldn't load this programme" />;
  if (!program) return <LoadingRows rows={5} label="Loading programme" />;

  const STATUS_LABEL: Record<ProgramStatus, string> = { draft: "Draft", published: "Published", paused: "Paused", archived: "Archived" };
  const sessionCount = repeat === "none" ? 1 : Math.max(1, Math.min(52, occurrences));

  // Option A (2026-10-16): sessions and enrolments as panels, status / cover /
  // facts in the rail, adding sessions in a popup. Key numbers above (2026-10-20).
  const upcomingSessions = program.sessions.filter((x) => x.date >= irelandToday());
  return (
    <>
    <DetailStats
      items={[
        { label: "Enrolled", value: `${program.enrolled} / ${program.capacity}`, sub: `${program.spotsLeft} places left` },
        { label: "Price", value: program.priceCents ? `€${(program.priceCents / 100).toFixed(2)}` : "Free", sub: "for the course" },
        { label: "Sessions", value: String(program.sessions.length), sub: `${upcomingSessions.length} still to come` },
        { label: "Next session", value: upcomingSessions[0] ? dateLabel(upcomingSessions[0].date) : "—", sub: upcomingSessions[0]?.time },
      ]}
    />
    <div className="ws-editor">
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        {error && (
          <p role="alert" className="ws-sec-errors" style={{ margin: 0 }}>
            {error}
          </p>
        )}
        <Box
          flush
          icon={CalendarDays}
          title={`Sessions · ${program.sessions.length}`}
          subtitle="One sign-up covers every session."
          actions={
            <AdminButton size="sm" variant="primary" onClick={() => setAddOpen(true)}>
              <PlusIcon size={13} /> Add sessions
            </AdminButton>
          }
        >
          {program.sessions.length === 0 ? (
            <EmptyState icon={<CalendarDays size={20} />} title="No sessions yet" subtitle="Add the dates people will come. You can repeat one weekly." />
          ) : (
            <ul className="adm-ov-list">
              {program.sessions.map((s) => (
                <li key={s.id} className="ws-prog-session">
                  <div className="adm-ov-row ws-sched-row" style={{ gridTemplateColumns: "170px minmax(0,1fr) auto 40px", borderBottom: attendance[s.id] ? "none" : undefined }}>
                    <span className="ws-sched-when">
                      {dateLabel(s.date)} · {s.time}
                    </span>
                    <div className="adm-ov-main">
                      <div className="adm-ov-title" style={{ fontWeight: 600 }}>
                        {s.durationMinutes} min
                      </div>
                      <div className="adm-ov-detail">{[s.instructorName, s.roomName].filter(Boolean).join(" · ") || "No instructor or room set"}</div>
                    </div>
                    <AdminButton size="sm" onClick={() => setCheckingInSession({ id: s.id, date: s.date, time: s.time })}>
                      Check-in
                    </AdminButton>
                    <ActionMenu
                      label={`More actions for the ${s.date} session`}
                      buttonText=""
                      className="ws-icon-menu"
                      items={[
                        { label: attendance[s.id] ? "Refresh attendance" : "Mark attendance", onSelect: () => loadAttendance(s.id) },
                        { label: "Remove session…", danger: true, onSelect: () => setConfirmingSessionId(s.id) },
                      ]}
                    />
                  </div>
                  {attendance[s.id] && (
                    <div className="ws-attendance">
                      {enrollments.length === 0 && <span className="adm-note">No one has enrolled yet.</span>}
                      {enrollments.map((e) => {
                        const status = attendance[s.id][String(e.id)];
                        return (
                          <div key={e.id} className="ws-attendance-row">
                            <span>{e.participantName}</span>
                            <div className="ws-seg" role="group" aria-label={`Attendance for ${e.participantName}`}>
                              {ATTENDANCE_STATUSES.map((st) => (
                                <button key={st} type="button" aria-pressed={status === st} onClick={() => setAttendanceStatus(s.id, e.id, st)}>
                                  {ATTENDANCE_STATUS_LABELS[st]}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Box>

        <Box flush icon={UsersRound} title={enrollmentsState.rows ? `Enrolments · ${enrollments.length}` : "Enrolments"}>
          {enrollmentsState.error ? (
            <ErrorMessage error={enrollmentsState.error} onRetry={loadEnrollments} title="Couldn't load enrolments" />
          ) : !enrollmentsState.rows ? (
            <LoadingRows rows={3} label="Loading enrolments" />
          ) : enrollments.length === 0 ? (
            <EmptyState icon={<UsersRound size={20} />} title="No enrolments yet" subtitle="People who sign up show here, with what they paid." />
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table adm-table--stack">
                <caption className="adm-visually-hidden">Enrolments</caption>
                <thead>
                  <tr>
                    <th scope="col">Participant</th>
                    <th scope="col">Email</th>
                    <th scope="col" className="adm-num">
                      Paid
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {enrollments.map((e) => (
                    <tr key={e.id}>
                      <td data-label="Participant">{e.participantName}</td>
                      <td data-label="Email" style={{ color: "var(--adm-muted)" }}>
                        {e.email}
                      </td>
                      <td data-label="Paid" className="adm-num" style={{ fontWeight: 700 }}>
                        €{(e.totalCents / 100).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Box>

        <VendorParticipationEditor type="program" id={programId} />
      </div>

      <aside className="ws-rail">
        <div className="adm-box ws-rail-card">
          <label htmlFor="program-status" style={{ fontWeight: 700, display: "block", marginBottom: 8 }}>
            Status
          </label>
          <select id="program-status" className="adm-select" value={program.status} disabled={statusSaving} onChange={(e) => setStatus(e.target.value as ProgramStatus)} style={{ width: "100%" }}>
            {!PROGRAM_STATUSES.includes(program.status as (typeof PROGRAM_STATUSES)[number]) && <option value={program.status}>{program.status}</option>}
            {PROGRAM_STATUSES.map((st) => (
              <option key={st} value={st}>
                {STATUS_LABEL[st]}
              </option>
            ))}
          </select>
          <p className="adm-note" style={{ margin: "8px 0 0" }}>
            {program.status === "draft"
              ? "Not visible to people yet. Publish when it's ready."
              : program.status === "published"
                ? "Visible, and people can sign up."
                : program.status === "paused"
                  ? "Visible, but sign-ups are closed."
                  : "Hidden. Enrolments and attendance are kept."}
          </p>
        </div>
        <div className="adm-box ws-rail-card">
          <SingleImageUpload
            value={program.imageUrl || null}
            onChange={async (url) => {
              await updateVendorProgram(programId, { imageUrl: url ?? "" });
              load();
            }}
            mediaEntityType="program-cover"
            mediaEntityId={programId}
          />
        </div>
        <div className="adm-box ws-rail-card ws-facts">
          <strong style={{ display: "block", marginBottom: 6 }}>Who it's for</strong>
          <div>
            <span>Ages</span>
            {program.ageRange || "Any age"}
          </div>
          {program.skillLevel && (
            <div>
              <span>Level</span>
              {program.skillLevel}
            </div>
          )}
          {program.instructorName && (
            <div>
              <span>Instructor</span>
              {program.instructorName}
            </div>
          )}
        </div>
      </aside>

      <AdminModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        dirty={!!date}
        wide
        title="Add sessions"
        subtitle="Repeat a session to add several dates at once."
        footer={
          <>
            <AdminButton variant="quiet" onClick={() => setAddOpen(false)}>
              Cancel
            </AdminButton>
            <AdminButton variant="primary" disabled={!date} onClick={addSession}>
              {sessionCount === 1 ? "Add session" : `Add ${sessionCount} sessions`}
            </AdminButton>
          </>
        }
      >
        <div className="adm-dlg-grid">
          <FormField label="Date" required>
            {(p) => <input {...p} type="date" className="adm-input" value={date} onChange={(e) => setDate(e.target.value)} />}
          </FormField>
          <FormField label="Starts at">
            {(p) => <input {...p} type="time" className="adm-input" value={time} onChange={(e) => setTime(e.target.value)} />}
          </FormField>
          <FormField label="Length (minutes)">
            {(p) => <input {...p} type="number" min={5} className="adm-input" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />}
          </FormField>
          <FormField label="Places (optional)">
            {(p) => <input {...p} type="number" min={1} className="adm-input" placeholder="Same as the programme" value={capacity} onChange={(e) => setCapacity(e.target.value)} />}
          </FormField>
          <FormField label="Instructor (optional)">
            {(p) => <input {...p} className="adm-input" value={sessionInstructor} onChange={(e) => setSessionInstructor(e.target.value)} />}
          </FormField>
          {program.listingType === "centre" && (
            <FormField label="Room (optional)">
              {(p) => (
                <select {...p} className="adm-select" value={sessionRoomId} onChange={(e) => setSessionRoomId(e.target.value)}>
                  <option value="">No room set</option>
                  {rooms
                    .filter((r) => r.active)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              )}
            </FormField>
          )}
          <FormField label="Repeat">
            {(p) => (
              <select {...p} className="adm-select" value={repeat} onChange={(e) => setRepeat(e.target.value as typeof repeat)}>
                <option value="none">Doesn't repeat</option>
                <option value="weekly">Every week</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="monthly">Monthly</option>
              </select>
            )}
          </FormField>
          {repeat !== "none" && (
            <FormField label="How many sessions">
              {(p) => <input {...p} type="number" min={1} max={52} className="adm-input" value={occurrences} onChange={(e) => setOccurrences(Number(e.target.value))} />}
            </FormField>
          )}
        </div>
      </AdminModal>

      <ConfirmDialog
        open={confirmingSessionId !== null}
        title="Remove this session?"
        message="Anyone already enrolled in the program is unaffected — this only removes the one date/time from the schedule."
        confirmLabel="Remove session"
        onConfirm={() => confirmingSessionId && removeSession(confirmingSessionId)}
        onCancel={() => setConfirmingSessionId(null)}
      />
      <VendorCheckInScreen programId={programId} session={checkingInSession} onClose={() => setCheckingInSession(null)} />
    </div>
    </>
  );
}

// --- create form — its own page (VendorProgramEditPage.tsx) when id is
// "new"; a plain create form here rather than a Drawer since it's the
// pre-cursor to the sessions/attendance/enrollments management view below,
// which already needs the room a full page gives it. -----------------------

/** A numbered panel in a create form (option A). `collapsible` starts closed. */
function FormPanel({ n, title, note, collapsible, children }: { n: number; title: string; note?: string; collapsible?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!collapsible);
  return (
    <section className="ws-sec" aria-label={title}>
      <div className="ws-sec-head">
        <span className="adm-itile" aria-hidden="true" style={{ fontWeight: 700 }}>
          {n}
        </span>
        <h2 className="ws-sec-title">{title}</h2>
        {note && <span className="adm-note">{note}</span>}
        {collapsible && (
          <AdminButton size="sm" variant="quiet" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? "Hide" : "Add"}
          </AdminButton>
        )}
      </div>
      {open && <div className="ws-sec-body">{children}</div>}
    </section>
  );
}

export function ProgramCreateForm({
  listings,
  onCreated,
  onDirtyChange,
}: {
  listings: { centres: { id: string; name: string }[]; clubs: { id: string; name: string }[] };
  onCreated: (id: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [creating, setCreating] = useState(false);
  const fe = useFormErrors();
  // Release 6 — "Create a program" from a Host Opportunity prefills the
  // activity; read once, not synced.
  const [searchParams] = useSearchParams();
  const fromDemand = searchParams.get("fromDemand") ?? undefined;
  const [form, setFormRaw] = useState({
    listingType: "centre" as "centre" | "club",
    listingId: "",
    title: searchParams.get("title") ?? "",
    description: "",
    ageRange: "",
    priceCents: "",
    capacity: "",
    category: searchParams.get("category") ?? "",
    skillLevel: "",
    instructorName: "",
    guardianRules: "",
    safeguardingInfo: "",
  });
  // See HostGamePage.tsx's identical wrapper — clears a stale FormErrorSummary
  // the moment the user edits anything, instead of it lingering until the
  // next submit attempt re-validates.
  const [touched, setTouched] = useState(false);
  const setForm = (updater: SetStateAction<typeof form>, fieldId?: string) => {
    setFormRaw(updater);
    if (fieldId) fe.clearField(fieldId);
    setTouched(true);
    onDirtyChange?.(true);
  };
  const [equipmentText, setEquipmentTextRaw] = useState("");
  const setEquipmentText = (v: string) => {
    setEquipmentTextRaw(v);
    setTouched(true);
    onDirtyChange?.(true);
  };
  // What's typed survives a reload (this browser only) until it's created.
  const draft = useFormDraft({
    key: "program:new",
    value: { form, equipmentText },
    active: touched,
    onRestore: (v) => {
      setFormRaw(v.form);
      setEquipmentTextRaw(v.equipmentText);
      onDirtyChange?.(true);
    },
  });

  const options = form.listingType === "centre" ? listings.centres : listings.clubs;

  const create = async () => {
    const errors: { field: string; message: string; fieldId: string }[] = [];
    if (!form.listingId) errors.push({ field: "listingId", message: "Choose which listing this program attaches to", fieldId: "program-listing" });
    if (!form.title.trim()) errors.push({ field: "title", message: "Title is required", fieldId: "program-title" });
    if (!form.description.trim()) errors.push({ field: "description", message: "Description is required", fieldId: "program-description" });
    if (errors.length > 0) return fe.fail(errors);
    if (creating) return;

    fe.clear();
    setCreating(true);
    try {
      const created = await createVendorProgram({
        fromDemand,
        listingType: form.listingType,
        listingId: form.listingId,
        title: form.title,
        description: form.description,
        ageRange: form.ageRange,
        priceCents: form.priceCents ? Math.round(parseFloat(form.priceCents) * 100) : 0,
        capacity: form.capacity ? Number(form.capacity) : null,
        category: form.category,
        skillLevel: form.skillLevel,
        equipment: equipmentText.split("\n").map((s) => s.trim()).filter(Boolean),
        instructorName: form.instructorName,
        guardianRules: form.guardianRules,
        safeguardingInfo: form.safeguardingInfo,
      });
      onDirtyChange?.(false);
      draft.clear();
      onCreated(created.id);
    } catch (e) {
      // Everything typed stays in the form; the reason goes in the summary.
      fe.fail([{ field: "save", message: `Couldn't create the programme: ${e instanceof Error ? e.message : "please try again"}` }]);
    } finally {
      setCreating(false);
    }
  };

  const venueName = (form.listingType === "centre" ? listings.centres : listings.clubs).find((o) => o.id === form.listingId)?.name;
  const price = form.priceCents ? parseFloat(form.priceCents) : 0;

  // Option A (2026-10-16): the fields in four numbered panels, with a live
  // preview of the programme card on the right.
  return (
    <div className="ws-editor">
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        {draft.pending && <DraftBanner savedAt={draft.pending.savedAt} onRestore={draft.restore} onDiscard={draft.clear} />}
        <RequiredNote />
        <FormPanel n={1} title="What it is" note="Where it runs and what people will do.">
          <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <FieldLabel htmlFor="program-listing" required>Runs at</FieldLabel>
              <select
                {...fe.control("program-listing")}
                required
                value={form.listingId ? `${form.listingType}:${form.listingId}` : ""}
                onChange={(e) => {
                  const [listingType, listingId] = e.target.value.split(":") as ["centre" | "club", string];
                  setForm((f) => ({ ...f, listingType: listingType || f.listingType, listingId: listingId ?? "" }), "program-listing");
                }}
                style={inputStyle}
              >
                <option value="">Choose a centre or club</option>
                {listings.centres.length > 0 && (
                  <optgroup label="Centres">
                    {listings.centres.map((o) => (
                      <option key={o.id} value={`centre:${o.id}`}>{o.name}</option>
                    ))}
                  </optgroup>
                )}
                {listings.clubs.length > 0 && (
                  <optgroup label="Clubs">
                    {listings.clubs.map((o) => (
                      <option key={o.id} value={`club:${o.id}`}>{o.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              <FieldError fieldId="program-listing" message={fe.messageFor("program-listing")} />
            </div>
            <div>
              <FieldLabel htmlFor="program-category" optional>Category</FieldLabel>
              <select id="program-category" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} style={inputStyle}>
                <option value="">None</option>
                {ACTIVITY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <FieldLabel htmlFor="program-title" required>Title</FieldLabel>
              <input {...fe.control("program-title")} required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }), "program-title")} placeholder="e.g. Beginners' yoga, 8 weeks" style={inputStyle} />
              <FieldError fieldId="program-title" message={fe.messageFor("program-title")} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <FieldLabel htmlFor="program-description" required>Description</FieldLabel>
              <textarea {...fe.control("program-description")} required value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }), "program-description")} rows={3} placeholder="What happens each week, and what people come away with." style={{ ...inputStyle, resize: "vertical" }} />
              <FieldError fieldId="program-description" message={fe.messageFor("program-description")} />
            </div>
          </div>
        </FormPanel>

        <FormPanel n={2} title="Who it's for" note="Optional">
          <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <FieldLabel htmlFor="program-age-range" optional>Ages</FieldLabel>
              <input id="program-age-range" value={form.ageRange} onChange={(e) => setForm((f) => ({ ...f, ageRange: e.target.value }))} placeholder="e.g. 8–12" style={inputStyle} />
            </div>
            <div>
              <FieldLabel htmlFor="program-skill-level" optional>Level</FieldLabel>
              <select id="program-skill-level" value={form.skillLevel} onChange={(e) => setForm((f) => ({ ...f, skillLevel: e.target.value }))} style={inputStyle}>
                <option value="">Any level</option>
                {SKILL_LEVELS.map((sk) => (
                  <option key={sk} value={sk}>{sk}</option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel htmlFor="program-instructor" optional>Instructor</FieldLabel>
              <input id="program-instructor" value={form.instructorName} onChange={(e) => setForm((f) => ({ ...f, instructorName: e.target.value }))} placeholder="Name" style={inputStyle} />
            </div>
          </div>
        </FormPanel>

        <FormPanel n={3} title="Price & places">
          <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <FieldLabel htmlFor="program-price-total" optional>Price for the whole course (€)</FieldLabel>
              <input id="program-price-total" inputMode="decimal" value={form.priceCents} onChange={(e) => setForm((f) => ({ ...f, priceCents: e.target.value }))} placeholder="0" style={inputStyle} />
              <p className="adm-note" style={{ margin: "4px 0 0" }}>Leave at 0 for a free programme.</p>
              <PaidClosedPriceNotice amount={form.priceCents} />
            </div>
            <div>
              <FieldLabel htmlFor="program-capacity" optional>Places</FieldLabel>
              <input id="program-capacity" inputMode="numeric" value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} placeholder="Unlimited" style={inputStyle} />
            </div>
          </div>
        </FormPanel>

        <FormPanel n={4} title="Safety & kit" note="Optional" collapsible>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <FieldLabel htmlFor="program-equipment" optional>Equipment needed (one per line)</FieldLabel>
              <textarea id="program-equipment" value={equipmentText} onChange={(e) => setEquipmentText(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
            </div>
            <div>
              <FieldLabel htmlFor="program-guardian-rules" optional>Guardian rules (for programmes involving children or dependants)</FieldLabel>
              <textarea id="program-guardian-rules" value={form.guardianRules} onChange={(e) => setForm((f) => ({ ...f, guardianRules: e.target.value }))} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
            </div>
            <div>
              <FieldLabel htmlFor="program-safeguarding-info" optional>Safeguarding info</FieldLabel>
              <textarea id="program-safeguarding-info" value={form.safeguardingInfo} onChange={(e) => setForm((f) => ({ ...f, safeguardingInfo: e.target.value }))} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
            </div>
          </div>
        </FormPanel>

        <FormErrorSummary errors={fe.errors} focusKey={fe.focusKey} />
        <div>
          <AdminButton variant="primary" onClick={create} disabled={creating} aria-busy={creating || undefined}>
            {creating ? "Creating…" : "Create programme"}
          </AdminButton>
          <p className="adm-note" style={{ margin: "8px 0 0" }}>Next you'll add the sessions. One sign-up covers all of them.</p>
        </div>
      </div>
      <aside className="ws-rail">
        <div className="adm-box ws-rail-card">
          <strong style={{ fontSize: 13 }}>Preview</strong>
          <div className="ws-rail-img ws-thumb--empty">
            <GraduationCap size={26} strokeWidth={1.6} aria-hidden="true" />
          </div>
          {form.category && <span className="adm-chip" style={{ marginTop: 10 }}>{form.category}</span>}
          <strong style={{ display: "block", marginTop: 8, fontSize: 16 }}>{form.title || "Your programme"}</strong>
          <span className="adm-note">{venueName ?? "Choose where it runs"}</span>
          <div style={{ marginTop: 10, fontWeight: 700 }}>
            {price > 0 ? (
              <>
                €{price.toFixed(2)} <span className="adm-note" style={{ fontWeight: 400 }}>for the course</span>
              </>
            ) : (
              "Free"
            )}
          </div>
          {(form.ageRange || form.skillLevel) && <div className="adm-note">{[form.ageRange && `Ages ${form.ageRange}`, form.skillLevel].filter(Boolean).join(" · ")}</div>}
        </div>
      </aside>
    </div>
  );
}

export function VendorProgramsTab({ onOpenProgram }: { onOpenProgram: (id: string) => void }) {
  const state = useAdminData<VendorProgramSummary[]>(() => fetchVendorPrograms());
  const [error, setError] = useState<string | null>(null);
  const [confirmingProgramId, setConfirmingProgramId] = useState<string | null>(null);

  const remove = async (id: string) => {
    setError(null);
    try {
      await deleteVendorProgram(id);
      state.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove that program");
    } finally {
      setConfirmingProgramId(null);
    }
  };

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && (
        <p role="alert" className="adm-field-error" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      <Box flush>
        <Loaded state={state} title="Couldn't load your programmes">
          {(programs) => programs.length === 0 ? (
            <EmptyState icon={<GraduationCap size={20} />} title="No programmes yet" subtitle="A programme is a multi-week course people enrol on once. Use Add programme to create one." />
          ) : (
            <WsListTable
              caption="Your programmes"
              columns={[{ label: "Programme" }, { label: "Status" }, { label: "Price", num: true }, { label: "Places", num: true }, { label: "Created" }]}
              rows={programs.map((p) => ({
                key: p.id,
                name: p.title,
                title: p.title,
                leading: (
                  <span className="ws-thumb ws-thumb--empty" aria-hidden="true">
                    <GraduationCap size={18} strokeWidth={1.9} />
                  </span>
                ),
                cells: [<StatusChipText status={p.status} />, formatPrice(p.priceCents), p.capacity ?? "—", formatDate(p.createdAt)],
                onOpen: () => onOpenProgram(p.id),
                openLabel: "Manage",
                menu: [{ label: "Delete programme…", danger: true, onSelect: () => setConfirmingProgramId(p.id) }],
              }))}
            />
          )}
        </Loaded>
      </Box>

      <ConfirmDialog
        open={confirmingProgramId !== null}
        title="Delete this programme?"
        message="This archives it — it disappears from public view and your active list, but existing enrollments/attendance records are kept."
        confirmLabel="Delete programme"
        onConfirm={() => confirmingProgramId && remove(confirmingProgramId)}
        onCancel={() => setConfirmingProgramId(null)}
      />
    </div>
  );
}

// --- Schedule / Today's Operations (Phase B, unified in Vendor Experience
// Polish) ------------------------------------------------------------------
// A list view rather than a full drag-and-drop calendar grid — the session
// volume this app has today doesn't yet justify that complexity, and a
// sorted list is a strict subset of a calendar's information, not a
// different one. Used to be Program-sessions-only (plus hall bookings in
// the calendar grid view only, nowhere else) — now built on the unified
// GET /vendor/schedule-items, so a Centre-only or Club-only vendor sees
// their own activity here too, not just an empty tab. Selecting a row
// jumps to that item's real management context (Bookings/Calendar's own
// Club section/Programs/Experiences) via `onNavigateItem` rather than a new
// generic management screen.

const SOURCE_LABEL: Record<VendorScheduleItem["sourceType"], string> = {
  centre: "Hall booking",
  club: "Club session",
  program: "Programme",
  experience: "Experience",
};

export function VendorScheduleTab({ onNavigateItem }: { onNavigateItem?: (tab: VendorScheduleNavTarget) => void }) {
  const [items, setItems] = useState<VendorScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  // Calendar grid view (IA spec §14) — same List/Calendar toggle convention
  // as My Life's booking view (MyBookings.tsx), reusing MonthCalendar as-is.
  const [view, setView] = useState<"list" | "calendar">("list");

  useEffect(() => {
    fetchVendorScheduleItems(undefined, 30)
      .then(setItems)
      .finally(() => setLoading(false));
  }, []);

  const todayKey = todayDateKey();
  const todayItems = items.filter((i) => scheduleItemDateKey(i) === todayKey);
  const upcoming = items.filter((i) => scheduleItemDateKey(i) !== todayKey);

  if (loading) return null;

  const goManage = (item: VendorScheduleItem) => onNavigateItem?.(manageTargetFor(item));

  const itemRow = (item: VendorScheduleItem) => (
    <div
      key={item.id}
      onClick={onNavigateItem ? () => goManage(item) : undefined}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        background: item.status === "cancelled" ? colors.bg : colors.greenBg,
        borderRadius: radius.control,
        padding: "10px 14px",
        fontSize: 13.5,
        cursor: onNavigateItem ? "pointer" : "default",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <strong>{formatScheduleWhen(item.startDateTime)}</strong> · {item.title}
        <SourceTypeBadge sourceType={item.sourceType} />
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {formatScheduleCount(item) && <span style={{ color: colors.mutedLight }}>{formatScheduleCount(item)}</span>}
        <StatusPill status={item.status} />
      </span>
    </div>
  );

  // List rows: when | what | count | status | Manage — the workspace queue style.
  const listRow = (item: VendorScheduleItem) => {
    const count = formatScheduleCount(item);
    const cancelled = item.status === "cancelled";
    return (
      <li key={item.id} className="adm-ov-row ws-sched-row">
        <span className="ws-sched-when">{formatScheduleWhen(item.startDateTime)}</span>
        <div className="adm-ov-main">
          <div className="adm-ov-title">{item.title}</div>
          <div className="adm-ov-detail">
            {SOURCE_LABEL[item.sourceType]}
            {item.listingName && item.listingName !== item.title ? ` · ${item.listingName}` : ""}
            {item.spaceName ? ` · ${item.spaceName}` : ""}
          </div>
        </div>
        <span className="ws-sched-count">{count && <span className="adm-chip">{count}</span>}</span>
        <span className="adm-chip" data-tone={cancelled ? "warn" : "good"} style={{ textTransform: "capitalize" }}>
          {item.status}
        </span>
        {onNavigateItem ? (
          <AdminButton size="sm" onClick={() => goManage(item)} aria-label={`Manage ${item.title}`}>
            Manage
          </AdminButton>
        ) : (
          <span />
        )}
      </li>
    );
  };

  const section = (title: string, rows: VendorScheduleItem[], empty: string) =>
    rows.length === 0 ? (
      <div className="ws-line">
        <CalendarDays size={17} strokeWidth={1.9} aria-hidden="true" />
        <span>
          <strong>{title}:</strong> {empty}
        </span>
      </div>
    ) : (
      <Box title={`${title} · ${rows.length}`} flush>
        <ul className="adm-ov-list">{rows.map(listRow)}</ul>
      </Box>
    );

  const calendarItems = items.map((item) => ({ date: scheduleItemDateKey(item), el: itemRow(item) }));

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <IconTabs
        label="Calendar view"
        value={view}
        onChange={setView}
        items={[
          { key: "list", label: "List", icon: List },
          { key: "calendar", label: "Month", icon: CalendarDays },
        ]}
      />

      {view === "calendar" ? (
        <Box flush>
          <div style={{ padding: 16 }}>
            <MonthCalendar items={calendarItems} />
          </div>
        </Box>
      ) : (
        <>
          {section("Today", todayItems, "nothing scheduled.")}
          {section("Next 30 days", upcoming, "nothing else scheduled.")}
        </>
      )}
    </div>
  );
}
