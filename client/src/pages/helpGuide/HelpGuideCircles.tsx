import { GuideStep, guideStepLiStyle, guideStepNoteStyle, guideStepPStyle, guideStepUlStyle } from "../../components/helpGuide/GuideStep";
import { ScreenshotPlaceholder } from "../../components/helpGuide/ScreenshotPlaceholder";
import { HelpGuideShell } from "./HelpGuideShell";

export function HelpGuideCircles() {
  return (
    <HelpGuideShell
      slug="circles"
      eyebrow="Help guide"
      title="Circles."
      subtitle="A Circle is an ongoing group around a shared activity — a standing weekly game or class, organised by one of its own members, not a vendor. Here's how to find one, join one, and start your own."
    >
      <ScreenshotPlaceholder
        caption="The /circles browse page: a grid of Circle cards, each showing name, activity, area and member count."
        alt="Circles browse page"
      />

      <GuideStep n="01" title="Browse Circles">
        <p style={guideStepPStyle}>
          Click <strong>Circles</strong> in the top nav (or the Circles tab at the bottom on mobile) to open{" "}
          <code>/circles</code>. Filter by activity or county, and each card shows the Circle's name, what it's built
          around, how many members it has, and — when there's a real match — its next upcoming session.
        </p>
      </GuideStep>

      <GuideStep n="02" title="Open a Circle's page">
        <p style={guideStepPStyle}>A Circle's own page shows:</p>
        <ul style={guideStepUlStyle}>
          <li style={guideStepLiStyle}>Its about/what-we-do/who-can-join blurb, written by the organiser</li>
          <li style={guideStepLiStyle}>The member list and who organises it</li>
          <li style={guideStepLiStyle}>Upcoming plans — real, scheduled sessions linked to this Circle (each one is an ordinary session under the hood, just tagged as this Circle's plan)</li>
          <li style={guideStepLiStyle}>Recent activity, shared moments/photos, and any open polls (e.g. voting on next week's time)</li>
        </ul>
        <ScreenshotPlaceholder caption="A Circle's detail page: header with member count and Join button, an upcoming-plans list, and the activity feed below." alt="Circle detail page" />
      </GuideStep>

      <GuideStep n="03" title="Join a Circle">
        <p style={guideStepPStyle}>What happens when you press <strong>Join</strong> depends on how the organiser set it up:</p>
        <ul style={guideStepUlStyle}>
          <li style={guideStepLiStyle}><strong>Open</strong> — you're in immediately, no approval needed.</li>
          <li style={guideStepLiStyle}><strong>Approval required</strong> — your request is sent to the organiser, who accepts or declines it from their own Circle management page.</li>
          <li style={guideStepLiStyle}><strong>Invite only</strong> — you can't self-join; an existing member needs to invite you by email first. An invite you've already received is always accepted outright the moment you act on it, regardless of the Circle's join mode.</li>
        </ul>
        <div style={guideStepNoteStyle}>Membership itself is free — a Circle is unpaid. Any individual session it plans may still have its own price, same as joining that session directly.</div>
      </GuideStep>

      <GuideStep n="04" title="Start your own Circle">
        <p style={guideStepPStyle}>
          Press <strong>Start a Circle</strong> from the Circles page, or Explore → Featured → Become a Host, to open{" "}
          <code>/circles/start</code>. You'll set:
        </p>
        <ul style={guideStepUlStyle}>
          <li style={guideStepLiStyle}>A name and the activity it's built around</li>
          <li style={guideStepLiStyle}>Area/county, and an optional linked venue if you meet somewhere fixed</li>
          <li style={guideStepLiStyle}>An about/what-we-do/who-can-join description</li>
          <li style={guideStepLiStyle}>Its join mode — open, approval, or invite-only</li>
        </ul>
        <p style={guideStepPStyle}>
          You're automatically its first member and organiser. No approval step, no venue listing, and it's completely
          free — this is the "no listing required" path mentioned across the app for people who want to host without
          running a business.
        </p>
        <ScreenshotPlaceholder caption="The Start a Circle form: name, activity, area, join-mode selector." alt="Start a Circle form" />
      </GuideStep>

      <GuideStep n="05" title="Running your Circle">
        <p style={guideStepPStyle}>As organiser, from your Circle's own management page you can:</p>
        <ul style={guideStepUlStyle}>
          <li style={guideStepLiStyle}><strong>Create a plan</strong> — post a real, scheduled session tagged to this Circle (it works exactly like hosting a session via Start, just pre-linked to the group).</li>
          <li style={guideStepLiStyle}>Review and accept/decline join requests, if your Circle requires approval.</li>
          <li style={guideStepLiStyle}>Invite specific people by email, remove members, and run polls (e.g. "what time works this week?").</li>
          <li style={guideStepLiStyle}>Change the join mode or edit the Circle's own description at any time.</li>
        </ul>
      </GuideStep>
    </HelpGuideShell>
  );
}
