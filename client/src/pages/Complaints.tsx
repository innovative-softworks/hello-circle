import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchMyComplaints, submitComplaint, type ComplaintKind, type ComplaintRow } from "../api";
import { useAuth } from "../AuthContext";
import { useGuest } from "../GuestContext";
import { Button, ManageCard as Card, inputStyle, labelStyle } from "../components/ui";
import { colors, fonts, radius } from "../theme";

// Revenue & Connect Stage 4 — complaints, notices of illegal content and
// appeals against moderation decisions (see the Complaints, Moderation &
// Appeals policy). Signed-in partners/residents also see their earlier
// requests and our statement of reasons for each decision.

const KINDS: { value: ComplaintKind; label: string; hint: string }[] = [
  { value: "complaint", label: "A complaint", hint: "A problem with a booking, a payout or our service" },
  { value: "notice", label: "Report illegal content", hint: "Something on HelloCircle you believe is illegal" },
  { value: "appeal", label: "Appeal a decision", hint: "You disagree with a moderation or account decision we made" },
];
const SUBJECTS: [string, string][] = [
  ["booking", "A booking"],
  ["listing", "A listing"],
  ["review", "A review"],
  ["circle", "A circle"],
  ["game", "A game"],
  ["account", "My account"],
  ["payout", "A payout"],
  ["moderation_decision", "A moderation decision"],
  ["other", "Something else"],
];
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "short", year: "numeric" }) : "");

export function Complaints() {
  const { user } = useAuth();
  const { resident } = useGuest();
  const signedIn = !!user || !!resident;
  const [params] = useSearchParams();
  const [kind, setKind] = useState<ComplaintKind>((params.get("kind") as ComplaintKind) || "complaint");
  const [subjectType, setSubjectType] = useState(params.get("subject") || (params.get("kind") === "appeal" ? "moderation_decision" : "booking"));
  const [subjectRef, setSubjectRef] = useState(params.get("ref") ?? "");
  const [email, setEmail] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const [mine, setMine] = useState<ComplaintRow[]>([]);

  useEffect(() => {
    document.title = "Complaints and appeals | HelloCircle";
  }, []);
  useEffect(() => {
    if (signedIn) fetchMyComplaints().then(setMine).catch(() => setMine([]));
  }, [signedIn, sent]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await submitComplaint({ kind, subjectType, subjectRef: subjectRef.trim() || undefined, email: signedIn ? undefined : email.trim(), body: body.trim() });
      setSent(r.id);
      setBody("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send — please try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 16px 64px" }}>
      <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(32px, 3.8vw, 52px)", margin: "0 0 8px" }}>Complaints and appeals</h1>
      <p style={{ color: colors.textSoft, fontSize: 15, margin: "0 0 22px", lineHeight: 1.6 }}>
        Tell us about a problem, report content you believe is illegal, or appeal a decision we made. A person reviews every request, and we explain our decision. See{" "}
        <Link to="/policies/complaints-appeals" style={{ color: colors.greenText, fontWeight: 600 }}>how we handle complaints and appeals</Link>.
      </p>
      <Card style={{ padding: 22 }}>
        {sent ? (
          <div role="status">
            <h2 style={{ fontFamily: fonts.display, fontSize: 20, margin: "0 0 6px" }}>Thanks — we've received your request (#{sent})</h2>
            <p style={{ color: colors.textSoft, fontSize: 14.5 }}>We'll reply by email{signedIn ? ", and you can follow it below" : ""}.</p>
            <Button variant="ghost" onClick={() => setSent(null)}>Send another</Button>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={labelStyle}>What would you like to do?</legend>
              <div style={{ display: "grid", gap: 8 }}>
                {KINDS.map((k) => (
                  <label key={k.value} style={{ display: "flex", gap: 10, alignItems: "flex-start", border: `1px solid ${kind === k.value ? colors.green : colors.border}`, borderRadius: radius.control, padding: "10px 12px", cursor: "pointer" }}>
                    <input type="radio" name="kind" value={k.value} checked={kind === k.value} onChange={() => setKind(k.value)} style={{ marginTop: 3 }} />
                    <span>
                      <strong style={{ fontSize: 14 }}>{k.label}</strong>
                      <span style={{ display: "block", fontSize: 12.5, color: colors.mutedLight }}>{k.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label>
              <span style={labelStyle}>What is it about?</span>
              <select value={subjectType} onChange={(e) => setSubjectType(e.target.value)} style={inputStyle}>
                {SUBJECTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label>
              <span style={labelStyle}>Reference or link (optional)</span>
              <input value={subjectRef} onChange={(e) => setSubjectRef(e.target.value)} style={inputStyle} placeholder="Booking reference, page link, or decision number" />
            </label>
            {!signedIn && (
              <label>
                <span style={labelStyle}>Your email</span>
                <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
              </label>
            )}
            <label>
              <span style={labelStyle}>{kind === "notice" ? "Where is the content, and why do you believe it is illegal?" : kind === "appeal" ? "Why should the decision be changed?" : "What happened?"}</span>
              <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} style={{ ...inputStyle, resize: "vertical" }} />
              <span style={{ fontSize: 11.5, color: colors.mutedLight }}>{body.trim().length}/5000 · at least 20 characters</span>
            </label>
            {error && <p role="alert" style={{ color: colors.danger, background: colors.dangerBg, padding: "8px 12px", borderRadius: radius.control, fontSize: 13, margin: 0 }}>{error}</p>}
            <div>
              <Button disabled={busy || body.trim().length < 20 || (!signedIn && !email.trim())} onClick={submit}>
                {busy ? "Sending…" : "Send"}
              </Button>
            </div>
          </div>
        )}
      </Card>
      {signedIn && mine.length > 0 && (
        <section style={{ marginTop: 26 }}>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 18, margin: "0 0 10px" }}>Your requests</h2>
          <div style={{ display: "grid", gap: 10 }}>
            {mine.map((c) => (
              <Card key={c.id} style={{ padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", fontSize: 13 }}>
                  <strong>#{c.id} · {KINDS.find((k) => k.value === c.kind)?.label ?? c.kind}</strong>
                  <span style={{ color: colors.mutedLight }}>{day(c.createdAt)} · {c.status === "closed" ? `Decided: ${c.decision}` : c.status === "in_review" ? "Being reviewed" : "Received"}</span>
                </div>
                <p style={{ fontSize: 13.5, color: colors.textSoft, margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{c.body}</p>
                {c.statementOfReasons && (
                  <div style={{ marginTop: 10, background: colors.panel, borderRadius: radius.control, padding: "10px 12px", fontSize: 13.5 }}>
                    <strong>Our reasons ({day(c.decidedAt)}):</strong> {c.statementOfReasons}
                    {c.decision === "rejected" && c.kind !== "appeal" && (
                      <div style={{ marginTop: 6 }}>
                        <Link to={`/complaints?kind=appeal&ref=${c.id}`} style={{ color: colors.greenText, fontWeight: 600 }}>Appeal this decision</Link>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
