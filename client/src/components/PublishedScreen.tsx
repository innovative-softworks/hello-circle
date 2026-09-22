import { CheckCircleIcon, EyeIcon, ShareIcon } from "./icons";
import { Button, ManageCard as Card, LinkButton } from "./ui";
import { colors, fonts } from "../theme";

// Host Manage spec §30 — publishing used to just silently swap the wizard
// for the normal tabbed editor with no acknowledgement at all. Shown once,
// right after `onPublished` fires; dismissing it lands on the same tabbed
// view as before.
export function PublishedScreen({ name, publicHref, onDismiss }: { name: string; publicHref: string; onDismiss: () => void }) {
  const copyLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}${publicHref}`);
    alert("Link copied to clipboard");
  };

  return (
    <Card style={{ maxWidth: 480, textAlign: "center", padding: "36px 28px" }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 14, color: colors.greenText }}>
        <CheckCircleIcon size={36} />
      </div>
      <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 22, margin: "0 0 8px" }}>You're live.</h2>
      <p style={{ fontSize: 14, color: colors.mutedLight, margin: "0 0 24px" }}>
        <strong>{name}</strong> is now discoverable on HelloCircle.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <LinkButton href={publicHref} target="_blank">
          <EyeIcon size={14} /> View public page
        </LinkButton>
        <Button variant="ghost" onClick={copyLink}>
          <ShareIcon size={14} /> Copy link
        </Button>
        <Button variant="ghost" onClick={onDismiss}>
          Manage listing
        </Button>
      </div>
    </Card>
  );
}
