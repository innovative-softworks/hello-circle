import { ArrowDown, ArrowUp, FolderTree, ListChecks, Pencil, Plus, Tags } from "lucide-react";
import { useMemo, useState } from "react";
import {
  addCategoryAlias,
  archiveAdminCategory,
  assignListingCategory,
  createAdminCategory,
  deleteAdminCategory,
  fetchAdminCategories,
  fetchAdminCategory,
  fetchUncategorisedListings,
  FAMILY_LABELS,
  mergeAdminCategory,
  removeCategoryAlias,
  reorderAdminCategories,
  reportListingCategory,
  restoreAdminCategory,
  updateAdminCategory,
  type AdminCategory,
  type AdminCategoryInput,
  type CategoryFamily,
  type TaxonomyListingType,
  FORM_TYPE_OPTIONS,
  acceptCategoryReview,
  fetchCategoryReviewQueue,
  type CategoryReviewItem,
  MODERATION_POLICY_LABELS,
  type CategoryModerationPolicy,
} from "../../api";
import { useRecordParam, useUrlParam } from "../../useUrlTab";
import { CategoryPicker, type CategoryValue } from "../categories/CategoryPicker";
import { useToast } from "../Toast";
import { ConfirmDialog } from "../ui";
import { ContextSection, CopyValue, DetailFacts, DetailSection, DetailStats } from "../workspace/DetailParts";
import { RecordState, RecordView } from "../workspace/RecordView";
import { useAdminCan } from "./adminPermissions";
import { AdminButton, AdminModal, Badge, Box, EmptyMessage, ErrorMessage, FormField, Loaded, OverflowMenu, Pager, SearchField, SelectField, Toolbar, errorMessage, statusLabel, formatDate, matches, useAdminData, usePaged } from "./adminUi";

// Admin → Categories (category system, approved 2026-10-22). Directory,
// record page (70/30), full-page create/edit, merge/archive dialogs and the
// Uncategorised review. Reading is open to every admin role; changes need
// taxonomy.manage (Super). Support can report a wrong classification, which
// lands in Reviews & reports.

const LISTING_TYPE_LABEL: Record<TaxonomyListingType, string> = {
  game: "Activity",
  experience: "Experience",
  program: "Programme",
  circle: "Circle",
  club: "Club",
  centre: "Venue",
};
const LISTING_TYPE_PLURAL: Record<TaxonomyListingType, string> = { game: "Activities", experience: "Experiences", program: "Programmes", circle: "Circles", club: "Clubs", centre: "Venues" };
const PUBLIC_PATH: Record<TaxonomyListingType, string> = { game: "/games", experience: "/experiences", program: "/programs", circle: "/circles", club: "/clubs", centre: "/centres" };
const FAMILIES = Object.keys(FAMILY_LABELS) as CategoryFamily[];

function familyFor(type: TaxonomyListingType, family?: CategoryFamily): CategoryFamily {
  if (family) return family;
  return ({ game: "activity", experience: "experience", program: "programme", circle: "circle", club: "club", centre: "venue" } as const)[type];
}

function StatusBadges({ c }: { c: Pick<AdminCategory, "active" | "discoverable" | "archived" | "featured"> }) {
  if (c.archived) return <Badge tone="outline">Archived</Badge>;
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      {c.active ? <Badge tone="good">Active</Badge> : <Badge tone="warn">Inactive</Badge>}
      {c.discoverable ? <Badge tone="neutral">Shown</Badge> : <Badge tone="outline">Hidden</Badge>}
      {c.featured && <Badge tone="neutral">Featured</Badge>}
    </span>
  );
}

type StatusFilter = "all" | "active" | "inactive" | "hidden" | "archived";
type UsageFilter = "all" | "used" | "unused";

export function AdminCategoriesPage() {
  const [record, openRecord, closeRecord] = useRecordParam();
  const dir = useAdminData(fetchAdminCategories);

  if (record === "uncategorised") return <UncategorisedView onBack={closeRecord} onChanged={dir.reload} />;
  if (record?.startsWith("category-new")) {
    const parentId = record.includes(":") ? record.slice(record.indexOf(":") + 1) : null;
    return <CategoryEditor key={record} mode="create" parentId={parentId} directory={dir.data?.categories ?? []} onDone={(id) => (dir.reload(), id ? openRecord(`category:${id}`) : closeRecord())} />;
  }
  if (record?.startsWith("category-edit:")) {
    const id = record.slice("category-edit:".length);
    return <CategoryEditor key={record} mode="edit" id={id} directory={dir.data?.categories ?? []} onDone={() => (dir.reload(), openRecord(`category:${id}`))} />;
  }
  if (record?.startsWith("category:")) {
    return <CategoryRecord key={record} id={record.slice("category:".length)} onBack={closeRecord} onOpen={(id) => openRecord(`category:${id}`)} onEdit={(id) => openRecord(`category-edit:${id}`)} onNewSub={(id) => openRecord(`category-new:${id}`)} onChanged={dir.reload} directory={dir.data?.categories ?? []} />;
  }
  return <CategoryDirectory dir={dir} onOpen={(id) => openRecord(`category:${id}`)} onNew={() => openRecord("category-new")} onUncategorised={() => openRecord("uncategorised")} />;
}

