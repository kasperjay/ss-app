/**
 * Instagram Embed Parser & Image Resolver
 *
 * Resolves fresh Instagram CDN image URLs and profile avatars
 * by requesting the official static public embed endpoint.
 * This completely bypasses Apify and third-party rate limits,
 * delivering valid Meta CDN signatures without requiring authentication.
 */

export function idToShortcode(idStr: string): string | null {
  try {
    let id = BigInt(idStr);
    const zero = BigInt(0);
    const sixtyFour = BigInt(64);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let shortcode = "";
    while (id > zero) {
      const remainder = Number(id % sixtyFour);
      id = id / sixtyFour;
      shortcode = alphabet[remainder] + shortcode;
    }
    return shortcode || null;
  } catch {
    return null;
  }
}

export function extractShortcode(post: {
  url?: string | null;
  instagramPostId?: string | null;
}): string | null {
  if (post.url) {
    const m = post.url.match(/\/(?:p|reel)\/([^\/\?]+)/);
    if (m && m[1]) return m[1];
  }
  if (post.instagramPostId) {
    if (/^[A-Za-z0-9_-]{10,12}$/.test(post.instagramPostId)) {
      return post.instagramPostId;
    }
    if (/^\d+$/.test(post.instagramPostId)) {
      return idToShortcode(post.instagramPostId);
    }
  }
  return null;
}

export interface InstagramEmbedData {
  postImageUrl: string | null;
  avatarUrl: string | null;
}

export async function fetchInstagramEmbed(shortcode: string): Promise<InstagramEmbedData | null> {
  if (!shortcode || typeof shortcode !== "string") return null;

  try {
    const res = await fetch(`https://www.instagram.com/p/${encodeURIComponent(shortcode)}/embed/`, {
      headers: {
        "User-Agent": "curl/8.5.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      next: { revalidate: 3600 },
    });

    if (!res.ok) return null;
    const html = await res.text();

    const regex = /https:\/\/[^"'\s<>\\]+(?:cdninstagram\.com|fbcdn\.net)\/v\/[^"'\s<>\\]+/g;
    const allImgs = (html.match(regex) || []).map((u) => u.replace(/&amp;/g, "&"));

    const avatarUrl =
      allImgs.find((u) => u.includes("-19/") || u.includes("profile_pic")) || null;
    const postImageUrl =
      allImgs.find((u) => (u.includes("-15/") || u.includes("EmbeddedMediaImage")) && !u.includes("-19/") && !u.includes("profile_pic")) ||
      allImgs.find((u) => !u.includes("-19/") && !u.includes("profile_pic")) ||
      null;

    return {
      postImageUrl,
      avatarUrl,
    };
  } catch (err) {
    console.warn(`[fetchInstagramEmbed] Failed for ${shortcode}:`, err);
    return null;
  }
}
