import { useEffect, useState } from "react";
import {
  addExperienceSession,
  deleteVendorExperience,
  fetchOrgProfile,
  fetchVendorExperience,
  fetchVendorExperienceBookings,
  fetchVendorExperienceSessions,
  fetchVendorExperiences,
  removeExperienceSession,
  updateVendorExperience,
  type ExperienceInput,
} from "../api";
import { CalendarIcon, PlusIcon, TreeIconSmall, TrashIcon, UsersIcon } from "./icons";
import { FormErrorSummary, NumberStepper, SettingsSection } from "./form";
import { Button, ManageCard as Card, ConfirmDialog, EmptyState, inputStyle, labelStyle } from "./ui";
import { MultiImageUpload } from "./VendorImageUpload";
import { colors, fonts, radius } from "../theme";
import type { Experience, ExperienceSessionRow, VendorExperienceBooking, VendorExperienceSummary } from "../types";
import { formatPrice } from "../formatters";

// Adventures & Experiences — vendor create/edit form + session/booking
// management, split out the same way VendorPrograms.tsx is (see CLAUDE.md).
// A standalone third listing type (own admin moderation queue, own
// approved-only public visibility) — not attached to a centre or club, so
// there's no "attach to" picker the way Programs has one.

function blankExperienceInput(): ExperienceInput {
  return {
    kind: "experience",
    title: "",
    area: "",
    county: "",
    meetingPoint: "",
    blurb: "",
    description: "",
    difficulty: "",
    durationMinutes: 120,
    distanceKm: null,
    elevationGainM: null,
    terrainType: "",
    fitnessRequirements: "",
    itinerary: "",
    equipmentProvided: "",
    equipmentRequired: "",
    transportInfo: "",
    safetyInfo: "",
    weatherPolicy: "",
    eligibility: "",
    cancellationTerms: "",
    priceCents: 0,
    capacity: 8,
    paymentMethod: "online",
    images: [],
  };
}

function experienceToInput(e: Experience): ExperienceInput {
  return {
    kind: e.kind,
    title: e.title,
    area: e.area,
    county: e.county,
    lat: e.lat,
    lng: e.lng,
    meetingPoint: e.meetingPoint,
    blurb: e.blurb,
    description: e.description,
    difficulty: e.difficulty,
    durationMinutes: e.durationMinutes,
    distanceKm: e.distanceKm,
    elevationGainM: e.elevationGainM,
    terrainType: e.terrainType,
    fitnessRequirements: e.fitnessRequirements,
    itinerary: e.itinerary,
    equipmentProvided: e.equipmentProvided,
    equipmentRequired: e.equipmentRequired,
    transportInfo: e.transportInfo,
    safetyInfo: e.safetyInfo,
    weatherPolicy: e.weatherPolicy,
    eligibility: e.eligibility,
    cancellationTerms: e.cancellationTerms,
    priceCents: e.priceCents,
    capacity: e.capacity,
    paymentMethod: e.paymentMethod,
    images: e.images,
  };
}

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  pending: { fg: "#9A6B00", bg: "#FFF3D6" },
  approved: { fg: colors.greenText, bg: colors.greenBg },
  rejected: { fg: colors.danger, bg: colors.dangerBg },
  deleted: { fg: colors.muted, bg: colors.panel },
};

// --- editor (create or edit) -----------------------------------------------
//
// Only ever reached for an already-published listing — a new one is created
// via ExperienceCreationWizard.tsx instead (Form System Audit, Phase 5
// fast-follow), so this no longer needs a flat "new" layout of its own.

