const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPayload, isAustinLocal, detectGenreStyle, findUnsupportedGenreTerms, hasExplicitPortfolioOffer } = require("./reachout-core");

test("Reachout: Austin local detection", () => {
  assert.equal(isAustinLocal("Austin, TX"), true);
  assert.equal(isAustinLocal("Round Rock, TX"), true);
  assert.equal(isAustinLocal("San Antonio, TX"), false);
  assert.equal(isAustinLocal("Houston, TX"), false);
  assert.equal(isAustinLocal("Denton, TX"), false);
  assert.equal(isAustinLocal("Los Angeles, CA"), false);
  assert.equal(isAustinLocal(null), false);
  assert.equal(isAustinLocal(undefined), false);
});

test("Reachout: genre metadata is factual and rejects unsupported subgenres", () => {
  const payload = buildPayload({
    artist: "Almost Heaven",
    genreText: "post-punk indie dance/pop",
    location: "Austin, TX",
    hasEmail: true,
    isRecentRelease: false,
  });

  const userText = payload.input[1].content[0].text;
  assert.ok(userText.includes("Artist Genre: post-punk indie dance/pop"));
  assert.ok(userText.includes("Do not invent, substitute, or upgrade it into another genre or subgenre"));
  assert.deepEqual(findUnsupportedGenreTerms("an epic doom metal essence", "post-punk indie dance/pop"), ["metal", "doom metal", "doom"]);
  assert.deepEqual(findUnsupportedGenreTerms("the post-punk indie dance/pop edge", "post-punk indie dance/pop"), []);
  assert.deepEqual(findUnsupportedGenreTerms("an epic doom metal essence", null), ["metal", "doom metal", "doom"]);
});

test("Reachout: Temporal Accuracy rules are present in system prompt", () => {
  const payload = buildPayload({
    artist: "Test Band",
    genreText: "metal",
    location: "San Antonio, TX",
    isRecentRelease: false,
    hasEmail: false,
    currentDate: "Saturday, October 24, 2026",
  });

  const systemText = payload.input[0].content[0].text;
  assert.ok(systemText.includes("TEMPORAL ACCURACY RULES (CRITICAL & MANDATORY)"));
  assert.ok(systemText.includes("Today's date is Saturday, October 24, 2026"));
  assert.ok(systemText.includes("NEVER refer to any event, show, tour date, or social post that occurred before today as 'upcoming'"));
  assert.ok(systemText.includes("If a show or event date occurred before today, it is in the PAST"));
});

test("Reachout: Kasper is introduced as an audio engineer only", () => {
  const payload = buildPayload({
    artist: "Test Band",
    genreText: "indie rock",
    location: "Austin, TX",
    isRecentRelease: false,
    hasEmail: true,
  });

  const systemText = payload.input[0].content[0].text;
  assert.ok(systemText.includes("Introduce Kasper simply as an independent Austin audio engineer."));
  assert.ok(!systemText.includes("audio engineer and mixer"));
  assert.ok(!systemText.includes("audio engineer/mixer"));
});

test("Reachout: Out-of-town artist with upcoming future show suggests studio while in town", () => {
  const payload = buildPayload({
    artist: "Chironex",
    genreText: "death metal",
    location: "Houston, TX",
    isRecentRelease: false,
    hasEmail: false,
    currentDate: "Saturday, October 24, 2026",
    upcomingShow: {
      title: "Chironex",
      venue: "Come and Take It Live",
      datePretty: "Nov 6, 2026",
      daysUntil: 13,
    },
  });

  const userText = payload.input[1].content[0].text;
  assert.ok(userText.includes("Upcoming Show: Chironex at Come and Take It Live on Nov 6, 2026 (in 13 days)"));
  assert.ok(userText.includes("suggest stopping by the studio while they are in town"));
});

