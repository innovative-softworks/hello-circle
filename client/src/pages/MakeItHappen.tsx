import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { confirmMakeItHappen, fetchCentres, searchMakeItHappen } from "../api";
import type { MakeItHappenCandidate } from "../api";
import { openCheckout } from "../native";
import { CalendarIcon, ClockIcon, HandshakeIcon, PinIcon, UsersIcon } from "../components/icons";
import { Button, Card, EmptyState, PageSpinner, inputStyle, labelStyle } from "../components/ui";
import { BackLink } from "../components/BackLink";
import { PageTitle } from "../components/PageTitle";
import { signInHref } from "../authRedirect";
import { clearContinuePlanning, saveContinuePlanning } from "../continuePlanning";
import { useGuest } from "../GuestContext";
import { colors, fonts } from "../theme";
import { fallbackCopy } from "../copy";

// Make It Happen (implementation plan Phase 10) — "pick activity/time/
// place/participant-count/budget → HelloCircle finds a facility, prices
// it, proposes it, recruits participants, confirms once viable." A wizard
// UI over /make-it-happen/search (find + price) and /confirm (propose +
// book, which recruits via Open Booking + Minimum Participation — see
// server/src/routes/makeItHappen.ts).

type Step = "form" | "results" | "details" | "done";

export function MakeItHappen() {
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [step, setStep] = useState<Step>("form");
  const [counties, setCounties] = useState<string[]>([]);

  const [activityLabel, setActivityLabel] = useState("");
  const [county, setCounty] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(2);
  const [partySize, setPartySize] = useState(4);
  const [maxBudgetPerPerson, setMaxBudgetPerPerson] = useState("");

  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<MakeItHappenCandidate[]>([]);
  const [chosen, setChosen] = useState<MakeItHappenCandidate | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [bookedRef, setBookedRef] = useState<string | null>(null);

  useEffect(() => {
    fetchCentres().then((centres) => {
      setCounties(Array.from(new Set(centres.map((c) => c.county).filter(Boolean))).sort((a, b) => a.localeCompare(b)));
    });
  }, []);

  const handleSearch = async () => {
    if (!date || !time || !partySize) return;
    setSearching(true);
    setSearchError(null);
    try {
      const rows = await searchMakeItHappen({
        activityLabel,
        county: county || undefined,
        date,
        time,
        duration,
        partySize,
        maxBudgetPerPersonCents: maxBudgetPerPerson ? Math.round(parseFloat(maxBudgetPerPerson) * 100) : undefined,
      });
      setCandidates(rows);
      setStep("results");
      saveContinuePlanning({ activityLabel, county, date, time });
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : fallbackCopy.notFound);
    } finally {
      setSearching(false);
    }
  };

  const handleConfirm = async () => {
    if (!chosen || !name.trim() || !email.trim() || !phone.trim()) return;
    setConfirming(true);
    setConfirmError(null);
    try {
      const res = await confirmMakeItHappen({
        activityLabel,
        county: county || undefined,
        date,
        time,
        duration,
        partySize,
        centreId: chosen.centreId,
        roomId: chosen.roomId,
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
      });
      if (res.url) {
        openCheckout(res.url);
        return;
      }
      setBookedRef(res.ref);
      setStep("done");
      clearContinuePlanning();
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : "Couldn't confirm this booking");
    } finally {
      setConfirming(false);
    }
  };

  if (!resident) {
    return (
      <section className="section-pad" style={{ maxWidth: 640, margin: "0 auto", padding: "60px 24px", textAlign: "center" }}>
        <HandshakeIcon size={28} style={{ color: colors.orange, marginBottom: 12 }} />
        <PageTitle level="section" style={{ margin: "0 0 10px" }}>Make It Happen</PageTitle>
        <p style={{ color: colors.mutedLight, marginBottom: 20 }}>
          Sign in to have HelloCircle find a venue, book it, and recruit the rest of your group.
        </p>
        <Button onClick={() => navigate(signInHref())}>Sign in</Button>
      </section>
    );
  }

  return (
    <div style={{ animation: "fadeUp .35s ease both" }}>
      <section className="section-pad" style={{ maxWidth: 640, margin: "0 auto", padding: "26px 24px 80px" }}>
        {step !== "form" && step !== "done" && (
          <BackLink onClick={() => setStep(step === "details" ? "results" : "form")} marginBottom={16}>
            Back
          </BackLink>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <HandshakeIcon size={22} style={{ color: colors.orange }} />
          <PageTitle style={{ margin: 0 }}>Make It Happen</PageTitle>
        </div>
        <p style={{ color: colors.mutedLight, fontSize: 15, margin: "0 0 24px" }}>
          Nothing planned yet? Tell us what you're after — we'll find a venue, price it, and start recruiting your group.
        </p>

        {step === "form" && (
          <Card>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={labelStyle}>What do you want to do?</label>
                <input value={activityLabel} onChange={(e) => setActivityLabel(e.target.value)} placeholder="e.g. 5-a-side football" style={inputStyle} />
              </div>
              <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <label style={labelStyle}>County (optional)</label>
                  <select value={county} onChange={(e) => setCounty(e.target.value)} style={inputStyle}>
                    <option value="">Anywhere</option>
                    {counties.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>How many of you?</label>
                  <input type="number" min={2} value={partySize} onChange={(e) => setPartySize(parseInt(e.target.value, 10) || 2)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Date</label>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Time</label>
                  <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Duration (hours)</label>
                  <input type="number" min={1} max={12} value={duration} onChange={(e) => setDuration(parseInt(e.target.value, 10) || 1)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Max per person (optional)</label>
                  <input value={maxBudgetPerPerson} onChange={(e) => setMaxBudgetPerPerson(e.target.value)} placeholder="e.g. 15" style={inputStyle} />
                </div>
              </div>
              {searchError && <p style={{ color: colors.danger, fontSize: 13.5, margin: 0 }}>{searchError}</p>}
              <Button onClick={handleSearch} disabled={searching || !date || !time}>
                {searching ? "Searching…" : "Find a venue"}
              </Button>
            </div>
          </Card>
        )}

        {step === "results" && (
          searching ? (
            <PageSpinner />
          ) : candidates.length === 0 ? (
            <EmptyState
              icon={<HandshakeIcon size={22} />}
              title="Nothing matches yet"
              subtitle="Try a different time, a wider budget, or another county."
              action={<Button onClick={() => setStep("form")}>Try again</Button>}
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <p style={{ color: colors.mutedLight, fontSize: 14, margin: "0 0 4px" }}>
                {candidates.length} option{candidates.length === 1 ? "" : "s"} found — cheapest per person first.
              </p>
              {candidates.map((c) => (
                <Card key={`${c.centreId}-${c.roomId}`}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                    <div>
                      <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17 }}>{c.centreName}</div>
                      <div style={{ color: colors.mutedLight, fontSize: 13.5, marginTop: 2, display: "flex", alignItems: "center", gap: 5 }}>
                        <PinIcon size={13} /> {c.roomName} · {c.area}, {c.county}
                      </div>
                      <div style={{ color: colors.mutedLight, fontSize: 13, marginTop: 4, display: "flex", alignItems: "center", gap: 5 }}>
                        <UsersIcon size={13} /> Fits up to {c.capacity}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 700, fontSize: 18, color: colors.greenText }}>€{(c.perPersonCents / 100).toFixed(2)}</div>
                      <div style={{ fontSize: 11.5, color: colors.faint }}>per person</div>
                    </div>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <Button
                      onClick={() => {
                        setChosen(c);
                        setStep("details");
                      }}
                    >
                      Choose this
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )
        )}

        {step === "details" && chosen && (
          <Card>
            <div style={{ background: colors.panel, borderRadius: 12, padding: "12px 16px", marginBottom: 16, fontSize: 13.5 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{chosen.centreName} — {chosen.roomName}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: colors.muted }}><CalendarIcon size={13} /> {date}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: colors.muted }}><ClockIcon size={13} /> {time} · {duration}h</div>
              <div style={{ marginTop: 6, color: colors.greenText, fontWeight: 700 }}>
                €{(chosen.perPersonCents / 100).toFixed(2)} per person · €{(chosen.totalCents / 100).toFixed(2)} total
              </div>
              <div style={{ marginTop: 4, color: colors.mutedLight }}>
                You'll pay your share now to secure the venue — we'll open the other {partySize - 1} spot{partySize - 1 === 1 ? "" : "s"} for people to join. It only becomes final once the full group of {partySize} has signed up.
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={labelStyle}>Your name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Email</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.ie" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Phone</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} />
              </div>
              {confirmError && <p style={{ color: colors.danger, fontSize: 13.5, margin: 0 }}>{confirmError}</p>}
              <Button onClick={handleConfirm} disabled={confirming || !name.trim() || !email.trim() || !phone.trim()}>
                {confirming ? "Booking…" : "Confirm & book"}
              </Button>
            </div>
          </Card>
        )}

        {step === "done" && bookedRef && (
          <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 18, padding: 32, textAlign: "center" }}>
            <p style={{ fontSize: 16, fontWeight: 700, margin: "0 0 8px" }}>It's happening — venue secured.</p>
            <p style={{ color: colors.mutedLight, fontSize: 14, margin: "0 0 20px" }}>
              Booking reference <strong>{bookedRef}</strong>. We've opened the rest of the spots for others to join —
              check My Life to invite people or track who's signed up.
            </p>
            <Button onClick={() => navigate("/bookings")}>Go to My Life</Button>
          </div>
        )}
      </section>
    </div>
  );
}
