import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BookOpen, ChevronDown, Mail, MessageSquareWarning, SearchX } from "lucide-react";
import { useUrlParam } from "../../useUrlTab";
import { accountHref } from "./accountSections";
import { AccountEmpty, AccountPage, AccountSection, Chip, SearchField } from "./accountUi";

// Help & support. Support is email + the Contact and Complaints pages; there
// is no ticket system or live chat, so none is offered. Answers were checked
// against the current product (2026-10-24): bookings are their own pages,
// Verified Host is applied for under Hosting, and some refunds are automatic
// (D-10), so the old "refunds are never automatic" answer was removed.

type Topic = "bookings" | "payments" | "account" | "circles" | "hosting" | "safety";
const TOPICS: { key: Topic; label: string }[] = [
  { key: "bookings", label: "Bookings" },
  { key: "payments", label: "Payments & refunds" },
  { key: "account", label: "Your account" },
  { key: "circles", label: "Circles & Sessions" },
  { key: "hosting", label: "Hosting" },
  { key: "safety", label: "Safety" },
];

type Faq = { topic: Topic; q: string; a: ReactNode; text: string };
const L = ({ to, children }: { to: string; children: ReactNode }) => <Link to={to}>{children}</Link>;

const FAQS: Faq[] = [
  { topic: "bookings", q: "Where do I find my bookings?", text: "my life bookings registrations tickets", a: <>Everything you've booked or joined is in <L to="/bookings">My Life</L>. Open one to see the details, directions and what you can change.</> },
  { topic: "bookings", q: "How do I cancel a booking?", text: "cancel booking registration", a: <>Open the booking in <L to="/bookings">My Life</L> and choose Cancel. Whether you get money back depends on the venue's or club's cancellation terms, which are shown before you pay.</> },
  { topic: "bookings", q: "I booked without signing in. Where is it?", text: "guest booking email link sign in", a: <>Use the link in your confirmation email, or sign in with the same email address. Bookings made on this device also show in <L to="/bookings">My Life</L>.</> },
  { topic: "payments", q: "When will I get a refund?", text: "refund money back cancel", a: <>Refunds follow the cancellation terms shown before you paid. Once a refund is made, it shows on the receipt in <L to={"/profile?tab=payment&view=receipts"}>Receipts</L>. If you think you're owed one and it hasn't appeared, email us with the receipt reference.</> },
  { topic: "payments", q: "How do I get my money back?", text: "money back refund contact venue club", a: <>Start with the venue or club: their cancellation terms were shown before you paid, and you can reach them through your booking confirmation email. Some refunds are made automatically. If you don't hear back, email us with the reference from <L to="/profile?tab=payment&view=receipts">Receipts</L>.</> },
  { topic: "payments", q: "How do I get a receipt?", text: "receipt invoice pdf print", a: <>Every payment is in <L to={"/profile?tab=payment&view=receipts"}>Receipts</L>. Open one to see the breakdown, then print it or save it as a PDF.</> },
  { topic: "payments", q: "Is my card safe?", text: "card security stripe saved card", a: <>Card details are handled by Stripe, our payment provider. We only see the card type, the last four digits and the expiry date. Manage saved cards in <L to={accountHref("payment")}>Payment methods</L>.</> },
  { topic: "payments", q: "What is a pass?", text: "pass credits pack club", a: <>Some clubs sell a pack of session credits. You use a credit when you register for a session at that club. See what's left in <L to={"/profile?tab=payment&view=passes"}>Passes</L>.</> },
  { topic: "account", q: "Do I need a password?", text: "password email link google sign in", a: <>No. You can always sign in with a link sent to your email. You can also add a password or link Google in <L to={accountHref("security")}>Sign-in & data</L>.</> },
  { topic: "account", q: "I'm not getting emails from you", text: "email not received spam verify", a: <>Check your spam folder, then make sure your email is confirmed in <L to={accountHref("security")}>Sign-in & data</L>. You can resend the confirmation from there.</> },
  { topic: "account", q: "How do I delete my account or my data?", text: "delete account data gdpr deactivate erasure", a: <>Go to <L to={"/profile?tab=security"}>Your data & account</L>. Deactivating hides you and can be undone by signing in again. To have your data deleted, choose “Ask us about your data” there.</> },
  { topic: "account", q: "Can I book for my children?", text: "children kids household family register", a: <>Yes. Add them once in <L to={accountHref("household")}>Household</L> and pick them when you register for a club.</> },
  { topic: "circles", q: "What's a Circle?", text: "circle group regular", a: <>An ongoing group around a shared activity, like a weekly run or a book club, organised by one of its own members. Browse them in <L to="/circles">Circles</L>.</> },
  { topic: "circles", q: "What's a Session?", text: "session game meet up one-off", a: <>A one-off activity anyone can host, like a Saturday kickabout. Find them on <L to="/explore">Explore</L>.</> },
  { topic: "hosting", q: "Do I need approval to host?", text: "host approval free session circle", a: <>No. Hosting a Session or starting a Circle is free and goes live as soon as you post it. See <L to={accountHref("hosting")}>Hosting</L>.</> },
  { topic: "hosting", q: "What is Verified Host?", text: "verified host badge apply", a: <>An optional badge. Apply from <L to={accountHref("hosting")}>Hosting</L>; our team reviews it, and approved hosts get a badge next to their name.</> },
  { topic: "safety", q: "How do I report a problem?", text: "report abuse unsafe spam", a: <>Use Report on the Session, Circle, listing, profile, review or chat message. Follow its status in the <L to={"/profile?tab=privacy"}>Safety Centre</L>.</> },
  { topic: "safety", q: "How do I block someone?", text: "block person chat", a: <>Block them from a Circle's or Session's chat. Manage everyone you've blocked in the <L to={"/profile?tab=privacy"}>Safety Centre</L>.</> },
];

export function HelpPage() {
  const [q, setQ] = useUrlParam<string>("q", "");
  const [topic, setTopic] = useUrlParam<string>("topic", "all");

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return FAQS.filter((f) => (topic === "all" || f.topic === topic) && (!needle || `${f.q} ${f.text}`.toLowerCase().includes(needle)));
  }, [q, topic]);

  return (
    <AccountPage eyebrow="Support" title="Help & support" lede="Quick answers, and how to reach a person when you need one." narrow>
      <div className="acct-toolbar" style={{ marginTop: 24 }}>
        <SearchField value={q} onChange={setQ} label="Search help" placeholder="Search, e.g. refund, password, cancel" />
      </div>
      <div className="acct-topics" role="group" aria-label="Topics">
        <Chip pressed={topic === "all"} onClick={() => setTopic("all")}>All topics</Chip>
        {TOPICS.map((t) => (
          <Chip key={t.key} pressed={topic === t.key} onClick={() => setTopic(t.key)}>{t.label}</Chip>
        ))}
      </div>

      <AccountSection>
        {shown.length === 0 ? (
          <AccountEmpty icon={<SearchX size={20} aria-hidden="true" />} title={q.trim() ? `No answers for “${q.trim()}”` : "No answers in this topic"}>
            Try another word, or email us at support@hellocircle.ie and we'll help.
          </AccountEmpty>
        ) : (
          <div className="acct-faq" aria-live="polite">
            {shown.map((f) => (
              <details key={f.q}>
                <summary>
                  {f.q}
                  <ChevronDown size={18} aria-hidden="true" />
                </summary>
                <div className="acct-faq-a">{f.a}</div>
              </details>
            ))}
          </div>
        )}
      </AccountSection>

      <AccountSection title="Still need help?">
        <div className="acct-cols">
          <div className="acct-col">
            <h3><Mail size={16} aria-hidden="true" style={{ verticalAlign: "-3px", marginRight: 6 }} />Email us</h3>
            <p>Write to <a href="mailto:support@hellocircle.ie">support@hellocircle.ie</a>. Include a booking or receipt reference if you have one.</p>
          </div>
          <div className="acct-col">
            <h3><BookOpen size={16} aria-hidden="true" style={{ verticalAlign: "-3px", marginRight: 6 }} />Guides</h3>
            <p>Step-by-step guides to exploring, Circles and My Life are in the <Link to="/help-guide">help guide</Link>.</p>
          </div>
          <div className="acct-col">
            <h3><MessageSquareWarning size={16} aria-hidden="true" style={{ verticalAlign: "-3px", marginRight: 6 }} />Make a complaint</h3>
            <p>Not happy with how something was handled? See <Link to="/complaints">complaints</Link>, or all our <Link to="/contact">contact details</Link>.</p>
          </div>
        </div>
      </AccountSection>
    </AccountPage>
  );
}
