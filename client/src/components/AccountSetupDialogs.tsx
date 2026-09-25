import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { acceptResidentTerms, acceptVendorTerms, fetchCentres, guestLogout, logout, saveOnboarding, skipOnboarding } from "../api";
import { fetchMarketCategories, submitIntent } from "../api/public";
import { AnalyticsEvent, trackTypedEvent } from "../analyticsEvents";
import { nearestCounty } from "../irishCounties";
import { colors, fonts, radius, zIndex } from "../theme";
import type { ResidentFull } from "../types";
import { Chip } from "./Chip";
import { CheckIcon, PinIcon, SearchIcon } from "./icons";
import { Button, inputStyle } from "./ui";

// The lazy-loaded half of AccountSetupGate.tsx. Deliberately imports nothing
// from AuthForms.tsx (which pulls in the Firebase sign-in bundle) — the two
// small pieces it needs from there (a checkbox row, an error line) are local.

// --- shared modal shell -----------------------------------------------------

function SetupModal({
  labelledBy,
  onEscape,
  children,
}: {
  labelledBy: string;
  /** Omit for a dialog that must be answered (the Terms confirmation). */
  onEscape?: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const panel = panelRef.current;
    const focusables = () => Array.from(panel?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])') ?? []);
    (focusables()[0] ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && escapeRef.current) {
        e.preventDefault();
        escapeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, []);

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: zIndex.modal, background: "rgba(20,22,20,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className="pop-in"
        style={{ background: colors.surface, borderRadius: radius.card, padding: "26px 24px 22px", width: "100%", maxWidth: 520, maxHeight: "min(92vh, 760px)", overflowY: "auto", boxShadow: "0 24px 70px rgba(20,22,20,.3)", outline: "none" }}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}

function ErrorLine({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} role="alert" style={{ color: colors.danger, fontSize: 13.5, margin: "14px 0 0", background: colors.dangerBg, padding: "9px 12px", borderRadius: radius.control }}>
      {message}
    </p>
  );
}

const plainButton = { background: "none", border: "none", padding: 0, fontSize: 14, cursor: "pointer" } as const;

// --- E1: confirm Terms for an account with none on file -----------------------

function TermsDialog({ who, onAccepted, onSignOut }: { who: "resident" | "vendor"; onAccepted: () => Promise<void> | void; onSignOut: () => Promise<void> }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy || !checked) return;
    setError(null);
    setBusy(true);
    try {
      await (who === "resident" ? acceptResidentTerms() : acceptVendorTerms());
      await onAccepted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SetupModal labelledBy="terms-dialog-title">
      <h2 id="terms-dialog-title" style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 22, margin: "0 0 8px" }}>
        Please confirm our Terms
      </h2>
      <p style={{ margin: "0 0 18px", fontSize: 14.5, color: colors.mutedLight, lineHeight: 1.55 }}>
        Your account was created before we recorded acceptance of the Terms. Confirm below to keep using HelloCircle — it takes one click and nothing else changes.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="terms-dialog-check" style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 14, color: colors.text, lineHeight: 1.45 }}>
          <input id="terms-dialog-check" type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ marginTop: 2, width: 18, height: 18, flex: "none", cursor: "pointer" }} />
          <span>
            I agree to HelloCircle's{" "}
            <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: colors.text, fontWeight: 700 }}>
              Privacy Policy
            </a>{" "}
            and Terms.
          </span>
        </label>
        {error && <ErrorLine id="terms-dialog-error" message={error} />}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginTop: 22 }}>
          <button type="button" onClick={() => void onSignOut()} disabled={busy} style={{ ...plainButton, color: colors.muted }}>
            Sign out instead
          </button>
          <Button type="submit" disabled={!checked || busy}>
            {busy ? "Saving…" : "Confirm and continue"}
          </Button>
        </div>
      </form>
    </SetupModal>
  );
}

// --- G1: two optional questions, then back to what you were doing --------------

// Everything else the old eight-step flow asked (goals, availability, group
// size, budget, comfort options) is still editable — and already lived — in
// Profile > Interests & Discovery. The "who will you book for" step is gone:
// its answer was never saved or used anywhere.

