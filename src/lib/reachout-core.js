// src/lib/reachout-core.js
// Shared reachout prompt generation and validation core for Spectral Soundworks.

const { TRACK_TITLE_RULE, verifiedTrackTitle } = require("./spotify-outreach");

const { parseShowActivity } = require("./show-parser");

const REACHOUT_CONFIG = {
  model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  apiUrl: process.env.OPENAI_API_URL || "https://api.openai.com/v1/responses",
  maxRecentPostsChars: 1400,
  maxBioChars: 520,
  maxPersonalHookChars: 340,
};

const GENRE_STYLES = {
  hiphop: {
    keywords: ["hip hop", "hip-hop", "rap", "trap", "drill", "boom bap", "grime"],
    igAEmojis: "0-1 emoji max (e.g. 🎧 or 🎤), only if natural",
    igBEmojis: "0-1 emoji max (or none)",
    emailEmojis: "none",
    tone: "casual, grounded, authentic peer respect. Zero cheesy slang, zero caricature.",
    igStyle: "Talk like a fellow producer/engineer who respects beats, flow, vocal clarity, and 808s.",
  },
  metal: {
    keywords: [
      "metal",
      "heavy metal",
      "death metal",
      "black metal",
      "doom",
      "thrash",
      "metalcore",
      "deathcore",
      "hardcore",
    ],
    igAEmojis: "0-1 emoji max (or none)",
    igBEmojis: "none",
    emailEmojis: "none",
    tone: "direct, grounded, respectful of heavy music. No cheese or parody.",
    igStyle: "Acknowledge guitar tones, aggressive drums, live intensity, or songwriting punch.",
  },
  rock: {
    keywords: ["rock", "alternative", "indie rock", "punk", "garage", "grunge"],
    igAEmojis: "0-1 emoji max (or none)",
    igBEmojis: "none",
    emailEmojis: "none",
    tone: "understated, authentic, unpretentious peer vibe",
    igStyle: "Straightforward and real; focus on songwriting, band energy, or raw room sound.",
  },
  electronic: {
    keywords: [
      "electronic",
      "edm",
      "house",
      "techno",
      "dubstep",
      "drum and bass",
      "dnb",
      "bass music",
      "dance",
    ],
    igAEmojis: "0-1 emoji max (or none)",
    igBEmojis: "none",
    emailEmojis: "none",
    tone: "production-literate, clean, conversational",
    igStyle: "Reference sound design, mix punch, low-end translation, or groove.",
  },
  pop: {
    keywords: ["pop", "indie pop", "synth pop", "dream pop", "r&b", "soul"],
    igAEmojis: "0-1 emoji max (or none)",
    igBEmojis: "none",
    emailEmojis: "none",
    tone: "warm, polished, conversational",
    igStyle: "Appreciate vocal production, hooks, and sonic polish.",
  },
  default: {
    keywords: [],
    igAEmojis: "0-1 emoji max (or none)",
    igBEmojis: "none",
    emailEmojis: "none",
    tone: "natural, authentic peer-to-peer musician/engineer",
    igStyle: "Conversational, genuine, unpretentious.",
  },
};

const clip = (value, max) => {
  if (!value) return "";
  if (value.length <= max) return value;
  let clipped = value.slice(0, max);
  // Guard against splitting surrogate pairs in half (high surrogate: 0xD800 - 0xDBFF)
  const lastCode = clipped.charCodeAt(clipped.length - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    clipped = clipped.slice(0, -1);
  }
  return clipped;
};

const detectGenreStyle = (genreText) => {
  if (!genreText) return GENRE_STYLES.default;
  const lower = genreText.toLowerCase();
  for (const key of Object.keys(GENRE_STYLES)) {
    if (key === "default") continue;
    const style = GENRE_STYLES[key];
    if (style.keywords.some((keyword) => lower.includes(keyword))) return style;
  }
  return GENRE_STYLES.default;
};

const GENRE_CLAIMS = [
  "hip hop", "hip-hop", "rap", "trap", "drill", "boom bap", "grime",
  "metal", "heavy metal", "death metal", "black metal", "doom metal", "doom", "thrash", "metalcore", "deathcore", "hardcore",
  "rock", "alternative", "indie rock", "punk", "post-punk", "garage", "grunge", "shoegaze",
  "electronic", "edm", "house", "techno", "dubstep", "drum and bass", "dnb", "bass music", "dance",
  "pop", "indie pop", "synth pop", "dream pop", "r&b", "soul", "funk",
  "country", "folk", "jazz", "blues", "classical", "reggaeton", "latin",
];

