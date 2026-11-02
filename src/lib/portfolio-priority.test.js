const test = require("node:test");
const assert = require("node:assert/strict");
const {
  LOW_FOLLOWER_THRESHOLD,
  normalizeFollowerCount,
  isLowFollowerArtist,
  portfolioPriority,
  comparePortfolioLeads,
} = require("./portfolio-priority");

const NOW = new Date("2026-10-31T00:00:00Z").getTime();

test("Portfolio Priority: isLowFollowerArtist strictly enforces <5k non-negative threshold", () => {
  assert.equal(LOW_FOLLOWER_THRESHOLD, 5000);
  assert.equal(isLowFollowerArtist({ followerCount: 0 }), true);
  assert.equal(isLowFollowerArtist({ followerCount: 850 }), true);
  assert.equal(isLowFollowerArtist({ followerCount: 4999 }), true);
  assert.equal(isLowFollowerArtist({ followerCount: 5000 }), false);
  assert.equal(isLowFollowerArtist({ followerCount: 12000 }), false);
  assert.equal(isLowFollowerArtist({ followerCount: null }), false);
  assert.equal(isLowFollowerArtist({ followerCount: undefined }), false);
  assert.equal(isLowFollowerArtist({ followerCount: -50 }), false);
  assert.equal(normalizeFollowerCount(NaN), null);
});

test("Portfolio Priority: <5k follower artist outranks maximally-scored >=5k artist", () => {
  const emergingArtist = {
    score: 20,
    status: "CONTACTED",
    artist: {
      followerCount: 4999,
      emails: [],
      instagramHandle: null,
      officialSiteUrl: null,
      location: "Denver, CO",
      lastPostAt: null,
      releases: [],
    },
  };

  const establishedMaxSignalsArtist = {
    score: 100,
    status: "NEW",
    artist: {
      followerCount: 5000,
      emails: ["mgmt@bigband.com"],
      instagramHandle: "bigband",
      officialSiteUrl: "https://bigband.com",
      city: "Austin",
      state: "TX",
      lastPostAt: "2026-10-28T00:00:00Z",
      releases: [{ releaseDate: "2026-10-15T00:00:00Z", createdAt: "2026-10-15T00:00:00Z" }],
    },
  };

  assert.ok(portfolioPriority(emergingArtist, NOW) > portfolioPriority(establishedMaxSignalsArtist, NOW));
  assert.ok(comparePortfolioLeads(emergingArtist, establishedMaxSignalsArtist, NOW) < 0);
});

test("Portfolio Priority: sorts <5k leads first, then reachability/fit within <5k, then non-<5k", () => {
  const leads = [
    {
      id: "large-austin",
      score: 95,
      status: "NEW",
      artist: {
        followerCount: 18000,
        emails: ["book@large.com"],
        city: "Austin",
        lastPostAt: "2026-10-25T00:00:00Z",
        releases: [{ releaseDate: "2026-10-01T00:00:00Z" }],
      },
    },
    {
      id: "unknown-austin",
      score: 80,
      status: "NEW",
      artist: {
        followerCount: null,
        emails: ["hi@unknown.com"],
        city: "Austin",
        lastPostAt: "2026-10-25T00:00:00Z",
        releases: [{ releaseDate: "2026-10-01T00:00:00Z" }],
      },
    },
    {
      id: "under5k-inactive",
      score: 45,
      status: "QUALIFIED",
      artist: {
        followerCount: 600,
        instagramHandle: "indie600",
        city: "Dallas",
        lastPostAt: null,
        releases: [],
      },
    },
    {
      id: "under5k-prime",
      score: 78,
      status: "NEW",
      artist: {
        followerCount: 1400,
        emails: ["band@atx.com"],
        city: "Austin",
        lastPostAt: "2026-10-20T00:00:00Z",
        releases: [{ releaseDate: "2026-09-15T00:00:00Z" }],
      },
    },
  ];

  const sortedIds = [...leads]
    .sort((a, b) => comparePortfolioLeads(a, b, NOW))
    .map((lead) => lead.id);

  assert.deepEqual(sortedIds, [
    "under5k-prime",
    "under5k-inactive",
    "unknown-austin",
    "large-austin",
  ]);
});

test("Portfolio Priority: breaks ties within <5k band by smaller followerCount first", () => {
  const smaller = {
    score: 60,
    status: "NEW",
    artist: { followerCount: 420, instagramHandle: "smallband", city: "Austin" },
  };
  const larger = {
    score: 60,
    status: "NEW",
    artist: { followerCount: 3800, instagramHandle: "midband", city: "Austin" },
  };

  assert.ok(comparePortfolioLeads(smaller, larger, NOW) < 0);
});
