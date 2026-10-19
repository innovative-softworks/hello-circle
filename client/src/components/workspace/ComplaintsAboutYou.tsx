import { useState } from "react";
import { MessageSquareWarning } from "lucide-react";
import type { ComplaintAboutYou } from "../../api";
import { AdminButton, AdminModal, Box, EmptyMessage, FormField, Loaded, StatusTag, errorMessage, formatDate, useAdminData } from "../admin/adminUi";
import { useToast } from "../Toast";

// OG-17 / DEC-12 — complaints about your bookings, listings or activities.
// You see what was said and HelloCircle's decision; never who said it. Your
// response is read by HelloCircle before it decides.

const STATUS: Record<ComplaintAboutYou["status"], { status: string; label: string }> = {
  open: { status: "pending", label: "New" },
  in_review: { status: "pending", label: "Being reviewed" },
  closed: { status: "active", label: "Decided" },
};

export function ComplaintsAboutYou({ load, respond }: { load: () => Promise<ComplaintAboutYou[]>; respond: (id: number, text: string) => Promise<unknown> }) {
  const toast = useToast();
  const state = useAdminData(load);
  const [target, setTarget] = useState<ComplaintAboutYou | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (text.trim().length < 10) return setError("Write at least 10 characters");
    setBusy(true);
    setError(null);
    try {
      await respond(target!.id, text.trim());
      toast.success("Response sent to HelloCircle");
      setTarget(null);
      state.reload();
    } catch (e) {
      setError(errorMessage(e, "Couldn't send your response"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box flush icon={MessageSquareWarning} title="Complaints about you" subtitle="What was raised and what HelloCircle decided. You don't see who raised it.">
      <Loaded state={state} title="Couldn't load complaints">
        {(rows) =>
          rows.length === 0 ? (
            <EmptyMessage title="No complaints" />
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {rows.map((c) => (
                <li key={c.id} style={{ padding: "14px 24px", borderTop: "1px solid var(--adm-line)", display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <strong>
                      #{c.id} · {c.subjectType.replace(/_/g, " ")}
                      {c.subjectRef ? ` ${c.subjectRef}` : ""}
                    </strong>
                    <StatusTag status={STATUS[c.status].status} label={STATUS[c.status].label} />
                  </div>
                  <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{c.body}</p>
                  <div className="adm-note">Raised {formatDate(c.createdAt, true)}</div>
                  {c.response && (
                    <p style={{ margin: 0, background: "var(--adm-head)", padding: "8px 12px" }}>
                      <strong>Your response:</strong> {c.response}
                    </p>
                  )}
                  {c.status === "closed" && c.statementOfReasons && (
                    <p style={{ margin: 0 }}>
                      <strong>HelloCircle's decision ({c.decision}):</strong> {c.statementOfReasons}
                    </p>
                  )}
                  {c.status !== "closed" && (
                    <div>
                      <AdminButton
                        size="sm"
                        onClick={() => {
                          setTarget(c);
                          setText(c.response ?? "");
                          setError(null);
                        }}
                      >
                        {c.response ? "Edit response" : "Respond"}
                      </AdminButton>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>
      <AdminModal
        open={!!target}
        onClose={() => setTarget(null)}
        dirty={!!text && text !== (target?.response ?? "")}
        title={`Respond to complaint #${target?.id ?? ""}`}
        subtitle="HelloCircle reads this before deciding. Stick to the facts; it may be shared with the person who complained."
        footer={
          <>
            <AdminButton variant="quiet" onClick={() => setTarget(null)}>
              Cancel
            </AdminButton>
            <AdminButton variant="primary" onClick={send} disabled={busy}>
              {busy ? "Sending…" : "Send response"}
            </AdminButton>
          </>
        }
      >
        <FormField label="Your response" required error={error}>
          {(p) => <textarea {...p} className="adm-input" rows={5} value={text} onChange={(e) => setText(e.target.value)} style={{ resize: "vertical", width: "100%" }} />}
        </FormField>
      </AdminModal>
    </Box>
  );
}