test("Reachout: Austin local artist with upcoming future show does NOT say 'while you are in town'", () => {
  const payload = buildPayload({
    artist: "Local Austin Band",
    genreText: "indie rock",
    location: "Austin, TX",
    isRecentRelease: false,
    hasEmail: false,
    currentDate: "Saturday, October 24, 2026",
    upcomingShow: {
      title: "Local Austin Band",
      venue: "Valhalla Tavern",
      datePretty: "Nov 5, 2026",
      daysUntil: 12,
    },
  });

  const userText = payload.input[1].content[0].text;
  assert.ok(userText.includes("Upcoming Show: Local Austin Band at Valhalla Tavern on Nov 5, 2026 (in 12 days)"));
  assert.ok(userText.includes("Artist is Austin-local"));
  assert.ok(userText.includes("NEVER say \"while you're in town\" or suggest they are visiting Austin"));
});

test("Reachout: Recent past show (already happened within 30 days) is framed strictly in past tense", () => {
  const payload = buildPayload({
    artist: "Recent Show Band",
    genreText: "rock",
    location: "San Antonio, TX",
    isRecentRelease: false,
    hasEmail: false,
    currentDate: "Saturday, October 24, 2026",
    recentPastShow: {
      title: "Recent Gig",
      venue: "Continental Club",
      datePretty: "Oct 15, 2026",
      daysAgo: 9,
    },
  });

  const userText = payload.input[1].content[0].text;
  assert.ok(userText.includes("Upcoming Show: None"));
  assert.ok(userText.includes("Recent Past Show (Already happened): Recent Gig at Continental Club on Oct 15, 2026 (9 days ago)"));
  assert.ok(userText.includes("CRITICAL: This show ALREADY happened in the past"));
  assert.ok(userText.includes("NEVER refer to it as upcoming or suggest they are in town for it"));
});

test("Reachout: Legacy showInfo from months ago (May 2026) is NOT treated as an upcoming show", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-24T12:00:00Z") });
  const payload = buildPayload({
    artist: "HORRIFIC VISIONS",
    genreText: "death metal",
    location: "San Antonio, TX",
    isRecentRelease: false,
    hasEmail: false,
    currentDate: "Saturday, October 24, 2026",
    // Old show from 5 months ago
    showInfo: "DEFEATED SANITY · Come and Take It Live · Tue, May 12, 2026",
  });

  const userText = payload.input[1].content[0].text;
  // Must NOT treat May 12, 2026 as upcoming show!
  assert.ok(userText.includes("Upcoming Show: None"));
  assert.ok(!userText.includes("Upcoming Show in Austin: DEFEATED SANITY"));
  assert.ok(!userText.includes("The artist has an upcoming Austin show"));
  assert.ok(userText.includes("Do NOT mention an upcoming Austin show or suggest the artist is traveling to Austin"));
});

test("Reachout: Legacy showInfo with future date is correctly promoted to upcoming show", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-24T12:00:00Z") });
  const payload = buildPayload({
    artist: "Future Tour Band",
    genreText: "metal",
    location: "Dallas, TX",
    isRecentRelease: false,
    hasEmail: false,
    currentDate: "Saturday, October 24, 2026",
    showInfo: "MUSHROOMHEAD · Come and Take It Live · Fri, Nov 06, 2026 · https://do512.com/...",
  });

  const userText = payload.input[1].content[0].text;
  assert.ok(userText.includes("Upcoming Show: MUSHROOMHEAD at Come and Take It Live on Fri, Nov 06, 2026"));
  assert.ok(userText.includes("suggest stopping by the studio while they are in town"));
});

test("Reachout: Post timestamps and release timing are clearly labeled", () => {
  const payload = buildPayload({
    artist: "Producer Artist",
    genreText: "hip hop",
    location: "Austin, TX",
    releaseTitle: "Midnight Vibes",
    releaseTiming: "Released on Sep 10, 2026 (44 days ago)",
    isRecentRelease: true,
    recentPosts: "[Posted 3 days ago on Oct 21, 2026]: Studio session was crazy | [Posted 6 months ago on Apr 10, 2026]: Playing Antone's tonight!",
    hasEmail: true,
    currentDate: "Saturday, October 24, 2026",
  });

  const userText = payload.input[1].content[0].text;
  assert.ok(userText.includes("Midnight Vibes (Released on Sep 10, 2026 (44 days ago))"));
  assert.ok(userText.includes("[Posted 3 days ago on Oct 21, 2026]: Studio session was crazy"));
  assert.ok(userText.includes("[Posted 6 months ago on Apr 10, 2026]: Playing Antone's tonight!"));
  assert.ok(userText.includes("Respect the post timestamps!"));
});

