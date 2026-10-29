# 02 · Scenarios: mapping to features, plus the expanded inventory

**Existing requirements (R1–R9)** come from the KNOTS brief and the Ground-Level Scenarios page.
**Proposed enhancements (E1–E10)** came up in this audit. They aren't part of the approved brief, and each needs its
own yes or no.

| ID | Requirement | Source |
|---|---|---|
| R1 | Several options or prices per listing | Brief |
| R2 | Payer, booking holder and attendees kept separate; adult/child | Brief |
| R3 | Custom questions and answers | Brief |
| R4 | Donations, accounted for separately | Brief |
| R5 | External payment with verification | Brief |
| R6 | Group check-in per attendee | Brief |
| R7 | Volunteers and duties per occurrence | Brief |
| R8 | Privacy: minimisation, role access, retention | Brief |
| R9 | Reporting and exports per occurrence | Brief |
| E1 | Deposit now, balance later (instalments) | Proposed |
| E2 | Team or table entries (one entry = N heads, team name) | Proposed |
| E3 | Recurring hire paid by invoice for trusted organisations | Proposed |
| E4 | Offline door mode (check in without signal, sync later) | Proposed |
| E5 | Options that need proof (student, senior, medical card) | Proposed |
| E6 | Options and early access for Circle members | Proposed |
| E7 | Each attendee completes their own questions (waiver per person) | Proposed |
| E8 | Group-fit waitlist (offer to the first group that fits) | Proposed |
| E9 | Walk-in sale at the door by an organiser | Proposed |
| E10 | Accessibility and interpreter needs as a standard question set | Proposed |

## 1. Mapping the Ground-Level Scenarios to features

"Layer" refers to the shared parts proposed in `03-architecture.md`:
**OPT** = options and order lines, **ATT** = attendees, **Q** = questions and answers, **DON** = donation line,
**EXT** = external payments, **CHK** = attendee check-in, **ROLE** = occurrence roles, **RPT** = exports.

| Scenario | Host table | R/E | Layers | Phase |
|---|---|---|---|---|
| EV-01 KNOTS Vratham | experiences (kind event) | R1–R9 | OPT ATT Q DON EXT CHK ROLE RPT | 1–5 |
| EV-02 Diwali night | experiences (event) | R1 R2 R6 R7 R9, E8 | OPT ATT CHK ROLE RPT | 1, 2, 5 (E8 later) |
| EV-03 Tidy Towns quiz | experiences (event) | R1 R2 R3 R5 R9, E2 E9 | OPT(team) Q EXT(cash due) | 1, 2, 3 |
| EV-04 GAA fun day | experiences (event) | R2 R3 R4 R8 | ATT Q(per attendee) DON | 2, 4 |
| VE-01 Birthday hall hire | bookings | R1 R3 R5 R8, E1 | OPT(packages) Q EXT | 6 |
| VE-02 Weekly language class | bookings | R5 R9, E3 | (E3) | not scheduled |
| CL-01 Three siblings | registrations | R1 R2 R3 R5 R8 | OPT(plan) ATT ⟶ needs a checkout group | 7 (needs PD-8) |
| CL-02 Student concession | registrations | R1 R3 R8, E5 | OPT(proof) Q(file) | 7 |
| PR-01 Parent-and-baby swim | program_enrollments | R1 R2 R3 R6 | OPT ATT(role) Q | 6 |
| PR-02 Teen camp | program_enrollments | R1 R2 R3 R8 | OPT(sibling price) ATT Q(collection list) | 6–7 |
| EX-01 Family kayak | experience_bookings | R1 R2 R3 R6, E4 | OPT(age band, add-on) ATT Q CHK | 1, 2 (E4 later) |
| EX-02 Charity hike | experience_bookings | R1 R4 R9 | OPT DON | 1, 4 |
| EX-03 Hen party waivers | experience_bookings | R2 R3 R8, E7 | ATT Q (E7) | 2 (E7 later) |
| VO-01 Beach clean | experiences (volunteer) | R2 R3 R6 R7 R9 | ATT Q CHK ROLE RPT | 2, 5 |
| GA-01 Five-a-side +1 | game_participants | R2 R5 R7 | guests count, co-host, EXT(cash due) | 5 |
| CI-01 KNOTS Circle member price | experiences + circles | R1 R3 R8, E6 | OPT(eligibility) | 1 (E6 optional) |
| PA-01 Pass + friend drop-in | passes + registrations | R1 R2 | — (needs a checkout group) | not scheduled |
| X-01 Partial refund | any | R1 R2 R4 R9 | OPT (refunded_quantity), DON | 1, 4 |
| X-02 Data erasure | any | R3 R8 | Q (sensitivity, retention) | 2 (deletion waits on D-07) |
| X-03 Reception volunteer | any | R6 R7 R8 | ROLE CHK (door projection) | 2, 5 |

## 2. Expanded scenario inventory (new, Irish, on the ground)

