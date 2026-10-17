import { ApiError, fetchVendorReviews, replyToVendorReview } from "../api";
import { ComplaintsAboutYou } from "./workspace/ComplaintsAboutYou";
import { fetchVendorComplaints, respondToVendorComplaint } from "../api";
import type { VendorReview } from "../api";
import { Loaded, useAdminData } from "./admin/adminUi";
import { ReviewsView } from "./workspace/ReviewParts";

// Host Manage spec §16 — a vendor-facing reviews tab didn't exist at all;
// reviews.ts only ever supported guest post + admin hide/unhide. Added as a
// new top-level VendorDashboard tab rather than nested under a "More"
// submenu — no such submenu exists in this dashboard's flat-tab pattern
// today, and building one is unrelated scope.
export function VendorReviewsTab() {
  const state = useAdminData<VendorReview[]>(() => fetchVendorReviews());
  return (
    <div className="adm-stack">
      <Loaded state={state} title="Couldn't load your reviews">
        {(reviews) => (
          <ReviewsView
            reviews={reviews.map((r) => ({ id: r.id, name: r.name, rating: r.rating, comment: r.comment, createdAt: r.createdAt, listingName: r.listingName, reply: r.vendorReply }))}
            replyError="You don't have permission to reply — this needs the communications role."
            onReply={async (id, reply) => {
              try {
                await replyToVendorReview(id, reply);
              } catch (e) {
                if (e instanceof ApiError && e.status === 403) throw new Error("You don't have permission to reply — this needs the communications role.");
                throw e;
              }
              state.setData(reviews.map((r) => (r.id === id ? { ...r, vendorReply: reply, vendorRepliedAt: new Date().toISOString() } : r)));
            }}
          />
        )}
      </Loaded>
      <ComplaintsAboutYou load={fetchVendorComplaints} respond={respondToVendorComplaint} />
    </div>
  );
}
