import type { Club } from "./types";

export function priceLabel(club: Club): string {
  return `€${club.price} / ${club.unit}`;
}