Each scenario is tagged with the requirements it uses. ★ marks a proposed enhancement, not part of the brief.

### Community events
- **EV-05 Eid community prayer and lunch, Clongriffin (free, capacity-capped).** The organiser has 450 places split
  into a men's hall and a women's hall, each with its own capacity. Families register adults and children under one
  booking. A volunteer at each entrance checks people in. **R1** (two free options with separate capacity), **R2**,
  **R6**, **R7**. *Note:* the split is the organiser's option design; the platform doesn't infer gender. Each option
  is just a named capacity.
- **EV-06 St Patrick's Day parade float, Naas.** A local club recruits 30 walkers and 4 marshals (Garda-vetted). Each
  child walker needs a parent's consent and an emergency phone. **R2**, **R3**, **R7**, **R8**.
- **EV-07 Indian Independence Day cricket tournament, Leixlip.** Teams of 11 register: €150 per team, a team name and
  a captain's phone, plus €10 spectator lunch passes. **R1**, **R3**, ★**E2**.
- **EV-08 Ukrainian community information evening, Kildare town.** It's free. Questions cover interpreter needs
  (language) and childcare during the talk. **R3**, ★**E10**.
- **EV-09 Christmas toy appeal, Newbridge.** There's no event. It's donation-only, with a target and a collection
  point. **R4**. ★ This is a "donation-only listing", which is out of scope until PD-3 is decided.
- **EV-10 Seachtain na Gaeilge céilí.** Families pay €5 at the door and €3 for children. Most people turn up without
  booking. **R1**, **R5** (cash due), ★**E9**.

### Venue and room hire
- **VE-03 Community centre Christmas party for an employer.** An invoice goes to the company with the VAT number
  shown, a 50% deposit is paid now, and the balance follows by EFT. **R5**, ★**E1**, ★**E3**.
- **VE-04 Bereavement gathering after a funeral, at short notice.** The family books a hall for the next day. Cash
  can only be taken on the day. Questions: catering supplier and number expected. **R3**, **R5** (cash due). The
  booking must not be blocked by a verification delay.

### Clubs
- **CL-03 Mid-season junior joining a rugby club.** The fee is pro-rated (€90 instead of €140 after January).
  **R1** (an option with a sale window).
- **CL-04 Adult beginner tag rugby league, teams of 8.** Team entries of 8 players, or a solo player who's placed on
  a team. **R1**, **R2**, ★**E2**.
- **CL-05 Swim club "medical card holder" concession.** **R1**, ★**E5**.

### Programmes
- **PR-03 Leaving Cert maths grinds, 10 Saturdays.** Full course or "first two weeks trial". The parent pays, the
  student attends. **R1**, **R2**.
- **PR-04 Men's Shed woodworking course.** The course is free, with a €20 materials add-on. **R1**.
- **PR-05 Sensory-friendly cinema mornings.** A parent, a child and a carer (the carer goes free). **R1**, **R2**,
  ★**E10**.

### Experiences and adventures
- **EX-04 Wild Atlantic Way coasteering, Co. Clare.** Wetsuit and helmet sizes are asked per person, with a minimum
  height of 1.4 m. **R1**, **R2**, **R3** (safety-critical, blocks booking).
- **EX-05 Corporate team day for 24.** One payer and an invoice, with attendees named later. **R2**, ★**E3**, ★**E7**.

### Volunteering
- **VO-02 Food bank packing shift, Saturday.** Three 2-hour shifts with 8 places each, and a minimum age of 16.
  **R1** (shifts as options), **R7**, **R9** (hours).
- **VO-03 Youth club leader.** Garda vetting is needed before the first session; the role stays "pending vetting"
  until then. **R3**, **R7**, **R8**.

### Games and hosted sessions
- **GA-02 Saturday parkrun-style social walk (free).** A +2 for family, with no money involved. **R2**.
- **GA-03 Badminton doubles where one player pays for both.** **R2** (a guest seat paid by the joiner).

### Circles
- **CI-02 Parish choir Circle.** Members get first refusal on the Christmas concert tickets. ★**E6**.

### Passes
- **PA-02 A 10-swim family pass shared within a household.** Credits used by any household member. **R2** (household).
  ★ This changes the pass rules, so it's out of scope until approved.

## 3. What these scenarios tell us

1. **Experiences/events cover 60% of the demand** and need no change to the webhook contract. They come first.
2. **"Cash due" comes up in nearly every community scenario** (EV-03, EV-10, VE-04, GA-01). It's the same R5 state as
   Revolut or bank transfer: *reserved, unpaid, then verified by a person*.
3. **Family orders on clubs and programmes (CL-01, PR-02, PA-01) are the one structural change.** They need several
   rows paid by one checkout. That's a decision (PD-8), not a quick extension.
4. **Questions marked safety-critical (EX-01, EX-04) block a booking. Questions marked sensitive (EV-01 gotra, X-02)
   limit who can see the answer.** These are two different flags on one question model.
