import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { ChooseYourPathSection } from "../components/forVenues/ChooseYourPathSection";
import { ComingSoonBanner } from "../components/forVenues/ComingSoonBanner";
import { ComingSoonSection } from "../components/forVenues/ComingSoonSection";
import { FoundingVenueSection } from "../components/forVenues/FoundingVenueSection";
import { ProviderTypeGrid } from "../components/forVenues/ProviderTypeGrid";
import { VendorBenefitStrip } from "../components/forVenues/VendorBenefitStrip";
import { VendorFAQ } from "../components/forVenues/VendorFAQ";
import { VendorFinalCTA } from "../components/forVenues/VendorFinalCTA";
import { VendorHero } from "../components/forVenues/VendorHero";
import { VendorHowItWorks } from "../components/forVenues/VendorHowItWorks";
import { VendorProductPreview } from "../components/forVenues/VendorProductPreview";
import { trackVendorEvent } from "../forVenuesAnalytics";

const HOW_IT_WORKS_ID = "how-it-works";

// CTA destination preserves intent through auth (brief §19/21): a vendor or
// admin who's already signed in skips the "why join" pitch and the signup
// form entirely, straight to where they'd actually create a listing;
// everyone else (guest, resident, or fully signed out) goes to the existing
// account-creation flow at /vendor/signup — no separate account system.
export function ForVenues() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const ctaHref = user && (user.role === "admin" || user.role === "vendor") ? "/vendor" : "/vendor/signup";

  useEffect(() => {
    trackVendorEvent("vendor_landing_viewed");
  }, []);

  // Deep links from Footer.tsx ("How it works" → /for-venues#how-it-works)
  // land here with the hash already set — React Router doesn't auto-scroll
  // to a hash on its own, so this does it once the section has rendered.
  useEffect(() => {
    if (location.hash === `#${HOW_IT_WORKS_ID}`) {
      document.getElementById(HOW_IT_WORKS_ID)?.scrollIntoView({ block: "start" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.hash]);

  const goToCta = (placement: string) => {
    trackVendorEvent("vendor_list_cta_clicked", { placement });
    navigate(ctaHref);
  };

  const scrollToHowItWorks = () => {
    trackVendorEvent("vendor_how_it_works_clicked");
    document.getElementById(HOW_IT_WORKS_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Rather than jumping straight to /signin (barely any explanation of what
  // hosting actually involves behind it), this now goes to /become-a-host —
  // its own dedicated page with a hero/examples/FAQ, same depth the venue
  // path already gets from this page itself, before the real sign-in CTA.
  const goToBecomeHost = (placement: string) => {
    trackVendorEvent("vendor_become_host_clicked", { placement });
    navigate("/become-a-host");
  };

  return (
    <div className="fade-panel">
      <ComingSoonBanner />
      <VendorHero onPrimaryCta={() => goToCta("hero")} onBecomeHostCta={() => goToBecomeHost("hero")} />
      <ComingSoonSection />
      <VendorBenefitStrip />
      <ProviderTypeGrid onLearnMore={scrollToHowItWorks} />
      <ChooseYourPathSection onListVenueCta={() => goToCta("choose_your_path")} onBecomeHostCta={() => goToBecomeHost("choose_your_path")} />
      <VendorProductPreview />
      <FoundingVenueSection onCta={() => goToCta("founding_venues")} />
      <VendorHowItWorks id={HOW_IT_WORKS_ID} />
      <VendorFAQ onOpen={(question) => trackVendorEvent("vendor_faq_opened", { question })} />
      <VendorFinalCTA onPrimaryCta={() => goToCta("final_cta")} />
    </div>
  );
}
