import { getVenue } from "./config";
import { scrapeDo512Venue } from "./shared";

export const scrapeSwanDive = (now?: Date) => scrapeDo512Venue(getVenue("swan-dive"), now);
