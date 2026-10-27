import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { fetchLinkableCircles, fetchVendorParticipation, saveVendorParticipation, type VendorParticipationType } from "../../api";
import "./circleExperience.css";

// Circles 3.1 — "Creating for {Circle}" on the partner create pages, opened
// from a Circle's "Create or organise" (…/new?circleId=…). The Circle becomes
// the listing's official Circle on its first save (draft included), through
// the existing participation route, which only accepts a Circle organised
// by someone in this organisation — the URL is never trusted on its own.
// Approval and publishing are unchanged. If attaching fails, the listing is
// kept and the banner offers a retry (attaching twice changes nothing).

export function CircleCreationBanner({ type, listingId }: { type: VendorParticipationType; listingId: string | null }) {
  const circleId = new URLSearchParams(useLocation().search).get("circleId");
  const [circle, setCircle] = useState<{ id: string; name: string } | "not-allowed" | undefined>(undefined);
  const [state, setState] = useState<"idle" | "attaching" | "attached" | "failed">("idle");

  useEffect(() => {
    if (!circleId) return;
    fetchLinkableCircles()
      .then((cs) => setCircle(cs.find((c) => c.id === circleId) ?? "not-allowed"))
      .catch(() => setCircle("not-allowed"));
  }, [circleId]);

  const attach = async (id: string, cId: string) => {
    setState("attaching");
    try {
      const current = await fetchVendorParticipation(type, id);
      if (current.circleId !== cId) await saveVendorParticipation(type, id, { attributes: current.attributes, circleId: cId });
      setState("attached");
    } catch {
      setState("failed");
    }
  };

  useEffect(() => {
    if (listingId && circle && typeof circle === "object" && state === "idle") void attach(listingId, circle.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId, circle]);

  if (!circleId || circle === undefined || circle === null) return null;
  const what = type === "program" ? "programme" : "listing";
  if (circle === "not-allowed") {
    return (
      <div className="ccb ccb--warn" role="status">
        <strong>This Circle can't be attached here</strong>
        <span>You can only create a {what} for a Circle someone in your organisation organises. Create it as usual, then link it from the Circle once it's live.</span>
      </div>
    );
  }
  return (
    <div className={`ccb${state === "failed" ? " ccb--warn" : ""}`} role="status">
      <strong>Creating for {circle.name}</strong>
      <span>
        {state === "attached"
          ? `Saved as this ${what}'s Circle. It shows in ${circle.name} once it's published${type === "experience" ? " and HelloCircle has approved it" : ""}.`
          : state === "failed"
            ? `Your ${what} is saved, but attaching it to ${circle.name} didn't work.`
            : `When you save, ${circle.name} becomes this ${what}'s Circle. You stay the owner; prices, places and bookings work as usual.${type === "experience" ? " HelloCircle reviews it before it goes live." : ""}`}
      </span>
      {state === "failed" && listingId && (
        <button type="button" className="ccb-retry" onClick={() => attach(listingId, circle.id)}>
          Try again
        </button>
      )}
    </div>
  );
}
