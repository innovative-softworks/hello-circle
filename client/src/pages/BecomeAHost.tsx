import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useGuest } from "../GuestContext";
import { HostExampleBand } from "../components/forVenues/HostExampleBand";
import { HostFinalCTA } from "../components/forVenues/HostFinalCTA";
import { HostHero } from "../components/forVenues/HostHero";
import { HostHowItWorks } from "../components/forVenues/HostHowItWorks";
import { HostWhatSection } from "../components/forVenues/HostWhatSection";
import { VendorFAQ } from "../components/forVenues/VendorFAQ";
import { trackVendorEvent } from "../forVenuesAnalytics";

const HOST_FAQS: { q: string; a: string }[] = [
  { q: "Do I need a venue or business?", a: "No — a Session or a Circle needs a time and a place to meet, not a listing. Use a park, a court, your own back garden, or an existing venue someone else already listed." },
  { q: "Is it really free?", a: "Yes. Hosting a Session or starting a Circle has no cost and no approval step — it's live as soon as you submit it." },
  { q: "What if no one shows up?", a: "You can set a minimum headcount to run, and cancel with notice if it doesn't come together — same as any real-world plan." },
  { q: "Can I charge people?", a: "Sessions and Circles are free to run. If you want to take payments, a Verified Host can open a provider account and list Programs or Experiences instead." },
  { q: "What's Verified Host?", a: "An optional badge, not a requirement — apply from your profile once you're hosting, and approved hosts get a badge shown next to their name." },
  { q: "Can I edit or cancel after I post it?", a: "Yes — you can update details or cancel a Session or Circle any time from your profile." },
];

// Split out of /for-venues (see ForVenues.tsx's own "Choose your path" fork)
// so the no-venue hosting path gets the same depth of pitch/FAQ/example the
// venue path already had on that page, instead of jumping straight from one
// line of copy into /signin. /for-venues itself is unchanged — both its
// "List your venue" and "Become a Host" CTAs still live there; this page is
// only reached by clicking through, not a replacement for it.
export function BecomeAHost() {
  const navigate = useNavigate();
  const { resident } = useGuest();
  const becomeHostHref = resident ? "/profile" : `/signin?returnTo=${encodeURIComponent("/profile")}`;

  useEffect(() => {
    trackVendorEvent("host_landing_viewed");
  }, []);

  const goToBecomeHost = (placement: string) => {
    trackVendorEvent("host_cta_clicked", { placement });
    navigate(becomeHostHref);
  };

  return (
    <div className="fade-panel">
      <HostHero onCta={() => goToBecomeHost("hero")} />
      <HostWhatSection />
      <HostHowItWorks />
      <HostExampleBand />
      <VendorFAQ
        eyebrow="Questions"
        title="Frequently asked questions"
        faqs={HOST_FAQS}
        onOpen={(question) => trackVendorEvent("host_faq_opened", { question })}
      />
      <HostFinalCTA onPrimaryCta={() => goToBecomeHost("final_cta")} />
    </div>
  );
}
