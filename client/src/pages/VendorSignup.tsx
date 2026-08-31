import { useState } from "react";
import type { CSSProperties, InputHTMLAttributes, ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signup } from "../api";
import { AuthEditorialHeader, AuthEditorialShell } from "../components/AuthEditorialShell";
import { GuidedFlow } from "../components/GuidedFlow";
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

function Field({ label, span, children }: { label: string; span?: boolean; children: ReactNode }) {
  return (
    <div style={span ? { gridColumn: "1 / -1" } : undefined}>
      <label style={labelStyle}>{label}</label>
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

export function VendorSignup() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [vendorType, setVendorType] = useState<VendorType | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [address, setAddress] = useState("");
  const [county, setCounty] = useState("");
  const [mobile, setMobile] = useState("");
  const [landline, setLandline] = useState("");
  const [description, setDescription] = useState("");
  const [stepError, setStepError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const goNext = () => {
    if (!name.trim()) return setStepError("Your name is required");
    if (!email.trim() || !email.includes("@")) return setStepError("A valid email is required");
    if (password.length < 8) return setStepError("Use at least 8 characters for your password");
    setStepError(null);
    setStep(2);
  };
  const goBack = () => {
    setStepError(null);
    setStep(1);
  };

  const formComplete = !!vendorType && !!businessName && !!address && !!county && !!mobile && !!description;

  const submit = async () => {
    if (!vendorType) return;
    setError(null);
    setSubmitting(true);
    try {
      await signup({ name, email, password, vendorType, businessName, address, county, mobile, landline, description });
      setDone(true);
    } catch (e) {
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
        <GuidedFlow
          title="Create your account."
          subtitle="You'll use this to log in and manage your listings."
          stepLabels={STEP_LABELS}
          currentStep={1}
          accent="orange"
          showBack={false}
          onBack={() => {}}
          onContinue={goNext}
          continueLabel="Continue →"
          error={stepError}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Your name">
              <IconInput icon={<PersonIcon size={16} />} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Enter your full name" />
            </Field>
            <Field label="Email">
              <IconInput icon={<MailIcon size={16} />} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.ie" />
            </Field>
            <Field label="Password">
              <div style={{ position: "relative" }}>
                <span style={iconSlotStyle}><LockIcon size={16} /></span>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a strong password"
                  style={{ ...inputStyle, paddingLeft: 36, paddingRight: 36 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  style={{ position: "absolute", right: 10, top: 11, background: "none", border: "none", padding: 4, cursor: "pointer", color: colors.faint, display: "flex" }}
                >
                  {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                </button>
              </div>
              <p style={{ fontSize: 12, color: colors.faint, margin: "6px 0 0" }}>At least 8 characters.</p>
            </Field>
          </div>
        </GuidedFlow>
      ) : (
        <GuidedFlow
          title="About your place."
          subtitle="We'll use this to set up your first listing for admin review."
          stepLabels={STEP_LABELS}
          currentStep={2}
          accent="orange"
          onBack={goBack}
          onContinue={submit}
          continueLabel={submitting ? "Creating account…" : "Create vendor account"}
          continueDisabled={!formComplete}
          continueBusy={submitting}
          error={error}
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
              <Field label={businessLabel}>
                <IconInput icon={<BuildingIcon size={16} />} value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder={businessPlaceholder} />
              </Field>
              <Field label="County">
                <div style={{ position: "relative" }}>
                  <span style={iconSlotStyle}><PinIcon size={16} /></span>
                  <select value={county} onChange={(e) => setCounty(e.target.value)} style={{ ...inputStyle, paddingLeft: 36 }}>
                    <option value="" disabled>Select county</option>
                    {IRISH_COUNTIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </Field>
              <Field label="Address" span>
                <IconInput icon={<PinIcon size={16} />} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Enter complete address" />
              </Field>
              <Field label="Mobile number">
                <IconInput icon={<PhoneIcon size={16} />} type="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="Enter mobile number" />
              </Field>
              <Field label="Landline number (optional)">
                <IconInput icon={<PhoneIcon size={16} />} type="tel" value={landline} onChange={(e) => setLandline(e.target.value)} placeholder="Enter landline number" />
              </Field>
              <Field label="Description" span>
                <div style={{ position: "relative" }}>
                  <textarea
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
          </div>
        </GuidedFlow>
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
