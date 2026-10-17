// OG-24 — the admin Vendors and All listings pages, numbered pages on the
// server. Each page keeps what those screens showed when they filtered the
// whole list in the browser: the status-tab counts (over every other filter),
// the type counts, the county list, every sort order, and record lookup by id.
// Old unparameterised GET /admin/vendors and /admin/listings are unchanged.
import { db } from "./db/index.js";

export const LISTING_TYPES = ["centre", "club", "experience"] as const;
export type ListingType = (typeof LISTING_TYPES)[number];
const TABLE: Record<ListingType, string> = { centre: "centres", club: "clubs", experience: "experiences" };

// Same column sets the unparameterised /admin/listings returns, so the client
// renders a paged row exactly like a row from the full list.
const COLUMNS: Record<ListingType, string> = {
  centre: `c.id, c.name, c.status, c.area, c.county, c.capacity, c.from_price as \`from\`, c.managed_by as managedBy,
           c.ph, c.image_url as image, c.blurb, c.vendor_id as vendorId, u.email as vendorEmail, u.name as vendorName, u.status as vendorStatus, c.featured, c.created_at as createdAt`,
  club: `c.id, c.name, c.status, c.sport, c.area, c.county, c.ages, c.price, c.unit,
         c.ph, c.image_url as image, c.blurb, c.vendor_id as vendorId, u.email as vendorEmail, u.name as vendorName, u.status as vendorStatus, c.featured, c.created_at as createdAt`,
  experience: `c.id, c.title as name, c.status, c.kind, c.area, c.county, c.price_cents as \`from\`,
               c.image_url as image, c.blurb, c.vendor_id as vendorId, u.email as vendorEmail, u.name as vendorName, u.status as vendorStatus, c.featured, c.created_at as createdAt`,
};

