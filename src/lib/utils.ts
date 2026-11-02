const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export const formatRelativeDate = (date: Date | null | undefined) => {
  if (!date) return "Unknown";
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (Math.abs(diffDays) < 7) {
    return formatter.format(diffDays, "day");
  }
  const diffWeeks = Math.round(diffDays / 7);
  if (Math.abs(diffWeeks) < 5) {
    return formatter.format(diffWeeks, "week");
  }
  const diffMonths = Math.round(diffDays / 30);
  return formatter.format(diffMonths, "month");
};

export const formatStatus = (status: string) =>
  status
    .toLowerCase()
    .split("_")
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");

export const formatLocation = (location: string | null, city: string | null, state: string | null, country: string | null) => {
  if (location) return location;
  const parts = [city, state, country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
};

export const clampScore = (score: number | null) => {
  if (score === null || Number.isNaN(score)) return 0;
  return Math.min(100, Math.max(0, Math.round(score)));
};

export const formatTime = (seconds: number) => {
  if (isNaN(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const KNOWN_PROMOTER_PREFIXES = [
  /^(?:resound|margin\s*walker|c3|live\s*nation|kutx(?:\s*98\.9)?|do512|austin\s*chronicle|howdy\s*gals|heard|transmission|stubbs|waterloo)\s+presents?\s*:\s*/i,
  /^[^:]{1,60}\bpresents?\s*:\s*/i,
  /^(?:presented\s+by\s+[^:]{1,60}|presents?)\s*:\s*/i,
  /^(?:presented\s+by\s+[^,]{1,50}|presents?)\s+/i,
];

const KNOWN_VENUE_PREFIXES = [
  /^(?:hotel\s*vegas|volstead(?: lounge)?|mohawk(?: austin)?|continental(?: gallery| club)?|antone'?s|come\s*and\s*take\s*it(?: live)?|the\s*cut|saxon\s*pub|c-?boys(?: heart & soul)?|broken\s*spoke|elephant\s*room|3ten(?: acl live)?|scoot\s*inn|valhalla|haute\s*spot|parker\s*jazz(?: club)?|empire(?: control room)?|cheer\s*up\s*charlies|swan\s*dive|chess\s*club|hole\s*in\s*the\s*wall|far\s*out\s*lounge|carousel\s*lounge|kick\s*butt\s*coffee|electric\s*church)\s*:\s*/i,
];

const KNOWN_VENUE_SUFFIXES = [
  /\s+(?:at|on|live at)\s+(?:the\s+)?(?:hotel\s*vegas|volstead(?: lounge)?|mohawk(?: austin)?|continental(?: gallery| club)?|antone'?s|come\s*and\s*take\s*it(?: live)?|the\s*cut|saxon\s*pub|c-?boys|broken\s*spoke|elephant\s*room|3ten|scoot\s*inn|valhalla|haute\s*spot|parker\s*jazz|empire|cheer\s*up\s*charlies|swan\s*dive|chess\s*club|hole\s*in\s*the\s*wall|far\s*out\s*lounge|carousel\s*lounge|kick\s*butt\s*coffee|electric\s*church)(?:\s+(?:patio|stage|inside|outside))?\s*$/i,
];

export const cleanArtistName = (name: string): string => {
  if (!name || typeof name !== "string") return "";

  let cleaned = name.trim();

  // 1. Strip promoter prefixes from the start (e.g. "Resound Presents: Artist", "KUTX Presents: Artist")
  for (const rx of KNOWN_PROMOTER_PREFIXES) {
    cleaned = cleaned.replace(rx, "").trim();
  }

  // 2. Strip venue prefixes from the start (e.g. "Hotel Vegas: Artist")
  for (const rx of KNOWN_VENUE_PREFIXES) {
    cleaned = cleaned.replace(rx, "").trim();
  }

  // 3. Strip venue suffixes from the end (e.g. "Artist at Hotel Vegas")
  for (const rx of KNOWN_VENUE_SUFFIXES) {
    cleaned = cleaned.replace(rx, "").trim();
  }

  // 4. Strip set times (e.g. @11:45 PM, @ 11:45, at 11:45, etc.)
  const timeRegex = /\s*(?:@|at|at:|time:)?\s*\d{1,2}:\d{2}(?:\s*[ap]m)?\b/gi;
  cleaned = cleaned.replace(timeRegex, "").trim();

  // 5. Strip location/tour/release metadata in parentheses/brackets
  cleaned = cleaned.replace(/\s*[\(\[]\s*(?:Austin|ATX|TX|Texas|USA|United States|Costa Rica|Houston|Dallas|San Antonio|EP release|album release|single release|single launch|record release|tour|live|sold out|night \d+|acoustic).*?[\)\]]/gi, "").trim();

  // 6. Strip age limits (e.g. 21+, 18+, all ages)
  cleaned = cleaned.replace(/\s*[\(\[]?\s*(?:21\+|18\+|all ages)\s*[\)\]]?$/gi, "").trim();

  // 7. Delimiter handling: "Artist - Subtitle" or "Artist: Tour Name" or "Artist | Subtitle"
  const delimiters = /\s*[:\-|]\s*/;
  if (delimiters.test(cleaned)) {
    const parts = cleaned.split(delimiters).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const firstIsNoise = /^(?:presents?|presented by|live at|welcome to|anniversary)\b/i.test(parts[0]) ||
        KNOWN_VENUE_PREFIXES.some((rx) => rx.test(parts[0] + ":"));
      const secondIsNoise = /^(?:tour|world tour|us tour|live|show|concert|record release|album release|single launch|tickets|night \d+|sold out)\b/i.test(parts[1]) ||
        /\b(?:tour|world tour|us tour|live at|sold out|record release|single launch|album release)\b/i.test(parts[1]);

      if (firstIsNoise && !secondIsNoise) {
        cleaned = parts.slice(1).join(" - ").trim();
      } else if (secondIsNoise) {
        cleaned = parts[0].trim();
      }
    }
  }

  // 8. Strip common tour/event suffixes (case insensitive)
  const noiseRegex = /\s+(?:Tour|World Tour|US Tour|Live|Live at .*|Spring|Summer|Fall|Winter|20\d{2}|Official|Music Video|Lyric Video|Audio|Visualizer|EP|LP|Album|Full Album|Deluxe|Remastered)\s*$/gi;
  cleaned = cleaned.replace(noiseRegex, "").trim();

  // 9. If multi-artist string like "Headliner w/ Opener", extract primary artist
  const coBillMatch = cleaned.match(/^(.+?)\s+(?:w\/|with|ft\.?|feat(?:uring)?\.?)\s+/i);
  if (coBillMatch && coBillMatch[1]) {
    const candidate = coBillMatch[1].trim();
    if (candidate.length >= 2) {
      cleaned = candidate;
    }
  }

  // 10. Clean quotes, punctuation and multiple spaces
  cleaned = cleaned
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/\s+([!?,.:;])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned;
};

export const splitArtistLineup = (value: string): string[] => {
  if (!value || typeof value !== "string") return [];

  let text = value.trim();

  // Strip promoter and venue prefixes first
  for (const rx of KNOWN_PROMOTER_PREFIXES) {
    text = text.replace(rx, "").trim();
  }
  for (const rx of KNOWN_VENUE_PREFIXES) {
    text = text.replace(rx, "").trim();
  }
  for (const rx of KNOWN_VENUE_SUFFIXES) {
    text = text.replace(rx, "").trim();
  }

  if (!text) return [];

  const sections = text.split(/\s+(?:w\/|with|ft\.?|feat(?:uring)?\.?)\s+/i);
  const names: string[] = [];

  for (const section of sections) {
    for (const part of section.split(/\s*[,;/&+]|\s+(?:and|plus)\s+/i)) {
      const cleaned = cleanArtistName(part);
      if (!cleaned || cleaned.length < 2) continue;
      if (/^(?:tba|to be announced|various artists|more bands?|special guests?|more)$/i.test(cleaned)) continue;

      const norm = cleaned.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!names.some((existing) => existing.toLowerCase().replace(/[^a-z0-9]/g, "") === norm)) {
        names.push(cleaned);
      }
    }
  }

  return names;
};

