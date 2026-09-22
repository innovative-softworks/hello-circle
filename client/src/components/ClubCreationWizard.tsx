import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createVendorClub,
  fetchVendorClub,
  publishVendorClub,
  updateVendorClub,
} from "../api";
import { AddressSearch, MapConfirm } from "./AddressSearch";
import { ClubCard } from "./ClubCard";
import { GuidedFlow } from "./GuidedFlow";
import { MultiImageUpload } from "./VendorImageUpload";
import { Card, labelStyle, inputStyle } from "./ui";
import { ACTIVITY_CATEGORIES } from "../constants";
import { colors, fonts, radius } from "../theme";
import type { Club } from "../types";

// Guided Flow creation wizard for a sports club (Form System Audit, Phase 5
// fast-follow to CentreCreationWizard.tsx — same reasoning applies here:
// this replaces what used to be one 15-field flat form on "new"). Creates a
// real 'draft' row after step 1 (see server/src/routes/vendorListings.ts's
// relaxed POST /clubs) so leaving and coming back is real, not just a
// client-side promise — each later step's "Save & continue" persists via
// the same PUT the settings-view editor already uses, then POST /publish on
// the final step flips draft → pending.

const STEP_LABELS = ["Basics", "Location", "Membership", "Extras", "Photos", "Review"];

interface WizardForm {
  name: string;
  sport: string;
  category: string;
  blurb: string;
  area: string;
  county: string;
  mapUrl: string;
  lat?: number;
  lng?: number;
  ages: string;
  audience: "kids" | "adults" | "all";
  price: number;
  unit: string;
  trial: boolean;
  capacity: number | null;
  paymentMethod: "online" | "cash";
  phone: string;
  includesText: string;
  accessibilityText: string;
  images: string[];
}

function blankForm(): WizardForm {
  return {
    name: "",
    sport: "",
    category: "",
    blurb: "",
    area: "",
    county: "",
    mapUrl: "",
    ages: "",
    audience: "kids",
    price: 0,
    unit: "year",
    trial: false,
    capacity: null,
    paymentMethod: "online",
    phone: "",
    includesText: "",
    accessibilityText: "",
    images: [],
  };
}

