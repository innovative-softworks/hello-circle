import { ListFilterBar, NoMatches, useListFilters } from "./workspace/ListFilters";
import { useEffect, useRef, useState } from "react";
import { getMediaUrl } from "../media";
import { Compass, QrCode } from "lucide-react";
import { ScanPassModal, readPassCode, type ScanResult } from "./pass/ScanPassModal";
import { useInWorkspace } from "./workspace/inWorkspace";
import { SectionSaveContext, type SectionSave } from "./workspace/sectionSave";
import { ReadinessRail } from "./workspace/SectionCard";
import { AdminButton, AdminModal, Box, FormField, Loaded, errorMessage, useAdminData } from "./admin/adminUi";
import { StatusChipText, WsListTable } from "./workspace/WsListTable";
import { HostChatButton } from "./HostChatButton";
import { VendorCategoryEditor } from "./VendorCategoryEditor";
import { VendorParticipationEditor } from "./VendorParticipationEditor";
import {
  addExperienceSession,
  deleteVendorExperience,
  fetchOrgProfile,
  fetchVendorExperience,
  fetchVendorExperienceBookings,
  markExperienceAttendance,
  moveExperienceBooking,
  fetchVendorExperienceSessions,
  fetchVendorExperiences,
  removeExperienceSession,
  updateExperienceSession,
  updateVendorExperience,
  type ExperienceInput,
} from "../api";
import { CalendarIcon, PlusIcon, TreeIconSmall, TrashIcon, UsersIcon } from "./icons";
import { FieldError, FieldLabel, FormErrorSummary, NumberStepper, RequiredNote, SettingsSection, useFormErrors } from "./form";
import { Button, ManageCard as Card, ConfirmDialog, EmptyState, LoadErrorState, inputStyle, labelStyle } from "./ui";
import { MultiImageUpload } from "./VendorImageUpload";
import { colors, fonts, radius } from "../theme";
import type { Experience, ExperienceSessionRow, VendorExperienceBooking, VendorExperienceSummary } from "../types";
import { formatPrice } from "../formatters";
import { irelandToday } from "../irelandDate";
import { PaidClosedPriceNotice } from "./PaidClosedPriceNotice";

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
    skillsRequired: e.skillsRequired ?? "",
    cause: e.cause ?? "",
    minAge: e.minAge ?? null,
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
  const [saved, setSaved] = useState(false);
  const fe = useFormErrors();
  // A failed load hides the form so a blank form can't be saved over the real listing.
  const [loadState, setLoadState] = useState<"loading" | "ready" | "failed">("loading");

  const load = () => {
    setLoadState("loading");
    fetchVendorExperience(id)
      .then((e) => {
        setForm(experienceToInput(e));
        setLoadState("ready");
      })
      .catch(() => setLoadState("failed"));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [id]);

  const set = <K extends keyof ExperienceInput>(k: K, v: ExperienceInput[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    fe.clearField(`experience-${String(k)}`);
    onDirtyChange?.(true);
  };

  const save = async (): Promise<boolean> => {
    const errors: { field: string; message: string; fieldId: string }[] = [];
    if (!form.title.trim()) errors.push({ field: "title", message: "Title is required", fieldId: "experience-title" });
    if (!form.blurb.trim()) errors.push({ field: "blurb", message: "A short blurb is required", fieldId: "experience-blurb" });
    if (errors.length > 0) {
      fe.fail(errors);
      return false;
    }
    if (saving) return false;

    fe.clear();
    setSaving(true);
    setSaved(false);
    try {
      await updateVendorExperience(id, form);
      setSaved(true);
      onDirtyChange?.(false);
      onSaved(id);
      return true;
    } catch (e) {
      // Everything typed stays in the form; the reason goes in the summary.
      fe.fail([{ field: "save", message: `Couldn't save: ${e instanceof Error ? e.message : "please try again"}` }]);
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Workspace popups (option A) — see VendorCentreEditor.tsx's identical block.
  const snapshot = useRef<ExperienceInput | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const currentSnapshot = () => (form);
  const sectionSave: SectionSave = {
    save,
    saving,
    errors: fe.errors,
    focusKey: fe.focusKey,
    isDirty: () => JSON.stringify(snapshot.current) !== JSON.stringify(currentSnapshot()),
    openKey,
    setOpenKey,
    begin: () => {
      snapshot.current = form;
    },
    cancel: () => {
      if (snapshot.current) setForm(snapshot.current);
      fe.clear();
      onDirtyChange?.(false);
    },
    draft: {
      key: `experience:${id}`,
      get: currentSnapshot,
      restore: (v) => {
        setForm(v as ExperienceInput);
        onDirtyChange?.(true);
      },
    },
  };
  const inWorkspace = useInWorkspace();

  // --- field groups, composed differently depending on mode below ---------

  const generalFields = (
    <>
      <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div>
          <FieldLabel htmlFor="experience-kind">Kind</FieldLabel>
          <select id="experience-kind" value={form.kind ?? "experience"} onChange={(e) => set("kind", e.target.value as "adventure" | "experience" | "volunteer")} style={inputStyle}>
            <option value="experience">Experience</option>
            <option value="adventure">Adventure</option>
            <option value="volunteer">Volunteer opportunity</option>
          </select>
        </div>
        <div>
          <FieldLabel htmlFor="experience-title" required>Title</FieldLabel>
          <input {...fe.control("experience-title")} required value={form.title} onChange={(e) => set("title", e.target.value)} style={inputStyle} />
          <FieldError fieldId="experience-title" message={fe.messageFor("experience-title")} />
        </div>
        <div>
          <FieldLabel htmlFor="experience-difficulty">Difficulty</FieldLabel>
          <select id="experience-difficulty" value={form.difficulty ?? ""} onChange={(e) => set("difficulty", e.target.value)} style={inputStyle}>
            <option value="">— none —</option>
            <option value="easy">Easy</option>
            <option value="moderate">Moderate</option>
            <option value="challenging">Challenging</option>
          </select>
        </div>
      </div>
      <FieldLabel htmlFor="experience-blurb" required>Short blurb (shown on listing cards)</FieldLabel>
      <p id="experience-blurb-helper" style={{ fontSize: 12, color: colors.mutedLight, margin: "-4px 0 8px" }}>
        e.g. "A gentle guided coastal walk with sea views, finishing at a local café."
      </p>
      <textarea {...fe.control("experience-blurb", "experience-blurb-helper")} required value={form.blurb} onChange={(e) => set("blurb", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical", marginBottom: fe.messageFor("experience-blurb") ? 0 : 14 }} />
      <FieldError fieldId="experience-blurb" message={fe.messageFor("experience-blurb")} />
      <FieldLabel htmlFor="experience-full-description" optional style={{ marginTop: fe.messageFor("experience-blurb") ? 14 : 0 }}>Full description</FieldLabel>
      <textarea id="experience-full-description" value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
      {form.kind === "volunteer" && (
        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
          <div>
            <FieldLabel htmlFor="experience-cause" optional>Cause</FieldLabel>
            <input id="experience-cause" value={form.cause ?? ""} maxLength={100} onChange={(e) => set("cause", e.target.value)} placeholder="e.g. Coastal clean-up" style={inputStyle} />
          </div>
          <div>
            <FieldLabel htmlFor="experience-minimum-age" optional>Minimum age</FieldLabel>
            <input id="experience-minimum-age" type="number" min={0} value={form.minAge ?? ""} onChange={(e) => set("minAge", e.target.value ? Number(e.target.value) : null)} style={{ ...inputStyle, maxWidth: 120 }} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <FieldLabel htmlFor="experience-skills-needed" optional>Skills needed</FieldLabel>
            <input id="experience-skills-needed" value={form.skillsRequired ?? ""} onChange={(e) => set("skillsRequired", e.target.value)} placeholder="e.g. None — we'll show you what to do" style={inputStyle} />
          </div>
        </div>
      )}
    </>
  );

  const locationFields = (
    <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
      <div>
        <FieldLabel htmlFor="experience-area" optional>Area</FieldLabel>
        <input id="experience-area" value={form.area ?? ""} onChange={(e) => set("area", e.target.value)} style={inputStyle} />
      </div>
      <div>
        <FieldLabel htmlFor="experience-county" optional>County</FieldLabel>
        <input id="experience-county" value={form.county ?? ""} onChange={(e) => set("county", e.target.value)} style={inputStyle} />
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <FieldLabel htmlFor="experience-meeting-point" optional>Meeting point</FieldLabel>
        <input id="experience-meeting-point" value={form.meetingPoint ?? ""} onChange={(e) => set("meetingPoint", e.target.value)} placeholder="Where participants gather" style={inputStyle} />
      </div>
    </div>
  );

  const pricingFields = (
    <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "end" }}>
      <div>
        <FieldLabel htmlFor="experience-settings-duration">Duration (minutes)</FieldLabel>
        <input id="experience-settings-duration" type="number" value={form.durationMinutes ?? 120} onChange={(e) => set("durationMinutes", Number(e.target.value))} style={{ ...inputStyle, maxWidth: 140 }} />
      </div>
      <div>
        <FieldLabel htmlFor="experience-settings-price">Price per person (€)</FieldLabel>
        {form.kind === "volunteer" ? (
          <p style={{ fontSize: 13, color: colors.mutedLight, margin: 0 }}>Volunteering is always free to sign up for.</p>
        ) : (
          <input id="experience-settings-price" type="number" value={(form.priceCents ?? 0) / 100} onChange={(e) => set("priceCents", Math.round(Number(e.target.value) * 100))} style={{ ...inputStyle, maxWidth: 140 }} />
        )}
        {form.kind !== "volunteer" && <PaidClosedPriceNotice amount={form.priceCents} paymentMethod={form.paymentMethod ?? "online"} />}
      </div>
      <NumberStepper label="Capacity per departure" value={form.capacity ?? 8} onChange={(n) => set("capacity", n)} min={1} />
      <div>
        <FieldLabel htmlFor="experience-settings-payment">Payment</FieldLabel>
        <select id="experience-settings-payment" value={form.paymentMethod ?? "online"} onChange={(e) => set("paymentMethod", e.target.value as "online" | "cash")} style={inputStyle}>
          <option value="online">Online payment</option>
          <option value="cash">Cash on arrival</option>
        </select>
      </div>
    </div>
  );

  const adventureFields = (
    <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
      <div>
        <FieldLabel htmlFor="experience-distance" optional>Distance (km)</FieldLabel>
        <input id="experience-distance" type="number" min={0} step="0.1" value={form.distanceKm ?? ""} onChange={(e) => set("distanceKm", e.target.value ? Number(e.target.value) : null)} style={inputStyle} />
      </div>
      <div>
        <FieldLabel htmlFor="experience-elevation-gain" optional>Elevation gain (m)</FieldLabel>
        <input id="experience-elevation-gain" type="number" min={0} value={form.elevationGainM ?? ""} onChange={(e) => set("elevationGainM", e.target.value ? Number(e.target.value) : null)} style={inputStyle} />
      </div>
      <div>
        <FieldLabel htmlFor="experience-terrain" optional>Terrain</FieldLabel>
        <input id="experience-terrain" value={form.terrainType ?? ""} onChange={(e) => set("terrainType", e.target.value)} placeholder="e.g. Trail & mountain" style={inputStyle} />
      </div>
    </div>
  );

  const prepFields = (
    <>
      <FieldLabel htmlFor="experience-itinerary" optional>Itinerary</FieldLabel>
      <textarea id="experience-itinerary" value={form.itinerary ?? ""} onChange={(e) => set("itinerary", e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical", marginBottom: 14 }} />
      <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div>
          <FieldLabel htmlFor="experience-equipment-provided" optional>Equipment provided</FieldLabel>
          <textarea id="experience-equipment-provided" value={form.equipmentProvided ?? ""} onChange={(e) => set("equipmentProvided", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
        <div>
          <FieldLabel htmlFor="experience-equipment-required" optional>Equipment required</FieldLabel>
          <textarea id="experience-equipment-required" value={form.equipmentRequired ?? ""} onChange={(e) => set("equipmentRequired", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
      </div>
      <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <FieldLabel htmlFor="experience-fitness-requirements" optional>Fitness requirements</FieldLabel>
          <textarea id="experience-fitness-requirements" value={form.fitnessRequirements ?? ""} onChange={(e) => set("fitnessRequirements", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
        <div>
          <FieldLabel htmlFor="experience-eligibility" optional>Eligibility (e.g. minimum age)</FieldLabel>
          <textarea id="experience-eligibility" value={form.eligibility ?? ""} onChange={(e) => set("eligibility", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
      </div>
    </>
  );

  const logisticsFields = (
    <>
      <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div>
          <FieldLabel htmlFor="experience-transport-info" optional>Transport info</FieldLabel>
          <textarea id="experience-transport-info" value={form.transportInfo ?? ""} onChange={(e) => set("transportInfo", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
        <div>
          <FieldLabel htmlFor="experience-weather-policy" optional>Weather policy</FieldLabel>
          <textarea id="experience-weather-policy" value={form.weatherPolicy ?? ""} onChange={(e) => set("weatherPolicy", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
      </div>
      <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <FieldLabel htmlFor="experience-safety-info" optional>Safety info</FieldLabel>
          <textarea id="experience-safety-info" value={form.safetyInfo ?? ""} onChange={(e) => set("safetyInfo", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
        <div>
          <FieldLabel htmlFor="experience-cancellation-terms" optional>Cancellation terms</FieldLabel>
          <textarea id="experience-cancellation-terms" value={form.cancellationTerms ?? ""} onChange={(e) => set("cancellationTerms", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
      </div>
    </>
  );

  const photosField = (
    <MultiImageUpload images={form.images ?? []} onChange={(images) => set("images", images)} mediaEntityType="experience-gallery" mediaEntityId={id} />
  );

  const footer = (
    <>
      <FormErrorSummary errors={fe.errors} focusKey={fe.focusKey} />
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18 }}>
        <Button variant="primary" disabled={saving} onClick={save} aria-busy={saving || undefined}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
        {saved && <span style={{ fontSize: 13, color: colors.greenText, fontWeight: 600 }}>Saved</span>}
      </div>
    </>
  );

  const prepCount = [form.itinerary, form.equipmentProvided, form.equipmentRequired, form.fitnessRequirements, form.eligibility].filter(Boolean).length;
  const logisticsCount = [form.transportInfo, form.weatherPolicy, form.safetyInfo, form.cancellationTerms].filter(Boolean).length;

  if (loadState === "failed") return <LoadErrorState title="Couldn't load this experience's details." onRetry={load} />;
  if (loadState === "loading") return <p style={{ fontSize: 13.5, color: colors.mutedLight }}>Loading experience details…</p>;

  if (inWorkspace) {
    const checks = [
      { label: "Title and blurb", done: !!form.title.trim() && !!form.blurb.trim(), section: "General" },
      { label: "Where it starts", done: !!form.area?.trim() && !!form.county?.trim(), section: "Location & meeting" },
      { label: "Price and places", done: form.capacity != null, section: "Pricing & capacity" },
      { label: "Itinerary and kit", done: prepCount >= 2, section: "Itinerary & what to bring" },
      { label: "Logistics and safety", done: logisticsCount >= 2, section: "Logistics & safety" },
      { label: "Photos", done: (form.images ?? []).length > 0, section: "Photos" },
    ];
    const cover = (form.images ?? [])[0];
    return (
      <SectionSaveContext.Provider value={sectionSave}>
        <div className="ws-editor">
          <div className="ws-sec-grid">
      <SettingsSection title="General" forceOpen={fe.has("experience-title", "experience-blurb")} fieldIds={["experience-title", "experience-blurb"]} summary={<>{form.title || "Not set"}{form.blurb && <div style={{ color: colors.mutedLight, fontSize: 13, marginTop: 2 }}>{form.blurb}</div>}</>}>
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
      <VendorCategoryEditor type="experience" id={id} />
      <VendorParticipationEditor type="experience" id={id} />
      <SettingsSection title="Photos" summary={`${(form.images ?? []).length} photo${(form.images ?? []).length === 1 ? "" : "s"}`}>
        {photosField}
      </SettingsSection>
          </div>
          <ReadinessRail
            checks={checks}
            onFix={setOpenKey}
            preview={{ image: cover ? getMediaUrl(cover, "card") : null, title: form.title || "Your experience", meta: [form.area, form.kind === "volunteer" ? "Free" : `€${((form.priceCents ?? 0) / 100).toFixed(2)} per person`].filter(Boolean).join(" · "), icon: Compass }}
          />
        </div>
      </SectionSaveContext.Provider>
    );
  }

  return (
    <>
      <RequiredNote />
      <SettingsSection title="General" forceOpen={fe.has("experience-title", "experience-blurb")} fieldIds={["experience-title", "experience-blurb"]} summary={<>{form.title || "Not set"}{form.blurb && <div style={{ color: colors.mutedLight, fontSize: 13, marginTop: 2 }}>{form.blurb}</div>}</>}>
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
      <VendorCategoryEditor type="experience" id={id} />
      <VendorParticipationEditor type="experience" id={id} />
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
  const [repeatWeeks, setRepeatWeeks] = useState("1");
  const [closeHours, setCloseHours] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ExperienceSessionRow | null>(null);

  const [sessionsFailed, setSessionsFailed] = useState(false);
  const load = () => {
    setSessionsFailed(false);
    fetchVendorExperienceSessions(experienceId)
      .then(setSessions)
      .catch(() => setSessionsFailed(true));
  };
  useEffect(load, [experienceId]);

  const add = async () => {
    if (!date) return;
    setError(null);
    try {
      await addExperienceSession(experienceId, {
        date,
        time,
        capacity: capacity ? Number(capacity) : undefined,
        repeatWeeks: Number(repeatWeeks) || 1,
        salesCloseHours: closeHours ? Number(closeHours) : undefined,
      });
      setDate("");
      setCapacity("");
      setRepeatWeeks("1");
      setCloseHours("");
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
      <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 4px" }}>Departures</h2>
      <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 14px" }}>
        Each departure is one bookable date/time — a guest books a party of one or more spots on a specific departure, not the listing as a whole.
      </p>
      {error && <p style={{ fontSize: 12.5, color: colors.orangeDark, margin: "0 0 10px" }}>{error}</p>}
      {sessionsFailed && (
        <div style={{ marginBottom: 14 }}>
          <LoadErrorState title="Couldn't load departures." detail="Existing departures aren't shown until this loads." onRetry={load} />
        </div>
      )}
      {sessions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
          {sessions.map((s) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: colors.bg, borderRadius: radius.control, padding: "8px 12px", fontSize: 13.5 }}>
              <span>
                {s.date} · {s.time}
                {s.capacity ? ` · cap ${s.capacity}` : ""}
                {s.salesCloseAt && <span style={{ color: colors.mutedLight }}> · bookings close {closeLabel(s.salesCloseAt)}</span>}
                {s.seriesId && <span style={{ color: colors.mutedLight }}> · weekly</span>}
                {s.status !== "scheduled" && <span style={{ color: colors.mutedLight }}> · {s.status}</span>}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
                {s.status === "scheduled" && (
                  <button onClick={() => setEditing(s)} aria-label={`Edit departure ${s.date} ${s.time}`} style={{ background: "none", border: "none", cursor: "pointer", color: colors.muted, fontSize: 12.5, fontWeight: 700, textDecoration: "underline", padding: 0 }}>
                    Edit
                  </button>
                )}
                {s.status !== "cancelled" && <HostChatButton scopeType="experience_session" scopeId={s.id} title={`Departure ${s.date} · ${s.time}`} />}
                <button onClick={() => setConfirmingId(s.id)} aria-label="Cancel departure" style={{ background: "none", border: "none", cursor: "pointer", color: colors.faint, display: "flex" }}>
                  <TrashIcon size={14} />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      {addOpen ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Departure date" style={{ ...inputStyle, width: 150 }} />
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Departure time" style={{ ...inputStyle, width: 110 }} />
          <input value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="Cap (default listing cap)" aria-label="Capacity (default: the listing's capacity)" type="number" style={{ ...inputStyle, width: 180 }} />
          <input value={repeatWeeks} onChange={(e) => setRepeatWeeks(e.target.value)} aria-label="Repeat weekly for this many weeks" title="Repeat weekly for this many weeks" type="number" min={1} max={26} style={{ ...inputStyle, width: 90 }} />
          <input value={closeHours} onChange={(e) => setCloseHours(e.target.value)} placeholder="Stop sales (hours before)" aria-label="Stop sales this many hours before" type="number" min={0} style={{ ...inputStyle, width: 190 }} />
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
      {editing && (
        <EditDepartureDialog
          session={editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            await updateExperienceSession(experienceId, editing.id, input);
            load();
          }}
        />
      )}
    </div>
  );
}

const closeLabel = (iso: string) =>
  new Date(iso).toLocaleString("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// OG-19 — one departure's capacity and booking cut-off. The server refuses a
// capacity below the places already taken.
function EditDepartureDialog({
  session,
  onClose,
  onSave,
}: {
  session: ExperienceSessionRow;
  onClose: () => void;
  onSave: (input: { capacity?: number; salesCloseHours?: number | null }) => Promise<void>;
}) {
  const [capacity, setCapacity] = useState(session.capacity ? String(session.capacity) : "");
  const [closeHours, setCloseHours] = useState("");
  const [clearClose, setClearClose] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const input: { capacity?: number; salesCloseHours?: number | null } = {};
    if (capacity) {
      const n = Number(capacity);
      if (!Number.isInteger(n) || n < 1) return setError("Capacity must be a whole number of at least 1");
      input.capacity = n;
    }
    if (clearClose) input.salesCloseHours = null;
    else if (closeHours) {
      const h = Number(closeHours);
      if (!Number.isInteger(h) || h < 0 || h > 720) return setError("Close bookings between 0 and 720 hours before the start");
      input.salesCloseHours = h;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(input);
      onClose();
    } catch (e) {
      setError(errorMessage(e, "Couldn't save that departure"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AdminModal
      open
      onClose={onClose}
      title="Edit departure"
      subtitle={`${session.date} · ${session.time}. Prices don't change.`}
      footer={
        <>
          <AdminButton variant="quiet" onClick={onClose}>
            Cancel
          </AdminButton>
          <AdminButton variant="primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save departure"}
          </AdminButton>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <FormField label="Capacity (optional)" hint="Leave blank to keep the current capacity. It can't go below the places already taken.">
          {(p) => <input {...p} type="number" min={1} className="adm-input" value={capacity} onChange={(e) => setCapacity(e.target.value)} />}
        </FormField>
        <FormField
          label="Stop bookings this many hours before the start (optional)"
          hint={session.salesCloseAt ? `Bookings currently close ${closeLabel(session.salesCloseAt)}.` : "Bookings are currently open until the start."}
          error={error}
        >
          {(p) => <input {...p} type="number" min={0} max={720} className="adm-input" value={closeHours} disabled={clearClose} onChange={(e) => setCloseHours(e.target.value)} />}
        </FormField>
        {session.salesCloseAt && (
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5 }}>
            <input type="checkbox" checked={clearClose} onChange={(e) => setClearClose(e.target.checked)} /> Keep bookings open until the start
          </label>
        )}
      </div>
    </AdminModal>
  );
}

// OG-19 — move a booking to another departure. Only when the customer asked
// for it; a change the partner wants needs the customer's agreement (DEC-17),
// so the dialog says to cancel instead. Same booking, same payment.
function MoveBookingDialog({
  booking,
  departures,
  onClose,
  onMove,
}: {
  booking: VendorExperienceBooking;
  departures: ExperienceSessionRow[];
  onClose: () => void;
  onMove: (input: { sessionId: string; note?: string }) => Promise<void>;
}) {
  const [sessionId, setSessionId] = useState(departures[0]?.id ?? "");
  const [asked, setAsked] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!sessionId) return setError("Choose the departure to move to");
    if (!asked) return setError("Confirm the customer asked for this move");
    setBusy(true);
    setError(null);
    try {
      await onMove({ sessionId, note: note.trim() || undefined });
      onClose();
    } catch (e) {
      setError(errorMessage(e, "Couldn't move that booking"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AdminModal
      open
      onClose={onClose}
      dirty={asked || !!note}
      title={`Move ${booking.participantName}'s booking`}
      subtitle={`Now ${booking.date} · ${booking.time}, party of ${booking.partySize}. Same booking, same payment. If the customer didn't ask for this, cancel the booking instead — they're refunded in full.`}
      footer={
        <>
          <AdminButton variant="quiet" onClick={onClose}>
            Cancel
          </AdminButton>
          <AdminButton variant="primary" onClick={submit} disabled={busy || departures.length === 0}>
            {busy ? "Moving…" : "Move booking"}
          </AdminButton>
        </>
      }
    >
      {departures.length === 0 ? (
        <p style={{ margin: 0 }}>There's no other upcoming departure to move to. Add one under Departures first.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <FormField label="Move to" required>
            {(p) => (
              <select {...p} className="adm-select" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
                {departures.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.date} · {d.time}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label="Note (optional)" hint="Kept in the activity log.">
            {(p) => <textarea {...p} rows={2} className="adm-input" value={note} onChange={(e) => setNote(e.target.value)} style={{ resize: "vertical" }} />}
          </FormField>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13.5 }}>
            <input type="checkbox" checked={asked} onChange={(e) => setAsked(e.target.checked)} style={{ marginTop: 3 }} /> The customer asked to move to this departure
          </label>
          {error && (
            <p role="alert" style={{ margin: 0, color: colors.danger, fontSize: 13 }}>
              {error}
            </p>
          )}
        </div>
      )}
    </AdminModal>
  );
}

// Release 3 — experiences had no attendance at all. Once a session date has
// arrived, the host marks each booking attended or no-show; that's what
// lets the guest's "How was it?" and next steps appear (or not).
function ExperienceAttendance({ status, onMark }: { status: string | null; onMark: (status: "present" | "no_show") => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const mark = async (s: "present" | "no_show") => {
    setBusy(true);
    try {
      await onMark(s);
    } finally {
      setBusy(false);
    }
  };
  const link = { fontSize: 12, fontWeight: 700, color: colors.muted, background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" } as const;
  if (status === "present") return <span style={{ fontSize: 11.5, fontWeight: 700, color: colors.greenText }}>Attended</span>;
  if (status === "no_show")
    return (
      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: colors.orangeDark }}>No-show</span>
        <button disabled={busy} onClick={() => mark("present")} style={link}>Undo</button>
      </span>
    );
  return (
    <span style={{ display: "flex", gap: 10 }}>
      <button disabled={busy} onClick={() => mark("present")} style={link}>Attended</button>
      <button disabled={busy} onClick={() => mark("no_show")} style={link}>No-show</button>
    </span>
  );
}

export function BookingsPanel({ experienceId }: { experienceId: string }) {
  const [bookings, setBookings] = useState<VendorExperienceBooking[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [sessions, setSessions] = useState<ExperienceSessionRow[]>([]);
  const [moving, setMoving] = useState<VendorExperienceBooking | null>(null);
  const [scanning, setScanning] = useState(false);
  const today = irelandToday();

  const load = () => {
    setFailed(false);
    fetchVendorExperienceBookings(experienceId)
      .then(setBookings)
      .catch(() => setFailed(true));
    fetchVendorExperienceSessions(experienceId)
      .then(setSessions)
      .catch(() => setSessions([]));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [experienceId]);

  // Scan passes (owner 2026-10-27): an experience pass holds its booking reference.
  const onScan = async (text: string): Promise<ScanResult> => {
    const code = readPassCode(text);
    if (!code) return { ok: false, message: "That isn't a HelloCircle pass." };
    if (code.kind !== "experience") return { ok: false, message: "That pass isn't for an experience." };
    const b = (bookings ?? []).find((x) => x.ref.toUpperCase() === code.ref);
    if (!b) return { ok: false, message: "That booking isn't for this listing." };
    if (b.status === "cancelled") return { ok: false, message: `${b.participantName}: this booking was cancelled.` };
    if (b.date !== today) return { ok: false, message: `${b.participantName} is booked for ${b.date}, not today.` };
    if (b.attendance === "present") return { ok: true, message: `${b.participantName} is already checked in.` };
    await markExperienceAttendance(experienceId, b.ref, "present");
    setBookings((prev) => (prev ?? []).map((x) => (x.ref === b.ref ? { ...x, attendance: "present" } : x)));
    return { ok: true, message: `Checked in: ${b.participantName} (party of ${b.partySize})` };
  };

  if (failed) return <div style={{ marginTop: 26 }}><LoadErrorState title="Couldn't load bookings for this listing." onRetry={load} /></div>;
  if (bookings === null) return <p role="status" aria-busy="true" style={{ marginTop: 26, fontSize: 13.5, color: colors.mutedLight }}>Loading bookings…</p>;

  return (
    <div style={{ marginTop: 26, paddingTop: 22, borderTop: `1px solid ${colors.border}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, margin: "0 0 14px" }}>
        <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: 0 }}>Bookings ({bookings.length})</h2>
        {bookings.some((b) => b.date === today && b.status !== "cancelled") && (
          <AdminButton size="sm" onClick={() => setScanning(true)}>
            <QrCode size={15} aria-hidden="true" /> Scan passes
          </AdminButton>
        )}
      </div>
      <ScanPassModal open={scanning} title="Scan passes · today's departures" onClose={() => setScanning(false)} onCode={onScan} />
      {bookings.length === 0 ? (
        <EmptyState icon={<UsersIcon size={20} />} title="No bookings yet" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {bookings.map((b) => (
            <div key={b.id} style={{ fontSize: 13.5, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", background: colors.bg, borderRadius: radius.control, padding: "8px 12px" }}>
              <span>
                {b.participantName} · party of {b.partySize} · {b.date} {b.time}
                {/* Participation Phase 1 — what this booking bought (frozen at purchase). */}
                {b.lines && b.lines.length > 0 && (
                  <span style={{ display: "block", fontSize: 12.5, color: colors.muted }}>
                    {b.lines.filter((l) => l.quantity > 0).map((l) => `${l.label} × ${l.quantity}`).join(" · ")}
                  </span>
                )}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {b.status !== "cancelled" && b.date <= today && (
                  <ExperienceAttendance
                    status={b.attendance ?? null}
                    onMark={async (status) => {
                      await markExperienceAttendance(experienceId, b.ref, status);
                      setBookings((prev) => (prev ?? []).map((x) => (x.ref === b.ref ? { ...x, attendance: status } : x)));
                    }}
                  />
                )}
                {b.status !== "cancelled" && b.date >= today && (
                  <button onClick={() => setMoving(b)} aria-label={`Move ${b.participantName}'s booking`} style={{ fontSize: 12, fontWeight: 700, color: colors.muted, background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" }}>
                    Move
                  </button>
                )}
                <span style={{ fontWeight: 700 }}>€{(b.totalCents / 100).toFixed(2)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      {moving && (
        <MoveBookingDialog
          booking={moving}
          departures={sessions.filter((s) => s.status === "scheduled" && s.id !== moving.sessionId && s.date >= today)}
          onClose={() => setMoving(null)}
          onMove={async (input) => {
            await moveExperienceBooking(experienceId, moving.id, { ...input, customerAsked: true });
            load();
          }}
        />
      )}
    </div>
  );
}

// --- tab (list only — create/edit lives at VendorExperienceEditPage.tsx) ---

export function VendorExperiencesTab({ onOpenExperience }: { onOpenExperience: (id: string) => void }) {
  const state = useAdminData<VendorExperienceSummary[]>(() => fetchVendorExperiences());
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  // Feature flags (implementation backlog #5) — read-only here, admin
  // controls it. Only gates creating a new listing, not editing an
  // already-created one (matches the server-side POST-only 403).
  const [experiencesEnabled, setExperiencesEnabled] = useState(true);

  useEffect(() => {
    // Only decides whether "Add" is offered; the server enforces the flag.
    fetchOrgProfile()
      .then((p) => setExperiencesEnabled(p.flags.experiences))
      .catch(() => {});
  }, []);

  const remove = async (id: string) => {
    await deleteVendorExperience(id);
    setConfirmingId(null);
    state.reload();
  };

  const KIND_LABEL = { adventure: "Adventure", volunteer: "Volunteer", experience: "Experience", event: "Community event" } as Record<string, string>;
  const filters = useListFilters<VendorExperienceSummary>({
    search: (e) => [e.title],
    selects: [
      { param: "kind", label: "Type", options: [{ value: "adventure", label: "Adventures" }, { value: "experience", label: "Experiences" }, { value: "volunteer", label: "Volunteering" }, { value: "event", label: "Community events" }], get: (e) => e.kind },
      { param: "status", label: "Status", options: [{ value: "draft", label: "Draft" }, { value: "pending", label: "Pending review" }, { value: "approved", label: "Live" }, { value: "rejected", label: "Rejected" }], get: (e) => e.status },
    ],
  });
  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!experiencesEnabled && <p className="adm-note" style={{ margin: 0 }}>Adventures and experiences aren't enabled for your organisation, so you can't add new ones.</p>}
      <Box flush>
        <Loaded state={state} title="Couldn't load your adventures and experiences">
          {(experiences) => experiences.length === 0 ? (
            <EmptyState
              icon={<Compass size={20} />}
              title="No adventures or experiences yet"
              subtitle="Guided walks, workshops, trips: anything people book a place on for a set date."
              action={
                experiencesEnabled ? (
                  <AdminButton variant="primary" onClick={() => onOpenExperience("new")}>
                    Add adventure or experience
                  </AdminButton>
                ) : undefined
              }
            />
          ) : (
            <>
            {experiences.length > 4 && <ListFilterBar state={filters} searchLabel="Search adventures and experiences" placeholder="Title" />}
            {filters.apply(experiences).length === 0 ? (
              <NoMatches onClear={filters.clear} noun="listings" />
            ) : (
            <WsListTable
              caption="Your adventures and experiences"
              columns={[{ label: "Listing" }, { label: "Type" }, { label: "Status" }, { label: "Price", num: true }]}
              rows={filters.apply(experiences).map((e) => ({
                key: e.id,
                name: e.title,
                title: e.title,
                leading: (
                  <span className="ws-thumb ws-thumb--empty" aria-hidden="true">
                    <Compass size={18} strokeWidth={1.9} />
                  </span>
                ),
                cells: [KIND_LABEL[e.kind] ?? "Experience", <StatusChipText status={e.status} />, e.kind === "volunteer" ? "Free" : formatPrice(e.priceCents, { each: true })],
                onOpen: () => onOpenExperience(e.id),
                openLabel: "Manage",
                menu: [{ label: "Delete listing…", danger: true, onSelect: () => setConfirmingId(e.id) }],
              }))}
            />
            )}
            </>
          )}
        </Loaded>
      </Box>

      <ConfirmDialog
        open={confirmingId !== null}
        title="Delete this listing?"
        message="This removes it from public view — existing bookings are kept."
        confirmLabel="Delete listing"
        onConfirm={() => confirmingId && remove(confirmingId)}
        onCancel={() => setConfirmingId(null)}
      />
    </div>
  );
}
