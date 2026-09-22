import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createVendorCentre,
  fetchVendorCentre,
  fetchVendorRooms,
  publishVendorCentre,
  updateVendorCentre,
} from "../api";
import { AddressSearch, MapConfirm } from "./AddressSearch";
import { CentreCard } from "./CentreCard";
import { GuidedFlow } from "./GuidedFlow";
import { RoomsManager } from "./VendorCentreEditor";
import { MultiImageUpload } from "./VendorImageUpload";
import { Card, labelStyle, inputStyle } from "./ui";
import { colors, fonts, radius } from "../theme";
import type { Centre, Room } from "../types";

// Guided Flow creation wizard for a community centre (Form System Audit,
// Phase 5) — the flagship replacement for what used to be one 12-field
// flat form on "new". Creates a real 'draft' row after step 1 (see
// server/src/routes/vendorListings.ts's relaxed POST /centres) so leaving
// and coming back is real, not just a client-side promise — each later
// step's "Save & continue" persists via the same PUT the settings-view
// editor already uses, then POST /publish on the final step flips
// draft → pending. `initialCentreId` is read once at mount (see the
// component's own comment below) — it deliberately does not react to the
// URL changing after step 1 creates the draft and this component updates
// its own `id` state + calls navigate() itself.

const STEP_LABELS = ["Basics", "Location", "Spaces", "Availability", "Details", "Photos", "Review"];
const HOUR_OPTIONS = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];

interface WizardForm {
  name: string;
  managedBy: string;
  blurb: string;
  area: string;
  county: string;
  mapUrl: string;
  lat?: number;
  lng?: number;
  opensAt: string;
  closesAt: string;
  isOpen: boolean;
  phone: string;
  amenitiesText: string;
  accessibilityText: string;
  images: string[];
}

function blankForm(): WizardForm {
  return { name: "", managedBy: "", blurb: "", area: "", county: "", mapUrl: "", opensAt: "09:00", closesAt: "21:00", isOpen: true, phone: "", amenitiesText: "", accessibilityText: "", images: [] };
}

