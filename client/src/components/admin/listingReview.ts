import type { AdminListingDetail, AdminListingSummary } from "../../api";

// Listing review helpers (Pending approvals, 2026-10-16): advisory quality
// checks and a "similar listing already exists" finder. Only the partner
// check mirrors a real server rule (a listing can't go live before its
// partner account is approved); everything else just tells the reviewer what
// to look at.

export type CheckState = "pass" | "warn" | "fail";
export interface ListingCheck {
  key: string;
  state: CheckState;
  label: string;
  detail?: string;
}

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean);

export function listingChecks(item: AdminListingSummary, detail: AdminListingDetail | null): ListingCheck[] {
  const checks: ListingCheck[] = [];
  const photos = detail ? detail.images.length : item.image ? 1 : 0;
  checks.push(photos > 0 ? { key: "photo", state: "pass", label: photos === 1 ? "Has a cover photo" : `Has ${photos} photos` } : { key: "photo", state: "warn", label: "No photos", detail: "Listings without a photo get far fewer bookings." });

  const text = detail?.description ?? item.blurb ?? "";
  const w = words(text);
  const longest = w.reduce((n, x) => Math.max(n, x.length), 0);
  if (w.length >= 12 && longest <= 24) checks.push({ key: "description", state: "pass", label: "Description reads as real text" });
  else
    checks.push({
      key: "description",
      state: "warn",
      label: w.length === 0 ? "No description" : "Description looks too short or garbled",
      detail: w.length ? `${w.length} word${w.length === 1 ? "" : "s"}${longest > 24 ? ", with a very long unbroken word" : ""}.` : undefined,
    });

  checks.push(item.area && item.county ? { key: "location", state: "pass", label: "Area and county given" } : { key: "location", state: "warn", label: "Location is incomplete" });

  if (detail?.centre) {
    const rooms = detail.centre.rooms.filter((r) => r.active);
    const usable = rooms.filter((r) => r.capacity > 0 && r.rate > 0);
    checks.push(
      usable.length
        ? { key: "bookable", state: "pass", label: `${usable.length} room${usable.length === 1 ? "" : "s"} with capacity and a price` }
        : { key: "bookable", state: "warn", label: "No room has a capacity and a price", detail: rooms.length ? "Rooms are set to capacity 0 or €0 an hour." : "No active rooms." }
    );
  } else if (detail?.club) {
    const c = detail.club;
    checks.push(c.price > 0 ? { key: "price", state: "pass", label: "Membership price set" } : { key: "price", state: "warn", label: "Price is €0", detail: "Check the club really is free." });
    const active = c.sessions.filter((s) => s.active).length;
    checks.push(active ? { key: "bookable", state: "pass", label: `${active} weekly session${active === 1 ? "" : "s"}` } : { key: "bookable", state: "warn", label: "No weekly sessions yet" });
  } else if (detail?.experience) {
    const e = detail.experience;
    checks.push(e.capacity > 0 ? { key: "price", state: e.priceCents > 0 ? "pass" : "warn", label: e.priceCents > 0 ? "Price and group size set" : "Price is €0", detail: e.priceCents > 0 ? undefined : "Check it really is free." } : { key: "price", state: "warn", label: "Group size is 0" });
    checks.push(e.upcomingSessions.length ? { key: "bookable", state: "pass", label: `${e.upcomingSessions.length} upcoming date${e.upcomingSessions.length === 1 ? "" : "s"}` } : { key: "bookable", state: "warn", label: "No upcoming dates" });
  }

  if (item.vendorId && item.vendorStatus && item.vendorStatus !== "approved")
    checks.push({ key: "partner", state: "fail", label: `Partner account is ${item.vendorStatus}`, detail: "Approve the partner account first. This listing can't go live before it." });
  else checks.push({ key: "partner", state: "pass", label: item.vendorId ? "Partner account approved" : "No partner (unclaimed listing)" });
  return checks;
}

const STOP = new Set(["the", "and", "of", "community", "centre", "center", "hall", "club", "fc", "gaa", "sports", "sport", "st", "saint", "park", "house", "a"]);
function tokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOP.has(t))
  );
}

/** Other listings in the same county whose name shares most of its words with this one. */
export function similarListings<T extends { item: { id: string; name: string; county: string } }>(target: { id: string; name: string; county: string }, all: T[]): T[] {
  const mine = tokens(target.name);
  if (!mine.size) return [];
  return all
    .filter((r) => r.item.id !== target.id && r.item.county && r.item.county === target.county)
    .filter((r) => {
      const theirs = tokens(r.item.name);
      if (!theirs.size) return false;
      const shared = [...mine].filter((t) => theirs.has(t)).length;
      return shared / Math.min(mine.size, theirs.size) >= 0.5;
    })
    .slice(0, 3);
}
