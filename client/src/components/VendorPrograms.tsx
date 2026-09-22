import { useEffect, useState, type SetStateAction } from "react";
import {
  addProgramSession,
  createVendorProgram,
  deleteVendorProgram,
  fetchProgramEnrollments,
  fetchSessionAttendance,
  fetchVendorBookings,
  fetchVendorProgram,
  fetchVendorPrograms,
  fetchVendorRooms,
  fetchVendorSchedule,
  markSessionAttendance,
  removeProgramSession,
  updateVendorProgram,
  type ProgramEnrollment,
} from "../api";
import { CalendarIcon, PlusIcon, TrashIcon, UsersIcon } from "./icons";
import { VendorCheckInScreen } from "./VendorCheckInScreen";
import { FormErrorSummary } from "./form";
import { MonthCalendar } from "./MonthCalendar";
import { Button, ManageCard as Card, ConfirmDialog, EmptyState, inputStyle, labelStyle } from "./ui";
import { ACTIVITY_CATEGORIES, ATTENDANCE_STATUSES, ATTENDANCE_STATUS_LABELS, PROGRAM_STATUSES, SKILL_LEVELS } from "../constants";
import { colors, fonts, radius } from "../theme";
import type { AttendanceStatus, Program, ProgramStatus, Room, VendorBookingRow, VendorProgramSummary } from "../types";
import { formatPrice } from "../formatters";

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
  const [enrollments, setEnrollments] = useState<ProgramEnrollment[]>([]);
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

  const load = () => {
    fetchVendorProgram(programId).then((p) => {
      setProgram(p);
      if (p.listingType === "centre") fetchVendorRooms(p.listingId).then(setRooms).catch(() => {});
    });
    fetchProgramEnrollments(programId).then(setEnrollments);
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
      for (let i = 0; i < count; i++) {
        const d = new Date(`${date}T00:00:00`);
        if (repeat === "weekly") d.setDate(d.getDate() + 7 * i);
        else if (repeat === "biweekly") d.setDate(d.getDate() + 14 * i);
        else if (repeat === "monthly") d.setMonth(d.getMonth() + i);
        const occurrenceDate = d.toISOString().slice(0, 10);
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

  if (!program) return null;

  return (
    <>
      {error && <p style={{ fontSize: 12.5, color: colors.orangeDark, margin: "0 0 12px" }}>{error}</p>}

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: colors.muted }}>STATUS</span>
        {PROGRAM_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            disabled={statusSaving || program.status === s}
            style={{
              border: "none",
              borderRadius: radius.pill,
              padding: "5px 12px",
              fontSize: 12.5,
              fontWeight: 700,
              cursor: statusSaving || program.status === s ? "default" : "pointer",
              background: program.status === s ? colors.green : colors.panel,
              color: program.status === s ? "#fff" : colors.muted,
              textTransform: "capitalize",
            }}
          >
            {s}
          </button>
        ))}
      </div>
      {program.status === "draft" && (
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "-12px 0 16px" }}>
          Draft programs aren't visible to guests yet — publish when ready.
        </p>
      )}

      <h4 style={{ fontSize: 13, fontWeight: 700, color: colors.muted, margin: "0 0 10px" }}>SESSIONS</h4>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
        {program.sessions.map((s) => (
          <div key={s.id} style={{ border: `1px solid ${colors.border}`, borderRadius: 12, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>
                {s.date} · {s.time} ({s.durationMinutes}min)
                {s.instructorName && <span style={{ fontWeight: 400, color: colors.mutedLight }}> · {s.instructorName}</span>}
                {s.roomName && <span style={{ fontWeight: 400, color: colors.mutedLight }}> · {s.roomName}</span>}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setCheckingInSession({ id: s.id, date: s.date, time: s.time })} style={{ background: "none", border: "none", cursor: "pointer", color: colors.green, fontSize: 12.5, fontWeight: 700 }}>
                  Check-in
                </button>
                <button onClick={() => loadAttendance(s.id)} style={{ background: "none", border: "none", cursor: "pointer", color: colors.green, fontSize: 12.5, fontWeight: 700 }}>
                  Attendance
                </button>
                <button onClick={() => setConfirmingSessionId(s.id)} style={{ background: "none", border: "none", cursor: "pointer", color: colors.faint }}>
                  <TrashIcon size={14} />
                </button>
              </div>
            </div>
            {attendance[s.id] && (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                {enrollments.map((e) => {
                  const status = attendance[s.id][String(e.id)];
                  return (
                    <div key={e.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13 }}>{e.participantName}</span>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        {ATTENDANCE_STATUSES.map((st) => {
                          const active = status === st;
                          const palette = ATTENDANCE_STATUS_COLORS[st];
                          return (
                            <button
                              key={st}
                              onClick={() => setAttendanceStatus(s.id, e.id, st)}
                              disabled={active}
                              style={{
                                border: "none",
                                borderRadius: radius.pill,
                                padding: "3px 9px",
                                fontSize: 11,
                                fontWeight: 700,
                                cursor: active ? "default" : "pointer",
                                background: active ? palette.bg : colors.panel,
                                color: active ? palette.fg : colors.muted,
                              }}
                            >
                              {ATTENDANCE_STATUS_LABELS[st]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {enrollments.length === 0 && <span style={{ fontSize: 12.5, color: colors.faint }}>No enrollments yet.</span>}
              </div>
            )}
          </div>
        ))}
        {program.sessions.length === 0 && <span style={{ fontSize: 13, color: colors.faint }}>No sessions yet — add one below.</span>}
      </div>
      {addOpen ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginBottom: 20 }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, width: 150 }} />
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ ...inputStyle, width: 110 }} />
          <input type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} placeholder="Minutes" style={{ ...inputStyle, width: 90 }} />
          <input value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="Cap" type="number" style={{ ...inputStyle, width: 70 }} />
          <input value={sessionInstructor} onChange={(e) => setSessionInstructor(e.target.value)} placeholder="Instructor (optional)" style={{ ...inputStyle, width: 150 }} />
          {program.listingType === "centre" && (
            <select value={sessionRoomId} onChange={(e) => setSessionRoomId(e.target.value)} style={{ ...inputStyle, width: 150 }}>
              <option value="">No room set</option>
              {rooms.filter((r) => r.active).map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          )}
          <select value={repeat} onChange={(e) => setRepeat(e.target.value as typeof repeat)} style={{ ...inputStyle, width: 130 }}>
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
              style={{ ...inputStyle, width: 80 }}
            />
          )}
          <Button variant="ghost" onClick={addSession}>
            <PlusIcon size={14} /> {repeat === "none" ? "Add session" : `Add ${Math.max(1, Math.min(52, occurrences))} sessions`}
          </Button>
          <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
        </div>
      ) : (
        <div style={{ marginBottom: 20 }}>
          <Button variant="ghost" onClick={() => setAddOpen(true)}>
            <PlusIcon size={14} /> Add session
          </Button>
        </div>
      )}

      <h4 style={{ fontSize: 13, fontWeight: 700, color: colors.muted, margin: "0 0 10px" }}>ENROLLMENTS ({enrollments.length})</h4>
      {enrollments.length === 0 ? (
        <EmptyState icon={<UsersIcon size={20} />} title="No enrollments yet" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {enrollments.map((e) => (
            <div key={e.id} style={{ fontSize: 13.5, display: "flex", justifyContent: "space-between", background: colors.bg, borderRadius: radius.control, padding: "8px 12px" }}>
              <span>{e.participantName} · {e.email}</span>
              <span style={{ fontWeight: 700 }}>€{(e.totalCents / 100).toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmingSessionId !== null}
        title="Remove this session?"
        message="Anyone already enrolled in the program is unaffected — this only removes the one date/time from the schedule."
        confirmLabel="Remove"
        onConfirm={() => confirmingSessionId && removeSession(confirmingSessionId)}
        onCancel={() => setConfirmingSessionId(null)}
      />
      <VendorCheckInScreen programId={programId} session={checkingInSession} onClose={() => setCheckingInSession(null)} />
    </>
  );
}

// --- create form — its own page (VendorProgramEditPage.tsx) when id is
// "new"; a plain create form here rather than a Drawer since it's the
// pre-cursor to the sessions/attendance/enrollments management view below,
// which already needs the room a full page gives it. -----------------------

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
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ field: string; message: string; fieldId: string }[]>([]);
  const [form, setFormRaw] = useState({
    listingType: "centre" as "centre" | "club",
    listingId: "",
    title: "",
    description: "",
    ageRange: "",
    priceCents: "",
    capacity: "",
    category: "",
    skillLevel: "",
    instructorName: "",
    guardianRules: "",
    safeguardingInfo: "",
  });
  // See HostGamePage.tsx's identical wrapper — clears a stale FormErrorSummary
  // the moment the user edits anything, instead of it lingering until the
  // next submit attempt re-validates.
  const setForm = (updater: SetStateAction<typeof form>) => {
    setFormRaw(updater);
    setFieldErrors([]);
    onDirtyChange?.(true);
  };
  const [equipmentText, setEquipmentTextRaw] = useState("");
  const setEquipmentText = (v: string) => {
    setEquipmentTextRaw(v);
    onDirtyChange?.(true);
  };

  const options = form.listingType === "centre" ? listings.centres : listings.clubs;

  const create = async () => {
    const errors: { field: string; message: string; fieldId: string }[] = [];
    if (!form.listingId) errors.push({ field: "listingId", message: "Choose which listing this program attaches to", fieldId: "program-listing" });
    if (!form.title.trim()) errors.push({ field: "title", message: "Title is required", fieldId: "program-title" });
    if (!form.description.trim()) errors.push({ field: "description", message: "Description is required", fieldId: "program-description" });
    setFieldErrors(errors);
    if (errors.length > 0) return;

    setCreating(true);
    setError(null);
    try {
      const created = await createVendorProgram({
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
      onCreated(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create that program");
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 14px" }}>
        A multi-session activity (e.g. an 8-week course) — one sign-up covers every session you add below.
      </p>
      <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>Attach to</label>
          <select value={form.listingType} onChange={(e) => setForm((f) => ({ ...f, listingType: e.target.value as "centre" | "club", listingId: "" }))} style={inputStyle}>
            <option value="centre">Community centre</option>
            <option value="club">Sports club</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Listing</label>
          <select id="program-listing" value={form.listingId} onChange={(e) => setForm((f) => ({ ...f, listingId: e.target.value }))} style={inputStyle}>
            <option value="">— choose —</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Title</label>
          <input id="program-title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} style={inputStyle} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Description</label>
          <textarea id="program-description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
        <div>
          <label style={labelStyle}>Age range</label>
          <input value={form.ageRange} onChange={(e) => setForm((f) => ({ ...f, ageRange: e.target.value }))} placeholder="e.g. 8-12" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Price (€, total)</label>
          <input value={form.priceCents} onChange={(e) => setForm((f) => ({ ...f, priceCents: e.target.value }))} placeholder="0 = free" style={{ ...inputStyle, maxWidth: 140 }} />
        </div>
        <div>
          <label style={labelStyle}>Capacity</label>
          <input value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} placeholder="Unlimited" style={{ ...inputStyle, maxWidth: 140 }} />
        </div>
        <div>
          <label style={labelStyle}>Category</label>
          <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} style={inputStyle}>
            <option value="">— none —</option>
            {ACTIVITY_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Skill level</label>
          <select value={form.skillLevel} onChange={(e) => setForm((f) => ({ ...f, skillLevel: e.target.value }))} style={inputStyle}>
            <option value="">— none —</option>
            {SKILL_LEVELS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Instructor (optional)</label>
          <input value={form.instructorName} onChange={(e) => setForm((f) => ({ ...f, instructorName: e.target.value }))} style={inputStyle} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Equipment needed (one per line, optional)</label>
          <textarea value={equipmentText} onChange={(e) => setEquipmentText(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Guardian rules (optional — for programs involving children/dependants)</label>
          <textarea value={form.guardianRules} onChange={(e) => setForm((f) => ({ ...f, guardianRules: e.target.value }))} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Safeguarding info (optional)</label>
          <textarea value={form.safeguardingInfo} onChange={(e) => setForm((f) => ({ ...f, safeguardingInfo: e.target.value }))} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
      </div>
      <FormErrorSummary errors={fieldErrors} />
      {error && <p style={{ fontSize: 12.5, color: colors.orangeDark, margin: "0 0 12px" }}>{error}</p>}
      <Button onClick={create} disabled={creating}>
        {creating ? "Creating…" : "Create program"}
      </Button>
    </>
  );
}

export function VendorProgramsTab({ onOpenProgram }: { onOpenProgram: (id: string) => void }) {
  const [programs, setPrograms] = useState<VendorProgramSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmingProgramId, setConfirmingProgramId] = useState<string | null>(null);

  const load = () => fetchVendorPrograms().then(setPrograms);
  useEffect(() => {
    load();
  }, []);

  const remove = async (id: string) => {
    setError(null);
    try {
      await deleteVendorProgram(id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove that program");
    } finally {
      setConfirmingProgramId(null);
    }
  };

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {error && <p style={{ fontSize: 12.5, color: colors.orangeDark, margin: 0 }}>{error}</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {programs.map((p) => (
          <Card key={p.id} hover style={{ padding: 15, display: "flex", justifyContent: "space-between", alignItems: "center" }} onClick={() => onOpenProgram(p.id)}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{p.title}</div>
              <div style={{ fontSize: 12, color: colors.mutedLight, display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                <CalendarIcon size={12} /> {p.status} · {formatPrice(p.priceCents)}
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setConfirmingProgramId(p.id);
              }}
              style={{ background: "none", border: "none", cursor: "pointer", color: colors.faint }}
            >
              <TrashIcon size={16} />
            </button>
          </Card>
        ))}
        {programs.length === 0 && <EmptyState icon={<CalendarIcon size={26} />} title="No programs yet" subtitle="Create one above." />}
      </div>

      <ConfirmDialog
        open={confirmingProgramId !== null}
        title="Delete this program?"
        message="This archives it — it disappears from public view and your active list, but existing enrollments/attendance records are kept."
        confirmLabel="Delete"
        onConfirm={() => confirmingProgramId && remove(confirmingProgramId)}
        onCancel={() => setConfirmingProgramId(null)}
      />
    </div>
  );
}

// --- Schedule / Today's Operations (Phase B) ------------------------------
// A list view rather than a full drag-and-drop calendar grid — the session
// volume this app has today doesn't yet justify that complexity, and a
// sorted list is a strict subset of a calendar's information, not a
// different one.

export function VendorScheduleTab() {
  const [entries, setEntries] = useState<{ id: string; date: string; time: string; durationMinutes: number; capacity: number | null; title: string; programId: string; enrolled: number }[]>([]);
  const [bookings, setBookings] = useState<VendorBookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Calendar grid view (IA spec §14) — same List/Calendar toggle convention
  // as My Life's booking view (MyBookings.tsx), reusing MonthCalendar as-is.
  const [view, setView] = useState<"list" | "calendar">("list");

  useEffect(() => {
    fetchVendorSchedule()
      .then(setEntries)
      .finally(() => setLoading(false));
    // Host Manage spec §12 — the calendar previously only plotted program
    // sessions; a vendor's real room usage includes paid hall bookings too.
    // Kept out of the Today/Upcoming list below, which stays program-only
    // (BookingsTab is already the full-detail place for bookings) — only
    // the calendar grid gains them.
    fetchVendorBookings()
      .then((rows) => setBookings(rows.filter((b) => b.status !== "cancelled")))
      .catch(() => setBookings([]));
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const todayEntries = entries.filter((e) => e.date === today);
  const upcoming = entries.filter((e) => e.date !== today);

  if (loading) return null;

  const entryRow = (e: (typeof entries)[number]) => (
    <div style={{ display: "flex", justifyContent: "space-between", background: colors.bg, borderRadius: radius.control, padding: "10px 14px", fontSize: 13.5 }}>
      <span>{e.time} · {e.title}</span>
      <span>{e.enrolled}{e.capacity ? `/${e.capacity}` : ""} enrolled</span>
    </div>
  );

  const bookingRow = (b: VendorBookingRow) => (
    <div style={{ display: "flex", justifyContent: "space-between", background: colors.greenBg, borderRadius: radius.control, padding: "10px 14px", fontSize: 13.5 }}>
      <span>{b.time} · {b.roomName ?? b.centreName} — {b.name}</span>
      <span style={{ color: colors.greenText, fontWeight: 700 }}>Booking</span>
    </div>
  );

  const calendarItems = [...entries.map((e) => ({ date: e.date, el: entryRow(e) })), ...bookings.map((b) => ({ date: b.date, el: bookingRow(b) }))];

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", gap: 6 }}>
        {(["list", "calendar"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            style={{
              border: "none", borderRadius: radius.pill, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", textTransform: "capitalize",
              background: view === v ? colors.dark : colors.panel, color: view === v ? "#fff" : colors.muted,
            }}
          >
            {v}
          </button>
        ))}
      </div>

      {view === "calendar" ? (
        <Card>
          <MonthCalendar items={calendarItems} />
        </Card>
      ) : (
        <>
          <Card>
            <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 14px" }}>Today</h4>
            {todayEntries.length === 0 ? (
              <EmptyState icon={<CalendarIcon size={22} />} title="Nothing scheduled today" />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {todayEntries.map((e) => (
                  <div key={e.id} style={{ display: "flex", justifyContent: "space-between", background: colors.greenBg, borderRadius: radius.control, padding: "10px 14px", fontSize: 13.5 }}>
                    <span><strong>{e.time}</strong> · {e.title}</span>
                    <span>{e.enrolled}{e.capacity ? `/${e.capacity}` : ""} enrolled</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card>
            <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 14px" }}>Upcoming (next 30 days)</h4>
            {upcoming.length === 0 ? (
              <EmptyState icon={<CalendarIcon size={22} />} title="Nothing else scheduled" />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {upcoming.map((e) => (
                  <div key={e.id}>{entryRow(e)}</div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
