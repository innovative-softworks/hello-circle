# HelloCircle — Proposed Category Taxonomy (Phase 0, for approval)

**Hierarchy:** Listing type (business model) → **Category** → **Subcategory** → Tags.

## 1. Quality review of the brief's candidate list

| Issue | Examples in the candidate list | Proposal |
|---|---|---|
| Same concept repeated across families | Football (A01, C01, D02, E01, F02); Pottery (A12, B10, C04); Kayaking (A09, B02); Yoga (A05, C02); Irish dance (A10, C06); Photography (A12, B03, C08, E03, F04) | Each thing is defined once, as a subcategory (e.g. `badminton` under Racket sports). The category lists every family it applies to (activity, programme, club, Circle), so one definition serves all of them and search for "badminton" finds every type. |
| "Events" is a family in the brief but not a backend type | G01–G10 | Events stays a **date-based view** (activities + experiences happening soon, as Home does today). G-items become **tags**: tournament, festival, fundraiser, market, open-mic, seasonal. |
| Volunteering | E10, F10, G10 and the `volunteer` kind | Keep `volunteer` as the experience kind (listing model). Category "Volunteering & causes" with subcategories from `experiences.cause`. |
| Categories better as tags | Seasonal (B09, G09), Family (B08, G06), Indoor/Outdoor, Beginner, Evening | Tags; extend the existing participation vocabulary |
| Venue facility types vs activity categories | D01–D12 | Separate **facility** categories, applicable only to venues/rooms |
| Irish naming | "Football" is ambiguous in Ireland (soccer vs Gaelic football) | Category **"Soccer"** (aliases: football, 5-a-side) and **"Gaelic games"**. Decision needed. |
| Thin inventory | Most candidates have 0 listings in dev | `discoverable` flag: hidden from public navigation until a category has live inventory or an editorial reason |
| Values to preserve | `ACTIVITY_CATEGORIES` (14), `MARKET_CATEGORIES` (12), 19 club sports, free-text labels | Mapped through aliases (section 4); never deleted |

## 2. Proposed canonical categories (first release, for approval)

Kept deliberately smaller than the brief's ~80 so every visible category can have inventory. The rest stay as inactive rows, ready to switch on.

| ID / slug | Category | Applies to | Subcategories (concept slugs) |
|---|---|---|---|
| `soccer` | Soccer | activity, programme, club, circle | 5-a-side, 7-a-side, 11-a-side, futsal, casual kickabout |
| `gaelic-games` | Gaelic games | activity, programme, club | gaelic-football, hurling, camogie, handball, rounders |
| `racket-sports` | Racket sports | activity, programme, club, circle | badminton, tennis, padel, squash, table-tennis, pickleball |
| `team-sports` | Team sports | activity, programme, club | basketball, volleyball, cricket, rugby, hockey, netball |
| `fitness-wellness` | Fitness & wellness | activity, programme, experience, club, circle | yoga, pilates, hiit, running, bootcamp, gym |
| `outdoors` | Outdoors & adventure | activity, experience, circle, club | hiking, walking, cycling, camping, climbing, orienteering |
| `water` | Water sports | activity, experience, programme, club | swimming, kayaking, paddleboarding, surfing, sailing, rowing |
| `dance` | Dance | activity, programme, club | irish-dance, salsa, ballet, hip-hop, contemporary |
| `martial-arts` | Martial arts & boxing | activity, programme, club | boxing, karate, judo, taekwondo, bjj |
| `games-social` | Games & social | activity, circle | board-games, chess, quiz, card-games, darts-pool |
| `meetups` | Meetups & community | activity, circle | coffee, language-exchange, newcomers, networking, community-gathering |
| `arts-crafts` | Arts & crafts | activity, experience, programme, circle | pottery, painting, photography, crafts, creative-writing, woodwork |
| `music` | Music | programme, experience, circle | guitar, piano, singing, trad-music, live-music |
| `food-drink` | Food & drink | experience, programme, circle | cooking, baking, food-tours, tastings |
| `culture-heritage` | Culture & heritage | experience | heritage-tours, city-walks, museums, theatre |
| `learning` | Learning & skills | programme | languages, coding, tutoring, first-aid, professional-skills |
| `kids-family` | Kids & family | programme, experience | after-school, camps, early-learning, family-days |
| `volunteering` | Volunteering & causes | experience (volunteer), circle | environment, community, charity, animals |
| `spaces-community` | Community halls & rooms | venue | community-hall, meeting-room, function-room, classroom |
| `spaces-sport` | Sports facilities | venue | sports-hall, pitch, court, pool, studio |
| `spaces-creative` | Creative & specialist spaces | venue | art-studio, rehearsal-room, kitchen, makerspace |

**Tags:** the existing 8 participation attributes, plus proposed: indoor, outdoor, evening, weekend, tournament, festival, fundraiser, seasonal, women-only, over-50s. Each addition needs approval.

