#!/usr/bin/env node
// scripts/generate-all-drafts.js
// Batch generate outreach drafts for leads using the revamped generation flow.
// Usage: node scripts/generate-all-drafts.js [--dry-run] [--lead <id>] [--limit <n>] [--status <status>] [--force] [--concurrency <n>]

const fs = require("fs");
const path = require("path");

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^['"](.*)['"]\s*$/, "$1");
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}

const { withAgentRun, prisma, pool } = require("../src/lib/agent-runner");
const { generateReachoutDrafts } = require("../src/lib/reachout-core");
const { getBestShowContext, formatPostWithTimestamp } = require("../src/lib/show-parser");

const hasFlag = (f) => process.argv.includes(f);
const getArg = (f) => {
  const i = process.argv.indexOf(f);
  if (i === -1) return null;
  const val = process.argv[i + 1];
  return val && !val.startsWith("--") ? val : null;
};

const DRY_RUN = hasFlag("--dry-run");
const FORCE = hasFlag("--force");
const TARGET_ID = getArg("--lead");
const STATUS_ARG = getArg("--status");
const LIMIT_ARG = getArg("--limit");
const CONCURRENCY_ARG = getArg("--concurrency");

const LIMIT =
  LIMIT_ARG && !isNaN(parseInt(LIMIT_ARG, 10)) && parseInt(LIMIT_ARG, 10) > 0
    ? parseInt(LIMIT_ARG, 10)
    : undefined;

const CONCURRENCY =
  CONCURRENCY_ARG && !isNaN(parseInt(CONCURRENCY_ARG, 10)) && parseInt(CONCURRENCY_ARG, 10) > 0
    ? parseInt(CONCURRENCY_ARG, 10)
    : 4;

const formatPrettyDate = (date) => {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  const formatter = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return formatter.format(d);
};

const formatLocation = (location, city, state, country) => {
  if (location) return location;
  const parts = [city, state, country].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
};

