import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createVendorExperience,
  fetchVendorExperience,
  publishVendorExperience,
  updateVendorExperience,
} from "../api";
import { AddressSearch, MapConfirm } from "./AddressSearch";
import { GuidedFlow } from "./GuidedFlow";
import { NumberStepper } from "./form";
import { Card, inputStyle, labelStyle } from "./ui";
import { MultiImageUpload } from "./VendorImageUpload";
import { colors, fonts, radius } from "../theme";
import type { Experience } from "../types";

// Guided Flow creation wizard for an Adventure/Experience listing (Form
// System Audit, Phase 5 fast-follow to Centre/Club — same reasoning: this
// replaces what used to be one 20+-field flat form on "new"). Creates a
// real 'draft' row after step 1 (see server/src/routes/vendorExperiences.ts's
// relaxed POST /experiences) so leaving and coming back is real, not just a
// client-side promise — each later step's "Save & continue" persists via
// the same PUT the settings-view editor already uses, then POST /publish on
// the final step flips draft → pending.

const STEP_LABELS = ["Basics", "Location", "Pricing", "Prep & logistics", "Photos", "Review"];

interface WizardForm {
  kind: "adventure" | "experience";
  title: string;
  difficulty: string;
  blurb: string;
  description: string;
  area: string;
  county: string;
  lat?: number;
  lng?: number;
  /** See CentreCreationWizard.tsx's identical field/comment. */
  locationConfirmed: boolean;
  meetingPoint: string;
  durationMinutes: number;
  priceCents: number;
  capacity: number;
  paymentMethod: "online" | "cash";
  distanceKm: number | null;
  elevationGainM: number | null;
  terrainType: string;
  itinerary: string;
  equipmentProvided: string;
  equipmentRequired: string;
  fitnessRequirements: string;
  eligibility: string;
  transportInfo: string;
  weatherPolicy: string;
  safetyInfo: string;
  cancellationTerms: string;
  images: string[];
}

function blankForm(): WizardForm {
  return {
    kind: "experience",
    title: "",
    difficulty: "",
    blurb: "",
    description: "",
    area: "",
    county: "",
    locationConfirmed: false,
    meetingPoint: "",
    durationMinutes: 120,
    priceCents: 0,
    capacity: 8,
    paymentMethod: "online",
    distanceKm: null,
    elevationGainM: null,
    terrainType: "",
    itinerary: "",
    equipmentProvided: "",
    equipmentRequired: "",
    fitnessRequirements: "",
    eligibility: "",
    transportInfo: "",
    weatherPolicy: "",
    safetyInfo: "",
    cancellationTerms: "",
    images: [],
  };
}

