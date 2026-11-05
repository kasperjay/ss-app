export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { fetchInstagramEmbed, extractShortcode } from "@/lib/instagram-embed";
import { readPostImage, savePostImage, allowedImageUrl } from "@/lib/post-image-cache";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  let url = searchParams.get("url");
  let shortcode = searchParams.get("shortcode");
  const postId = searchParams.get("postId");

  if (!url && !shortcode && !postId) {
    return new NextResponse("Missing URL or shortcode", { status: 400 });
  }

  const cacheKey = postId ? `post:${postId}` : shortcode ? `shortcode:${shortcode}` : null;
  if (cacheKey) {
    const cached = await readPostImage(cacheKey);
    if (cached) return new NextResponse(new Uint8Array(cached), { headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=86400" } });
  }

  // If postId provided but shortcode missing, attempt to resolve from DB
  if (!shortcode && postId) {
    try {
      const dbPost = await prisma.instagramPost.findUnique({
        where: { id: postId },
        select: { id: true, instagramPostId: true, url: true, imageUrl: true },
      });
      if (dbPost) {
        shortcode = extractShortcode(dbPost);
        if (!url && dbPost.imageUrl) {
          url = dbPost.imageUrl;
        }
      }
    } catch {
      // Non-fatal fallback
    }
  }

  // If shortcode provided but no URL, resolve directly from embed
  if (!url && shortcode) {
    const embedData = await fetchInstagramEmbed(shortcode);
    if (embedData?.postImageUrl) {
      url = embedData.postImageUrl;
      if (postId) {
        prisma.instagramPost.update({
          where: { id: postId },
          data: { imageUrl: embedData.postImageUrl },
        }).catch(() => {});
      }
    } else {
      return new NextResponse("Image not found on Instagram", { status: 404 });
    }
  }

  if (!url) {
    return new NextResponse("Missing URL", { status: 400 });
  }

  // Only allow proxying images from trusted CDNs to prevent SSRF
  const isAllowed = allowedImageUrl(url);

  if (!isAllowed) {
    console.warn(`[Proxy] Rejected domain: ${url}`);
    return new NextResponse("Forbidden domain", { status: 403 });
  }

  try {
    let response = await fetchIG(url);

    // If initial fetch failed with 403 / 410 and we have a shortcode, self-heal via embed
    if (!response.ok) {
      if (!shortcode && postId) {
        try {
          const dbPost = await prisma.instagramPost.findUnique({
            where: { id: postId },
            select: { id: true, instagramPostId: true, url: true },
          });
          if (dbPost) shortcode = extractShortcode(dbPost);
        } catch {}
      }

      if (shortcode) {
        console.log(`[Proxy] Self-healing expired image via embed for shortcode: ${shortcode}`);
        const embedData = await fetchInstagramEmbed(shortcode);
        if (embedData?.postImageUrl) {
          const freshRes = await fetchIG(embedData.postImageUrl);
          if (freshRes.ok) {
            response = freshRes;
            // Update database asynchronously
            if (postId) {
              prisma.instagramPost.update({
                where: { id: postId },
                data: { imageUrl: embedData.postImageUrl },
              }).catch(() => {});
            }
          }
        }
      }
    }

    if (response.ok) {
      const contentType = response.headers.get("Content-Type") || "image/jpeg";
      const arrayBuffer = await response.arrayBuffer();

      if (cacheKey) {
        const saved = await savePostImage(cacheKey, arrayBuffer);
        return new NextResponse(new Uint8Array(saved), { headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=86400" } });
      }
      const headers = new Headers();
      headers.set("Content-Type", contentType);
      headers.set("Cache-Control", "public, max-age=604800, stale-while-revalidate=86400");

      return new NextResponse(arrayBuffer, { headers });
    }

    if (response.status === 403) {
      // Try without query params — sometimes the base CDN path still works
      const baseUrl = url.split("?")[0];
      if (baseUrl !== url) {
        const retryResponse = await fetchIG(baseUrl);
        if (retryResponse.ok) {
          const contentType = retryResponse.headers.get("Content-Type") || "image/jpeg";
          const arrayBuffer = await retryResponse.arrayBuffer();
          const headers = new Headers();
          headers.set("Content-Type", contentType);
          headers.set("Cache-Control", "public, max-age=86400");
          return new NextResponse(arrayBuffer, { headers });
        }
      }
      return new NextResponse("Image expired or unavailable", { status: 410 });
    }

    return new NextResponse(`Failed to fetch image: ${response.status}`, { status: response.status });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Proxy] Internal error: ${errorMessage}`);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

async function fetchIG(url: string) {
  if (!allowedImageUrl(url)) throw new Error("Forbidden image URL");
  const isInstagram = url.includes("instagram") || url.includes("cdninstagram") || url.includes("fbcdn.net");
  return fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Referer": isInstagram ? "https://www.instagram.com/" : "https://open.spotify.com/",
      ...(isInstagram
        ? {
            "Origin": "https://www.instagram.com",
            "Sec-Fetch-Dest": "image",
            "Sec-Fetch-Mode": "no-cors",
            "Sec-Fetch-Site": "cross-site",
            "Cache-Control": "max-age=0",
          }
        : {}),
    },
    next: { revalidate: 0 },
  });
}
