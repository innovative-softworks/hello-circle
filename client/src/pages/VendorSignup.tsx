import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent, InputHTMLAttributes, ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signup, signupWithGoogle } from "../api";
import { AnalyticsEvent, trackTypedEvent } from "../analyticsEvents";
import { AuthEditorialHeader, AuthEditorialShell } from "../components/AuthEditorialShell";
import { GuidedFlow } from "../components/GuidedFlow";
import { CheckboxField, OAuthDivider, OAuthNotice, useFocusOnError, useOAuthNotice } from "../components/AuthForms";
import {
  BallIcon,
  BuildingIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  MailIcon,
  PersonIcon,
  PhoneIcon,
  PinIcon,
  UsersIcon,
} from "../components/icons";
import { Button, inputStyle, labelStyle } from "../components/ui";
import { useGoogleSignIn } from "../googleSignIn";
import { colors } from "../theme";
import type { VendorType } from "../types";

// Vendor account + listing intake — same AuthEditorialShell/orange accent
// as Login.tsx and the rest of the vendor auth family. Two-step GuidedFlow
// (Account -> About you) instead of one long scrolling form (Form System
// Audit follow-up) — same Guided Flow pattern as CentreCreationWizard.tsx,
// just without that wizard's draft-row-per-step persistence: signup is one
// atomic POST /signup call (there's no "half-created account" to save), so
// step 1's "Continue" is pure client-side validation before advancing, and
// only step 2's final submit hits the server.

const DESCRIPTION_MAX = 300;
const STEP_LABELS = ["Account", "About you"];

const IRISH_COUNTIES = [
  "Antrim", "Armagh", "Carlow", "Cavan", "Clare", "Cork", "Derry", "Donegal",
  "Down", "Dublin", "Fermanagh", "Galway", "Kerry", "Kildare", "Kilkenny",
  "Laois", "Leitrim", "Limerick", "Longford", "Louth", "Mayo", "Meath",
  "Monaghan", "Offaly", "Roscommon", "Sligo", "Tipperary", "Tyrone",
  "Waterford", "Westmeath", "Wexford", "Wicklow",
];

