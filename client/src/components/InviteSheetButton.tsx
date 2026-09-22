import { useState } from "react";
import type { InvitableEntityType } from "../api/invitations";
import { UsersIcon } from "./icons";
import { InviteSheet } from "./InviteSheet";
import { Button } from "./ui";

// Trigger for the tracked, accept/maybe/decline "Invite" flow (§7/§8) —
// named distinctly from the pre-existing InviteButton.tsx (which is the
// untracked, fire-and-forget "share a link with a ?ref=" mechanism, kept
// as-is and reused inside InviteSheet's own "Other ways to invite" panel).
export function InviteSheetButton({ entityType, entityId, title }: { entityType: InvitableEntityType; entityId: string; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <UsersIcon size={15} /> Invite
      </Button>
      <InviteSheet open={open} onClose={() => setOpen(false)} entityType={entityType} entityId={entityId} title={title} />
    </>
  );
}
