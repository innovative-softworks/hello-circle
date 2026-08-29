import { useEffect, useState } from "react";
import {
  createClubSession,
  createVendorClub,
  deleteClubSession,
  fetchClubSessions,
  fetchVendorClub,
  fetchVendorClubWaitlist,
  updateVendorClub,
  type ClubInput,
} from "../api";
import { PlusIcon, TrashIcon, UsersIcon } from "./icons";
import { Button, ConfirmDialog, EmptyState, inputStyle, labelStyle } from "./ui";
import { MultiImageUpload } from "./VendorImageUpload";
import { ACTIVITY_CATEGORIES } from "../constants";
import { colors, fonts, radius } from "../theme";
import type { Club, ClubSession, WaitlistEntry } from "../types";

// Club create/edit form + its recurring-sessions and waitlist sub-panels —
// split out of the original single VendorDashboard.tsx (see CLAUDE.md).

function clubToInput(c: Club): ClubInput {
  return { name: c.name, sport: c.sport, area: c.area, county: c.county, ages: c.ages, price: c.price, unit: c.unit, trial: c.trial, image: c.image, images: c.images, blurb: c.blurb, includes: c.includes, paymentMethod: c.paymentMethod, mapUrl: c.mapUrl, capacity: c.capacity, phone: c.phone, accessibility: c.accessibility, category: c.category };
}
function blankClubInput(): ClubInput {
  return { name: "", sport: "", area: "", county: "", ages: "", price: 0, unit: "year", trial: false, image: "", images: [], blurb: "", includes: [], paymentMethod: "online", mapUrl: "", capacity: null, phone: "", accessibility: [], category: "" };
}

// --- club editor -------------------------------------------------------------

