import { fetchMyHostReviews, replyToHostReview } from "../api";
import { AttendanceRequestsPanel } from "./trust/AttendanceRequestsPanel";
import { ComplaintsAboutYou } from "./workspace/ComplaintsAboutYou";
import { fetchHostComplaints, respondToHostComplaint } from "../api";
import type { HostReview } from "../api";
import { Loaded, useAdminData } from "./admin/adminUi";
import { ReviewsView } from "./workspace/ReviewParts";

// Host reviews reply (Vendor-parity pass) — a Host is already reviewable
// (badge-only trust tier) but had no way to reply. Own resident-scoped
// routes (residents.ts), not a reuse of the vendor ones, which explicitly
// exclude listing_type='host'. Same ReplyBox shape as VendorReviews.tsx.
export function HostReviewsTab() {
  const state = useAdminData<HostReview[]>(() => fetchMyHostReviews());
  return (
    <div className="adm-stack">
      <AttendanceRequestsPanel asHost />
      <Loaded state={state} title="Couldn't load your reviews">
        {(reviews) => (
          <ReviewsView
            reviews={reviews.map((r) => ({ id: r.id, name: r.name, rating: r.rating, comment: r.comment, createdAt: r.createdAt, reply: r.hostReply }))}
            replyError="Couldn't post that reply"
            onReply={async (id, reply) => {
              await replyToHostReview(id, reply);
              state.setData(reviews.map((r) => (r.id === id ? { ...r, hostReply: reply, hostRepliedAt: new Date().toISOString() } : r)));
            }}
          />
        )}
      </Loaded>
      <ComplaintsAboutYou load={fetchHostComplaints} respond={respondToHostComplaint} />
    </div>
  );
}
