import { useState, type SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { createCircle, updateCircle } from "../api";
import { signInHref } from "../authRedirect";
import { BackLink } from "../components/BackLink";
import { useUnsavedChangesGuard } from "../components/form";
import { CheckCircleIcon, PlusIcon } from "../components/icons";
import { ShareButton } from "../components/ShareButton";
import { SingleImageUpload } from "../components/SingleImageUpload";
import { Button, Card, inputStyle, labelStyle } from "../components/ui";
import { PageTitle } from "../components/PageTitle";
import { useGuest } from "../GuestContext";
import { colors, fonts, radius } from "../theme";

// "Start a Circle" form, split out of Circles.tsx into its own page — same
// "big multi-section form gets a page" pattern as the vendor Centre/Club/
// Program/Experience editors and Games.tsx's HostGamePage.

export function StartCirclePage() {
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [form, setFormRaw] = useState({ name: "", activityLabel: "", area: "", county: "", about: "", whatWeDo: "", whoCanJoin: "", values: "", joinMode: "open" as "open" | "approval" | "invite" });
  const [dirty, setDirty] = useState(false);
  const setForm = (updater: SetStateAction<typeof form>) => {
    setFormRaw(updater);
    setDirty(true);
  };
  const { requestNavigation, dialog: unsavedDialog } = useUnsavedChangesGuard(dirty);
  const [showMoreCircleFields, setShowMoreCircleFields] = useState(false);
  const [creating, setCreating] = useState(false);
  // Circle Experience Polish — Changeset 3A. Was a hard navigate straight
  // to the new, empty Circle with zero guidance — the audit's own example
  // of a Circle dead end. A brief success state with the two real next
  // actions replaces that, without turning this into another wizard step.
  const [created, setCreated] = useState<{ id: string; slug: string | null } | null>(null);
  const [createdImageUrl, setCreatedImageUrl] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setCreating(true);
    try {
      const { id, slug } = await createCircle(form);
      setDirty(false);
      setCreated({ id, slug });
    } finally {
      setCreating(false);
    }
  };

  if (created) {
    const ref = created.slug ?? created.id;
    return (
      <div className="fade-panel">
        <section className="section-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "70px 24px 90px", textAlign: "center" }}>
          <div style={{ color: colors.greenText, marginBottom: 14 }}>
            <CheckCircleIcon size={36} />
          </div>
          <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 26, margin: "0 0 8px", letterSpacing: "-.01em" }}>Your Circle is live.</h1>
          <p style={{ margin: "0 0 28px", fontSize: 15, color: colors.mutedLight }}>
            {form.name || "Your Circle"} is ready. Now get things moving.
          </p>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
            <SingleImageUpload
              value={createdImageUrl}
              onChange={async (url) => {
                setCreatedImageUrl(url);
                await updateCircle(created.id, { ...form, imageUrl: url ?? "" });
              }}
              mediaEntityType="circle-cover"
              mediaEntityId={created.id}
            />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", marginBottom: 14 }}>
            <Button onClick={() => navigate(`/manage/circles/${ref}?tab=members`)}>Invite people</Button>
            <Button onClick={() => navigate(`/games/host?activity=${encodeURIComponent(form.activityLabel)}&circleId=${created.id}`)}>
              <PlusIcon size={14} /> Create first plan
            </Button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "center", alignItems: "center" }}>
            <ShareButton entityType="circle" entityId={created.id} render={(onClick) => <button onClick={onClick} style={{ background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: colors.text, cursor: "pointer" }}>Share Circle</button>} />
            <button onClick={() => navigate(`/circles/${ref}`)} style={{ background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: colors.text, cursor: "pointer" }}>
              View Circle
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="fade-panel">
      <section className="section-pad" style={{ maxWidth: 900, margin: "0 auto", padding: "36px 24px 90px" }}>
        <BackLink onClick={() => requestNavigation(() => navigate(-1))}>Back</BackLink>
        <PageTitle>Start a Circle</PageTitle>

        {resident ? (
          <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "22px 24px", marginTop: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
              <PlusIcon size={16} /> Start a Circle
            </div>
            <p style={{ margin: "0 0 18px", fontSize: 13.5, color: colors.mutedLight, lineHeight: 1.5 }}>
              Starting a Circle doesn't mean you need everything planned. Start with an idea and find people who are interested.
            </p>
            <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label style={labelStyle}>Name</label>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Clontarf Badminton Circle" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Activity</label>
                <input value={form.activityLabel} onChange={(e) => setForm((f) => ({ ...f, activityLabel: e.target.value }))} placeholder="e.g. Badminton" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Area</label>
                <input value={form.area} onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>County</label>
                <input value={form.county} onChange={(e) => setForm((f) => ({ ...f, county: e.target.value }))} style={inputStyle} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>Membership</label>
                <select value={form.joinMode} onChange={(e) => setForm((f) => ({ ...f, joinMode: e.target.value as typeof f.joinMode }))} style={inputStyle}>
                  <option value="open">Open — anyone can join instantly</option>
                  <option value="approval">Approval — you approve each request</option>
                  <option value="invite">Invite only — you add members yourself</option>
                </select>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>About (optional)</label>
                <textarea value={form.about} onChange={(e) => setForm((f) => ({ ...f, about: e.target.value }))} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
              </div>
            </div>

            {/* Structured "About our community" content (Circle Detail
                redesign) — collapsed by default, same reasoning as
                HostGamePage's own "Add more detail": most organisers just
                want to post a Circle quickly. */}
            {!showMoreCircleFields ? (
              <button
                onClick={() => setShowMoreCircleFields(true)}
                style={{ background: "none", border: "none", padding: 0, marginTop: 14, color: colors.text, fontWeight: 700, fontSize: 13, cursor: "pointer", textDecoration: "underline" }}
              >
                + Add more detail (optional)
              </button>
            ) : (
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${colors.border}` }}>
                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>What we do (optional)</label>
                  <textarea
                    value={form.whatWeDo}
                    onChange={(e) => setForm((f) => ({ ...f, whatWeDo: e.target.value }))}
                    placeholder="e.g. Weekly sessions, occasional social meetups and the odd challenge."
                    rows={2}
                    style={{ ...inputStyle, resize: "vertical" }}
                  />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>Who can join (optional)</label>
                  <textarea
                    value={form.whoCanJoin}
                    onChange={(e) => setForm((f) => ({ ...f, whoCanJoin: e.target.value }))}
                    placeholder="e.g. Anyone nearby who wants to give this a go — no experience needed."
                    rows={2}
                    style={{ ...inputStyle, resize: "vertical" }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Our values (optional)</label>
                  <textarea
                    value={form.values}
                    onChange={(e) => setForm((f) => ({ ...f, values: e.target.value }))}
                    placeholder="e.g. Respect, encouragement, and showing up for each other."
                    rows={2}
                    style={{ ...inputStyle, resize: "vertical" }}
                  />
                </div>
              </div>
            )}

            <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
              <Button onClick={handleCreate} disabled={creating || !form.name.trim()}>{creating ? "Creating…" : "Create Circle"}</Button>
              <Button variant="ghost" onClick={() => requestNavigation(() => navigate(-1))}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Card style={{ background: colors.greenBg, border: `1px solid ${colors.green}`, marginTop: 20 }}>
            <button onClick={() => navigate(signInHref())} style={{ background: "none", border: "none", padding: 0, color: colors.greenText, fontWeight: 700, cursor: "pointer" }}>
              Sign in
            </button>{" "}
            to start a Circle of your own.
          </Card>
        )}
      </section>
      {unsavedDialog}
    </div>
  );
}
