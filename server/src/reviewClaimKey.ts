import crypto from "node:crypto";

/** The review_claims key for (subject, occurrence, author) — computed in Node,
 * not SQL, because MySQL 9 removed SHA1() (and servers differ). Its own module
 * so db/index.ts can use it without importing the review rules. */
export function reviewClaimKey(listingType: string, occurrenceKind: string, occurrenceRef: string, authorKey: string): string {
  return crypto.createHash("sha1").update([listingType, occurrenceKind, occurrenceRef, authorKey].join("|")).digest("hex");
}