export function ClubEditor({ clubId, onSaved }: { clubId: string | "new"; onSaved: () => void }) {
  const [form, setForm] = useState<ClubInput>(blankClubInput());
  const [includesText, setIncludesText] = useState("");
  const [accessibilityText, setAccessibilityText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (clubId !== "new") {
      fetchVendorClub(clubId).then((c) => {
        setForm(clubToInput(c));
        setIncludesText(c.includes.join("\n"));
        setAccessibilityText(c.accessibility.join("\n"));
      });
    }
  }, [clubId]);

  const set = <K extends keyof ClubInput>(k: K, v: ClubInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const includes = includesText.split("\n").map((s) => s.trim()).filter(Boolean);
      const accessibility = accessibilityText.split("\n").map((s) => s.trim()).filter(Boolean);
      if (clubId === "new") await createVendorClub({ ...form, includes, accessibility });
      else await updateVendorClub(clubId, { ...form, includes, accessibility });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div>
          <label style={labelStyle}>Name</label>
          <input value={form.name} onChange={(e) => set("name", e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Sport</label>
          <input value={form.sport} onChange={(e) => set("sport", e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Category</label>
          <select value={form.category ?? ""} onChange={(e) => set("category", e.target.value)} style={inputStyle}>
            <option value="">— none —</option>
            {ACTIVITY_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Area</label>
          <input value={form.area} onChange={(e) => set("area", e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>County</label>
          <input value={form.county} onChange={(e) => set("county", e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Ages (e.g. 5-16)</label>
          <input value={form.ages} onChange={(e) => set("ages", e.target.value)} style={inputStyle} />
        </div>
        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <label style={labelStyle}>Price (€)</label>
            <input type="number" value={form.price} onChange={(e) => set("price", Number(e.target.value))} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Per</label>
            <select value={form.unit} onChange={(e) => set("unit", e.target.value)} style={inputStyle}>
              <option value="year">year</option>
              <option value="term">term</option>
              <option value="lesson">lesson</option>
              <option value="session">session</option>
            </select>
          </div>
        </div>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 16, fontSize: 14, background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 11, padding: "10px 13px", cursor: "pointer" }}>
        <input type="checkbox" checked={!!form.trial} onChange={(e) => set("trial", e.target.checked)} style={{ accentColor: colors.orange, width: 16, height: 16 }} />
        Offers a free trial session
      </label>

      <label style={labelStyle}>Membership cap (leave blank for unlimited)</label>
      <input
        type="number"
        min={0}
        value={form.capacity ?? ""}
        onChange={(e) => set("capacity", e.target.value === "" ? null : Number(e.target.value))}
        placeholder="e.g. 30"
        style={{ ...inputStyle, marginBottom: 4 }}
      />
      <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 14px" }}>
        Once paid registrations reach this number, new sign-ups are offered a waitlist instead.
      </p>

      <label style={labelStyle}>Registration payment</label>
      <select value={form.paymentMethod ?? "online"} onChange={(e) => set("paymentMethod", e.target.value as "online" | "cash")} style={{ ...inputStyle, marginBottom: 14 }}>
        <option value="online">Online payment</option>
        <option value="cash">Cash on arrival</option>
      </select>

      <label style={labelStyle}>Map link (optional)</label>
      <input value={form.mapUrl ?? ""} onChange={(e) => set("mapUrl", e.target.value)} placeholder="Google Maps link" style={{ ...inputStyle, marginBottom: 14 }} />

      <label style={labelStyle}>Contact phone (optional)</label>
      <input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} placeholder="e.g. 01 234 5678" style={{ ...inputStyle, marginBottom: 14 }} />

      <label style={labelStyle}>Description</label>
      <textarea value={form.blurb} onChange={(e) => set("blurb", e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical", marginBottom: 14 }} />

      <label style={labelStyle}>What's included (one per line)</label>
      <textarea value={includesText} onChange={(e) => setIncludesText(e.target.value)} rows={4} style={{ ...inputStyle, resize: "vertical", marginBottom: 14 }} />

      <label style={labelStyle}>Accessibility (one per line, e.g. "Wheelchair accessible pitch-side access")</label>
      <textarea value={accessibilityText} onChange={(e) => setAccessibilityText(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical", marginBottom: 14 }} />

      <div style={{ marginBottom: 18 }}>
        <MultiImageUpload images={form.images ?? []} onChange={(images) => set("images", images)} />
      </div>

      {error && <p className="pop-in" style={{ color: colors.danger, fontSize: 13, margin: "0 0 12px", background: colors.dangerBg, padding: "9px 12px", borderRadius: radius.control }}>{error}</p>}
      <Button variant="primary" disabled={saving || !form.name} onClick={save}>
        {clubId === "new" ? "Create (goes to admin for approval)" : "Save changes"}
      </Button>

      {clubId !== "new" && (
        <>
          <ClubSessionsManager clubId={clubId} />
          <ClubWaitlistPanel clubId={clubId} />
        </>
      )}
    </>
  );
}

// --- recurring sessions (Tier 3) — was API-only; club_sessions CRUD had no
// vendor screen, and RegistrationFlow.tsx's session picker had nothing to
// show for any club until a vendor could actually add one here. ------------

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function ClubSessionsManager({ clubId }: { clubId: string }) {
  const [sessions, setSessions] = useState<ClubSession[]>([]);
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [time, setTime] = useState("18:00");
  const [label, setLabel] = useState("");
  const [capacity, setCapacity] = useState("");
  const [instructorName, setInstructorName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const load = () => {
    fetchClubSessions(clubId).then(setSessions).catch(() => {});
  };
  useEffect(load, [clubId]);

  const add = async () => {
    setAdding(true);
    try {
      await createClubSession({ clubId, dayOfWeek, time, label: label || undefined, capacity: capacity ? Number(capacity) : undefined, instructorName: instructorName || undefined });
      setLabel("");
      setCapacity("");
      setInstructorName("");
      setAddOpen(false);
      load();
    } finally {
      setAdding(false);
    }
  };

  const remove = async (id: string) => {
    await deleteClubSession(id);
    load();
    setConfirmingId(null);
  };

  return (
    <div style={{ marginTop: 26, paddingTop: 22, borderTop: `1px solid ${colors.border}` }}>
      <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 4px" }}>Recurring sessions</h4>
      <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 14px" }}>
        Optional — lets a family pick a specific day/time when registering instead of one flat sign-up.
      </p>
      {sessions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
          {sessions.map((s) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: colors.bg, borderRadius: radius.control, padding: "8px 12px", fontSize: 13.5 }}>
              <span>
                {DAY_NAMES[s.dayOfWeek]} {s.time}
                {s.label ? ` — ${s.label}` : ""}
                {s.capacity ? ` · cap ${s.capacity}` : ""}
                {s.instructorName ? ` · ${s.instructorName}` : ""}
              </span>
              <button onClick={() => setConfirmingId(s.id)} aria-label="Remove session" style={{ background: "none", border: "none", cursor: "pointer", color: colors.faint, display: "flex" }}>
                <TrashIcon size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      {addOpen ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
          <select value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))} style={{ ...inputStyle, width: 130 }}>
            {DAY_NAMES.map((d, i) => (
              <option key={d} value={i}>{d}</option>
            ))}
          </select>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ ...inputStyle, width: 110 }} />
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" style={{ ...inputStyle, width: 150 }} />
          <input value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="Cap" type="number" style={{ ...inputStyle, width: 70 }} />
          <input value={instructorName} onChange={(e) => setInstructorName(e.target.value)} placeholder="Instructor (optional)" style={{ ...inputStyle, width: 150 }} />
          <Button variant="ghost" onClick={add} disabled={adding}>
            <PlusIcon size={14} /> Add
          </Button>
          <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
        </div>
      ) : (
        <Button variant="ghost" onClick={() => setAddOpen(true)}>
          <PlusIcon size={14} /> Add session
        </Button>
      )}

      <ConfirmDialog
        open={!!confirmingId}
        title="Remove this session?"
        message="This permanently deletes the recurring session — it can't be undone."
        confirmLabel="Remove"
        onConfirm={() => confirmingId && remove(confirmingId)}
        onCancel={() => setConfirmingId(null)}
      />
    </div>
  );
}

// --- club waitlist (Tier 3) — the vendor side of the MVP waitlist feature
// genuinely had no route at all until now, not just no UI. -----------------

function ClubWaitlistPanel({ clubId }: { clubId: string }) {
  const [entries, setEntries] = useState<WaitlistEntry[] | null>(null);

  useEffect(() => {
    fetchVendorClubWaitlist(clubId).then(setEntries).catch(() => setEntries([]));
  }, [clubId]);

  if (entries === null) return null;

  return (
    <div style={{ marginTop: 26, paddingTop: 22, borderTop: `1px solid ${colors.border}` }}>
      <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 4px" }}>Waitlist</h4>
      <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 14px" }}>
        Only fills once this club has a membership cap set above and is full.
      </p>
      {entries.length === 0 ? (
        <EmptyState icon={<UsersIcon size={20} />} title="Nobody waiting" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {entries.map((e) => (
            <div key={e.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: colors.bg, borderRadius: radius.control, padding: "8px 12px", fontSize: 13.5 }}>
              <span>{e.name || e.email || "Anonymous"} {e.email && <span style={{ color: colors.mutedLight }}>· {e.email}</span>}</span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: radius.pill,
                  padding: "3px 10px",
                  background: e.status === "offered" ? colors.orangeBg : colors.panel,
                  color: e.status === "offered" ? colors.orangeDark : colors.muted,
                }}
              >
                {e.status === "offered" ? "Offered a spot" : "Waiting"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
