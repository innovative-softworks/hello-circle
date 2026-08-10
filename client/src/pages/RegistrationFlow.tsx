import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createRegistrationCheckout, fetchClub, validateCoupon, PLATFORM_FEE_RATE, VAT_RATE } from "../api";
import { Chip } from "../components/Chip";
import { Photo } from "../components/Photo";
import { Stepper } from "../components/Stepper";
import { PageSpinner } from "../components/ui";
import { AGE_GROUPS } from "../constants";
import { useMyStuff } from "../MyStuffContext";
import { priceLabel } from "../priceLabel";
import { CheckIcon, ChevronLeftIcon, CloseIcon } from "../components/icons";
import { colors, fonts } from "../theme";
import type { Club } from "../types";
import { isValidEmail } from "../validate";

interface RegForm {
  team: string;
  childFirst: string;
  childLast: string;
  dob: string;
  gFirst: string;
  gLast: string;
  email: string;
  phone: string;
  address: string;
  ecName: string;
  ecPhone: string;
  ecRel: string;
  medical: string;
  consent: boolean;
  trial: boolean;
}

function blankForm(): RegForm {
  return {
    team: "", childFirst: "", childLast: "", dob: "", gFirst: "", gLast: "", email: "", phone: "", address: "",
    ecName: "", ecPhone: "", ecRel: "", medical: "", consent: false, trial: false,
  };
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "12px 14px", border: `1px solid ${colors.inputBorder}`, borderRadius: 12,
  fontSize: 15, background: "#fff", color: colors.text, outline: "none",
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, color: colors.muted, margin: "0 0 6px" };

