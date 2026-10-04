import type { Response } from "express";

// HC-QA-073 — one pagination contract for list endpoints (activities,
// Circles, notifications): keyset/cursor pagination.
//
//   ?limit=<1..MAX>   default 50; values above the max are clamped to it;
//                     anything non-integer or < 1 is a 400.
//   ?cursor=<opaque>  returned by the previous page; malformed → 400.
//
// The response BODY stays a plain JSON array (every existing consumer keeps
// working unchanged); the next page's cursor is in the `X-Next-Cursor`
// response header, absent on the last page. Keyset (not offset) so an item
// inserted between requests can't cause duplicates or skips, and each query
// carries a unique tie-breaker (id) so ordering is total and stable.

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

export class PaginationError extends Error {}

export interface PageParams<C extends unknown[]> { limit: number; after: C | null }

export function parsePageParams<C extends unknown[]>(query: Record<string, unknown>, cursorShape: ("string" | "number")[]): PageParams<C> {
  let limit = DEFAULT_LIMIT;
  if (query.limit !== undefined) {
    const raw = String(query.limit);
    if (!/^\d+$/.test(raw) || Number(raw) < 1) throw new PaginationError("limit must be a positive whole number");
    limit = Math.min(Number(raw), MAX_LIMIT);
  }
  let after: C | null = null;
  if (query.cursor !== undefined && query.cursor !== "") {
    try {
      const decoded = JSON.parse(Buffer.from(String(query.cursor), "base64url").toString("utf8")) as unknown;
      if (!Array.isArray(decoded) || decoded.length !== cursorShape.length || decoded.some((v, i) => typeof v !== cursorShape[i])) throw new Error("shape");
      after = decoded as C;
    } catch {
      throw new PaginationError("Invalid cursor");
    }
  }
  return { limit, after };
}

export function encodeCursor(values: unknown[]): string {
  return Buffer.from(JSON.stringify(values), "utf8").toString("base64url");
}

/** Sets (or omits, on the last page) the next-page cursor header. */
export function setNextCursor(res: Response, next: unknown[] | null) {
  res.setHeader("Access-Control-Expose-Headers", "X-Next-Cursor");
  if (next) res.setHeader("X-Next-Cursor", encodeCursor(next));
}
