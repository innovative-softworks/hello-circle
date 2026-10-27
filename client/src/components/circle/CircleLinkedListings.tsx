import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createCirclePlanIdea, decideCircleLink, fetchCircleLinks, removeCircleLink } from "../../api";
import type { CircleLink } from "../../types";
import { useConfirm } from "../ConfirmProvider";
import { LoadErrorState } from "../ui";
import { CirclePlanListingBlock, LISTING_KIND_LABEL } from "./CirclePlanListing";
import "./circleExperience.css";

// Circles 3.1 — "Linked to this Circle": listings members brought in, and
// listings a partner made for this Circle. Not plans: nobody has said they're
// going. Each one can become a plan ("Plan together"). Organisers approve
// members' suggestions; removing a link never touches the listing.

const RELATIONSHIP: Record<CircleLink["relationship"], string> = {
  shared: "Linked",
  created_for: "Made for this Circle",
  official: "This Circle is its official Circle",
};

export function CircleLinkedListings({
  circleId,
  member,
  closed,
  refreshKey,
  onLinkExisting,
  onSuggest,
}: {
  circleId: string;
  member: boolean;
  closed: boolean;
  refreshKey: number;
  onLinkExisting: () => void;
  onSuggest: () => void;
}) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [links, setLinks] = useState<CircleLink[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [kind, setKind] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setFailed(false);
    fetchCircleLinks(circleId)
      .then(setLinks)
      .catch(() => setFailed(true));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [circleId, refreshKey]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(null);
    }
  };

  if (failed) return <LoadErrorState title="Couldn't load what's linked to this Circle." onRetry={load} />;
  if (!links) return null;

  const pending = links.filter((l) => l.status === "pending");
  const live = links.filter((l) => l.status === "approved");
  const kinds = [...new Set(live.map((l) => l.listing.kind))];
  const shown = live.filter((l) => kind === "all" || l.listing.kind === kind);

  if (links.length === 0) {
    if (!member) return null;
    return (
      <section className="cll" aria-labelledby="cll-title">
        <h2 id="cll-title">Linked to this Circle</h2>
        <div className="cll-empty">
          <strong>No plans yet</strong>
          <p>Your Circle's next good day starts with an idea.</p>
          {!closed && (
            <div className="cll-empty-actions">
              <button type="button" className="cp-link cp-link--strong" onClick={onSuggest}>
                Suggest something
              </button>
              <button type="button" className="cp-link" onClick={() => navigate("/explore")}>
                Explore activities
              </button>
              <button type="button" className="cp-link" onClick={onLinkExisting}>
                Link an existing listing
              </button>
            </div>
          )}
        </div>
      </section>
    );
  }

  const row = (l: CircleLink) => (
    <li key={l.id} className="cll-row">
      <div className="cll-head">
        <strong>{l.listing.title || "No longer listed"}</strong>
        <span className="cll-rel">
          {l.status === "pending" ? (l.linkedByMe ? "Waiting for an organiser" : `Suggested by ${l.linkedByName ?? "a member"}`) : RELATIONSHIP[l.relationship]}
          {l.status === "approved" && l.linkedByName && l.relationship !== "official" ? ` by ${l.linkedByMe ? "you" : l.linkedByName}` : ""}
        </span>
      </div>
      {l.note && <p className="cll-note">"{l.note}"</p>}
      <CirclePlanListingBlock listing={l.listing} inLink />
      <div className="cll-actions">
        {member && l.status === "approved" && !closed && l.listing.availability !== "cancelled" && l.listing.availability !== "unavailable" && (
          <button
            type="button"
            className="cp-link cp-link--strong"
            disabled={busy === `plan-${l.id}`}
            onClick={() =>
              act(`plan-${l.id}`, async () => {
                try {
                  const plan = await createCirclePlanIdea(circleId, { title: l.listing.title, listing: { type: l.listing.type, id: l.listing.id } });
                  navigate(`?tab=activities#plan-${plan.id}`);
                } catch (e) {
                  const planId = (e as { body?: { planId?: string } }).body?.planId;
                  if (planId) navigate(`?tab=activities#plan-${planId}`);
                  else throw e;
                }
              })
            }
          >
            Plan together
          </button>
        )}
        {l.canDecide && (
          <>
            <button type="button" className="cp-link cp-link--strong" disabled={busy === l.id} onClick={() => act(l.id, () => decideCircleLink(circleId, l.id, true))}>
              Approve
            </button>
            <button type="button" className="cp-link" disabled={busy === l.id} onClick={() => act(l.id, () => decideCircleLink(circleId, l.id, false))}>
              Decline
            </button>
          </>
        )}
        {l.canRemove && (
          <button
            type="button"
            className="cp-link"
            disabled={busy === l.id}
            onClick={async () => {
              if (await confirm({ title: "Remove it from the Circle?", message: "It stops showing in this Circle. The listing itself, its bookings and any other Circles it's in aren't affected.", confirmLabel: "Remove", cancelLabel: "Keep it" }))
                await act(l.id, () => removeCircleLink(circleId, l.id));
            }}
          >
            {l.status === "pending" && l.linkedByMe ? "Withdraw" : "Remove"}
          </button>
        )}
      </div>
    </li>
  );

  return (
    <section className="cll" aria-labelledby="cll-title">
      <div className="cll-top">
        <h2 id="cll-title">Linked to this Circle</h2>
        {member && !closed && (
          <button type="button" className="cp-link cp-link--strong" onClick={onLinkExisting}>
            Link an existing listing
          </button>
        )}
      </div>
      <p className="cll-sub">Things members brought in. Being linked doesn't sign anyone up; each one books on its own page.</p>
      {error && (
        <p role="alert" className="cp-error">
          {error}
        </p>
      )}
      {pending.length > 0 && (
        <>
          <h3 className="cll-sub-title">Waiting for an organiser ({pending.length})</h3>
          <ul className="cll-list">{pending.map(row)}</ul>
        </>
      )}
      {kinds.length > 1 && (
        <div className="cp-filters cp-filters--kinds" role="group" aria-label="What it is">
          {["all", ...kinds].map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {k === "all" ? "Everything" : LISTING_KIND_LABEL[k] ?? k}
            </button>
          ))}
        </div>
      )}
      {shown.length > 0 ? <ul className="cll-list">{shown.map(row)}</ul> : pending.length === 0 ? null : <p className="cll-sub">Nothing approved yet.</p>}
    </section>
  );
}
