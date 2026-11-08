#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("../prisma/generated-client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

// Load .env
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
    }
  }
}

const { withAgentRun, prisma, pool } = require("../src/lib/agent-runner");

// ── Email utilities ───────────────────────────────────────────────────────────


const LINK_HUB_HOSTS = new Set([
  "linktr.ee", "linkin.bio", "beacons.ai", "lnk.to", "solo.to",
  "carrd.co", "bio.link", "fanlink.to", "hyperfollow.com",
]);

const SOCIAL_HOSTS = new Set([
  "instagram.com", "www.instagram.com", "facebook.com", "m.facebook.com",
  "www.facebook.com", "tiktok.com", "www.tiktok.com", "youtube.com",
  "www.youtube.com", "twitter.com", "x.com", "soundcloud.com",
  "open.spotify.com", "spotify.com", "music.apple.com",
]);

const normalizeUrl = (value) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    if (!/^https?:\/\//i.test(trimmed)) return new URL(`https://${trimmed}`).toString();
    return new URL(trimmed).toString();
  } catch { return null; }
};

const { extractContactEmailsFromHtml } = require("../src/lib/contact-email");

const extractLinks = (html, baseUrl) => {
  const links = new Set();
  const hrefRegex = /href=["']([^"']+)["']/gi;
  let match;
  while ((match = hrefRegex.exec(html))) {
    const raw = match[1];
    if (!raw || raw.startsWith("#") || raw.startsWith("mailto:")) continue;
    try { links.add(new URL(raw, baseUrl).toString()); } catch {}
  }
  return Array.from(links);
};

const isSocialHost = (url) => {
  try { return SOCIAL_HOSTS.has(new URL(url).hostname.toLowerCase()); } catch { return true; }
};

const isLinkHubHost = (url) => {
  try { return LINK_HUB_HOSTS.has(new URL(url).hostname.toLowerCase()); } catch { return false; }
};

const sameHost = (a, b) => {
  try { return new URL(a).hostname.toLowerCase() === new URL(b).hostname.toLowerCase(); } catch { return false; }
};

const fetchHtml = async (url, timeoutMs = 6000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "spectral-soundworks-bot/1.0" },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch { return null; }
  finally { clearTimeout(timeout); }
};

const pickContactLinks = (links, baseUrl) => {
  const keywords = ["contact", "booking", "press", "management", "inquiries", "inquiry", "connect", "about"];
  return links.filter((link) => {
    if (!sameHost(link, baseUrl)) return false;
    const p = new URL(link).pathname.toLowerCase();
    return keywords.some((kw) => p.includes(kw));
  });
};

const pickExternalLinks = (links) => links.filter((l) => !isSocialHost(l) && !isLinkHubHost(l));

const discoverEmailsFromUrls = async (urls) => {
  const normalized = urls.map(normalizeUrl).filter(Boolean);
  const emails = new Set();
  const visited = new Set();
  const queue = [...normalized];
  const maxPages = parseInt(process.env.EMAIL_SCRAPE_MAX_PAGES || "5", 10) || 5;

  while (queue.length && visited.size < maxPages) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    visited.add(url);

    const html = await fetchHtml(url);
    if (!html) continue;

    for (const email of extractContactEmailsFromHtml(html)) emails.add(email);
    if (emails.size > 0) continue;

    const links = extractLinks(html, url);
    if (isLinkHubHost(url)) { queue.push(...pickExternalLinks(links).slice(0, 3)); continue; }
    queue.push(...pickContactLinks(links, url).slice(0, 3));
  }

  return Array.from(emails);
};

// ── Contact confidence scoring ────────────────────────────────────────────────

function scoreContactConfidence(email, discoveryMethod) {
  let score = 0;
  let confidence = "uncertain";

  if (discoveryMethod === "official-website") { score = 90; confidence = "verified"; }
  else if (discoveryMethod === "verified-db") { score = 85; confidence = "verified"; }
  else if (discoveryMethod === "band-website") { score = 75; confidence = "verified"; }
  else if (discoveryMethod === "contact-page") { score = 70; confidence = "inferred"; }
  else if (discoveryMethod === "social-profile") { score = 60; confidence = "inferred"; }
  else if (discoveryMethod === "pattern-match") { score = 40; confidence = "uncertain"; }

  const local = email.split("@")[0].toLowerCase();
  if (["booking", "contact", "info", "hello"].some((kw) => local.includes(kw))) {
    score = Math.min(score + 10, 95);
  } else if (["noreply", "no-reply", "bounce"].some((kw) => local.includes(kw))) {
    score = Math.max(score - 30, 20);
  }

  return { score, confidence };
}

// ── Per-lead discovery ────────────────────────────────────────────────────────

