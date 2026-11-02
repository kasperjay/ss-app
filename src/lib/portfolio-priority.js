// @ts-check

const LOW_FOLLOWER_THRESHOLD = 5000;

/**
 * @param {unknown} followerCount
 * @returns {number | null}
 */
function normalizeFollowerCount(followerCount) {
  if (typeof followerCount === "number" && Number.isFinite(followerCount) && followerCount >= 0) {
    return followerCount;
  }
  return null;
}

/**
 * Returns true when an artist has a known non-negative follower count strictly under 5,000.
 * @param {{ followerCount?: number | null } | null | undefined} artist
 * @returns {boolean}
 */
function isLowFollowerArtist(artist) {
  const followers = normalizeFollowerCount(artist?.followerCount);
  return followers !== null && followers < LOW_FOLLOWER_THRESHOLD;
}

/**
 * Computes portfolio building priority score.
 * Artists with <5k followers receive a tier boost (+120) exceeding the 110-point ceiling
 * of non-follower signals so <5k artists strictly outrank >=5k and unknown-follower leads.
 *
 * @param {{
 *   score?: number | null;
 *   status?: string | null;
 *   artist?: {
 *     followerCount?: number | null;
 *     emails?: string[];
 *     instagramHandle?: string | null;
 *     officialSiteUrl?: string | null;
 *     location?: string | null;
 *     city?: string | null;
 *     state?: string | null;
 *     lastPostAt?: Date | string | null;
 *     releases?: Array<{ releaseDate?: Date | string | null; createdAt?: Date | string | null }>;
 *   } | null;
 * }} lead
 * @param {number} [nowMs]
 * @returns {number}
 */
function portfolioPriority(lead, nowMs = Date.now()) {
  const artist = lead?.artist ?? {};
  const followers = normalizeFollowerCount(artist.followerCount);

  const followerPoints =
    followers !== null && followers < LOW_FOLLOWER_THRESHOLD
      ? 120
      : followers === null
        ? 0
        : followers < 10000
          ? -5
          : -15;

  const hasContact = Boolean(
    artist.emails?.length || artist.instagramHandle || artist.officialSiteUrl
  );
  const latestRelease = artist.releases?.[0];
  const releaseDate = latestRelease?.releaseDate ?? latestRelease?.createdAt;
  const releaseTime = releaseDate ? new Date(releaseDate).getTime() : NaN;
  const releaseAgeDays = Number.isFinite(releaseTime)
    ? Math.max(0, (nowMs - releaseTime) / 86400000)
    : Infinity;

  const postTime = artist.lastPostAt ? new Date(artist.lastPostAt).getTime() : NaN;
  const isActiveArtist = Number.isFinite(postTime) && (nowMs - postTime) / 86400000 <= 90;

  const locationText = [artist.location, artist.city, artist.state].filter(Boolean).join(" ");
  const isLocal = /austin|atx|round rock|cedar park|pflugerville|georgetown|buda|kyle/i.test(locationText);
  const statusPoints =
    lead?.status === "NEW"
      ? 10
      : lead?.status === "QUALIFIED"
        ? 8
        : lead?.status === "FOLLOW_UP"
          ? 5
          : 0;

  return (
    followerPoints +
    (hasContact ? 30 : 0) +
    (releaseAgeDays <= 180 ? 20 : releaseAgeDays <= 365 ? 10 : 0) +
    (isActiveArtist ? 15 : 0) +
    (isLocal ? 10 : 0) +
    statusPoints +
    Math.min(25, Math.max(0, Number(lead?.score) || 0) * 0.25)
  );
}

/**
 * Comparator for Portfolio Building lead ordering:
 * 1. Confirmed <5k follower artists first
 * 2. Higher portfolioPriority score (reachability, recent activity, locality, status, Smart Score)
 * 3. Smaller follower count first (known before unknown)
 * 4. Higher Smart Score
 *
 * @param {Parameters<typeof portfolioPriority>[0]} a
 * @param {Parameters<typeof portfolioPriority>[0]} b
 * @param {number} [nowMs]
 * @returns {number}
 */
function comparePortfolioLeads(a, b, nowMs = Date.now()) {
  const aLow = isLowFollowerArtist(a?.artist);
  const bLow = isLowFollowerArtist(b?.artist);
  if (aLow !== bLow) return aLow ? -1 : 1;

  const priorityDiff = portfolioPriority(b, nowMs) - portfolioPriority(a, nowMs);
  if (priorityDiff !== 0) return priorityDiff;

  const aFollowers = normalizeFollowerCount(a?.artist?.followerCount) ?? Infinity;
  const bFollowers = normalizeFollowerCount(b?.artist?.followerCount) ?? Infinity;
  if (aFollowers !== bFollowers) return aFollowers - bFollowers;

  return (Number(b?.score) || 0) - (Number(a?.score) || 0);
}

module.exports = {
  LOW_FOLLOWER_THRESHOLD,
  normalizeFollowerCount,
  isLowFollowerArtist,
  portfolioPriority,
  comparePortfolioLeads,
};