export function RegistrationFlow() {
  const { clubId } = useParams<{ clubId: string }>();
  const navigate = useNavigate();
  const { refresh } = useMyStuff();
  const [club, setClub] = useState<Club | null>(null);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<RegForm>(blankForm());
  const [ref, setRef] = useState<string | null>(null);
  const [confirmedTotalEuro, setConfirmedTotalEuro] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<{ code: string; discountCents: number } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponChecking, setCouponChecking] = useState(false);

  useEffect(() => {
    if (clubId) fetchClub(clubId).then(setClub);
  }, [clubId]);

  const set = <K extends keyof RegForm>(field: K, value: RegForm[K]) => setForm((f) => ({ ...f, [field]: value }));
  const top = () => window.scrollTo({ top: 0, behavior: "smooth" });

  const isCash = club?.paymentMethod === "cash";
  const subtotalCents = club ? club.price * 100 : 0;
  const discountCents = coupon?.discountCents ?? 0;
  const taxableCents = Math.max(0, subtotalCents - discountCents);
  const vatCents = Math.round(taxableCents * VAT_RATE);
  const feeCents = Math.round(taxableCents * PLATFORM_FEE_RATE);
  const totalCents = taxableCents + vatCents + feeCents;

  const r1Ready = !!(form.childFirst && form.childLast && form.dob && form.team);
  const r2Ready = !!(form.gFirst && form.gLast && form.email && isValidEmail(form.email) && form.phone && form.address && form.ecName && form.ecPhone);
  const r3Ready = form.consent;
  const r4Ready = true;
  const ready = step === 1 ? r1Ready : step === 2 ? r2Ready : step === 3 ? r3Ready : r4Ready;

  const applyCoupon = async () => {
    if (!couponInput.trim()) return;
    setCouponChecking(true);
    setCouponError(null);
    try {
      const res = await validateCoupon(couponInput.trim(), subtotalCents);
      setCoupon({ code: res.code, discountCents: res.discountCents });
    } catch (e) {
      setCoupon(null);
      setCouponError(e instanceof Error ? e.message : "Couldn't apply that code");
    } finally {
      setCouponChecking(false);
    }
  };

  const removeCoupon = () => {
    setCoupon(null);
    setCouponInput("");
    setCouponError(null);
  };

  const submit = async () => {
    if (!clubId) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await createRegistrationCheckout({
        clubId, team: form.team, childFirst: form.childFirst, childLast: form.childLast, dob: form.dob,
        gFirst: form.gFirst, gLast: form.gLast, email: form.email, phone: form.phone, address: form.address,
        ecName: form.ecName, ecPhone: form.ecPhone, ecRel: form.ecRel, medical: form.medical,
        consent: form.consent, trial: form.trial, couponCode: form.trial ? undefined : coupon?.code,
      });
      if (res.url) {
        window.location.href = res.url;
        return;
      }
      // Free trial or cash-mode club — confirmed immediately, no payment redirect.
      setRef(res.ref);
      setConfirmedTotalEuro(res.totalEuro);
      setStep(5);
      refresh();
      top();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const next = () => {
    if (!ready) return;
    if (step < 4) {
      setStep(step + 1);
      top();
    } else {
      submit();
    }
  };
  const prev = () => {
    if (step > 1) {
      setStep(step - 1);
      top();
    }
  };
  const back = () => {
    if (step > 1) prev();
    else navigate(`/clubs/${clubId}`);
  };

  if (!club) return <PageSpinner />;

  const childName = `${form.childFirst} ${form.childLast}`.trim();

  if (step === 5) {
    return (
      <div style={{ animation: "fadeUp .3s ease both" }}>
        <section className="section-pad" style={{ maxWidth: 640, margin: "0 auto", padding: "56px 24px 80px", textAlign: "center" }}>
          <div
            style={{ width: 74, height: 74, borderRadius: "50%", background: colors.orangeBg, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 22px", fontSize: 34, color: colors.orange }}
          >
            <CheckIcon size={32} />
          </div>
          <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 34, margin: "0 0 8px", letterSpacing: "-.02em" }}>
            {form.trial ? "Trial session booked!" : "Registration confirmed!"}
          </h1>
          <p style={{ color: colors.muted, fontSize: 17, margin: "0 0 28px" }}>
            {form.trial
              ? `We've emailed ${form.email || "you"} the details for ${form.childFirst || "your child"}'s free trial.`
              : `Pay €${confirmedTotalEuro.toFixed(2)} in cash at the club — no online payment needed. We've emailed ${form.email || "you"} the details.`}
          </p>
          <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 18, padding: 24, textAlign: "left", marginBottom: 24 }}>
            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 2 }}>{club.name}</div>
            <div style={{ color: colors.mutedLight, fontSize: 14, marginBottom: 16 }}>{club.sport}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <div style={{ fontSize: 12, color: colors.faint, fontWeight: 600 }}>CHILD</div>
                <div style={{ fontWeight: 600 }}>{childName}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: colors.faint, fontWeight: 600 }}>AGE GROUP</div>
                <div style={{ fontWeight: 600 }}>{form.team}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: colors.faint, fontWeight: 600 }}>REFERENCE</div>
                <div style={{ fontWeight: 600 }}>{ref}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: colors.faint, fontWeight: 600 }}>STATUS</div>
                <div style={{ fontWeight: 600 }}>{form.trial ? "Free trial" : "Cash on arrival"}</div>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={() => navigate("/bookings")} style={{ background: colors.orange, color: "#fff", border: "none", borderRadius: 12, padding: "13px 22px", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
              View my bookings
            </button>
            <button onClick={() => navigate("/")} style={{ background: "#fff", color: colors.text, border: `1px solid ${colors.borderStrong}`, borderRadius: 12, padding: "13px 22px", fontWeight: 600, fontSize: 15, cursor: "pointer" }}>
              Back home
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div style={{ animation: "fadeUp .3s ease both" }}>
      <section className="section-pad" style={{ maxWidth: 920, margin: "0 auto", padding: "26px 24px 80px" }}>
        <button onClick={back} style={{ display: "inline-flex", alignItems: "center", background: "none", border: "none", color: colors.muted, fontWeight: 600, fontSize: 14, cursor: "pointer", padding: 0, marginBottom: 20 }}>
          <ChevronLeftIcon size={14} style={{ marginRight: 4 }} /> {step > 1 ? "Back a step" : "Back to club"}
        </button>
        <Stepper labels={["Your child", "Contacts", "Medical", "Review & pay"]} current={step} accent="orange" />

        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 32, alignItems: "start" }}>
          <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 18, padding: 28 }}>
            {step === 1 && (
              <>
                <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 23, margin: "0 0 18px", letterSpacing: "-.01em" }}>
                  Your child's details
                </h2>
                <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div>
                    <label style={labelStyle}>First name</label>
                    <input value={form.childFirst} onChange={(e) => set("childFirst", e.target.value)} placeholder="Child's first name" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Last name</label>
                    <input value={form.childLast} onChange={(e) => set("childLast", e.target.value)} placeholder="Child's last name" style={inputStyle} />
                  </div>
                </div>
                <label style={{ ...labelStyle, margin: "16px 0 6px" }}>Date of birth</label>
                <input type="date" value={form.dob} onChange={(e) => set("dob", e.target.value)} style={inputStyle} />
                <label style={{ ...labelStyle, margin: "18px 0 10px" }}>Age group</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {AGE_GROUPS.map((t) => (
                    <Chip key={t} label={t} active={form.team === t} onClick={() => set("team", t)} accent="orange" radius={11} padding="9px 16px" />
                  ))}
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 23, margin: "0 0 18px", letterSpacing: "-.01em" }}>
                  Parent / guardian & emergency contact
                </h2>
                <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div>
                    <label style={labelStyle}>Your first name</label>
                    <input value={form.gFirst} onChange={(e) => set("gFirst", e.target.value)} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Your last name</label>
                    <input value={form.gLast} onChange={(e) => set("gLast", e.target.value)} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Email</label>
                    <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="you@email.ie" style={inputStyle} />
                    {form.email && !isValidEmail(form.email) && (
                      <p style={{ color: "#b00020", fontSize: 12, margin: "6px 0 0" }}>Enter a valid email address</p>
                    )}
                  </div>
                  <div>
                    <label style={labelStyle}>Phone</label>
                    <input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="08X XXX XXXX" style={inputStyle} />
                  </div>
                </div>
                <label style={{ ...labelStyle, margin: "16px 0 6px" }}>Home address</label>
                <input value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Street, town, county, Eircode" style={{ ...inputStyle, marginBottom: 16 }} />
                <div style={{ fontSize: 13, fontWeight: 700, color: colors.muted, margin: "6px 0 10px", letterSpacing: ".02em" }}>EMERGENCY CONTACT</div>
                <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={labelStyle}>Name</label>
                    <input value={form.ecName} onChange={(e) => set("ecName", e.target.value)} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Phone</label>
                    <input value={form.ecPhone} onChange={(e) => set("ecPhone", e.target.value)} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Relationship</label>
                    <input value={form.ecRel} onChange={(e) => set("ecRel", e.target.value)} placeholder="e.g. Aunt" style={inputStyle} />
                  </div>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 23, margin: "0 0 6px", letterSpacing: "-.01em" }}>
                  Medical information
                </h2>
                <p style={{ color: colors.mutedLight, fontSize: 14, margin: "0 0 18px" }}>
                  Please tell coaches about anything they should be aware of. Leave blank if none.
                </p>
                <label style={labelStyle}>Allergies, conditions or medication</label>
                <textarea
                  value={form.medical}
                  onChange={(e) => set("medical", e.target.value)}
                  rows={4}
                  placeholder="e.g. mild asthma — carries an inhaler"
                  style={{ ...inputStyle, resize: "vertical", marginBottom: 18 }}
                />
                <label style={{ display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer", background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 12, padding: 14 }}>
                  <input type="checkbox" checked={form.consent} onChange={(e) => set("consent", e.target.checked)} style={{ width: 18, height: 18, marginTop: 2, accentColor: colors.orange, flex: "none" }} />
                  <span style={{ fontSize: 14, color: "#3B423C", lineHeight: 1.45 }}>
                    I consent to my child taking part in club activities and confirm the information provided is
                    accurate. I understand photos may be taken at club events.
                  </span>
                </label>
              </>
            )}

            {step === 4 && (
              <>
                <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 23, margin: "0 0 6px", letterSpacing: "-.01em" }}>
                  Membership & payment
                </h2>
                <div style={{ background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 14, padding: 16, display: "flex", alignItems: "center", gap: 14, margin: "16px 0 20px" }}>
                  <input type="checkbox" checked={form.trial} onChange={(e) => set("trial", e.target.checked)} style={{ width: 18, height: 18, accentColor: colors.orange, flex: "none" }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>Start with a free trial instead</div>
                    <div style={{ color: colors.mutedLight, fontSize: 13 }}>Try one session free — pay only if they'd like to continue.</div>
                  </div>
                </div>
                {!form.trial ? (
                  <>
                    <p style={{ color: colors.mutedLight, fontSize: 14, margin: "0 0 16px" }}>
                      {isCash
                        ? "This club is pay-on-arrival — no online payment needed. Your registration is confirmed as soon as you submit."
                        : "You'll pay securely on the next screen."}
                    </p>
                    {!isCash && (
                    <>
                    <label style={labelStyle}>Coupon code</label>
                    {coupon ? (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: colors.orangeBg, border: `1px solid ${colors.orange}`, borderRadius: 12, padding: "10px 14px" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: colors.orangeDark, fontWeight: 700, fontSize: 14 }}>
                          <CheckIcon size={15} /> {coupon.code} applied — €{(coupon.discountCents / 100).toFixed(2)} off
                        </span>
                        <button onClick={removeCoupon} aria-label="Remove coupon" style={{ background: "none", border: "none", cursor: "pointer", color: colors.orangeDark, display: "flex" }}>
                          <CloseIcon size={15} />
                        </button>
                      </div>
                    ) : (
                      <div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <input
                            value={couponInput}
                            onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                            onKeyDown={(e) => e.key === "Enter" && applyCoupon()}
                            placeholder="e.g. WELCOME10"
                            style={{ ...inputStyle, textTransform: "uppercase" }}
                          />
                          <button
                            onClick={applyCoupon}
                            disabled={couponChecking || !couponInput.trim()}
                            style={{ flex: "none", background: colors.dark, color: "#fff", border: "none", borderRadius: 12, padding: "0 20px", fontWeight: 700, fontSize: 14, cursor: "pointer", opacity: couponChecking ? 0.6 : 1 }}
                          >
                            {couponChecking ? "Checking…" : "Apply"}
                          </button>
                        </div>
                        {couponError && <p style={{ color: "#b00020", fontSize: 13, margin: "8px 0 0" }}>{couponError}</p>}
                      </div>
                    )}
                    </>
                    )}
                  </>
                ) : (
                  <p style={{ color: colors.muted, fontSize: 15, lineHeight: 1.5, margin: "4px 0 0" }}>
                    No payment needed now. We'll email you the details for your child's free trial session.
                  </p>
                )}
              </>
            )}

            {error && <p style={{ color: "#b00020", fontSize: 14, marginTop: 16 }}>{error}</p>}

            <div style={{ display: "flex", gap: 12, marginTop: 26 }}>
              {step > 1 && (
                <button onClick={prev} style={{ background: "#fff", color: colors.text, border: `1px solid ${colors.borderStrong}`, borderRadius: 12, padding: "13px 20px", fontWeight: 600, fontSize: 15, cursor: "pointer" }}>
                  Back
                </button>
              )}
              <button
                onClick={next}
                disabled={submitting}
                style={{
                  flex: 1, background: colors.orange, color: "#fff", border: "none", borderRadius: 12, padding: "13px 20px",
                  fontWeight: 700, fontSize: 15, cursor: "pointer", opacity: ready && !submitting ? 1 : 0.45, pointerEvents: ready && !submitting ? "auto" : "none",
                }}
              >
                {step === 4
                  ? submitting
                    ? "Please wait…"
                    : form.trial
                      ? "Book free trial"
                      : isCash
                        ? `Confirm registration — pay €${(totalCents / 100).toFixed(2)} on arrival`
                        : `Continue to pay €${(totalCents / 100).toFixed(2)}`
                  : "Continue"}
              </button>
            </div>
          </div>

          <div className="sticky-aside" style={{ position: "sticky", top: 90, background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 18, padding: 22 }}>
            <Photo
              src={club.image}
              alt={club.name}
              ph={club.ph}
              style={{ height: 80, borderRadius: 12, overflow: "hidden", marginBottom: 14 }}
              contentStyle={{ display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <span
                style={{
                  background: "rgba(255,255,255,.9)",
                  borderRadius: 8,
                  padding: "3px 9px",
                  fontFamily: fonts.display,
                  fontWeight: 700,
                  fontSize: 13,
                  color: colors.orangeDark,
                }}
              >
                {club.sport}
              </span>
            </Photo>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 2 }}>{club.name}</div>
            <div style={{ color: colors.mutedLight, fontSize: 14, marginBottom: 16 }}>{club.area}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9, fontSize: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: colors.mutedLight }}>Child</span>
                <span style={{ fontWeight: 600 }}>{childName || "Not set"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: colors.mutedLight }}>Age group</span>
                <span style={{ fontWeight: 600 }}>{form.team || "Not set"}</span>
              </div>
            </div>
            {!form.trial && (
              <div style={{ borderTop: "1px solid #EEEBE3", margin: "16px 0", paddingTop: 14, display: "flex", flexDirection: "column", gap: 9, fontSize: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: colors.mutedLight }}>Membership</span>
                  <span style={{ fontWeight: 600 }}>{priceLabel(club)}</span>
                </div>
                {discountCents > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", color: colors.orangeDark }}>
                    <span>Coupon ({coupon?.code})</span>
                    <span style={{ fontWeight: 600 }}>-€{(discountCents / 100).toFixed(2)}</span>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: colors.mutedLight }}>VAT (23%)</span>
                  <span style={{ fontWeight: 600 }}>€{(vatCents / 100).toFixed(2)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: colors.mutedLight }}>Platform fee (5%)</span>
                  <span style={{ fontWeight: 600 }}>€{(feeCents / 100).toFixed(2)}</span>
                </div>
              </div>
            )}
            <div style={{ borderTop: "1px solid #EEEBE3", marginTop: 16, paddingTop: 14, display: "flex", justifyContent: "space-between", fontFamily: fonts.display, fontWeight: 700, fontSize: 18 }}>
              <span>{form.trial ? "Due now" : isCash ? "Due in cash" : "Total"}</span>
              <span>{form.trial ? "€0" : `€${(totalCents / 100).toFixed(2)}`}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
