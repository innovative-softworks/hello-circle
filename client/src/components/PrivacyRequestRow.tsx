import { useEffect, useState } from "react";
import { fetchMyPrivacyRequests, submitPrivacyRequest, type MyPrivacyRequest } from "../api";
import { dateLabel } from "../euro";
import { colors } from "../theme";
import { Button, Modal, inputStyle, labelStyle } from "./ui";

// OG-29 — Profile → Your data: ask the privacy team for a copy, a
// correction, deletion, or to stop a use of your data. The request is
// recorded and answered by email; nothing is deleted automatically.

const KINDS: { value: MyPrivacyRequest["kind"]; label: string }[] = [
  { value: "access", label: "A copy of my data" },
  { value: "correction", label: "Correct something about me" },
  { value: "erasure", label: "Delete my data" },
  { value: "objection", label: "Stop using my data for something" },
];
const STATUS: Record<MyPrivacyRequest["status"], string> = { received: "Received", in_progress: "In progress", completed: "Completed", refused: "Declined" };

export function PrivacyRequestRow() {
  const [requests, setRequests] = useState<MyPrivacyRequest[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<MyPrivacyRequest["kind"]>("access");
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const load = () => {
    setLoadFailed(false);
    fetchMyPrivacyRequests()
      .then(setRequests)
      .catch(() => setLoadFailed(true));
  };
  useEffect(load, []);

  const close = () => {
    setOpen(false);
    setError(null);
    setSent(false);
    setDetails("");
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await submitPrivacyRequest(kind, details.trim());
      setSent(true);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send that — try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: "16px 0", borderBottom: `1px solid ${colors.border}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Ask us about your data</div>
          <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 2 }}>Request a correction, deletion, or that we stop a use of your data. We reply by email.</div>
        </div>
        <Button variant="ghost" onClick={() => setOpen(true)}>
          Make a request
        </Button>
      </div>
      {loadFailed && (
        <p style={{ margin: "10px 0 0", fontSize: 12.5, color: colors.danger }}>
          Couldn't load your requests.{" "}
          <button onClick={load} style={{ background: "none", border: "none", padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer", font: "inherit" }}>
            Try again
          </button>
        </p>
      )}
      {requests && requests.length > 0 && (
        <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
          {requests.map((r) => (
            <li key={r.id}>
              <strong>{KINDS.find((k) => k.value === r.kind)?.label}</strong> · {dateLabel(r.createdAt.slice(0, 10))} · {STATUS[r.status]}
              {r.kind === "erasure" && r.status !== "refused" && <span style={{ color: colors.mutedLight }}> · nothing deleted yet</span>}
              {r.response && <div style={{ color: colors.mutedLight, marginTop: 2 }}>{r.response}</div>}
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={open}
        onClose={close}
        title="Ask us about your data"
        subtitle="Your request goes to the HelloCircle privacy team."
        footer={
          sent ? (
            <Button onClick={close}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={busy}>
                {busy ? "Sending…" : "Send request"}
              </Button>
            </>
          )
        }
      >
        {sent ? (
          <p role="status" style={{ margin: 0 }}>
            Sent. We've emailed you a reference and will reply to the same address.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label htmlFor="privacy-kind" style={labelStyle}>
                What would you like? *
              </label>
              <select id="privacy-kind" value={kind} onChange={(e) => setKind(e.target.value as MyPrivacyRequest["kind"])} style={inputStyle}>
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
              {kind === "access" && <p style={{ margin: "6px 0 0", fontSize: 12.5, color: colors.mutedLight }}>You can also download a copy straight away with "Download my data" above.</p>}
            </div>
            <div>
              <label htmlFor="privacy-details" style={labelStyle}>
                Anything we should know (optional)
              </label>
              <textarea id="privacy-details" rows={4} maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} style={{ ...inputStyle, resize: "vertical" }} />
            </div>
            {error && (
              <p role="alert" style={{ margin: 0, color: colors.danger, fontSize: 13 }}>
                {error}
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