export function ExperienceCreationWizard({
  initialExperienceId,
  onDirtyChange,
  onPublished,
}: {
  initialExperienceId: string | "new";
  onDirtyChange?: (dirty: boolean) => void;
  onPublished: (id: string) => void;
}) {
  const navigate = useNavigate();
  const [id, setId] = useState<string | "new">(initialExperienceId);
  const [step, setStep] = useState(1);
  const [form, setFormRaw] = useState<WizardForm>(blankForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(initialExperienceId === "new");

  const setForm = (patch: Partial<WizardForm>) => {
    setFormRaw((f) => ({ ...f, ...patch }));
    onDirtyChange?.(true);
  };

  useEffect(() => {
    if (initialExperienceId === "new") return;
    fetchVendorExperience(initialExperienceId).then((e: Experience) => {
      setFormRaw({
        kind: e.kind,
        title: e.title,
        difficulty: e.difficulty,
        blurb: e.blurb,
        description: e.description,
        area: e.area,
        county: e.county,
        locationConfirmed: false,
        lat: e.lat ?? undefined,
        lng: e.lng ?? undefined,
        meetingPoint: e.meetingPoint,
        durationMinutes: e.durationMinutes,
        priceCents: e.priceCents,
        capacity: e.capacity,
        paymentMethod: e.paymentMethod,
        distanceKm: e.distanceKm,
        elevationGainM: e.elevationGainM,
        terrainType: e.terrainType,
        itinerary: e.itinerary,
        equipmentProvided: e.equipmentProvided,
        equipmentRequired: e.equipmentRequired,
        fitnessRequirements: e.fitnessRequirements,
        eligibility: e.eligibility,
        transportInfo: e.transportInfo,
        weatherPolicy: e.weatherPolicy,
        safetyInfo: e.safetyInfo,
        cancellationTerms: e.cancellationTerms,
        images: e.images ?? [],
      });
      setLoaded(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!loaded) return null;

  const goNext = () => setStep((s) => Math.min(STEP_LABELS.length, s + 1));
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  const saveBasics = async () => {
    if (!form.title.trim()) {
      setError("A title is required");
      return;
    }
    if (!form.blurb.trim()) {
      setError("Add a short blurb — people browsing will see this before they open your listing");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (id === "new") {
        const created = await createVendorExperience({ title: form.title, kind: form.kind, difficulty: form.difficulty, blurb: form.blurb, description: form.description });
        setId(created.id);
        navigate(`/vendor/experiences/${created.id}`, { replace: true });
      } else {
        await updateVendorExperience(id, { title: form.title, kind: form.kind, difficulty: form.difficulty, blurb: form.blurb, description: form.description });
      }
      onDirtyChange?.(false);
      goNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const saveLocation = async () => {
    if (id === "new") return; // shouldn't happen — step 1 always creates the draft first
    setSaving(true);
    setError(null);
    try {
      await updateVendorExperience(id, {
        area: form.area,
        county: form.county,
        ...(form.locationConfirmed ? { lat: form.lat ?? null, lng: form.lng ?? null } : {}),
        meetingPoint: form.meetingPoint,
      });
      onDirtyChange?.(false);
      goNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const savePricing = async () => {
    if (id === "new") return;
    setSaving(true);
    setError(null);
    try {
      await updateVendorExperience(id, {
        durationMinutes: form.durationMinutes,
        priceCents: form.priceCents,
        capacity: form.capacity,
        paymentMethod: form.paymentMethod,
        distanceKm: form.kind === "adventure" ? form.distanceKm : null,
        elevationGainM: form.kind === "adventure" ? form.elevationGainM : null,
        terrainType: form.kind === "adventure" ? form.terrainType : "",
      });
      onDirtyChange?.(false);
      goNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const savePrep = async () => {
    if (id === "new") return;
    setSaving(true);
    setError(null);
    try {
      await updateVendorExperience(id, {
        itinerary: form.itinerary,
        equipmentProvided: form.equipmentProvided,
        equipmentRequired: form.equipmentRequired,
        fitnessRequirements: form.fitnessRequirements,
        eligibility: form.eligibility,
        transportInfo: form.transportInfo,
        weatherPolicy: form.weatherPolicy,
        safetyInfo: form.safetyInfo,
        cancellationTerms: form.cancellationTerms,
      });
      onDirtyChange?.(false);
      goNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const savePhotos = async () => {
    if (id === "new") return;
    setSaving(true);
    setError(null);
    try {
      await updateVendorExperience(id, { images: form.images });
      onDirtyChange?.(false);
      goNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (id === "new") return;
    setSaving(true);
    setError(null);
    try {
      const published = await publishVendorExperience(id);
      onDirtyChange?.(false);
      onPublished(published.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't publish — check every step is complete");
    } finally {
      setSaving(false);
    }
  };

  if (step === 1) {
    return (
      <GuidedFlow
        title="Tell us about your listing."
        subtitle="Start with the basics. You can add more details later."
        stepLabels={STEP_LABELS}
        currentStep={1}
        showBack={false}
        onBack={() => {}}
        onContinue={saveBasics}
        continueBusy={saving}
        error={error}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 480 }}>
          <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label htmlFor="experience-wizard-kind" style={labelStyle}>Kind</label>
              <select id="experience-wizard-kind" value={form.kind} onChange={(e) => setForm({ kind: e.target.value as "adventure" | "experience" })} style={inputStyle}>
                <option value="experience">Experience</option>
                <option value="adventure">Adventure</option>
              </select>
            </div>
            <div>
              <label htmlFor="experience-wizard-difficulty" style={labelStyle}>Difficulty (optional)</label>
              <select id="experience-wizard-difficulty" value={form.difficulty} onChange={(e) => setForm({ difficulty: e.target.value })} style={inputStyle}>
                <option value="">— none —</option>
                <option value="easy">Easy</option>
                <option value="moderate">Moderate</option>
                <option value="challenging">Challenging</option>
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="experience-wizard-title" style={labelStyle}>Title</label>
            <input id="experience-wizard-title" value={form.title} onChange={(e) => setForm({ title: e.target.value })} placeholder="e.g. Guided coastal walk" style={inputStyle} autoFocus />
          </div>
          <div>
            <label htmlFor="experience-wizard-blurb" style={labelStyle}>Short blurb</label>
            <p id="experience-wizard-blurb-hint" style={{ fontSize: 12, color: colors.mutedLight, margin: "-2px 0 8px" }}>
              e.g. "A gentle guided coastal walk with sea views, finishing at a local café." Shown on listing
              cards before people open your page.
            </p>
            <textarea id="experience-wizard-blurb" aria-describedby="experience-wizard-blurb-hint" value={form.blurb} onChange={(e) => setForm({ blurb: e.target.value })} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
          <div>
            <label htmlFor="experience-wizard-description" style={labelStyle}>Full description (optional)</label>
            <textarea id="experience-wizard-description" value={form.description} onChange={(e) => setForm({ description: e.target.value })} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
        </div>
      </GuidedFlow>
    );
  }

  if (step === 2) {
    return (
      <GuidedFlow
        title="Where is it?"
        subtitle="All optional — you can always add these later."
        stepLabels={STEP_LABELS}
        currentStep={2}
        onBack={goBack}
        onContinue={saveLocation}
        continueBusy={saving}
        error={error}
      >
        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, maxWidth: 480 }}>
          <div>
            <label htmlFor="experience-wizard-area" style={labelStyle}>Area</label>
            <input id="experience-wizard-area" value={form.area} onChange={(e) => setForm({ area: e.target.value })} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="experience-wizard-county" style={labelStyle}>County</label>
            <input id="experience-wizard-county" value={form.county} onChange={(e) => setForm({ county: e.target.value })} style={inputStyle} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="experience-wizard-meeting-point" style={labelStyle}>Meeting point</label>
            <input id="experience-wizard-meeting-point" value={form.meetingPoint} onChange={(e) => setForm({ meetingPoint: e.target.value })} placeholder="Where participants gather" style={inputStyle} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <AddressSearch
              label="Map location (optional — for the Explore map)"
              onSelect={(r) => setForm({ area: r.area || form.area, county: r.county || form.county, lat: r.lat, lng: r.lng, locationConfirmed: true })}
            />
            <p style={{ fontSize: 12, color: colors.faint, margin: "6px 0 0" }}>
              This pins the meeting point on the map — leave it unset if the meeting point genuinely varies or isn't a fixed spot.
            </p>
          </div>
          {form.lat !== undefined && form.lng !== undefined && (
            <div style={{ gridColumn: "1 / -1" }}>
              <MapConfirm lat={form.lat} lng={form.lng} label={form.meetingPoint || form.title || "Meeting point"} />
            </div>
          )}
        </div>
      </GuidedFlow>
    );
  }

  if (step === 3) {
    return (
      <GuidedFlow
        title="Pricing & capacity."
        subtitle="What it costs, and how many people per departure."
        stepLabels={STEP_LABELS}
        currentStep={3}
        onBack={goBack}
        onContinue={savePricing}
        continueBusy={saving}
        error={error}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 520 }}>
          <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "end" }}>
            <div>
              <label htmlFor="experience-wizard-duration" style={labelStyle}>Duration (minutes)</label>
              <input id="experience-wizard-duration" type="number" value={form.durationMinutes} onChange={(e) => setForm({ durationMinutes: Number(e.target.value) })} style={{ ...inputStyle, maxWidth: 140 }} />
            </div>
            <div>
              <label htmlFor="experience-wizard-price" style={labelStyle}>Price per person (€)</label>
              <input id="experience-wizard-price" type="number" value={form.priceCents / 100} onChange={(e) => setForm({ priceCents: Math.round(Number(e.target.value) * 100) })} style={{ ...inputStyle, maxWidth: 140 }} />
            </div>
            <NumberStepper label="Capacity per departure" value={form.capacity} onChange={(n) => setForm({ capacity: n })} min={1} />
            <div>
              <label htmlFor="experience-wizard-payment-method" style={labelStyle}>Payment</label>
              <select id="experience-wizard-payment-method" value={form.paymentMethod} onChange={(e) => setForm({ paymentMethod: e.target.value as "online" | "cash" })} style={inputStyle}>
                <option value="online">Online payment</option>
                <option value="cash">Cash on arrival</option>
              </select>
            </div>
          </div>

          {form.kind === "adventure" && (
            <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, paddingTop: 8, borderTop: `1px solid ${colors.border}` }}>
              <div>
                <label htmlFor="experience-wizard-distance" style={labelStyle}>Distance (km, optional)</label>
                <input id="experience-wizard-distance" type="number" min={0} step="0.1" value={form.distanceKm ?? ""} onChange={(e) => setForm({ distanceKm: e.target.value ? Number(e.target.value) : null })} style={inputStyle} />
              </div>
              <div>
                <label htmlFor="experience-wizard-elevation" style={labelStyle}>Elevation gain (m, optional)</label>
                <input id="experience-wizard-elevation" type="number" min={0} value={form.elevationGainM ?? ""} onChange={(e) => setForm({ elevationGainM: e.target.value ? Number(e.target.value) : null })} style={inputStyle} />
              </div>
              <div>
                <label htmlFor="experience-wizard-terrain" style={labelStyle}>Terrain (optional)</label>
                <input id="experience-wizard-terrain" value={form.terrainType} onChange={(e) => setForm({ terrainType: e.target.value })} placeholder="e.g. Trail & mountain" style={inputStyle} />
              </div>
            </div>
          )}
        </div>
      </GuidedFlow>
    );
  }

  if (step === 4) {
    return (
      <GuidedFlow
        title="Prep & logistics."
        subtitle="All optional — you can always add these later."
        stepLabels={STEP_LABELS}
        currentStep={4}
        onBack={goBack}
        onContinue={savePrep}
        continueBusy={saving}
        error={error}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 560 }}>
          <div>
            <label htmlFor="experience-wizard-itinerary" style={labelStyle}>Itinerary</label>
            <textarea id="experience-wizard-itinerary" value={form.itinerary} onChange={(e) => setForm({ itinerary: e.target.value })} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
          <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label htmlFor="experience-wizard-equipment-provided" style={labelStyle}>Equipment provided</label>
              <textarea id="experience-wizard-equipment-provided" value={form.equipmentProvided} onChange={(e) => setForm({ equipmentProvided: e.target.value })} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
            </div>
            <div>
              <label htmlFor="experience-wizard-equipment-required" style={labelStyle}>Equipment required</label>
              <textarea id="experience-wizard-equipment-required" value={form.equipmentRequired} onChange={(e) => setForm({ equipmentRequired: e.target.value })} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
            </div>
            <div>
              <label htmlFor="experience-wizard-fitness" style={labelStyle}>Fitness requirements</label>
              <textarea id="experience-wizard-fitness" value={form.fitnessRequirements} onChange={(e) => setForm({ fitnessRequirements: e.target.value })} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
            </div>
            <div>
              <label htmlFor="experience-wizard-eligibility" style={labelStyle}>Eligibility (e.g. minimum age)</label>
              <textarea id="experience-wizard-eligibility" value={form.eligibility} onChange={(e) => setForm({ eligibility: e.target.value })} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
            </div>
            <div>
              <label htmlFor="experience-wizard-transport" style={labelStyle}>Transport info</label>
              <textarea id="experience-wizard-transport" value={form.transportInfo} onChange={(e) => setForm({ transportInfo: e.target.value })} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
            </div>
            <div>
              <label htmlFor="experience-wizard-weather" style={labelStyle}>Weather policy</label>
              <textarea id="experience-wizard-weather" value={form.weatherPolicy} onChange={(e) => setForm({ weatherPolicy: e.target.value })} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
            </div>
            <div>
              <label htmlFor="experience-wizard-safety" style={labelStyle}>Safety info</label>
              <textarea id="experience-wizard-safety" value={form.safetyInfo} onChange={(e) => setForm({ safetyInfo: e.target.value })} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
            </div>
            <div>
              <label htmlFor="experience-wizard-cancellation" style={labelStyle}>Cancellation terms</label>
              <textarea id="experience-wizard-cancellation" value={form.cancellationTerms} onChange={(e) => setForm({ cancellationTerms: e.target.value })} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
            </div>
          </div>
        </div>
      </GuidedFlow>
    );
  }

  if (step === 5) {
    return (
      <GuidedFlow
        title="Add some photos."
        subtitle="Show people what this is like."
        stepLabels={STEP_LABELS}
        currentStep={5}
        onBack={goBack}
        onContinue={savePhotos}
        continueBusy={saving}
        error={error}
      >
        {/* id is guaranteed real (not "new") here — same reasoning as
            CentreCreationWizard.tsx's identical comment. */}
        <MultiImageUpload images={form.images} onChange={(images) => setForm({ images })} mediaEntityType="experience-gallery" mediaEntityId={id as string} />
      </GuidedFlow>
    );
  }

  // step 6 — review
  return (
    <GuidedFlow
      title="Review your listing."
      subtitle="Check everything looks right, then publish."
      stepLabels={STEP_LABELS}
      currentStep={6}
      onBack={goBack}
      onContinue={publish}
      continueLabel="Publish listing"
      continueBusy={saving}
      error={error}
    >
      <Card style={{ padding: 20, maxWidth: 520, display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 18 }}>{form.title || "Untitled listing"}</div>
          {form.blurb && <p style={{ fontSize: 13.5, color: colors.mutedLight, margin: "4px 0 0" }}>{form.blurb}</p>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13.5, color: colors.text }}>
          <span>{form.kind === "adventure" ? "Adventure" : "Experience"}{form.difficulty ? ` · ${form.difficulty}` : ""}</span>
          <span>{[form.area, form.county].filter(Boolean).join(", ") || "No location set"}</span>
          <span>€{(form.priceCents / 100).toFixed(2)}/person · cap {form.capacity} · {form.durationMinutes} min</span>
          <span>{form.images.length} photo{form.images.length === 1 ? "" : "s"}</span>
        </div>
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: 0, borderTop: `1px solid ${colors.border}`, paddingTop: 12 }}>
          Publishing sends your listing to HelloCircle for admin approval — you can keep editing every detail
          (including adding departures) while that's in progress.
        </p>
      </Card>
    </GuidedFlow>
  );
}
