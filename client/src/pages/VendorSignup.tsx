import { useState } from "react";
import type { CSSProperties, InputHTMLAttributes, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { signup } from "../api";
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
  StarIcon,
  UsersIcon,
} from "../components/icons";
import { Button, Card, inputStyle, labelStyle } from "../components/ui";
import { colors, fonts } from "../theme";
import type { VendorType } from "../types";

const DESCRIPTION_MAX = 300;

const IRISH_COUNTIES = [
  "Antrim", "Armagh", "Carlow", "Cavan", "Clare", "Cork", "Derry", "Donegal",
  "Down", "Dublin", "Fermanagh", "Galway", "Kerry", "Kildare", "Kilkenny",
  "Laois", "Leitrim", "Limerick", "Longford", "Louth", "Mayo", "Meath",
  "Monaghan", "Offaly", "Roscommon", "Sligo", "Tipperary", "Tyrone",
  "Waterford", "Westmeath", "Wexford", "Wicklow",
];

function SectionHeader({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 14px" }}>
      <div style={{ width: 22, height: 22, borderRadius: "50%", background: colors.greenBg, color: colors.green, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
        {icon}
      </div>
      <span style={{ fontWeight: 700, fontSize: 14, color: colors.green }}>{title}</span>
    </div>
  );
}

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

const gridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 16, rowGap: 14, marginBottom: 14 };

export function VendorSignup() {
  const navigate = useNavigate();
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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const formComplete =
    !!name && !!email && password.length >= 8 && !!vendorType && !!businessName && !!address && !!county && !!mobile && !!description;

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
      <div className="fade-panel">
        <section className="section-pad" style={{ maxWidth: 480, margin: "0 auto", padding: "64px 24px 90px", textAlign: "center" }}>
          <div
            className="pop-in"
            style={{
              width: 78,
              height: 78,
              borderRadius: "50%",
              background: colors.greenBg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 22px",
              fontSize: 36,
              color: colors.green,
              boxShadow: "0 10px 26px rgba(30,122,76,.18)",
            }}
          >
            <CheckIcon size={34} />
          </div>
          <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 28, margin: "0 0 8px", letterSpacing: "-.02em" }}>
            Account created
          </h1>
          <p style={{ color: colors.muted, fontSize: 15, margin: "0 0 26px", lineHeight: 1.55 }}>
            Your full registration is awaiting admin approval. Once approved, log in to publish listings
            for your {vendorType === "sports" ? "sports club" : "community centre"}.
          </p>
          <Button onClick={() => navigate("/login")}>Log in</Button>
        </section>
      </div>
    );
  }

  const typeOptions: { type: VendorType; label: string; icon: ReactNode }[] = [
    { type: "community", label: "Community hall or Centre", icon: <UsersIcon size={18} /> },
    { type: "sports", label: "Sports club", icon: <BallIcon size={18} /> },
  ];

  const businessLabel = vendorType === "sports" ? "Sports club name" : vendorType === "community" ? "Community hall/centre name" : "Business name";
  const businessPlaceholder = vendorType === "sports" ? "Enter your sports club name" : "Enter your centre/hall name";

  return (
    <div className="fade-panel">
      <section className="section-pad" style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px 56px" }}>
        <div
          className="pop-in"
          style={{
            width: 44,
            height: 44,
            borderRadius: 13,
            background: colors.green,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            margin: "0 auto 12px",
            boxShadow: "0 10px 24px rgba(30,122,76,.28)",
          }}
        >
          <StarIcon size={20} style={{ color: "#fff" }} />
        </div>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 26, margin: "0 0 4px", letterSpacing: "-.02em", textAlign: "center" }}>
          List your centre or club
        </h1>
        <p style={{ color: colors.muted, fontSize: 14, margin: "0 0 20px", textAlign: "center" }}>
          Create a vendor account to add and manage your own listings on Hello Circle.
        </p>

        <Card style={{ padding: 26, boxShadow: "0 10px 30px rgba(30,40,32,.05)" }}>
          <SectionHeader icon={<PersonIcon size={12} />} title="Account details" />

          <div className="grid-responsive" style={gridStyle}>
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

          <div style={{ height: 1, background: colors.border, margin: "0 0 16px" }} />

          <SectionHeader icon={<UsersIcon size={12} />} title="About you" />

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
                  border: `2px solid ${vendorType === opt.type ? colors.green : colors.inputBorder}`,
                  background: vendorType === opt.type ? colors.greenBg : "#fff",
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
                      background: colors.green,
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: "0 2px 6px rgba(30,122,76,.35)",
                    }}
                  >
                    <CheckIcon size={11} />
                  </div>
                )}
                <div style={{ color: vendorType === opt.type ? colors.green : colors.muted, marginBottom: 4, display: "flex", justifyContent: "center" }}>{opt.icon}</div>
                <div style={{ fontSize: 12.5, fontWeight: 700 }}>{opt.label}</div>
              </div>
            ))}
          </div>

          <div className="grid-responsive" style={{ ...gridStyle, marginBottom: 0 }}>
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

          {error && (
            <p className="pop-in" style={{ color: "#b00020", fontSize: 14, margin: "16px 0 0", background: "#FBEAEA", padding: "9px 12px", borderRadius: 10 }}>
              {error}
            </p>
          )}
          <Button variant="primary" full disabled={submitting || !formComplete} onClick={submit} style={{ marginTop: 18 }}>
            <PersonIcon size={14} /> {submitting ? "Creating account…" : "Create vendor account"}
          </Button>
        </Card>

        <p style={{ textAlign: "center", color: colors.muted, fontSize: 14, marginTop: 18 }}>
          Already have an account?{" "}
          <span className="link-accent" style={{ color: colors.green, fontWeight: 700, cursor: "pointer" }} onClick={() => navigate("/login")}>
            Log in
          </span>
        </p>
      </section>
    </div>
  );
}
