// Readable descriptions for audit_log action codes (admin redesign,
// 2026-10-14). The raw code, object and values stay available in the
// "Technical details" disclosure — this only changes the headline. Unknown
// codes fall back to a mechanical "Domain: verb phrase" so a newly added
// server action still reads sensibly without touching this file.

const ACTIONS: Record<string, string> = {
  "vendor.status_changed": "Changed a partner account's status",
  "vendor.platform_role_changed": "Changed a staff member's platform role",
  "resident.host_status_changed": "Decided a Verified Host application",
  "place_suggestion.approved": "Approved and published a place suggestion",
  "place_suggestion.rejected": "Rejected a place suggestion",
  feature: "Featured a listing",
  unfeature: "Removed a listing from featured",
  suspend_by_report: "Suspended reported content",
  "coupon.created": "Created a coupon",
  "coupon.paused": "Paused a coupon",
  "coupon.resumed": "Resumed a coupon",
  "coupon.archived": "Archived a coupon",
  "org.flag_changed": "Changed an organisation's feature flag",
  "org.staff_invited": "Invited staff to an organisation",
  "org.staff_invite_revoked": "Revoked a staff invitation",
  "org.profile_updated": "Updated an organisation profile",
  "org.policies_updated": "Updated an organisation's policies",
  "org.logo_updated": "Updated an organisation logo",
  "admin.role_changed": "Changed an admin's role",
  "recommendation_weights.updated": "Updated For You recommendation weights",
  "market_category.changed": "Changed a market category",
  "demand.intents_notified": "Notified residents about matching demand",
  "notification_template.updated": "Edited a notification template",
  "notification_template.reset": "Reset a notification template to default",
  "media.editorial_uploaded": "Uploaded an editorial image",
  "media.editorial_deleted": "Deleted an editorial image",
  "config.maps_enabled_changed": "Changed the maps setting",
  "config.media_uploads_enabled_changed": "Changed the media uploads setting",
  "help.updated": "Updated field help",
  "policy.draft_created": "Created a policy draft",
  "policy.draft_updated": "Updated a policy draft",
  "policy.placeholder_set": "Set a policy placeholder value",
  "trader_profile.verification": "Recorded a trader verification decision",
  "trader_profile.updated": "Updated a trader profile",
  "credits.granted": "Granted customer credit",
  "rewards.adjusted": "Adjusted reward points",
  "rewards.redeemed": "Redeemed reward points",
  "refund.issued_by_admin": "Issued a refund (admin)",
  "refund.issued_by_vendor": "Issued a refund (partner)",
  "settlement.run": "Ran settlement",
  "connect.transfers_run": "Ran partner transfers",
  "connect.account_created": "Created a payout account",
  "webhook.replayed": "Replayed a payment event",
  "dispute.recovery_decided": "Decided a dispute recovery",
  "partner_debt.opened": "Opened a partner debt",
  "partner_debt.offset": "Offset a partner debt",
  "partner_debt.recovery_attempted": "Attempted partner debt recovery",
  "plan.assigned": "Assigned a plan",
  "promotion.created": "Created a promotion",
  "promotion.enrolled": "Enrolled a partner in a promotion",
  "manage.switched_workspace": "Switched workspace",
  "manage.linked_resident": "Linked a partner account to a resident account",
  "manage.host_became_provider": "Host opened a provider account",
  "invitation.revoked": "Revoked an invitation",
  "room.created": "Created a room",
  "room.updated": "Updated a room",
  "centre.status_changed": "Changed a community centre's review status",
  "club.status_changed": "Changed a sports club's review status",
  "experience.status_changed": "Changed an experience's review status",
  "centre.published": "Submitted a community centre for review",
  "club.published": "Submitted a sports club for review",
  "experience.published": "Submitted an experience for review",
  "centre.updated_by_admin": "Edited a community centre (admin)",
  "club.updated_by_admin": "Edited a sports club (admin)",
  "centre.deleted_by_admin": "Deleted a community centre (admin)",
  "club.deleted_by_admin": "Deleted a sports club (admin)",
  "centre.organisation_assigned": "Assigned a community centre to an organisation",
  "club.organisation_assigned": "Assigned a sports club to an organisation",
  "claim.approved": "Approved a listing claim",
  "claim.rejected": "Rejected a listing claim",
  "review.hidden": "Hid a review",
  "review.unhidden": "Restored a hidden review",
  "organisation.created": "Created an organisation",
  "vendor.provider_tier_changed": "Changed a partner's provider tier",
};

const OBJECTS: Record<string, string> = {
  user: "account",
  centre: "community centre",
  club: "sports club",
  experience: "experience",
  coupon: "coupon",
  organisation: "organisation",
  resident_host_application: "host application",
  notification_template: "notification template",
  app_setting: "setting",
  market_category: "market category",
  review: "review",
};

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function describeAuditAction(action: string): string {
  if (ACTIONS[action]) return ACTIONS[action];
  const [domain, verb] = action.includes(".") ? action.split(".", 2) : ["", action];
  const words = (s: string) => s.replace(/_/g, " ").trim();
  return verb ? sentence(`${words(verb)}${domain ? ` · ${words(domain)}` : ""}`) : sentence(words(action));
}

export function describeObject(objectType: string): string {
  return OBJECTS[objectType] ?? objectType.replace(/_/g, " ");
}

/** Values are stored as JSON strings; show short scalars inline, else null. */
export function shortValue(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
    return null;
  } catch {
    return raw.length <= 40 ? raw : null;
  }
}