function CategoryDirectory({ dir, onOpen, onNew, onUncategorised }: { dir: ReturnType<typeof useAdminData<Awaited<ReturnType<typeof fetchAdminCategories>>>>; onOpen: (id: string) => void; onNew: () => void; onUncategorised: () => void }) {
  const can = useAdminCan();
  const canManage = can("taxonomy.manage");
  const toast = useToast();
  const [q, setQ] = useUrlParam<string>("q", "");
  const [family, setFamily] = useUrlParam<CategoryFamily | "all">("family", "all");
  const [status, setStatus] = useUrlParam<StatusFilter>("status", "all");
  const [usage, setUsage] = useUrlParam<UsageFilter>("usage", "all");
  const [moving, setMoving] = useState<string | null>(null);

  const all = dir.data?.categories ?? [];
  const rows = all.filter((c) => {
    if (!matches(q, c.name, c.slug, ...c.subcategories.map((s) => s.name))) return false;
    if (family !== "all" && !c.families.includes(family)) return false;
    if (status === "active" && (!c.active || c.archived)) return false;
    if (status === "inactive" && (c.active || c.archived)) return false;
    if (status === "hidden" && (c.discoverable || c.archived)) return false;
    if (status === "archived" && !c.archived) return false;
    if (status === "all" && c.archived) return false;
    if (usage === "used" && c.listingCount === 0) return false;
    if (usage === "unused" && c.listingCount > 0) return false;
    return true;
  });
  const paged = usePaged(rows, 30, `${q}|${family}|${status}|${usage}`);
  const uncategorisedTotal = dir.data ? Object.values(dir.data.uncategorised).reduce((a, n) => a + n, 0) : 0;
  const filtered = !!q || family !== "all" || status !== "all" || usage !== "all";

  // Moving one row swaps it with its neighbour among the (non-archived) top level.
  const move = async (id: string, dirn: -1 | 1) => {
    const order = all.filter((c) => !c.archived).map((c) => c.id);
    const i = order.indexOf(id);
    const j = i + dirn;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    setMoving(id);
    try {
      await reorderAdminCategories(null, [...order, ...all.filter((c) => c.archived).map((c) => c.id)]);
      dir.reload();
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't reorder"));
    } finally {
      setMoving(null);
    }
  };

  return (
    <div className="adm-stack">
      <ReviewQueue canManage={canManage} />
      <Box
        icon={ListChecks}
        title="Uncategorised listings"
        subtitle="Listings without a category still show everywhere, just not under a category filter. Ambiguous ones are never assigned automatically."
        actions={<AdminButton size="sm" onClick={onUncategorised}>Review {dir.data ? `(${uncategorisedTotal})` : ""}</AdminButton>}
      >
        {dir.data ? (
          <DetailFacts rows={(Object.keys(LISTING_TYPE_LABEL) as TaxonomyListingType[]).map((t) => [LISTING_TYPE_PLURAL[t], String(dir.data!.uncategorised[t] ?? 0)])} />
        ) : dir.error ? null : (
          <p className="adm-note" role="status">Loading…</p>
        )}
      </Box>
      <Box
        icon={FolderTree}
        title="Categories"
        subtitle="Listing type → category → subcategory. Identifiers never change; names can. Only categories with live listings appear to the public."
        flush
        actions={canManage ? <AdminButton size="sm" variant="primary" onClick={onNew}><Plus size={15} strokeWidth={2} aria-hidden="true" /> New category</AdminButton> : undefined}
      >
        <Toolbar label="Filter categories">
          <SearchField label="Search categories" value={q} onChange={setQ} placeholder="Category or subcategory" />
          <SelectField label="Listing type" value={family} onChange={setFamily} options={[{ value: "all", label: "All types" }, ...FAMILIES.map((f) => ({ value: f, label: FAMILY_LABELS[f] }))]} />
          <SelectField
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "Not archived" },
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
              { value: "hidden", label: "Hidden from discovery" },
              { value: "archived", label: "Archived" },
            ]}
          />
          <SelectField label="Usage" value={usage} onChange={setUsage} options={[{ value: "all", label: "Any usage" }, { value: "used", label: "Has listings" }, { value: "unused", label: "No listings" }]} />
        </Toolbar>
        <Loaded state={dir}>
          {() =>
            rows.length === 0 ? (
              <EmptyMessage icon={<FolderTree size={22} strokeWidth={1.9} aria-hidden="true" />} title={filtered ? "No categories match these filters" : "No categories yet"} />
            ) : (
              <>
                <div className="adm-table-wrap">
                  <table className="adm-table adm-table--stack">
                    <thead>
                      <tr>
                        <th scope="col">Category</th>
                        <th scope="col">Listing types</th>
                        <th scope="col">Subcategories</th>
                        <th scope="col">Listings</th>
                        <th scope="col">Status</th>
                        <th scope="col">Order</th>
                        <th scope="col">Updated</th>
                        <th scope="col"><span className="adm-visually-hidden">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {paged.slice.map((c) => {
                        const topIndex = all.filter((x) => !x.archived).findIndex((x) => x.id === c.id);
                        return (
                          <tr key={c.id}>
                            <td data-label="Category">
                              <div className="adm-cell-title">{c.name}</div>
                              <div className="adm-cell-sub">{c.slug}</div>
                            </td>
                            <td data-label="Listing types">{c.families.map((f) => FAMILY_LABELS[f]).join(", ")}</td>
                            <td data-label="Subcategories">{c.subcategories.filter((s) => !s.archived).length}</td>
                            <td data-label="Listings">{c.listingCount}</td>
                            <td data-label="Status"><StatusBadges c={c} /></td>
                            <td data-label="Order">
                              {canManage && !c.archived && !filtered ? (
                                <span style={{ display: "inline-flex", gap: 4 }}>
                                  <AdminButton size="sm" variant="quiet" aria-label={`Move ${c.name} up`} disabled={topIndex <= 0 || !!moving} onClick={() => move(c.id, -1)}>
                                    <ArrowUp size={14} strokeWidth={2} aria-hidden="true" />
                                  </AdminButton>
                                  <AdminButton size="sm" variant="quiet" aria-label={`Move ${c.name} down`} disabled={topIndex >= all.filter((x) => !x.archived).length - 1 || !!moving} onClick={() => move(c.id, 1)}>
                                    <ArrowDown size={14} strokeWidth={2} aria-hidden="true" />
                                  </AdminButton>
                                </span>
                              ) : (
                                <span className="adm-note">{topIndex >= 0 ? topIndex + 1 : "—"}</span>
                              )}
                            </td>
                            <td data-label="Updated">{formatDate(c.updatedAt)}</td>
                            <td data-label="Actions">
                              <AdminButton size="sm" onClick={() => onOpen(c.id)} aria-label={`Open ${c.name}`}>Open</AdminButton>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Pager {...paged} noun="categories" />
                {canManage && filtered && <p className="adm-note" style={{ padding: "0 16px 12px" }}>Clear the filters to reorder.</p>}
              </>
            )
          }
        </Loaded>
      </Box>
    </div>
  );
}

// --- record page -------------------------------------------------------------------

function CategoryRecord({
  id,
  onBack,
  onOpen,
  onEdit,
  onNewSub,
  onChanged,
  directory,
}: {
  id: string;
  onBack: () => void;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onNewSub: (id: string) => void;
  onChanged: () => void;
  directory: (AdminCategory & { subcategories: AdminCategory[] })[];
}) {
  const state = useAdminData(() => fetchAdminCategory(id), [id]);
  const can = useAdminCan();
  const canManage = can("taxonomy.manage");
  const toast = useToast();
  const [dialog, setDialog] = useState<"merge" | "archive" | "delete" | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");
  const [alias, setAlias] = useState("");
  const [assigning, setAssigning] = useState<{ type: TaxonomyListingType; id: string; title: string } | null>(null);
  const [reporting, setReporting] = useState<{ type: TaxonomyListingType; id: string; title: string } | null>(null);
  const [busySub, setBusySub] = useState<string | null>(null);

  if (state.error && !state.data) return <RecordState state="error" backLabel="Categories" onBack={onBack} onRetry={state.reload} />;
  if (!state.data) return <RecordState state="loading" backLabel="Categories" onBack={onBack} />;
  const { category: c, parent, subcategories, aliases, listings, history } = state.data;
  const reload = () => {
    state.reload();
    onChanged();
  };

  const toggle = async (field: "active" | "discoverable" | "featured") => {
    try {
      await updateAdminCategory(c.id, { [field]: !c[field], rowVersion: c.rowVersion });
      toast.success(`${c.name} updated`);
      reload();
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't update"));
      state.reload();
    }
  };

  const mergeTargets = c.parentId
    ? directory.flatMap((d) => d.subcategories.filter((s) => !s.archived && s.id !== c.id).map((s) => ({ id: s.id, label: `${s.name} — ${d.name}` })))
    : directory.filter((d) => !d.archived && d.id !== c.id).map((d) => ({ id: d.id, label: d.name }));

  const moveSub = async (subId: string, dirn: -1 | 1) => {
    const order = subcategories.map((s) => s.id);
    const i = order.indexOf(subId);
    const j = i + dirn;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    setBusySub(subId);
    try {
      await reorderAdminCategories(c.id, order);
      reload();
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't reorder"));
    } finally {
      setBusySub(null);
    }
  };

  const menu = canManage
    ? [
        ...(!c.parentId && !c.archived ? [{ label: "Add a subcategory", onSelect: () => onNewSub(c.id) }] : []),
        ...(!c.archived ? [{ label: "Merge into another…", onSelect: () => setDialog("merge") }] : []),
        ...(!c.archived ? [{ label: "Archive…", danger: true, onSelect: () => setDialog("archive") }] : [{ label: "Restore", onSelect: () => restoreAdminCategory(c.id).then(() => (toast.success(`${c.name} restored (inactive and hidden)`), reload())).catch((e) => toast.error(errorMessage(e, "Couldn't restore"))) }]),
        ...(c.listingCount === 0 && subcategories.length === 0 ? [{ label: "Delete…", danger: true, onSelect: () => setDialog("delete") }] : []),
      ]
    : [];

  return (
    <RecordView
      title={c.name}
      reference={parent ? `Subcategory of ${parent.name} · ${c.slug}` : `Category · ${c.slug}`}
      backLabel={parent ? parent.name : "Categories"}
      onBack={parent ? () => onOpen(parent.id) : onBack}
      statuses={<StatusBadges c={c} />}
      actions={
        <>
          {canManage && !c.archived && (
            <AdminButton onClick={() => onEdit(c.id)}>
              <Pencil size={15} strokeWidth={2} aria-hidden="true" /> Edit
            </AdminButton>
          )}
          {canManage && !c.archived && <AdminButton onClick={() => toggle("active")}>{c.active ? "Deactivate" : "Activate"}</AdminButton>}
          {canManage && !c.archived && <AdminButton onClick={() => toggle("discoverable")}>{c.discoverable ? "Hide from discovery" : "Show in discovery"}</AdminButton>}
          <OverflowMenu label={`More actions for ${c.name}`} actions={menu} />
        </>
      }
      stats={
        <DetailStats
          items={[
            { label: "Listings", value: String(c.listingCount), sub: "Any status" },
            { label: "Subcategories", value: String(subcategories.filter((s) => !s.archived).length) },
            { label: "Aliases", value: String(aliases.length), sub: "Search words and old links" },
            { label: "Listing types", value: String(c.families.length), sub: c.families.map((f) => FAMILY_LABELS[f]).join(", ") },
          ]}
        />
      }
      asideLabel="Identifiers, aliases and dates"
      aside={
        <>
          <ContextSection title="Identifiers">
            <DetailFacts
              columns={1}
              rows={[
                ["Identifier", <CopyValue value={c.id} label="category identifier" />],
                ["Slug", c.slug],
                ["Created", formatDate(c.createdAt, true)],
                ["Updated", formatDate(c.updatedAt, true)],
                ["Archived", c.archivedAt ? formatDate(c.archivedAt, true) : null],
              ]}
            />
          </ContextSection>
          <ContextSection title="Aliases" icon={Tags}>
            {aliases.length === 0 ? (
              <p className="adm-note">No aliases.</p>
            ) : (
              <ul className="wd-rows">
                {aliases.map((a) => (
                  <li key={a.alias}>
                    <div className="wd-rows-main">
                      <span className="wd-ctx-name">{a.alias}</span>
                      <span className="wd-ctx-sub">{a.source === "merge" ? "Merged category (keeps old links working)" : a.source === "slug" ? "Name or identifier" : a.needsReview ? "Search only, never auto-assigned" : "Synonym"}</span>
                    </div>
                    {canManage && a.source !== "merge" && (
                      <AdminButton size="sm" variant="quiet" aria-label={`Remove alias ${a.alias}`} onClick={() => removeCategoryAlias(c.id, a.alias).then(reload).catch((e) => toast.error(errorMessage(e, "Couldn't remove")))}>
                        Remove
                      </AdminButton>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canManage && !c.archived && (
              <form
                style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "flex-end" }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!alias.trim()) return;
                  addCategoryAlias(c.id, alias)
                    .then(() => {
                      setAlias("");
                      reload();
                    })
                    .catch((err) => toast.error(errorMessage(err, "Couldn't add the alias")));
                }}
              >
                <FormField label="Add an alias" style={{ flex: 1 }}>
                  {(p) => <input {...p} className="adm-input" value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="e.g. ping pong" />}
                </FormField>
                <AdminButton type="submit" size="sm">Add</AdminButton>
              </form>
            )}
          </ContextSection>
        </>
      }
    >
      {c.archived && <div className="adm-callout" role="status">Archived: it can't be chosen for new listings and isn't shown publicly. Listings that already use it keep it until they're re-categorised.</div>}
      <DetailSection title="Overview">
        <DetailFacts
          rows={[
            ["Description", c.description || null],
            ["Listing types", c.families.map((f) => FAMILY_LABELS[f]).join(", ")],
            ["Icon", c.icon || null],
            ["Cover image", c.imageUrl ? <a href={c.imageUrl} target="_blank" rel="noreferrer">View image</a> : null],
            ["Selectable for new listings", c.active && !c.archived ? "Yes" : "No"],
            ["Shown in public discovery", c.discoverable && !c.archived ? "Yes, when it has live listings" : "No"],
            ...(!c.parentId
              ? ([
                  ["Review rule", MODERATION_POLICY_LABELS[c.moderationPolicy ?? "standard"]],
                  ["Suggested registration form", FORM_TYPE_OPTIONS.find((f) => f.key === c.suggestedForm)?.label ?? null],
                ] as [string, string | null][])
              : []),
          ]}
        />
      </DetailSection>
      {!c.parentId && (
        <DetailSection title={`Subcategories (${subcategories.length})`} action={canManage && !c.archived ? <AdminButton size="sm" onClick={() => onNewSub(c.id)}><Plus size={14} strokeWidth={2} aria-hidden="true" /> Add</AdminButton> : undefined}>
          {subcategories.length === 0 ? (
            <p className="adm-note">No subcategories.</p>
          ) : (
            <ul className="wd-rows">
              {subcategories.map((s, i) => (
                <li key={s.id}>
                  <div className="wd-rows-main">
                    <span className="wd-ctx-name">{s.name}</span>
                    <span className="wd-ctx-sub">
                      {s.slug} · {s.listingCount} {s.listingCount === 1 ? "listing" : "listings"}
                    </span>
                  </div>
                  <StatusBadges c={s} />
                  {canManage && !s.archived && (
                    <span style={{ display: "inline-flex", gap: 4 }}>
                      <AdminButton size="sm" variant="quiet" aria-label={`Move ${s.name} up`} disabled={i === 0 || !!busySub} onClick={() => moveSub(s.id, -1)}>
                        <ArrowUp size={14} strokeWidth={2} aria-hidden="true" />
                      </AdminButton>
                      <AdminButton size="sm" variant="quiet" aria-label={`Move ${s.name} down`} disabled={i === subcategories.length - 1 || !!busySub} onClick={() => moveSub(s.id, 1)}>
                        <ArrowDown size={14} strokeWidth={2} aria-hidden="true" />
                      </AdminButton>
                    </span>
                  )}
                  <AdminButton size="sm" onClick={() => onOpen(s.id)} aria-label={`Open ${s.name}`}>Open</AdminButton>
                </li>
              ))}
            </ul>
          )}
        </DetailSection>
      )}
      <DetailSection title={`Listings using this ${c.parentId ? "subcategory" : "category"} (${listings.length})`} note="Every status, including drafts and pending listings.">
        {listings.length === 0 ? (
          <p className="adm-note">No listings yet.</p>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table adm-table--stack">
              <thead>
                <tr>
                  <th scope="col">Listing</th>
                  <th scope="col">Type</th>
                  {!c.parentId && <th scope="col">Subcategory</th>}
                  <th scope="col">Assigned</th>
                  <th scope="col"><span className="adm-visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {listings.map((l) => (
                  <tr key={`${l.listingType}:${l.listingId}`}>
                    <td data-label="Listing">
                      <div className="adm-cell-title">{l.title}</div>
                      {l.status && <div className="adm-cell-sub">{statusLabel(l.status)}</div>}
                    </td>
                    <td data-label="Type">{LISTING_TYPE_LABEL[l.listingType]}</td>
                    {!c.parentId && <td data-label="Subcategory">{l.subcategoryName ?? <span className="adm-note">None</span>}</td>}
                    <td data-label="Assigned">
                      {l.assignedBy === "backfill" ? "Matched automatically" : `By ${l.assignedBy}`}
                      <div className="adm-cell-sub">{formatDate(l.assignedAt)}</div>
                    </td>
                    <td data-label="Actions">
                      <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                        <a className="adm-btn adm-btn--sm adm-btn--quiet" href={`${PUBLIC_PATH[l.listingType]}/${l.listingId}`} target="_blank" rel="noreferrer">View</a>
                        {canManage ? (
                          <AdminButton size="sm" onClick={() => setAssigning({ type: l.listingType, id: l.listingId, title: l.title })}>Change</AdminButton>
                        ) : (
                          <AdminButton size="sm" onClick={() => setReporting({ type: l.listingType, id: l.listingId, title: l.title })}>Report wrong category</AdminButton>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DetailSection>
      <DetailSection title="Discovery and SEO">
        <DetailFacts
          rows={[
            ["Featured", c.featured ? "Yes — shown even before it has live listings" : "No"],
            ["Sort order", String(c.sortOrder)],
            ["SEO title", c.seoTitle || null],
            ["SEO description", c.seoDescription || null],
          ]}
        />
        {canManage && !c.archived && (
          <div style={{ marginTop: 10 }}>
            <AdminButton size="sm" onClick={() => toggle("featured")}>{c.featured ? "Stop featuring" : "Feature it"}</AdminButton>
          </div>
        )}
      </DetailSection>
      <DetailSection title="Change history">
        {history.length === 0 ? (
          <p className="adm-note">No changes recorded since the category system was installed.</p>
        ) : (
          <ul className="wd-rows">
            {history.map((h) => (
              <li key={h.id}>
                <div className="wd-rows-main">
                  <span className="wd-ctx-name">{HISTORY_LABEL[h.action] ?? h.action}</span>
                  <span className="wd-ctx-sub">
                    {h.actorName ?? "System"} · {formatDate(h.createdAt, true)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DetailSection>

      <ConfirmDialog
        open={dialog === "merge"}
        title={`Merge ${c.name}?`}
        tone="danger"
        confirmLabel="Merge"
        confirmDisabled={!mergeTarget}
        message={`${c.listingCount} ${c.listingCount === 1 ? "listing moves" : "listings move"} to the category you choose${!c.parentId && subcategories.length ? `, along with ${subcategories.length} subcategories` : ""}. "${c.slug}" keeps working as a link to it. ${c.name} is then archived. This can't be undone.`}
        onCancel={() => setDialog(null)}
        onConfirm={async () => {
          const res = await mergeAdminCategory(c.id, mergeTarget);
          toast.success(`Merged — ${res.listingsMoved} ${res.listingsMoved === 1 ? "listing" : "listings"} moved`);
          setDialog(null);
          onChanged();
          onOpen(res.targetId);
        }}
      >
        <div className="adm-field" style={{ marginTop: 10 }}>
          <label htmlFor="merge-target">Merge into</label>
          <select id="merge-target" className="adm-select" value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
            <option value="">Choose…</option>
            {mergeTargets.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "archive"}
        title={`Archive ${c.name}?`}
        tone="danger"
        confirmLabel="Archive"
        message={`It stops being selectable and disappears from public discovery${!c.parentId && subcategories.length ? `, together with its ${subcategories.length} subcategories` : ""}. The ${c.listingCount} ${c.listingCount === 1 ? "listing that uses it keeps" : "listings that use it keep"} it until re-categorised.`}
        onCancel={() => setDialog(null)}
        onConfirm={async () => {
          await archiveAdminCategory(c.id);
          toast.success(`${c.name} archived`);
          setDialog(null);
          reload();
        }}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        title={`Delete ${c.name}?`}
        tone="danger"
        confirmLabel="Delete"
        message="No listing uses it, so it can be removed completely. Its aliases are removed too."
        onCancel={() => setDialog(null)}
        onConfirm={async () => {
          await deleteAdminCategory(c.id);
          toast.success(`${c.name} deleted`);
          setDialog(null);
          onChanged();
          if (parent) onOpen(parent.id);
          else onBack();
        }}
      />
      {assigning && <AssignDialog listing={assigning} onClose={() => setAssigning(null)} onSaved={reload} />}
      {reporting && <ReportDialog listing={reporting} onClose={() => setReporting(null)} />}
    </RecordView>
  );
}

const HISTORY_LABEL: Record<string, string> = {
  "taxonomy.created": "Created",
  "taxonomy.updated": "Edited",
  "taxonomy.reordered": "Reordered",
  "taxonomy.archived": "Archived",
  "taxonomy.restored": "Restored",
  "taxonomy.merged": "Merged into another category",
  "taxonomy.merged_in": "Another category was merged in",
  "taxonomy.deleted": "Deleted",
  "taxonomy.alias_added": "Alias added",
  "taxonomy.alias_removed": "Alias removed",
};

// --- create / edit (full page) ---------------------------------------------------------

function CategoryEditor({
  mode,
  id,
  parentId,
  directory,
  onDone,
}: {
  mode: "create" | "edit";
  id?: string;
  parentId?: string | null;
  directory: (AdminCategory & { subcategories: AdminCategory[] })[];
  onDone: (id?: string) => void;
}) {
  const existing = useAdminData(() => (mode === "edit" && id ? fetchAdminCategory(id) : Promise.resolve(null)), [mode, id]);
  const toast = useToast();
  const can = useAdminCan();
  const [draft, setDraft] = useState<AdminCategoryInput | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const parent = useMemo(() => {
    const pid = mode === "edit" ? existing.data?.category.parentId : parentId;
    return pid ? directory.find((d) => d.id === pid) ?? existing.data?.parent ?? null : null;
  }, [mode, parentId, directory, existing.data]);

  // An editor whose record failed to load never renders a saveable blank form.
  if (mode === "edit" && existing.error && !existing.data) return <RecordState state="error" backLabel="Category" onBack={() => onDone(id)} onRetry={existing.reload} />;
  if (mode === "edit" && !existing.data) return <RecordState state="loading" backLabel="Category" onBack={() => onDone(id)} />;
  if (!can("taxonomy.manage")) return <RecordState state="error" backLabel="Categories" onBack={() => onDone(id)} message="Changing categories is limited to super admins." />;

  const base: AdminCategoryInput =
    mode === "edit" && existing.data
      ? {
          name: existing.data.category.name,
          description: existing.data.category.description,
          families: existing.data.category.families,
          icon: existing.data.category.icon,
          imageUrl: existing.data.category.imageUrl,
          sortOrder: existing.data.category.sortOrder,
          active: existing.data.category.active,
          discoverable: existing.data.category.discoverable,
          featured: existing.data.category.featured,
          seoTitle: existing.data.category.seoTitle,
          seoDescription: existing.data.category.seoDescription,
          moderationPolicy: existing.data.category.moderationPolicy,
          suggestedForm: existing.data.category.suggestedForm,
        }
      : { name: "", id: "", description: "", families: parent ? parent.families : [], active: true, discoverable: true, featured: false, moderationPolicy: "standard" as const, suggestedForm: null };
  const form = draft ?? base;
  const set = (patch: Partial<AdminCategoryInput>) => {
    setDraft({ ...form, ...patch });
    setErrors({});
  };
  const title = mode === "edit" ? `Edit ${existing.data!.category.name}` : parent ? `New subcategory of ${parent.name}` : "New category";

  const save = async () => {
    const e: Record<string, string> = {};
    if (!form.name?.trim()) e.name = "Enter a name.";
    if (!parent && (!form.families || form.families.length === 0)) e.families = "Choose at least one listing type.";
    if (mode === "create" && form.id && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.id)) e.id = "Use lowercase letters, numbers and hyphens.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    setFormError(null);
    try {
      if (mode === "create") {
        const created = await createAdminCategory({ ...form, id: form.id?.trim() || undefined, parentId: parent?.id ?? null, families: parent ? undefined : form.families });
        toast.success(`${created.name} created`);
        onDone(created.id);
      } else {
        await updateAdminCategory(id!, { ...form, families: parent ? undefined : form.families, rowVersion: existing.data!.category.rowVersion });
        toast.success("Saved");
        onDone(id);
      }
    } catch (err) {
      const body = (err as { body?: { field?: string; error?: string } }).body;
      if (body?.field) setErrors({ [body.field]: body.error ?? "Check this field." });
      setFormError(errorMessage(err, "Couldn't save"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <RecordView title={title} backLabel={mode === "edit" ? existing.data!.category.name : parent ? parent.name : "Categories"} onBack={() => onDone(mode === "edit" ? id : parent?.id)}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        style={{ display: "grid", gap: 16, maxWidth: 720 }}
      >
        {formError && (
          <div className="adm-callout" role="alert" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
            {formError}
          </div>
        )}
        <DetailSection title="Basics">
          <div style={{ display: "grid", gap: 14 }}>
            <FormField label="Name" required error={errors.name}>
              {(p) => <input {...p} className="adm-input" value={form.name ?? ""} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Racket sports" />}
            </FormField>
            {mode === "create" ? (
              <FormField label="Identifier (optional)" error={errors.id} hint="Also the URL slug. Lowercase and hyphens; it can never change once saved. Left empty, it's made from the name.">
                {(p) => <input {...p} className="adm-input" value={form.id ?? ""} onChange={(e) => set({ id: e.target.value.toLowerCase() })} placeholder="e.g. racket-sports" />}
              </FormField>
            ) : (
              <DetailFacts rows={[["Identifier and slug", existing.data!.category.slug]]} />
            )}
            <FormField label="Description (optional)">
              {(p) => <textarea {...p} className="adm-input" rows={2} value={form.description ?? ""} onChange={(e) => set({ description: e.target.value })} style={{ resize: "vertical" }} />}
            </FormField>
            {parent ? (
              <DetailFacts rows={[["Listing types", `${parent.families.map((f) => FAMILY_LABELS[f]).join(", ")} (from ${parent.name})`]]} />
            ) : (
              <fieldset style={{ border: 0, margin: 0, padding: 0 }} aria-describedby={errors.families ? "families-err" : undefined}>
                <legend className="adm-section-label" style={{ marginTop: 0 }}>
                  Listing types <span className="adm-req" aria-hidden="true">*</span>
                </legend>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  {FAMILIES.map((f) => (
                    <label key={f} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13.5, cursor: "pointer", minHeight: 32 }}>
                      <input
                        type="checkbox"
                        checked={(form.families ?? []).includes(f)}
                        onChange={(e) => set({ families: e.target.checked ? [...(form.families ?? []), f] : (form.families ?? []).filter((x) => x !== f) })}
                        style={{ accentColor: "var(--color-green)", width: 16, height: 16 }}
                      />
                      {FAMILY_LABELS[f]}
                    </label>
                  ))}
                </div>
                {errors.families && (
                  <span id="families-err" className="adm-field-error" role="alert">
                    {errors.families}
                  </span>
                )}
              </fieldset>
            )}
          </div>
        </DetailSection>
        <DetailSection title="Display">
          <div style={{ display: "grid", gap: 14 }}>
            <FormField label="Icon (optional)" hint="A Lucide icon name, e.g. Mountain.">
              {(p) => <input {...p} className="adm-input" value={form.icon ?? ""} onChange={(e) => set({ icon: e.target.value })} />}
            </FormField>
            <FormField label="Cover image URL (optional)">
              {(p) => <input {...p} className="adm-input" value={form.imageUrl ?? ""} onChange={(e) => set({ imageUrl: e.target.value })} />}
            </FormField>
            {mode === "edit" && (
              <FormField label="Sort order">
                {(p) => <input {...p} type="number" className="adm-input" value={form.sortOrder ?? 0} onChange={(e) => set({ sortOrder: Number(e.target.value) })} style={{ maxWidth: 140 }} />}
              </FormField>
            )}
            {(
              [
                ["active", "Selectable for new listings"],
                ["discoverable", "Shown in public discovery when it has live listings"],
                ["featured", "Featured — show it even before it has listings"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, cursor: "pointer", minHeight: 32 }}>
                <input type="checkbox" checked={!!form[key]} onChange={(e) => set({ [key]: e.target.checked })} style={{ accentColor: "var(--color-green)", width: 16, height: 16 }} />
                {label}
              </label>
            ))}
          </div>
        </DetailSection>
        {!parent && (
          <DetailSection title="Governance" note="Who may use this category and how it's reviewed. Listings that already use it are never changed by these settings.">
            <div style={{ display: "grid", gap: 14 }}>
              <FormField label="Review rule">
                {(p) => (
                  <select {...p} className="adm-select" value={form.moderationPolicy ?? "standard"} onChange={(e) => set({ moderationPolicy: e.target.value as CategoryModerationPolicy })}>
                    {(Object.keys(MODERATION_POLICY_LABELS) as CategoryModerationPolicy[]).map((k) => <option key={k} value={k}>{MODERATION_POLICY_LABELS[k]}</option>)}
                  </select>
                )}
              </FormField>
              <FormField label="Suggested registration form (optional)" hint="Offered first when a partner sets up registration for a listing in this category.">
                {(p) => (
                  <select {...p} className="adm-select" value={form.suggestedForm ?? ""} onChange={(e) => set({ suggestedForm: e.target.value || null })}>
                    <option value="">None</option>
                    {FORM_TYPE_OPTIONS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                )}
              </FormField>
            </div>
          </DetailSection>
        )}
        <DetailSection title="SEO">
          <div style={{ display: "grid", gap: 14 }}>
            <FormField label="SEO title (optional)" hint="Up to 120 characters. Defaults to the name.">
              {(p) => <input {...p} className="adm-input" maxLength={120} value={form.seoTitle ?? ""} onChange={(e) => set({ seoTitle: e.target.value })} />}
            </FormField>
            <FormField label="SEO description (optional)" hint="Up to 300 characters.">
              {(p) => <textarea {...p} className="adm-input" rows={2} maxLength={300} value={form.seoDescription ?? ""} onChange={(e) => set({ seoDescription: e.target.value })} style={{ resize: "vertical" }} />}
            </FormField>
          </div>
        </DetailSection>
        <div style={{ display: "flex", gap: 10 }}>
          <AdminButton type="submit" variant="primary" disabled={saving}>
            {saving ? "Saving…" : mode === "create" ? "Create" : "Save changes"}
          </AdminButton>
          <AdminButton variant="quiet" onClick={() => onDone(mode === "edit" ? id : parent?.id)}>Cancel</AdminButton>
        </div>
      </form>
    </RecordView>
  );
}

// --- category moves to review (Configuration Phase E) ---------------------------------------

function ReviewQueue({ canManage }: { canManage: boolean }) {
  const queue = useAdminData(fetchCategoryReviewQueue);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  if (!queue.data || queue.data.length === 0) return null;
  const accept = async (r: CategoryReviewItem) => {
    setBusy(r.listingId);
    try {
      await acceptCategoryReview(r.listingType, r.listingId);
      toast.success(`${r.title} stays in ${r.categoryName}`);
      queue.reload();
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't accept"));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Box icon={ListChecks} title={`Category moves to review (${queue.data.length})`} subtitle="Live listings a partner moved into a category whose review rule asks for a check. They stay live; accept the move, or re-categorise them from Uncategorised listings or the listing.">
      <ul className="adm-ov-list">
        {queue.data.map((r) => (
          <li key={`${r.listingType}:${r.listingId}`} className="adm-ov-row">
            <div className="adm-ov-main">
              <div className="adm-ov-title">{r.title}</div>
              <div className="adm-ov-detail">{LISTING_TYPE_LABEL[r.listingType]} · moved to {r.categoryName}{r.subcategoryName ? ` › ${r.subcategoryName}` : ""}</div>
            </div>
            {canManage && <AdminButton size="sm" disabled={busy === r.listingId} onClick={() => accept(r)} aria-label={`Accept ${r.title} in ${r.categoryName}`}>Accept</AdminButton>}
          </li>
        ))}
      </ul>
    </Box>
  );
}

// --- uncategorised review ------------------------------------------------------------------

function UncategorisedView({ onBack, onChanged }: { onBack: () => void; onChanged: () => void }) {
  const [type, setType] = useUrlParam<TaxonomyListingType | "all">("ltype", "all");
  const [confidence, setConfidence] = useUrlParam<"all" | "medium" | "low" | "none">("conf", "all");
  const state = useAdminData(() => fetchUncategorisedListings(type === "all" ? undefined : type), [type]);
  const can = useAdminCan();
  const canManage = can("taxonomy.manage");
  const toast = useToast();
  const [accepting, setAccepting] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<{ type: TaxonomyListingType; id: string; title: string; family: CategoryFamily; suggestion: string | null; suggestedSub: string | null } | null>(null);
  const [reporting, setReporting] = useState<{ type: TaxonomyListingType; id: string; title: string } | null>(null);
  const rows = (state.data ?? []).filter((r) => confidence === "all" || (r.confidence ?? "none") === confidence);
  const paged = usePaged(rows, 30, `${type}|${confidence}`);
  // Nothing is assigned without a deliberate action:
  //   medium → "Accept suggestion" opens a confirmation that names exactly
  //            what will be assigned;
  //   low    → no accept button; "Review…" opens the picker pre-filled, and
  //            only its Save assigns;
  //   none   → "Choose…" opens an empty picker.
  const [confirming, setConfirming] = useState<(typeof rows)[number] | null>(null);
  const accept = async (l: (typeof rows)[number]) => {
    if (!l.suggestion || l.confidence !== "medium") return false;
    setAccepting(`${l.listingType}:${l.listingId}`);
    try {
      await assignListingCategory(l.listingType, l.listingId, l.suggestion, l.suggestedSubcategory ?? null);
      toast.success(`${l.title}: ${l.suggestedSubcategoryName ?? l.suggestionName ?? "category"} assigned`);
      setConfirming(null);
      state.reload();
      onChanged();
    } finally {
      setAccepting(null);
    }
  };
  const openPicker = (l: (typeof rows)[number], prefill: boolean) =>
    setAssigning({ type: l.listingType, id: l.listingId, title: l.title, family: l.family, suggestion: prefill ? l.suggestion : null, suggestedSub: prefill ? l.suggestedSubcategory ?? null : null });

  return (
    <RecordView title="Uncategorised listings" reference="Listings without a category. Assign one, or leave it — they still appear everywhere except category filters." backLabel="Categories" onBack={onBack}>
      <Toolbar label="Filter uncategorised listings">
        <SelectField label="Type" value={type} onChange={setType} options={[{ value: "all", label: "All types" }, ...(Object.keys(LISTING_TYPE_LABEL) as TaxonomyListingType[]).map((t) => ({ value: t, label: LISTING_TYPE_PLURAL[t] }))]} />
        <SelectField
          label="Confidence"
          value={confidence}
          onChange={setConfidence}
          options={[
            { value: "all", label: "Any" },
            { value: "medium", label: "Medium — one suggestion" },
            { value: "low", label: "Low — check first" },
            { value: "none", label: "No suggestion" },
          ]}
        />
      </Toolbar>
      {state.error && !state.data ? (
        <ErrorMessage error={state.error} onRetry={state.reload} title="Couldn't load uncategorised listings" />
      ) : !state.data ? (
        <p className="adm-note" role="status">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyMessage icon={<ListChecks size={22} strokeWidth={1.9} aria-hidden="true" />} title="Everything here has a category" />
      ) : (
        <>
          <ul className="cat-review" aria-label="Uncategorised listings">
            {paged.slice.map((l) => {
              const conf = l.confidence ?? "none";
              return (
                <li key={`${l.listingType}:${l.listingId}`} className="cat-review-row">
                  <div className="cat-review-listing">
                    <div className="adm-cell-title">{l.title}</div>
                    <div className="adm-cell-sub">
                      {LISTING_TYPE_LABEL[l.listingType]}
                      {l.status ? ` · ${statusLabel(l.status)}` : ""}
                    </div>
                    <div className="adm-cell-sub cat-review-id">{l.listingId}</div>
                    {l.existingLabel && l.existingLabel !== l.title && <div className="adm-cell-sub">Read: {l.existingLabel}</div>}
                  </div>
                  <div className="cat-review-suggestion">
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {l.suggestionName ? (
                        <span className="adm-cell-title">
                          {l.suggestionName}
                          {l.suggestedSubcategoryName && <span style={{ fontWeight: 400 }}> › {l.suggestedSubcategoryName}</span>}
                        </span>
                      ) : (
                        <span className="adm-note">No suggestion</span>
                      )}
                      {conf === "medium" ? <Badge tone="good">Medium</Badge> : conf === "low" ? <Badge tone="warn">Low — check first</Badge> : <Badge tone="outline">None</Badge>}
                    </div>
                    <div className="adm-cell-sub">
                      {l.explanation ?? (l.reason === "ambiguous" ? `Could be ${l.candidates.map((x) => x.name).join(" or ")}` : "Nothing in the title matched")}
                      {l.candidates.length > 1 ? ` · candidates: ${l.candidates.map((x) => x.name).join(", ")}` : ""}
                    </div>
                  </div>
                  <div className="cat-review-actions">
                    {canManage ? (
                      <>
                        {conf === "medium" && l.suggestion && (
                          <AdminButton size="sm" variant="primary" disabled={accepting !== null} onClick={() => setConfirming(l)} aria-label={`Accept ${l.suggestedSubcategoryName ?? l.suggestionName} for ${l.title}`}>
                            Accept suggestion
                          </AdminButton>
                        )}
                        {conf === "low" && l.suggestion ? (
                          <AdminButton size="sm" onClick={() => openPicker(l, true)} aria-label={`Review the suggestion for ${l.title}`}>
                            Review…
                          </AdminButton>
                        ) : (
                          <AdminButton size="sm" onClick={() => openPicker(l, false)} aria-label={`Choose a category for ${l.title}`}>
                            Choose…
                          </AdminButton>
                        )}
                      </>
                    ) : (
                      <AdminButton size="sm" onClick={() => setReporting({ type: l.listingType, id: l.listingId, title: l.title })}>Report</AdminButton>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <Pager {...paged} noun="listings" />
        </>
      )}
      <ConfirmDialog
        open={!!confirming}
        tone="neutral"
        title={confirming ? `Assign ${confirming.suggestedSubcategoryName ?? confirming.suggestionName} to ${confirming.title}?` : ""}
        message={
          confirming
            ? `${confirming.suggestionName}${confirming.suggestedSubcategoryName ? ` › ${confirming.suggestedSubcategoryName}` : ""} — ${confirming.explanation ?? "suggested"}. It shows under this category straight away; you can change it later from the category's page.`
            : ""
        }
        confirmLabel="Assign category"
        busy={accepting !== null}
        onCancel={() => setConfirming(null)}
        onConfirm={() => (confirming ? accept(confirming) : undefined)}
      />
      {assigning && (
        <AssignDialog
          listing={assigning}
          family={assigning.family}
          initial={assigning.suggestion ? { categoryId: assigning.suggestion, subcategoryId: assigning.suggestedSub } : null}
          onClose={() => setAssigning(null)}
          onSaved={() => {
            state.reload();
            onChanged();
          }}
        />
      )}
      {reporting && <ReportDialog listing={reporting} onClose={() => setReporting(null)} />}
    </RecordView>
  );
}

function AssignDialog({
  listing,
  family,
  initial = null,
  onClose,
  onSaved,
}: {
  listing: { type: TaxonomyListingType; id: string; title: string };
  family?: CategoryFamily;
  initial?: CategoryValue | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [value, setValue] = useState<CategoryValue | null>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await assignListingCategory(listing.type, listing.id, value?.categoryId ?? null, value?.subcategoryId ?? null);
      toast.success(value ? `${listing.title} categorised` : `Category removed from ${listing.title}`);
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e, "Couldn't save"));
    } finally {
      setSaving(false);
    }
  };
  return (
    <AdminModal
      open
      onClose={onClose}
      dirty={value !== initial}
      title={`Category for ${listing.title}`}
      subtitle={initial ? "Pre-filled with the suggestion — check it before saving." : `${LISTING_TYPE_LABEL[listing.type]}. Only categories for this type are offered.`}
      footer={
        <>
          <AdminButton variant="quiet" onClick={onClose}>Cancel</AdminButton>
          <AdminButton variant="primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save category"}</AdminButton>
        </>
      }
    >
      <CategoryPicker family={familyFor(listing.type, family)} value={value} onChange={setValue} error={error ?? undefined} />
    </AdminModal>
  );
}

function ReportDialog({ listing, onClose }: { listing: { type: TaxonomyListingType; id: string; title: string }; onClose: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState("");
  return (
    <ConfirmDialog
      open
      tone="neutral"
      title={`Report the category of ${listing.title}?`}
      message="A super admin sees this in Reviews & reports and can change it."
      confirmLabel="Send report"
      onCancel={onClose}
      onConfirm={async () => {
        await reportListingCategory(listing.type, listing.id, note);
        toast.success("Reported");
        onClose();
      }}
    >
      <FormField label="What's wrong? (optional)" style={{ marginTop: 10 }}>
        {(p) => <textarea {...p} className="adm-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. This is Gaelic football, not soccer" />}
      </FormField>
    </ConfirmDialog>
  );
}
