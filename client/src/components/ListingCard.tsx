import type { CSSProperties, ReactNode } from "react";
import { Photo } from "./Photo";
import { CardLink } from "./ui";
import { cardImageRatio, colors, photoOverlay, radius } from "../theme";

// ListingCard — the one card shape for every listing across the app
// (design-system consistency pass, 2026-10-12). It keeps the card style the
// app's listing pages already used (CentreCard / ClubCard / browse cards):
// bordered white card, 4:3 photo with a small white badge bottom-left and
// the save heart top-right, 17px title, muted detail lines, then price on
// the left and a compact dark button on the right. Each card component keeps
// its own data and actions and passes them in; the Circles page cards are
// styled to match this (circlesPage.css).
//
//   photo · urgency pill top-left · badge bottom-left · save top-right
//   title · details · extra content · footer (facts left, action right)

export interface ListingCardDetail {
  icon?: ReactNode;
  text: ReactNode;
  tone?: "default" | "hot";
}

export function ListingCard({
  href,
  title,
  image,
  imageAlt,
  ph,
  icon,
  iconColor,
  tag,
  status,
  save,
  details,
  facts,
  action,
  children,
  sharedImage = true,
  headingLevel = 3,
}: {
  href: string;
  title: string;
  /** Title heading level. 3 under a section heading (the default); 2 when the
   * cards sit directly under the page's H1 (no skipped levels, HC-QA-083). */
  headingLevel?: 2 | 3;
  image?: string | null;
  imageAlt?: string;
  /** Placeholder background when there's no photo. */
  ph: string;
  icon?: ReactNode;
  iconColor?: string;
  /** Category/type, shown as a pill top-left of the photo. */
  tag?: ReactNode;
  /** Urgency/status (e.g. "2 spots left", "Today"), bottom-left of the photo. */
  status?: { label: ReactNode; tone?: "hot" | "calm" } | null;
  /** A <SaveButton/> (absolutely positioned top-right). */
  save?: ReactNode;
  details?: (ListingCardDetail | null | false | undefined)[];
  /** Price / availability / going — one bold row above the action. */
  facts?: ReactNode;
  /** The single action — a full-width <Button full/>. */
  action?: ReactNode;
  children?: ReactNode;
  sharedImage?: boolean;
}) {
  return (
    <div className="card-hover card-surface listing-card" style={shellStyle}>
      <CardLink to={href} label={title} sharedImage={sharedImage} />
      <Photo
        src={image ?? undefined}
        alt={imageAlt ?? title}
        ph={ph}
        icon={icon}
        iconColor={iconColor}
        style={{ aspectRatio: cardImageRatio.discovery }}
        contentStyle={{ display: "flex", alignItems: "flex-end", padding: 12 }}
      >
        {status ? <span style={status.tone === "calm" ? statusCalmStyle : statusHotStyle}>{status.label}</span> : null}
        {tag ? (
          <span className="card-photo-badge" style={badgeStyle}>
            {tag}
          </span>
        ) : null}
        {save}
      </Photo>
      <div style={bodyStyle}>
        {headingLevel === 2 ? <h2 style={titleStyle}>{title}</h2> : <h3 style={titleStyle}>{title}</h3>}
        {details
          ?.filter((d): d is ListingCardDetail => !!d)
          .map((d, i) => (
            <div key={i} style={d.tone === "hot" ? { ...detailStyle, color: colors.orangeDark, fontWeight: 700 } : detailStyle}>
              {d.icon ? <span style={detailIconStyle}>{d.icon}</span> : null}
              <span>{d.text}</span>
            </div>
          ))}
        {children}
        {(facts || action) && (
          <div style={footerStyle}>
            <div style={factsStyle}>{facts}</div>
            {action ? <div className="stretched-link-above" style={actionStyle}>{action}</div> : null}
          </div>
        )}
      </div>
    </div>
  );
}

/** The compact card button (same as the original CentreCard/ClubCard CTA). */
export const cardButtonStyle: CSSProperties = { padding: "8px 16px", fontSize: 13 };

/** Price in the shared card style (bold, body colour). */
export function CardPrice({ children }: { children: ReactNode }) {
  return <span style={{ color: colors.text, fontWeight: 700, fontSize: 15 }}>{children}</span>;
}

const shellStyle: CSSProperties = {
  position: "relative",
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.card,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  height: "100%",
};

// Photo pills sit on a photo, not the page, so they keep fixed colours in
// both themes.
const badgeStyle: CSSProperties = {
  maxWidth: "calc(100% - 8px)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  background: "rgba(255,255,255,.9)",
  color: "#172019",
  borderRadius: radius.control,
  padding: "4px 9px",
  fontSize: 12,
  fontWeight: 700,
  transition: "background-color .2s ease, color .2s ease",
};

const statusHotStyle: CSSProperties = {
  position: "absolute",
  top: 10,
  left: 10,
  zIndex: 1,
  background: photoOverlay.goldBg,
  color: photoOverlay.goldText,
  borderRadius: radius.pill,
  padding: "4px 11px",
  fontSize: 11.5,
  fontWeight: 800,
  pointerEvents: "none",
};

const statusCalmStyle: CSSProperties = { ...statusHotStyle, background: photoOverlay.whiteBg, color: "#172019" };

const bodyStyle: CSSProperties = { padding: "16px 18px 18px", flex: 1, display: "flex", flexDirection: "column" };

const titleStyle: CSSProperties = { fontSize: 17, fontWeight: 700, lineHeight: 1.25, margin: "0 0 4px", letterSpacing: 0, color: colors.text };

const detailStyle: CSSProperties = { display: "flex", alignItems: "flex-start", gap: 5, fontSize: 14, lineHeight: 1.4, color: colors.mutedLight, marginBottom: 2 };

const detailIconStyle: CSSProperties = { display: "inline-flex", flex: "none", marginTop: 3, color: colors.faint };

const footerStyle: CSSProperties = { marginTop: "auto", paddingTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 };

const factsStyle: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 10px", fontSize: 13, fontWeight: 600, color: colors.muted, minWidth: 0 };

const actionStyle: CSSProperties = { marginLeft: "auto" };