/** A literal substring search (the browser filter was `includes`, not a pattern). */
function likeLiteral(q: string) {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

function pageArgs(page: unknown, pageSize: unknown) {
  const size = Math.min(100, Math.max(1, Math.floor(Number(pageSize)) || 20));
  const p = Math.max(1, Math.floor(Number(page)) || 1);
  return { size, page: p };
}

// --- listings ------------------------------------------------------------------------

export const LISTING_SORTS = ["triage", "newest", "oldest", "name", "nameDesc", "partner"] as const;
export type ListingSort = (typeof LISTING_SORTS)[number];
const STATUS_VIEWS = ["all", "pending", "approved", "rejected", "other"] as const;
type StatusView = (typeof STATUS_VIEWS)[number];

export interface ListingPageQuery {
  q?: string;
  type?: string;
  view?: string;
  county?: string;
  show?: string;
  sort?: string;
  page?: unknown;
  pageSize?: unknown;
}

/** One row per listing across the three tables, with only what filtering and sorting need. */
const UNION = LISTING_TYPES.map(
  (t) => `SELECT '${t}' AS type, l.id, ${t === "experience" ? "l.title" : "l.name"} AS name, l.status, l.area, l.county, l.featured,
                 l.vendor_id AS vendorId, u.name AS vendorName, u.email AS vendorEmail, l.created_at AS createdAt
          FROM ${TABLE[t]} l LEFT JOIN users u ON u.id = l.vendor_id`
).join(" UNION ALL ");

const ORDER: Record<ListingSort, string> = {
  // Pending first, then name — the order the browser list used by default.
  triage: `(x.status = 'pending') DESC, x.name ASC, x.type, x.id`,
  // As the browser sort did: rows without a date sort as "infinitely old".
  oldest: `(x.createdAt IS NULL) ASC, x.createdAt ASC, x.name ASC, x.type, x.id`,
  newest: `(x.createdAt IS NULL) DESC, x.createdAt DESC, x.name DESC, x.type, x.id`,
  name: `x.name ASC, x.type, x.id`,
  nameDesc: `x.name DESC, x.type, x.id`,
  partner: `(x.vendorName IS NULL) ASC, x.vendorName ASC, x.type, x.id`,
};

function viewSql(view: StatusView) {
  if (view === "all") return "1 = 1";
  if (view === "other") return `x.status NOT IN ('pending', 'approved', 'rejected')`;
  return `x.status = '${view}'`;
}

export async function listingPage(input: ListingPageQuery) {
  const { size, page } = pageArgs(input.page, input.pageSize);
  const type = LISTING_TYPES.find((t) => t === input.type) ?? null;
  const view: StatusView = STATUS_VIEWS.find((v) => v === input.view) ?? "all";
  const sort: ListingSort = LISTING_SORTS.find((s) => s === input.sort) ?? "triage";
  const q = typeof input.q === "string" ? input.q.trim().slice(0, 100) : "";
  const county = typeof input.county === "string" && input.county && input.county !== "all" ? input.county.slice(0, 80) : null;
  const show = ["featured", "unclaimed", "partner"].includes(String(input.show)) ? String(input.show) : "all";

  // `base` = every filter except the status tab (the tabs count over it).
  const base: string[] = [];
  const params: unknown[] = [];
  if (type) {
    base.push(`x.type = ?`);
    params.push(type);
  }
  if (county) {
    base.push(`x.county = ?`);
    params.push(county);
  }
  if (show === "featured") base.push(`x.featured = 1`);
  if (show === "unclaimed") base.push(`x.vendorId IS NULL`);
  if (show === "partner") base.push(`x.vendorId IS NOT NULL`);
  if (q) {
    const like = likeLiteral(q);
    base.push(`(x.name LIKE ? OR x.vendorName LIKE ? OR x.vendorEmail LIKE ? OR x.area LIKE ? OR x.county LIKE ?)`);
    params.push(like, like, like, like, like);
  }
  const baseWhere = base.length ? base.join(" AND ") : "1 = 1";
  const from = `FROM (${UNION}) x`;

  const [countRow] = (await db
    .prepare(
      `SELECT COUNT(*) AS allN, SUM(x.status = 'pending') AS pendingN, SUM(x.status = 'approved') AS approvedN,
              SUM(x.status = 'rejected') AS rejectedN, SUM(x.status NOT IN ('pending', 'approved', 'rejected')) AS otherN
       ${from} WHERE ${baseWhere}`
    )
    .all(...params)) as Record<string, number | string | null>[];
  const counts = {
    all: Number(countRow?.allN ?? 0),
    pending: Number(countRow?.pendingN ?? 0),
    approved: Number(countRow?.approvedN ?? 0),
    rejected: Number(countRow?.rejectedN ?? 0),
    other: Number(countRow?.otherN ?? 0),
  };
  // The Type menu and the county list are over every listing, as before.
  const typeRows = (await db.prepare(`SELECT x.type, COUNT(*) AS n ${from} GROUP BY x.type`).all()) as { type: ListingType; n: number | string }[];
  const typeCounts = Object.fromEntries(LISTING_TYPES.map((t) => [t, Number(typeRows.find((r) => r.type === t)?.n ?? 0)])) as Record<ListingType, number>;
  const counties = ((await db.prepare(`SELECT DISTINCT x.county ${from} WHERE x.county IS NOT NULL AND x.county <> '' ORDER BY x.county`).all()) as { county: string }[]).map((r) => r.county);

  const total = counts[view];
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(page, pageCount);
  const keys = (await db
    .prepare(`SELECT x.type, x.id ${from} WHERE ${baseWhere} AND ${viewSql(view)} ORDER BY ${ORDER[sort]} LIMIT ${size} OFFSET ${(current - 1) * size}`)
    .all(...params)) as { type: ListingType; id: string }[];
  const items = await listingRows(keys);
  return { items, total, page: current, pageSize: size, pageCount, counts, typeCounts, counties };
}

/** Full summary rows for (type, id) keys, in the order given. */
async function listingRows(keys: { type: ListingType; id: string }[]) {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const t of LISTING_TYPES) {
    const ids = keys.filter((k) => k.type === t).map((k) => k.id);
    if (!ids.length) continue;
    const rows = (await db
      .prepare(`SELECT ${COLUMNS[t]} FROM ${TABLE[t]} c LEFT JOIN users u ON u.id = c.vendor_id WHERE c.id IN (${ids.map(() => "?").join(",")})`)
      .all(...ids)) as Record<string, unknown>[];
    for (const r of rows) byKey.set(`${t}:${r.id}`, r);
  }
  return keys.flatMap((k) => {
    const item = byKey.get(`${k.type}:${k.id}`);
    return item ? [{ type: k.type, item }] : [];
  });
}

