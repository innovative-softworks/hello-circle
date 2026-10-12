import { trackEvent } from "./analytics";

// Centralized event catalog (onboarding audit, consent/funnel pass) — every
// onboarding/signup call site imports a named constant plus a typed
// property shape from here instead of hand-typing event-name strings and ad
// hoc property bags. This is what makes "never send PII to analytics"
// actually enforceable: a property shape that has no field for name, email,
// address, DOB, medical information or free text cannot silently acquire
// one at a call site — only the enum-like, non-identifying values declared
// below (a step name, a signup method, a coarse error reason) are ever
// accepted. Pushes onto the same consent-gated window.dataLayer trackEvent()
// already uses (see analytics.ts) — nothing is sent anywhere until
// loadGoogleTagManager() has actually run, which only happens after
// CookieNotice's own consent gate.

export const AnalyticsEvent = {
  ResidentSignupStarted: "resident_signup_started",
  ResidentAccountCreated: "resident_account_created",
  ResidentSignupError: "resident_signup_error",
  ResidentAccountCompletionRequired: "resident_account_completion_required",
  ResidentAccountCompletionCompleted: "resident_account_completion_completed",
  OnboardingStarted: "onboarding_started",
  OnboardingStepViewed: "onboarding_step_viewed",
  OnboardingStepCompleted: "onboarding_step_completed",
  OnboardingSkipped: "onboarding_skipped",
  OnboardingCompleted: "onboarding_completed",
  VendorSignupStarted: "vendor_signup_started",
  VendorSignupStepCompleted: "vendor_signup_step_completed",
  VendorSignupValidationFailed: "vendor_signup_validation_failed",
  VendorSignupCompleted: "vendor_signup_completed",
  VendorSignupError: "vendor_signup_error",
  InvitationAccepted: "invitation_accepted",
  InvitationAcceptError: "invitation_accept_error",
  // Stage 5f — plan, rewards and customer credit (coarse properties only).
  PlanExplorePro: "plan_explore_pro",
  PlanCheckoutStarted: "plan_checkout_started",
  PlanCheckoutReturned: "plan_checkout_returned",
  PlanCancel: "plan_cancel",
  PlanKeep: "plan_keep",
  PlanBillingPortal: "plan_billing_portal",
  RewardsRedeemed: "rewards_redeemed",
  RewardsHistoryViewed: "rewards_history_viewed",
  CreditApplied: "credit_applied",
  CouponApplied: "coupon_applied",
  CouponRejected: "coupon_rejected",
} as const;

export type AnalyticsEventName = (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent];

type SignupMethod = "password" | "google" | "magic_link";
type OnboardingStepName = "location" | "interests";
type ValidationField = "name" | "email" | "password";
/** Coarse only, never the raw server/error message — a message string could
 * change to include user-entered content later without anyone noticing it
 * started leaking to analytics (see this catalog's own module comment). */
type ErrorReason = "network" | "server" | "validation";

interface AnalyticsPropsMap {
  [AnalyticsEvent.ResidentSignupStarted]: undefined;
  [AnalyticsEvent.ResidentAccountCreated]: { method: SignupMethod };
  [AnalyticsEvent.ResidentSignupError]: { method: SignupMethod; reason: ErrorReason };
  [AnalyticsEvent.ResidentAccountCompletionRequired]: { method: SignupMethod };
  [AnalyticsEvent.ResidentAccountCompletionCompleted]: { method: SignupMethod };
  [AnalyticsEvent.OnboardingStarted]: undefined;
  [AnalyticsEvent.OnboardingStepViewed]: { step: OnboardingStepName };
  [AnalyticsEvent.OnboardingStepCompleted]: { step: OnboardingStepName };
  [AnalyticsEvent.OnboardingSkipped]: { step: OnboardingStepName; hadPartialAnswers: boolean };
  [AnalyticsEvent.OnboardingCompleted]: undefined;
  [AnalyticsEvent.VendorSignupStarted]: undefined;
  [AnalyticsEvent.VendorSignupStepCompleted]: { step: 1; method: SignupMethod };
  [AnalyticsEvent.VendorSignupValidationFailed]: { step: 1; field: ValidationField };
  [AnalyticsEvent.VendorSignupCompleted]: { vendorType: string; method: SignupMethod };
  [AnalyticsEvent.VendorSignupError]: { reason: ErrorReason };
  [AnalyticsEvent.InvitationAccepted]: { platformRole: string };
  [AnalyticsEvent.InvitationAcceptError]: { reason: ErrorReason };
  [AnalyticsEvent.PlanExplorePro]: { scope: PartnerScope; from: "dashboard" | "earnings" };
  [AnalyticsEvent.PlanCheckoutStarted]: { scope: PartnerScope; reused: boolean };
  [AnalyticsEvent.PlanCheckoutReturned]: { scope: PartnerScope; outcome: "success" | "cancelled" };
  [AnalyticsEvent.PlanCancel]: { scope: PartnerScope };
  [AnalyticsEvent.PlanKeep]: { scope: PartnerScope };
  [AnalyticsEvent.PlanBillingPortal]: { scope: PartnerScope; state: string };
  [AnalyticsEvent.RewardsRedeemed]: { scope: PartnerScope };
  [AnalyticsEvent.RewardsHistoryViewed]: { scope: PartnerScope };
  [AnalyticsEvent.CreditApplied]: { coversAll: boolean };
  [AnalyticsEvent.CouponApplied]: undefined;
  [AnalyticsEvent.CouponRejected]: { reason: "invalid" | "expired" | "limit" | "not_applicable" | "other" };
}
type PartnerScope = "vendor" | "host";

export function trackTypedEvent<K extends AnalyticsEventName>(event: K, props?: AnalyticsPropsMap[K]): void {
  trackEvent(event, props as Record<string, unknown> | undefined);
}
