export type VenueSource = "do512" | "the-cut" | "far-out" | "closed";

export const VENUES = [
  {
    id: "come-and-take-it",
    name: "Come and Take It Live",
    source: "do512",
    calendarUrl: "https://family.do512.com/venues/come-and-take-it-live/month_events",
  },
  {
    id: "continental-club",
    name: "Continental Club",
    source: "do512",
    calendarUrl: "https://family.do512.com/venues/the-continental-club/month_events",
  },
  {
    id: "continental-gallery",
    name: "Continental Gallery",
    source: "do512",
    calendarUrl: "https://family.do512.com/venues/the-continental-club-gallery/month_events",
  },
  {
    id: "hotel-vegas",
    name: "Hotel Vegas",
    source: "do512",
    calendarUrl: "https://family.do512.com/venues/hotel-vegas-the-volstead-lounge/month_events",
  },
  {
    id: "antones",
    name: "Antone's",
    source: "do512",
    calendarUrl: "https://family.do512.com/venues/antone-s/month_events",
  },
  {
    id: "mohawk",
    name: "Mohawk",
    source: "do512",
    calendarUrl: "https://family.do512.com/venues/mohawk-austin/month_events",
  },
  {
    id: "empire-atx",
    name: "Empire Control Room & Garage",
    source: "closed",
    calendarUrl: "https://do512.com/venues/empire-control-room-garage/month_events",
  },
  {
    id: "haute-spot",
    name: "Haute Spot",
    source: "do512",
    calendarUrl: "https://do512.com/venues/haute-spot/month_events",
  },
  {
    id: "parker-jazz",
    name: "Parker Jazz Club",
    source: "do512",
    calendarUrl: "https://do512.com/venues/parker-jazz-club/month_events",
  },
  {
    id: "the-cut",
    name: "The Cut ATX",
    source: "the-cut",
    calendarUrl: "https://www.thecutatx.com/",
  },
  {
    id: "scoot-inn",
    name: "Historic Scoot Inn",
    source: "do512",
    calendarUrl: "https://do512.com/venues/historic-scoot-inn/month_events",
  },
  {
    id: "saxon-pub",
    name: "The Saxon Pub",
    source: "do512",
    calendarUrl: "https://do512.com/venues/the-saxon-pub/month_events",
  },
  {
    id: "elephant-room",
    name: "The Elephant Room",
    source: "do512",
    calendarUrl: "https://do512.com/venues/the-elephant-room/month_events",
  },
  {
    id: "cboys",
    name: "C-Boy's Heart & Soul Bar",
    source: "do512",
    calendarUrl: "https://do512.com/venues/c-boy-s-heart-soul-bar/month_events",
  },
  {
    id: "broken-spoke",
    name: "Broken Spoke",
    source: "do512",
    calendarUrl: "https://do512.com/venues/broken-spoke/month_events",
  },
  {
    id: "3ten",
    name: "3TEN",
    source: "do512",
    calendarUrl: "https://do512.com/venues/3ten/month_events",
  },
  {
    id: "valhalla-tavern",
    name: "Valhalla Tavern",
    source: "do512",
    calendarUrl: "https://do512.com/venues/valhalla/month_events",
  },
  {
    id: "cheer-up-charlies",
    name: "Cheer Up Charlies",
    source: "do512",
    calendarUrl: "https://do512.com/venues/cheer-up-charlies/month_events",
  },
  {
    id: "swan-dive",
    name: "Swan Dive",
    source: "do512",
    calendarUrl: "https://do512.com/venues/swan-dive/month_events",
  },
  {
    id: "chess-club",
    name: "Chess Club",
    source: "do512",
    calendarUrl: "https://do512.com/venues/chess-club/month_events",
  },
  {
    id: "hole-in-the-wall",
    name: "Hole in the Wall",
    source: "do512",
    calendarUrl: "https://do512.com/venues/hole-in-the-wall/month_events",
  },
  {
    id: "far-out-lounge",
    name: "The Far Out Lounge",
    source: "far-out",
    calendarUrl: "https://www.thefaroutaustin.com/events.html",
  },
  {
    id: "carousel-lounge",
    name: "Carousel Lounge",
    source: "do512",
    calendarUrl: "https://do512.com/venues/carousel-lounge/month_events",
  },
  {
    id: "kick-butt-coffee",
    name: "Kick Butt Coffee Music & Booze",
    source: "do512",
    calendarUrl: "https://do512.com/venues/kick-butt-coffee/month_events",
  },
] as const;

const inactiveVenueIds = new Set<string>(["empire-atx"]);

export type VenueId = (typeof VENUES)[number]["id"];
export type Venue = (typeof VENUES)[number];
export const ACTIVE_VENUES = VENUES.filter((venue) => !inactiveVenueIds.has(venue.id));
export const MVP_VENUES = ACTIVE_VENUES.slice(0, 6);

export function isVenueActive(id: string): id is VenueId {
  return ACTIVE_VENUES.some((venue) => venue.id === id);
}

export function getVenue(id: VenueId): Venue {
  const venue = VENUES.find((candidate) => candidate.id === id);
  if (!venue) throw new Error(`Unknown venue ID: ${id}`);
  return venue;
}
