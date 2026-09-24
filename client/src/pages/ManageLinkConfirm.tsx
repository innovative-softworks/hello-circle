import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { confirmManageLink } from "../api";
import { CheckCircleIcon } from "../components/icons";
import { Button, PageSpinner } from "../components/ui";
import { colors, fonts } from "../theme";

// Platform Pre-Launch Polish — Changeset 1. The vendor-side "link my
// accounts" email (server/src/routes/manage.ts's /link/request) has always
// pointed here, but this route never existed — confirmManageLink() (the
// client API wrapper for the matching /link/confirm endpoint) had zero
// callers. This closes the loop; the server-side linking logic itself is
// untouched.

type Status = "loading" | "success" | "error";

export function ManageLinkConfirm() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [status, setStatus] = useState<Status>(token ? "loading" : "error");
  const [error, setError] = useState<string>("This link is missing its confirmation code — copy the full link from the email.");
  // Guards against React 18 StrictMode's double-invoke in dev, and against
  // the token being consumable exactly once server-side (a second call
  // would otherwise show a confusing "expired" error for a link that just
  // succeeded).
  const submitted = useRef(false);

  useEffect(() => {
    if (!token || submitted.current) return;
    submitted.current = true;
    confirmManageLink(token)
      .then(() => setStatus("success"))
      .catch((e) => {
        setError(e instanceof Error ? e.message : "This link has expired or was already used — request a new one from your vendor dashboard.");
        setStatus("error");
      });
  }, [token]);

  return (
    <section className="section-pad" style={{ maxWidth: 480, margin: "0 auto", padding: "90px 24px 100px", textAlign: "center" }}>
      {status === "loading" && <PageSpinner />}

      {status === "success" && (
        <>
          <div style={{ color: colors.greenText, marginBottom: 14 }}>
            <CheckCircleIcon size={36} />
          </div>
          <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 24, margin: "0 0 8px", letterSpacing: "-.01em" }}>Accounts connected</h1>
          <p style={{ margin: "0 0 28px", fontSize: 15, color: colors.mutedLight }}>You can now switch between your HelloCircle workspaces.</p>
          {/* A full navigation, not client-side routing — the safest way to
              guarantee every part of the app (Header's workspace fetch
              included) picks up the freshly linked account without needing
              to reason about which effect dependencies would otherwise
              trigger a refetch. */}
          <Button onClick={() => { window.location.href = "/"; }}>View workspaces</Button>
        </>
      )}

      {status === "error" && (
        <>
          <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 22, margin: "0 0 10px" }}>This link didn't work.</h1>
          <p style={{ margin: "0 0 28px", fontSize: 15, color: colors.mutedLight }}>{error}</p>
          <Button variant="ghost" onClick={() => { window.location.href = "/"; }}>Return home</Button>
        </>
      )}
    </section>
  );
}