export function ExperienceEditor({
  id,
  onSaved,
  onDirtyChange,
}: {
  id: string;
  onSaved: (id: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [form, setForm] = useState<ExperienceInput>(blankExperienceInput());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ field: string; message: string; fieldId: string }[]>([]);

  useEffect(() => {
    fetchVendorExperience(id).then((e) => setForm(experienceToInput(e)));
  }, [id]);

  const set = <K extends keyof ExperienceInput>(k: K, v: ExperienceInput[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFieldErrors([]);
    onDirtyChange?.(true);
  };

  const save = async () => {
    const errors: { field: string; message: string; fieldId: string }[] = [];
    if (!form.title.trim()) errors.push({ field: "title", message: "Title is required", fieldId: "experience-title" });
    if (!form.blurb.trim()) errors.push({ field: "blurb", message: "A short blurb is required", fieldId: "experience-blurb" });
    setFieldErrors(errors);
    if (errors.length > 0) return;

    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateVendorExperience(id, form);
      setSaved(true);
      onDirtyChange?.(false);
      onSaved(id);
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
          <label style={labelStyle}>Kind</label>
          <select value={form.kind ?? "experience"} onChange={(e) => set("kind", e.target.value as "adventure" | "experience")} style={inputStyle}>
            <option value="experience">Experience</option>
            <option value="adventure">Adventure</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Title</label>
          <input id="experience-title" value={form.title} onChange={(e) => set("title", e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Difficulty</label>
          <select value={form.difficulty ?? ""} onChange={(e) => set("difficulty", e.target.value)} style={inputStyle}>
            <option value="">— none —</option>
            <option value="easy">Easy</option>
            <option value="moderate">Moderate</option>
            <option value="challenging">Challenging</option>
          </select>
        </div>
      </div>
      <label style={labelStyle}>Short blurb (shown on listing cards)</label>
      <p style={{ fontSize: 12, color: colors.mutedLight, margin: "-4px 0 8px" }}>
        e.g. "A gentle guided coastal walk with sea views, finishing at a local café."
      </p>
      <textarea id="experience-blurb" value={form.blurb} onChange={(e) => set("blurb", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical", marginBottom: 14 }} />
      <label style={labelStyle}>Full description</label>
      <textarea value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
    </>
  );

  const locationFields = (
    <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
      <div>
        <label style={labelStyle}>Area</label>
        <input value={form.area ?? ""} onChange={(e) => set("area", e.target.value)} style={inputStyle} />
      </div>
      <div>
        <label style={labelStyle}>County</label>
        <input value={form.county ?? ""} onChange={(e) => set("county", e.target.value)} style={inputStyle} />
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <label style={labelStyle}>Meeting point</label>
        <input value={form.meetingPoint ?? ""} onChange={(e) => set("meetingPoint", e.target.value)} placeholder="Where participants gather" style={inputStyle} />
      </div>
    </div>
  );

  const pricingFields = (
    <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "end" }}>
      <div>
        <label style={labelStyle}>Duration (minutes)</label>
        <input type="number" value={form.durationMinutes ?? 120} onChange={(e) => set("durationMinutes", Number(e.target.value))} style={{ ...inputStyle, maxWidth: 140 }} />
      </div>
      <div>
        <label style={labelStyle}>Price per person (€)</label>
        <input type="number" value={(form.priceCents ?? 0) / 100} onChange={(e) => set("priceCents", Math.round(Number(e.target.value) * 100))} style={{ ...inputStyle, maxWidth: 140 }} />
      </div>
      <NumberStepper label="Capacity per departure" value={form.capacity ?? 8} onChange={(n) => set("capacity", n)} min={1} />
      <div>
        <label style={labelStyle}>Payment</label>
        <select value={form.paymentMethod ?? "online"} onChange={(e) => set("paymentMethod", e.target.value as "online" | "cash")} style={inputStyle}>
          <option value="online">Online payment</option>
          <option value="cash">Cash on arrival</option>
        </select>
      </div>
    </div>
  );

  const adventureFields = (
    <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
      <div>
        <label style={labelStyle}>Distance (km, optional)</label>
        <input type="number" min={0} step="0.1" value={form.distanceKm ?? ""} onChange={(e) => set("distanceKm", e.target.value ? Number(e.target.value) : null)} style={inputStyle} />
      </div>
      <div>
        <label style={labelStyle}>Elevation gain (m, optional)</label>
        <input type="number" min={0} value={form.elevationGainM ?? ""} onChange={(e) => set("elevationGainM", e.target.value ? Number(e.target.value) : null)} style={inputStyle} />
      </div>
      <div>
        <label style={labelStyle}>Terrain (optional)</label>
        <input value={form.terrainType ?? ""} onChange={(e) => set("terrainType", e.target.value)} placeholder="e.g. Trail & mountain" style={inputStyle} />
      </div>
    </div>
  );

  const prepFields = (
    <>
      <label style={labelStyle}>Itinerary (optional)</label>
      <textarea value={form.itinerary ?? ""} onChange={(e) => set("itinerary", e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical", marginBottom: 14 }} />
      <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div>
          <label style={labelStyle}>Equipment provided (optional)</label>
          <textarea value={form.equipmentProvided ?? ""} onChange={(e) => set("equipmentProvided", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
        <div>
          <label style={labelStyle}>Equipment required (optional)</label>
          <textarea value={form.equipmentRequired ?? ""} onChange={(e) => set("equipmentRequired", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
      </div>
      <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <label style={labelStyle}>Fitness requirements (optional)</label>
          <textarea value={form.fitnessRequirements ?? ""} onChange={(e) => set("fitnessRequirements", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
        <div>
          <label style={labelStyle}>Eligibility (optional, e.g. minimum age)</label>
          <textarea value={form.eligibility ?? ""} onChange={(e) => set("eligibility", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
      </div>
    </>
  );

  const logisticsFields = (
    <>
      <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div>
          <label style={labelStyle}>Transport info (optional)</label>
          <textarea value={form.transportInfo ?? ""} onChange={(e) => set("transportInfo", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
        <div>
          <label style={labelStyle}>Weather policy (optional)</label>
          <textarea value={form.weatherPolicy ?? ""} onChange={(e) => set("weatherPolicy", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
      </div>
      <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <label style={labelStyle}>Safety info (optional)</label>
          <textarea value={form.safetyInfo ?? ""} onChange={(e) => set("safetyInfo", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
        <div>
          <label style={labelStyle}>Cancellation terms (optional)</label>
          <textarea value={form.cancellationTerms ?? ""} onChange={(e) => set("cancellationTerms", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
      </div>
    </>
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

  const prepCount = [form.itinerary, form.equipmentProvided, form.equipmentRequired, form.fitnessRequirements, form.eligibility].filter(Boolean).length;
  const logisticsCount = [form.transportInfo, form.weatherPolicy, form.safetyInfo, form.cancellationTerms].filter(Boolean).length;

  return (
    <>
      <SettingsSection title="General" summary={<>{form.title || "Not set"}{form.blurb && <div style={{ color: colors.mutedLight, fontSize: 13, marginTop: 2 }}>{form.blurb}</div>}</>}>
        {generalFields}
      </SettingsSection>
      <SettingsSection title="Location & meeting" summary={[form.area, form.county].filter(Boolean).join(", ") || "Not set"}>
        {locationFields}
      </SettingsSection>
      <SettingsSection title="Pricing & capacity" summary={`€${((form.priceCents ?? 0) / 100).toFixed(2)}/person · cap ${form.capacity ?? 8} · ${form.durationMinutes ?? 120} min`}>
        {pricingFields}
      </SettingsSection>
      {form.kind === "adventure" && (
        <SettingsSection title="Adventure details" summary={[form.distanceKm ? `${form.distanceKm}km` : null, form.elevationGainM ? `${form.elevationGainM}m gain` : null, form.terrainType].filter(Boolean).join(" · ") || "Not added"}>
          {adventureFields}
        </SettingsSection>
      )}
      <SettingsSection title="Itinerary & what to bring" summary={`${prepCount} of 5 details added`}>
        {prepFields}
      </SettingsSection>
      <SettingsSection title="Logistics & safety" summary={`${logisticsCount} of 4 details added`}>
        {logisticsFields}
      </SettingsSection>
      <SettingsSection title="Photos" summary={`${(form.images ?? []).length} photo${(form.images ?? []).length === 1 ? "" : "s"}`}>
        {photosField}
      </SettingsSection>
      {footer}
    </>
  );
}

// --- departures (bookable sessions) -----------------------------------------

export function SessionsManager({ experienceId }: { experienceId: string }) {
  const [sessions, setSessions] = useState<ExperienceSessionRow[]>([]);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [capacity, setCapacity] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const load = () => {
    fetchVendorExperienceSessions(experienceId).then(setSessions).catch(() => {});
  };
  useEffect(load, [experienceId]);

  const add = async () => {
    if (!date) return;
    setError(null);
    try {
      await addExperienceSession(experienceId, { date, time, capacity: capacity ? Number(capacity) : undefined });
      setDate("");
      setCapacity("");
      setAddOpen(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that departure");
    }
  };

  const remove = async (sessionId: string) => {
    await removeExperienceSession(experienceId, sessionId);
    load();
    setConfirmingId(null);
  };

  return (
    <div style={{ marginTop: 26, paddingTop: 22, borderTop: `1px solid ${colors.border}` }}>
      <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 4px" }}>Departures</h4>
      <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 14px" }}>
        Each departure is one bookable date/time — a guest books a party of one or more spots on a specific departure, not the listing as a whole.
      </p>
      {error && <p style={{ fontSize: 12.5, color: colors.orangeDark, margin: "0 0 10px" }}>{error}</p>}
      {sessions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
          {sessions.map((s) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: colors.bg, borderRadius: radius.control, padding: "8px 12px", fontSize: 13.5 }}>
              <span>
                {s.date} · {s.time}
                {s.capacity ? ` · cap ${s.capacity}` : ""}
                {s.status !== "scheduled" && <span style={{ color: colors.mutedLight }}> · {s.status}</span>}
              </span>
              <button onClick={() => setConfirmingId(s.id)} aria-label="Cancel departure" style={{ background: "none", border: "none", cursor: "pointer", color: colors.faint, display: "flex" }}>
                <TrashIcon size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      {addOpen ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, width: 150 }} />
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ ...inputStyle, width: 110 }} />
          <input value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="Cap (default listing cap)" type="number" style={{ ...inputStyle, width: 180 }} />
          <Button variant="ghost" onClick={add}>
            <PlusIcon size={14} /> Add
          </Button>
          <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
        </div>
      ) : (
        <Button variant="ghost" onClick={() => setAddOpen(true)}>
          <PlusIcon size={14} /> Add departure
        </Button>
      )}

      <ConfirmDialog
        open={!!confirmingId}
        title="Cancel this departure?"
        message="Anyone already booked on it keeps their booking record, but the departure no longer accepts new bookings."
        confirmLabel="Cancel departure"
        onConfirm={() => confirmingId && remove(confirmingId)}
        onCancel={() => setConfirmingId(null)}
      />
    </div>
  );
}

export function BookingsPanel({ experienceId }: { experienceId: string }) {
  const [bookings, setBookings] = useState<VendorExperienceBooking[] | null>(null);

  useEffect(() => {
    fetchVendorExperienceBookings(experienceId).then(setBookings).catch(() => setBookings([]));
  }, [experienceId]);

  if (bookings === null) return null;

  return (
    <div style={{ marginTop: 26, paddingTop: 22, borderTop: `1px solid ${colors.border}` }}>
      <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 14px" }}>Bookings ({bookings.length})</h4>
      {bookings.length === 0 ? (
        <EmptyState icon={<UsersIcon size={20} />} title="No bookings yet" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {bookings.map((b) => (
            <div key={b.id} style={{ fontSize: 13.5, display: "flex", justifyContent: "space-between", background: colors.bg, borderRadius: radius.control, padding: "8px 12px" }}>
              <span>{b.participantName} · party of {b.partySize} · {b.date} {b.time}</span>
              <span style={{ fontWeight: 700 }}>€{(b.totalCents / 100).toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- tab (list only — create/edit lives at VendorExperienceEditPage.tsx) ---

export function VendorExperiencesTab({ onOpenExperience }: { onOpenExperience: (id: string) => void }) {
  const [experiences, setExperiences] = useState<VendorExperienceSummary[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  // Feature flags (implementation backlog #5) — read-only here, admin
  // controls it. Only gates creating a new listing, not editing an
  // already-created one (matches the server-side POST-only 403).
  const [experiencesEnabled, setExperiencesEnabled] = useState(true);

  const load = () => {
    fetchVendorExperiences().then(setExperiences);
  };
  useEffect(load, []);
  useEffect(() => {
    fetchOrgProfile().then((p) => setExperiencesEnabled(p.flags.experiences));
  }, []);

  const remove = async (id: string) => {
    await deleteVendorExperience(id);
    setConfirmingId(null);
    load();
  };

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
        <Button onClick={() => onOpenExperience("new")} disabled={!experiencesEnabled}>
          <PlusIcon size={14} /> Add adventure/experience
        </Button>
        {!experiencesEnabled && (
          <span style={{ fontSize: 11, color: colors.orangeDark }}>Not enabled for your organisation</span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {experiences.map((e) => {
          const palette = STATUS_COLORS[e.status] ?? STATUS_COLORS.pending;
          return (
            <Card key={e.id} hover style={{ padding: 15, display: "flex", justifyContent: "space-between", alignItems: "center" }} onClick={() => onOpenExperience(e.id)}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{e.title}</div>
                <div style={{ fontSize: 12, color: colors.mutedLight, display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                  <CalendarIcon size={12} />
                  {e.kind === "adventure" ? "Adventure" : "Experience"} · {formatPrice(e.priceCents, { each: true })}
                  <span style={{ fontSize: 11, fontWeight: 700, borderRadius: radius.pill, padding: "2px 8px", background: palette.bg, color: palette.fg, textTransform: "capitalize" }}>{e.status}</span>
                </div>
              </div>
              <button
                onClick={(ev) => {
                  ev.stopPropagation();
                  setConfirmingId(e.id);
                }}
                style={{ background: "none", border: "none", cursor: "pointer", color: colors.faint }}
              >
                <TrashIcon size={16} />
              </button>
            </Card>
          );
        })}
        {experiences.length === 0 && (
          <EmptyState icon={<TreeIconSmall size={26} />} title="No adventures or experiences yet" subtitle="Add one above." />
        )}
      </div>

      <ConfirmDialog
        open={confirmingId !== null}
        title="Delete this listing?"
        message="This removes it from public view — existing bookings are kept."
        confirmLabel="Delete"
        onConfirm={() => confirmingId && remove(confirmingId)}
        onCancel={() => setConfirmingId(null)}
      />
    </div>
  );
}
