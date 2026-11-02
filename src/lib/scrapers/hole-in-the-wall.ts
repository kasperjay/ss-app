import { getVenue } from "./config";
import { scrapeDo512Venue } from "./shared";

export const scrapeHoleInTheWall = (now?: Date) => scrapeDo512Venue(getVenue("hole-in-the-wall"), now);
