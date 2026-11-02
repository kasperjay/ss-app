import { getVenue } from "./config";
import { scrapeDo512Venue } from "./shared";

export const scrapeKickButtCoffee = (now?: Date) => scrapeDo512Venue(getVenue("kick-butt-coffee"), now);
