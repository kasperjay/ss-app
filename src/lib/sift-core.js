// src/lib/sift-core.js
// Live music artist intelligence & profile signals engine for Spectral Soundworks.
// Identifies bookable live musical artists from venue calendars and Instagram discovery.

let cleanArtistName;
try {
  ({ cleanArtistName } = require("./utils.ts"));
} catch {
  ({ cleanArtistName } = require("./utils"));
}

const NON_ARTIST_EVENT_PATTERNS = [
  /\b(?:trivia(?: night)?|quiz night|geeks who drink|bingo|game night)\b/i,
  /\b(?:karaoke|sing-?along)\b/i,
  /\b(?:comedy|stand-?up|improv|open mic comedy)\b/i,
  /\b(?:drag (?:show|brunch|queen)|burlesque|cabaret|pageant|vixens of volstead)\b/i,
  /\b(?:movie|film|screening|watch party)\b/i,
  /\b(?:market|flea market|vintage market|craft fair|makers market|pop-up market|dog party|swap meet)\b/i,
  /\b(?:dance class|cumbia dance|yoga|workout|fitness)\b/i,
  /\b(?:tribute to|a tribute to|the .+? experience|the .+? songbook|music of)\b/i,
  /\b(?:open mic|jam session|happy hour)\b/i,
  /\b(?:closed for|private party|private event)\b/i,
  /\b(?:benefitting|benefit for|fundraiser for|charity)\b/i,
  /\b(?:blade rave|rave|dance party|\b(?:80s|90s|disco|emo|goth|taylor swift|smiths vs morrissey)\s+night\b)\b/i,
  /\b(?:vs\s+night|dance night|soul night)\b/i,
  /\b(?:doors\s*@|tickets\s*on\s*sale|general admission)\b/i,
];

