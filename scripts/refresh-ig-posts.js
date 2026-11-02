/**
 * Fast Instagram Posts & Avatar Refresher
 *
 * Refreshes Instagram post CDN image URLs and artist profile avatars
 * directly via Instagram's public embed endpoint (bypassing Apify).
 *
 * Usage:
 *   node scripts/refresh-ig-posts.js [--limit N] [--per-artist N] [--concurrency N] [--all]
 */

require("dotenv").config();
const { PrismaClient } = require("../prisma/generated-client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const CONFIG = {
  limit: (() => {
    const idx = process.argv.indexOf("--limit");
    return idx !== -1 ? parseInt(process.argv[idx + 1], 10) : Infinity;
  })(),
  perArtist: (() => {
    const idx = process.argv.indexOf("--per-artist");
    return idx !== -1 ? parseInt(process.argv[idx + 1], 10) : 6;
  })(),
  concurrency: (() => {
    const idx = process.argv.indexOf("--concurrency");
    return idx !== -1 ? parseInt(process.argv[idx + 1], 10) : 8;
  })(),
  allLeads: process.argv.includes("--all"),
};

function idToShortcode(idStr) {
  try {
    let id = BigInt(idStr);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let shortcode = "";
    while (id > 0n) {
      const remainder = Number(id % 64n);
      id = id / 64n;
      shortcode = alphabet[remainder] + shortcode;
    }
    return shortcode || null;
  } catch {
    return null;
  }
}

function extractShortcode(post) {
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

async function fetchEmbed(shortcode) {
  try {
    const res = await fetch(`https://www.instagram.com/p/${encodeURIComponent(shortcode)}/embed/`, {
      headers: {
        "User-Agent": "curl/8.5.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
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

    return { postImageUrl, avatarUrl };
  } catch {
    return null;
  }
}

async function pMap(items, fn, concurrency) {
  const results = [];
  let index = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log("=== Fast Instagram Post & Avatar Image Refresher ===");
  console.log(`Concurrency: ${CONFIG.concurrency} | Posts per artist: ${CONFIG.perArtist}`);

  // Fetch artists who have Instagram posts
  const whereClause = CONFIG.allLeads
    ? { instagramPosts: { some: {} } }
    : {
        leads: {
          some: {
            status: { in: ["NEW", "QUALIFIED", "CONTACTED", "FOLLOW_UP", "WON"] },
          },
        },
        instagramPosts: { some: {} },
      };

  let artists = await prisma.artist.findMany({
    where: whereClause,
    select: {
      id: true,
      name: true,
      instagramHandle: true,
      instagramProfileImageUrl: true,
      instagramPosts: {
        orderBy: [{ postedAt: "desc" }, { createdAt: "desc" }],
        take: CONFIG.perArtist,
        select: {
          id: true,
          instagramPostId: true,
          url: true,
          imageUrl: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  if (CONFIG.limit && Number.isFinite(CONFIG.limit)) {
    artists = artists.slice(0, CONFIG.limit);
  }

  const totalPostsToRefresh = artists.reduce((sum, a) => sum + a.instagramPosts.length, 0);
  console.log(`Found ${artists.length} artists with ${totalPostsToRefresh} target posts to refresh.\n`);

  const stats = {
    artistsProcessed: 0,
    postsRefreshed: 0,
    avatarsUpdated: 0,
    failures: 0,
  };

  const startTime = Date.now();

  await pMap(
    artists,
    async (artist, i) => {
      let artistAvatarUpdated = false;

      for (const post of artist.instagramPosts) {
        const shortcode = extractShortcode(post);
        if (!shortcode) {
          stats.failures++;
          continue;
        }

        const embedData = await fetchEmbed(shortcode);
        if (embedData?.postImageUrl) {
          await prisma.instagramPost.update({
            where: { id: post.id },
            data: { imageUrl: embedData.postImageUrl },
          });
          stats.postsRefreshed++;

          if (embedData.avatarUrl && !artistAvatarUpdated) {
            await prisma.artist.update({
              where: { id: artist.id },
              data: { instagramProfileImageUrl: embedData.avatarUrl },
            });
            artistAvatarUpdated = true;
            stats.avatarsUpdated++;
          }
        } else {
          stats.failures++;
        }

        // Polite delay
        await new Promise((r) => setTimeout(r, 150));
      }

      stats.artistsProcessed++;
      if ((i + 1) % 10 === 0 || i + 1 === artists.length) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(
          `[Progress] Artists: ${stats.artistsProcessed}/${artists.length} (${(
            (stats.artistsProcessed / artists.length) *
            100
          ).toFixed(0)}%) | Posts refreshed: ${stats.postsRefreshed} | Avatars: ${
            stats.avatarsUpdated
          } | Failures: ${stats.failures} | Elapsed: ${elapsed}s`
        );
      }
    },
    CONFIG.concurrency
  );

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n======================================================");
  console.log("✅ Instagram Post & Avatar Refresh Complete!");
  console.log(`- Total artists processed: ${stats.artistsProcessed}`);
  console.log(`- Post images refreshed:   ${stats.postsRefreshed}`);
  console.log(`- Avatars updated:         ${stats.avatarsUpdated}`);
  console.log(`- Unresolved/errors:       ${stats.failures}`);
  console.log(`- Total runtime:           ${totalElapsed}s`);
  console.log("======================================================");

  await prisma.$disconnect();
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
