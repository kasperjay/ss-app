const { ApifyClient } = require("apify-client");

const CONFIG = {
  apifyToken: process.env.APIFY_TOKEN,
  actorId: process.env.APIFY_IG_ACTOR_ID || "apify/instagram-profile-scraper",
  ingestUrl: process.env.INGEST_URL || "http://localhost:3000/api/ingest",
  resultsLimit: Number.parseInt(process.env.APIFY_IG_RESULTS_LIMIT || "6", 10),
};

const parseUsernames = () => {
  const argIndex = process.argv.indexOf("--usernames");
  const cliValue = argIndex !== -1 ? process.argv[argIndex + 1] : null;
  const envValue = process.env.IG_USERNAMES || process.env.IG_USERNAME;
  const raw = cliValue || envValue;
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.replace(/^@/, ""));
};

const toIsoDate = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  return null;
};

const getString = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const getPath = (value, path) => {
  let current = value;
  for (const key of path) {
    if (Array.isArray(current)) {
      current = current[key];
    } else if (current && typeof current === "object") {
      current = current[key];
    } else {
      return null;
    }
  }
  return current ?? null;
};

const mapPost = (item) => {
  const shortcode =
    getString(item.shortCode) || getString(item.shortcode) || getString(item.code);
  const instagramPostId =
    getString(item.id) || shortcode || getString(item.postId) || getString(item.pk);
  const caption =
    getString(item.caption) ||
    getString(item.text) ||
    getString(getPath(item, ["edge_media_to_caption", "edges", 0, "node", "text"]));
  const postedAt =
    toIsoDate(item.timestamp) ||
    toIsoDate(item.takenAtTimestamp) ||
    toIsoDate(item.takenAt) ||
    toIsoDate(item.date) ||
    toIsoDate(item.createdAt);
  const url =
    getString(item.url) ||
    getString(item.postUrl) ||
    (shortcode ? `https://www.instagram.com/p/${shortcode}/` : null);
  const imageUrl =
    getString(item.displayUrl) ||
    getString(item.display_url) ||
    getString(item.imageUrl) ||
    getString(item.thumbnailUrl) ||
    getString(item.thumbnail_url) ||
    getString(getPath(item, ["images", 0])) ||
    getString(getPath(item, ["carouselMedia", 0, "displayUrl"])) ||
    getString(getPath(item, ["carouselMedia", 0, "imageUrl"]));

  if (!instagramPostId && !caption && !imageUrl && !url) return null;

  return {
    instagramPostId,
    caption,
    imageUrl,
    postedAt,
    url,
  };
};

const { extractContactEmails: extractEmailsFromText, isContactEmail } = require("../src/lib/contact-email");

const fetchProfile = async (client, username) => {
  const run = await client.actor(CONFIG.actorId).call({
    usernames: [username],
    resultsLimit: 1,
    searchType: "user",
  });
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return items[0] || null;
};

const fetchPosts = async (client, username, limit) => {
  const run = await client.actor(CONFIG.actorId).call({
    usernames: [username],
    resultsLimit: limit,
    resultsType: "posts",
    searchType: "user",
    searchLimit: 1,
  });
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return items;
};

const buildPayload = (username, profile, posts) => {
  const fullName = getString(profile?.fullName) || username;
  const bio = getString(profile?.biography) || null;
  const officialSiteUrl =
    getString(profile?.externalUrl) ||
    getString(profile?.externalURL) ||
    getString(profile?.website) ||
    getString(profile?.websiteUrl) ||
    null;
  const directEmail =
    getString(profile?.businessEmail) || getString(profile?.email) || null;
  const emails = [
    ...extractEmailsFromText(bio),
    ...(directEmail ? [directEmail.toLowerCase()] : []),
  ].filter(isContactEmail);
  const followers =
    typeof profile?.followersCount === "number" ? profile.followersCount : null;
  const mappedPosts = posts.map(mapPost).filter(Boolean);
  const lastPostAt = mappedPosts[0]?.postedAt || null;

  return {
    artist: {
      name: fullName,
      instagramHandle: username,
      instagramProfileUrl: `https://www.instagram.com/${username}/`,
      officialSiteUrl,
      bio,
      emails,
      followerCount: followers,
      lastPostAt,
    },
    instagramPosts: mappedPosts,
  };
};

const ingestPayload = async (payload) => {
  const response = await fetch(CONFIG.ingestUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ingest failed (${response.status}): ${text}`);
  }
  return response.json();
};

const main = async () => {
  if (!CONFIG.apifyToken) {
    console.error("APIFY_TOKEN is required.");
    process.exit(1);
  }

  const usernames = parseUsernames();
  if (usernames.length === 0) {
    console.error("Provide IG usernames via --usernames or IG_USERNAMES env.");
    process.exit(1);
  }

  const client = new ApifyClient({ token: CONFIG.apifyToken });
  const limit = Number.isFinite(CONFIG.resultsLimit) ? CONFIG.resultsLimit : 6;

  for (const username of usernames) {
    try {
      console.log(`Fetching @${username}...`);
      const [profile, posts] = await Promise.all([
        fetchProfile(client, username),
        fetchPosts(client, username, limit),
      ]);

      const payload = buildPayload(username, profile, posts);
      const result = await ingestPayload(payload);
      console.log(`✓ Ingested @${username}`, result);
    } catch (error) {
      console.error(`Failed for @${username}`, error);
    }
  }
};

main().catch((error) => {
  console.error("Fatal error", error);
  process.exit(1);
});