// Every field below now carries a real id + this label's matching htmlFor —
// auth UX audit finding C2: none of them did before, so this entire form was
// programmatically unlabeled for screen readers and unreachable by name for
// password managers/autofill.
function Field({ label, span, htmlFor, children }: { label: string; span?: boolean; htmlFor: string; children: ReactNode }) {
  return (
    <div style={span ? { gridColumn: "1 / -1" } : undefined}>
      <label htmlFor={htmlFor} style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

const iconSlotStyle: CSSProperties = {
  position: "absolute",
  left: 12,
  top: "50%",
  transform: "translateY(-50%)",
  color: colors.faint,
  display: "flex",
  pointerEvents: "none",
};

function IconInput({ icon, style, ...rest }: { icon: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div style={{ position: "relative" }}>
      <span style={iconSlotStyle}>{icon}</span>
      <input {...rest} style={{ ...inputStyle, paddingLeft: 36, ...style }} />
    </div>
  );
}

const gridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 16, rowGap: 14 };

const HERO_IMAGE = {
  src: "https://images.unsplash.com/photo-1526232761682-d26e03ac148e?w=1920&q=75&auto=format&fit=crop",
  alt: "A local five-a-side football match in progress on an outdoor pitch",
};
const CAPTION = {
  heading: <>Fill your rooms.<br />Grow your community.<br />Run it your way.</>,
  avatarCaption: "Join hundreds of venues and clubs already listed.",
  avatarSeedPrefix: "hc-vendor-avatar",
};

// Onboarding audit F-9 — vendor signup is a single atomic POST /signup call
// (see the module comment above), so there's no server-side draft row to
// resume from the way CentreCreationWizard.tsx's post-approval listing
// editing has. This is a lightweight, purely client-side stand-in: every
// field except password (never persisted — the person re-enters that) is
// mirrored into localStorage as it's typed, restored on mount, and cleared
// on a successful submit. Best-effort only — a private window or blocked
// site data just means no resume, never a broken form (see try/catch below).
const VENDOR_SIGNUP_DRAFT_KEY = "hc_vendor_signup_draft";
interface VendorSignupDraft {
  name: string;
  email: string;
  vendorType: VendorType | null;
  businessName: string;
  address: string;
  county: string;
  mobile: string;
  landline: string;
  description: string;
  termsAccepted: boolean;
  marketingConsent: boolean;
}
function loadVendorSignupDraft(): Partial<VendorSignupDraft> {
  try {
    const raw = localStorage.getItem(VENDOR_SIGNUP_DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Partial<VendorSignupDraft>) : {};
  } catch {
    return {};
  }
}
function saveVendorSignupDraft(draft: VendorSignupDraft) {
  try {
    localStorage.setItem(VENDOR_SIGNUP_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Private browsing / blocked storage — resuming just silently isn't available.
  }
}
function clearVendorSignupDraft() {
  try {
    localStorage.removeItem(VENDOR_SIGNUP_DRAFT_KEY);
  } catch {
    // Nothing to do — see saveVendorSignupDraft above.
  }
}

export function VendorSignup() {
  const navigate = useNavigate();
  // Read once, on mount — not on every render, so typing doesn't keep
  // re-reading localStorage.
  const draft = useMemo(() => loadVendorSignupDraft(), []);
  const [step, setStep] = useState(1);
  const [name, setName] = useState(draft.name ?? "");
  const [email, setEmail] = useState(draft.email ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [vendorType, setVendorType] = useState<VendorType | null>(draft.vendorType ?? null);
  const [businessName, setBusinessName] = useState(draft.businessName ?? "");
  const [address, setAddress] = useState(draft.address ?? "");
  const [county, setCounty] = useState(draft.county ?? "");
  const [mobile, setMobile] = useState(draft.mobile ?? "");
  const [landline, setLandline] = useState(draft.landline ?? "");
  const [description, setDescription] = useState(draft.description ?? "");
  const [termsAccepted, setTermsAccepted] = useState(draft.termsAccepted ?? false);
  const [marketingConsent, setMarketingConsent] = useState(draft.marketingConsent ?? false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  // Set once Google sign-in succeeds on step 1 — email is then locked to the
  // verified Google identity (editing it would just be discarded server-side
  // anyway, since POST /auth/signup-google derives email from the token, not
  // the request body) and the password field is skipped entirely.
  const [googleIdToken, setGoogleIdToken] = useState<string | null>(null);
  const { notice, trigger: triggerApple } = useOAuthNotice();
  const { busy: googleBusy, error: googleError, trigger: triggerGoogle } = useGoogleSignIn(async (idToken, profile) => {
    setGoogleIdToken(idToken);
    setEmail(profile.email);
    if (!name.trim() && profile.name) setName(profile.name);
    setStepError(null);
    trackTypedEvent(AnalyticsEvent.VendorSignupStepCompleted, { step: 1, method: "google" });
    setStep(2);
  });

  const stepErrorRef = useFocusOnError(stepError);
  const errorRef = useFocusOnError(error);

  useEffect(() => {
    trackTypedEvent(AnalyticsEvent.VendorSignupStarted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Onboarding audit F-9 — keeps the draft current as the person types.
  // Never persists `done` state or password; see saveVendorSignupDraft above.
  useEffect(() => {
    if (done) return;
    saveVendorSignupDraft({ name, email, vendorType, businessName, address, county, mobile, landline, description, termsAccepted, marketingConsent });
  }, [name, email, vendorType, businessName, address, county, mobile, landline, description, termsAccepted, marketingConsent, done]);

  const useDifferentMethod = () => {
    setGoogleIdToken(null);
    setEmail("");
  };

  // Called both by GuidedFlow's Continue button (a real type="submit" now)
  // and by pressing Enter in any step-1 field, via the wrapping <form>'s
  // onSubmit below — a single code path for both triggers.
  const step1Continue = () => (googleIdToken ? setStep(2) : goNext());

  const goNext = () => {
    if (!name.trim()) {
      trackTypedEvent(AnalyticsEvent.VendorSignupValidationFailed, { step: 1, field: "name" });
      return setStepError("Your name is required");
    }
    if (!email.trim() || !email.includes("@")) {
      trackTypedEvent(AnalyticsEvent.VendorSignupValidationFailed, { step: 1, field: "email" });
      return setStepError("A valid email is required");
    }
    if (password.length < 8) {
      trackTypedEvent(AnalyticsEvent.VendorSignupValidationFailed, { step: 1, field: "password" });
      return setStepError("Use at least 8 characters for your password");
    }
    setStepError(null);
    trackTypedEvent(AnalyticsEvent.VendorSignupStepCompleted, { step: 1, method: "password" });
    setStep(2);
  };
  const goBack = () => {
    setStepError(null);
    setStep(1);
  };

  const formComplete = !!vendorType && !!businessName && !!address && !!county && !!mobile && !!description && termsAccepted;

  const submit = async () => {
    if (submitting) return;
    if (!vendorType) return;
    setError(null);
    setSubmitting(true);
    try {
      if (googleIdToken) {
        await signupWithGoogle(googleIdToken, { name, vendorType, businessName, address, county, mobile, landline, description, termsAccepted, marketingConsent });
      } else {
        await signup({ name, email, password, vendorType, businessName, address, county, mobile, landline, description, termsAccepted, marketingConsent });
      }
      trackTypedEvent(AnalyticsEvent.VendorSignupCompleted, { vendorType: vendorType ?? "unknown", method: googleIdToken ? "google" : "password" });
      clearVendorSignupDraft();
      setDone(true);
    } catch (e) {
      trackTypedEvent(AnalyticsEvent.VendorSignupError, { reason: "server" });
      setError(e instanceof Error ? e.message : "Couldn't create your account");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <AuthEditorialShell heroImage={HERO_IMAGE} caption={CAPTION}>
        <div
          className="pop-in"
          style={{
            width: 56, height: 56, borderRadius: "50%", background: colors.orangeBg,
            display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20, color: colors.orangeDark,
          }}
        >
          <CheckIcon size={26} />
        </div>
        <AuthEditorialHeader
          eyebrow="For venues & hosts"
          accent="orange"
          headline="Account created."
          subtitle={
            <>Your full registration is awaiting admin approval. Once approved, log in to publish listings
              for your {vendorType === "sports" ? "sports club" : "community centre"}.</>
          }
        />
        <Button variant="orange" onClick={() => navigate("/login")}>Log in</Button>
      </AuthEditorialShell>
    );
  }

  const typeOptions: { type: VendorType; label: string; icon: ReactNode }[] = [
    { type: "community", label: "Community hall or Centre", icon: <UsersIcon size={18} /> },
    { type: "sports", label: "Sports club", icon: <BallIcon size={18} /> },
  ];

  const businessLabel = vendorType === "sports" ? "Sports club name" : vendorType === "community" ? "Community hall/centre name" : "Business name";
  const businessPlaceholder = vendorType === "sports" ? "Enter your sports club name" : "Enter your centre/hall name";

  return (
    <AuthEditorialShell contentMaxWidth={640} heroImage={HERO_IMAGE} caption={CAPTION}>
      {step === 1 ? (
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); step1Continue(); }}>
        <GuidedFlow
          title="Create your account."
          subtitle="You'll use this to log in and manage your listings."
          stepLabels={STEP_LABELS}
          currentStep={1}
          accent="orange"
          showBack={false}
          onBack={() => {}}
          onContinue={step1Continue}
          continueType="submit"
          continueLabel="Continue →"
          continueDisabled={googleIdToken ? !name.trim() : false}
          error={stepError}
          errorId="vendor-signup-step1-error"
          errorRef={stepErrorRef}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Your name" htmlFor="vendor-signup-name">
              <IconInput
                id="vendor-signup-name"
                name="name"
                icon={<PersonIcon size={16} />}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                autoComplete="name"
                placeholder="Enter your full name"
                aria-invalid={!!stepError}
                aria-describedby={stepError ? "vendor-signup-step1-error" : undefined}
              />
            </Field>
            {googleIdToken ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 12px", borderRadius: 11, background: colors.orangeBg, border: `1px solid ${colors.inputBorder}` }}>
                <span style={{ fontSize: 13.5, color: colors.text }}>
                  Signed in as <strong>{email}</strong> via Google
                </span>
                <button type="button" className="auth-plain-btn" onClick={useDifferentMethod} style={{ background: "none", border: "none", padding: 0, fontSize: 12.5, fontWeight: 700, color: colors.orangeDark, cursor: "pointer", flex: "none" }}>
                  Use a different method
                </button>
              </div>
            ) : (
              <>
                <Field label="Email" htmlFor="vendor-signup-email">
                  <IconInput
                    id="vendor-signup-email"
                    name="email"
                    type="email"
                    icon={<MailIcon size={16} />}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    placeholder="you@email.ie"
                    aria-invalid={!!stepError}
                    aria-describedby={stepError ? "vendor-signup-step1-error" : undefined}
                  />
                </Field>
                <Field label="Password" htmlFor="vendor-signup-password">
                  <div style={{ position: "relative" }}>
                    <span style={iconSlotStyle}><LockIcon size={16} /></span>
                    <input
                      id="vendor-signup-password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                      placeholder="Create a strong password"
                      aria-invalid={!!stepError}
                      aria-describedby={stepError ? "vendor-signup-step1-error" : undefined}
                      style={{ ...inputStyle, paddingLeft: 36, paddingRight: 36 }}
                    />
                    <button
                      type="button"
                      className="auth-plain-btn"
                      onClick={() => setShowPassword((s) => !s)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      style={{ position: "absolute", right: 10, top: 11, background: "none", border: "none", padding: 4, cursor: "pointer", color: colors.faint, display: "flex" }}
                    >
                      {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                    </button>
                  </div>
                  <p style={{ fontSize: 12, color: colors.faint, margin: "6px 0 0" }}>At least 8 characters.</p>
                </Field>
                <OAuthDivider onGoogle={triggerGoogle} googleBusy={googleBusy} onApple={triggerApple} />
                {googleError && <div style={{ marginTop: -4 }}><p role="alert" style={{ color: colors.danger, fontSize: 13, margin: 0 }}>{googleError}</p></div>}
                <OAuthNotice notice={notice} />
              </>
            )}
          </div>
        </GuidedFlow>
        </form>
      ) : (
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); submit(); }}>
        <GuidedFlow
          title="About your place."
          subtitle="We'll use this to set up your first listing for admin review."
          stepLabels={STEP_LABELS}
          currentStep={2}
          accent="orange"
          onBack={goBack}
          onContinue={submit}
          continueType="submit"
          continueLabel={submitting ? "Creating account…" : "Create vendor account"}
          continueDisabled={!formComplete}
          continueBusy={submitting}
          error={error}
          errorId="vendor-signup-step2-error"
          errorRef={errorRef}
        >
          <div>
            <label style={labelStyle}>What are you?</label>
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              {typeOptions.map((opt) => (
                <div
                  key={opt.type}
                  onClick={() => setVendorType(opt.type)}
                  style={{
                    position: "relative",
                    flex: 1,
                    cursor: "pointer",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: `2px solid ${vendorType === opt.type ? colors.orange : colors.inputBorder}`,
                    background: vendorType === opt.type ? colors.orangeBg : "#fff",
                    textAlign: "center",
                    transition: "border-color .15s ease, background .15s ease",
                  }}
                >
                  {vendorType === opt.type && (
                    <div
                      style={{
                        position: "absolute",
                        top: -8,
                        right: -8,
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        background: colors.orange,
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        boxShadow: "0 2px 6px rgba(232,109,42,.35)",
                      }}
                    >
                      <CheckIcon size={11} />
                    </div>
                  )}
                  <div style={{ color: vendorType === opt.type ? colors.orange : colors.muted, marginBottom: 4, display: "flex", justifyContent: "center" }}>{opt.icon}</div>
                  <div style={{ fontSize: 12.5, fontWeight: 700 }}>{opt.label}</div>
                </div>
              ))}
            </div>

            <div className="grid-responsive" style={gridStyle}>
              <Field label={businessLabel} htmlFor="vendor-signup-business-name">
                <IconInput
                  id="vendor-signup-business-name"
                  name="organization"
                  icon={<BuildingIcon size={16} />}
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  autoComplete="organization"
                  placeholder={businessPlaceholder}
                  aria-invalid={!!error}
                  aria-describedby={error ? "vendor-signup-step2-error" : undefined}
                />
              </Field>
              <Field label="County" htmlFor="vendor-signup-county">
                <div style={{ position: "relative" }}>
                  <span style={iconSlotStyle}><PinIcon size={16} /></span>
                  <select
                    id="vendor-signup-county"
                    name="address-level1"
                    autoComplete="address-level1"
                    value={county}
                    onChange={(e) => setCounty(e.target.value)}
                    style={{ ...inputStyle, paddingLeft: 36 }}
                  >
                    <option value="" disabled>Select county</option>
                    {IRISH_COUNTIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </Field>
              <Field label="Address" span htmlFor="vendor-signup-address">
                <IconInput
                  id="vendor-signup-address"
                  name="street-address"
                  icon={<PinIcon size={16} />}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  autoComplete="street-address"
                  placeholder="Enter complete address"
                  aria-invalid={!!error}
                  aria-describedby={error ? "vendor-signup-step2-error" : undefined}
                />
              </Field>
              <Field label="Mobile number" htmlFor="vendor-signup-mobile">
                <IconInput
                  id="vendor-signup-mobile"
                  name="tel"
                  icon={<PhoneIcon size={16} />}
                  type="tel"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  autoComplete="tel"
                  placeholder="Enter mobile number"
                />
              </Field>
              <Field label="Landline number (optional)" htmlFor="vendor-signup-landline">
                <IconInput
                  id="vendor-signup-landline"
                  name="tel-national"
                  icon={<PhoneIcon size={16} />}
                  type="tel"
                  value={landline}
                  onChange={(e) => setLandline(e.target.value)}
                  autoComplete="tel-national"
                  placeholder="Enter landline number"
                />
              </Field>
              <Field label="Description" span htmlFor="vendor-signup-description">
                <div style={{ position: "relative" }}>
                  <textarea
                    id="vendor-signup-description"
                    name="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value.slice(0, DESCRIPTION_MAX))}
                    placeholder="Tell us about your centre or club"
                    rows={2}
                    maxLength={DESCRIPTION_MAX}
                    style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit", paddingBottom: 20 }}
                  />
                  <span style={{ position: "absolute", right: 10, bottom: 6, fontSize: 11, color: colors.faint }}>
                    {description.length}/{DESCRIPTION_MAX}
                  </span>
                </div>
              </Field>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
              <CheckboxField id="vendor-signup-terms" checked={termsAccepted} onChange={setTermsAccepted}>
                I agree to HelloCircle's{" "}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: colors.text, fontWeight: 700 }}>Privacy Policy</a> and Terms.
              </CheckboxField>
              <CheckboxField id="vendor-signup-marketing" checked={marketingConsent} onChange={setMarketingConsent}>
                Send me occasional emails about new features and vendor tips (optional).
              </CheckboxField>
            </div>
          </div>
        </GuidedFlow>
        </form>
      )}

      {step === 1 && (
        <p style={{ textAlign: "center", color: colors.muted, fontSize: 14, marginTop: 18 }}>
          Already have an account?{" "}
          <Link to="/login" className="link-accent" style={{ textDecoration: "none", color: colors.orange, fontWeight: 700 }}>
            Log in
          </Link>
        </p>
      )}
    </AuthEditorialShell>
  );
}
