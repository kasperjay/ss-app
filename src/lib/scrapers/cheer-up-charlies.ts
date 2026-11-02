import { getVenue } from "./config";
import { scrapeDo512Venue } from "./shared";

export const scrapeCheerUpCharlies = (now?: Date) => scrapeDo512Venue(getVenue("cheer-up-charlies"), now);
