import { request } from "./core";

// Universal Sharing & Invitation system — the single client-side entry
// point onto getShareData() (server/src/routes/sharing.ts), which every
// sharing surface (<ShareSheet/>, <InviteSheet/>, the /i/:token landing
// page) consumes instead of each page re-deriving its own title/description/
// image/message from whatever fields it happens to already have loaded.

export type ShareEntityType = "centre" | "club" | "circle" | "experience" | "adventure" | "game" | "program" | "host" | "provider";

export interface ShareData {
  entityType: ShareEntityType;
  entityId: string;
  title: string;
  description: string;
  image?: string | null;
  url: string;
  host?: { name: string; verified: boolean } | null;
  location?: string | null;
  date?: string | null;
  time?: string | null;
  interestedCount?: number | null;
  priceCents?: number | null;
  circleName?: string | null;
  privacy: "public" | "circle_only" | "private";
}

export function fetchShareData(entityType: ShareEntityType, entityId: string): Promise<ShareData> {
  return request(`/share/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`);
}

export type ShareClientEvent = "share_opened" | "share_channel_selected" | "share_completed" | "share_link_copied" | "share_to_circle";

/** Fire-and-forget — every call site should `.catch(() => {})` this, same
 * contract as logReferralShare/logReferralLand: a logging failure must
 * never block the actual share/copy/invite action. */
export function logShareEvent(event: ShareClientEvent, entityType: ShareEntityType, entityId: string, channel?: string): Promise<{ ok: boolean }> {
  return request(`/share/event`, { method: "POST", body: JSON.stringify({ event, entityType, entityId, channel }) });
}

export function shareToCircle(circleId: string, entityType: ShareEntityType, entityId: string, message?: string): Promise<{ ok: boolean; notified: number }> {
  return request(`/circles/${encodeURIComponent(circleId)}/share`, { method: "POST", body: JSON.stringify({ entityType, entityId, message }) });
}
