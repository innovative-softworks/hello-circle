# HelloCircle product glossary

One user-facing word per concept (sitemap audit P2-02, 2026-10-11). Use these in navigation, page titles and headings, the footer and help pages. Code identifiers, routes and API fields keep their existing names; this is about what people read.

| Concept | Say | Don't say | Code / route name |
|---|---|---|---|
| The product | **HelloCircle** (one word) | Hello Circle | — |
| A hosted, ad-hoc thing people join (pickup game, one-off class, meetup) | **Activity / Activities** · create: **Host an activity** | game, session (as the listing name), event | `games`, `/games`, `/games/host` |
| One occurrence of something recurring (a club session, an experience departure) | **session** | — | `club_sessions`, `experience_sessions` |
| A standing group around a shared interest | **Circle** (capital C) · create: **Start a Circle** | group, community | `circles` |
| A multi-week course or series | **Programme / Programmes** | Program, Programs | `programs`, `/programs` |
| Guided or one-off bookable outings | **Adventure**, **Experience**, **Volunteer** (the three experience kinds) | — | `experiences` (`kind`) |
| Bookable venues, as a discovery group | **Places** | Venues (in nav) | — |
| A bookable venue | **Community centre** | Council, centre (alone, in nav) | `centres`, `/browse/centres` |
| A membership organisation you register for | **Sports club** | — | `clubs`, `/browse/clubs` |
| Things a resident bookmarked | **Saved** | Favourites | `favourites`, `/profile?tab=favourites` |
| The resident's own home | **My Life** | My bookings | `/bookings` (canonical), `/my-life` |
| Group venue-booking feature | **Make It Happen** (title case, product name) | Make it happen | `/make-it-happen` |
| Running activities/Circles as a resident | **host** (sentence case: "Become a host"); the badge is **Verified Host** | Become a Host | `host_status` |
| The host/vendor workspace | **Manage** ("HelloCircle Manage") | Vendor Dashboard | `/manage`, `/vendor` |
| Discovery column of non-venue listings | **Things to do** | — | — |

## Known exceptions (not yet changed)

- **Log in** (business accounts, `/login`) vs **Sign in** (residents, `/signin`). They become one screen in P2-11.
- **vendor / provider / partner** for businesses. Public pages say "partner" or "venue"; vendor-only screens still say "vendor" in places. This hasn't been decided yet.
- The orphan `/landing` page (`client/src/landing/`) wasn't updated. It's due to be retired (P2-15).
