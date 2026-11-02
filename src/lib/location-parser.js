// Comprehensive location parser & normalizer for music artists
// Supports Austin-metro detection, Texas regional detection, and general US/global parsing.

const STATE_NAMES = {
  al: "Alabama", ak: "Alaska", az: "Arizona", ar: "Arkansas", ca: "California",
  co: "Colorado", ct: "Connecticut", de: "Delaware", fl: "Florida", ga: "Georgia",
  hi: "Hawaii", id: "Idaho", il: "Illinois", in: "Indiana", ia: "Iowa",
  ks: "Kansas", ky: "Kentucky", la: "Louisiana", me: "Maine", md: "Maryland",
  ma: "Massachusetts", mi: "Michigan", mn: "Minnesota", ms: "Mississippi", mo: "Missouri",
  mt: "Montana", ne: "Nebraska", nv: "Nevada", nh: "New Hampshire", nj: "New Jersey",
  nm: "New Mexico", ny: "New York", nc: "North Carolina", nd: "North Dakota", oh: "Ohio",
  ok: "Oklahoma", or: "Oregon", pa: "Pennsylvania", ri: "Rhode Island", sc: "South Carolina",
  sd: "South Dakota", tn: "Tennessee", tx: "Texas", ut: "Utah", vt: "Vermont",
  va: "Virginia", wa: "Washington", wv: "West Virginia", wi: "Wisconsin", wy: "Wyoming",
  dc: "District of Columbia",
};

const STATE_BY_NAME = {};
for (const [abbr, name] of Object.entries(STATE_NAMES)) {
  STATE_BY_NAME[name.toLowerCase()] = abbr.toUpperCase();
  STATE_BY_NAME[abbr.toLowerCase()] = abbr.toUpperCase();
}

// Austin area cities (core and surrounding metro)
const AUSTIN_AREA_CITIES = [
  "austin", "round rock", "pflugerville", "cedar park", "georgetown",
  "san marcos", "kyle", "buda", "dripping springs", "hutto", "manor",
  "lakeway", "bee cave", "beecave", "westlake", "west lake hills",
  "rollingwood", "spicewood", "bastrop", "lockhart", "elgin", "taylor",
  "del valle", "wimberley", "leander", "lago vista", "sunset valley", "atx",
];

// Words that can commonly be people names or common words unless accompanied by TX/location context
const AMBIGUOUS_AUSTIN_WORDS = new Set(["taylor", "manor", "dripping", "kyle", "elgin"]);

const TEXAS_CITIES = [
  "san antonio", "houston", "dallas", "fort worth", "el paso", "arlington",
  "corpus christi", "plano", "lubbock", "laredo", "irving", "garland",
  "frisco", "mckinney", "grand prairie", "amarillo", "brownsville", "killeen",
  "denton", "mesquite", "pasadena", "mcallen", "waco", "midland",
  "carrollton", "abilene", "pearland", "odessa", "college station", "beaumont",
  "tyler", "wichita falls", "san angelo", "new braunfels", "conroe",
  "edinburg", "mission", "bryan", "temple", "baytown", "pharr",
  "missouri city", "longview", "flower mound", "harlingen", "cedar hill",
  "east texas", "west texas", "north texas", "south texas", "central texas",
  "panhandle", "rio grande valley",
];

const AUSTIN_VENUES = [
  "come and take it", "continental club", "continental gallery", "hotel vegas",
  "volstead", "antone", "mohawk", "empire control", "haute spot",
  "parker jazz", "the cut", "scoot inn", "saxon pub", "elephant room",
  "cheer up charlies", "swan dive", "chess club", "hole in the wall", "far out lounge",
  "carousel lounge", "kick butt coffee",
  "c-boy", "broken spoke", "3ten", "valhalla", "cheer up charlie",
  "the parish", "far out lounge", "stubbs", "emo's",
];

