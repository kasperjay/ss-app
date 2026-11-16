export function parseSpotifyEmbedColor(html: string): string | null {
  try {
    const json = html.match(/<script\b[^>]*\bid="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
    if (!json) return null;
    const color = JSON.parse(json)?.props?.pageProps?.state?.data?.entity?.visualIdentity?.backgroundBase;
    const channels = [color?.red, color?.green, color?.blue];
    if (!channels.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) return null;
    return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return null;
  }
}

export async function getSpotifyEmbedColor(embedUrl: string | null): Promise<string | null> {
  if (!embedUrl || !/^https:\/\/open\.spotify\.com\/embed\/(artist|album|track)\/[a-zA-Z0-9]+$/.test(embedUrl)) return null;
  try {
    const response = await fetch(embedUrl, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(3000),
    });
    return response.ok ? parseSpotifyEmbedColor(await response.text()) : null;
  } catch {
    return null;
  }
}
