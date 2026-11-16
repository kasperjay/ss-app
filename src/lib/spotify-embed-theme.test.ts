import { describe, expect, it } from "vitest";
import { parseSpotifyEmbedColor, getSpotifyEmbedColor } from "./spotify-embed-theme";

describe("Spotify embed theme", () => {
  const html = (color: unknown) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity: { visualIdentity: { backgroundBase: color } } } } } } })}</script>`;
  it("uses Spotify's background channels in RGB order", () => {
    expect(parseSpotifyEmbedColor(html({ red: 56, green: 48, blue: 48 }))).toBe("#383030");
  });
  it("falls back for missing, malformed, or invalid metadata", () => {
    for (const value of ["", '<script id="__NEXT_DATA__">invalid</script>', html(null), html({ red: 256, green: 0, blue: 0 })]) {
      expect(parseSpotifyEmbedColor(value)).toBeNull();
    }
  });
  it("rejects non-Spotify fetch targets", async () => {
    expect(await getSpotifyEmbedColor("https://example.com/embed/artist/abc")).toBeNull();
    expect(await getSpotifyEmbedColor(null)).toBeNull();
  });
});
