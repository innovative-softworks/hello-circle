import { useState } from "react";
import { getClientId } from "../clientId";
import { logReferralShare } from "../api/public";
import { Button } from "./ui";

/** Invite-via-link (Phase A) — Web Share API where available (mobile),
 * falling back to copy-to-clipboard (desktop) so there's always a working
 * path with no server-side invite-token machinery needed. Referral
 * attribution (participation-intent plan Phase 3) appends the sharer's own
 * client id as `?ref=` and logs a best-effort 'share' event — never blocks
 * or delays the actual share/copy action if logging fails. */
export function InviteButton({ title, text, listingType, listingId }: { title: string; text: string; listingType: string; listingId: string }) {
  const [copied, setCopied] = useState(false);

  const invite = async () => {
    logReferralShare({ source: typeof navigator.share === "function" ? "native" : "copy_link", listingType, listingId }).catch(() => {});
    const base = window.location.href.split("?")[0];
    const url = `${base}?ref=${encodeURIComponent(getClientId())}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text, url });
      } catch {
        // user cancelled the share sheet — not an error
      }
      return;
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button variant="ghost" onClick={invite}>
      {copied ? "Link copied!" : "Invite friends"}
    </Button>
  );
}
