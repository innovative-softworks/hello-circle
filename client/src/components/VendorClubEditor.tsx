import { useEffect, useState } from "react";
import {
  createClubSession,
  deleteClubSession,
  fetchClubSessions,
  fetchVendorClub,
  fetchVendorClubWaitlist,
  offerVendorClubWaitlistEntry,
  updateVendorClub,
  type ClubInput,
} from "../api";
import { AddressSearch, MapConfirm } from "./AddressSearch";
import { PlusIcon, TrashIcon, UsersIcon } from "./icons";
import { FormErrorSummary, SettingsSection } from "./form";
import { Button, ConfirmDialog, EmptyState, inputStyle, labelStyle } from "./ui";
import { MultiImageUpload } from "./VendorImageUpload";
import { ACTIVITY_CATEGORIES } from "../constants";
import { colors, fonts, radius } from "../theme";
import type { Club, ClubSession, WaitlistEntry } from "../types";

// Club create/edit form + its recurring-sessions and waitlist sub-panels —
// split out of the original single VendorDashboard.tsx (see CLAUDE.md).

function clubToInput(c: Club): ClubInput {
  return { name: c.name, sport: c.sport, area: c.area, county: c.county, ages: c.ages, price: c.price, unit: c.unit, trial: c.trial, image: c.image, images: c.images, blurb: c.blurb, includes: c.includes, paymentMethod: c.paymentMethod, mapUrl: c.mapUrl, capacity: c.capacity, phone: c.phone, accessibility: c.accessibility, category: c.category, audience: c.audience, lat: c.lat ?? undefined, lng: c.lng ?? undefined };
}
function blankClubInput(): ClubInput {
  return { name: "", sport: "", area: "", county: "", ages: "", price: 0, unit: "year", trial: false, image: "", images: [], blurb: "", includes: [], paymentMethod: "online", mapUrl: "", capacity: null, phone: "", accessibility: [], category: "", audience: "kids" };
}

// --- club editor -------------------------------------------------------------
//
// Only ever reached for an already-published club — a new one is created via
// ClubCreationWizard.tsx instead (Form System Audit, Phase 5 fast-follow), so
// this no longer needs a flat "new" layout of its own.

