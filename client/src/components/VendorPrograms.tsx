import { useEffect, useState } from "react";
import {
  addProgramSession,
  createVendorProgram,
  deleteVendorProgram,
  fetchProgram,
  fetchProgramEnrollments,
  fetchSessionAttendance,
  fetchVendorPrograms,
  fetchVendorSchedule,
  markSessionAttendance,
  removeProgramSession,
  type ProgramEnrollment,
} from "../api";
import { CalendarIcon, PlusIcon, TrashIcon, UsersIcon } from "./icons";
import { Button, Card, EmptyState, inputStyle, labelStyle } from "./ui";
import { colors, fonts } from "../theme";
import type { Program, VendorProgramSummary } from "../types";

// Program wizard + session/attendance management (Phase B) — the vendor
// side of the new Activity/Session model. Deliberately a plain create form
// + inline session list rather than a multi-step wizard — the fields are
// few enough that progressive disclosure isn't earning its complexity yet.

function ProgramManager({ programId, onClose, onChanged }: { programId: string; onClose: () => void; onChanged: () => void }) {
  const [program, setProgram] = useState<Program | null>(null);
  const [enrollments, setEnrollments] = useState<ProgramEnrollment[]>([]);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [duration, setDuration] = useState(60);
  const [capacity, setCapacity] = useState("");
  const [attendance, setAttendance] = useState<Record<string, string[]>>({});

  const load = () => {
    fetchProgram(programId).then(setProgram);
    fetchProgramEnrollments(programId).then(setEnrollments);
  };
  useEffect(load, [programId]);

  const addSession = async () => {
    if (!date) return;
    await addProgramSession(programId, { date, time, durationMinutes: duration, capacity: capacity ? Number(capacity) : undefined });
    setDate("");
    load();
    onChanged();
  };

  const removeSession = async (sessionId: string) => {
    await removeProgramSession(programId, sessionId);
    load();
    onChanged();
  };

  const loadAttendance = async (sessionId: string) => {
    const ids = await fetchSessionAttendance(programId, sessionId);
    setAttendance((a) => ({ ...a, [sessionId]: ids }));
  };

  const toggleAttendance = async (sessionId: string, enrollmentId: number) => {
    await markSessionAttendance(sessionId, enrollmentId);
    loadAttendance(sessionId);
  };

  if (!program) return null;

  return (
    <Card style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 18, margin: 0 }}>{program.title}</h3>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>

      <h4 style={{ fontSize: 13, fontWeight: 700, color: colors.muted, margin: "0 0 10px" }}>SESSIONS</h4>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
        {program.sessions.map((s) => (
          <div key={s.id} style={{ border: `1px solid ${colors.border}`, borderRadius: 12, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{s.date} · {s.time} ({s.durationMinutes}min)</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => loadAttendance(s.id)} style={{ background: "none", border: "none", cursor: "pointer", color: colors.green, fontSize: 12.5, fontWeight: 700 }}>
                  Attendance
                </button>
                <button onClick={() => removeSession(s.id)} style={{ background: "none", border: "none", cursor: "pointer", color: colors.faint }}>
                  <TrashIcon size={14} />
                </button>
              </div>
            </div>
            {attendance[s.id] && (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                {enrollments.map((e) => {
                  const checked = attendance[s.id].includes(String(e.id));
                  return (
                    <label key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                      <input type="checkbox" checked={checked} onChange={() => !checked && toggleAttendance(s.id, e.id)} disabled={checked} style={{ accentColor: colors.green }} />
                      {e.participantName}
                    </label>
                  );
                })}
                {enrollments.length === 0 && <span style={{ fontSize: 12.5, color: colors.faint }}>No enrollments yet.</span>}
              </div>
            )}
          </div>
        ))}
        {program.sessions.length === 0 && <span style={{ fontSize: 13, color: colors.faint }}>No sessions yet — add one below.</span>}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginBottom: 20 }}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, width: 150 }} />
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ ...inputStyle, width: 110 }} />
        <input type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} placeholder="Minutes" style={{ ...inputStyle, width: 90 }} />
        <input value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="Cap" type="number" style={{ ...inputStyle, width: 70 }} />
        <Button variant="ghost" onClick={addSession}><PlusIcon size={14} /> Add session</Button>
      </div>

      <h4 style={{ fontSize: 13, fontWeight: 700, color: colors.muted, margin: "0 0 10px" }}>ENROLLMENTS ({enrollments.length})</h4>
      {enrollments.length === 0 ? (
        <EmptyState icon={<UsersIcon size={20} />} title="No enrollments yet" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {enrollments.map((e) => (
            <div key={e.id} style={{ fontSize: 13.5, display: "flex", justifyContent: "space-between", background: colors.bg, borderRadius: 10, padding: "8px 12px" }}>
              <span>{e.participantName} · {e.email}</span>
              <span style={{ fontWeight: 700 }}>€{(e.totalCents / 100).toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function VendorProgramsTab({ listings }: { listings: { centres: { id: string; name: string }[]; clubs: { id: string; name: string }[] } }) {
  const [programs, setPrograms] = useState<VendorProgramSummary[]>([]);
  const [managing, setManaging] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ listingType: "centre" as "centre" | "club", listingId: "", title: "", description: "", ageRange: "", priceCents: "", capacity: "" });

  const load = () => fetchVendorPrograms().then(setPrograms);
  useEffect(() => {
    load();
  }, []);

  const options = form.listingType === "centre" ? listings.centres : listings.clubs;

  const create = async () => {
    if (!form.title || !form.listingId || !form.description) return;
    setCreating(true);
    try {
      await createVendorProgram({
        listingType: form.listingType,
        listingId: form.listingId,
        title: form.title,
        description: form.description,
        ageRange: form.ageRange,
        priceCents: form.priceCents ? Math.round(parseFloat(form.priceCents) * 100) : 0,
        capacity: form.capacity ? Number(form.capacity) : null,
      });
      setForm({ listingType: "centre", listingId: "", title: "", description: "", ageRange: "", priceCents: "", capacity: "" });
      load();
    } finally {
      setCreating(false);
    }
  };

  const remove = async (id: string) => {
    await deleteVendorProgram(id);
    load();
  };

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card>
        <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 4px" }}>New program</h3>
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
            <select value={form.listingId} onChange={(e) => setForm((f) => ({ ...f, listingId: e.target.value }))} style={inputStyle}>
              <option value="">— choose —</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Title</label>
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} style={inputStyle} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Description</label>
            <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
          <div>
            <label style={labelStyle}>Age range</label>
            <input value={form.ageRange} onChange={(e) => setForm((f) => ({ ...f, ageRange: e.target.value }))} placeholder="e.g. 8-12" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Price (€, total)</label>
            <input value={form.priceCents} onChange={(e) => setForm((f) => ({ ...f, priceCents: e.target.value }))} placeholder="0 = free" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Capacity</label>
            <input value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} placeholder="Unlimited" style={inputStyle} />
          </div>
        </div>
        <Button onClick={create} disabled={creating || !form.title || !form.listingId}>
          {creating ? "Creating…" : "Create program"}
        </Button>
      </Card>

      {managing && <ProgramManager programId={managing} onClose={() => setManaging(null)} onChanged={load} />}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {programs.map((p) => (
          <Card key={p.id} hover style={{ padding: 15, display: "flex", justifyContent: "space-between", alignItems: "center" }} onClick={() => setManaging(p.id)}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{p.title}</div>
              <div style={{ fontSize: 12, color: colors.mutedLight, display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                <CalendarIcon size={12} /> {p.status} · {p.priceCents ? `€${(p.priceCents / 100).toFixed(2)}` : "Free"}
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                remove(p.id);
              }}
              style={{ background: "none", border: "none", cursor: "pointer", color: colors.faint }}
            >
              <TrashIcon size={16} />
            </button>
          </Card>
        ))}
        {programs.length === 0 && <EmptyState icon={<CalendarIcon size={26} />} title="No programs yet" subtitle="Create one above." />}
      </div>
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchVendorSchedule()
      .then(setEntries)
      .finally(() => setLoading(false));
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const todayEntries = entries.filter((e) => e.date === today);
  const upcoming = entries.filter((e) => e.date !== today);

  if (loading) return null;

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Card>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 14px" }}>Today</h4>
        {todayEntries.length === 0 ? (
          <EmptyState icon={<CalendarIcon size={22} />} title="Nothing scheduled today" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {todayEntries.map((e) => (
              <div key={e.id} style={{ display: "flex", justifyContent: "space-between", background: colors.greenBg, borderRadius: 10, padding: "10px 14px", fontSize: 13.5 }}>
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
              <div key={e.id} style={{ display: "flex", justifyContent: "space-between", background: colors.bg, borderRadius: 10, padding: "10px 14px", fontSize: 13.5 }}>
                <span>{e.date} · {e.time} · {e.title}</span>
                <span>{e.enrolled}{e.capacity ? `/${e.capacity}` : ""} enrolled</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
