import { GuideStep, guideStepLiStyle, guideStepNoteStyle, guideStepPStyle, guideStepUlStyle } from "../../components/helpGuide/GuideStep";
import { ScreenshotPlaceholder } from "../../components/helpGuide/ScreenshotPlaceholder";
import { colors, fonts } from "../../theme";
import { HelpGuideShell } from "./HelpGuideShell";

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 24, margin: "48px 0 4px", letterSpacing: "-.01em", borderTop: `1px solid ${colors.border}`, paddingTop: 40 }}>
      {children}
    </h2>
  );
}

export function HelpGuideExplore() {
  return (
    <HelpGuideShell
      slug="explore"
      eyebrow="Help guide"
      title="Explore."
      subtitle="Everything under the Explore menu — Activities (Join a session, Adventures, Experiences) and Venues (Community centres, Sports clubs)."
    >
      <p style={guideStepPStyle}>
        Click <strong>Explore</strong> in the top nav (or the Explore tab at the bottom of the screen on mobile) to open
        this menu. It's split into three columns: <strong>Activities</strong> (things you can join right now, hosted by
        residents or vendors), <strong>Venues</strong> (places you book directly), and <strong>Featured</strong>{" "}
        (what's on this weekend, and how to become a Host).
      </p>
      <ScreenshotPlaceholder
        caption="Full-width screenshot of the open Explore megamenu, all three columns and the photo tile on the right visible, desktop width."
        alt="The Explore megamenu open, showing Activities, Venues and Featured columns"
      />

      {/* ---------- Join a session ---------- */}
      <SubHeading>Join a session</SubHeading>
      <p style={guideStepPStyle}>
        A <strong>session</strong> is an ad-hoc, informal activity — a pickup game, a one-off class, a casual meetup —
        hosted by another resident, not a business. No vendor account or venue listing is required to host or join one.
      </p>

      <GuideStep n="01" title="Open the sessions list">
        <p style={guideStepPStyle}>
          Explore → Activities → <strong>Join a session</strong> takes you to <code>/games</code>. You'll see a search
          bar ("What do you feel like doing?"), a county filter, a "when" filter (today / this week / weekend), and a
          sort control (Recommended / Soonest / Most spots left).
        </p>
        <ScreenshotPlaceholder caption="The /games page: search bar at top, filter row, and a grid of session cards below." alt="Join a session browse page" />
      </GuideStep>

      <GuideStep n="02" title="Narrow it down">
        <ul style={guideStepUlStyle}>
          <li style={guideStepLiStyle}>Type an activity into the search box (e.g. "badminton tonight") — it matches against the activity name, location and area.</li>
          <li style={guideStepLiStyle}>Use the <strong>Needs people</strong> quick filter to see only sessions close to being cancelled for lack of numbers — these are the easiest to get into and the most appreciated to join.</li>
          <li style={guideStepLiStyle}>Each card shows a badge: <em>Full</em>, <em>1 spot left</em>, or <em>N spots left</em>, plus the date/time and whether it's free or priced.</li>
        </ul>
      </GuideStep>

      <GuideStep n="03" title="Open a session and check the details">
        <p style={guideStepPStyle}>
          Tap a card to open its detail page. You'll see the date/time, location (or the venue it's attached to), who's
          hosting, how many people have joined out of capacity, the price (if any), and — closer to the day — a chat
          with the other participants.
        </p>
        <ScreenshotPlaceholder caption="A session's detail page: title, date/time/location row, host card, spots-left indicator, and the Join button." alt="Session detail page" />
      </GuideStep>

      <GuideStep n="04" title="Join">
        <p style={guideStepPStyle}>
          Press <strong>Join</strong> (or <strong>I'm in</strong>, shown when the session urgently needs more people).
          If you're not signed in yet, a quick sign-in prompt appears first — enter your email and follow the magic
          link sent to you, no password needed.
        </p>
        <div style={guideStepNoteStyle}>
          If the session has a price, you're taken to a secure Stripe checkout. Free sessions confirm your spot
          instantly with no payment step.
        </div>
      </GuideStep>

      <GuideStep n="05" title="After you've joined">
        <p style={guideStepPStyle}>
          The session now appears under <strong>My Life</strong>. From there — or from the session's own page — you
          can add it to your calendar, message the host and other participants once chat opens (24 hours before start),
          or cancel your spot if plans change. If a session is full, you can join the waitlist and you'll be notified
          automatically if a spot opens up.
        </p>
      </GuideStep>

      {/* ---------- Adventures ---------- */}
      <SubHeading>Adventures</SubHeading>
      <p style={guideStepPStyle}>
        Guided outdoor trips run by vendors — hikes, kayaking, and similar outings. Unlike a session, these are paid,
        vendor-run listings with a fixed group size and schedule.
      </p>
      <GuideStep n="01" title="Browse">
        <p style={guideStepPStyle}>
          Explore → Activities → <strong>Adventures</strong> opens <code>/adventures</code> — a grid of upcoming trips
          with a photo, title, date and price per person.
        </p>
      </GuideStep>
      <GuideStep n="02" title="Open a listing and book">
        <p style={guideStepPStyle}>
          Tapping a trip opens its detail page (same layout as Experiences, below): full description, meeting point,
          what's included, and a sticky <strong>Join</strong> card showing price and spots left. Booking follows the
          same sign-in → checkout flow as joining a session.
        </p>
        <ScreenshotPlaceholder caption="An Adventures detail page: hero photo, description, meeting-point map card, and the sticky booking card." alt="Adventure detail page" />
      </GuideStep>

      {/* ---------- Experiences ---------- */}
      <SubHeading>Experiences</SubHeading>
      <p style={guideStepPStyle}>
        Workshops, classes and one-off outings — the indoor/general-purpose counterpart to Adventures, same booking
        mechanics.
      </p>
      <GuideStep n="01" title="Browse and book">
        <p style={guideStepPStyle}>
          Explore → Activities → <strong>Experiences</strong> opens <code>/experiences</code>. Browsing, opening a
          listing, and booking work exactly like Adventures above — the only difference is the kind of thing on offer.
        </p>
      </GuideStep>

      {/* ---------- Community centres ---------- */}
      <SubHeading>Community centres</SubHeading>
      <p style={guideStepPStyle}>
        Halls and rooms you can hire directly, with real-time availability — for parties, meetings, classes, or
        anything else that needs a space.
      </p>

      <GuideStep n="01" title="Browse centres">
        <p style={guideStepPStyle}>
          Explore → Venues → <strong>Community centres</strong> opens <code>/browse/centres</code>. Filter by county,
          sort by price or distance, and each card shows the centre's capacity and starting price per hour.
        </p>
        <ScreenshotPlaceholder caption="The Community centres browse page, with the filter bar and a grid/map view toggle." alt="Community centres browse page" />
      </GuideStep>

      <GuideStep n="02" title="Open a centre's page">
        <p style={guideStepPStyle}>
          A centre's page lists every room it offers (each with its own capacity, hourly rate and photos), its opening
          hours, address and map, and reviews from past bookers. Larger centres may also list open sessions and
          multi-week Programs happening on-site.
        </p>
      </GuideStep>

      <GuideStep n="03" title="Book a room">
        <p style={guideStepPStyle}>Press <strong>Book</strong> to open <code>/book/:centreId</code>, then:</p>
        <ul style={guideStepUlStyle}>
          <li style={guideStepLiStyle}>If the centre has more than one room, pick which one first — single-room centres skip straight past this.</li>
          <li style={guideStepLiStyle}>Choose a date and an available time slot — the calendar greys out anything already booked or outside opening hours.</li>
          <li style={guideStepLiStyle}>Optionally make it an <strong>open booking</strong> — a public listing under Sessions that other residents can join and split the cost of, instead of hiring the whole room yourself.</li>
          <li style={guideStepLiStyle}>Enter your contact details, then pay online through Stripe or, where the venue allows it, pay in person/by cash.</li>
        </ul>
        <ScreenshotPlaceholder caption="The booking flow: room selector, date/time picker with a slot grid, and the contact-details + payment step." alt="Centre booking flow" />
      </GuideStep>

      <GuideStep n="04" title="Confirmation">
        <p style={guideStepPStyle}>
          You'll get an email confirmation and a QR check-in code, and the booking appears under My Life. You can
          reschedule or cancel from there, subject to the venue's own cancellation policy shown at checkout.
        </p>
      </GuideStep>

      {/* ---------- Sports clubs ---------- */}
      <SubHeading>Sports clubs</SubHeading>
      <p style={guideStepPStyle}>
        Ongoing club membership/registration — for a season, a term, or a set of lessons — run by the club itself, not
        a one-off booking.
      </p>

      <GuideStep n="01" title="Browse clubs">
        <p style={guideStepPStyle}>
          Explore → Venues → <strong>Sports clubs</strong> opens <code>/browse/clubs</code>. Filter by sport, county or
          age group; each card shows the price and how it's billed (per year, per term, per lesson or per session).
        </p>
      </GuideStep>

      <GuideStep n="02" title="Open a club's page">
        <p style={guideStepPStyle}>
          A club's page shows what's included, ages catered for, whether a free trial session is offered, and — where
          the club has set them up — its recurring weekly session times (day, time and instructor).
        </p>
        <ScreenshotPlaceholder caption="A club's page: header with price/unit, the weekly session schedule, and the Register button." alt="Sports club detail page" />
      </GuideStep>

      <GuideStep n="03" title="Register">
        <p style={guideStepPStyle}>
          Press <strong>Register</strong> to open <code>/register/:clubId</code>. Enter the participant's details
          (yourself, or a child if the club is aimed at kids — you can pick from Household members you've already
          saved), choose a weekly session slot if the club offers more than one, and pay online or in person per the
          club's own setting.
        </p>
      </GuideStep>

      <GuideStep n="04" title="If the club is full">
        <p style={guideStepPStyle}>
          You'll be offered the waitlist instead. You're notified automatically the moment a spot frees up, with a
          time-limited window to claim it before it's offered to the next person in line.
        </p>
      </GuideStep>
    </HelpGuideShell>
  );
}
