import { CameraIcon } from "../icons";
import { colors, fonts } from "../../theme";

// Placeholder slot for a real screenshot, dropped in later without any
// layout change — pass `src` once one exists (e.g. "/illustrations/help/
// explore-join-session.png") and this renders the actual image instead of
// the dashed placeholder. `caption` doubles as the placeholder's own label
// AND the <img>'s alt text default, so it always documents exactly what
// the shot should show even before it exists.
export function ScreenshotPlaceholder({
  caption,
  src,
  alt,
  aspect = "16/10",
}: {
  caption: string;
  src?: string;
  alt?: string;
  aspect?: string;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={alt ?? caption}
        style={{ width: "100%", aspectRatio: aspect, objectFit: "cover", borderRadius: 12, border: `1px solid ${colors.border}`, display: "block", margin: "14px 0" }}
      />
    );
  }
  return (
    <div
      style={{
        width: "100%",
        aspectRatio: aspect,
        borderRadius: 12,
        border: `1.5px dashed ${colors.borderStrong}`,
        background: colors.panel,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        margin: "14px 0",
        padding: "16px 24px",
        textAlign: "center",
      }}
    >
      <CameraIcon size={22} style={{ color: colors.faint }} />
      <div style={{ fontSize: 12.5, fontWeight: 700, color: colors.muted, letterSpacing: ".02em" }}>Screenshot placeholder</div>
      <div style={{ fontFamily: fonts.body, fontSize: 12.5, color: colors.mutedLight, maxWidth: 420, lineHeight: 1.5 }}>{caption}</div>
    </div>
  );
}