async function main() {
  console.log(`\n======================================================`);
  console.log(`🚀 Outreach Draft Generation Agent`);
  console.log(`Mode:        ${DRY_RUN ? "DRY RUN (no DB writes or API calls)" : "LIVE"}`);
  console.log(`Force:       ${FORCE ? "YES (overwriting existing reachout drafts)" : "NO"}`);
  console.log(`Concurrency: ${CONCURRENCY} worker(s)`);
  if (TARGET_ID) console.log(`Target:      Lead ID ${TARGET_ID}`);
  if (STATUS_ARG) console.log(`Status:      ${STATUS_ARG}`);
  if (LIMIT) console.log(`Limit:       ${LIMIT}`);
  console.log(`======================================================\n`);

  let statusFilter;
  if (STATUS_ARG) {
    if (STATUS_ARG.toLowerCase() === "all") {
      statusFilter = { notIn: ["LOST", "PAUSED"] };
    } else {
      const parts = STATUS_ARG.split(",").map((s) => s.trim().toUpperCase());
      statusFilter = { in: parts };
    }
  } else {
    // By default, target active leads that aren't closed/lost
    statusFilter = { in: ["NEW", "QUALIFIED", "CONTACTED", "FOLLOW_UP"] };
  }

  const where = TARGET_ID
    ? { id: TARGET_ID }
    : {
        status: statusFilter,
        ...(!FORCE ? { messages: { none: { source: "reachout" } } } : {}),
      };

  const leads = await prisma.lead.findMany({
    where,
    take: LIMIT,
    orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
    include: {
      artist: true,
      messages: {
        where: { source: "reachout" },
      },
      activities: {
        orderBy: { occurredAt: "desc" },
      },
    },
  });

  console.log(`📋 Found ${leads.length} eligible lead(s) for draft generation.\n`);

  if (leads.length === 0) {
    console.log("No leads match criteria. Run with --force to regenerate existing drafts, or adjust --status.");
    return { generatedCount: 0, totalEligible: 0 };
  }

  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;
  let totalDraftsCreated = 0;

  const now = new Date();
  let cursor = 0;

  async function worker(workerId) {
    while (cursor < leads.length) {
      const idx = cursor++;
      const lead = leads[idx];
      const artistName = lead.artist?.name || "Unknown";
      const leadNum = idx + 1;

      const hasSelectedDraft = lead.messages?.some((m) => m.selected);
      if (hasSelectedDraft && !FORCE) {
        console.log(`[W${workerId}] [${leadNum}/${leads.length}] ⏭️  ${artistName}: Has selected draft. Skipping.`);
        skippedCount++;
        continue;
      }

      try {
        const [latestRelease, instagramPosts] = await Promise.all([
          prisma.release.findFirst({
            where: { artistId: lead.artistId },
            orderBy: [{ releaseDate: "desc" }, { createdAt: "desc" }],
          }),
          prisma.instagramPost.findMany({
            where: { artistId: lead.artistId },
            orderBy: [{ postedAt: "desc" }, { createdAt: "desc" }],
            take: 4,
          }),
        ]);

        const releaseDate = latestRelease?.releaseDate ?? latestRelease?.createdAt ?? null;
        const daysSinceRelease = releaseDate
          ? Math.floor((now.getTime() - new Date(releaseDate).getTime()) / 86400000)
          : null;
        const isRecentRelease =
          daysSinceRelease !== null && daysSinceRelease >= -2 && daysSinceRelease <= 90;
        const releaseTiming = daysSinceRelease !== null
          ? (daysSinceRelease < 0
              ? `Upcoming release scheduled for ${formatPrettyDate(releaseDate)}`
              : `Released on ${formatPrettyDate(releaseDate)} (${daysSinceRelease === 0 ? "today" : `${daysSinceRelease} days ago`})`)
          : null;

        const recentPosts = (instagramPosts || [])
          .map((post) => formatPostWithTimestamp(post, now))
          .filter(Boolean)
          .join(" | ");

        const personalHook =
          lead.scoreRationale && lead.scoreRationale.length <= 160
            ? lead.scoreRationale
            : null;

        const { upcomingShow: rawUpcoming, recentPastShow: rawRecentPast } = getBestShowContext(lead.activities || [], now);

        const upcomingShow = rawUpcoming
          ? {
              title: rawUpcoming.title,
              venue: rawUpcoming.venue,
              datePretty: rawUpcoming.dateStr,
              daysUntil: rawUpcoming.daysDiff,
            }
          : null;

        const recentPastShow = rawRecentPast
          ? {
              title: rawRecentPast.title,
              venue: rawRecentPast.venue,
              datePretty: rawRecentPast.dateStr,
              daysAgo: Math.abs(rawRecentPast.daysDiff),
            }
          : null;

        const evidenceList = Array.isArray(lead.productionNeedEvidence)
          ? lead.productionNeedEvidence
          : typeof lead.productionNeedEvidence === "string"
            ? [lead.productionNeedEvidence]
            : [];

        const reachoutContext = {
          artist: lead.artist.name,
          genreText: lead.artist.genre,
          location: formatLocation(
            lead.artist.location,
            lead.artist.city,
            lead.artist.state,
            lead.artist.country
          ),
          spotifyArtistId: lead.artist?.spotifyArtistId,
          releaseTitle: latestRelease?.title ?? null,
          releaseDatePretty: formatPrettyDate(releaseDate),
          releaseTiming,
          isRecentRelease,
          personalHook,
          recentPosts,
          upcomingShow,
          recentPastShow,
          bio: lead.artist.bio,
          hasEmail: (lead.artist.emails?.length ?? 0) > 0,
          productionNeedLevel: lead.productionNeedLevel,
          productionNeedEvidence: evidenceList,
          portfolioOffer: true,
        };

        if (DRY_RUN) {
          console.log(`[W${workerId}] [${leadNum}/${leads.length}] 🎵 ${artistName} (Score: ${lead.score || 0}, Status: ${lead.status})`);
          console.log(`        Location: ${reachoutContext.location || "Unknown"} | Email: ${reachoutContext.hasEmail ? "YES" : "NO"}`);
          console.log(`        Release: ${reachoutContext.releaseTitle ? `${reachoutContext.releaseTitle} (${releaseTiming || "older"})` : "None"}`);
          console.log(`        Show: ${upcomingShow ? `${upcomingShow.title} at ${upcomingShow.venue} (${upcomingShow.datePretty})` : (recentPastShow ? `${recentPastShow.title} at ${recentPastShow.venue} (${recentPastShow.datePretty})` : "None")}`);
          console.log(`        Production Need: ${lead.productionNeedLevel || "NONE"} (${evidenceList.length} evidence lines)`);
          successCount++;
          continue;
        }

        const output = await generateReachoutDrafts(reachoutContext);

        // Delete old reachout drafts (when FORCE is true, delete all old reachout drafts for a fresh start)
        await prisma.messageDraft.deleteMany({
          where: {
            leadId: lead.id,
            source: "reachout",
            ...(FORCE ? {} : { selected: false }),
          },
        });

        const draftsToCreate = [
          { tone: "IG A", body: output.IG_A.trim(), source: "reachout", selected: false, leadId: lead.id },
          { tone: "IG B", body: output.IG_B.trim(), source: "reachout", selected: false, leadId: lead.id },
        ];

        if (output.EMAIL_A && output.EMAIL_B) {
          draftsToCreate.push(
            { tone: "Email A", body: output.EMAIL_A.trim(), source: "reachout", selected: false, leadId: lead.id },
            { tone: "Email B", body: output.EMAIL_B.trim(), source: "reachout", selected: false, leadId: lead.id }
          );
        }

        await prisma.messageDraft.createMany({
          data: draftsToCreate,
        });

        await prisma.activity.create({
          data: {
            leadId: lead.id,
            type: "NOTE",
            note: `Generated outreach drafts (revamped flow, ${draftsToCreate.length} variants).`,
          },
        });

        console.log(`[W${workerId}] [${leadNum}/${leads.length}] ✅ ${artistName} → ${draftsToCreate.length} drafts (IG A/B${output.EMAIL_A ? " + Email A/B" : ""})`);
        successCount++;
        totalDraftsCreated += draftsToCreate.length;
      } catch (err) {
        console.error(`[W${workerId}] [${leadNum}/${leads.length}] ❌ ${artistName}: ${err.message}`);
        failCount++;
      }
    }
  }

  const numWorkers = Math.min(CONCURRENCY, leads.length);
  await Promise.all(Array.from({ length: numWorkers }, (_, i) => worker(i + 1)));

  console.log(`\n======================================================`);
  console.log(`✨ Draft Generation Completed`);
  console.log(`Total Leads:       ${leads.length}`);
  console.log(`Successful:        ${successCount}`);
  console.log(`Failed:            ${failCount}`);
  console.log(`Skipped:           ${skippedCount}`);
  console.log(`Drafts Created:    ${totalDraftsCreated}`);
  console.log(`======================================================\n`);

  return {
    totalEligible: leads.length,
    successCount,
    failCount,
    skippedCount,
    totalDraftsCreated,
  };
}

withAgentRun("generate-drafts", { dryRun: DRY_RUN }, main)
  .catch((err) => console.error("Fatal Agent Error:", err))
  .finally(async () => {
    try {
      await prisma.$disconnect();
      await pool.end();
    } catch (_) {}
  });
