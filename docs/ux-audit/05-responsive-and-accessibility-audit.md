# 05 — Responsive and Accessibility Audit

Measured: 18 page states × 9 widths (320, 375, 390, 428, 768, 1024, 1280, 1440, 1920). Phone heights 844, tablet 1024, desktop 900. Raw results: `dpaudit.json`.

## Measured results (separate from code observations)

| Check | Result |
|---|---|
| Horizontal overflow | **0 of 162** renders |
| Exactly one H1 | **162 of 162** |
| Inputs without a label | **0** |
| Buttons or links without an accessible name | **0** |
| Images without `alt` | **0** |
| Phone sticky bar overlapping the bottom tab bar | **0** |
| Layout shift (CLS), 7 types, 390px, scrolled to the end | **0.000** on every type |
| Time to network idle (local dev, unthrottled) | 0.7–1.6s |
| API calls on first load | Activity 16 (3× `/api/games`), Circle 17, Adventure 12, Venue 12, Club 11, Programme 10, Provider 6 |
| Image bytes on first load (390px) | Provider 405KB, Circle 367KB, Adventure 297KB, Venue 279KB, Club 233KB, Activity 24KB, Programme 4KB |
| Upscaled images | Club cover: 800px source shown at 976–1512px (1024–1920). Other covers: 900px shown at 1100px on 1920 screens |

## Main button position (top of the first booking button, page px)

| Page | 320 | 390 | 768 | 1024+ | Phone sticky bar? |
|---|---|---|---|---|---|
| Activity (open) | sticky | sticky | sticky | 335 | yes |
| Adventure | sticky | sticky | sticky | 311 | yes |
| Programme (with dates) | sticky | sticky | sticky | 314 | yes |
| Programme / experience (no dates) | 3,685 | 3,460 | 3,516 | 2,966 | **no** (DP-02) |
| Venue | sticky | sticky | sticky | 731 | yes |
| Club | sticky | sticky | sticky | 710 | yes |
| Circle | sticky | sticky | sticky | 258 | yes |
| Provider profile | 3,244 | 3,503 | 5,080 | 1,947 | no |

## Viewport findings

- **320–428:**
  - Layout holds at every width.
  - The first screen on a phone is: back link, action row, cover (201px tall at 390), type label, title. On adventures the price sits beside the title, which is good. On venues the price is 1,100–1,400px down (DP-25).
  - Page lengths at 390px: adventure 6.3 screens, Circle 7.8, provider 8.9.
  - The duplicate booking card and late cancellation terms (DP-03) are phone-only problems.
- **768:** phone layout (single column + sticky bar) stretched to tablet width. The cover is 720px wide, and long text lines in "About" reach ~95 characters. Readable, but the tablet gets no use of a second column.
- **1024–1440:** the two-column layout appears at 1024. The booking card stays in view while scrolling.
- **1920:** the container is 1,560px wide (Batch 2); covers upscale (DP-23).

## Accessibility findings

| ID | Route | Type | Current behaviour | Problem | Impact | Sev | Recommendation | Evidence | Confidence | Effort | Dependency |
|---|---|---|---|---|---|---|---|---|---|---|---|
| DP-11 | covers with several photos; activity / programme links; venue icon buttons | all | Cover dots ("Photo 1 of 5"), the back link, "View profile", "Get directions", "Show 1 past session", and the venue's icon-only Save/Share/Report are under 24×24px | WCAG 2.2 SC 2.5.8 Target Size (Minimum) | Hard to tap; fails AA | P2 | 24px minimum hit area (padding, not a bigger icon); dots get a larger invisible hit area | `dpaudit.json` "small" (390) | Verified (measured) | Low | none |
| DP-35 | `/book/:id`, `/register/:id` | venue, club | Focus lands on `body` after the step page opens | Screen-reader users aren't told the step | AA concern (SC 2.4.3 focus order / status) | P2 | Focus the step heading | `journeys.json` | Verified | Low | none |
| DP-12 | venue, club | venue, club | Heading levels skip from H1 to H3 | SC 1.3.1 info and relationships (best practice) | Weaker outline navigation | P3 | Use H2 | outline | Verified | Low | none |
| DP-40 | detail pages with a photo | all | Cover overlays (date chip, "4 spots left" badge) sit on photos; the orange badge uses dark text on orange | Contrast depends on the token pair; not measured on every photo | Possible low contrast | P3 | Measure badge token pairs; keep the solid chip backgrounds | screenshots | Hypothesis | Low | none |
| DP-41 | experience booking dialog, programme enrol dialog, `/register/:clubId` | experience, programme, club | On touch screens focus goes to the dialog, not the first field (intentional, avoids keyboard pop-up). Errors show one message at the bottom ("Add a name for each person…") | The error isn't tied to the field it's about (no `aria-describedby`); the site's own form convention (`useFormErrors` + `FieldError`) isn't used here | Error recovery is harder | P2 | Use the shared form error pattern | `ExperienceDetail.tsx:300-305`; 0 uses of `useFormErrors`/`FieldError` in ExperienceDetail, ProgramDetail and RegistrationFlow (BookingFlow uses it) | Code-reviewed | Medium | none |

**Verified as working:**
- Dialogs (Share, Report, booking, enrol, photo viewer) are labelled through their heading, trap focus, close on Esc, and return focus.
- Maps load only on request.
- Spinners and skeletons respect reduced motion.
- No running page animations except the skeleton and spinner (Batch 2 B2-MOTION test).

**Not tested:**
- Real screen readers (VoiceOver / TalkBack).
- 200% and 400% zoom.
- Windows high-contrast mode.
- Keyboard-only completion of a paid booking up to the Stripe step.
- Contrast measured photo by photo.
