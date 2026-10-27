import { useEffect, useState } from "react";
import { ApiError } from "../../api/core";
import { createCirclePlanIdea, linkListingToCircle, search } from "../../api";
import { dateLabel } from "../../euro";
import { formatPrice } from "../../formatters";
import { getMediaUrl } from "../../media";
import type { CirclePlanListingType } from "../../types";
import { FieldLabel } from "../form";
import { Button, Modal, inputStyle } from "../ui";
import "./circleExperience.css";

// Circles 3.1 — "Link existing": find a HelloCircle listing and bring it into
// the Circle, without copying it. Two different things can happen, and the
// person chooses: link it (it shows in the Circle; nobody commits) or plan to
// go together (a Circle plan members can say they're in to). Both keep the
// listing's owner, price, places and booking exactly as they are. Searches
// the same public search Explore uses, so only discoverable listings appear.

type Kind = "activity" | "adventure" | "experience" | "volunteer" | "programme" | "place";
const KIND_LABEL: Record<Kind, string> = { activity: "Activity", adventure: "Adventure", experience: "Experience", volunteer: "Volunteering", programme: "Programme", place: "Place" };

interface Hit {
  key: string;
  kind: Kind;
  ref: { type: CirclePlanListingType; id: string };
  title: string;
  image: string | null;
  where: string | null;
  date: string | null;
  priceCents: number | null;
}

