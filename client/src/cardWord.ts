import type { CategoryLabel } from "./types";

/** The big word over a listing card's photo: a chosen type first (a filter
 * the visitor picked), else the listing's subcategory, else its category's
 * first part ("Outdoors & adventure" → "Outdoors"), else what kind of
 * listing it is ("Adventure", "Programme") — so every card has one. The
 * server only sends a category it is sure of (see server categoryLabels.ts). */
export function cardWord(label: CategoryLabel | null | undefined, kind: string, chosen?: string | null): string {
  return chosen || label?.sub || label?.name.split(/\s+&\s+|,\s*/)[0] || kind;
}