const findUnsupportedGenreTerms = (text, genreText) => {
  if (!text) return [];
  const source = genreText?.toLowerCase() || "";
  return GENRE_CLAIMS.filter((claim) => {
    const escaped = claim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(text) && !source.includes(claim);
  });
};

const AUSTIN_LOCAL_PATTERN =
  /\b(austin|round rock|cedar park|pflugerville|georgetown|kyle|buda|leander|manor|bastrop|dripping springs|lakeway|bee cave|sunset valley|rollingwood)\b/i;

const isAustinLocal = (location) => {
  if (!location) return false;
  return AUSTIN_LOCAL_PATTERN.test(location);
};

const buildPayload = (ctx) => {
  const now = new Date();
  const currentDateStr =
    ctx.currentDate ||
    new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(now);

  const genreStyle = detectGenreStyle(ctx.genreText);
  const isLocal = isAustinLocal(ctx.location);

  // Resolve upcoming vs recent past show
  let upcoming = ctx.upcomingShow || null;
  let recentPast = ctx.recentPastShow || null;

  // Fallback: If legacy showInfo was provided but structured upcomingShow was not, parse it
  if (!upcoming && !recentPast && ctx.showInfo) {
    const parsed = parseShowActivity(ctx.showInfo, now);
    if (parsed) {
      if (parsed.isUpcoming) {
        upcoming = {
          title: parsed.title,
          venue: parsed.venue,
          datePretty: parsed.dateStr,
          daysUntil: parsed.daysDiff,
        };
      } else if (parsed.daysDiff >= -30) {
        recentPast = {
          title: parsed.title,
          venue: parsed.venue,
          datePretty: parsed.dateStr,
          daysAgo: Math.abs(parsed.daysDiff),
        };
      }
      // If parsed.daysDiff < -30 (show is > 30 days old), it is ignored and remains null
    }
  }

  let upcomingShowText = "None";
  let upcomingRuleText = "";

  if (upcoming) {
    const venueText = upcoming.venue ? ` at ${upcoming.venue}` : "";
    const dateText = upcoming.datePretty ? ` on ${upcoming.datePretty}` : "";
    const daysText = upcoming.daysUntil !== undefined ? ` (in ${upcoming.daysUntil} days)` : "";
    upcomingShowText = `${upcoming.title || "Show"}${venueText}${dateText}${daysText}`;

    if (isLocal) {
      upcomingRuleText =
        `   - The artist has an upcoming Austin show: ${upcomingShowText}.\n` +
        `     NOTE: Artist is Austin-local. Mention looking forward to their gig${upcoming.venue ? ` at ${upcoming.venue}` : ""}, but NEVER say "while you're in town" or suggest they are visiting Austin.\n`;
    } else {
      upcomingRuleText =
        `   - The artist has an upcoming Austin show: ${upcomingShowText}.\n` +
        `     NOTE: Artist is visiting Austin from out of town (${ctx.location || "non-local"}). Mention the upcoming show and suggest stopping by the studio while they are in town. Keep it low-pressure.\n`;
    }
  }

  let pastShowText = "";
  let pastRuleText = "";

  if (!upcoming && recentPast) {
    const venueText = recentPast.venue ? ` at ${recentPast.venue}` : "";
    const dateText = recentPast.datePretty ? ` on ${recentPast.datePretty}` : "";
    const daysAgoText = recentPast.daysAgo !== undefined ? ` (${recentPast.daysAgo} days ago)` : "";
    pastShowText = `${recentPast.title || "Show"}${venueText}${dateText}${daysAgoText}`;

    pastRuleText =
      `   - The artist recently played an Austin show: ${pastShowText}.\n` +
      `     CRITICAL: This show ALREADY happened in the past. If you mention it, speak strictly in the past tense (e.g. "Hope that set${recentPast.venue ? ` at ${recentPast.venue}` : ""} was killer"). NEVER refer to it as upcoming or suggest they are in town for it.\n`;
  }

  const defaultShowRuleText = !upcoming && !recentPast
    ? "   - Do NOT mention an upcoming Austin show or suggest the artist is traveling to Austin.\n"
    : "";

  const messagesToGenerate = ctx.hasEmail
    ? "FOUR messages: IG_A, IG_B, EMAIL_A, EMAIL_B"
    : "TWO messages: IG_A, IG_B (no emails needed)";

  const genreInstructions =
    "GENRE-SPECIFIC TONE REQUIREMENTS:\n" +
    `Artist Genre: ${ctx.genreText || "Not specified"}\n` +
    "GENRE FACTUALITY RULE: Treat the artist genre above as verified metadata. Do not invent, substitute, or upgrade it into another genre or subgenre. Never infer genre from a release title, bio, image, post, venue, or musical cliché. If the genre is not specified, do not use genre labels.\n" +
    `Tone: ${genreStyle.tone}\n` +
    `IG Style: ${genreStyle.igStyle}\n\n` +
    "EMOJI REQUIREMENTS (STRICT):\n" +
    `- IG_A: ${genreStyle.igAEmojis}\n` +
    `- IG_B: ${genreStyle.igBEmojis}\n` +
    (ctx.hasEmail
      ? `- EMAIL_A: ${genreStyle.emailEmojis}\n- EMAIL_B: ${genreStyle.emailEmojis}\n`
      : "");

  const styleHintText = ctx.styleHint ? `Style tweak (apply to ALL messages): ${ctx.styleHint}\n` : "";

  let productionNeedBlock = "";
  if (ctx.productionNeedLevel && ctx.productionNeedLevel !== "NONE") {
    const evidenceStr = Array.isArray(ctx.productionNeedEvidence)
      ? ctx.productionNeedEvidence.join("; ")
      : (ctx.productionNeedEvidence || "");
    productionNeedBlock =
      `Detected Production Need: ${ctx.productionNeedLevel}\n` +
      (evidenceStr ? `Evidence / Need Signals: ${evidenceStr}\n` : "") +
      "NOTE: For Variant A (Craft & Sound), prioritize speaking directly to this need (e.g. finishing mixes, tracking drums/vocals, recording new material) in a casual, peer-to-peer way.\n\n";
  }

  const portfolioOfferBlock = ctx.portfolioOffer
    ? "PORTFOLIO COLLABORATION OFFER (MANDATORY):\n" +
      "- Kasper is currently accepting artists of any genre for a first-song portfolio collaboration.\n" +
      "- The offer is recording, mixing, and mastering the artist's first song at no cost, with unlimited revisions within the agreed song scope.\n" +
      "- This offer is the primary hook, not a vague aside. State the actual deliverables and value directly in every generated message: first song recording, mixing, and mastering at no cost, with unlimited revisions within the agreed song scope.\n" +
      "- Use definitive words such as 'free', 'at no cost', or 'complimentary'. Do not replace the offer with 'collab', 'portfolio collab', 'help with recording or mixing', 'accepting artists', or 'would love to connect'.\n" +
      "- Put the direct offer in the first or second sentence whenever the channel length allows. Do not imply a limited number of spots or use scarcity language.\n\n"
    : "";

  const systemText = TRACK_TITLE_RULE +
    "You write outreach for Kasper Pickett, an independent audio engineer based in Austin, Texas.\nCRITICAL REQUIREMENT: Do NOT mention 'Spectral Soundworks' anywhere in outreach. Introduce Kasper simply as an independent Austin audio engineer.\n" +
    "Your objective: Initiate a genuine connection between fellow music creators. Sound like a real Austin engineer—conversational, understated, peer-to-peer, confident, and chill. Zero marketing fluff or sales desperation.\n\n" +
    "TEMPORAL ACCURACY RULES (CRITICAL & MANDATORY):\n" +
    `- Today's date is ${currentDateStr}.\n` +
    "- NEVER refer to any event, show, tour date, or social post that occurred before today as 'upcoming', 'coming up', 'soon', 'tonight', 'tomorrow', or 'next week'.\n" +
    "- If a show or event date occurred before today, it is in the PAST. You may ONLY refer to it in the past tense (e.g., 'hope your set at [Venue] was killer' or 'saw you played [Venue]').\n" +
    "- Pay close attention to post date prefixes (e.g. '[Posted 2 months ago on Aug 15, 2026]'). If an older post announced a gig or track release that was upcoming at that time, that event has ALREADY happened! Never frame past post announcements as future events.\n" +
    "- Only refer to a show as upcoming if it is explicitly listed under 'Upcoming Show' with a future date relative to today.\n" +
    "- For music releases that have already dropped, praise the music that is out. Never say 'can't wait for it to drop' if it has already been released.\n\n" +
    "Banned phrases and vibes (do not use):\n" +
    "- i run a studio / run a studio\n" +
    "- mixing and tracking room\n" +
    "- tracking room / tracking & mix room\n" +
    "- in east Austin / in East Austin\n" +
    "- East Austin / east Austin\n" +
    "- on the east side\n" +
    "- love what you're building\n" +
    "- super clean work\n" +
    "- really solid stuff\n" +
    "- momentum\n" +
    "- resonated\n" +
    "- quick message\n" +
    "- no pressure\n" +
    "- hope this finds you well\n" +
    "- reaching out to see\n" +
    "- game-changer / next level\n" +
    "- just wanted to drop a line\n" +
    "- delve / dive into\n\n" +
    "CHANNEL FORMATTING RULES:\n" +
    "1. INSTAGRAM DMS (IG_A, IG_B):\n" +
    "   - LENGTH & CHARACTER COUNT: 2 to 4 sentences, roughly 60–100 words (approx 350–600 characters). Not a truncated blurb.\n" +
    "   - STYLE: Direct DM style. No formal greeting like 'Dear...' or resume introduction ('Hello, I am Kasper Pickett, an audio engineer in Austin...'). Jump straight to their music or show, casually introduce Kasper as an Austin audio engineer collaborating on sound in Austin, and keep the door open. NEVER say 'I run a studio', 'tracking room', or 'in East Austin'.\n" +
    "   - EMOJIS: Maximum 0 to 1 natural emoji, or none.\n" +
    "2. EMAILS (EMAIL_A, EMAIL_B):\n" +
    "   - STRUCTURE:\n" +
    "     * Line 1: Must begin with 'Subject: [Short, natural subject line]' (e.g. 'Question on [Track] mixes' or '[Venue] show + Austin sound')\n" +
    "     * Line 2: Empty line\n" +
    "     * Line 3: 'Hey [Artist],' or 'Hey [First Name],' if personal name is clear\n" +
    "     * Line 4: Empty line\n" +
    "     * Paragraph 1: 1-2 sentences with specific observation on their sound, release, production need, or show.\n" +
    "     * Paragraph 2: 2-3 sentences on Kasper as an audio engineer in Austin and a low-friction invite to connect, collaborate on sound, track, or mix. Do NOT say 'I run a studio', 'tracking room', or 'in East Austin'.\n" +
    "     * Signoff:\n" +
    "       Best,\n" +
    "       Kasper Pickett\n" +
    "       (Do not append a company or studio name.)\n" +
    "   - LENGTH & CHARACTER COUNT: Full, thoughtful email. 120–180 words (approx 750–1,200 characters). Clean paragraphs, zero emojis.\n\n" +
    "TACTICAL ANGLES:\n" +
    "- VARIANT A (IG_A, EMAIL_A) = THE CRAFT & SOUND ANGLE:\n" +
    "  Focus on their music, production, instrumentation, mix tones, recent release, or detected production need.\n" +
    "- VARIANT B (IG_B, EMAIL_B) = THE LIVE SCENE & COMMUNITY ANGLE:\n" +
    "  Focus on their upcoming gig in Austin, recent show, local scene ties, or live performance.\n\n" +
    "Hard constraints:\n" +
    `- Write ${messagesToGenerate}.\n` +
    portfolioOfferBlock +
    (ctx.portfolioOffer
      ? "- Every message must present the free first-song offer directly and prominently; personalization should lead into the offer, not bury or soften it.\n"
      : "- Every message must establish Kasper as an Austin audio engineer with an organic, subtle offer of mixing/mastering/production (not salesy, not pushy).\n") +
    "- MANDATORY RESTRICTION: Do NOT use the phrases 'I run a studio', 'run a studio', 'mixing and tracking room', 'tracking room', 'in East Austin', 'East Austin', or 'on the east side'. If referencing location, simply say 'in Austin' or 'here in Austin'.\n" +
    "- Do NOT mention AI, automation, scraping, spreadsheets, algorithms, or data.\n" +
    "- If referencing posts, paraphrase meaning like you actually understood it.\n" +
    `- Output JSON only with keys: ${ctx.hasEmail ? "IG_A, IG_B, EMAIL_A, EMAIL_B" : "IG_A, IG_B"}.\n` +
    styleHintText +
    (ctx.hasEmail
      ? "- EMAIL_A and EMAIL_B must end with signoff name exactly: Kasper Pickett.\n"
      : "") +
    "- Do NOT include placeholders like [Your Name], [Your Studio], [Phone], or [Your contact information].\n";

  let releaseLine = "None";
  if (ctx.releaseTitle) {
    if (ctx.releaseTiming) {
      releaseLine = `Spotify-verified music: ${ctx.releaseTitle} (${ctx.releaseTiming})`;
    } else if (ctx.isRecentRelease) {
      releaseLine = `Spotify-verified music: ${ctx.releaseTitle} (Recently released${ctx.releaseDatePretty ? ` on ${ctx.releaseDatePretty}` : ""})`;
    } else {
      releaseLine = `Spotify-verified music: ${ctx.releaseTitle} (Past release)`;
    }
  }

  const userText =
    "Context:\n" +
    `Current Date: ${currentDateStr}\n` +
    `Artist: ${ctx.artist}\n` +
    `Location (Artist's Home): ${ctx.location || "Unknown"}\n` +
    `Upcoming Show: ${upcomingShowText}\n` +
    (pastShowText ? `Recent Past Show (Already happened): ${pastShowText}\n` : "") +
    "\n" +
    productionNeedBlock +
    portfolioOfferBlock +
    genreInstructions +
    "DRAFT-SPECIFIC RULES:\n" +
    "1. VARIANT A (IG_A and EMAIL_A) — Craft & Sound Focus:\n" +
    (ctx.productionNeedLevel && ctx.productionNeedLevel !== "NONE"
      ? "   - Address the detected production need as a natural reason to connect.\n"
      : ctx.isRecentRelease && ctx.releaseTitle
        ? `   - Reference the recent release: ${ctx.releaseTitle}. Include the title verbatim.\n`
        : ctx.personalHook
          ? "   - Reference the Personal Hook.\n"
          : ctx.recentPosts
            ? "   - Reference exactly ONE idea from Recent Posts. Pick the most interesting one and paraphrase it naturally. Respect the post timestamps!\n"
            : "   - Be friendly and refer to their overall vibe or sound.\n") +
    "\n2. VARIANT B (IG_B and EMAIL_B) — Scene & Live Focus:\n" +
    (upcomingRuleText || pastRuleText || (
      ctx.recentPosts
        ? "   - Reference exactly ONE idea from Recent Posts. Pick the most interesting one and paraphrase it naturally. Respect the post timestamps!\n"
        : ctx.personalHook
          ? "   - Reference the Personal Hook.\n"
          : "   - Be friendly and refer to their presence in the scene.\n"
    )) +
    (defaultShowRuleText ? defaultShowRuleText : "") +
    "\nArtist Data:\n" +
    `Personal Hook: ${clip(ctx.personalHook, REACHOUT_CONFIG.maxPersonalHookChars)}\n` +
    `Recent release: ${releaseLine}\n` +
    `Recent IG Posts: ${clip(ctx.recentPosts, REACHOUT_CONFIG.maxRecentPostsChars)}\n` +
    `Bio: ${clip(ctx.bio, REACHOUT_CONFIG.maxBioChars)}\n\n` +
    "Return JSON only.\n";

  const schemaProperties = {
    IG_A: { type: "string" },
    IG_B: { type: "string" },
  };
  const requiredFields = ["IG_A", "IG_B"];
  if (ctx.hasEmail) {
    schemaProperties.EMAIL_A = { type: "string" };
    schemaProperties.EMAIL_B = { type: "string" };
    requiredFields.push("EMAIL_A", "EMAIL_B");
  }

  return {
    model: REACHOUT_CONFIG.model,
    store: false,
    input: [
      { role: "system", content: [{ type: "input_text", text: systemText }] },
      { role: "user", content: [{ type: "input_text", text: userText }] },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "reachouts",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: schemaProperties,
          required: requiredFields,
        },
      },
    },
  };
};

