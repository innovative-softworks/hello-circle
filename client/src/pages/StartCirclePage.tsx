import { useRef, useState, type SetStateAction } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, createCircle, DISCOVERY_TAG_LABELS, updateCircle, type DiscoveryTag } from "../api";
import { signInHref } from "../authRedirect";
import { BackLink } from "../components/BackLink";
import { CategoryPicker, TagPicker, type CategoryValue } from "../components/categories/CategoryPicker";
import { DraftBanner, FieldError, FieldLabel, FormErrorSummary, RequiredNote, useFormDraft, useFormErrors, useUnsavedChangesGuard } from "../components/form";
import { CheckCircleIcon, PinIcon, PlusIcon, UsersIcon } from "../components/icons";
import { ShareButton } from "../components/ShareButton";
import { SingleImageUpload } from "../components/SingleImageUpload";
import { Button, Card, inputStyle } from "../components/ui";
import { PageTitle } from "../components/PageTitle";
import { IRISH_COUNTY_COORDS } from "../irishCounties";
import { useGuest } from "../GuestContext";
import { colors, fonts } from "../theme";
import "../components/circle/circleExperience.css";

// "Start a Circle" — Circle Experience 2.0 redesign (docs/circle-experience-
// 2-audit.md §2.7). One page, five sections on the left and a live preview
// on the right built only from what's been typed (no made-up members or
// activities). Same fields and the same validation as before: only the name
// is required. The cover photo is added on the success screen because an
// upload needs the Circle to exist (media.ts checks the organiser).
// Unsaved input is kept as a draft in this browser (useFormDraft) — there's
// no server-side draft, so there's no "Save draft" button.

type JoinMode = "open" | "approval" | "invite";

const JOIN_MODES: { value: JoinMode; title: string; text: string; preview: string }[] = [
  { value: "open", title: "Open", text: "Anyone can join instantly", preview: "Open — anyone can join" },
  { value: "approval", title: "Approval", text: "You approve each request", preview: "Ask to join — the organiser approves" },
  { value: "invite", title: "Invite only", text: "You add members yourself", preview: "Invite only" },
];

const COUNTIES = Object.keys(IRISH_COUNTY_COORDS).sort();
const EMPTY_FORM = { name: "", activityLabel: "", area: "", county: "", about: "", whatWeDo: "", whoCanJoin: "", values: "", joinMode: "open" as JoinMode };
type Form = typeof EMPTY_FORM;
type Draft = { form: Form; category: CategoryValue | null; categoryLabel: string | null; tags: string[] };