export function ClubEditor({
  clubId,
  onSaved,
  onDirtyChange,
}: {
  clubId: string;
  onSaved: (club: Club) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [form, setForm] = useState<ClubInput>(blankClubInput());
  const [includesText, setIncludesText] = useState("");
  const [accessibilityText, setAccessibilityText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ field: string; message: string; fieldId: string }[]>([]);

  useEffect(() => {
    fetchVendorClub(clubId).then((c) => {
      setForm(clubToInput(c));
      setIncludesText(c.includes.join("\n"));
      setAccessibilityText(c.accessibility.join("\n"));
    });
  }, [clubId]);

  const markDirty = () => onDirtyChange?.(true);

  const set = <K extends keyof ClubInput>(k: K, v: ClubInput[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFieldErrors([]);
    markDirty();
  };

  const save = async () => {
    const errors: { field: string; message: string; fieldId: string }[] = [];
    if (!form.name.trim()) errors.push({ field: "name", message: "Club name is required", fieldId: "club-name" });
    if (!form.sport.trim()) errors.push({ field: "sport", message: "Sport is required", fieldId: "club-sport" });
    if (!form.area.trim()) errors.push({ field: "area", message: "Area is required", fieldId: "club-area" });
    if (!form.county.trim()) errors.push({ field: "county", message: "County is required", fieldId: "club-county" });
    if (!form.blurb.trim()) errors.push({ field: "blurb", message: "A short description is required", fieldId: "club-blurb" });
    setFieldErrors(errors);
    if (errors.length > 0) return;

    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const includes = includesText.split("\n").map((s) => s.trim()).filter(Boolean);
      const accessibility = accessibilityText.split("\n").map((s) => s.trim()).filter(Boolean);
      const updated = await updateVendorClub(clubId, { ...form, includes, accessibility });
      setSaved(true);
      onDirtyChange?.(false);
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  // --- field groups, composed differently depending on mode below ---------

  const generalFields = (
    <>
      <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div>
          <label style={labelStyle}>Name</label>
          <input id="club-name" value={form.name} onChange={(e) => set("name", e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Sport</label>
          <input id="club-sport" value={form.sport} onChange={(e) => set("sport", e.target.value)} style={inputStyle} />
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
      </div>
      <label style={labelStyle}>Description</label>
      <p style={{ fontSize: 12, color: colors.mutedLight, margin: "-4px 0 8px" }}>
        Help families understand what this club is like — e.g. "Friendly under-12s football club, twice-weekly training plus Saturday matches."
      </p>
      <textarea id="club-blurb" value={form.blurb} onChange={(e) => set("blurb", e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
    </>
  );

  const locationFields = (
    <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
      <div style={{ gridColumn: "1 / -1" }}>
        <AddressSearch
          onSelect={(r) => {
            setForm((f) => ({ ...f, area: r.area || f.area, county: r.county || f.county, lat: r.lat, lng: r.lng }));
            setFieldErrors([]);
            markDirty();
          }}
        />
      </div>
      <div>
        <label style={labelStyle}>Area</label>
        <input id="club-area" value={form.area} onChange={(e) => set("area", e.target.value)} style={inputStyle} />
      </div>
      <div>
        <label style={labelStyle}>County</label>
        <input id="club-county" value={form.county} onChange={(e) => set("county", e.target.value)} style={inputStyle} />
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <label style={labelStyle}>Map link (optional)</label>
        <input value={form.mapUrl ?? ""} onChange={(e) => set("mapUrl", e.target.value)} placeholder="Google Maps link" style={inputStyle} />
      </div>
      {form.lat !== undefined && form.lng !== undefined && (
        <div style={{ gridColumn: "1 / -1" }}>
          <MapConfirm lat={form.lat} lng={form.lng} label={form.name || "Your club"} />
        </div>
      )}
    </div>
  );

  const contactField = (
    <div>
      <label style={labelStyle}>Contact phone (optional)</label>
      <input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} placeholder="e.g. 01 234 5678" style={inputStyle} />
    </div>
  );

  const membershipFields = (
    <>
      <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div>
          <label style={labelStyle}>Ages (e.g. 5-16)</label>
          <input value={form.ages} onChange={(e) => set("ages", e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Who registers</label>
          <select value={form.audience ?? "kids"} onChange={(e) => set("audience", e.target.value as "kids" | "adults" | "all")} style={inputStyle}>
            <option value="kids">Kids — parent/guardian signs a child up</option>
            <option value="adults">Adults — members register themselves</option>
            <option value="all">Both — registrant picks at sign-up</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Price (€)</label>
          <input type="number" value={form.price} onChange={(e) => set("price", Number(e.target.value))} style={{ ...inputStyle, maxWidth: 140 }} />
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
        style={{ ...inputStyle, maxWidth: 140, marginBottom: 4 }}
      />
      <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 14px" }}>
        Once paid registrations reach this number, new sign-ups are offered a waitlist instead.
      </p>

      <label style={labelStyle}>Registration payment</label>
      <select value={form.paymentMethod ?? "online"} onChange={(e) => set("paymentMethod", e.target.value as "online" | "cash")} style={inputStyle}>
        <option value="online">Online payment</option>
        <option value="cash">Cash on arrival</option>
      </select>
    </>
  );

  const includesField = (
    <div>
      <label style={labelStyle}>What's included (one per line)</label>
      <textarea value={includesText} onChange={(e) => { setIncludesText(e.target.value); setFieldErrors([]); markDirty(); }} rows={4} style={{ ...inputStyle, resize: "vertical" }} />
    </div>
  );

  const accessibilityField = (
    <div>
      <label style={labelStyle}>Accessibility (one per line, e.g. "Wheelchair accessible pitch-side access")</label>
      <textarea value={accessibilityText} onChange={(e) => { setAccessibilityText(e.target.value); setFieldErrors([]); markDirty(); }} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
    </div>
  );

  const photosField = <MultiImageUpload images={form.images ?? []} onChange={(images) => set("images", images)} />;

  const footer = (
    <>
      <FormErrorSummary errors={fieldErrors} />
      {error && <p className="pop-in" style={{ color: colors.danger, fontSize: 13, margin: "0 0 12px", background: colors.dangerBg, padding: "9px 12px", borderRadius: radius.control }}>{error}</p>}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18 }}>
        <Button variant="primary" disabled={saving} onClick={save}>
          Save changes
        </Button>
        {saved && <span style={{ fontSize: 13, color: colors.greenText, fontWeight: 600 }}>Saved</span>}
      </div>
    </>
  );

  const includesList = includesText.split("\n").map((s) => s.trim()).filter(Boolean);
  const accessibilityList = accessibilityText.split("\n").map((s) => s.trim()).filter(Boolean);

  return (
    <>
      <SettingsSection title="General" summary={<>{form.name || "Not set"}{form.blurb && <div style={{ color: colors.mutedLight, fontSize: 13, marginTop: 2 }}>{form.blurb}</div>}</>}>
        {generalFields}
      </SettingsSection>
      <SettingsSection title="Location" summary={[form.area, form.county].filter(Boolean).join(", ") || "Not set"}>
        {locationFields}
      </SettingsSection>
      <SettingsSection title="Contact" summary={form.phone || "Not added"}>
        {contactField}
      </SettingsSection>
      <SettingsSection title="Membership & pricing" summary={`€${form.price}/${form.unit} · ${form.capacity ? `capped at ${form.capacity}` : "unlimited"}`}>
        {membershipFields}
      </SettingsSection>
      <SettingsSection title="What's included" summary={includesList.length > 0 ? includesList.join(" · ") : "None added"}>
        {includesField}
      </SettingsSection>
      <SettingsSection title="Accessibility" summary={accessibilityList.length > 0 ? accessibilityList.join(" · ") : "None added"}>
        {accessibilityField}
      </SettingsSection>
      <SettingsSection title="Photos" summary={`${(form.images ?? []).length} photo${(form.images ?? []).length === 1 ? "" : "s"}`}>
        {photosField}
      </SettingsSection>
      {footer}
    </>
  );
}

// --- recurring sessions (Tier 3) — was API-only; club_sessions CRUD had no
// vendor screen, and RegistrationFlow.tsx's session picker had nothing to
// show for any club until a vendor could actually add one here. ------------

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function ClubSessionsManager({ clubId }: { clubId: string }) {
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

export function ClubWaitlistPanel({ clubId }: { clubId: string }) {
  const [entries, setEntries] = useState<WaitlistEntry[] | null>(null);
  const [invitingId, setInvitingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => fetchVendorClubWaitlist(clubId).then(setEntries).catch(() => setEntries([]));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId]);

  // Host Manage spec §15 — invite a *specific* person instead of only ever
  // waiting for the automatic earliest-first promotion (still fires on its
  // own whenever a spot frees up; this is an additional, manual option).
  const invite = async (entryId: number) => {
    setInvitingId(entryId);
    setError(null);
    try {
      await offerVendorClubWaitlistEntry(clubId, entryId);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send that offer");
    } finally {
      setInvitingId(null);
    }
  };

  if (entries === null) return null;

  return (
    <div style={{ marginTop: 26, paddingTop: 22, borderTop: `1px solid ${colors.border}` }}>
      <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 4px" }}>Waitlist</h4>
      <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 14px" }}>
        Only fills once this club has a membership cap set above and is full. Inviting someone
        gives them 48 hours to claim the place before it's offered on.
      </p>
      {error && <p style={{ fontSize: 12.5, color: colors.danger, margin: "0 0 10px" }}>{error}</p>}
      {entries.length === 0 ? (
        <EmptyState icon={<UsersIcon size={20} />} title="Nobody waiting" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {entries.map((e) => (
            <div key={e.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: colors.bg, borderRadius: radius.control, padding: "8px 12px", fontSize: 13.5 }}>
              <span>{e.name || e.email || "Anonymous"} {e.email && <span style={{ color: colors.mutedLight }}>· {e.email}</span>}</span>
              {e.status === "offered" ? (
                <span style={{ fontSize: 11, fontWeight: 700, borderRadius: radius.pill, padding: "3px 10px", background: colors.orangeBg, color: colors.orangeDark, flex: "none" }}>
                  Offered a spot
                </span>
              ) : (
                <button
                  onClick={() => invite(e.id)}
                  disabled={invitingId === e.id}
                  style={{ fontSize: 11.5, fontWeight: 700, color: colors.muted, background: colors.panel, border: "none", borderRadius: radius.pill, padding: "4px 10px", cursor: "pointer", flex: "none" }}
                >
                  {invitingId === e.id ? "…" : "Invite"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