const INTERNATIONAL_CITIES = {
  "toronto": { country: "Canada" },
  "vancouver": { country: "Canada" },
  "montreal": { country: "Canada" },
  "london": { country: "UK" },
  "manchester": { country: "UK" },
  "liverpool": { country: "UK" },
  "birmingham": { country: "UK" },
  "glasgow": { country: "UK" },
  "edinburgh": { country: "UK" },
  "dublin": { country: "Ireland" },
  "belfast": { country: "UK" },
  "paris": { country: "France" },
  "berlin": { country: "Germany" },
  "munich": { country: "Germany" },
  "hamburg": { country: "Germany" },
  "amsterdam": { country: "Netherlands" },
  "brussels": { country: "Belgium" },
  "stockholm": { country: "Sweden" },
  "oslo": { country: "Norway" },
  "copenhagen": { country: "Denmark" },
  "herning": { country: "Denmark" },
  "helsinki": { country: "Finland" },
  "sydney": { country: "Australia" },
  "melbourne": { country: "Australia" },
  "brisbane": { country: "Australia" },
  "tokyo": { country: "Japan" },
  "seoul": { country: "South Korea" },
  "nz": { country: "New Zealand" },
  "new zealand": { country: "New Zealand" },
  "uk": { country: "UK" },
  "united kingdom": { country: "UK" },
  "canada": { country: "Canada" },
  "australia": { country: "Australia" },
};

const MAJOR_US_CITIES = {
  "new york": "NY", "new york city": "NY", "nyc": "NY", "brooklyn": "NY", "queens": "NY",
  "los angeles": "CA", "la": "CA", "san francisco": "CA", "sf": "CA", "bay area": "CA", "oakland": "CA", "san diego": "CA",
  "sacramento": "CA", "san jose": "CA", "long beach": "CA",
  "chicago": "IL",
  "nashville": "TN", "memphis": "TN",
  "atlanta": "GA",
  "seattle": "WA",
  "portland": "OR",
  "denver": "CO", "boulder": "CO",
  "phoenix": "AZ", "tucson": "AZ",
  "las vegas": "NV",
  "miami": "FL", "orlando": "FL", "tampa": "FL",
  "new orleans": "LA",
  "boston": "MA",
  "philadelphia": "PA", "pittsburgh": "PA",
  "detroit": "MI",
  "minneapolis": "MN", "st paul": "MN",
  "kansas city": "MO", "st louis": "MO",
  "cleveland": "OH", "columbus": "OH", "cincinnati": "OH",
  "charlotte": "NC", "raleigh": "NC",
  "salt lake city": "UT",
  "baltimore": "MD",
  "washington dc": "DC", "washington d.c.": "DC",
};

const NATIONALITY_DEMONYMS = {
  swedish: "Sweden",
  norwegian: "Norway",
  danish: "Denmark",
  finnish: "Finland",
  british: "UK",
  english: "UK",
  scottish: "UK",
  irish: "Ireland",
  canadian: "Canada",
  australian: "Australia",
  german: "Germany",
  french: "France",
  italian: "Italy",
  spanish: "Spain",
  dutch: "Netherlands",
  japanese: "Japan",
  korean: "South Korea",
  mexican: "Mexico",
  brazilian: "Brazil",
};

const COUNTRY_NAMES = {
  "usa": "USA",
  "united states": "USA",
  "united states of america": "USA",
  "us": "USA",
  "uk": "UK",
  "united kingdom": "UK",
  "great britain": "UK",
  "england": "UK",
  "scotland": "UK",
  "wales": "UK",
  "canada": "Canada",
  "australia": "Australia",
  "germany": "Germany",
  "france": "France",
  "italy": "Italy",
  "spain": "Spain",
  "sweden": "Sweden",
  "norway": "Norway",
  "denmark": "Denmark",
  "finland": "Finland",
  "netherlands": "Netherlands",
  "belgium": "Belgium",
  "ireland": "Ireland",
  "japan": "Japan",
  "south korea": "South Korea",
  "korea": "South Korea",
  "mexico": "Mexico",
  "brazil": "Brazil",
  "new zealand": "New Zealand",
  "switzerland": "Switzerland",
  "austria": "Austria",
  "poland": "Poland",
  "portugal": "Portugal",
  "greece": "Greece",
};