const INTEREST_GROUPS: { label: string; items: string[] }[] = [
  { label: "Sport & fitness", items: ["Badminton", "Football", "Swimming", "Fitness", "Yoga"] },
  { label: "Outdoors", items: ["Walking", "Outdoor"] },
  { label: "Social", items: ["Kids activities", "Community events"] },
  { label: "Learn & wellbeing", items: ["Arts", "Learning", "Wellbeing"] },
];
const POPULAR_COUNTIES = ["Dublin", "Cork", "Galway", "Limerick", "Waterford"];
const RADIUS_OPTIONS = [2, 5, 10, 20];

type OnboardingStep = "location" | "interests";

function OnboardingDialog({ resident, onSaved, onClose }: { resident: ResidentFull; onSaved: () => Promise<void>; onClose: () => void }) {
  const navigate = useNavigate();
  const [step, setStep] = useState<OnboardingStep>("location");
  const [counties, setCounties] = useState<string[]>(POPULAR_COUNTIES);
  // Empty until the person picks one — no pre-selected county that would be
  // saved as if they had answered.
  const [homeCounty, setHomeCounty] = useState(resident.homeCounty ?? "");
  const [radiusKm, setRadiusKm] = useState(resident.searchRadiusKm || 10);
  const [radiusTouched, setRadiusTouched] = useState(false);
  const [countySearch, setCountySearch] = useState("");
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [interests, setInterests] = useState<string[]>(resident.interests);
  const [marketFlags, setMarketFlags] = useState<Record<string, boolean> | null>(null);
  const [requested, setRequested] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Captured once: saving flips onboardingCompleted, and the header must not change under the person mid-close.
  const [editing] = useState(resident.onboardingCompleted);
  const firstName = resident.name?.trim().split(/\s+/)[0];

  useEffect(() => {
    trackTypedEvent(AnalyticsEvent.OnboardingStarted);
  }, []);
  // Keyed only on `step`, so a re-render that doesn't change the step can't double-count a view.
  useEffect(() => {
    trackTypedEvent(AnalyticsEvent.OnboardingStepViewed, { step });
  }, [step]);

  useEffect(() => {
    fetchCentres()
      .then((centres) => {
        const list = Array.from(new Set(centres.map((c) => c.county).filter(Boolean))).sort((a, b) => a.localeCompare(b));
        if (list.length) setCounties(list);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!homeCounty) return;
    fetchMarketCategories(homeCounty)
      .then(setMarketFlags)
      .catch(() => setMarketFlags(null));
  }, [homeCounty]);

  const toggleInterest = (i: string) => setInterests((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]));

  const requestCategory = async (category: string) => {
    if (requested.includes(category)) return;
    setRequested((prev) => [...prev, category]);
    try {
      await submitIntent({ activityLabel: category, county: homeCounty });
    } catch {
      setRequested((prev) => prev.filter((c) => c !== category));
    }
  };

  // Permission is only ever requested on an explicit click, and coordinates
  // never leave the browser — same behaviour the page version had.
  const useMyLocation = () => {
    setLocationError(null);
    if (!navigator.geolocation) return setLocationError("Location isn't available in this browser.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const match = nearestCounty(pos.coords.latitude, pos.coords.longitude, counties);
        if (match) setHomeCounty(match);
        else setLocationError("Couldn't match your location to a county we cover yet.");
        setLocating(false);
      },
      (err) => {
        setLocationError(err.code === err.PERMISSION_DENIED ? "Location permission was denied — pick your area below instead." : "Couldn't get your location — pick your area below instead.");
        setLocating(false);
      },
      { timeout: 8000 }
    );
  };

  // Persists only what was actually answered (never a pre-selected default);
  // if nothing was, it's the flag-only skip. Either way onboarding is marked
  // done so it isn't offered again — it stays reachable from My Life/Profile.
  const persist = async (): Promise<boolean> => {
    const payload: Parameters<typeof saveOnboarding>[0] = {};
    if (homeCounty) payload.homeCounty = homeCounty;
    if (radiusTouched) payload.searchRadiusKm = radiusKm;
    if (interests.length || resident.interests.length) payload.interests = interests;
    setSaveError(null);
    setSaving(true);
    try {
      if (Object.keys(payload).length) await saveOnboarding(payload);
      else await skipOnboarding();
      await onSaved();
      return true;
    } catch (e) {
      // Offline or the session expired mid-flow: nothing is lost (answers stay
      // in this dialog) and the same button retries.
      setSaveError(e instanceof Error ? e.message : "Couldn't save that — check your connection and try again.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const skip = async () => {
    if (saving) return;
    const hadPartialAnswers = !!homeCounty || radiusTouched || interests.length > 0;
    trackTypedEvent(AnalyticsEvent.OnboardingSkipped, { step, hadPartialAnswers });
    if (await persist()) onClose();
  };

  const finish = async (thenGoTo?: string) => {
    if (saving) return;
    trackTypedEvent(AnalyticsEvent.OnboardingStepCompleted, { step: "interests" });
    if (await persist()) {
      trackTypedEvent(AnalyticsEvent.OnboardingCompleted);
      onClose();
      if (thenGoTo) navigate(thenGoTo);
    }
  };

  const continueFromLocation = () => {
    trackTypedEvent(AnalyticsEvent.OnboardingStepCompleted, { step: "location" });
    setStep("interests");
  };

  const filtered = counties.filter((c) => c.toLowerCase().includes(countySearch.trim().toLowerCase()));

  return (
    <SetupModal labelledBy="onboarding-title" onEscape={skip}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: colors.muted, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>
            {editing ? "Your preferences" : `Step ${step === "location" ? 1 : 2} of 2 · optional`}
          </div>
          <h2 id="onboarding-title" style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 24, margin: 0, letterSpacing: "-.01em" }}>
            {step === "location" ? (editing || !firstName ? "Where should we look?" : `Welcome, ${firstName}. Where should we look?`) : "What are you into?"}
          </h2>
        </div>
        <button type="button" onClick={skip} disabled={saving} aria-label="Close and skip setup" style={{ ...plainButton, fontSize: 22, lineHeight: 1, color: colors.muted, padding: 4 }}>
          ×
        </button>
      </div>
      <p style={{ margin: "8px 0 18px", fontSize: 14, color: colors.mutedLight, lineHeight: 1.5 }}>
        {step === "location"
          ? "This just helps us show what's nearby. You can skip it and change it any time in your profile."
          : "Pick anything you'd like to do nearby. Skip if you'd rather browse first."}
      </p>

      {step === "location" && (
        <>
          <div style={{ position: "relative", marginBottom: 12 }}>
            <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: colors.mutedLight, display: "flex", pointerEvents: "none" }}>
              <SearchIcon size={16} />
            </span>
            <input
              value={countySearch}
              onChange={(e) => setCountySearch(e.target.value)}
              placeholder="Search county"
              aria-label="Search county"
              autoComplete="off"
              style={{ ...inputStyle, paddingLeft: 38 }}
            />
          </div>
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "none", border: `1px solid ${colors.border}`, borderRadius: 11, padding: "9px 14px", fontSize: 13.5, fontWeight: 700, color: colors.text, cursor: locating ? "default" : "pointer", marginBottom: 12 }}
          >
            <PinIcon size={15} /> {locating ? "Finding you…" : "Use my current location"}
          </button>
          {locationError && <p role="status" style={{ margin: "0 0 12px", fontSize: 12.5, color: colors.danger }}>{locationError}</p>}

          {!countySearch && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              {POPULAR_COUNTIES.filter((c) => counties.includes(c)).map((c) => (
                <Chip key={c} label={c} active={homeCounty === c} onClick={() => setHomeCounty(c)} accent="green" radius={11} padding="8px 14px" />
              ))}
            </div>
          )}
          <div role="listbox" aria-label="Counties" style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 170, overflowY: "auto", marginBottom: 16 }}>
            {filtered.map((c) => (
              <button
                key={c}
                type="button"
                role="option"
                aria-selected={homeCounty === c}
                onClick={() => setHomeCounty(c)}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", textAlign: "left", background: homeCounty === c ? colors.greenBg : "transparent", border: "none", borderRadius: radius.control, padding: "9px 12px", fontSize: 14.5, fontWeight: homeCounty === c ? 700 : 500, color: homeCounty === c ? colors.greenText : colors.text, cursor: "pointer" }}
              >
                {c}
                {homeCounty === c && <CheckIcon size={15} />}
              </button>
            ))}
          </div>
          {!!homeCounty && (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: colors.muted, marginBottom: 8 }}>Search within</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {RADIUS_OPTIONS.map((r) => (
                  <Chip
                    key={r}
                    label={`${r} km`}
                    active={radiusKm === r}
                    onClick={() => {
                      setRadiusKm(r);
                      setRadiusTouched(true);
                    }}
                    accent="green"
                    radius={11}
                    padding="8px 14px"
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {step === "interests" && (
        <>
          {INTEREST_GROUPS.map((group) => (
            <div key={group.label} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: colors.muted, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 }}>{group.label}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8 }}>
                {group.items.map((i) => {
                  // A category not launched in this county still shows (never hidden outright)
                  // but can only be requested, feeding the existing demand-capture pipeline.
                  const live = marketFlags === null || marketFlags[i] !== false;
                  if (!live) {
                    const done = requested.includes(i);
                    return (
                      <button key={i} type="button" onClick={() => requestCategory(i)} disabled={done} style={{ border: `1.5px dashed ${colors.border}`, background: colors.surface, color: colors.mutedLight, borderRadius: 11, padding: "11px 12px", fontSize: 13, fontWeight: 600, textAlign: "left", cursor: done ? "default" : "pointer" }}>
                        {i} — {done ? "Requested" : "not yet here"}
                      </button>
                    );
                  }
                  const active = interests.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleInterest(i)}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: `1.5px solid ${active ? colors.green : colors.border}`, background: active ? colors.greenBg : colors.surface, borderRadius: 11, padding: "11px 12px", fontSize: 14, fontWeight: 700, color: active ? colors.greenText : colors.text, cursor: "pointer", textAlign: "left" }}
                    >
                      {i}
                      {active && <CheckIcon size={15} />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <p style={{ margin: "4px 0 0", fontSize: 13, color: colors.mutedLight }}>
            Availability, group size, budget and more are optional too —{" "}
            <button type="button" onClick={() => finish("/profile?tab=preferences")} disabled={saving} style={{ ...plainButton, fontSize: 13, fontWeight: 700, color: colors.text, textDecoration: "underline" }}>
              add them in your profile
            </button>
            .
          </p>
        </>
      )}

      {saveError && <ErrorLine id="onboarding-error" message={saveError} />}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginTop: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {step === "interests" && (
            <button type="button" onClick={() => setStep("location")} disabled={saving} style={{ ...plainButton, fontWeight: 700, color: colors.text }}>
              ← Back
            </button>
          )}
          <button type="button" onClick={skip} disabled={saving} style={{ ...plainButton, color: colors.muted }}>
            {editing ? "Cancel" : "Skip for now"}
          </button>
        </div>
        {step === "location" ? (
          <Button onClick={continueFromLocation} disabled={saving}>
            Continue
          </Button>
        ) : (
          <Button onClick={() => finish()} disabled={saving}>
            {saving ? "Saving…" : "Done"}
          </Button>
        )}
      </div>
    </SetupModal>
  );
}

// --- entry point -------------------------------------------------------------

export function AccountSetupDialogs({
  mode,
  resident,
  onResidentChanged,
  onVendorChanged,
  onCloseOnboarding,
}: {
  mode: "terms-resident" | "terms-vendor" | "onboarding";
  resident: ResidentFull | null;
  onResidentChanged: () => Promise<void>;
  onVendorChanged: () => Promise<void>;
  onCloseOnboarding: () => void;
}) {
  if (mode === "terms-resident") {
    return (
      <TermsDialog
        who="resident"
        onAccepted={onResidentChanged}
        onSignOut={async () => {
          await guestLogout();
          await onResidentChanged();
        }}
      />
    );
  }
  if (mode === "terms-vendor") {
    return (
      <TermsDialog
        who="vendor"
        onAccepted={onVendorChanged}
        onSignOut={async () => {
          await logout();
          await onVendorChanged();
        }}
      />
    );
  }
  if (!resident) return null;
  return <OnboardingDialog resident={resident} onSaved={onResidentChanged} onClose={onCloseOnboarding} />;
}
