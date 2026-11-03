const TRACK_TITLE_RULE = "STRICT TRACK TITLE REQUIREMENT: Mention a specific song or track ONLY when its exact title is supplied as Spotify-verified music below. It must come directly from an actual release on this artist's Spotify profile. Never invent, infer, paraphrase, or use titles from posts, biography, personal hooks, memory, or other sources. If no verified title is supplied, specific track mentions are forbidden in every message and subject; discuss their music generally. An album title is not a track title. This rule overrides any request for specific musical detail. Do not claim to have listened or describe unheard audio.\n";

async function verifiedTrackTitle(artistId, title, fetcher = fetch) {
  if (!/^[a-zA-Z0-9]{22}$/.test(artistId || "") || !title) return null;
  const { SPOTIFY_CLIENT_ID: id, SPOTIFY_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) return null;
  try {
    const tokenResponse = await fetcher("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(id + ":" + secret).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(8000),
    });
    if (!tokenResponse.ok) return null;
    const token = (await tokenResponse.json()).access_token;
    if (!token) return null;
    const get = async (path) => {
      const response = await fetcher("https://api.spotify.com/v1/" + path, {
        headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error("Spotify verification unavailable");
      return response.json();
    };
    const releases = await get("artists/" + artistId + "/albums?include_groups=single,album&limit=10");
    for (const release of releases.items || []) {
      if (!/^[a-zA-Z0-9]{22}$/.test(release.id || "")) continue;
      const tracks = await get("albums/" + release.id + "/tracks?limit=50");
      const match = (tracks.items || []).find(track => track.name === title && track.artists?.some(artist => artist.id === artistId));
      if (match) return match.name;
    }
  } catch {
    return null;
  }
  return null;
}

module.exports = { TRACK_TITLE_RULE, verifiedTrackTitle };
