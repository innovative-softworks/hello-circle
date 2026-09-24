import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db/index.js";
import { defaultOgMeta, generateSitemapUrls, isEntityDetailRoute, resolveMarketingOgMeta, resolveOgMeta, resolveStaticDiscoveryOgMeta } from "./ogMeta.js";

// SEO audit Phase 9 — ogMeta.ts previously had ZERO automated test
// coverage despite being the exact file that has now hosted two real,
// independently-discovered privacy leaks (restricted Circle data via its
// title/description/JSON-LD, and the sitemap generator's missing join_mode
// filter). This is the regression suite that was missing.

const orgId = `test-ogmeta-org-${crypto.randomUUID()}`;
const centreId = `test-ogmeta-centre-${crypto.randomUUID()}`;
const slugCentreId = `test-ogmeta-slug-centre-${crypto.randomUUID()}`;
const slugCentreSlug = `test-ogmeta-slug-centre-slug-${crypto.randomUUID()}`;
const clubId = `test-ogmeta-club-${crypto.randomUUID()}`;
const experienceId = `test-ogmeta-exp-${crypto.randomUUID()}`;
const programId = `test-ogmeta-program-${crypto.randomUUID()}`;
const openCircleId = `test-ogmeta-open-circle-${crypto.randomUUID()}`;
const restrictedCircleId = `test-ogmeta-restricted-circle-${crypto.randomUUID()}`;
const publicGameId = `test-ogmeta-pub-game-${crypto.randomUUID()}`;
const privateGameId = `test-ogmeta-priv-game-${crypto.randomUUID()}`;
const richGameId = `test-ogmeta-rich-game-${crypto.randomUUID()}`;
const draftGameId = `test-ogmeta-draft-game-${crypto.randomUUID()}`;
const cancelledGameId = `test-ogmeta-cancelled-game-${crypto.randomUUID()}`;
const geoCentreId = `test-ogmeta-geo-centre-${crypto.randomUUID()}`;
const hostId = `test-ogmeta-host-${crypto.randomUUID()}`;
const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

