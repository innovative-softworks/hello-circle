import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { addCircleMemory, fetchCircleMemories, removeCircleMemory } from "../../api";
import { dateLabel } from "../../euro";
import type { CircleMemoriesView, CircleMemory } from "../../types";
import { useConfirm } from "../ConfirmProvider";
import { FieldError, FieldLabel } from "../form";
import { PhotoStackIcon } from "../icons";
import { Camera } from "lucide-react";
import { Lightbox } from "../PhotoGallery";
import { ReportContentButton } from "../ReportContentButton";
import { SingleImageUpload } from "../SingleImageUpload";
import { Button, EmptyState, LoadErrorState, Modal, Skeleton, inputStyle } from "../ui";
import type { SuggestPlanPrefill } from "./CirclePulseSection";

// Circle Experience 2.0 — Circle Memories (circles.memories). People who took
// part in a past Circle activity add a photo (with everyone-pictured
// consent) or a few lines. Members only, in every join mode (owner decision
// D4). The contributor or an organiser can remove one; anyone can report
// one. The count is "activities together" — this Circle's own past
// activities someone confirmed attending. No likes, no leaderboards.

export function CircleMemoriesPanel({
  circleId,
  limit,
  closed,
  onSuggestPlan,
  onSeeAll,
  layout = "grid",
}: {
  circleId: string;
  /** Home shows a few; the Memories tab shows all. */
  limit?: number;
  closed: boolean;
  onSuggestPlan: (prefill: SuggestPlanPrefill) => void;
  onSeeAll?: () => void;
  /** "strip" — Circle Home's row of photos (2026-10-23); actions live on the Memories tab. */
  layout?: "grid" | "strip";
}) {
  const confirm = useConfirm();
  const [view, setView] = useState<CircleMemoriesView | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);

  const load = () => {
    setFailed(false);
    fetchCircleMemories(circleId)
      .then(setView)
      .catch(() => setFailed(true));
  };
  useEffect(load, [circleId]);

  if (failed) return <LoadErrorState title="We couldn't load Circle Memories." onRetry={load} />;
  if (!view) return <Skeleton height={140} />;

  const items = limit ? view.items.slice(0, limit) : view.items;
  // Photos open in the same full-screen viewer as photos everywhere else.
  const photos = view.items.filter((m) => m.kind === "photo" && m.imageUrl);
  const openPhoto = (m: CircleMemory) => setViewing(photos.findIndex((p) => p.id === m.id));
  const memoryLine = (m: CircleMemory) => [m.caption, `${m.activity.activityLabel} · ${dateLabel(m.activity.date)} · ${m.mine ? "You" : m.contributorName}`].filter(Boolean).join(" · ");
  const viewer =
    viewing !== null &&
    viewing >= 0 &&
    photos.length > 0 &&
    createPortal(
      <Lightbox photos={photos.map((m) => m.imageUrl!)} captions={photos.map(memoryLine)} alt="Circle memory" index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />,
      document.body
    );
  const remove = async (m: CircleMemory) => {
    const ok = await confirm({
      title: m.mine ? "Remove your memory?" : "Remove this memory?",
      message: m.mine ? "It disappears from the Circle's Memories." : `${m.contributorName}'s ${m.kind === "photo" ? "photo" : "reflection"} disappears for everyone. This is recorded.`,
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    setError(null);
    try {
      await removeCircleMemory(circleId, m.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through. Try again.");
    }
  };

  const adder = adding && (
    <AddMemoryDialog
      circleId={circleId}
      activities={view.contributableActivities}
      onClose={() => setAdding(false)}
      onAdded={() => {
        setAdding(false);
        load();
      }}
    />
  );

  if (layout === "strip") {
    // C · Title on the photo (owner 2026-10-27): four taller tiles, each
    // saying what it is and which activity it came from.
    const STRIP = 4;
    const strip = view.items.slice(0, STRIP);
    const more = view.items.length - STRIP;
    return (
      <div>
        <div className="ch-head">
          <div>
            <h2>
              <span className="ch-head-icon" aria-hidden="true">
                <Camera size={22} />
              </span>
              Circle memories
            </h2>
            <p>
              {view.activitiesTogether > 0
                ? `Highlights from ${view.activitiesTogether} ${view.activitiesTogether === 1 ? "activity" : "activities"} together. Only members can see them.`
                : "Photos and moments from things you've done together. Only members can see them."}
            </p>
          </div>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            {view.canContribute && !closed && (
              <button type="button" className="ch-see-all" onClick={() => setAdding(true)}>
                Add a memory
              </button>
            )}
            {onSeeAll && view.items.length > 0 && (
              <button type="button" className="ch-see-all" onClick={onSeeAll}>
                View all memories →
              </button>
            )}
          </div>
        </div>
        {strip.length === 0 ? (
          <EmptyState
            icon={<PhotoStackIcon size={20} />}
            title="No memories yet"
            subtitle={view.canContribute ? "Took part in a Circle activity? Add a photo or a few lines about it." : "After a Circle activity, the people who were there can add photos and highlights here."}
          />
        ) : (
          <ul className="ch-strip">
            {strip.map((m, i) => (
              <li key={m.id}>
                {m.kind === "photo" && m.imageUrl ? (
                  <button type="button" className="ce-memory-open ch-strip-photo" aria-label={`Open photo: ${m.caption || m.activity.activityLabel}`} onClick={() => openPhoto(m)}>
                    <img src={m.imageUrl} alt="" loading="lazy" />
                    <span className="ch-strip-on" aria-hidden="true">
                      {m.caption ? <strong>{m.caption}</strong> : null}
                      <span>
                        {m.activity.activityLabel} · {dateLabel(m.activity.date)}
                      </span>
                    </span>
                  </button>
                ) : (
                  <blockquote>
                    “{m.body ?? m.caption}”
                    <small>
                      {m.activity.activityLabel} · {dateLabel(m.activity.date)}
                    </small>
                  </blockquote>
                )}
                {i === strip.length - 1 && more > 0 && onSeeAll && (
                  <button type="button" className="ch-strip-more" onClick={onSeeAll}>
                    +{more} more
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {adder}
        {viewer}
      </div>
    );
  }

  return (
    <div>
      <div className="ce-section-head">
        <div>
          <h2>Circle Memories</h2>
          <p>
            {view.activitiesTogether > 0
              ? `Your Circle has done ${view.activitiesTogether} ${view.activitiesTogether === 1 ? "activity" : "activities"} together.`
              : "Photos and moments from things you've done together. Only members can see them."}
          </p>
        </div>
        <div className="ce-row-actions">
          {limit && onSeeAll && view.items.length > limit && (
            <Button variant="ghost" onClick={onSeeAll}>
              See all ({view.items.length})
            </Button>
          )}
          {view.canContribute && !closed && <Button onClick={() => setAdding(true)}>Add a memory</Button>}
        </div>
      </div>
      {error && (
        <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13, margin: "0 0 10px" }}>
          {error}
        </p>
      )}
      {items.length === 0 ? (
        <EmptyState
          icon={<PhotoStackIcon size={20} />}
          title="No memories yet"
          subtitle={view.canContribute ? "Took part in a Circle activity? Add a photo or a few lines about it." : "After a Circle activity, the people who were there can add photos and highlights here."}
        />
      ) : (
        <ul className="ce-memory-grid" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {items.map((m) => (
            <li key={m.id} className="ce-memory">
              {m.kind === "photo" && m.imageUrl && (
                <button type="button" className="ce-memory-open" aria-label={`Open photo: ${m.caption || m.activity.activityLabel}`} onClick={() => openPhoto(m)}>
                  <img src={m.imageUrl} alt="" loading="lazy" />
                </button>
              )}
              <div className="ce-memory-body">
                {m.kind === "reflection" && m.body && <blockquote>{m.body}</blockquote>}
                {m.caption && <p style={{ margin: 0, fontSize: 13.5 }}>{m.caption}</p>}
                <div className="ce-memory-meta">
                  {m.activity.activityLabel} · {dateLabel(m.activity.date)} · {m.mine ? "You" : m.contributorName}
                </div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12.5 }}>
                  {!closed && (
                    <button type="button" className="ce-link" onClick={() => onSuggestPlan({ title: m.activity.activityLabel })}>
                      Plan another like this
                    </button>
                  )}
                  {m.canRemove && (
                    <button type="button" className="ce-link" onClick={() => remove(m)}>
                      Remove
                    </button>
                  )}
                  {!m.mine && (
                    <ReportContentButton
                      targetType="circle_memory"
                      targetId={m.id}
                      what="this memory"
                      render={(onClick, already) =>
                        already ? (
                          <span style={{ color: "var(--color-muted-light)" }}>Reported</span>
                        ) : (
                          <button type="button" className="ce-link" onClick={onClick}>
                            Report
                          </button>
                        )
                      }
                    />
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {adder}
      {viewer}
    </div>
  );
}

function AddMemoryDialog({
  circleId,
  activities,
  onClose,
  onAdded,
}: {
  circleId: string;
  activities: CircleMemoriesView["contributableActivities"];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [gameId, setGameId] = useState(activities[0]?.id ?? "");
  const [kind, setKind] = useState<"photo" | "reflection">("photo");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [body, setBody] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const inFlight = useRef(false);
  const dirty = !!imageUrl || !!caption.trim() || !!body.trim();

  const save = async () => {
    if (inFlight.current) return;
    if (kind === "photo" && !imageUrl) return setError({ field: "imageUrl", message: "Add a photo first" });
    if (kind === "photo" && !consent) return setError({ field: "consent", message: "Confirm everyone in the photo is happy for it to be shared" });
    if (kind === "reflection" && body.trim().length < 3) return setError({ field: "body", message: "Write a few words" });
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await addCircleMemory(circleId, { gameId, kind, imageUrl: imageUrl ?? undefined, caption: caption.trim() || undefined, body: body.trim() || undefined, consent });
      onAdded();
    } catch (e) {
      const field = (e as { body?: { field?: string } }).body?.field;
      setError({ field, message: e instanceof Error ? e.message : "That didn't save. Try again." });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add a memory"
      subtitle="Only members of this Circle will see it."
      size="wide"
      confirmClose={dirty ? { title: "Discard this memory?", message: "What you've added here won't be saved." } : undefined}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Adding…" : "Add memory"}
          </Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {error && !error.field && (
          <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13, margin: 0 }}>
            {error.message}
          </p>
        )}
        <div>
          <FieldLabel htmlFor="ce-memory-activity" required>
            Which activity?
          </FieldLabel>
          <select id="ce-memory-activity" value={gameId} onChange={(e) => setGameId(e.target.value)} style={inputStyle}>
            {activities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.activityLabel} · {dateLabel(a.date)}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="ce-choice-list" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
          <legend className="visually-hidden">What are you adding?</legend>
          {(["photo", "reflection"] as const).map((k) => (
            <label key={k} className="ce-choice">
              <input type="radio" name="ce-memory-kind" checked={kind === k} onChange={() => (setKind(k), setError(null))} />
              <div>
                <strong>{k === "photo" ? "A photo" : "A few words"}</strong>
                <span>{k === "photo" ? "With an optional caption" : "A highlight or a thank-you"}</span>
              </div>
            </label>
          ))}
        </fieldset>
        {kind === "photo" ? (
          <>
            <div>
              <SingleImageUpload label="Photo" value={imageUrl} onChange={(url) => (setImageUrl(url), setError(null))} mediaEntityType="circle-memory" mediaEntityId={circleId} />
              <FieldError fieldId="ce-memory-image" message={error?.field === "imageUrl" ? error.message : undefined} />
            </div>
            <div>
              <FieldLabel htmlFor="ce-memory-caption" optional>
                Caption
              </FieldLabel>
              <input id="ce-memory-caption" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={280} style={inputStyle} />
            </div>
            <div>
              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13.5, lineHeight: 1.5, cursor: "pointer" }}>
                <input
                  id="ce-memory-consent"
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => (setConsent(e.target.checked), setError(null))}
                  aria-invalid={error?.field === "consent" || undefined}
                  aria-describedby={error?.field === "consent" ? "ce-memory-consent-error" : undefined}
                  style={{ width: 18, height: 18, marginTop: 2, accentColor: "var(--color-green)" }}
                />
                <span>Everyone recognisable in this photo is happy for it to be shared with this Circle's members.</span>
              </label>
              <FieldError fieldId="ce-memory-consent" message={error?.field === "consent" ? error.message : undefined} />
            </div>
          </>
        ) : (
          <div>
            <FieldLabel htmlFor="ce-memory-body" required>
              Your words
            </FieldLabel>
            <textarea
              id="ce-memory-body"
              value={body}
              onChange={(e) => (setBody(e.target.value), setError(null))}
              maxLength={1000}
              rows={4}
              placeholder="e.g. The view from the top was worth every step. Thanks for waiting for me!"
              aria-invalid={error?.field === "body" || undefined}
              aria-describedby={error?.field === "body" ? "ce-memory-body-error" : undefined}
              style={{ ...inputStyle, resize: "vertical" }}
            />
            <FieldError fieldId="ce-memory-body" message={error?.field === "body" ? error.message : undefined} />
          </div>
        )}
      </div>
    </Modal>
  );
}