const extractJson = (resp) => {
  const output = Array.isArray(resp.output) ? resp.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const chunk of content) {
      if (chunk.type === "output_json" && chunk.json) return chunk.json;
      if (chunk.type === "output_text" && typeof chunk.text === "string") {
        return JSON.parse(chunk.text);
      }
    }
  }
  throw new Error("Could not find JSON in OpenAI response");
};

const mentionsServices = (text) =>
  /\b(record|recording|mix|mixes|mixing|mixdown|master|mastering|studio|session|engineer|engineering|tracking|audio|room|soundworks)\b/i.test(
    text
  );

const hasExplicitPortfolioOffer = (text) => {
  if (typeof text !== "string") return false;
  const lower = text.toLowerCase();
  const hasFree = /\b(?:free|no cost|at no cost|on the house|complimentary)\b/.test(lower);
  const hasService = /\b(?:mix|mixed|mixing|mixdown|master|mastered|mastering|record|recorded|recording|produce|produced|production|track|tracked|tracking|session)\b/.test(lower);
  return hasFree && hasService;
};

const validateRequired = (out, fields) => {
  for (const key of fields) {
    const value = out[key];
    if (!value || typeof value !== "string" || !value.trim()) {
      throw new Error(`Missing output for ${key}`);
    }
  }
};

