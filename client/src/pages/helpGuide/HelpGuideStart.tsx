import { GuideStep, guideStepLiStyle, guideStepNoteStyle, guideStepPStyle, guideStepUlStyle } from "../../components/helpGuide/GuideStep";
import { ScreenshotPlaceholder } from "../../components/helpGuide/ScreenshotPlaceholder";
import { colors, fonts } from "../../theme";
import { HelpGuideShell } from "./HelpGuideShell";

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 24, margin: "48px 0 4px", letterSpacing: 0, borderTop: `1px solid ${colors.border}`, paddingTop: 40 }}>
      {children}
    </h2>
  );
}

export function HelpGuideStart() {
  return (
    <HelpGuideShell
      slug="start"
      eyebrow="Help guide"
      title="Start."
      subtitle="Everything under the Start menu — the ways to put something new onto HelloCircle, from hosting an activity to suggesting a place we're missing."
    >
      <p style={guideStepPStyle}>
        Click <strong>Start</strong> in the top nav (or the Start tab at the bottom of the screen on mobile) to open a
        single list: <strong>Host an activity</strong>, <strong>Start a Circle</strong>, and{" "}
        <strong>Suggest a place</strong>. <strong>Make It Happen</strong> and <strong>Book a place</strong> appear
        there too while they're available.
      </p>
      <ScreenshotPlaceholder caption="The open Start menu: Host an activity, Start a Circle, Suggest a place." alt="The Start menu open" />

      {/* ---------- Book a place ---------- */}
      <SubHeading>Book a place</SubHeading>
      <p style={guideStepPStyle}>
        Shown once community centres open on HelloCircle. This is the same Community centres flow covered in full on the{" "}
        <a href="/help-guide/explore" style={{ color: colors.greenText }}>Explore</a> page — Start just gives it a
        second, more direct entry point for when you already know you want to hire a room rather than browse first.
        It takes you straight to <code>/browse/centres</code> to pick a venue and book.
      </p>

      {/* ---------- Host an activity ---------- */}
      <SubHeading>Host an activity</SubHeading>
      <p style={guideStepPStyle}>
        This is how you host — a pickup game, a one-off class, anything you want other people to be able to join. No
        venue listing or vendor account required: pick a time and a place (your own address, a park, an existing
        venue) and it's live.
      </p>

      <GuideStep n="01" title="The basics">
        <p style={guideStepPStyle}>Opens <code>/games/host</code>, a two-step form. Step one covers what's required:</p>
        <ul style={guideStepUlStyle}>
          <li style={guideStepLiStyle}><strong>What are you planning?</strong> — a short activity name, e.g. "Beginner salsa class".</li>
          <li style={guideStepLiStyle}><strong>Venue or location</strong> — pick an existing listed centre, or just type a free-text location (your own address, a park, wherever you're meeting).</li>
          <li style={guideStepLiStyle}><strong>Date and time.</strong></li>
          <li style={guideStepLiStyle}><strong>How many players can join?</strong> — the capacity.</li>
          <li style={guideStepLiStyle}><strong>Minimum to run</strong> (optional) — require a certain number before it's confirmed rather than just "open"; you count toward this automatically as host.</li>
        </ul>
        <ScreenshotPlaceholder caption="Step 1 of Host an activity: activity name field, location/venue picker, date/time pickers, and the capacity stepper." alt="Host an activity, step 1" />
      </GuideStep>

      <GuideStep n="02" title="Everything else (all optional)">
        <p style={guideStepPStyle}>Step two — post now with none of this filled in, or add detail to help people know what to expect:</p>
        <ul style={guideStepUlStyle}>
          <li style={guideStepLiStyle}>Skill level, a longer description, duration, equipment needed, minimum age</li>
          <li style={guideStepLiStyle}>Indoor/outdoor/mixed, surface type, meeting instructions, cancellation policy</li>
          <li style={guideStepLiStyle}><strong>Price</strong> — leave at €0 for free, or set one; paid joins go through the same Stripe checkout as any other booking</li>
          <li style={guideStepLiStyle}>Visibility — public, Circle-only, or invite-only</li>
          <li style={guideStepLiStyle}>Whether it's solo-friendly</li>
        </ul>
        <ScreenshotPlaceholder caption="Step 2 of Host an activity: the optional-details fields and the final Create session button." alt="Host an activity, step 2" />
      </GuideStep>

      <GuideStep n="03" title="Once it's posted">
        <p style={guideStepPStyle}>
          Your activity is live immediately (or shows "needs players" until your minimum is met). You can edit it, post
          updates to everyone who's joined, manage participants, or cancel it from{" "}
          <a href="/help-guide/my-life" style={{ color: colors.greenText }}>My Life</a>'s Activities section.
        </p>
      </GuideStep>

      {/* ---------- Start a Circle ---------- */}
      <SubHeading>Start a Circle</SubHeading>
      <p style={guideStepPStyle}>
        A Circle is a standing group around something you do regularly — a weekly run, a book club, Sunday football.
        Start one from here and you're its organiser: you choose who can join, post plans and polls, and run it from{" "}
        <a href="/manage" style={{ color: colors.greenText }}>Manage</a>. The full walkthrough is on the{" "}
        <a href="/help-guide/circles" style={{ color: colors.greenText }}>Circles</a> page.
      </p>

      {/* ---------- Make It Happen ---------- */}
      <SubHeading>Make It Happen</SubHeading>
      <p style={guideStepPStyle}>
        Shown in the Start menu only while it's available. The opposite direction from
        hosting an activity — instead of you finding a venue yourself, tell HelloCircle what
        you want to do and it searches, prices, and proposes a real room for you, then recruits the rest of your group.
      </p>

      <GuideStep n="01" title="Describe what you want to do">
        <p style={guideStepPStyle}>Opens <code>/make-it-happen</code>. Fill in:</p>
        <ul style={guideStepUlStyle}>
          <li style={guideStepLiStyle}>What you want to do (e.g. "5-a-side football")</li>
          <li style={guideStepLiStyle}>County (optional)</li>
          <li style={guideStepLiStyle}>How many people, date, time and duration</li>
          <li style={guideStepLiStyle}>A maximum budget per person (optional)</li>
        </ul>
        <p style={guideStepPStyle}>Press <strong>Find a venue</strong> to search.</p>
      </GuideStep>

      <GuideStep n="02" title="Pick from the matches">
        <p style={guideStepPStyle}>
          Real, available rooms are returned, cheapest per person first — each showing the centre, room, capacity and
          price per person. Press <strong>Choose this</strong> on the one you want.
        </p>
        <ScreenshotPlaceholder caption="The Make It Happen results list: venue cards sorted by per-person price, each with a Choose this button." alt="Make It Happen results" />
      </GuideStep>

      <GuideStep n="03" title="Secure it">
        <p style={guideStepPStyle}>
          Enter your name, email and phone, then pay <em>your own share</em> of the total to secure the booking. The
          remaining spots open up as an Open Booking for others to join and pay their own share — the booking only
          becomes final once your full group size has signed up.
        </p>
        <div style={guideStepNoteStyle}>
          This is the same "Minimum Participation" mechanic behind an Open Booking's room hire — Make It Happen is
          just the guided, search-first way into it.
        </div>
      </GuideStep>

      {/* ---------- Suggest a place ---------- */}
      <SubHeading>Suggest a place</SubHeading>
      <p style={guideStepPStyle}>
        Know a community centre or sports club that isn't listed yet? Suggest it — this doesn't create a live listing
        itself, it flags the place for the HelloCircle team to follow up on.
      </p>

      <GuideStep n="01" title="Tell us about it">
        <p style={guideStepPStyle}>Opens <code>/suggest-place</code>. Fill in:</p>
        <ul style={guideStepUlStyle}>
          <li style={guideStepLiStyle}><strong>Place name</strong></li>
          <li style={guideStepLiStyle}><strong>Type</strong> — community centre or sports club</li>
          <li style={guideStepLiStyle}><strong>County</strong>, and area/town (optional)</li>
          <li style={guideStepLiStyle}>What it's like (optional) — what they offer, who runs it, anything that'd help find it</li>
          <li style={guideStepLiStyle}>Contact info (optional) — phone, email, or website if you know it</li>
        </ul>
        <ScreenshotPlaceholder caption="The Suggest a place form: name, type toggle, county/area fields, description and contact-info fields." alt="Suggest a place form" />
      </GuideStep>

      <GuideStep n="02" title="Track what you've suggested">
        <p style={guideStepPStyle}>
          The same page shows every suggestion you've submitted, each with a status badge, so you can see whether it's
          still pending or has been followed up on.
        </p>
      </GuideStep>
    </HelpGuideShell>
  );
}
