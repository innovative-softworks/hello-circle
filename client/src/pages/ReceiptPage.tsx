import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { fetchReceiptDetail } from "../api";
import { BackLink } from "../components/BackLink";
import { ReceiptBody } from "../components/ReceiptDrawer";
import { Button, LoadErrorState, RowSkeleton } from "../components/ui";
import { Printer } from "lucide-react";
import { RECEIPT_STATUS, type ReceiptDetail, type ReceiptKind } from "../components/commerceDisplay";
import { Pass, type PassKind, type PassTone } from "../components/pass/Pass";

// The pass at the top of a receipt (owner 2026-10-27): the same ticket you
// show up with, so the receipt and the booking always read the same. A
// receipt has no date of its own, so the pass shows what was bought.
const RECEIPT_PASS_KIND: Record<ReceiptKind, PassKind> = { booking: "room", registration: "club", game: "activity", pass: "pass", program_enrollment: "programme", experience: "experience" };
const RECEIPT_PASS_TONE: Record<ReceiptDetail["status"], PassTone> = { paid: "ok", free: "ok", pay_at_venue: "ok", pending: "warn", failed: "bad", refunded: "bad", part_refunded: "ok" };
import { signInHref } from "../authRedirect";
import { fonts } from "../theme";
import { usePageTitle } from "../pageTitle";

// A receipt is a dedicated page (UI completion 2026-10-14) — it used to open
// in a slide-in drawer from Profile → Receipts. Stable URL, shareable with
// yourself, refreshable. The server only returns the signed-in resident's own
// receipts (GET /residents/me/receipts/:ref).
type State = { status: "loading" } | { status: "ready"; data: ReceiptDetail } | { status: "signin" } | { status: "missing" } | { status: "error"; message: string };

export function ReceiptPage() {
  const { ref = "" } = useParams<{ ref: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ status: "loading" });
  usePageTitle(state.status === "ready" ? `Receipt ${ref}` : "Receipt");
  const load = () => {
    setState({ status: "loading" });
    fetchReceiptDetail(ref)
      .then((data) => setState({ status: "ready", data }))
      .catch((e: unknown) => {
        const status = (e as { status?: number })?.status;
        if (status === 401) setState({ status: "signin" });
        else if (status === 404 || status === 403) setState({ status: "missing" });
        else setState({ status: "error", message: e instanceof Error ? e.message : "Check your connection and try again." });
      });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [ref]);

  return (
    <section className="section-pad" style={{ maxWidth: 640, margin: "0 auto", padding: "40px 24px 90px" }}>
      <BackLink onClick={() => navigate("/profile?tab=payment&view=receipts")}>Back to receipts</BackLink>
      <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(24px, 2.4vw, 30px)", margin: "8px 0 4px" }}>Receipt</h1>
      <p style={{ margin: "0 0 20px", fontFamily: "monospace" }}>{ref}</p>
      <div aria-live="polite" aria-busy={state.status === "loading" || undefined}>
        {state.status === "loading" && <RowSkeleton />}
        {state.status === "signin" && (
          <p role="alert">
            Sign in to see this receipt. <Link to={signInHref()}>Sign in</Link>
          </p>
        )}
        {state.status === "missing" && (
          <div role="status">
            <strong>We can't find this receipt.</strong>
            <p>It may belong to a different account, or the reference is wrong.</p>
          </div>
        )}
        {state.status === "error" && <LoadErrorState title="We couldn't load this receipt." detail={state.message} onRetry={load} />}
        {state.status === "ready" && (
          <>
            <div className="no-print" style={{ marginBottom: 20 }}>
              <Pass
                look={state.data.kind === "registration" ? "lanyard" : "ticket"}
                kind={RECEIPT_PASS_KIND[state.data.kind]}
                tone={RECEIPT_PASS_TONE[state.data.status]}
                status={RECEIPT_STATUS[state.data.status].label}
                title={state.data.label}
                reference={state.data.kind === "pass" ? null : state.data.ref}
                codeActive={state.data.status !== "pending" && state.data.status !== "failed" && state.data.status !== "refunded"}
                listLine={{ title: state.data.ref, text: "Your reference" }}
              />
            </div>
            <ReceiptBody r={state.data} />
            {/* No PDF endpoint exists; the browser's print dialog can save a PDF. */}
            <div className="no-print" style={{ marginTop: 20 }}>
              <Button variant="ghost" onClick={() => window.print()}>
                <Printer size={16} aria-hidden="true" /> Print or save as PDF
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
