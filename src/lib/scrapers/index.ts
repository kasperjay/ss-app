import { VENUES, getVenue } from "./config";
import type { VenueId } from "./config";
import type { VenueScrapeResult } from "./shared";
import { scrapeAntones } from "./antones";
import { scrapeBrokenSpoke } from "./broken-spoke";
import { scrapeCboys } from "./cboys";
import { scrapeComeAndTakeIt } from "./come-and-take-it";
import { scrapeContinentalClub } from "./continental-club";
import { scrapeContinentalGallery } from "./continental-gallery";
import { scrape3Ten } from "./3ten";
import { scrapeElephantRoom } from "./elephant-room";
import { scrapeEmpire } from "./empire";
import { scrapeHauteSpot } from "./haute-spot";
import { scrapeHotelVegas } from "./hotel-vegas";
import { scrapeMohawk } from "./mohawk";
import { scrapeParkerJazzClub } from "./parker-jazz-club";
import { scrapeSaxonPub } from "./saxon-pub";
import { scrapeScootInn } from "./scoot-inn";
import { scrapeTheCut } from "./the-cut";
import { scrapeValhallaTavern } from "./valhalla-tavern";
import { scrapeCheerUpCharlies } from "./cheer-up-charlies";
import { scrapeSwanDive } from "./swan-dive";
import { scrapeChessClub } from "./chess-club";
import { scrapeHoleInTheWall } from "./hole-in-the-wall";
import { scrapeFarOutVenue } from "./shared";
import { scrapeCarouselLounge } from "./carousel-lounge";
import { scrapeKickButtCoffee } from "./kick-butt-coffee";

export { ACTIVE_VENUES, MVP_VENUES, VENUES, getVenue, isVenueActive } from "./config";
export type { VenueId, Venue, VenueSource } from "./config";
export { splitArtistTitle } from "./shared";

const scrapers: Record<VenueId, (now?: Date) => Promise<VenueScrapeResult>> = {
  "come-and-take-it": scrapeComeAndTakeIt,
  "continental-club": scrapeContinentalClub,
  "continental-gallery": scrapeContinentalGallery,
  "hotel-vegas": scrapeHotelVegas,
  antones: scrapeAntones,
  mohawk: scrapeMohawk,
  "empire-atx": scrapeEmpire,
  "haute-spot": scrapeHauteSpot,
  "parker-jazz": scrapeParkerJazzClub,
  "the-cut": scrapeTheCut,
  "scoot-inn": scrapeScootInn,
  "saxon-pub": scrapeSaxonPub,
  "elephant-room": scrapeElephantRoom,
  cboys: scrapeCboys,
  "broken-spoke": scrapeBrokenSpoke,
  "3ten": scrape3Ten,
  "valhalla-tavern": scrapeValhallaTavern,
  "cheer-up-charlies": scrapeCheerUpCharlies,
  "swan-dive": scrapeSwanDive,
  "chess-club": scrapeChessClub,
  "hole-in-the-wall": scrapeHoleInTheWall,
  "far-out-lounge": (now) => scrapeFarOutVenue(getVenue("far-out-lounge"), now),
  "carousel-lounge": scrapeCarouselLounge,
  "kick-butt-coffee": scrapeKickButtCoffee,
};

export function getVenueScraper(id: VenueId) {
  return scrapers[id];
}

export function isVenueId(value: string): value is VenueId {
  return VENUES.some((venue) => venue.id === value);
}