const KNOWN_PROMOTER_OR_VENUE_NAMES = [
  /^(?:howdy gals|resound|do512|margin walker|kutx|austin chronicle|c3 presents|live nation|heard presents|transmission)\b/i,
  /^(?:hotel vegas|volstead|mohawk|antone'?s|continental club|continental gallery|the cut|saxon pub|c-?boys|broken spoke|elephant room|3ten|scoot inn|valhalla|haute spot|parker jazz|come and take it|cheer up charlies|swan dive|chess club|hole in the wall|far out lounge|carousel lounge|kick butt coffee)\b/i,
];

const NON_MUSIC_HANDLE_PATTERNS = [
  /(?:photo|photography|photographer|videography|videographer|films|visuals)$/i,
  /(?:chronicle|media|press|radio|podcast|magazine|blog|news)$/i,
  /(?:bar|pub|lounge|tavern|club|brewery|distillery|coffee|pizza|tacos|vintage|apparel|clothing|boutique|tattoo)$/i,
];

const MUSIC_BIO_ROLE_PATTERNS = [
  /\b(?:band|duo|trio|quartet|quintet|collective|orchestra|ensemble|outfit|troupe|frontman)\b/i,
  /\b(?:musician|artist|singer|songwriter|singer-songwriter|vocalist|vocals|guitarist|bassist|drummer|producer|rapper|mc|dj|composer|keys|synth|pedal steel)\b/i,
  /\b(?:recording artist|indie artist|original music|live music|live act)\b/i,
];

const MUSIC_BIO_GENRE_PATTERNS = [
  /\b(?:indie rock|punk rock|post-punk|noise rock|garage rock|psych rock|rock & roll|rock 'n' roll|hard rock|metalcore|death metal|black metal|heavy metal)\b/i,
  /\b(?:shoegaze|dream pop|synth-?pop|post-hardcore|emo|hardcore|grunge|alternative rock|alt-?rock)\b/i,
  /\b(?:americana|country|folk|bluegrass|honky-?tonk|texas country|outlaw country)\b/i,
  /\b(?:hip[\s-]?hop|r&b|soul|neo-?soul|funk|jazz|blues|electronic|techno|house music|ambient)\b/i,
];

const MUSIC_BIO_RELEASE_PATTERNS = [
  /\b(?:debut|new|latest|upcoming)?\s*(?:album|ep|lp|single|track|song|records?|discography)\b/i,
  /\b(?:out now|streaming (?:now|on)|stream (?:my|our)|listen (?:to|now)|new music|pre-?save|drop(?:ping)? soon)\b/i,
  /\b(?:vinyl|cassette|tape|record release|album release|single release)\b/i,
  /\b(?:spotify|apple music|bandcamp|soundcloud|audiomack|tidal)\b/i,
];

const MUSIC_BIO_TOUR_PATTERNS = [
  /\b(?:on tour|tour dates|touring|shows?|live at|booking[:\s]|inquiries[:\s]|mgmt[:\s]|tickets in bio|playing next|next show)\b/i,
];

const MUSIC_URL_PATTERNS = [
  /spotify\.com/i,
  /bandcamp\.com/i,
  /music\.apple\.com/i,
  /soundcloud\.com/i,
  /audiomack\.com/i,
  /tidal\.com/i,
  /youtube\.com\/(?:@|c\/|channel\/|user\/|watch)/i,
  /youtu\.be\//i,
  /(?:distrokid|unitedmasters|tunecore|linktr\.ee|beacons\.ai|lnk\.to|bio\.link|fanlink\.to|hyperfollow\.com|solo\.to)/i,
];

const MUSIC_CATEGORY_PATTERNS = [
  /\b(?:musician|band|artist|music producer|record label|songwriter|singer)\b/i,
];

const NON_MUSIC_BIO_DISQUALIFIERS = [
  /\b(?:photographer|photography|videographer|videography|director of photography|portrait photographer|camera operator|photo & video|visual artist|photos by)\b/i,
  /\b(?:music magazine|zine|journalism|journalist|media group|press|blog|radio station|podcast host|podcast|news)\b/i,
  /\b(?:cocktail bar|craft beer|brewery|distillery|dive bar|tavern|saloon|lounge|restaurant|tacos|pizza|food truck|eats|coffee shop|cafe|bakery)\b/i,
  /\b(?:tattoo artist|tattoo studio|tattoos?|barber|barbershop|hair stylist|vintage clothing|vintage shop|thrift store|apparel|clothing brand|boutique)\b/i,
  /\b(?:fan page|fan account|meme account|community organization|nonprofit)\b/i,
];

/**
 * Parses venue post captions to determine if a handle is named as a live performer or credited for non-musical roles.
 */
function extractVenueCaptionContext(caption, handle) {
  if (!caption || !handle) return { isLineupPerformer: false, isCreditDisqualified: false };
  const h = String(handle).toLowerCase().replace(/^@/, "");

  // Credit disqualifiers: photo by @handle, 📸: @handle, sound by @handle, flyer by @handle
  const photoCreditRx = new RegExp(
    `(?:photos?|pics?|shots?|captured|camera|film|photo cred(?:it)?|📸|📷)\\s*(?:by|:|via|-|—)?\\s*@?${h}\\b`,
    "i"
  );
  if (photoCreditRx.test(caption)) {
    return { isLineupPerformer: false, isCreditDisqualified: true, creditReason: "venue_photo_credit" };
  }

  const soundCreditRx = new RegExp(
    `(?:sound|audio|sound engineer|sound guy|sound by|lights|lighting)\\s*(?:by|:|via|-|—)?\\s*@?${h}\\b`,
    "i"
  );
  if (soundCreditRx.test(caption)) {
    return { isLineupPerformer: false, isCreditDisqualified: true, creditReason: "venue_sound_credit" };
  }

  const artCreditRx = new RegExp(
    `(?:poster|flyer|art|artwork|graphics?|illustration)\\s*(?:by|:|via|-|—)?\\s*@?${h}\\b`,
    "i"
  );
  if (artCreditRx.test(caption)) {
    return { isLineupPerformer: false, isCreditDisqualified: true, creditReason: "venue_art_credit" };
  }

  // Lineup performer indicators:
  // "Live sets from @...", "performing live: @...", "live on stage: @...", "with @...", "lineup: @..."
  const lineupRx = new RegExp(
    `(?:live sets? from|performing live|live on stage|live at [a-z0-9 ]+|lineup[:\\s]|doors\\s*(?:@|at)\\s*\\d|music\\s*(?:@|at)\\s*\\d|set times?|sets by|tonight[:\\s]|w\\/|with|support from)\\s*[^.\\n]*?@${h}\\b`,
    "i"
  );
  if (lineupRx.test(caption)) {
    return { isLineupPerformer: true, isCreditDisqualified: false };
  }

  return { isLineupPerformer: false, isCreditDisqualified: false };
}

/**
 * Checks an Instagram profile for music artist signals vs non-musical disqualifiers.
 */
function checkProfileMusicSignals(item) {
  const signals = [];
  const disqualifiers = [];

  const handle = item.handle || "";
  const bioText = (item.bio || item.desc || "").trim();
  const externalUrl = item.externalUrl || "";
  const categoryName = item.categoryName || item.businessCategoryName || "";
  const caption = item.caption || "";

  // 1. Handle disqualifiers & indicators
  if (handle) {
    for (const rx of NON_MUSIC_HANDLE_PATTERNS) {
      if (rx.test(handle)) {
        disqualifiers.push(`handle_disqualifier: ${handle}`);
        break;
      }
    }
    if (/(?:_band|_music|band|music|atxmusic|trio|duo|sound|records|official)$/i.test(handle)) {
      signals.push(`handle_music_indicator: ${handle}`);
    }
  }

  // 2. Venue caption context
  if (caption && handle) {
    const venueContext = extractVenueCaptionContext(caption, handle);
    if (venueContext.isCreditDisqualified && venueContext.creditReason) {
      disqualifiers.push(venueContext.creditReason);
    } else if (venueContext.isLineupPerformer) {
      signals.push("venue_lineup_performer");
    }
  }

  if (item.taggedCount && Number(item.taggedCount) >= 2) {
    signals.push(`tagged_in_${item.taggedCount}_venue_posts`);
  }

  // 3. Category Name checks
  if (categoryName) {
    for (const rx of MUSIC_CATEGORY_PATTERNS) {
      if (rx.test(categoryName)) {
        signals.push(`category: ${categoryName}`);
        break;
      }
    }
    if (/(?:photographer|photography|bar|pub|restaurant|tattoo|clothing|apparel|media)/i.test(categoryName)) {
      disqualifiers.push(`category_disqualifier: ${categoryName}`);
    }
  }

  // 4. External URL checks (music platforms)
  if (externalUrl) {
    for (const rx of MUSIC_URL_PATTERNS) {
      if (rx.test(externalUrl)) {
        signals.push(`music_link: ${externalUrl.slice(0, 40)}`);
        break;
      }
    }
  }

  // 5. Bio text checks
  if (bioText) {
    for (const rx of NON_MUSIC_BIO_DISQUALIFIERS) {
      if (rx.test(bioText)) {
        disqualifiers.push("bio_disqualifier");
        break;
      }
    }

    for (const rx of MUSIC_BIO_ROLE_PATTERNS) {
      if (rx.test(bioText)) {
        signals.push("bio_music_role");
        break;
      }
    }

    for (const rx of MUSIC_BIO_RELEASE_PATTERNS) {
      if (rx.test(bioText)) {
        signals.push("bio_music_release");
        break;
      }
    }

    for (const rx of MUSIC_BIO_GENRE_PATTERNS) {
      if (rx.test(bioText)) {
        signals.push("bio_music_genre");
        break;
      }
    }

    for (const rx of MUSIC_BIO_TOUR_PATTERNS) {
      if (rx.test(bioText)) {
        signals.push("bio_tour_or_booking");
        break;
      }
    }
  }

  // Resolution logic:
  // If clear disqualifiers exist and no definitive music platform streaming links or musician category:
  const hasStrongMusicProof = signals.some(
    (s) => s.startsWith("music_link") || s.startsWith("category: Musician") || s.startsWith("category: Band")
  );

  if (disqualifiers.length > 0 && !hasStrongMusicProof) {
    return {
      isArtist: false,
      signals,
      disqualifiers,
      reason: disqualifiers.join(", "),
    };
  }

  if (signals.length > 0) {
    return {
      isArtist: true,
      signals,
      disqualifiers,
      reason: signals.join(", "),
    };
  }

  return {
    isArtist: null,
    signals,
    disqualifiers,
    reason: "insufficient_profile_data",
  };
}

function normalizeSiftItem(item, index) {
  if (!item || typeof item !== "object") {
    return {
      index,
      rawName: "",
      name: "",
      sourceType: "unknown",
      desc: "",
    };
  }

  const rawName = String(
    item.artist ||
    item.artistName ||
    item.band ||
    item.musician ||
    item.ownerUsername ||
    item.username ||
    item.fullName ||
    item.title ||
    item.name ||
    ""
  );

  const cleanName = cleanArtistName(rawName);
  const eventTitle = item.eventTitle ? String(item.eventTitle).trim() : undefined;
  const venueName = item.venueName ? String(item.venueName).trim() : undefined;
  const handle = (item.ownerUsername || item.username || item.handle || item.instagramHandle)
    ? String(item.ownerUsername || item.username || item.handle || item.instagramHandle).replace(/^@+/, "").trim()
    : undefined;

  const sourceType = eventTitle || venueName
    ? "venue_calendar"
    : String(item.sourceType || "instagram");

  const bio = (item.biography || item.bio) ? String(item.biography || item.bio).trim() : undefined;
  const externalUrl = (item.externalUrl || item.externalURL || item.website || item.websiteUrl)
    ? String(item.externalUrl || item.externalURL || item.website || item.websiteUrl).trim()
    : undefined;
  const categoryName = (item.categoryName || item.businessCategoryName || item.category)
    ? String(item.categoryName || item.businessCategoryName || item.category).trim()
    : undefined;
  const caption = (item.caption || item.text) ? String(item.caption || item.text).trim() : undefined;
  const postOwner = item.postOwner ? String(item.postOwner).trim() : undefined;
  const taggedCount = typeof item.taggedCount === "number" ? item.taggedCount : undefined;

  const desc = String(
    bio || item.description || caption || ""
  ).slice(0, 500).trim();

  return {
    index,
    rawName,
    name: cleanName || rawName,
    eventTitle,
    venueName,
    handle,
    sourceType,
    desc,
    bio,
    externalUrl,
    categoryName,
    businessCategoryName: categoryName,
    taggedCount,
    postOwner,
    caption,
  };
}

function evaluateItemHeuristic(item) {
  const cleanName = cleanArtistName(item.name || item.rawName);
  const rawName = item.rawName;
  const eventTitle = item.eventTitle || "";
  const isVenueItem = item.sourceType === "venue_calendar" || Boolean(item.eventTitle || item.venueName);

  const nameAndEvent = `${cleanName} ${rawName} ${eventTitle}`.toLowerCase();

  // 1. Negative pattern check in artist name or event title
  for (const rx of NON_ARTIST_EVENT_PATTERNS) {
    if (rx.test(nameAndEvent)) {
      return { index: item.index, isArtist: false, cleanName, reason: "event_pattern" };
    }
  }

  // 2. Promoter or venue check on cleaned name
  for (const rx of KNOWN_PROMOTER_OR_VENUE_NAMES) {
    if (rx.test(cleanName)) {
      return { index: item.index, isArtist: false, cleanName, reason: "promoter_or_venue" };
    }
  }

  // 3. Name length and validity check
  if (!cleanName || cleanName.length < 2 || cleanName.length > 60) {
    return { index: item.index, isArtist: false, cleanName, reason: "invalid_length" };
  }
  if (!/[a-z]/i.test(cleanName)) {
    return { index: item.index, isArtist: false, cleanName, reason: "no_letters" };
  }
  if (/^(?:tba|to be announced|various artists|more bands?|special guest|tbd|unknown artist)$/i.test(cleanName)) {
    return { index: item.index, isArtist: false, cleanName, reason: "placeholder" };
  }

  // 4. Venue calendar items that passed all filters are live musical artists
  if (isVenueItem) {
    return { index: item.index, isArtist: true, cleanName };
  }

  // 5. Instagram profile checks: inspect profile for music artist signals
  const profileEval = checkProfileMusicSignals(item);
  item.profileSignals = profileEval.signals;
  item.profileDisqualifiers = profileEval.disqualifiers;

  if (profileEval.isArtist !== null) {
    return {
      index: item.index,
      isArtist: profileEval.isArtist,
      cleanName,
      reason: profileEval.reason,
    };
  }

  // 6. When profile signals are ambiguous (e.g. empty bio, no category):
  // Check word count and basic shape, but do not reject non-traditional band names
  const words = cleanName.split(/\s+/);
  if (words.length > 5) {
    return { index: item.index, isArtist: false, cleanName, reason: "too_many_words" };
  }

  return { index: item.index, isArtist: true, cleanName, reason: "tagged_candidate" };
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function evaluateBatchAI(batch, apiKey, apiUrl, model) {
  const evaluationsMap = new Map();

  const evaluationList = batch
    .map((it) => {
      const parts = [`[${it.index}] NAME: ${it.name}`];
      if (it.handle) parts.push(`HANDLE: @${it.handle}`);
      if (it.eventTitle) parts.push(`EVENT: ${it.eventTitle}`);
      if (it.venueName) parts.push(`VENUE: ${it.venueName}`);
      if (it.categoryName) parts.push(`CATEGORY: ${it.categoryName}`);
      if (it.externalUrl) parts.push(`LINK: ${it.externalUrl}`);
      if (it.bio) parts.push(`BIO: ${it.bio.slice(0, 200)}`);
      else if (it.desc) parts.push(`DESC: ${it.desc.slice(0, 200)}`);
      if (it.caption && it.caption !== it.desc) parts.push(`POST: ${it.caption.slice(0, 150)}`);
      if (it.profileSignals && it.profileSignals.length > 0) parts.push(`SIGNALS: ${it.profileSignals.join(", ")}`);
      if (it.profileDisqualifiers && it.profileDisqualifiers.length > 0) parts.push(`DISQUALIFIERS: ${it.profileDisqualifiers.join(", ")}`);
      parts.push(`TYPE: ${it.sourceType}`);
      return parts.join(" | ");
    })
    .join("\n");

  const strictPrompt = `
You are an expert live music industry filter for an Austin recording studio.
Evaluate each candidate below and determine if it represents a VALID, BOOKABLE LIVE MUSICAL ARTIST OR BAND (singer-songwriter, band, musician, rapper, etc.).

CRITICAL RULES FOR INSTAGRAM CANDIDATES:
1. Base your evaluation strictly on PROFILE SIGNALS and EVIDENCE:
   - Bio mentions of musical roles, instruments, releases, albums, songs, tours, or genres.
   - External links to Spotify, Bandcamp, Apple Music, SoundCloud, or music link hubs.
   - Profile category indicating Musician/band, Artist, or Producer.
   - Venue post context showing them as a performer in a live concert lineup.
2. DO NOT deduce whether someone is an artist based solely on their name sounding like a dictionary word, object, or common name (e.g. "Font", "Being Dead", "Borzoi", "Television", "Low", "Spoon" are real active bands). If profile signals or venue performance context show they are a musical act, mark them TRUE.
3. Reject non-musicians:
   - Photographers, videographers, visual artists (e.g. tagged as photo credit, bio says photographer)
   - Venues, bars, pubs, breweries, lounges, food trucks, restaurants, coffee shops
   - Media outlets, press, zines, podcasts, radio stations, journalists
   - Tattoo artists, barbers, clothing brands, vintage shops, boutiques
   - Sound technicians, lighting crew, or poster artists tagged for credits

Return a JSON object with key "evaluations" containing an array of objects:
{
  "evaluations": [
    { "index": number, "isArtist": boolean, "cleanName": string }
  ]
}

DATA:
${evaluationList}
  `.trim();

  const isResponsesApi = apiUrl.includes("/responses");
  const bodyPayload = isResponsesApi
    ? { model, input: strictPrompt, text: { format: { type: "json_object" } } }
    : { model, messages: [{ role: "user", content: strictPrompt }], response_format: { type: "json_object" } };

  const timeout = withTimeout(15000);
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(bodyPayload),
      signal: timeout.signal,
    });

    if (!res.ok) {
      throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`);
    }

    const json = await res.json();
    let content = "";
    if (isResponsesApi && json.output && json.output.length > 0) {
      const firstOutput = json.output[0];
      if (firstOutput.type === "message" && firstOutput.content && firstOutput.content.length > 0) {
        content = firstOutput.content[0].text || "";
      } else if (firstOutput.type === "text") {
        content = firstOutput.text || "";
      }
    } else if (json.choices && json.choices.length > 0) {
      content = json.choices[0].message?.content || "";
    }

    const parsed = (() => {
      try {
        return JSON.parse(String(content).trim());
      } catch {
        const match = String(content).match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : null;
      }
    })();

    const evaluationsArray = Array.isArray(parsed?.evaluations)
      ? parsed.evaluations
      : Array.isArray(parsed?.results)
        ? parsed.results.map((r, idx) => ({
            index: batch[idx]?.index,
            isArtist: Boolean(typeof r === "boolean" ? r : r?.isArtist),
            cleanName: batch[idx]?.name || "",
          }))
        : [];

    for (const ev of evaluationsArray) {
      if (typeof ev?.index === "number") {
        evaluationsMap.set(ev.index, {
          index: ev.index,
          isArtist: Boolean(ev.isArtist),
          cleanName: typeof ev.cleanName === "string" && ev.cleanName.trim()
            ? cleanArtistName(ev.cleanName)
            : batch.find((b) => b.index === ev.index)?.name || "",
        });
      }
    }
  } finally {
    timeout.clear();
  }

  return evaluationsMap;
}

async function siftItems(rawItems) {
  const parsedItems = Array.isArray(rawItems) ? rawItems.slice(0, 500) : [];
  if (parsedItems.length === 0) {
    return { results: [], mode: "fallback", cleanedNames: {} };
  }

  const normalized = parsedItems.map((it, idx) => normalizeSiftItem(it, idx));
  const apiKey = process.env.OPENAI_API_KEY;
  const apiUrl = process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions";
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const evaluations = new Array(normalized.length);
  const cleanedNames = {};

  // First pass: pre-evaluate profile signals so both AI and heuristic have full signals attached
  for (let i = 0; i < normalized.length; i++) {
    const sig = checkProfileMusicSignals(normalized[i]);
    normalized[i].profileSignals = sig.signals;
    normalized[i].profileDisqualifiers = sig.disqualifiers;
  }

  let usedAI = false;

  if (apiKey) {
    try {
      const BATCH_SIZE = 25;
      const batches = [];
      for (let i = 0; i < normalized.length; i += BATCH_SIZE) {
        batches.push(normalized.slice(i, i + BATCH_SIZE));
      }

      const batchResults = await Promise.all(
        batches.map(async (batch) => {
          try {
            return await evaluateBatchAI(batch, apiKey, apiUrl, model);
          } catch (batchError) {
            console.warn("[SIFT] AI batch failed, falling back to heuristic for batch:", batchError);
            const fallbackMap = new Map();
            for (const it of batch) {
              fallbackMap.set(it.index, evaluateItemHeuristic(it));
            }
            return fallbackMap;
          }
        })
      );

      usedAI = true;
      for (const batchMap of batchResults) {
        for (const [idx, ev] of batchMap.entries()) {
          evaluations[idx] = ev;
        }
      }
    } catch (aiError) {
      console.error("[SIFT] AI processing failed, using heuristic:", aiError);
      usedAI = false;
    }
  }

  // Fill in any gaps with heuristic evaluations
  for (let i = 0; i < normalized.length; i++) {
    if (!evaluations[i]) {
      evaluations[i] = evaluateItemHeuristic(normalized[i]);
    }
    cleanedNames[i] = evaluations[i].cleanName;
  }

  const results = evaluations.map((ev) => Boolean(ev?.isArtist));

  return {
    results,
    mode: usedAI ? "ai" : "fallback",
    cleanedNames,
  };
}

module.exports = {
  NON_ARTIST_EVENT_PATTERNS,
  KNOWN_PROMOTER_OR_VENUE_NAMES,
  NON_MUSIC_HANDLE_PATTERNS,
  MUSIC_BIO_ROLE_PATTERNS,
  MUSIC_BIO_GENRE_PATTERNS,
  MUSIC_BIO_RELEASE_PATTERNS,
  MUSIC_BIO_TOUR_PATTERNS,
  MUSIC_URL_PATTERNS,
  MUSIC_CATEGORY_PATTERNS,
  NON_MUSIC_BIO_DISQUALIFIERS,
  extractVenueCaptionContext,
  checkProfileMusicSignals,
  normalizeSiftItem,
  evaluateItemHeuristic,
  siftItems,
};
