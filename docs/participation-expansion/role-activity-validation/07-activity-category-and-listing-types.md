# 07 · Activity categories and listing-type boundaries

## 1. Taxonomy (as built, `server/src/taxonomy.ts`)
Families: `activity` (A), `experience` (X), `volunteer` (V), `programme` (P), `circle` (C), `club` (K), `venue` (N). Resident-hosted activities (`games`) can only use categories in family **A**.

| Category | Families | Subcategories |
|---|---|---|
| Soccer | A P C K | 5-a-side, 7-a-side, 11-a-side, Futsal, Casual kickabout |
| Gaelic games | A P C K | Gaelic football, Hurling, Camogie, Handball, Rounders |
| Racket sports | A P C K | Badminton, Tennis, Padel, Squash, Table tennis, Pickleball |
| Team sports | A P C K | Basketball, Volleyball, Cricket, Rugby, Hockey, Netball |
| Fitness & wellness | A X P C K | Yoga, Pilates, HIIT, Running, Bootcamp, Gym, Athletics, Gymnastics |
| Outdoors & adventure | A X C K | Hiking, Walking, Cycling, Camping, Climbing, Orienteering |
| Water sports | A X P C K | Swimming, Kayaking, Paddleboarding, Surfing, Sailing, Rowing, Coasteering |
| Dance | A P C K | Irish dance, Salsa, Ballet, Hip-hop, Contemporary |
| Martial arts & boxing | A P K | Boxing, Karate, Judo, Taekwondo, BJJ |
| Games & social | A C | Board games, Chess, Quiz nights, Card games, Darts & pool |
| Meetups & community | A C | Coffee meetups, Language exchange, Newcomer meetups, Networking, Community gatherings, Book club |
| Arts & crafts | A X P C | Pottery, Painting, Photography, Crafts, Creative writing, Woodwork |
| Music | X P C | Guitar, Piano, Singing, Trad music, Live music |
| Food & drink | X P C | Cooking, Baking, Food tours, Tastings |
| Culture & heritage | X | Heritage tours, City walks, Museums, Theatre |
| Culture, faith & celebrations | X C | Cultural festivals, Faith gatherings, Community celebrations, Fundraisers |
| Learning & skills | P | Languages, Coding, Tutoring, First aid, Professional skills |
| Kids & family | X P | After-school, Camps, Early learning, Family days |
| Volunteering & causes | V C | Environment & clean-ups, Community support, Charity & fundraising, Animal welfare |
| Spaces (3 categories) | N | halls, sports facilities, creative spaces |

## 2. The discussions' examples against the taxonomy (activity family)
| Example | Classifiable as a resident activity? | Mapping |
|---|---|---|
| Football, cricket, badminton, basketball, tennis, table tennis, volleyball | ✓ | Soccer / Team sports / Racket sports |
| Chess, board games | ✓ | Games & social |
| **Video gaming meetups** | ◐ | no subcategory; Games & social without a sub, or a tag |
| Walking, running, cycling, hiking | ✓ | Outdoors / Fitness |
| Outdoor fitness | ✓ | Fitness → Bootcamp |
| Coffee, newcomer, language exchange, book discussions, neighbourhood gatherings | ✓ | Meetups & community |
| Photography, crafts | ✓ | Arts & crafts |
| **Sketching** | ◐ | Arts & crafts → Painting (closest) |
| **Music jam sessions** | **—** | Music is not in family A |
| **Gardening** | **—** | no category |
| Dance practice | ✓ | Dance |
| Yoga, group fitness | ✓ | Fitness & wellness |
| **Stretching, meditation** | ◐ | Fitness & wellness without a sub |
| **Community clean-ups, local projects** | **—** as an activity | Volunteering is family V (partner volunteering listings), not A |
| **Family social meetups** | ◐ | Kids & family isn't in A; Meetups → Community gatherings |

**Verdict:** the taxonomy is **not sports-only**: social, creative, wellness and community meetups are classifiable. Five examples have no exact home for a resident host: music jams, gardening, clean-ups, family meetups, video gaming. Fixing them means adding family A to Music, Kids & family and Volunteering, or adding subcategories. That's a taxonomy decision (Super admin can do it in Admin → Categories without code), so it's **not changed here** (RAV-D-05). No duplicate categories were created.

**Higher-risk categories** (children's supervised activities, formal coaching, commercial workshops, ticketed events):
- **No per-category host restriction exists.** Hosts are limited only by: paid needs verified host; `min_age`; category moderation policy `review_required` / `eligible_only` (applies to organisations).
- Safeguarding rules for hosts need an owner and legal decision (RAV-D-06).

## 3. Listing-type boundaries
| Concept | Table / route | Creator | Booking lifecycle | Overlap? |
|---|---|---|---|---|
| Activity | `games` / `/api/games` | any resident (host) | `game_participants` (join, approval, waitlist, paid via Stripe) | none |
| Adventure, Experience, Event, Volunteer opportunity | `experiences.kind` / `/api/vendor/experiences` | organisation (`experiences` + `events` / `volunteering`) | `experience_bookings` + options, attendees, door check-in | one table, one kind each, no duplicate records |
| Programme | `programs` (on a centre or club) | organisation (`programs`) | `program_enrollments`, registers, progress | none |
| Club | `clubs` | organisation (`clubs`) | `registrations`, club sessions, waitlist | none |
| Circle | `circles` | any resident | `circle_members` (unpaid) | activities are **linked**, not copied |
| Hall booking | `centres` + `rooms` | organisation (`venues`) | `bookings`; Open Booking paused | a host's venue reservation is a `bookings` row tied to the game (`bookingRef`), not a second activity |

- **No listing type replaces another.** The five participation tables stay parallel by design (CLAUDE.md).
- **Partners don't create "activities"** (`games`): their activity-like offerings are experiences, events, programmes and club sessions.
- A partner person who wants to host a casual game does it as a resident, through their linked account (`/api/manage/switch`). The activity is then **personally owned**, not owned by the organisation.
- Discussion 2's "Partner/Club: create an activity ✓" is met through those listing types. The discussions' rule "creating a personal activity must not create an organisation" holds.

**Confusing overlaps found:** none that create duplicate records. One naming overlap: "Make it happen" (Circle interest) vs the paused `/make-it-happen` room booking (already documented in CLAUDE.md).
