// Structured mock content for the standalone marketing landing page
// (LandingPage.tsx) — kept out of components so swapping this for a real
// API later is a data-layer change only, not a rewrite of the page.
// Images are placeholderImage() placeholders (see that module) — swap in
// curated activity photography before shipping.

import { placeholderImage } from "../placeholderImage";
const img = (seed: string, w = 900, h = 700) => placeholderImage(seed, w, h);

export interface LandingActivity {
  id: string;
  title: string;
  when: string;
  venue: string;
  distanceKm: number;
  meta: string;
  price: string;
  cta: string;
  image: string;
}

export const TODAY_ACTIVITIES: LandingActivity[] = [
  {
    id: "badminton-social",
    title: "Friday Social Badminton",
    when: "Today · 7:30 PM",
    venue: "PowerPlay Arena",
    distanceKm: 2.1,
    meta: "8 going · 3 spots left",
    price: "₹250",
    cta: "Join",
    image: img("hc-badminton-1"),
  },
  {
    id: "sunset-cycling",
    title: "Sunset Cycling Ride",
    when: "Today · 6:00 PM",
    venue: "Necklace Road",
    distanceKm: 4.8,
    meta: "16 going",
    price: "Free",
    cta: "Join",
    image: img("hc-cycling-1"),
  },
  {
    id: "pottery-workshop",
    title: "Beginner Pottery Workshop",
    when: "Today · 5:00 PM",
    venue: "Clay Studio",
    distanceKm: 3.4,
    meta: "5 spots left",
    price: "₹750",
    cta: "Book",
    image: img("hc-pottery-1"),
  },
  {
    id: "morning-run-club",
    title: "Tank Bund Run Club",
    when: "Today · 6:15 AM",
    venue: "Tank Bund",
    distanceKm: 3.9,
    meta: "22 going",
    price: "Free",
    cta: "Join",
    image: img("hc-run-1"),
  },
];

export const WEEKEND_ACTIVITIES: LandingActivity[] = [
  { id: "sunrise-hike", title: "Sunrise Hike, Ananthagiri Hills", when: "Saturday · 5:30 AM", venue: "Ananthagiri Hills", distanceKm: 62, meta: "Carpool available", price: "₹450", cta: "Join", image: img("hc-hike-1") },
  { id: "kids-science", title: "Kids Science Workshop", when: "Saturday · 11:00 AM", venue: "Curiosity Lab", distanceKm: 5.6, meta: "Ages 6–12", price: "₹600", cta: "Book", image: img("hc-kids-science-1") },
  { id: "sunday-football", title: "Sunday Morning Football", when: "Sunday · 6:30 AM", venue: "Gachibowli Turf", distanceKm: 6.2, meta: "10 / 14 joined", price: "₹150", cta: "Join", image: img("hc-football-1") },
  { id: "painting-class", title: "Weekend Painting Class", when: "Saturday · 4:00 PM", venue: "Canvas & Co.", distanceKm: 4.1, meta: "Materials included", price: "₹900", cta: "Book", image: img("hc-painting-1") },
  { id: "weekend-cycling", title: "Weekend Long Ride", when: "Sunday · 5:45 AM", venue: "ORR Cycling Track", distanceKm: 8.3, meta: "Intermediate pace", price: "Free", cta: "Join", image: img("hc-longride-1") },
  { id: "cooking-session", title: "Hyderabadi Cooking Session", when: "Sunday · 5:00 PM", venue: "Spice Kitchen Studio", distanceKm: 3.2, meta: "6 spots left", price: "₹1,100", cta: "Book", image: img("hc-cooking-1") },
  { id: "volunteering", title: "Neighbourhood Clean-Up", when: "Sunday · 7:00 AM", venue: "Kapra Lakefront", distanceKm: 9.4, meta: "Gloves & bags provided", price: "Free", cta: "Join", image: img("hc-volunteer-1") },
  { id: "photo-walk", title: "Street Photography Walk", when: "Sunday · 6:00 AM", venue: "Charminar", distanceKm: 5.2, meta: "All skill levels", price: "Free", cta: "Join", image: img("hc-photowalk-1") },
];

export interface LandingCategory {
  id: string;
  label: string;
  description: string;
  image: string;
}

