import { Link } from "react-router-dom";
import { usePageTitle } from "../pageTitle";
import { colors, fonts } from "../theme";

// D-01 — a public link to a listing (or provider) whose organisation is
// suspended. The server answers 200 with { unavailable: true, name } and no
// booking data; this page says so plainly, without a reason (that's between
// HelloCircle and the organisation). People who already booked keep their
// booking pages and receipts under My bookings.

export type Unavailable = { id: string; name: string; unavailable: true; message: string };
export const isUnavailable = (x: unknown): x is Unavailable => !!x && typeof x === "object" && (x as { unavailable?: unknown }).unavailable === true;

export function UnavailableListing({ item, backTo = "/explore", backLabel = "Explore what's on" }: { item: Unavailable; backTo?: string; backLabel?: string }) {
  usePageTitle(item.name);
  return (
    <section className="section-pad" style={{ maxWidth: 640, margin: "0 auto", padding: "60px 24px", textAlign: "center" }} data-testid="listing-unavailable">
      <h1 style={{ fontFamily: fonts.display, fontSize: 26, margin: "0 0 10px" }}>{item.name}</h1>
      <p style={{ color: colors.muted, fontSize: 16, margin: "0 0 8px" }}>{item.message}</p>
      <p style={{ color: colors.mutedLight, fontSize: 14, margin: "0 0 20px" }}>
        It can't be booked right now. If you already have a booking, it's still in <Link to="/bookings">My bookings</Link>.
      </p>
      <Link to={backTo}>{backLabel}</Link>
    </section>
  );
}
