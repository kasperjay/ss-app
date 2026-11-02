import { getVenue } from "./config";
import { scrapeDo512Venue } from "./shared";

export const scrapeChessClub = (now?: Date) => scrapeDo512Venue(getVenue("chess-club"), now);
