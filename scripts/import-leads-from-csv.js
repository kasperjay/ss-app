const fs = require("fs");
const path = require("path");

const parseCSV = (data) => {
  const rows = [];
  let currentRow = [];
  let currentVal = "";
  let inQuotes = false;
  for (let i = 0; i < data.length; i++) {
    const char = data[i];
    const nextChar = data[i + 1];
    if (char === "\"" && inQuotes && nextChar === "\"") {
      currentVal += "\"";
      i++;
    } else if (char === "\"") {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      currentRow.push(currentVal);
      currentVal = "";
    } else if ((char === "\r" || char === "\n") && !inQuotes) {
      if (currentVal !== "" || currentRow.length > 0) {
        currentRow.push(currentVal);
        rows.push(currentRow);
      }
      currentRow = [];
      currentVal = "";
      if (char === "\r" && nextChar === "\n") i++;
    } else {
      currentVal += char;
    }
  }
  if (currentVal !== "" || currentRow.length > 0) {
    currentRow.push(currentVal);
    rows.push(currentRow);
  }

  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i];
    });
    return obj;
  });
};

const getArg = (name) => {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
};

const toNumber = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value) return null;
  const cleaned = String(value).replace(/,/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isNaN(parsed) ? null : parsed;
};

const toDate = (value) => {
  if (!value) return null;
  const date = new Date(String(value).trim());
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const { extractContactEmails: extractEmails } = require("../src/lib/contact-email");

const splitGenres = (value) => {
  if (!value) return [];
  return String(value)
    .split(/[|,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const normalizeHandle = (value) => {
  if (!value) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed.replace(/^@/, "") : null;
};

const normalizeUrl = (value) => {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  try {
    if (!/^https?:\/\//i.test(trimmed)) {
      return new URL(`https://${trimmed}`).toString();
    }
    return new URL(trimmed).toString();
  } catch {
    return null;
  }
};

const extractSpotifyIds = (value) => {
  const url = normalizeUrl(value);
  if (!url) return { artistId: null, trackId: null, url: null };
  const match = url.match(/spotify\.com\/(artist|track)\/([A-Za-z0-9]+)/i);
  if (!match) return { artistId: null, trackId: null, url };
  return match[1] === "artist"
    ? { artistId: match[2], trackId: null, url }
    : { artistId: null, trackId: match[2], url };
};

const statusFromText = (value) => {
  if (!value) return null;
  const lower = String(value).toLowerCase();
  if (lower.includes("won")) return "WON";
  if (lower.includes("lost")) return "LOST";
  if (lower.includes("follow")) return "FOLLOW_UP";
  if (lower.includes("contact")) return "CONTACTED";
  if (lower.includes("qual") || lower.includes("ready")) return "QUALIFIED";
  if (lower.includes("new") || lower.includes("needs")) return "NEW";
  return null;
};

const parseLocation = (value) => {
  if (!value) return { location: null, city: null, state: null, country: null };
  const text = String(value).trim();
  if (!text) return { location: null, city: null, state: null, country: null };
  const parts = text.split(",").map((part) => part.trim());
  if (parts.length === 2) {
    return { location: text, city: parts[0], state: parts[1], country: null };
  }
  if (parts.length >= 3) {
    return {
      location: text,
      city: parts[0],
      state: parts[1],
      country: parts.slice(2).join(", "),
    };
  }
  return { location: text, city: null, state: null, country: null };
};

const buildPayload = (row) => {
  const artistName = row["Artist"]?.trim();
  if (!artistName) return null;

  const genres = splitGenres(row["Genre(s)"]);
  const instagramHandle = normalizeHandle(
    row["Instagram Username"] || row["Instagram"]
  );

  // Only normalize as URL if it looks like a domain/path, otherwise treat as handle
  const rawIg = row["Instagram"]?.trim();
  const instagramUrl = (rawIg && (rawIg.includes("/") || rawIg.includes(".")))
    ? normalizeUrl(rawIg)
    : null;

  const rawSpotify = row["Spotify"]?.trim();
  const spotifyUrl = (rawSpotify && (rawSpotify.includes("/") || rawSpotify.includes(".")))
    ? normalizeUrl(rawSpotify)
    : null;

  const spotifyIds = extractSpotifyIds(spotifyUrl);
  const { location, city, state, country } = parseLocation(row["Location"]);
  const emails = extractEmails(row["Email(s)"]);
  const leadStatus = statusFromText(row["DM/Email Status"] || row["Pipeline Stage"]);
  const lastPostDate = toDate(row["Last Post Date"]);
  const releaseDate = toDate(row["Last Release Date"]);

  const artist = {
    name: artistName,
    instagramHandle,
    instagramProfileUrl: instagramUrl || (instagramHandle
      ? `https://www.instagram.com/${instagramHandle}/`
      : undefined),
    spotifyArtistId: row["Spotify artistID"]?.trim() || spotifyIds.artistId || undefined,
    spotifyArtistUrl: spotifyUrl || (spotifyIds.artistId
      ? `https://open.spotify.com/artist/${spotifyIds.artistId}`
      : undefined),
    officialSiteUrl: normalizeUrl(row["Official Website"]),
    location,
    city,
    state,
    country,
    genre: genres[0] || undefined,
    tags: genres.length > 1 ? genres.slice(1) : undefined,
    bio: row["Bio"]?.trim() || undefined,
    emails: emails.length ? emails : undefined,
    followerCount: toNumber(row["IG Followers"]) ?? undefined,
    lastPostAt: lastPostDate ?? undefined,
  };

  const lead = {
    status: leadStatus || undefined,
    scoreRationale: row["Personal hook text"]?.trim() || undefined,
  };

  const releases = row["Latest Release Title"]
    ? [
      {
        title: row["Latest Release Title"].trim(),
        releaseDate: releaseDate ?? undefined,
        spotifyTrackId: spotifyIds.trackId || undefined,
      },
    ]
    : undefined;

  const instagramPosts = row["Last Post"]
    ? [
      {
        caption: row["Last Post"],
        postedAt: lastPostDate ?? undefined,
      },
    ]
    : undefined;

  const messageDrafts = [];
  if (row["IG Reachout A"]) messageDrafts.push({ tone: "Personalized (IG A)", body: row["IG Reachout A"], source: "csv_import" });
  if (row["IG Reachout B"]) messageDrafts.push({ tone: "Personalized (IG B)", body: row["IG Reachout B"], source: "csv_import" });
  if (row["Email Reachout A"]) messageDrafts.push({ tone: "Personalized (Email A)", body: row["Email Reachout A"], source: "csv_import" });
  if (row["Email Reachout B"]) messageDrafts.push({ tone: "Personalized (Email B)", body: row["Email Reachout B"], source: "csv_import" });

  if (row["Selected Msg"]) {
    messageDrafts.push({
      tone: "Selected Message",
      body: row["Selected Msg"],
      source: "csv_import",
      selected: true
    });
  }

  const activities = [];
  const event = row["Event"]?.trim();
  const venue = row["Venue"]?.trim();
  const eventDate = row["Date"]?.trim();
  const description = row["Description"]?.trim();
  const details = [event, venue, eventDate].filter(Boolean).join(" · ");
  if (details || description) {
    activities.push({
      type: "NOTE",
      note: [details, description].filter(Boolean).join(" | "),
    });
  }

  return {
    isDiscoveryImport: true,
    artist,
    lead,
    releases,
    instagramPosts,
    messageDrafts: messageDrafts.length ? messageDrafts : undefined,
    activities: activities.length ? activities : undefined,
  };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
  const csvPath = getArg("--csv") || process.env.CSV_PATH;
  if (!csvPath) {
    console.error("Provide CSV path via --csv or CSV_PATH env.");
    process.exit(1);
  }

  const ingestUrl = process.env.INGEST_URL || "http://localhost:3000/api/ingest";
  const dryRun = process.argv.includes("--dry-run");
  const skipIg =
    process.argv.includes("--skip-ig") || process.env.IMPORT_SKIP_IG === "true";
  const offset = Number.parseInt(getArg("--offset") || "0", 10) || 0;
  const limitArg = getArg("--limit");
  const limit = limitArg ? Number.parseInt(limitArg, 10) : null;
  const sleepMs = Number.parseInt(getArg("--sleep-ms") || "150", 10) || 0;

  const absolutePath = path.resolve(csvPath);
  const csvData = fs.readFileSync(absolutePath, "utf8");
  const rows = parseCSV(csvData);

  const slice = rows.slice(offset, limit ? offset + limit : undefined);
  console.log(`Loaded ${rows.length} rows. Processing ${slice.length}.`);

  for (let i = 0; i < slice.length; i += 1) {
    const row = slice[i];
    const payload = buildPayload(row);
    if (!payload) continue;

    if (skipIg) {
      payload.skipInstagramFetch = true;
    }

    if (dryRun) {
      console.log(JSON.stringify(payload, null, 2));
      continue;
    }

    const response = await fetch(ingestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("Ingest failed", response.status, text);
    } else {
      const json = await response.json().catch(() => null);
      console.log(`Ingested ${payload.artist.name}`, json ?? "ok");
    }

    if (sleepMs > 0) await sleep(sleepMs);
  }
};

main().catch((error) => {
  console.error("Import failed", error);
  process.exit(1);
});