export function CentreCreationWizard({
  initialCentreId,
  onDirtyChange,
  onPublished,
}: {
  initialCentreId: string | "new";
  onDirtyChange?: (dirty: boolean) => void;
  onPublished: (centre: Centre) => void;
}) {
  const navigate = useNavigate();
  const [id, setId] = useState<string | "new">(initialCentreId);
  const [step, setStep] = useState(1);
  const [form, setFormRaw] = useState<WizardForm>(blankForm());
  const [rooms, setRooms] = useState<Room[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(initialCentreId === "new");
  // Host Manage spec §29's live preview step — fetches the real, already-
  // saved draft (every earlier step already persisted via its own PUT) so
  // CentreCard renders exactly what the published listing will look like,
  // rather than reconstructing a Centre object from local wizard state
  // (which is missing rollup fields like capacity/from that only the
  // server computes from real room rows).
  const [previewCentre, setPreviewCentre] = useState<Centre | null>(null);

  const setForm = (patch: Partial<WizardForm>) => {
    setFormRaw((f) => ({ ...f, ...patch }));
    onDirtyChange?.(true);
  };

  useEffect(() => {
    if (initialCentreId === "new") return;
    fetchVendorCentre(initialCentreId).then((c) => {
      setFormRaw({
        name: c.name,
        managedBy: c.managedBy,
        blurb: c.blurb,
        area: c.area,
        county: c.county,
        mapUrl: c.mapUrl,
        lat: c.lat ?? undefined,
        lng: c.lng ?? undefined,
        opensAt: c.opensAt,
        closesAt: c.closesAt,
        isOpen: c.isOpen,
        phone: c.phone,
        amenitiesText: c.amenities.join("\n"),
        accessibilityText: c.accessibility.join("\n"),
        images: c.images ?? [],
      });
      setLoaded(true);
    });
    fetchVendorRooms(initialCentreId).then(setRooms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (step === 7 && id !== "new") fetchVendorCentre(id).then(setPreviewCentre).catch(() => setPreviewCentre(null));
  }, [step, id]);

  if (!loaded) return null;

  const goNext = () => setStep((s) => Math.min(STEP_LABELS.length, s + 1));
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  const saveBasics = async () => {
    if (!form.name.trim()) {
      setError("A venue name is required");
      return;
    }
    if (!form.blurb.trim()) {
      setError("Add a short description — people browsing will see this before they open your venue");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (id === "new") {
        const created = await createVendorCentre({ name: form.name, managedBy: form.managedBy, blurb: form.blurb });
        setId(created.id);
        navigate(`/vendor/centres/${created.id}`, { replace: true });
      } else {
        await updateVendorCentre(id, { name: form.name, managedBy: form.managedBy, blurb: form.blurb });
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
    if (!form.area.trim() || !form.county.trim()) {
      setError("Area and county are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateVendorCentre(id, { area: form.area, county: form.county, mapUrl: form.mapUrl, lat: form.lat, lng: form.lng });
      fetchVendorRooms(id).then(setRooms);
      onDirtyChange?.(false);
      goNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const saveAvailability = async () => {
    if (id === "new") return;
    setSaving(true);
    setError(null);
    try {
      await updateVendorCentre(id, { opensAt: form.opensAt, closesAt: form.closesAt, isOpen: form.isOpen });
      onDirtyChange?.(false);
      goNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const saveDetails = async () => {
    if (id === "new") return;
    setSaving(true);
    setError(null);
    try {
      const amenities = form.amenitiesText.split("\n").map((s) => s.trim()).filter(Boolean);
      const accessibility = form.accessibilityText.split("\n").map((s) => s.trim()).filter(Boolean);
      await updateVendorCentre(id, { phone: form.phone, amenities, accessibility });
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
      await updateVendorCentre(id, { images: form.images });
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
      const published = await publishVendorCentre(id);
      onDirtyChange?.(false);
      onPublished(published);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't publish — check every step is complete");
    } finally {
      setSaving(false);
    }
  };

  if (step === 1) {
    return (
      <GuidedFlow
        title="Tell us about your place."
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
          <div>
            <label htmlFor="centre-wizard-name" style={labelStyle}>Venue name</label>
            <input id="centre-wizard-name" value={form.name} onChange={(e) => setForm({ name: e.target.value })} placeholder="e.g. Riverside Sports Centre" style={inputStyle} autoFocus />
          </div>
          <div>
            <label htmlFor="centre-wizard-managed-by" style={labelStyle}>Managed by (optional)</label>
            <input id="centre-wizard-managed-by" value={form.managedBy} onChange={(e) => setForm({ managedBy: e.target.value })} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="centre-wizard-blurb" style={labelStyle}>Short description</label>
            <p id="centre-wizard-blurb-hint" style={{ fontSize: 12, color: colors.mutedLight, margin: "-2px 0 8px" }}>
              e.g. "Local sports centre with two badminton courts, changing rooms and free parking." Shown to
              people browsing before they open your venue.
            </p>
            <textarea id="centre-wizard-blurb" aria-describedby="centre-wizard-blurb-hint" value={form.blurb} onChange={(e) => setForm({ blurb: e.target.value })} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
        </div>
      </GuidedFlow>
    );
  }

  if (step === 2) {
    return (
      <GuidedFlow
        title="Where is it?"
        subtitle="Search for the address, or type it in yourself."
        stepLabels={STEP_LABELS}
        currentStep={2}
        onBack={goBack}
        onContinue={saveLocation}
        continueBusy={saving}
        error={error}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 480 }}>
          <AddressSearch onSelect={(r) => setForm({ area: r.area || form.area, county: r.county || form.county, lat: r.lat, lng: r.lng })} />
          <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label htmlFor="centre-wizard-area" style={labelStyle}>Area</label>
              <input id="centre-wizard-area" value={form.area} onChange={(e) => setForm({ area: e.target.value })} style={inputStyle} />
            </div>
            <div>
              <label htmlFor="centre-wizard-county" style={labelStyle}>County</label>
              <input id="centre-wizard-county" value={form.county} onChange={(e) => setForm({ county: e.target.value })} style={inputStyle} />
            </div>
          </div>
          <div>
            <label htmlFor="centre-wizard-map-url" style={labelStyle}>Map link (optional)</label>
            <input id="centre-wizard-map-url" value={form.mapUrl} onChange={(e) => setForm({ mapUrl: e.target.value })} placeholder="Google Maps link" style={inputStyle} />
          </div>
          {form.lat !== undefined && form.lng !== undefined && <MapConfirm lat={form.lat} lng={form.lng} label={form.name || "Your venue"} />}
        </div>
      </GuidedFlow>
    );
  }

  if (step === 3) {
    return (
      <GuidedFlow
        title="What spaces can people use?"
        subtitle="Every venue starts with one space — rename it, or add more."
        stepLabels={STEP_LABELS}
        currentStep={3}
        onBack={goBack}
        onContinue={goNext}
        error={error}
      >
        {id !== "new" && <RoomsManager centreId={id} rooms={rooms} onChanged={() => fetchVendorRooms(id).then(setRooms)} />}
      </GuidedFlow>
    );
  }

  if (step === 4) {
    return (
      <GuidedFlow
        title="When is it available?"
        subtitle="You can set day-by-day hours and block specific dates later."
        stepLabels={STEP_LABELS}
        currentStep={4}
        onBack={goBack}
        onContinue={saveAvailability}
        continueBusy={saving}
        error={error}
      >
        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, maxWidth: 560 }}>
          <div>
            <label htmlFor="centre-wizard-opens-at" style={labelStyle}>Opens at</label>
            <select id="centre-wizard-opens-at" value={form.opensAt} onChange={(e) => setForm({ opensAt: e.target.value })} style={inputStyle}>
              {HOUR_OPTIONS.slice(0, -1).map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="centre-wizard-closes-at" style={labelStyle}>Closes at</label>
            <select id="centre-wizard-closes-at" value={form.closesAt} onChange={(e) => setForm({ closesAt: e.target.value })} style={inputStyle}>
              {HOUR_OPTIONS.slice(1).map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="centre-wizard-is-open" style={labelStyle}>Taking bookings?</label>
            <select id="centre-wizard-is-open" value={form.isOpen ? "open" : "closed"} onChange={(e) => setForm({ isOpen: e.target.value === "open" })} style={inputStyle}>
              <option value="open">Open</option>
              <option value="closed">Closed (hide the Book button)</option>
            </select>
          </div>
        </div>
      </GuidedFlow>
    );
  }

  if (step === 5) {
    return (
      <GuidedFlow
        title="A few more details."
        subtitle="All optional — you can always add these later."
        stepLabels={STEP_LABELS}
        currentStep={5}
        onBack={goBack}
        onContinue={saveDetails}
        continueBusy={saving}
        error={error}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 480 }}>
          <div>
            <label htmlFor="centre-wizard-phone" style={labelStyle}>Contact phone (optional)</label>
            <input id="centre-wizard-phone" value={form.phone} onChange={(e) => setForm({ phone: e.target.value })} placeholder="e.g. 01 234 5678" style={inputStyle} />
          </div>
          <div>
            <label htmlFor="centre-wizard-amenities" style={labelStyle}>Amenities (one per line)</label>
            <textarea id="centre-wizard-amenities" value={form.amenitiesText} onChange={(e) => setForm({ amenitiesText: e.target.value })} rows={4} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
          <div>
            <label htmlFor="centre-wizard-accessibility" style={labelStyle}>Accessibility (one per line)</label>
            <textarea id="centre-wizard-accessibility" value={form.accessibilityText} onChange={(e) => setForm({ accessibilityText: e.target.value })} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
        </div>
      </GuidedFlow>
    );
  }

  if (step === 6) {
    return (
      <GuidedFlow
        title="Add some photos."
        subtitle="Show people what your place is like."
        stepLabels={STEP_LABELS}
        currentStep={6}
        onBack={goBack}
        onContinue={savePhotos}
        continueBusy={saving}
        error={error}
      >
        <MultiImageUpload images={form.images} onChange={(images) => setForm({ images })} />
      </GuidedFlow>
    );
  }

  // step 7 — review
  return (
    <GuidedFlow
      title="Review your venue."
      subtitle="Check everything looks right, then publish."
      stepLabels={STEP_LABELS}
      currentStep={7}
      onBack={goBack}
      onContinue={publish}
      continueLabel="Publish venue"
      continueBusy={saving}
      error={error}
    >
      {previewCentre && (
        <div style={{ maxWidth: 320, marginBottom: 18 }}>
          <p style={{ fontSize: 12, color: colors.mutedLight, margin: "0 0 8px", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em" }}>
            How it'll look
          </p>
          <div style={{ pointerEvents: "none" }}>
            <CentreCard centre={previewCentre} />
          </div>
        </div>
      )}
      <Card style={{ padding: 20, maxWidth: 520, display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 18 }}>{form.name || "Untitled venue"}</div>
          {form.blurb && <p style={{ fontSize: 13.5, color: colors.mutedLight, margin: "4px 0 0" }}>{form.blurb}</p>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13.5, color: colors.text }}>
          <span>{[form.area, form.county].filter(Boolean).join(", ") || "No location set"}</span>
          <span>{rooms.length} space{rooms.length === 1 ? "" : "s"}</span>
          <span>{form.isOpen ? "Open" : "Closed"} · {form.opensAt}–{form.closesAt}</span>
          <span>{form.phone || "No contact phone"}</span>
          <span>{form.images.length} photo{form.images.length === 1 ? "" : "s"}</span>
        </div>
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: 0, borderTop: `1px solid ${colors.border}`, paddingTop: 12 }}>
          Publishing sends your venue to HelloCircle for admin approval — you can keep editing every detail (including adding more spaces and availability) while that's in progress.
        </p>
      </Card>
    </GuidedFlow>
  );
}