async function discoverContactsForLead(lead, dryRun = false) {
  const result = {
    leadId: lead.id,
    artistName: lead.artist.name,
    emailsFound: [],
    confidence: "uncertain",
    activityLogged: false,
  };

  const urlsToCheck = [
    lead.artist.officialSiteUrl,
    lead.artist.instagramHandle && `https://instagram.com/${lead.artist.instagramHandle}`,
  ].filter(Boolean);

  if (urlsToCheck.length === 0) return result;

  try {
    const rawEmails = await discoverEmailsFromUrls(urlsToCheck);
    if (rawEmails.length === 0) return result;

    const sourceType = lead.artist.officialSiteUrl ? "band-website" : "social-profile";
    const sourceUrl = lead.artist.officialSiteUrl || `https://instagram.com/${lead.artist.instagramHandle}`;

    const scored = rawEmails
      .map((email) => {
        const { score, confidence } = scoreContactConfidence(email, sourceType);
        return { email, score, confidence, sourceUrl, sourceType };
      })
      .sort((a, b) => b.score - a.score);

    result.emailsFound = scored;
    result.confidence = scored[0]?.confidence || "uncertain";

    if (!dryRun) {
      const existingEmails = lead.artist.emails || [];
      const newItems = scored.filter((e) => !existingEmails.includes(e.email));

      for (const item of newItems) {
        await prisma.contactInfo.upsert({
          where: { artistId_email: { artistId: lead.artist.id, email: item.email } },
          create: {
            artistId: lead.artist.id,
            email: item.email,
            confidence: item.confidence,
            score: item.score,
            sourceUrl: item.sourceUrl || null,
            sourceType: item.sourceType || null,
          },
          update: {
            confidence: item.confidence,
            score: item.score,
            sourceUrl: item.sourceUrl || null,
            sourceType: item.sourceType || null,
          },
        });
      }

      if (newItems.length > 0) {
        await prisma.artist.update({
          where: { id: lead.artist.id },
          data: { emails: [...existingEmails, ...newItems.map((e) => e.email)] },
        });

        const emailsList = newItems.map((e) => `${e.email} (${e.confidence}, ${e.score}%, via ${e.sourceType} → ${e.sourceUrl})`).join("; ");
        await prisma.activity.create({
          data: {
            leadId: lead.id,
            type: "NOTE",
            note: `[AUTO-DISCOVER] Found contact(s): ${emailsList}`,
          },
        });

        result.activityLogged = true;
      }
    }
  } catch (error) {
    console.error(`Error discovering contacts for ${lead.artist.name}:`, error.message);
  }

  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const limitIndex = process.argv.indexOf("--limit");
  const limit = limitIndex !== -1 ? parseInt(process.argv[limitIndex + 1], 10) : 50;
  const onlyMissing = process.argv.includes("--missing");

  console.log("📧 Contact Intelligence & Email Discovery");
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"} | Limit: ${limit}`);
  if (onlyMissing) console.log("Filter: Only artists with missing emails");
  console.log();

  const query = {
    include: { artist: true },
    take: limit,
    orderBy: { updatedAt: "desc" },
    where: {
      status: { not: "PAUSED" },
      ...(onlyMissing ? { artist: { emails: { equals: [] } } } : {}),
    },
  };

  const leads = await prisma.lead.findMany(query);

  if (leads.length === 0) {
    console.log("✓ No leads to process");
    return { discovered: 0, totalEmails: 0, errors: 0 };
  }

  console.log(`Processing ${leads.length} leads...`);
  console.log();

  const counts = { total: leads.length, discovered: 0, verified: 0, inferred: 0, uncertain: 0, totalEmails: 0, errors: 0 };
  const discoveries = [];

  for (const lead of leads) {
    try {
      const discovery = await discoverContactsForLead(lead, dryRun);
      if (discovery.emailsFound.length > 0) {
        counts.discovered++;
        counts.totalEmails += discovery.emailsFound.length;
        if (discovery.confidence === "verified") counts.verified++;
        else if (discovery.confidence === "inferred") counts.inferred++;
        else counts.uncertain++;
        discoveries.push(discovery);
      }
    } catch (error) {
      console.error(`Error processing lead ${lead.id}:`, error.message);
      counts.errors++;
    }
  }

  console.log("📊 Results:");
  console.log(`  Leads processed: ${counts.total}`);
  console.log(`  Contacts discovered: ${counts.discovered}`);
  console.log(`  Total emails found: ${counts.totalEmails}`);

  if (counts.discovered > 0) {
    console.log("\nConfidence Breakdown:");
    console.log(`  Verified: ${counts.verified}`);
    console.log(`  Inferred: ${counts.inferred}`);
    console.log(`  Uncertain: ${counts.uncertain}`);
    console.log("\nSample discoveries (first 5):");
    discoveries.slice(0, 5).forEach((d) => {
      console.log(`  ${d.artistName}:`);
      d.emailsFound.slice(0, 2).forEach((e) => {
        console.log(`    ${e.email} (${e.confidence}, ${e.score}%)`);
      });
    });
  }

  if (dryRun) {
    console.log("\n⚠️  DRY RUN: No ContactInfo records or emails saved to database");
  }

  return { discovered: counts.discovered, totalEmails: counts.totalEmails, errors: counts.errors };
}

withAgentRun("discover-contacts", { dryRun: process.argv.includes("--dry-run") }, main)
  .catch((error) => {
    console.error("Fatal error:", error.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
