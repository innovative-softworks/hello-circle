import { useState, type ReactNode } from "react";
import type { ShareEntityType } from "../api/sharing";
import { ShareIcon } from "./icons";
import { ShareSheet } from "./ShareSheet";
import { Button } from "./ui";

// The one trigger every product surface should use to open <ShareSheet/>
// (Universal Sharing system §33) — a plain outline button by default, or
// pass `render` for a page that wants its own trigger styling (e.g. an
// existing icon-only "Share" button) while still getting the same sheet.
export function ShareButton({
  entityType,
  entityId,
  variant = "ghost",
  label = "Share",
  render,
}: {
  entityType: ShareEntityType;
  entityId: string;
  variant?: "primary" | "orange" | "dark" | "ghost" | "danger";
  label?: string;
  render?: (onClick: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {render ? (
        render(() => setOpen(true))
      ) : (
        <Button variant={variant} onClick={() => setOpen(true)}>
          <ShareIcon size={15} /> {label}
        </Button>
      )}
      <ShareSheet open={open} onClose={() => setOpen(false)} entityType={entityType} entityId={entityId} />
    </>
  );
}
