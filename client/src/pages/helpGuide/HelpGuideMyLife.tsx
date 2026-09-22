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

export function HelpGuideMyLife() {
  return (
    <HelpGuideShell
      slug="my-life"
      eyebrow="Help guide"
      title="My Life."
      subtitle="Everything you've booked, joined, saved and organised, in one place — and, one level in, your account settings."
    >
      <p style={guideStepPStyle}>
        Click <strong>My Life</strong> in the top nav (or the tab at the bottom of the screen on mobile) to open{" "}
        <code>/bookings</code>. You don't strictly need an account — every booking or registration you make as a guest
        is tracked in your browser automatically, so "My Life" already works without signing in. Signing in with a
        magic link (just your email, no password) adds your bookings to your account so they follow you across devices.
      </p>
      <ScreenshotPlaceholder caption="The My Life hub: 'Next up' card, a this-month calendar strip, and rows for Circles/Saved/Recent activity below." alt="My Life hub page" />

      <SubHeading>What's on the hub</SubHeading>

      <GuideStep n="01" title="Next up">
        <p style={guideStepPStyle}>
          The single next thing on your calendar — a booking or a session — shown right at the top with its date, time
          and location, so you never have to hunt for "what am I doing next."
        </p>
      </GuideStep>

      <GuideStep n="02" title="This month">
        <p style={guideStepPStyle}>A compact calendar of everything you've got coming up in the current month, at a glance.</p>
      </GuideStep>

      <GuideStep n="03" title="Circles, Saved, and Following">
        <ul style={guideStepUlStyle}>
          <li style={guideStepLiStyle}><strong>Circles</strong> — the groups you're a member of or organise.</li>
          <li style={guideStepLiStyle}><strong>Saved</strong> — centres, clubs, sessions and Experiences you've favourited from their own pages.</li>
          <li style={guideStepLiStyle}><strong>Following</strong> — hosts or providers you follow, so their new listings surface here.</li>
        </ul>
      </GuideStep>

      <GuideStep n="04" title="Worth doing again">
        <p style={guideStepPStyle}>
          A "do it again?" prompt for activities you've enjoyed before, matched against what's currently open — a
          quick way back into something you already know you like.
        </p>
      </GuideStep>

      <GuideStep n="05" title="View full activity">
        <p style={guideStepPStyle}>
          Below the hub, "View full activity" opens the complete, unabridged list: every booking, registration, session
          joined or hosted, and Circle membership — with cancel, reschedule, QR check-in, and review actions on each.
        </p>
      </GuideStep>

      <SubHeading>Account settings</SubHeading>
      <p style={guideStepPStyle}>
        "Edit profile" from My Life opens <code>/profile</code> — a dashboard-style settings area with its own tabs
        down the side (or in a menu on mobile):
      </p>

      <GuideStep n="01" title="Profile">
        <p style={guideStepPStyle}>Your name, photo, and basic details.</p>
      </GuideStep>
      <GuideStep n="02" title="Household">
        <p style={guideStepPStyle}>
          Save family members (useful for club registrations — pick a saved child instead of re-typing their details
          every time) and your interests/availability, used to personalise recommendations.
        </p>
      </GuideStep>
      <GuideStep n="03" title="Notifications">
        <p style={guideStepPStyle}>
          Turn specific email/in-app notification types on or off — booking confirmations, reminders, waitlist offers,
          activity reminders, routine nudges, and discovery emails, each controlled independently.
        </p>
      </GuideStep>
      <GuideStep n="04" title="Payments &amp; Passes">
        <p style={guideStepPStyle}>Saved payment history and any multi-visit Passes you hold with a centre or club.</p>
      </GuideStep>
      <GuideStep n="05" title="Receipts">
        <p style={guideStepPStyle}>
          Every paid booking, registration, session, pass or program enrolment, with a downloadable receipt for each.
        </p>
      </GuideStep>
      <GuideStep n="06" title="Safety Centre">
        <p style={guideStepPStyle}>Where you track the outcome of any report you've filed on a listing, review, or chat message.</p>
      </GuideStep>
      <GuideStep n="07" title="Help &amp; Support">
        <p style={guideStepPStyle}>
          A quick FAQ (cancellations, refunds, what a Circle is, Verified Host) — this full guide goes further into the
          "how", the FAQ is for quick answers.
        </p>
      </GuideStep>

      <SubHeading>Managing something you're hosting</SubHeading>
      <GuideStep n="01" title="Activities you've hosted">
        <p style={guideStepPStyle}>
          If you've ever hosted a session, a <strong>Manage hosting</strong> entry appears in your account menu,
          opening your <code>/manage</code> dashboard's Activities tab. From there you can edit a session's details,
          post an update to everyone who's joined, see and manage the participant list, or cancel it.
        </p>
        <ScreenshotPlaceholder caption="The Manage dashboard's Activities tab: a list of hosted sessions, each with Participants / Edit / Post update / Cancel actions." alt="Manage Activities tab" />
      </GuideStep>
      <GuideStep n="02" title="A Circle you organise">
        <p style={guideStepPStyle}>
          Circles you organise get their own "Manage {"{Circle name}"}" entry in the same menu, opening its
          management page — covered in detail on the <a href="/help-guide/circles" style={{ color: colors.greenText }}>Circles</a> page.
        </p>
      </GuideStep>

      <SubHeading>Finding a booking without signing in</SubHeading>
      <GuideStep n="01" title="Look it up by reference">
        <p style={guideStepPStyle}>
          Lost your confirmation email but never signed in? My Life includes a "find my booking" lookup — enter the
          booking reference (from your confirmation email) plus the email address you booked with, and it's pulled up
          and reattached to your browser.
        </p>
        <div style={guideStepNoteStyle}>
          Every confirmation email also links straight back to My Life with the reference pre-filled, so in practice
          you usually just click the link in the email.
        </div>
      </GuideStep>
    </HelpGuideShell>
  );
}