const GARBAGE_PATTERNS = [
  /\bdisney\b/i,
  /\bfounded in\b/i,
  /\bactive between\b/i,
  /\bcompany\b/i,
  /\bcorporation\b/i,
  /\binc\b/i,
  /\bltd\b/i,
  /\bwas formed in\b/i,
  /\brecords\b/i,
  /\blabel\b/i,
  /\btour dates\b/i,
  /\btickets\b/i,
  /\bout now\b/i,
  /\bstream now\b/i,
  /\btap the link\b/i,
  /\ball rights\b/i,
  /\bworldwide\b/i,
  /\bglobal\b/i,
  /\bmetaverse\b/i,
  /\bdigital\b/i,
  /\bnowhere\b/i,
  /\beverywhere\b/i,
  /\bthe road\b/i,
  /\bthe internet\b/i,
  /\bbedroom\b/i,
  /\bgarage\b/i,
  /\bheartache\b/i,
  /\bwriting music\b/i,
  /\bdreamy\b/i,
  /\b(?:dm|booking|contact|inquiries|management)\b/i,
  /\b(?:upcoming\s+shows|tour\s+dates|live\s+shows|shows\b)/i,
  /\b(?:link|stream|listen|watch|click|tap)\b/i,
  /\b(?:merch|apparel|store|shop)\b/i,
  /\b(?:breakdowns?|riff|guitar|bass|drums|vocals?|hooks?)\b/i,
  /\b(?:pronouns?|she\/her|he\/him|they\/them)\b/i,
  /\b(?:him|her|them)\b/i,
];

function isGarbageLocation(text) {
  if (!text || typeof text !== "string") return true;
  const s = text.trim();
  if (s.length < 2 || s.length > 70) return true;
  // If no alphabetical letters at all, it's not a location (e.g. only emoji, digits, symbols)
  if (!/[A-Za-z]/.test(s)) return true;
  for (const pat of GARBAGE_PATTERNS) {
    if (pat.test(s)) return true;
  }
  // If more than 4 words and has no comma, it's likely a sentence fragment
  const words = s.split(/\s+/);
  if (words.length > 4 && !s.includes(",")) return true;
  return false;
}