test("Reachout: Production Need signals are integrated into user prompt", () => {
  const payload = buildPayload({
    artist: "Indie Rockers",
    genreText: "indie rock",
    location: "Austin, TX",
    isRecentRelease: false,
    hasEmail: true,
    currentDate: "Saturday, October 24, 2026",
    productionNeedLevel: "POSSIBLE",
    productionNeedEvidence: ["Caption: 'anyone know a good mixing engineer in ATX?'", "Release within 180 days"],
  });

  const userText = payload.input[1].content[0].text;
  assert.ok(userText.includes("Detected Production Need: POSSIBLE"));
  assert.ok(userText.includes("anyone know a good mixing engineer in ATX?"));
  assert.ok(userText.includes("Address the detected production need as a natural reason to connect"));
});

test("Reachout: Portfolio mode makes the any-genre free first-song offer explicit", () => {
  const payload = buildPayload({
    artist: "Any Genre Artist",
    genreText: "experimental pop",
    location: "Austin, TX",
    isRecentRelease: false,
    hasEmail: true,
    portfolioOffer: true,
  });

  const systemText = payload.input[0].content[0].text;
  const userText = payload.input[1].content[0].text;
  assert.ok(systemText.includes("accepting artists of any genre"));
  assert.ok(systemText.includes("recording, mixing, and mastering the artist's first song at no cost"));
  assert.ok(systemText.includes("primary hook, not a vague aside"));
  assert.ok(systemText.includes("Do not replace the offer with 'collab'"));
  assert.ok(systemText.includes("first or second sentence"));
  assert.ok(systemText.includes("Do not imply a limited number of spots"));
  assert.ok(userText.includes("PORTFOLIO COLLABORATION OFFER (MANDATORY)"));
});

test("Reachout: explicit portfolio offer validator rejects vague collaboration language", () => {
  assert.equal(
    hasExplicitPortfolioOffer(
      "I can record, mix, and master your first song for free with unlimited revisions."
    ),
    true
  );
  assert.equal(
    hasExplicitPortfolioOffer("I'd love to help with recording or mixing as part of a portfolio collab."),
    false
  );
});

test("Reachout: explicit portfolio offer accepts natural past-participle wording", () => {
  assert.equal(
    hasExplicitPortfolioOffer(
      "I can record, mix, and master your first song for free, with unlimited revisions."
    ),
    true
  );
  assert.equal(
    hasExplicitPortfolioOffer(
      "Your first song can be recorded, mixed, and mastered at no cost with unlimited revisions."
    ),
    true
  );
});

test("Reachout: Channel formatting rules for IG vs Email in system prompt", () => {
  const payload = buildPayload({
    artist: "Austin Artist",
    genreText: "metal",
    location: "Austin, TX",
    isRecentRelease: false,
    hasEmail: true,
    currentDate: "Saturday, October 24, 2026",
  });

  const systemText = payload.input[0].content[0].text;
  assert.ok(systemText.includes("INSTAGRAM DMS (IG_A, IG_B)"));
  assert.ok(systemText.includes("2 to 4 sentences"));
  assert.ok(systemText.includes("EMAILS (EMAIL_A, EMAIL_B)"));
  assert.ok(systemText.includes("Line 1: Must begin with 'Subject: [Short, natural subject line]'"));
  assert.ok(systemText.includes("Kasper Pickett"));
  assert.ok(!systemText.includes("producer at Spectral Soundworks"));
  assert.ok(systemText.includes("Do NOT mention 'Spectral Soundworks'"));
  assert.ok(!systemText.includes("with Spectral Soundworks"));
  assert.ok(!systemText.includes("Spectral Soundworks\\n"));
});

