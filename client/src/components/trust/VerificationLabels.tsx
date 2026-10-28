import { CircleCheck, CircleDashed } from "lucide-react";
import type { VerificationLabel } from "../../types";
import "./trust.css";

// Trust & Retention batch 1 — the checks a person or business has actually
// passed, each with what it means and what it doesn't (from the server, see
// server/src/verification.ts). Nothing is inferred here: an empty list says
// so plainly, and identity is listed as "not checked" because HelloCircle
// can't do identity checks yet — never left for people to assume.

const DATE = new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Dublin" });
const when = (iso: string | null | undefined) => (iso ? DATE.format(new Date(iso)) : null);

export function VerificationLabels({ checks, subject }: { checks: VerificationLabel[]; subject: "host" | "provider" | "organiser" }) {
  const hasIdentity = checks.some((c) => c.key === "identity_checked" || c.key === "organiser_identity_checked");
  return (
    <ul className="tr-checks" aria-label="Checks HelloCircle has completed">
      {checks.map((c) => (
        <li key={c.key} className="tr-check">
          <CircleCheck size={18} className="tr-check-icon" aria-hidden="true" />
          <div>
            <div className="tr-check-title">{c.label}</div>
            <p className="tr-check-meaning">
              {c.meaning}
              {when(c.checkedAt) && <span className="tr-muted"> Checked {when(c.checkedAt)}.</span>}
              {c.expiresAt && <span className="tr-muted"> Valid until {when(c.expiresAt)}.</span>}
            </p>
          </div>
        </li>
      ))}
      {!hasIdentity && subject !== "provider" && (
        <li className="tr-check">
          <CircleDashed size={18} className="tr-check-icon is-off" aria-hidden="true" />
          <div>
            <div className="tr-check-title">Identity not checked</div>
            <p className="tr-check-meaning">HelloCircle doesn't check identity documents yet, so no one on HelloCircle has an identity check.</p>
          </div>
        </li>
      )}
      {checks.length === 0 && subject === "provider" && (
        <li className="tr-check">
          <CircleDashed size={18} className="tr-check-icon is-off" aria-hidden="true" />
          <div>
            <div className="tr-check-title">No checks completed yet</div>
            <p className="tr-check-meaning">HelloCircle hasn't checked this provider's business details.</p>
          </div>
        </li>
      )}
    </ul>
  );
}

/** One short line for tight spaces (cards, organiser rows) — the full meaning lives on the profile. */
export function hostCheckLine(hostVerified: boolean | undefined): string | null {
  return hostVerified ? "Host application approved" : null;
}
