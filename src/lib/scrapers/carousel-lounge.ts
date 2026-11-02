import { getVenue } from "./config";
import { scrapeDo512Venue } from "./shared";

export const scrapeCarouselLounge = (now?: Date) => scrapeDo512Venue(getVenue("carousel-lounge"), now);