export function StartCirclePage() {
  const navigate = useNavigate();
  const { resident } = useGuest();
  // ?activity=&county= prefill — used by NextStepsPanel's "Start a Circle"
  // after a game. Read once as the initial state and doesn't mark the form
  // dirty (nothing the visitor typed would be lost).
  const [searchParams] = useSearchParams();
  const [form, setFormRaw] = useState<Form>({ ...EMPTY_FORM, activityLabel: searchParams.get("activity") ?? "", county: searchParams.get("county") ?? "" });
  const [dirty, setDirty] = useState(false);
  // Category kept beside `form` (not in it) because the cover-photo save
  // below resends `form` and must leave the category untouched.
  const [category, setCategoryRaw] = useState<CategoryValue | null>(null);
  const [categoryLabel, setCategoryLabel] = useState<string | null>(null);
  const [tags, setTagsRaw] = useState<string[]>([]);
  const touch = () => setDirty(true);
  const setForm = (updater: SetStateAction<Form>) => {
    setFormRaw(updater);
    touch();
  };
  const set = (key: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const { requestNavigation, dialog: unsavedDialog } = useUnsavedChangesGuard(dirty);
  const errors = useFormErrors();
  const draft = useFormDraft<Draft>({
    key: resident ? `circle-start:${resident.id}` : null,
    value: { form, category, categoryLabel, tags },
    active: dirty,
    onRestore: (d) => {
      setFormRaw(d.form);
      setCategoryRaw(d.category);
      setCategoryLabel(d.categoryLabel);
      setTagsRaw(d.tags);
      setDirty(true);
    },
  });

  const [creating, setCreating] = useState(false);
  const inFlight = useRef(false);
  // Success state with the real next actions, instead of dropping the
  // organiser onto an empty page (Circle Experience Polish, Changeset 3A).
  const [created, setCreated] = useState<{ id: string; slug: string | null } | null>(null);
  const [createdImageUrl, setCreatedImageUrl] = useState<string | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (inFlight.current) return;
    if (!form.name.trim()) {
      errors.fail([{ field: "name", fieldId: "circle-start-name", message: "Give your Circle a name" }]);
      return;
    }
    inFlight.current = true;
    setCreating(true);
    errors.clear();
    try {
      const result = await createCircle({ ...form, name: form.name.trim(), categoryId: category?.categoryId ?? "", subcategoryId: category?.subcategoryId ?? null, tags });
      setDirty(false);
      draft.clear();
      setCreated({ id: result.id, slug: result.slug });
      window.scrollTo({ top: 0 });
    } catch (e) {
      const field = e instanceof ApiError && typeof e.body.field === "string" ? e.body.field : null;
      const fieldId = field === "categoryId" ? "circle-start-category" : field === "name" ? "circle-start-name" : undefined;
      errors.fail([{ field: field ?? "form", fieldId, message: e instanceof Error ? e.message : "We couldn't create your Circle. Check your connection and try again." }]);
    } finally {
      inFlight.current = false;
      setCreating(false);
    }
  };

  if (created) {
    const ref = created.slug ?? created.id;
    return (
      <div className="fade-panel">
        <section className="section-pad" style={{ maxWidth: 620, margin: "0 auto", padding: "70px 24px 90px", textAlign: "center" }}>
          <div style={{ color: colors.greenText, marginBottom: 14 }}>
            <CheckCircleIcon size={36} />
          </div>
          <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(32px, 3.8vw, 52px)", margin: "0 0 8px", letterSpacing: 0 }}>Your Circle is live.</h1>
          <p style={{ margin: "0 0 28px", fontSize: 15, color: colors.mutedLight }}>{form.name || "Your Circle"} is ready. Add a cover photo, then get things moving.</p>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
            <SingleImageUpload
              value={createdImageUrl}
              onChange={async (url) => {
                setCoverError(null);
                setCreatedImageUrl(url);
                try {
                  await updateCircle(created.id, { ...form, imageUrl: url ?? "" });
                } catch {
                  setCoverError("The photo uploaded but we couldn't attach it. Add it again from Manage → Settings.");
                }
              }}
              mediaEntityType="circle-cover"
              mediaEntityId={created.id}
            />
          </div>
          {coverError && (
            <p role="alert" style={{ color: colors.danger, fontSize: 13, margin: "0 0 12px" }}>
              {coverError}
            </p>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", margin: "16px 0 14px" }}>
            <Button onClick={() => navigate(`/circles/${ref}`)}>View Circle</Button>
            <Button variant="ghost" onClick={() => navigate(`/manage/circles/${ref}?tab=members`)}>Invite people</Button>
            <Button
              variant="ghost"
              onClick={() =>
                navigate(
                  `/games/host?activity=${encodeURIComponent(form.activityLabel)}&circleId=${created.id}${
                    category ? `&categoryId=${encodeURIComponent(category.categoryId)}${category.subcategoryId ? `&subcategoryId=${encodeURIComponent(category.subcategoryId)}` : ""}` : ""
                  }`
                )
              }
            >
              <PlusIcon size={14} /> Create first activity
            </Button>
          </div>
          <ShareButton entityType="circle" entityId={created.id} render={(onClick) => <button onClick={onClick} style={{ background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: colors.text, cursor: "pointer" }}>Share Circle</button>} />
        </section>
      </div>
    );
  }

  if (!resident) {
    return (
      <section className="section-pad" style={{ maxWidth: 900, margin: "0 auto", padding: "36px 24px 90px" }}>
        <BackLink onClick={() => navigate(-1)}>Back</BackLink>
        <PageTitle>Start a Circle</PageTitle>
        <Card style={{ background: colors.greenBg, border: `1px solid ${colors.green}`, marginTop: 20 }}>
          <button onClick={() => navigate(signInHref())} style={{ background: "none", border: "none", padding: 0, color: colors.greenText, fontWeight: 700, cursor: "pointer" }}>
            Sign in
          </button>{" "}
          to start a Circle of your own.
        </Card>
      </section>
    );
  }

  const ctl = errors.control;
  return (
    <div className="fade-panel">
      <section className="section-pad" style={{ maxWidth: 1200, margin: "0 auto", padding: "36px 24px 90px" }}>
        <BackLink onClick={() => requestNavigation(() => navigate(-1))}>Back</BackLink>
        <PageTitle>Start a Circle</PageTitle>
        <p style={{ margin: "6px 0 24px", fontSize: 15, color: colors.mutedLight, maxWidth: 620, lineHeight: 1.5 }}>
          You don't need everything planned. Start with an idea, find people who are interested, then make something happen together.
        </p>

        {draft.pending && <DraftBanner savedAt={draft.pending.savedAt} onRestore={draft.restore} onDiscard={draft.clear} />}

        <div className="ce-layout ce-layout--form">
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreate();
            }}
          >
            <FormErrorSummary errors={errors.errors} focusKey={errors.focusKey} />
            <RequiredNote />

            <section className="ce-form-section" aria-labelledby="ce-s1">
              <h2 id="ce-s1">
                <span className="ce-step">1</span> Basic information
              </h2>
              <p className="ce-section-hint">What your Circle is called and what it's about, so the right people find it.</p>
              <div className="ce-fields">
                <div className="ce-full">
                  <FieldLabel htmlFor="circle-start-name" required>
                    Name
                  </FieldLabel>
                  <input
                    {...ctl("circle-start-name")}
                    value={form.name}
                    onChange={set("name")}
                    placeholder="e.g. Clontarf Badminton Circle"
                    maxLength={255}
                    required
                    autoComplete="off"
                    style={inputStyle}
                  />
                  <FieldError fieldId="circle-start-name" message={errors.messageFor("circle-start-name")} />
                </div>
                <div className="ce-full">
                  <CategoryPicker
                    family="circle"
                    id="circle-start-category"
                    label="What's your Circle about?"
                    hint="So people looking for this can find it."
                    value={category}
                    error={errors.messageFor("circle-start-category")}
                    onChange={(next, picked) => {
                      setCategoryRaw(next);
                      setCategoryLabel(next ? picked?.label ?? categoryLabel : null);
                      touch();
                      errors.clearField("circle-start-category");
                      if (picked && !form.activityLabel.trim()) setForm((f) => ({ ...f, activityLabel: picked.label }));
                    }}
                  />
                </div>
                <div className="ce-full">
                  <FieldLabel htmlFor="circle-start-activity" optional>
                    Activity
                  </FieldLabel>
                  <input {...ctl("circle-start-activity")} value={form.activityLabel} onChange={set("activityLabel")} placeholder="e.g. Badminton" maxLength={255} style={inputStyle} />
                  <p className="ce-field-help">The main thing you'll do together. Used to suggest similar activities nearby.</p>
                </div>
              </div>
            </section>

            <section className="ce-form-section" aria-labelledby="ce-s2">
              <h2 id="ce-s2">
                <span className="ce-step">2</span> Location
              </h2>
              <p className="ce-section-hint">Roughly where you meet. Never an exact address — that goes on each activity.</p>
              <div className="ce-fields">
                <div>
                  <FieldLabel htmlFor="circle-start-area" optional>
                    Area
                  </FieldLabel>
                  <input {...ctl("circle-start-area")} value={form.area} onChange={set("area")} placeholder="e.g. Clontarf" maxLength={255} style={inputStyle} />
                </div>
                <div>
                  <FieldLabel htmlFor="circle-start-county" optional>
                    County
                  </FieldLabel>
                  <input {...ctl("circle-start-county")} value={form.county} onChange={set("county")} list="circle-start-counties" placeholder="e.g. Dublin" maxLength={255} autoComplete="off" style={inputStyle} />
                  <datalist id="circle-start-counties">
                    {COUNTIES.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
              </div>
            </section>

            <section className="ce-form-section" aria-labelledby="ce-s3">
              <h2 id="ce-s3">
                <span className="ce-step">3</span> Membership
              </h2>
              <p className="ce-section-hint">How people get in. You can change this later in Settings.</p>
              <fieldset className="ce-choice-list">
                <legend className="visually-hidden">How people join</legend>
                {JOIN_MODES.map((m) => (
                  <label key={m.value} className="ce-choice">
                    <input type="radio" name="circle-start-membership" value={m.value} checked={form.joinMode === m.value} onChange={() => setForm((f) => ({ ...f, joinMode: m.value }))} />
                    <div>
                      <strong>{m.title}</strong>
                      <span>{m.text}</span>
                    </div>
                  </label>
                ))}
              </fieldset>
            </section>

            <section className="ce-form-section" aria-labelledby="ce-s4">
              <h2 id="ce-s4">
                <span className="ce-step">4</span> Community details
              </h2>
              <p className="ce-section-hint">All optional. A few lines here help someone decide whether this is for them.</p>
              <div className="ce-fields">
                <div className="ce-full">
                  <FieldLabel htmlFor="circle-start-about" optional>
                    About
                  </FieldLabel>
                  <textarea {...ctl("circle-start-about")} value={form.about} onChange={set("about")} rows={3} placeholder="e.g. Friendly doubles on Tuesday evenings, all levels welcome." style={{ ...inputStyle, resize: "vertical" }} />
                </div>
                <div className="ce-full">
                  <TagPicker value={tags} onChange={(next) => (setTagsRaw(next), touch())} />
                </div>
                <div className="ce-full">
                  <FieldLabel htmlFor="circle-start-what-we-do" optional>
                    What we do
                  </FieldLabel>
                  <textarea {...ctl("circle-start-what-we-do")} value={form.whatWeDo} onChange={set("whatWeDo")} placeholder="e.g. Weekly sessions, occasional social meetups and the odd challenge." rows={2} style={{ ...inputStyle, resize: "vertical" }} />
                </div>
                <div className="ce-full">
                  <FieldLabel htmlFor="circle-start-who-can-join" optional>
                    Who can join
                  </FieldLabel>
                  <textarea {...ctl("circle-start-who-can-join")} value={form.whoCanJoin} onChange={set("whoCanJoin")} placeholder="e.g. Anyone nearby who wants to give this a go — no experience needed." rows={2} style={{ ...inputStyle, resize: "vertical" }} />
                </div>
                <div className="ce-full">
                  <FieldLabel htmlFor="circle-start-our-values" optional>
                    Our values
                  </FieldLabel>
                  <textarea {...ctl("circle-start-our-values")} value={form.values} onChange={set("values")} placeholder="e.g. Respect, encouragement, and showing up for each other." rows={2} style={{ ...inputStyle, resize: "vertical" }} />
                </div>
              </div>
            </section>

            <section className="ce-form-section" aria-labelledby="ce-s5">
              <h2 id="ce-s5">
                <span className="ce-step">5</span> Media and preview
              </h2>
              <p className="ce-section-hint">
                You'll add a cover photo on the next screen, straight after creating — it's stored with your Circle, so the Circle has to exist first. Check the preview, then create.
              </p>
              <div className="ce-form-actions">
                <Button type="submit" size="lg" disabled={creating}>
                  {creating ? "Creating…" : "Create Circle"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => requestNavigation(() => navigate(-1))}>
                  Cancel
                </Button>
              </div>
            </section>
          </form>

          <aside className="ce-aside" aria-label="Preview">
            <CirclePreview form={form} categoryLabel={category ? categoryLabel : null} tags={tags} />
          </aside>
        </div>
      </section>
      {unsavedDialog}
    </div>
  );
}

/** Built only from the form — what a visitor will see on the Circle card and
 * page. No member count or activities: a new Circle has neither. */
function CirclePreview({ form, categoryLabel, tags }: { form: Form; categoryLabel: string | null; tags: string[] }) {
  const mode = JOIN_MODES.find((m) => m.value === form.joinMode)!;
  const where = [form.area.trim(), form.county.trim()].filter(Boolean).join(", ");
  const details = [
    { label: "What we do", value: form.whatWeDo },
    { label: "Who can join", value: form.whoCanJoin },
    { label: "Our values", value: form.values },
  ].filter((d) => d.value.trim());
  return (
    <div>
      <p className="ce-preview-label">Live preview</p>
      <div className="ce-preview">
        <div className="ce-preview-cover">Cover photo — added after you create</div>
        <div className="ce-preview-body">
          {(categoryLabel || form.activityLabel.trim()) && (
            <div style={{ fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", color: colors.mutedLight, marginBottom: 6 }}>
              {[categoryLabel, form.activityLabel.trim() && form.activityLabel.trim() !== categoryLabel ? form.activityLabel.trim() : null].filter(Boolean).join(" · ")}
            </div>
          )}
          <h3 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 21, letterSpacing: 0, margin: "0 0 8px", overflowWrap: "anywhere" }}>
            {form.name.trim() || <span className="ce-preview-empty">Your Circle's name</span>}
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: colors.muted }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <PinIcon size={13} /> {where || <span className="ce-preview-empty">Add an area or county</span>}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <UsersIcon size={13} /> {mode.preview}
            </span>
          </div>
          {form.about.trim() ? (
            <p style={{ fontSize: 13.5, lineHeight: 1.55, margin: "12px 0 0", color: colors.textSoft, whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{form.about.trim()}</p>
          ) : (
            <p className="ce-preview-empty" style={{ fontSize: 13, margin: "12px 0 0" }}>
              A short description appears here.
            </p>
          )}
          {tags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
              {tags.map((t) => (
                <span key={t} className="ce-pill">
                  {DISCOVERY_TAG_LABELS[t as DiscoveryTag] ?? t}
                </span>
              ))}
            </div>
          )}
          {details.length > 0 && (
            <dl style={{ margin: "14px 0 0", display: "flex", flexDirection: "column", gap: 10 }}>
              {details.map((d) => (
                <div key={d.label}>
                  <dt style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: colors.mutedLight }}>{d.label}</dt>
                  <dd style={{ margin: "3px 0 0", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{d.value.trim()}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
      <p style={{ fontSize: 12, color: colors.mutedLight, margin: "10px 0 0", lineHeight: 1.5 }}>
        Members, activities and photos appear once people join and you start planning.
      </p>
    </div>
  );
}