export function ClubCreationWizard({
  initialClubId,
  onDirtyChange,
  onPublished,
}: {
  initialClubId: string | "new";
  onDirtyChange?: (dirty: boolean) => void;
  onPublished: (club: Club) => void;
}) {
  const navigate = useNavigate();
  const [id, setId] = useState<string | "new">(initialClubId);
  const [step, setStep] = useState(1);
  const [form, setFormRaw] = useState<WizardForm>(blankForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(initialClubId === "new");
  // See CentreCreationWizard.tsx's identical comment — fetches the real,
  // already-saved draft for a live ClubCard preview on the Review step.
  const [previewClub, setPreviewClub] = useState<Club | null>(null);

  const setForm = (patch: Partial<WizardForm>) => {
    setFormRaw((f) => ({ ...f, ...patch }));
    onDirtyChange?.(true);
  };

  useEffect(() => {
    if (initialClubId === "new") return;
    fetchVendorClub(initialClubId).then((c) => {
      setFormRaw({
        name: c.name,
        sport: c.sport,
        category: c.category,
        blurb: c.blurb,
        area: c.area,
        county: c.county,
        mapUrl: c.mapUrl,
        lat: c.lat ?? undefined,
        lng: c.lng ?? undefined,
        ages: c.ages,
        audience: c.audience,
        price: c.price,
        unit: c.unit,
        trial: c.trial,
        capacity: c.capacity,
        paymentMethod: c.paymentMethod,
        phone: c.phone,
        includesText: c.includes.join("\n"),
        accessibilityText: c.accessibility.join("\n"),
        images: c.images ?? [],
      });
      setLoaded(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (step === STEP_LABELS.length && id !== "new") fetchVendorClub(id).then(setPreviewClub).catch(() => setPreviewClub(null));
  }, [step, id]);

  if (!loaded) return null;

  const goNext = () => setStep((s) => Math.min(STEP_LABELS.length, s + 1));
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  const saveBasics = async () => {
    if (!form.name.trim()) {
      setError("A club name is required");
      return;
    }
    if (!form.sport.trim()) {
      setError("A sport is required");
      return;
    }
    if (!form.blurb.trim()) {
      setError("Add a short description — people browsing will see this before they open your club");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (id === "new") {
        const created = await createVendorClub({ name: form.name, sport: form.sport, category: form.category, blurb: form.blurb });
        setId(created.id);
        navigate(`/vendor/clubs/${created.id}`, { replace: true });
      } else {
        await updateVendorClub(id, { name: form.name, sport: form.sport, category: form.category, blurb: form.blurb });
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
      await updateVendorClub(id, { area: form.area, county: form.county, mapUrl: form.mapUrl, lat: form.lat, lng: form.lng });
      onDirtyChange?.(false);
      goNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const saveMembership = async () => {
    if (id === "new") return;
    setSaving(true);
    setError(null);
    try {
      await updateVendorClub(id, {
        ages: form.ages,
        audience: form.audience,
        price: form.price,
        unit: form.unit,
        trial: form.trial,
        capacity: form.capacity,
        paymentMethod: form.paymentMethod,
      });
      onDirtyChange?.(false);
      goNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const saveExtras = async () => {
    if (id === "new") return;
    setSaving(true);
    setError(null);
    try {
      const includes = form.includesText.split("\n").map((s) => s.trim()).filter(Boolean);
      const accessibility = form.accessibilityText.split("\n").map((s) => s.trim()).filter(Boolean);
      await updateVendorClub(id, { phone: form.phone, includes, accessibility });
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
      await updateVendorClub(id, { images: form.images });
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
      const published = await publishVendorClub(id);
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
        title="Tell us about your club."
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
            <label htmlFor="club-wizard-name" style={labelStyle}>Club name</label>
            <input id="club-wizard-name" value={form.name} onChange={(e) => setForm({ name: e.target.value })} placeholder="e.g. Riverside Under-12s Football" style={inputStyle} autoFocus />
          </div>
          <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label htmlFor="club-wizard-sport" style={labelStyle}>Sport</label>
              <input id="club-wizard-sport" value={form.sport} onChange={(e) => setForm({ sport: e.target.value })} style={inputStyle} />
            </div>
            <div>
              <label htmlFor="club-wizard-category" style={labelStyle}>Category (optional)</label>
              <select id="club-wizard-category" value={form.category} onChange={(e) => setForm({ category: e.target.value })} style={inputStyle}>
                <option value="">— none —</option>
                {ACTIVITY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="club-wizard-blurb" style={labelStyle}>Short description</label>
            <p id="club-wizard-blurb-hint" style={{ fontSize: 12, color: colors.mutedLight, margin: "-2px 0 8px" }}>
              e.g. "Friendly under-12s football club, twice-weekly training plus Saturday matches." Shown to
              families browsing before they open your club.
            </p>
            <textarea id="club-wizard-blurb" aria-describedby="club-wizard-blurb-hint" value={form.blurb} onChange={(e) => setForm({ blurb: e.target.value })} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
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
              <label htmlFor="club-wizard-area" style={labelStyle}>Area</label>
              <input id="club-wizard-area" value={form.area} onChange={(e) => setForm({ area: e.target.value })} style={inputStyle} />
            </div>
            <div>
              <label htmlFor="club-wizard-county" style={labelStyle}>County</label>
              <input id="club-wizard-county" value={form.county} onChange={(e) => setForm({ county: e.target.value })} style={inputStyle} />
            </div>
          </div>
          <div>
            <label htmlFor="club-wizard-map-url" style={labelStyle}>Map link (optional)</label>
            <input id="club-wizard-map-url" value={form.mapUrl} onChange={(e) => setForm({ mapUrl: e.target.value })} placeholder="Google Maps link" style={inputStyle} />
          </div>
          {form.lat !== undefined && form.lng !== undefined && <MapConfirm lat={form.lat} lng={form.lng} label={form.name || "Your club"} />}
        </div>
      </GuidedFlow>
    );
  }

  if (step === 3) {
    return (
      <GuidedFlow
        title="Membership & pricing."
        subtitle="Who can join, and what it costs."
        stepLabels={STEP_LABELS}
        currentStep={3}
        onBack={goBack}
        onContinue={saveMembership}
        continueBusy={saving}
        error={error}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 520 }}>
          <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label htmlFor="club-wizard-ages" style={labelStyle}>Ages (e.g. 5-16)</label>
              <input id="club-wizard-ages" value={form.ages} onChange={(e) => setForm({ ages: e.target.value })} style={inputStyle} />
            </div>
            <div>
              <label htmlFor="club-wizard-audience" style={labelStyle}>Who registers</label>
              <select id="club-wizard-audience" value={form.audience} onChange={(e) => setForm({ audience: e.target.value as WizardForm["audience"] })} style={inputStyle}>
                <option value="kids">Kids — parent/guardian signs a child up</option>
                <option value="adults">Adults — members register themselves</option>
                <option value="all">Both — registrant picks at sign-up</option>
              </select>
            </div>
            <div>
              <label htmlFor="club-wizard-price" style={labelStyle}>Price (€)</label>
              <input id="club-wizard-price" type="number" value={form.price} onChange={(e) => setForm({ price: Number(e.target.value) })} style={{ ...inputStyle, maxWidth: 140 }} />
            </div>
            <div>
              <label htmlFor="club-wizard-unit" style={labelStyle}>Per</label>
              <select id="club-wizard-unit" value={form.unit} onChange={(e) => setForm({ unit: e.target.value })} style={inputStyle}>
                <option value="year">year</option>
                <option value="term">term</option>
                <option value="lesson">lesson</option>
                <option value="session">session</option>
              </select>
            </div>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 14, background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 11, padding: "10px 13px", cursor: "pointer" }}>
            <input type="checkbox" checked={form.trial} onChange={(e) => setForm({ trial: e.target.checked })} style={{ accentColor: colors.orange, width: 16, height: 16 }} />
            Offers a free trial session
          </label>

          <div>
            <label htmlFor="club-wizard-capacity" style={labelStyle}>Membership cap (leave blank for unlimited)</label>
            <input
              id="club-wizard-capacity"
              type="number"
              min={0}
              value={form.capacity ?? ""}
              onChange={(e) => setForm({ capacity: e.target.value === "" ? null : Number(e.target.value) })}
              placeholder="e.g. 30"
              aria-describedby="club-wizard-capacity-hint"
              style={{ ...inputStyle, maxWidth: 140, marginBottom: 4 }}
            />
            <p id="club-wizard-capacity-hint" style={{ fontSize: 12.5, color: colors.mutedLight, margin: 0 }}>
              Once paid registrations reach this number, new sign-ups are offered a waitlist instead.
            </p>
          </div>

          <div>
            <label htmlFor="club-wizard-payment-method" style={labelStyle}>Registration payment</label>
            <select id="club-wizard-payment-method" value={form.paymentMethod} onChange={(e) => setForm({ paymentMethod: e.target.value as "online" | "cash" })} style={inputStyle}>
              <option value="online">Online payment</option>
              <option value="cash">Cash on arrival</option>
            </select>
          </div>
        </div>
      </GuidedFlow>
    );
  }

  if (step === 4) {
    return (
      <GuidedFlow
        title="A few more details."
        subtitle="All optional — you can always add these later."
        stepLabels={STEP_LABELS}
        currentStep={4}
        onBack={goBack}
        onContinue={saveExtras}
        continueBusy={saving}
        error={error}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 480 }}>
          <div>
            <label htmlFor="club-wizard-phone" style={labelStyle}>Contact phone (optional)</label>
            <input id="club-wizard-phone" value={form.phone} onChange={(e) => setForm({ phone: e.target.value })} placeholder="e.g. 01 234 5678" style={inputStyle} />
          </div>
          <div>
            <label htmlFor="club-wizard-includes" style={labelStyle}>What's included (one per line)</label>
            <textarea id="club-wizard-includes" value={form.includesText} onChange={(e) => setForm({ includesText: e.target.value })} rows={4} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
          <div>
            <label htmlFor="club-wizard-accessibility" style={labelStyle}>Accessibility (one per line)</label>
            <textarea id="club-wizard-accessibility" value={form.accessibilityText} onChange={(e) => setForm({ accessibilityText: e.target.value })} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
        </div>
      </GuidedFlow>
    );
  }

  if (step === 5) {
    return (
      <GuidedFlow
        title="Add some photos."
        subtitle="Show families what your club is like."
        stepLabels={STEP_LABELS}
        currentStep={5}
        onBack={goBack}
        onContinue={savePhotos}
        continueBusy={saving}
        error={error}
      >
        <MultiImageUpload images={form.images} onChange={(images) => setForm({ images })} />
      </GuidedFlow>
    );
  }

  // step 6 — review
  return (
    <GuidedFlow
      title="Review your club."
      subtitle="Check everything looks right, then publish."
      stepLabels={STEP_LABELS}
      currentStep={6}
      onBack={goBack}
      onContinue={publish}
      continueLabel="Publish club"
      continueBusy={saving}
      error={error}
    >
      {previewClub && (
        <div style={{ maxWidth: 320, marginBottom: 18 }}>
          <p style={{ fontSize: 12, color: colors.mutedLight, margin: "0 0 8px", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em" }}>
            How it'll look
          </p>
          <div style={{ pointerEvents: "none" }}>
            <ClubCard club={previewClub} />
          </div>
        </div>
      )}
      <Card style={{ padding: 20, maxWidth: 520, display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 18 }}>{form.name || "Untitled club"}</div>
          {form.blurb && <p style={{ fontSize: 13.5, color: colors.mutedLight, margin: "4px 0 0" }}>{form.blurb}</p>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13.5, color: colors.text }}>
          <span>{form.sport || "No sport set"}</span>
          <span>{[form.area, form.county].filter(Boolean).join(", ") || "No location set"}</span>
          <span>€{form.price}/{form.unit} · {form.capacity ? `capped at ${form.capacity}` : "unlimited"}</span>
          <span>{form.phone || "No contact phone"}</span>
          <span>{form.images.length} photo{form.images.length === 1 ? "" : "s"}</span>
        </div>
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: 0, borderTop: `1px solid ${colors.border}`, paddingTop: 12 }}>
          Publishing sends your club to HelloCircle for admin approval — you can keep editing every detail
          while that's in progress.
        </p>
      </Card>
    </GuidedFlow>
  );
}