export function LinkListingDialog({
  circleId,
  circleName,
  isOrganiser,
  onClose,
  onDone,
  startKind,
}: {
  circleId: string;
  circleName: string;
  isOrganiser: boolean;
  onClose: () => void;
  onDone: (what: "linked" | "pending" | "planned", targetId: string) => void;
  startKind?: Kind | "all";
}) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Kind | "all">(startKind ?? "all");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen] = useState<Hit | null>(null);
  const [mode, setMode] = useState<"link" | "plan">("link");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) return setHits(null);
    let live = true;
    setSearching(true);
    const t = setTimeout(() => {
      search(q.trim())
        .then((r) => {
          if (!live) return;
          const out: Hit[] = [];
          for (const a of r.activities) {
            if (a.kind === "game") out.push({ key: `g-${a.id}`, kind: "activity", ref: { type: "game", id: a.id }, title: a.title, image: a.imageUrl, where: a.centreName ?? ([a.area, a.county].filter(Boolean).join(", ") || null), date: a.date, priceCents: a.priceCents });
            else if (a.kind === "program_session") {
              const m = /^\/programs\/([^/?#]+)/.exec(a.href);
              if (m && !out.some((h) => h.ref.type === "program" && h.ref.id === m[1])) out.push({ key: `p-${m[1]}`, kind: "programme", ref: { type: "program", id: m[1] }, title: a.title, image: a.imageUrl, where: a.centreName, date: a.date, priceCents: a.priceCents });
            }
          }
          for (const e of r.experiences) out.push({ key: `e-${e.id}`, kind: e.kind === "adventure" ? "adventure" : e.kind === "volunteer" ? "volunteer" : "experience", ref: { type: "experience", id: e.id }, title: e.title, image: e.imageUrl || null, where: [e.area, e.county].filter(Boolean).join(", ") || null, date: null, priceCents: e.priceCents });
          for (const p of r.programmes ?? []) if (!out.some((h) => h.ref.type === "program" && h.ref.id === p.id)) out.push({ key: `p-${p.id}`, kind: "programme", ref: { type: "program", id: p.id }, title: p.title, image: p.imageUrl, where: p.parentName, date: p.nextSessionDate, priceCents: p.priceCents });
          for (const c of r.centres) out.push({ key: `c-${c.id}`, kind: "place", ref: { type: "centre", id: c.id }, title: c.name, image: c.image || null, where: [c.area, c.county].filter(Boolean).join(", ") || null, date: null, priceCents: null });
          for (const c of r.clubs) out.push({ key: `k-${c.id}`, kind: "place", ref: { type: "club", id: c.id }, title: c.name, image: c.image || null, where: [c.area, c.county].filter(Boolean).join(", ") || null, date: null, priceCents: null });
          setHits(out);
        })
        .catch(() => live && setHits([]))
        .finally(() => live && setSearching(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  const shown = (hits ?? []).filter((h) => kind === "all" || h.kind === kind);
  const kindsHere = [...new Set((hits ?? []).map((h) => h.kind))];

  const submit = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "plan") {
        const plan = await createCirclePlanIdea(circleId, { title: chosen.title, note: note.trim() || undefined, listing: chosen.ref });
        onDone("planned", plan.id);
      } else {
        const r = await linkListingToCircle(circleId, chosen.ref, note.trim() || undefined);
        onDone(r.status === "approved" ? "linked" : "pending", r.id);
      }
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Bring something into ${circleName}`}
      subtitle="Find an activity, adventure, experience, volunteering, programme or place already on HelloCircle. Nothing is copied or booked."
      size="wide"
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!chosen || busy}>
            {busy ? "Saving…" : mode === "plan" ? "Suggest the plan" : isOrganiser ? "Link to Circle" : "Suggest to organisers"}
          </Button>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        <div>
          <FieldLabel htmlFor="link-search" required>
            Search
          </FieldLabel>
          <input id="link-search" value={q} onChange={(e) => (setQ(e.target.value), setChosen(null))} placeholder="e.g. sea swim, pottery, Glendalough" autoComplete="off" style={inputStyle} />
        </div>
        {kindsHere.length > 1 && (
          <div className="cp-filters cp-filters--kinds" role="group" aria-label="What it is">
            {(["all", ...kindsHere] as (Kind | "all")[]).map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {k === "all" ? "Everything" : KIND_LABEL[k]}
              </button>
            ))}
          </div>
        )}
        <div role="status" aria-live="polite" className="lld-status">
          {searching ? "Searching…" : hits && shown.length === 0 ? "Nothing found. Try another word." : null}
        </div>
        {shown.length > 0 && (
          <ul className="lld-list">
            {shown.slice(0, 20).map((h) => (
              <li key={h.key}>
                <label className={`lld-row${chosen?.key === h.key ? " is-on" : ""}`}>
                  <input type="radio" name="link-choice" checked={chosen?.key === h.key} onChange={() => setChosen(h)} />
                  <span className={`lld-photo${h.image ? "" : " is-empty"}`} aria-hidden="true">
                    {h.image && <img src={getMediaUrl(h.image, "card")} alt="" loading="lazy" />}
                  </span>
                  <span className="lld-text">
                    <small>{KIND_LABEL[h.kind]}</small>
                    <strong>{h.title}</strong>
                    <span>{[h.date ? dateLabel(h.date) : null, h.where, h.kind === "place" ? null : h.priceCents ? formatPrice(h.priceCents) : "Free"].filter(Boolean).join(" · ")}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {chosen && (
          <fieldset className="lld-mode">
            <legend>What would you like to do with it?</legend>
            <label>
              <input type="radio" name="link-mode" checked={mode === "link"} onChange={() => setMode("link")} />
              <span>
                <strong>Link it to the Circle</strong>
                <span>It shows in the Circle for members to see. {isOrganiser ? "" : "An organiser approves it first. "}Nobody is signed up.</span>
              </span>
            </label>
            <label>
              <input type="radio" name="link-mode" checked={mode === "plan"} onChange={() => setMode("plan")} />
              <span>
                <strong>Plan to go together</strong>
                <span>A Circle plan members can say they're in to. Everyone still books on its page.</span>
              </span>
            </label>
          </fieldset>
        )}
        {chosen && (
          <div>
            <FieldLabel htmlFor="link-note" optional>
              Add a message
            </FieldLabel>
            <input id="link-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} style={inputStyle} />
          </div>
        )}
        {error && (
          <p role="alert" style={{ margin: 0, color: "var(--color-danger)", fontSize: 13.5 }}>
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