function cleanString(s) {
  if (!s || typeof s !== "string") return "";
  return s
    .trim()
    .replace(/[.,|•–\-_/]+$/, "")
    .replace(/^[📍🏠🗺️.,|•–\-_/\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function capitalizeWords(str) {
  if (!str) return "";
  return str
    .split(/\s+/)
    .map((w) => {
      if (w.length === 2 && STATE_NAMES[w.toLowerCase()]) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Parses and normalizes an existing location string.
 * Returns structured { city, state, country, formatted, isAustinArea, isTexas }
 */
function parseLocationString(raw) {
  if (!raw || typeof raw !== "string") return null;
  const cleaned = cleanString(raw);
  if (isGarbageLocation(cleaned)) return null;

  const lower = cleaned.toLowerCase();

  // 1. Check "City, State" or "City, ST" or "City, Country" FIRST (explicit comma delimiter)
  const commaMatch = cleaned.match(/^([^,]+),\s*([^,]+)(?:,\s*([A-Za-z\s]+))?$/);
  if (commaMatch) {
    const cityPart = cleanString(commaMatch[1]);
    const statePart = cleanString(commaMatch[2]);
    const countryPart = commaMatch[3] ? cleanString(commaMatch[3]) : null;

    const stateUpper = STATE_BY_NAME[statePart.toLowerCase()];
    if (stateUpper) {
      const cityName = capitalizeWords(cityPart);
      const isTx = stateUpper === "TX";
      const isAustin = isTx && AUSTIN_AREA_CITIES.some((c) => cityName.toLowerCase() === c || cityName.toLowerCase().includes(c));
      return {
        city: cityName,
        state: stateUpper,
        country: countryPart || "USA",
        formatted: `${cityName}, ${stateUpper}`,
        isAustinArea: isAustin,
        isTexas: isTx,
      };
    }

    // Check if second part is country (e.g. Toronto, Canada or Paris, France or London, UK)
    const countryKey = statePart.toLowerCase();
    const isCountry = INTERNATIONAL_CITIES[countryKey] || INTERNATIONAL_CITIES[cityPart.toLowerCase()] || ["uk", "united kingdom", "canada", "australia", "germany", "france", "sweden", "mexico", "japan", "ireland", "spain", "italy", "brazil", "netherlands"].includes(countryKey);
    if (countryPart || isCountry) {
      const cityName = capitalizeWords(cityPart);
      const countryRaw = countryPart || statePart || "International";
      const resolvedCountry = INTERNATIONAL_CITIES[countryRaw.toLowerCase()]?.country || capitalizeWords(countryRaw);
      return {
        city: cityName,
        state: null,
        country: resolvedCountry,
        formatted: `${cityName}, ${resolvedCountry}`,
        isAustinArea: false,
        isTexas: false,
      };
    }
  }

  // 2. Check standalone Austin-area keywords (without comma)
  for (const aCity of AUSTIN_AREA_CITIES) {
    // If ambiguous word (e.g. "taylor", "manor", "dripping", "kyle", "elgin"), require TX context
    if (AMBIGUOUS_AUSTIN_WORDS.has(aCity)) {
      if (!/\btx\b|\btexas\b/i.test(cleaned)) continue;
    }
    const re = new RegExp(`(^|\\b|[,\\s])${aCity}(\\b|[,\\s]|$)`, "i");
    if (re.test(lower)) {
      const cityName = aCity === "atx" ? "Austin" : capitalizeWords(aCity);
      return {
        city: cityName,
        state: "TX",
        country: "USA",
        formatted: `${cityName}, TX`,
        isAustinArea: true,
        isTexas: true,
      };
    }
  }

  // 3. Check Texas cities (no comma or single word)
  for (const txCity of TEXAS_CITIES) {
    const re = new RegExp(`(^|\\b)${txCity}(\\b|$)`, "i");
    if (re.test(lower)) {
      const cityName = capitalizeWords(txCity);
      return {
        city: cityName,
        state: "TX",
        country: "USA",
        formatted: `${cityName}, TX`,
        isAustinArea: false,
        isTexas: true,
      };
    }
  }

  // 4. Check Major US Cities
  for (const [usCity, st] of Object.entries(MAJOR_US_CITIES)) {
    const re = new RegExp(`(^|\\b)${usCity}(\\b|$)`, "i");
    if (re.test(lower)) {
      const cityName = capitalizeWords(usCity);
      return {
        city: cityName,
        state: st,
        country: "USA",
        formatted: `${cityName}, ${st}`,
        isAustinArea: false,
        isTexas: st === "TX",
      };
    }
  }

  // 5. Check International Cities
  for (const [intCity, meta] of Object.entries(INTERNATIONAL_CITIES)) {
    const re = new RegExp(`(^|\\b)${intCity}(\\b|$)`, "i");
    if (re.test(lower)) {
      const cityName = capitalizeWords(intCity);
      return {
        city: cityName,
        state: null,
        country: meta.country,
        formatted: `${cityName}, ${meta.country}`,
        isAustinArea: false,
        isTexas: false,
      };
    }
  }

  // 6. Check single state name or abbreviation
  const stateUpper = STATE_BY_NAME[lower];
  if (stateUpper) {
    return {
      city: null,
      state: stateUpper,
      country: "USA",
      formatted: `${STATE_NAMES[stateUpper.toLowerCase()]}, USA`,
      isAustinArea: false,
      isTexas: stateUpper === "TX",
    };
  }

  // 7. Check standalone country name
  const countryDirect = COUNTRY_NAMES[lower];
  if (countryDirect) {
    return {
      city: null,
      state: null,
      country: countryDirect,
      formatted: countryDirect,
      isAustinArea: false,
      isTexas: false,
    };
  }

  return null;
}

/**
 * Checks if a string contains references to Austin music venues.
 */
function isAustinVenue(text) {
  if (!text || typeof text !== "string") return false;
  const lower = text.toLowerCase();
  return AUSTIN_VENUES.some((v) => lower.includes(v));
}

/**
 * Scans freeform text (biography, post captions, notes, etc.) to extract artist location.
 * @param {string} text - The text to scan.
 * @param {object} [options] - Optional options like artistName, allowVenue.
 */
function extractLocationFromText(text, options = {}) {
  if (!text || typeof text !== "string") return null;

  const artistName = (options.artistName || "").toLowerCase();
  const igHandle = (options.instagramHandle || "").toLowerCase();

  // Check Instagram handle hints
  if (igHandle) {
    if (igHandle.includes("atx") || igHandle.includes("austin")) {
      return {
        city: "Austin",
        state: "TX",
        country: "USA",
        formatted: "Austin, TX",
        isAustinArea: true,
        isTexas: true,
      };
    }
    if (igHandle.includes("fromtexas") || /_tx$|tx\d+$/.test(igHandle)) {
      return {
        city: null,
        state: "TX",
        country: "USA",
        formatted: "Texas, USA",
        isAustinArea: false,
        isTexas: true,
      };
    }
  }

  // 1. Check explicit location prefix statements in bio (HIGHEST PRIORITY for text)
  // E.g. "based in Philadelphia, Pennsylvania", "hailing from Las Vegas, NV", "band from Kansas City, MO"
  const prefixMatch = text.match(
    /\b(?:based\s+(?:in|out\s+of)|located\s+in|hailing\s+from|originally\s+from|lives\s+in|out\s+of|hometown[:\s]+|(?:[a-z-]+\s+)?(?:band|trio|duo|group|artist|outfit|musician|act)\s+from|formed\s+in)\s+([A-Za-z][^\n,.|•–·/]{1,40}(?:,\s*[A-Za-z\s]{2,20})?)/i
  );
  if (prefixMatch && prefixMatch[1]) {
    const candidate = prefixMatch[1].trim();
    if (!isGarbageLocation(candidate)) {
      const parsed = parseLocationString(candidate);
      if (parsed) return parsed;
    }
  }

  // 2. Check "[City]-based" pattern (e.g. "Chicago-based band", "Austin-based indie trio", "Miami-based")
  const basedMatch = text.match(/\b([A-Za-z\s]{3,25})-(?:based|rooted|formed)\b/i);
  if (basedMatch && basedMatch[1]) {
    const candidate = basedMatch[1].trim();
    if (!isGarbageLocation(candidate)) {
      const parsed = parseLocationString(candidate);
      if (parsed) return parsed;
    }
  }

  // 3. Pin emoji matches: 📍 Austin, TX or 📍 Brooklyn
  const pinMatch = text.match(/[📍🏠🗺️]\s*([^\n,|•–·]{2,40})/u);
  if (pinMatch && pinMatch[1]) {
    const candidate = pinMatch[1].trim();
    if (!isGarbageLocation(candidate)) {
      const parsed = parseLocationString(candidate);
      if (parsed) return parsed;
    }
  }

  // 4. Check "City, State" / "City, Country" where State is full name or abbreviation
  // E.g. "Las Vegas, Nevada", "San Antonio, TX", "Los Angeles, CA", "Brooklyn, NY", "London, UK"
  const cityStateRe = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),\s*([A-Za-z]{2,20})\b/g;
  let match;
  while ((match = cityStateRe.exec(text)) !== null) {
    const candidate = `${match[1]}, ${match[2]}`;
    if (!isGarbageLocation(candidate)) {
      const parsed = parseLocationString(candidate);
      if (parsed && (parsed.state || parsed.country)) {
        return parsed;
      }
    }
  }

  // 5. Check nationality demonyms (e.g. "Swedish death metal", "British indie", "Australian psych")
  for (const [demonym, countryName] of Object.entries(NATIONALITY_DEMONYMS)) {
    const re = new RegExp(`\\b${demonym}\\b`, "i");
    if (re.test(text)) {
      return {
        city: null,
        state: null,
        country: countryName,
        formatted: countryName,
        isAustinArea: false,
        isTexas: false,
      };
    }
  }

  // 6. Check explicit Austin scene keywords (NOT including sxsw or venue tags)
  if (
    /#(?:atx|austin|austinmusic|atxmusic|atxhiphop|austintx)\b/i.test(text) ||
    /\b(?:austin\s+music|atx\s+music|austin\s+native|atx\s+native|austin\s+local)\b/i.test(text)
  ) {
    return {
      city: "Austin",
      state: "TX",
      country: "USA",
      formatted: "Austin, TX",
      isAustinArea: true,
      isTexas: true,
    };
  }

  // 7. Check for unambiguous Austin area cities in text
  for (const aCity of AUSTIN_AREA_CITIES) {
    if (AMBIGUOUS_AUSTIN_WORDS.has(aCity)) {
      if (artistName.includes(aCity)) continue;
      const re = new RegExp(`\\b(?:in|from|at|near|based\\s+in)\\s+${aCity}\\b`, "i");
      if (!re.test(text)) continue;
    } else {
      const re = new RegExp(`\\b${aCity}\\b`, "i");
      if (re.test(text)) {
        const cityName = aCity === "atx" ? "Austin" : capitalizeWords(aCity);
        return {
          city: cityName,
          state: "TX",
          country: "USA",
          formatted: `${cityName}, TX`,
          isAustinArea: true,
          isTexas: true,
        };
      }
    }
  }

  // 8. Check Texas keywords in bio (e.g. "East Texas", "Dallas", "Houston", "San Antonio")
  for (const txCity of TEXAS_CITIES) {
    const re = new RegExp(`\\b${txCity}\\b`, "i");
    if (re.test(text)) {
      const cityName = capitalizeWords(txCity);
      return {
        city: cityName,
        state: "TX",
        country: "USA",
        formatted: `${cityName}, TX`,
        isAustinArea: false,
        isTexas: true,
      };
    }
  }

  // 9. Check Texas state/Texan/TX keyword
  if (/\b(?:texas|texan)\b/i.test(text) || /\bfrom\s+tx\b/i.test(text)) {
    return {
      city: null,
      state: "TX",
      country: "USA",
      formatted: "Texas, USA",
      isAustinArea: false,
      isTexas: true,
    };
  }

  // 10. Check "from [City/State]"
  const fromMatch = text.match(/\bfrom\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
  if (fromMatch && fromMatch[1]) {
    const candidate = fromMatch[1].trim();
    if (!isGarbageLocation(candidate)) {
      const parsed = parseLocationString(candidate);
      if (parsed && (parsed.state || parsed.country)) return parsed;
    }
  }

  // 11. Check other major US cities in bio (e.g. "Los Angeles", "New York", "Nashville", "Chicago")
  for (const [usCity, st] of Object.entries(MAJOR_US_CITIES)) {
    const re = new RegExp(`\\b${usCity}\\b`, "i");
    if (re.test(text)) {
      const cityName = capitalizeWords(usCity);
      return {
        city: cityName,
        state: st,
        country: "USA",
        formatted: `${cityName}, ${st}`,
        isAustinArea: false,
        isTexas: st === "TX",
      };
    }
  }

  // 12. Check international cities in bio (e.g. "Toronto", "London", "Paris")
  for (const [intCity, meta] of Object.entries(INTERNATIONAL_CITIES)) {
    const re = new RegExp(`\\b${intCity}\\b`, "i");
    if (re.test(text)) {
      const cityName = capitalizeWords(intCity);
      return {
        city: cityName,
        state: null,
        country: meta.country,
        formatted: `${cityName}, ${meta.country}`,
        isAustinArea: false,
        isTexas: false,
      };
    }
  }

  return null;
}

module.exports = {
  STATE_NAMES,
  STATE_BY_NAME,
  AUSTIN_AREA_CITIES,
  TEXAS_CITIES,
  AUSTIN_VENUES,
  isGarbageLocation,
  parseLocationString,
  extractLocationFromText,
  isAustinVenue,
};