## 3. Rules

- IDs and slugs are stable, lowercase and hyphenated, and unique across all categories.
- Labels can change; IDs never do.
- A category is visible only when `active` and `discoverable` are set **and** it has at least one public listing in that family (or it is featured).

## 4. Legacy mapping (aliases)

| Legacy value | Source | → Category / subcategory |
|---|---|---|
| "Five-a-side Football" | activity label | soccer / 5-a-side |
| "Badminton Doubles" | activity label | racket-sports / badminton |
| "Tennis Doubles", "Padel" | activity label | racket-sports / tennis, padel |
| "Pickup Basketball" | activity label | team-sports / basketball |
| "Saturday Parkrun", "Couch to 5k Running Group" | activity label | fitness-wellness / running |
| "Yoga in the Park" | activity label | fitness-wellness / yoga |
| "Hiking Group Walk", "Walking" | activity / Circle label | outdoors / hiking, walking |
| "Evening Cycling Spin" | activity label | outdoors / cycling |
| "Swimming Squad Session" | activity label | water / swimming |
| "Chess Club Meetup", "Board Games Night" | activity label | games-social / chess, board-games |
| "Coffee & Chat Meetup" | activity label | meetups / coffee |
| "Book Club Discussion" | activity label | meetups / (new) book-club |
| "Photography Walk" | activity label | arts-crafts / photography |
| "Pottery" | Circle label | arts-crafts / pottery |
| Soccer, GAA, Rugby, Basketball, Athletics, Swimming, Martial Arts, Dance | `ACTIVITY_CATEGORIES` / club sport | matching category |
| "Fitness & Wellness", "Arts & Crafts", "Music", "Community & Social", "Kids & Family" | `ACTIVITY_CATEGORIES` | fitness-wellness, arts-crafts, music, meetups, kids-family |
| Badminton, Football, Swimming, Fitness, Yoga, Walking, Kids activities, Arts, Learning, Community events, Outdoor, Wellbeing | `MARKET_CATEGORIES` | corresponding category or subcategory |
| Unmatched free text | any | category left empty; listed in admin "Uncategorised" |

Free-text labels stay as listing **titles**. They are never overwritten.

## 5. Validation against real data (2026-10-22)

**Production-designated database** (`hello_circle`, read-only session; only category columns, as counts; no personal data):
- 2 clubs (sport "GAA", "Soccer"; category empty) and 3 venues;
- **0** activities, Circles, programmes and experiences;
- no `market_categories`, `listing_attributes` or intent rows.

So there are no production values to break. The live server (hellocircle.ie) was **not** queried.

**Dev data** (`hello_circle_dev`): every listing maps to the 21 categories once these subcategories are added:

| Added | Under | Needed for |
|---|---|---|
| `book-club` | meetups | "Book Club Discussion" (activity, Circle) |
| `coasteering` | water | "Donegal Sea Cliffs Coasteering" |
| `athletics` | fitness-wellness | club sport "Athletics" |
| `gymnastics` | fitness-wellness | club sport "Gymnastics" |
| `cycling` (club) | outdoors | club sport "Cycling" (already a subcategory) |

**Irish terminology check:**
- "Soccer" (as used in club data, `ACTIVITY_CATEGORIES` and everyday Irish usage) and "Gaelic games" (GAA, hurling, camogie, handball are already club sports) are kept as separate categories.
- "Programme" spelling.
- "Community hall" and "parish centre" both stay under `spaces-community`.

## 6. Ambiguous mappings: kept for manual admin review (never auto-assigned)

| Listing (dev) | Type | Candidates | Why ambiguous |
|---|---|---|---|
| Dublin Rooftop Yoga & Brunch | experience | fitness-wellness/yoga · food-drink | Two activities in one |
| Kilkenny Medieval Walking Tour | experience | culture-heritage/heritage-tours · outdoors/walking | Tour vs walk |
| Waterford Crystal Engraving Taster | experience | arts-crafts/crafts · culture-heritage | Craft vs heritage |
| After-School Multi-Sport Camp | programme | kids-family/camps · team-sports | Audience vs sport |
| Na Fianna Summer Camp | programme | gaelic-games · kids-family/camps | Club sport vs camp |
| Cabra Celtic Adult Beginners | programme | soccer (from parent club) | Title has no sport; parent club's sport decides |
| Cork Harlequins Skills Academy | programme | team-sports/hockey (from parent club) | Same |
| Galway Dolphins Intensive Squad | programme | water/swimming (from parent club) | Same |
| Any free-text "Football" | activity | soccer · gaelic-games | Irish ambiguity |

**Rule for programmes:** when the title gives no sport, suggest the **parent club's sport**, which an admin confirms. An admin confirms every row in this table; the backfill leaves them uncategorised.
