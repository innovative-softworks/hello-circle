import { useState } from "react";
import { Button } from "./ui";

/** Invite-via-link (Phase A) — Web Share API where available (mobile),
 * falling back to copy-to-clipboard (desktop) so there's always a working
 * path with no server-side invite-token machinery needed. */
export function InviteButton({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);

  const invite = async () => {
    const url = window.location.href;
    if (navigator.share) {
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