const sanitizeDraftText = (text) => {
  if (typeof text !== "string") return text;
  let out = text;

  // 1. Remove East Austin / east Austin / east side references
  out = out.replace(/\bin east austin,?\s+texas\b/gi, "in Austin, Texas");
  out = out.replace(/\bin east austin,?\s+tx\b/gi, "in Austin, TX");
  out = out.replace(/\bin east austin\b/gi, "in Austin");
  out = out.replace(/\beast austin\b/gi, "Austin");
  out = out.replace(/\bon the east side in austin\b/gi, "in Austin");
  out = out.replace(/\bon the east side\b/gi, "in Austin");

  // 2. Eliminate "i run a studio / mixing and tracking room" and remove Spectral Soundworks
  out = out.replace(/\bi run a studio\s*\/\s*mixing and tracking room\b/gi, "I mix and produce records here in Austin");
  out = out.replace(/\bi run a studio,?\s+mixing and tracking room\b/gi, "I mix and produce records here in Austin");
  out = out.replace(/\bi run a (?:studio\s*\/\s*)?(?:mixing\s+and\s+)?tracking\s+room\b/gi, "I'm an audio engineer here in Austin");
  out = out.replace(/\bi run a (?:recording|mixing|tracking|studio)[\s\w/&-]*room\b/gi, "I'm an audio engineer here in Austin");
  out = out.replace(/\bi run a studio\b/gi, "I'm an audio engineer here in Austin");
  out = out.replace(/\brunning a (?:studio\s*\/\s*)?(?:mixing\s+and\s+)?tracking\s+room\b/gi, "engineering here in Austin");
  out = out.replace(/\brunning a (?:recording|mixing|tracking|studio)[\s\w/&-]*room\b/gi, "engineering here in Austin");
  out = out.replace(/\brunning a studio\b/gi, "engineering here in Austin");
  out = out.replace(/\b(?:a\s+)?mixing and tracking room\b/gi, "audio engineer in Austin");
  out = out.replace(/\b(?:a\s+)?tracking & mix room\b/gi, "audio engineer in Austin");
  out = out.replace(/\b(?:a\s+)?tracking and mix room\b/gi, "audio engineer in Austin");
  out = out.replace(/\btracking room\b/gi, "studio space");

  // Remove any Spectral Soundworks references from outreach drafts
  out = out.replace(/\b(?:with|at|from)\s+Spectral\s+Soundworks\b/gi, "here in Austin");
  out = out.replace(/\bSpectral[\s-]+Soundworks\b/gi, "");
  out = out.replace(/\bhere in Austin\s+in Austin\b/gi, "here in Austin");

  // Clean redundant repeated locations or formatting glitches
  out = out.replace(/\bin Austin,?\s+in Austin\b/gi, "in Austin");
  out = out.replace(/\bhere in Austin,?\s+in Austin\b/gi, "here in Austin");
  out = out.replace(/[ \t]{2,}/g, " ");
  out = out.replace(/[ \t]+([.,!?])/g, "$1");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
};