test("Reachout: cleanEmail handles Subject, sanitizes banned phrases, and appends Kasper Pickett without Spectral Soundworks", () => {
  const { cleanEmail } = require("./reachout-core");
  const rawEmail = `Subject: Question on guitar tones\n\nHey Alex,\n\nLoved your recent track. I run a tracking room in East Austin.\n\nLet me know if you want to connect!`;
  const cleaned = cleanEmail(rawEmail);

  assert.ok(cleaned.startsWith("Subject: Question on guitar tones"));
  assert.ok(cleaned.includes("Kasper Pickett"));
  assert.ok(!cleaned.includes("Spectral Soundworks"));
  assert.ok(!cleaned.toLowerCase().includes("tracking room"));
  assert.ok(!cleaned.toLowerCase().includes("east austin"));
});

test("Reachout: sanitizer removes spaced or hyphenated brand variants", () => {
  const { sanitizeDraftText } = require("./reachout-core");
  const cleaned = sanitizeDraftText("Hey Alex — Kasper at Spectral  Soundworks / spectral-soundworks.");
  assert.ok(!/spectral[\\s-]+soundworks/i.test(cleaned));
});

test("Reachout: eliminates 'i run a studio/mixing and tracking room' and 'in east Austin'", () => {
  const { sanitizeDraftText, buildPayload } = require("./reachout-core");

  // 1. Verify prompt bans East Austin, running a studio, and tracking room, and does not frame Kasper that way
  const payload = buildPayload({
    artist: "Test Band",
    genreText: "indie",
    location: "Austin, TX",
    isRecentRelease: false,
    hasEmail: true,
  });
  const systemText = payload.input[0].content[0].text;
  assert.ok(!systemText.includes("studio in East Austin"));
  assert.ok(!systemText.includes("East Austin tracking"));
  assert.ok(!systemText.includes("running a tracking/mix room"));
  assert.ok(systemText.includes("Banned phrases and vibes (do not use):"));
  assert.ok(systemText.includes("- i run a studio"));
  assert.ok(systemText.includes("- in east Austin"));
  assert.ok(systemText.includes("Do NOT use the phrases 'I run a studio'"));

  // 2. Verify sanitizer cleanly eliminates banned phrases from text
  const raw1 = "Hey Alex, I run a studio/mixing and tracking room in east Austin. Loved your new single.";
  const cleaned1 = sanitizeDraftText(raw1);
  assert.ok(!cleaned1.toLowerCase().includes("run a studio"));
  assert.ok(!cleaned1.toLowerCase().includes("tracking room"));
  assert.ok(!cleaned1.toLowerCase().includes("east austin"));
  assert.ok(cleaned1.includes("in Austin"));

  const raw2 = "I run a tracking room in East Austin.";
  const cleaned2 = sanitizeDraftText(raw2);
  assert.ok(!cleaned2.toLowerCase().includes("tracking room"));
  assert.ok(!cleaned2.toLowerCase().includes("east austin"));
  assert.ok(cleaned2.includes("in Austin"));

  const raw3 = "We have a mixing and tracking room in East Austin.";
  const cleaned3 = sanitizeDraftText(raw3);
  assert.ok(!cleaned3.toLowerCase().includes("mixing and tracking room"));
  assert.ok(!cleaned3.toLowerCase().includes("east austin"));
});

test("Reachout: mentionsServices recognizes natural engineering, studio, and mix terms", () => {
  const { mentionsServices } = require("./reachout-core");
  assert.equal(mentionsServices("I run a tracking room in East Austin"), true);
  assert.equal(mentionsServices("Hit me up if you want a fresh set of ears on your mixes"), true);
  assert.equal(mentionsServices("Let me know if you need studio time while in Austin"), true);
  assert.equal(mentionsServices("Spectral Soundworks here in Austin"), true);
  assert.equal(mentionsServices("Hey what a cool dog you have there"), false);
});