/** One listing's summary row (the record page), or null. */
export async function listingSummary(type: string, id: string) {
  const t = LISTING_TYPES.find((x) => x === type);
  if (!t) return null;
  const [row] = await listingRows([{ type: t, id }]);
  return row ?? null;
}

/** Every listing a partner owns (their record page), all types, newest first. */
export async function listingsOfVendor(vendorId: string) {
  const keys = (await db.prepare(`SELECT x.type, x.id FROM (${UNION}) x WHERE x.vendorId = ? ORDER BY x.createdAt DESC, x.type, x.id`).all(vendorId)) as { type: ListingType; id: string }[];
  return listingRows(keys);
}

// --- partners (vendors) ----------------------------------------------------------------

const VENDOR_COLUMNS = `u.id, u.email, u.name, u.status, u.created_at as createdAt,
       u.vendor_type as vendorType, u.business_name as businessName, u.address, u.county, u.mobile, u.landline, u.description,
       u.org_id as orgId, u.platform_role as platformRole, u.provider_tier as providerTier, u.invited_staff as invitedStaff,
       (SELECT COUNT(*) FROM centres WHERE vendor_id = u.id) as centreCount,
       (SELECT COUNT(*) FROM clubs WHERE vendor_id = u.id) as clubCount,
       ((SELECT COUNT(*) FROM centres WHERE vendor_id = u.id AND status <> 'deleted')
        + (SELECT COUNT(*) FROM clubs WHERE vendor_id = u.id AND status <> 'deleted')
        + (SELECT COUNT(*) FROM experiences WHERE vendor_id = u.id AND status <> 'deleted')) as listingCount`;

export interface VendorPageQuery {
  q?: string;
  view?: string;
  type?: string;
  page?: unknown;
  pageSize?: unknown;
}

export async function vendorPage(input: VendorPageQuery) {
  const { size, page } = pageArgs(input.page, input.pageSize);
  const view = ["pending", "approved", "suspended"].find((v) => v === input.view) ?? "all";
  const where = [`u.role = 'vendor'`];
  const params: unknown[] = [];
  if (input.type === "community" || input.type === "sports") {
    where.push(`u.vendor_type = ?`);
    params.push(input.type);
  }
  const q = typeof input.q === "string" ? input.q.trim().slice(0, 100) : "";
  if (q) {
    const like = likeLiteral(q);
    where.push(`(u.name LIKE ? OR u.email LIKE ? OR u.business_name LIKE ? OR u.county LIKE ?)`);
    params.push(like, like, like, like);
  }
  const baseWhere = where.join(" AND ");
  const [c] = (await db
    .prepare(`SELECT COUNT(*) AS allN, SUM(u.status = 'pending') AS pendingN, SUM(u.status = 'approved') AS approvedN, SUM(u.status = 'suspended') AS suspendedN FROM users u WHERE ${baseWhere}`)
    .all(...params)) as Record<string, number | string | null>[];
  const counts = { all: Number(c?.allN ?? 0), pending: Number(c?.pendingN ?? 0), approved: Number(c?.approvedN ?? 0), suspended: Number(c?.suspendedN ?? 0) };
  const total = counts[view as keyof typeof counts];
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(page, pageCount);
  const viewWhere = view === "all" ? "" : ` AND u.status = ?`;
  const items = await db
    .prepare(`SELECT ${VENDOR_COLUMNS} FROM users u WHERE ${baseWhere}${viewWhere} ORDER BY (u.status = 'pending') DESC, u.created_at DESC, u.id DESC LIMIT ${size} OFFSET ${(current - 1) * size}`)
    .all(...params, ...(view === "all" ? [] : [view]));
  return { items, total, page: current, pageSize: size, pageCount, counts };
}

/** One partner account (the record page) with its organisation's member count, or null. */
export async function vendorRecord(id: string) {
  const row = (await db.prepare(`SELECT ${VENDOR_COLUMNS} FROM users u WHERE u.id = ? AND u.role = 'vendor'`).get(id)) as ({ orgId: string | null } & Record<string, unknown>) | undefined;
  if (!row) return null;
  const members = row.orgId ? ((await db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'vendor' AND org_id = ?`).get(row.orgId)) as { n: number | string }).n : 0;
  return { ...row, orgMemberCount: Number(members) };
}