const cleanEmail = (value) => {
  let text = value.trim();
  text = text.replace(/\[your name\]/gi, "Kasper Pickett");
  text = text.replace(/\[your studio\]/gi, "");
  text = text.replace(/\[your contact info(?:rmation)?\]/gi, "");
  text = text.replace(/\[contact info(?:rmation)?\]/gi, "");
  text = text.replace(/\[phone\]/gi, "");
  text = text.replace(/\[email\]/gi, "");
  text = sanitizeDraftText(text);

  // Strip Spectral Soundworks from body or signature
  text = text.replace(/\n\s*Spectral[\s-]+Soundworks\s*$/gi, "");
  text = text.replace(/\bSpectral[\s-]+Soundworks\b/gi, "");
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  if (!/kasper pickett/i.test(text)) {
    text = `${text}\n\nBest,\nKasper Pickett`;
  } else {
    text = text.replace(/kasper pickett\s*(?:\n\s*spectral soundworks)?/gi, "Kasper Pickett");
  }

  return text.trim();
};

const requireTitle = (out, title) =>
  Object.values(out).every((value) =>
    typeof value === "string" ? value.toLowerCase().includes(title.toLowerCase()) : true
  );

const callOpenAI = async (payload) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const response = await fetch(REACHOUT_CONFIG.apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI error ${response.status}: ${text}`);
  }
  return JSON.parse(text);
};

const generateReachoutDrafts = async (ctx) => {
  ctx = { ...ctx, releaseTitle: await verifiedTrackTitle(ctx.spotifyArtistId, ctx.releaseTitle) };
  const fields = ctx.hasEmail
    ? ["IG_A", "IG_B", "EMAIL_A", "EMAIL_B"]
    : ["IG_A", "IG_B"];

  let payload = buildPayload(ctx);
  let output = extractJson(await callOpenAI(payload));
  validateRequired(output, fields);

  const needsPortfolioOfferCorrection = ctx.portfolioOffer &&
    !fields.every((key) => hasExplicitPortfolioOffer(output[key]));
  const needsServiceCorrection = !fields.every((key) => mentionsServices(output[key]));

  if (needsPortfolioOfferCorrection || needsServiceCorrection) {
    payload = {
      ...payload,
      input: [
        ...payload.input,
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                ctx.portfolioOffer
                  ? "Correction: Every message must state the offer explicitly: the artist's first song will receive recording, mixing, and mastering for free / at no cost, with unlimited revisions within the agreed song scope. Put that direct offer in the first or second sentence. Do not use vague substitutes such as 'collab', 'portfolio collab', 'help with recording or mixing', or 'accepting artists'. Also introduce Kasper as an Austin engineer without saying 'I run a studio', 'tracking room', or 'in East Austin'. Return JSON only."
                  : "Correction: Make sure each message naturally introduces Kasper as an independent Austin audio engineer, or references mixing, mastering, or production in an organic, low-pressure way without saying 'I run a studio', 'tracking room', or 'in East Austin'. Do not mention any company or studio name. Return JSON only.",
            },
          ],
        },
      ],
    };
    output = extractJson(await callOpenAI(payload));
    validateRequired(output, fields);
  }

  if (ctx.portfolioOffer && !fields.every((key) => hasExplicitPortfolioOffer(output[key]))) {
    console.warn("Portfolio offer missing in some generated fields; continuing with available output");
  }

  // Sanitize all generated drafts to ensure banned phrases are completely eliminated
  for (const key of fields) {
    if (output[key]) {
      output[key] = sanitizeDraftText(output[key]);
    }
  }

  if (ctx.hasEmail) {
    output.EMAIL_A = cleanEmail(output.EMAIL_A || "");
    output.EMAIL_B = cleanEmail(output.EMAIL_B || "");
  }

  return output;
};

module.exports = {
  REACHOUT_CONFIG,
  detectGenreStyle,
  findUnsupportedGenreTerms,
  isAustinLocal,
  buildPayload,
  extractJson,
  mentionsServices,
  hasExplicitPortfolioOffer,
  validateRequired,
  cleanEmail,
  sanitizeDraftText,
  requireTitle,
  generateReachoutDrafts,
};