export const CATEGORIES: LandingCategory[] = [
  { id: "play", label: "Play", description: "Sports and games.", image: img("hc-cat-play") },
  { id: "move", label: "Move", description: "Running, cycling, fitness.", image: img("hc-cat-move") },
  { id: "explore", label: "Explore", description: "Hiking, adventure and outdoors.", image: img("hc-cat-explore") },
  { id: "learn", label: "Learn", description: "Workshops and classes.", image: img("hc-cat-learn") },
  { id: "create", label: "Create", description: "Photography, art, music.", image: img("hc-cat-create") },
  { id: "connect", label: "Connect", description: "Community activities and social experiences.", image: img("hc-cat-connect") },
  { id: "family", label: "Family", description: "Kids and family activities.", image: img("hc-cat-family") },
  { id: "give-back", label: "Give Back", description: "Volunteering and community initiatives.", image: img("hc-cat-giveback") },
];

export interface LandingCircle {
  id: string;
  name: string;
  members: string;
  next: string;
  image: string;
}

export const CIRCLES: LandingCircle[] = [
  { id: "weekend-cyclists", name: "Hyderabad Weekend Cyclists", members: "2.3K members", next: "Next ride · Sunday 6:00 AM", image: img("hc-circle-cyclists") },
  { id: "weekend-trekkers", name: "Weekend Trekkers", members: "842 members", next: "Next hike · Ananthagiri Hills", image: img("hc-circle-trekkers") },
  { id: "parents-kids", name: "Parents & Kids Adventures", members: "1.1K members", next: "Next activity · Saturday", image: img("hc-circle-family") },
  { id: "photo-walks", name: "Sunday Photography Walks", members: "526 members", next: "Next walk · Charminar", image: img("hc-circle-photo") },
];

export interface LandingOpenPlan {
  id: string;
  title: string;
  need: string;
  area: string;
  when: string;
  joined: string;
  cta: string;
}

export const OPEN_PLANS: LandingOpenPlan[] = [
  { id: "badminton-tonight", title: "Badminton tonight", need: "Need 2 more players", area: "Madhapur", when: "7:30 PM", joined: "2 / 4 joined", cta: "Join Plan" },
  { id: "sunday-football-plan", title: "Sunday morning football", need: "Need 4 more players", area: "Gachibowli", when: "6:30 AM", joined: "10 / 14 joined", cta: "Join Plan" },
  { id: "evening-cycling-plan", title: "Evening cycling", need: "Casual pace", area: "Hussain Sagar", when: "6:00 PM", joined: "6 riders", cta: "Join Plan" },
];

export interface LandingVenue {
  id: string;
  name: string;
  tags: string;
  distanceKm: number;
  availability: string;
  cta: string;
  unclaimed?: boolean;
  image: string;
}

export const VENUES: LandingVenue[] = [
  { id: "pulse-sports", name: "Pulse Sports Arena", tags: "Badminton · Football", distanceKm: 2.1, availability: "Available tonight", cta: "View availability", image: img("hc-venue-sports") },
  { id: "community-hub", name: "The Community Hub", tags: "Community hall · Meeting rooms", distanceKm: 4.2, availability: "From ₹1,500/hour", cta: "View space", image: img("hc-venue-hub") },
  { id: "studio-27", name: "Studio 27", tags: "Dance · Yoga · Workshops", distanceKm: 3.8, availability: "Available Saturday", cta: "View availability", image: img("hc-venue-studio") },
  { id: "neighbourhood-court", name: "Neighbourhood Basketball Court", tags: "Basketball", distanceKm: 1.4, availability: "Unclaimed venue", cta: "Claim it", unclaimed: true, image: img("hc-venue-court") },
];

export interface IntentPath {
  id: string;
  label: string;
  detail: string;
  cta: string;
}

export const INTENT_PATHS: IntentPath[] = [
  { id: "book", label: "Find a court", detail: "Available 7:00–8:00 PM", cta: "Book" },
  { id: "join-game", label: "Join a game", detail: "2 players looking for 2 more", cta: "Join" },
  { id: "join-circle", label: "Join a Circle", detail: "Weekend Badminton Club · 164 members", cta: "View Circle" },
  { id: "join-session", label: "Join a session", detail: "Beginner Badminton Social · 8 going", cta: "Join" },
];

export const PERSONALIZED_SUGGESTIONS = [
  { id: "p1", title: "Social badminton", distanceKm: 2.1 },
  { id: "p2", title: "Sunset cycling", distanceKm: 4.8 },
  { id: "p3", title: "Street photography walk", distanceKm: 5.2 },
];

export const SEARCH_CHIPS = ["Badminton tonight", "Kids activities", "Weekend hiking", "Photography walks", "Community halls"];

export const NETWORK_LABELS = ["Badminton · 7:30 PM", "Cycling Circle", "Community Hall", "Kids Workshop", "Need 2 players", "Photography Walk", "Weekend Trekkers", "Pottery Studio"];