beforeAll(async () => {
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id, invited_staff) VALUES (?, ?, 'x', 'vendor', 'approved', 'Test Vendor', ?, 0)`).run(orgId, `${orgId}@example.test`, orgId);

  await db
    .prepare(
      `INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, blurb, vendor_id, status) VALUES (?, 'OG Test Centre', 'Area', 'Dublin', 0, 0, 10, 1000, '', '', 'Real centre blurb', ?, 'approved')`
    )
    .run(centreId, orgId);
  await db
    .prepare(
      `INSERT INTO centres (id, slug, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, blurb, vendor_id, status) VALUES (?, ?, 'OG Slug Centre', 'Area', 'Dublin', 0, 0, 10, 1000, '', '', 'Real slug centre blurb', ?, 'approved')`
    )
    .run(slugCentreId, slugCentreSlug, orgId);
  await db
    .prepare(`INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, blurb, vendor_id, status) VALUES (?, 'OG Test Club', 'Testball', 'Area', 'Dublin', '5-12', 10, 'year', 0, '', 'Real club blurb', ?, 'approved')`)
    .run(clubId, orgId);
  await db
    .prepare(
      `INSERT INTO experiences (id, vendor_id, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status)
       VALUES (?, ?, 'OG Test Experience', 'Real experience blurb', '', '', '', '', '', '', '', '', '', '', 'approved')`
    )
    .run(experienceId, orgId);
  await db.prepare(`INSERT INTO programs (id, listing_type, listing_id, vendor_id, title, description, status) VALUES (?, 'centre', ?, ?, 'OG Test Program', 'Real program description', 'published')`).run(programId, centreId, orgId);

  await db.prepare(`INSERT INTO residents (id, email, name, host_status) VALUES (?, ?, 'OG Test Host', 'verified')`).run(hostId, `${hostId}@example.test`);

  await db
    .prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id, join_mode, status) VALUES (?, 'OG Open Circle', 'Testball', 'Area', 'Dublin', 'real open about', ?, 'open', 'active')`)
    .run(openCircleId, hostId);
  await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(openCircleId, hostId);
  await db
    .prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id, join_mode, status) VALUES (?, 'OG Restricted Circle', 'Testball', 'Area', 'Dublin', 'real restricted about', ?, 'invite', 'active')`)
    .run(restrictedCircleId, hostId);
  await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(restrictedCircleId, hostId);

  await db
    .prepare(`INSERT INTO games (id, host_resident_id, activity_label, location_text, date, time, capacity, status, visibility) VALUES (?, ?, 'OG Public Session', 'Test Location', ?, '18:00', 10, 'open', 'public')`)
    .run(publicGameId, hostId, future);
  await db
    .prepare(`INSERT INTO games (id, host_resident_id, activity_label, location_text, date, time, capacity, status, visibility) VALUES (?, ?, 'OG Secret Session', 'Test Location', ?, '18:00', 10, 'open', 'invite')`)
    .run(privateGameId, hostId, future);

  await db
    .prepare(
      `INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, blurb, vendor_id, status, lat, lng) VALUES (?, 'OG Geo Centre', 'Area', 'Dublin', 0, 0, 10, 1000, '', '', 'Geo centre blurb', ?, 'approved', 53.349805, -6.260310)`
    )
    .run(geoCentreId, orgId);
  await db
    .prepare(
      `INSERT INTO games (id, host_resident_id, centre_id, activity_label, location_text, date, time, capacity, status, visibility, price_cents, duration_minutes) VALUES (?, ?, ?, 'OG Rich Session', 'Test Location', ?, '18:00', 10, 'open', 'public', 1500, 90)`
    )
    .run(richGameId, hostId, geoCentreId, future);
  await db.prepare(`INSERT INTO game_participants (game_id, resident_id, status) VALUES (?, ?, 'joined')`).run(richGameId, hostId);

  await db
    .prepare(
      `INSERT INTO games (id, host_resident_id, activity_label, location_text, date, time, capacity, status, visibility, lifecycle) VALUES (?, ?, 'OG Draft Session', 'Test Location', ?, '18:00', 10, 'open', 'public', 'draft')`
    )
    .run(draftGameId, hostId, future);
  await db
    .prepare(
      `INSERT INTO games (id, host_resident_id, activity_label, location_text, date, time, capacity, status, visibility) VALUES (?, ?, 'OG Cancelled Session', 'Test Location', ?, '18:00', 10, 'cancelled', 'public')`
    )
    .run(cancelledGameId, hostId, future);
});

afterAll(async () => {
  await db.prepare(`DELETE FROM game_participants WHERE game_id = ?`).run(richGameId);
  await db.prepare(`DELETE FROM games WHERE id IN (?, ?, ?, ?, ?)`).run(publicGameId, privateGameId, richGameId, draftGameId, cancelledGameId);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(geoCentreId);
  await db.prepare(`DELETE FROM circle_members WHERE circle_id IN (?, ?)`).run(openCircleId, restrictedCircleId);
  await db.prepare(`DELETE FROM circles WHERE id IN (?, ?)`).run(openCircleId, restrictedCircleId);
  await db.prepare(`DELETE FROM programs WHERE id = ?`).run(programId);
  await db.prepare(`DELETE FROM experiences WHERE id = ?`).run(experienceId);
  await db.prepare(`DELETE FROM clubs WHERE id = ?`).run(clubId);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centreId);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(slugCentreId);
  await db.prepare(`DELETE FROM residents WHERE id = ?`).run(hostId);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(orgId);
});

describe("resolveOgMeta — real entity-kind coverage", () => {
  it("Centre: real dynamic title/description, LocalBusiness JSON-LD, indexable", async () => {
    const meta = await resolveOgMeta(`/centres/${centreId}`);
    expect(meta?.title).toContain("OG Test Centre");
    expect(meta?.description).toContain("Real centre blurb");
    expect(meta?.jsonLd?.["@type"]).toBe("LocalBusiness");
    expect(meta?.robots).toBe("index, follow");
  });

  it("Club: real dynamic title/description, SportsActivityLocation JSON-LD (Phase 8 audit — more specific than generic LocalBusiness), indexable", async () => {
    const meta = await resolveOgMeta(`/clubs/${clubId}`);
    expect(meta?.title).toContain("OG Test Club");
    expect(meta?.jsonLd?.["@type"]).toBe("SportsActivityLocation");
    expect(meta?.robots).toBe("index, follow");
  });

  it("Experience: real dynamic title/description, deliberately no JSON-LD, indexable", async () => {
    const meta = await resolveOgMeta(`/experiences/${experienceId}`);
    expect(meta?.title).toContain("OG Test Experience");
    expect(meta?.jsonLd).toBeUndefined();
    expect(meta?.robots).toBe("index, follow");
  });

  it("Program: real dynamic title/description, indexable", async () => {
    const meta = await resolveOgMeta(`/programs/${programId}`);
    expect(meta?.title).toContain("OG Test Program");
    expect(meta?.description).toContain("Real program description");
    expect(meta?.robots).toBe("index, follow");
  });

  it("public Activity: real title, Event JSON-LD, indexable", async () => {
    const meta = await resolveOgMeta(`/games/${publicGameId}`);
    expect(meta?.title).toContain("OG Public Session");
    expect(meta?.jsonLd?.["@type"]).toBe("Event");
    expect(meta?.robots).toBe("index, follow");
  });

  it("private Activity: never leaks the real title/description to a viewerless request, and is never indexable", async () => {
    const meta = await resolveOgMeta(`/games/${privateGameId}`);
    expect(meta?.title).not.toContain("OG Secret Session");
    expect(meta?.description).not.toContain("Secret");
    expect(meta?.jsonLd).toBeUndefined();
    expect(meta?.robots).not.toBe("index, follow");
  });

  it("public Activity with real duration/price/centre-geo: Event JSON-LD gains endDate/offers/organizer/geo from real data only", async () => {
    const meta = await resolveOgMeta(`/games/${richGameId}`);
    const jsonLd = meta?.jsonLd as Record<string, any>;
    expect(jsonLd.startDate).toBe(`${future}T18:00`);
    // 90 minutes after 18:00 = 19:30, same naive-local format as startDate.
    expect(jsonLd.endDate).toBe(`${future}T19:30`);
    expect(jsonLd.organizer).toEqual({ "@type": "Person", name: "OG Test Host" });
    expect(jsonLd.offers).toMatchObject({ "@type": "Offer", price: "15.00", priceCurrency: "EUR", availability: "https://schema.org/InStock" });
    expect(jsonLd.location.geo).toEqual({ "@type": "GeoCoordinates", latitude: 53.349805, longitude: -6.26031 });
  });

  it("public Activity with no duration/centre: endDate/geo are omitted outright, never fabricated", async () => {
    const meta = await resolveOgMeta(`/games/${publicGameId}`);
    const jsonLd = meta?.jsonLd as Record<string, any>;
    expect(jsonLd.endDate).toBeUndefined();
    expect(jsonLd.location.geo).toBeUndefined();
    // Still has a real offers block — priceCents was never set on this
    // fixture, so it's a real free (0.00) offer, not omitted.
    expect(jsonLd.offers).toMatchObject({ price: "0.00", priceCurrency: "EUR" });
  });

  it("private Activity: reveals the real title to the actual host", async () => {
    const meta = await resolveOgMeta(`/games/${privateGameId}`, hostId);
    expect(meta?.title).toContain("OG Secret Session");
  });

  it("Lifecycle §54: a draft Activity is never shareable/indexable — resolveOgMeta returns null (the 404 signal), same as nonexistent", async () => {
    const meta = await resolveOgMeta(`/games/${draftGameId}`);
    expect(meta).toBeNull();
    const metaAsHost = await resolveOgMeta(`/games/${draftGameId}`, hostId);
    expect(metaAsHost).toBeNull();
  });

  it("Lifecycle §59: a cancelled Activity keeps a real, indexable, honest page — never auto-404'd, never pretending to still be bookable", async () => {
    const meta = await resolveOgMeta(`/games/${cancelledGameId}`);
    expect(meta).not.toBeNull();
    expect(meta?.title).toContain("OG Cancelled Session");
    expect(meta?.title).toContain("Cancelled");
    expect(meta?.robots).toBe("index, follow");
    expect(meta?.jsonLd?.eventStatus).toBe("https://schema.org/EventCancelled");
    expect(meta?.jsonLd).not.toHaveProperty("offers");
  });

  it("public Circle: real title/description, Organization JSON-LD, indexable", async () => {
    const meta = await resolveOgMeta(`/circles/${openCircleId}`);
    expect(meta?.title).toContain("OG Open Circle");
    expect(meta?.description).toContain("real open about");
    expect(meta?.jsonLd?.["@type"]).toBe("Organization");
    expect(meta?.robots).toBe("index, follow");
  });

  it("restricted Circle: never leaks the real title/description/JSON-LD to an unauthenticated request, and is never indexable", async () => {
    const meta = await resolveOgMeta(`/circles/${restrictedCircleId}`);
    expect(meta?.title).not.toContain("OG Restricted Circle");
    expect(meta?.description).not.toContain("real restricted about");
    expect(meta?.jsonLd).toBeUndefined();
    expect(meta?.robots).not.toBe("index, follow");
  });

  it("Host: real dynamic title, Person JSON-LD, indexable", async () => {
    const meta = await resolveOgMeta(`/host/${hostId}`);
    expect(meta?.title).toContain("OG Test Host");
    expect(meta?.jsonLd?.["@type"]).toBe("Person");
    expect(meta?.robots).toBe("index, follow");
  });

  it("nonexistent Centre id: resolveOgMeta returns null (the 404 signal)", async () => {
    const meta = await resolveOgMeta(`/centres/${crypto.randomUUID()}`);
    expect(meta).toBeNull();
  });

  it("nonexistent Circle id: returns null too", async () => {
    const meta = await resolveOgMeta(`/circles/${crypto.randomUUID()}`);
    expect(meta).toBeNull();
  });
});

describe("canonical URL — SEO Phase 7, slug-vs-id duplicate content", () => {
  // /centres/:slug and /centres/:id both resolve to the same row (the query
  // is `slug = ? OR id = ?`), so without canonicalizing, the two URLs would
  // each report themselves as their own canonical/og:url/JSON-LD url —
  // textbook duplicate content. Both variants must converge on the same,
  // slug-preferring URL regardless of which one was actually requested.
  it("requesting by raw id resolves the canonical url to the real slug, not the id", async () => {
    const meta = await resolveOgMeta(`/centres/${slugCentreId}`);
    expect(meta?.url.endsWith(`/centres/${slugCentreSlug}`)).toBe(true);
    expect(meta?.url.includes(slugCentreId)).toBe(false);
    expect(meta?.jsonLd?.url).toBe(meta?.url);
  });

  it("requesting by the real slug resolves to the identical canonical url", async () => {
    const bySlug = await resolveOgMeta(`/centres/${slugCentreSlug}`);
    const byId = await resolveOgMeta(`/centres/${slugCentreId}`);
    expect(bySlug?.url).toBe(byId?.url);
  });

  it("a row with no slug falls back to the id (no crash, no broken url)", async () => {
    const meta = await resolveOgMeta(`/centres/${centreId}`);
    expect(meta?.url.endsWith(`/centres/${centreId}`)).toBe(true);
  });
});

describe("robots regression — every real, launch-policy-public page must resolve as indexable", () => {
  // injectOgTags() defaults an omitted `robots` field to "noindex, nofollow"
  // (fail-closed). A prior version of resolveOgMeta's per-kind branches
  // never set `robots` explicitly at all, so every real Centre/Club/
  // Experience/Program/public Activity/open Circle/Host/Provider page (and
  // the local SEO landing pages) silently rendered noindex even post-launch
  // — this locks in the fix rather than relying on the per-kind assertions
  // above alone, since a future edit could re-introduce the gap for one kind
  // without any single test catching the systemic pattern.
  it("local SEO landing page: real, active-listing county resolves as indexable", async () => {
    const meta = await resolveOgMeta(`/dublin/testball`);
    expect(meta).not.toBeNull();
    expect(meta?.robots).toBe("index, follow");
  });

  it("all found public entity kinds set robots to index, follow — not just 'not noindex'", async () => {
    const publicPaths = [
      `/centres/${centreId}`,
      `/clubs/${clubId}`,
      `/experiences/${experienceId}`,
      `/programs/${programId}`,
      `/games/${publicGameId}`,
      `/circles/${openCircleId}`,
      `/host/${hostId}`,
    ];
    for (const path of publicPaths) {
      const meta = await resolveOgMeta(path);
      expect(meta?.robots, `expected ${path} to be indexable`).toBe("index, follow");
    }
  });
});

describe("generateSitemapUrls — SEO audit's 'Programs never appear in the sitemap' finding", () => {
  // The SEO audit flagged a Programs-sitemap gap. Re-checking the current
  // code: the Promise.all query array and its destructuring both include
  // `programs` (SELECT id FROM programs WHERE status = 'published') in
  // matching position, and the loop below pushes `/programs/${p.id}` for
  // each row — this is already correct as written. These tests lock that in
  // as a regression guard rather than re-fixing something not currently
  // broken, and double-check the same privacy rules the JSON API/ogMeta
  // branches enforce also hold for the sitemap generator itself.
  it("includes real Centre/Club/Experience/Program/open-Circle/public-Activity/Host URLs", async () => {
    const urls = await generateSitemapUrls();
    const hasPathEnding = (suffix: string) => urls.some((u) => u.endsWith(suffix));
    expect(hasPathEnding(`/programs/${programId}`)).toBe(true);
    expect(hasPathEnding(`/circles/${openCircleId}`)).toBe(true);
    expect(hasPathEnding(`/games/${publicGameId}`)).toBe(true);
    expect(hasPathEnding(`/host/${hostId}`)).toBe(true);
  });

  it("never includes a restricted Circle or a non-public Activity — sitemap privacy matches the JSON API/ogMeta rules", async () => {
    const urls = await generateSitemapUrls();
    expect(urls.some((u) => u.endsWith(`/circles/${restrictedCircleId}`))).toBe(false);
    expect(urls.some((u) => u.endsWith(`/games/${privateGameId}`))).toBe(false);
  });

  it("Lifecycle §61: never includes a draft Activity, even though its (independent) status column is 'open'", async () => {
    const urls = await generateSitemapUrls();
    expect(urls.some((u) => u.endsWith(`/games/${draftGameId}`))).toBe(false);
  });
});

describe("resolveStaticDiscoveryOgMeta — the core browse/discovery pages must be indexable", () => {
  // Every STATIC_SITEMAP_PATHS entry (generateSitemapUrls) is submitted to
  // Google post-launch as a real, high-value page — before this resolver
  // existed, none of them matched resolveOgMeta's ROUTE_PATTERN or
  // resolveMarketingOgMeta's page list, so they all fell through to
  // defaultOgMeta's noindex default, same bug class as the entity branches.
  it("resolves real, indexable meta for every static discovery page", () => {
    for (const path of ["/home", "/explore", "/browse/centres", "/browse/clubs", "/games", "/circles", "/adventures", "/experiences"]) {
      const meta = resolveStaticDiscoveryOgMeta(path);
      expect(meta, `expected ${path} to resolve`).not.toBeNull();
      expect(meta?.robots).toBe("index, follow");
      expect(meta?.title).toContain("HelloCircle");
    }
  });

  it("returns null for a path with no static discovery entry", () => {
    expect(resolveStaticDiscoveryOgMeta("/not-a-real-page")).toBeNull();
  });
});

describe("isEntityDetailRoute — the 404-vs-200 decision boundary", () => {
  it("real entity-shaped paths match", () => {
    expect(isEntityDetailRoute("/centres/some-id")).toBe(true);
    expect(isEntityDetailRoute("/circles/some-id")).toBe(true);
    expect(isEntityDetailRoute("/games/some-id")).toBe(true);
    expect(isEntityDetailRoute("/host/some-id")).toBe(true);
  });

  it("non-entity paths (management/account/marketing) do not match — must stay 200, SPA decides", () => {
    expect(isEntityDetailRoute("/manage")).toBe(false);
    expect(isEntityDetailRoute("/profile")).toBe(false);
    expect(isEntityDetailRoute("/vendor")).toBe(false);
    expect(isEntityDetailRoute("/this-route-does-not-exist")).toBe(false);
    expect(isEntityDetailRoute("/")).toBe(false);
  });

  it("local landing pages (/:county/:activity) do not match — they keep their own zero-result page state, not a 404", () => {
    expect(isEntityDetailRoute("/dublin/badminton")).toBe(false);
  });
});

describe("defaultOgMeta / resolveMarketingOgMeta", () => {
  it("default meta is always noindex,nofollow (fail-closed)", () => {
    expect(defaultOgMeta("/whatever").robots).toBe("noindex, nofollow");
  });

  it("marketing pages resolve with real indexable content", () => {
    const meta = resolveMarketingOgMeta("/for-venues");
    expect(meta?.title).toContain("HelloCircle");
    expect(meta?.robots).toBe("index, follow");
  });

  it("unknown paths get no marketing meta", () => {
    expect(resolveMarketingOgMeta("/not-a-marketing-page")).toBeNull();
  });
});
