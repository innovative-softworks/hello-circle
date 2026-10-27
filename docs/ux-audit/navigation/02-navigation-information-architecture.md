# 02 — Navigation Information Architecture

## Top level (unchanged)

Logo · **Explore** ▾ · **Circles** · **+ Start** ▾ · Search · (signed in) Saved · Messages · Notifications · Account ▾

**Why Circles stays top-level and leaves Explore:** a Circle is a community you belong to, not a one-off thing to do. It also has its own phone tab, so a second entry inside Explore only adds length.

## Explore (implemented)

| Group | Item | Route (unchanged) |
|---|---|---|
| Things to do | Explore everything | `/explore` |
| | Activities | `/games` |
| | Adventures | `/adventures` |
| | Experiences | `/experiences` |
| | Events this weekend | `/explore?when=weekend` |
| Learn & give back | Programmes | `/programs` |
| | Volunteer | `/volunteer` |
| Places (only when venues are public) | Community centres | `/browse/centres` |
| | Sports clubs | `/browse/clubs` |
| Not sure yet? (one featured tile) | Free Time Mode | `/free-time` |

**Removed:**
- Circles (it's top-level).
- "This weekend" (`/games?when=weekend`), duplicating Events.
- "Become a host" (it's under Start).
- The photo tile (a third link to `/explore`).

**Why "Events" is a link, not a type:** events aren't a listing type. They are activities and experiences in a time window (see `docs/hellocircle-category-taxonomy.md` §1).

## Categories in navigation (after category approval; not built)

The category level belongs **on the list pages** (chips and filters), not in the Explore panel. Explore stays a list of types.

- **Explore panel:** later, an optional "Popular" row of up to 6 categories with live inventory (e.g. Racket sports → `/games?category=racket-sports`).
- **Search suggestions:** typing "badm" suggests "Badminton — Racket sports" (alias resolution).

## Start (implemented)

| Group | Item | Route | Shown when |
|---|---|---|---|
| Organise something | Create an activity | `/games/host` | always (the page asks a guest to sign in; the server needs a resident) |
| | Make It Happen | `/make-it-happen` | commerce switch on |
| Build a community | Start a Circle | `/circles/start` | always |
| Host or list with us | Become a host | `/become-a-host` | always |
| | List your venue | `/for-venues` | not a vendor session |

Creating experiences, programmes, venues and clubs happens in the partner workspace (`/vendor*`), reached from the account menu. That is deliberate: those flows need a vendor account.

## Phone

- **Tab bar** (kept): Home · Explore · Start · Circles · My Life. The brief's "Activities" and "You" tabs were considered and rejected:
  - Activities is one of seven types and is one tap away in Explore.
  - Home is the main landing page.
  - "My Life" is the established name for bookings and the account (renaming it is a product decision).
- **Explore and Start:** full-screen centred sheets with the same groups as desktop.

## Account menu (kept)

- **Groups:** Personal (profile, My Life, bookings, Circles, saved, notifications, messages, settings) · Manage (hosting, Circles, business) · Switch Personal ⇄ business · Admin.
- Items come from `accountItemKeys()`, which mirrors the server's rules. Hiding an item is presentation only.
