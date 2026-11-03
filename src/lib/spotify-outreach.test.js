const { test } = require("node:test");
const assert = require("node:assert/strict");
const { verifiedTrackTitle } = require("./spotify-outreach");
test("Spotify titles require exact title and matching track artist; failures omit titles", async () => {
  process.env.SPOTIFY_CLIENT_ID = "test";
  process.env.SPOTIFY_CLIENT_SECRET = "test";
  const artist = "a".repeat(22);
  const album = "b".repeat(22);
  const mock = (trackArtist, name = "Actual Song") => async url => ({
    ok: true,
    json: async () => url.includes("api/token") ? { access_token: "test" }
      : url.includes("/artists/") ? { items: [{ id: album }] }
      : { items: [{ name, artists: [{ id: trackArtist }] }] },
  });
  assert.equal(await verifiedTrackTitle(artist, "Actual Song", mock(artist)), "Actual Song");
  assert.equal(await verifiedTrackTitle(artist, "Invented Song", mock(artist)), null);
  assert.equal(await verifiedTrackTitle(artist, "Actual Song", mock("other")), null);
  assert.equal(await verifiedTrackTitle(null, "Actual Song", mock(artist)), null);
  assert.equal(await verifiedTrackTitle(artist, "Actual Song", async () => { throw Error("offline"); }), null);
});
