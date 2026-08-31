import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, createRegistrationCheckout, fetchClub, fetchClubSessions, fetchHousehold, fetchMyPasses, joinClubWaitlist, validateCoupon, PLATFORM_FEE_RATE, VAT_RATE } from "../api";
import { BackLink } from "../components/BackLink";
import { Chip } from "../components/Chip";
import { useGuest } from "../GuestContext";
import type { ClubSession, HouseholdMember, Pass } from "../types";
import { Photo } from "../components/Photo";
import { Stepper } from "../components/Stepper";
import { Button, PageSpinner } from "../components/ui";
import { AGE_GROUPS } from "../constants";
import { useMyStuff } from "../MyStuffContext";
import { priceLabel } from "../priceLabel";
import { CheckIcon, CloseIcon } from "../components/icons";
import { colors, fonts } from "../theme";
import { fallbackCopy } from "../copy";
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
  fontSize: 15, background: colors.surface, color: colors.text, outline: "none",
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, color: colors.muted, margin: "0 0 6px" };

export function RegistrationFlow() {
  const { clubId } = useParams<{ clubId: string }>();
  const navigate = useNavigate();
  const { refresh } = useMyStuff();
  const { email: guestEmail } = useGuest();
  const [club, setClub] = useState<Club | null>(null);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<RegForm>(blankForm());
  const [ref, setRef] = useState<string | null>(null);
  const [confirmedTotalEuro, setConfirmedTotalEuro] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [household, setHousehold] = useState<HouseholdMember[]>([]);
  const [sessions, setSessions] = useState<ClubSession[]>([]);
  const [sessionId, setSessionId] = useState<string>("");
  const [usablePass, setUsablePass] = useState<Pass | null>(null);
  const [usePass, setUsePass] = useState(false);
  // Set when checkout comes back 409 { full: true } (see clubs.capacity /
  // routes/registrations.ts) — offers the waitlist instead of a dead end.
  const [clubFull, setClubFull] = useState(false);
  const [waitlisted, setWaitlisted] = useState(false);
  const [waitlistJoining, setWaitlistJoining] = useState(false);

  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<{ code: string; discountCents: number } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponChecking, setCouponChecking] = useState(false);

  // Which shape this registration takes — "child" (guardian registers a
  // minor: DOB, age group, guardian-vs-registrant distinction, required
  // emergency contact) or "adult" (registrant registers themselves: no DOB,
  // no age group, emergency contact optional). Driven by the club's own
  // `audience` setting; only an audience:"all" club exposes the toggle,
  // since a kids-only or adults-only club has exactly one valid shape.
  const [registrantType, setRegistrantType] = useState<"child" | "adult">("child");
  const isAdult = registrantType === "adult";

  useEffect(() => {
    if (clubId) fetchClub(clubId).then((c) => {
      setClub(c);
      if (c.audience === "adults") setRegistrantType("adult");
      else if (c.audience === "kids") setRegistrantType("child");
    });
  }, [clubId]);

  // Household picker (MVP) — only useful when signed in; empty otherwise.
  useEffect(() => {
    if (guestEmail) fetchHousehold().then(setHousehold).catch(() => {});
  }, [guestEmail]);

  // Recurring session picker (Tier 1) — a club with none configured simply
  // shows no picker, same flat-registration behaviour as before this existed.
  useEffect(() => {
    if (clubId) fetchClubSessions(clubId).then(setSessions).catch(() => {});
  }, [clubId]);

  // Pass redemption (Tier 2) — offer "use a credit" only if the signed-in
  // resident actually holds a pass with spendable credits for this club.
  useEffect(() => {
    if (!guestEmail || !clubId) return;
    fetchMyPasses()
      .then((passes) => setUsablePass(passes.find((p) => p.listingId === clubId && p.creditsUsed < p.creditsTotal) ?? null))
      .catch(() => setUsablePass(null));
  }, [guestEmail, clubId]);

  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const sessionLabel = (s: ClubSession) => `${DAY_NAMES[s.dayOfWeek] ?? "?"} ${s.time}${s.label ? ` — ${s.label}` : ""}`;

  const set = <K extends keyof RegForm>(field: K, value: RegForm[K]) => setForm((f) => ({ ...f, [field]: value }));
  const top = () => window.scrollTo({ top: 0, behavior: "smooth" });

  const isCash = club?.paymentMethod === "cash";
  const subtotalCents = club ? club.price * 100 : 0;
  const discountCents = coupon?.discountCents ?? 0;
  const taxableCents = Math.max(0, subtotalCents - discountCents);
  const vatCents = Math.round(taxableCents * VAT_RATE);
  const feeCents = Math.round(taxableCents * PLATFORM_FEE_RATE);
  const totalCents = taxableCents + vatCents + feeCents;

  const r1Ready = isAdult
    ? !!(form.childFirst && form.childLast)
    : !!(form.childFirst && form.childLast && form.dob && form.team);
  const r2Ready = isAdult
    ? !!(form.email && isValidEmail(form.email) && form.phone && form.address)
    : !!(form.gFirst && form.gLast && form.email && isValidEmail(form.email) && form.phone && form.address && form.ecName && form.ecPhone);
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
    setClubFull(false);
    setSubmitting(true);
    try {
      const res = await createRegistrationCheckout({
        clubId,
        registrantType,
        // Adult flow: the registrant is their own "guardian" — step 1
        // already collected their name once, so it isn't asked again in
        // step 2 (see the g_first/g_last reuse note there).
        team: isAdult ? undefined : form.team,
        childFirst: form.childFirst, childLast: form.childLast,
        dob: isAdult ? undefined : form.dob,
        gFirst: isAdult ? form.childFirst : form.gFirst,
        gLast: isAdult ? form.childLast : form.gLast,
        email: form.email, phone: form.phone, address: form.address,
        ecName: form.ecName || undefined, ecPhone: form.ecPhone || undefined, ecRel: form.ecRel || undefined,
        medical: form.medical,
        consent: form.consent, trial: usePass ? false : form.trial, couponCode: usePass || form.trial ? undefined : coupon?.code,
        sessionId: sessionId || undefined,
        passId: usePass && usablePass ? usablePass.id : undefined,
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
      // Capacity conflict (MVP — see clubs.capacity) offers a waitlist
      // instead of just a dead-end error message.
      if (e instanceof ApiError && e.body.full) {
        setClubFull(true);
        top();
      } else {
        setError(e instanceof Error ? e.message : fallbackCopy.generic);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleJoinWaitlist = async () => {
    if (!clubId) return;
    setWaitlistJoining(true);
    try {
      await joinClubWaitlist(clubId, { name: `${form.gFirst} ${form.gLast}`.trim(), email: form.email });
      setWaitlisted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't join the waitlist");
    } finally {
      setWaitlistJoining(false);
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
              ? `We've emailed ${form.email || "you"} the details for ${isAdult ? "your" : `${form.childFirst || "your child"}'s`} free trial.`
              : usePass
                ? `Covered by your pass — one credit used. We've emailed ${form.email || "you"} the details.`
                : `Pay €${confirmedTotalEuro.toFixed(2)} in cash at the club — no online payment needed. We've emailed ${form.email || "you"} the details.`}
          </p>
          <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 18, padding: 24, textAlign: "left", marginBottom: 24 }}>
            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 2 }}>{club.name}</div>
            <div style={{ color: colors.mutedLight, fontSize: 14, marginBottom: 16 }}>{club.sport}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <div style={{ fontSize: 12, color: colors.faint, fontWeight: 600 }}>{isAdult ? "MEMBER" : "CHILD"}</div>
                <div style={{ fontWeight: 600 }}>{childName}</div>
              </div>
              {!isAdult && (
                <div>
                  <div style={{ fontSize: 12, color: colors.faint, fontWeight: 600 }}>AGE GROUP</div>
                  <div style={{ fontWeight: 600 }}>{form.team}</div>
                </div>
              )}
              <div>
                <div style={{ fontSize: 12, color: colors.faint, fontWeight: 600 }}>REFERENCE</div>
                <div style={{ fontWeight: 600 }}>{ref}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: colors.faint, fontWeight: 600 }}>STATUS</div>
                <div style={{ fontWeight: 600 }}>{form.trial ? "Free trial" : usePass ? "Paid via pass" : "Cash on arrival"}</div>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <Button variant="orange" onClick={() => navigate("/bookings")}>View my bookings</Button>
            <Button variant="ghost" onClick={() => navigate("/")}>Back home</Button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div style={{ animation: "fadeUp .3s ease both" }}>
      <section className="section-pad" style={{ maxWidth: 920, margin: "0 auto", padding: "26px 24px 80px" }}>
        <BackLink onClick={back}>{step > 1 ? "Back a step" : "Back to club"}</BackLink>
        <Stepper labels={isAdult ? ["Your details", "Contact info", "Medical", "Review & pay"] : ["Your child", "Contacts", "Medical", "Review & pay"]} current={step} accent="orange" />

        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 32, alignItems: "start" }}>
          <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 18, padding: 28 }}>
            {step === 1 && (
              <>
                <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 23, margin: "0 0 18px", letterSpacing: "-.01em" }}>
                  {isAdult ? "Your details" : "Your child's details"}
                </h2>
                {club.audience === "all" && (
                  <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
                    <Chip label="Registering my child" active={!isAdult} onClick={() => setRegistrantType("child")} accent="orange" radius={11} padding="9px 16px" />
                    <Chip label="Registering myself" active={isAdult} onClick={() => setRegistrantType("adult")} accent="orange" radius={11} padding="9px 16px" />
                  </div>
                )}
                <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div>
                    <label style={labelStyle}>First name</label>
                    <input value={form.childFirst} onChange={(e) => set("childFirst", e.target.value)} placeholder={isAdult ? "Your first name" : "Child's first name"} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Last name</label>
                    <input value={form.childLast} onChange={(e) => set("childLast", e.target.value)} placeholder={isAdult ? "Your last name" : "Child's last name"} style={inputStyle} />
                  </div>
                </div>
                {!isAdult && household.length > 0 && (
                  <div style={{ margin: "14px 0 4px" }}>
                    <label style={labelStyle}>Or pick from your household</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {household.map((m) => (
                        <Chip
                          key={m.id}
                          label={`${m.firstName} ${m.lastName}`}
                          active={form.childFirst === m.firstName && form.childLast === m.lastName}
                          onClick={() => {
                            set("childFirst", m.firstName);
                            set("childLast", m.lastName);
                            if (m.dob) set("dob", m.dob);
                          }}
                          accent="orange"
                          radius={11}
                          padding="7px 14px"
                        />
                      ))}
                    </div>
                  </div>
                )}
                {!isAdult && (
                  <>
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
              </>
            )}

            {step === 2 && (
              <>
                <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 23, margin: "0 0 18px", letterSpacing: "-.01em" }}>
                  {isAdult ? "Your contact details" : "Parent / guardian & emergency contact"}
                </h2>
                <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  {!isAdult && (
                    <>
                      <div>
                        <label style={labelStyle}>Your first name</label>
                        <input value={form.gFirst} onChange={(e) => set("gFirst", e.target.value)} style={inputStyle} />
                      </div>
                      <div>
                        <label style={labelStyle}>Your last name</label>
                        <input value={form.gLast} onChange={(e) => set("gLast", e.target.value)} style={inputStyle} />
                      </div>
                    </>
                  )}
                  <div>
                    <label style={labelStyle}>Email</label>
                    <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="you@email.ie" style={inputStyle} />
                    {form.email && !isValidEmail(form.email) && (
                      <p style={{ color: colors.danger, fontSize: 12, margin: "6px 0 0" }}>Enter a valid email address</p>
                    )}
                  </div>
                  <div>
                    <label style={labelStyle}>Phone</label>
                    <input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="08X XXX XXXX" style={inputStyle} />
                  </div>
                </div>
                <label style={{ ...labelStyle, margin: "16px 0 6px" }}>Home address</label>
                <input value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Street, town, county, Eircode" style={{ ...inputStyle, marginBottom: 16 }} />
                <div style={{ fontSize: 13, fontWeight: 700, color: colors.muted, margin: "6px 0 10px", letterSpacing: ".02em" }}>
                  EMERGENCY CONTACT{isAdult ? " (OPTIONAL)" : ""}
                </div>
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
                    <input value={form.ecRel} onChange={(e) => set("ecRel", e.target.value)} placeholder="e.g. Friend" style={inputStyle} />
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
                  <span style={{ fontSize: 14, color: colors.textSoft, lineHeight: 1.45 }}>
                    {isAdult
                      ? "I consent to taking part in club activities and confirm the information provided is accurate. I understand photos may be taken at club events."
                      : "I consent to my child taking part in club activities and confirm the information provided is accurate. I understand photos may be taken at club events."}
                  </span>
                </label>
              </>
            )}

            {step === 4 && (
              <>
                <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 23, margin: "0 0 6px", letterSpacing: "-.01em" }}>
                  Membership & payment
                </h2>
                {sessions.length > 0 && (
                  <div style={{ margin: "16px 0" }}>
                    <label style={labelStyle}>Which session?</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {sessions.map((s) => (
                        <Chip key={s.id} label={sessionLabel(s)} active={sessionId === s.id} onClick={() => setSessionId(s.id)} accent="orange" radius={11} padding="9px 16px" />
                      ))}
                    </div>
                  </div>
                )}
                {usablePass && (
                  <label
                    style={{ display: "flex", alignItems: "center", gap: 14, background: colors.greenBg, border: `1px solid ${colors.green}`, borderRadius: 14, padding: 16, marginBottom: 12, cursor: "pointer" }}
                  >
                    <input
                      type="checkbox"
                      checked={usePass}
                      onChange={(e) => {
                        setUsePass(e.target.checked);
                        if (e.target.checked) set("trial", false);
                      }}
                      style={{ width: 18, height: 18, accentColor: colors.green, flex: "none" }}
                    />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15, color: colors.greenText }}>
                        Use a pass credit — {usablePass.creditsTotal - usablePass.creditsUsed} left
                      </div>
                      <div style={{ color: colors.mutedLight, fontSize: 13 }}>No charge — this registration is covered by your pass.</div>
                    </div>
                  </label>
                )}
                <div style={{ background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 14, padding: 16, display: "flex", alignItems: "center", gap: 14, margin: "0 0 20px", opacity: usePass ? 0.5 : 1, pointerEvents: usePass ? "none" : "auto" }}>
                  <input type="checkbox" checked={form.trial} onChange={(e) => set("trial", e.target.checked)} disabled={usePass} style={{ width: 18, height: 18, accentColor: colors.orange, flex: "none" }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>Start with a free trial instead</div>
                    <div style={{ color: colors.mutedLight, fontSize: 13 }}>Try one session free — pay only if they'd like to continue.</div>
                  </div>
                </div>
                {usePass ? (
                  <p style={{ color: colors.muted, fontSize: 15, lineHeight: 1.5, margin: "4px 0 0" }}>
                    This registration will be confirmed immediately using one of your pass credits — no payment needed.
                  </p>
                ) : !form.trial ? (
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
                          <Button variant="dark" onClick={applyCoupon} disabled={couponChecking || !couponInput.trim()} style={{ flex: "none" }}>
                            {couponChecking ? "Checking…" : "Apply"}
                          </Button>
                        </div>
                        {couponError && <p style={{ color: colors.danger, fontSize: 13, margin: "8px 0 0" }}>{couponError}</p>}
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

            {error && <p style={{ color: colors.danger, fontSize: 14, marginTop: 16 }}>{error}</p>}

            {clubFull && (
              <div style={{ background: colors.orangeBg, border: `1px solid ${colors.orange}`, borderRadius: 14, padding: 18, marginTop: 18 }}>
                {waitlisted ? (
                  <p style={{ margin: 0, color: colors.orangeDark, fontWeight: 600, fontSize: 14.5 }}>
                    You're on the waitlist — we'll email you the moment a spot opens up.
                  </p>
                ) : (
                  <>
                    <p style={{ margin: "0 0 12px", color: colors.orangeDark, fontWeight: 700, fontSize: 15 }}>
                      This club is currently full.
                    </p>
                    <p style={{ margin: "0 0 14px", color: colors.text, fontSize: 14 }}>
                      Join the waitlist and we'll let you know the moment a spot opens up — you'll have 48 hours to claim it.
                    </p>
                    <Button onClick={handleJoinWaitlist} disabled={waitlistJoining || !form.email}>
                      {waitlistJoining ? "Joining…" : "Join waitlist"}
                    </Button>
                    {!form.email && <p style={{ margin: "8px 0 0", fontSize: 12.5, color: colors.orangeDark }}>Add your email on the previous step first.</p>}
                  </>
                )}
              </div>
            )}

            {!clubFull && (
            <div style={{ display: "flex", gap: 12, marginTop: 26 }}>
              {step > 1 && (
                <Button variant="ghost" onClick={prev}>Back</Button>
              )}
              <Button
                variant="orange"
                onClick={next}
                disabled={submitting || !ready}
                full
                style={{ flex: 1 }}
              >
                {step === 4
                  ? submitting
                    ? "Please wait…"
                    : usePass
                      ? "Redeem pass credit"
                      : form.trial
                        ? "Register for free trial"
                        : isCash
                          ? `Confirm registration — pay €${(totalCents / 100).toFixed(2)} on arrival`
                          : `Continue to pay €${(totalCents / 100).toFixed(2)}`
                  : "Continue"}
              </Button>
            </div>
            )}
          </div>

          <div className="sticky-aside" style={{ position: "sticky", top: 90, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 18, padding: 22 }}>
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
                <span style={{ color: colors.mutedLight }}>{isAdult ? "Member" : "Child"}</span>
                <span style={{ fontWeight: 600 }}>{childName || "Not set"}</span>
              </div>
              {!isAdult && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: colors.mutedLight }}>Age group</span>
                  <span style={{ fontWeight: 600 }}>{form.team || "Not set"}</span>
                </div>
              )}
            </div>
            {!form.trial && !usePass && (
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
              <span>{usePass ? "Covered by pass" : form.trial ? "Due now" : isCash ? "Due in cash" : "Total"}</span>
              <span>{usePass || form.trial ? "€0" : `€${(totalCents / 100).toFixed(2)}`}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
