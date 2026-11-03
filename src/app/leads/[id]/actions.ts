"use server";

import { TRACK_TITLE_RULE, verifiedTrackTitle } from "@/lib/spotify-outreach";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { LeadStatus } from "local-prisma-client";
import { generateReachoutDrafts } from "@/lib/reachout";
import { findUnsupportedGenreTerms } from "@/lib/reachout-core";
import { getBestShowContext, formatPostWithTimestamp } from "@/lib/show-parser";
import { scoreLead } from "@/lib/scoring";
import { ensureBotRunning, isBotLoggedIn } from "@/lib/instagram-bot";
import { sendEmail } from "@/lib/email-sender";
import { appendContactRow, inferContactMethod } from "@/lib/google-sheets";
import { buildBookingUrl, buildBookingMessage } from "@/lib/google-calendar";
import { parseLocationString } from "@/lib/location-parser";
import { fetchSpotifyArtistProfile, fetchSpotifyReleases } from "@/lib/spotify";
import { extractAccentFromImage } from "@/lib/accent-palette";
import {
  enrollLeadInSequence,
  pauseActiveEnrollmentsForLead,
  ensureProjectHandoffOnClose,
  updateEnrollmentLifecycle,
  advanceDueEnrollments,
} from "@/lib/sequence-close-service";
import {
  inferFollowUpActionType,
  type CloseDealType,
} from "@/lib/reply-to-close-core";

type UpdateStatusState = {
  leadId: string;
  status: LeadStatus;
};

type LeadActionState = {
  leadId: string;
  nextActionAt?: Date;
};

type SendMessageState = {
  leadId: string;
  body: string;
  source?: string;
  tone?: string;
};

const formatPrettyDate = (date?: Date | null) => {
  if (!date) return null;
  const formatter = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return formatter.format(date);
};

const formatLocation = (
  location?: string | null,
  city?: string | null,
  state?: string | null,
  country?: string | null
) => {
  if (location) return location;
  const parts = [city, state, country].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
};

const getFollowUpDate = () => {
  const days = Number.parseInt(process.env.FOLLOW_UP_DAYS ?? "7", 10);
  if (Number.isNaN(days) || days <= 0) return undefined;
  const next = new Date();
  next.setDate(next.getDate() + days);
  return next;
};

export async function updateLeadStatus(state: UpdateStatusState) {
  const lead = await prisma.lead.findUnique({
    where: { id: state.leadId },
    include: {
      artist: { select: { instagramHandle: true, emails: true } },
    },
  });

  if (!lead || lead.status === state.status) {
    return;
  }

  const defaultFollowUpDate = new Date(Date.now() + 2 * 86400000);

  await prisma.lead.update({
    where: { id: state.leadId },
    data: {
      status: state.status,
      ...(state.status === "WON" ? { nextActionAt: null } : {}),
      ...(state.status === "FOLLOW_UP"
        ? {
            followUpActionType: inferFollowUpActionType(lead.artist),
            nextActionAt: lead.nextActionAt ?? defaultFollowUpDate,
          }
        : {}),
    },
  });

  await prisma.activity.create({
    data: {
      leadId: state.leadId,
      type: "STATUS_CHANGE",
      note: `Status changed to ${state.status}`,
    },
  });

  if (state.status === "WON") {
    await ensureProjectHandoffOnClose({ leadId: state.leadId });
  } else if (state.status === "LOST" || state.status === "PAUSED") {
    await pauseActiveEnrollmentsForLead({
      leadId: state.leadId,
      reason: `status set to ${state.status}`,
      terminalStatus: state.status === "LOST" ? "CANCELLED" : "PAUSED",
    });
  } else if (state.status === "CONTACTED") {
    try {
      await enrollLeadInSequence({
        leadId: state.leadId,
        afterOutboundSend: true,
        onlyIfNoExistingEnrollment: true,
      });
    } catch (err) {
      console.warn("[updateLeadStatus] Sequence enrollment skipped:", err);
    }
  }

  revalidatePath("/leads");
  revalidatePath("/");
  revalidatePath("/operations");
  revalidatePath("/projects");
  revalidatePath("/sequences");
  revalidatePath("/replies");
  revalidatePath(`/leads/${state.leadId}`);
}

export async function markContacted(state: LeadActionState) {
  const lead = await prisma.lead.findUnique({
    where: { id: state.leadId },
    include: { artist: true },
  });

  if (!lead) return;

  const isEmail = !lead.artist.instagramHandle && (lead.artist.emails?.length ?? 0) > 0;

  await prisma.lead.update({
    where: { id: state.leadId },
    data: {
      status: "CONTACTED",
      lastContactedAt: new Date(),
      nextActionAt: state.nextActionAt,
      followUpActionType: inferFollowUpActionType(lead.artist, isEmail ? "email" : "ig"),
    },
  });

  await prisma.activity.create({
    data: {
      leadId: state.leadId,
      type: "MESSAGE_SENT",
      note: "Marked contacted",
    },
  });

  const contactMethod = inferContactMethod({ hasEmail: (lead.artist.emails?.length ?? 0) > 0 });
  appendContactRow({
    artistName: lead.artist.name,
    contactMethod,
    instagramHandle: lead.artist.instagramHandle,
    email: lead.artist.emails?.[0],
    website: lead.artist.officialSiteUrl,
    dateContacted: new Date(),
  });

  try {
    await enrollLeadInSequence({
      leadId: lead.id,
      afterOutboundSend: true,
      onlyIfNoExistingEnrollment: true,
    });
  } catch (err) {
    console.warn("[markContacted] Sequence enrollment skipped:", err);
  }

  revalidatePath(`/leads/${lead.id}`);
  revalidatePath("/leads");
  revalidatePath("/operations");
  revalidatePath("/sequences");
}

export async function sendMessage(state: SendMessageState) {
  const trimmed = state.body.trim();
  if (!trimmed) return { ok: false, error: "Message body is empty." };

  const lead = await prisma.lead.findUnique({
    where: { id: state.leadId },
    include: { artist: true },
  });

  if (!lead) return { ok: false, error: "Lead not found." };

  const nextActionAt = getFollowUpDate();
  const isEmail = state.tone?.toLowerCase().includes("email") || false;
  let sendOk = false;
  let errorMessage: string | undefined;

  if (isEmail) {
    const to = lead.artist.emails?.[0];
    if (!to) {
      return { ok: false, error: "Artist does not have an email address on file." };
    }
    try {
      let subject = `Inquiry regarding ${lead.artist.name}`;
      let bodyText = trimmed;
      const subjectMatch = trimmed.match(/^Subject:\s*(.+?)(?:\r?\n\r?\n|\r?\n)/i);
      if (subjectMatch) {
        subject = subjectMatch[1].trim();
        bodyText = trimmed.slice(subjectMatch[0].length).trim();
      }
      await sendEmail(to, subject, bodyText.replace(/\n/g, "<br>"));
      sendOk = true;
    } catch (error) {
      sendOk = false;
      errorMessage = error instanceof Error ? error.message : "SMTP email delivery failed";
    }
  } else {
    // IG DM Channel
    const webhookUrl = process.env.IG_DM_WEBHOOK_URL;
    if (!webhookUrl) {
      return { ok: false, error: "Instagram DM bot webhook is not configured." };
    }
    if (!lead.artist.instagramHandle) {
      return { ok: false, error: "Artist does not have an Instagram handle on file." };
    }

    // Ensure the bot is running before attempting to send
    await ensureBotRunning();

    // Verify bot login session before queueing
    const botLogin = await isBotLoggedIn();
    if (!botLogin.loggedIn) {
      return {
        ok: false,
        error: botLogin.error || "Instagram DM bot is not logged in. Instagram session cookies have expired.",
      };
    }

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.IG_DM_WEBHOOK_SECRET
            ? { "X-Webhook-Secret": process.env.IG_DM_WEBHOOK_SECRET }
            : {}),
        },
        body: JSON.stringify({
          leadId: lead.id,
          artist: {
            name: lead.artist.name,
            instagramHandle: lead.artist.instagramHandle,
            instagramProfileUrl: lead.artist.instagramProfileUrl,
          },
          message: {
            body: trimmed,
            source: state.source ?? "sent",
          },
          followUpAt: nextActionAt?.toISOString() ?? null,
        }),
      });
      sendOk = response.ok;
      if (!response.ok) {
        const text = await response.text().catch(() => "No response body");
        console.error("IG DM webhook failed", response.status, text);
        try {
          const json = JSON.parse(text);
          errorMessage = json.error || `Bot server error (${response.status})`;
        } catch {
          errorMessage = `Bot server error (${response.status}): ${text.slice(0, 100)}`;
        }
      }
    } catch (error) {
      console.error("Failed to call IG DM webhook", error);
      sendOk = false;
      errorMessage = error instanceof Error ? error.message : "Network error calling bot server";
    }
  }

  if (!sendOk) {
    await prisma.messageDraft.create({
      data: {
        leadId: lead.id,
        body: trimmed,
        source: state.source ?? "failed",
        selected: false,
        ...(state.tone ? { tone: state.tone } : {}),
      },
    });

    await prisma.activity.create({
      data: {
        leadId: lead.id,
        type: "NOTE",
        note: `Send failed via ${isEmail ? "Email" : "IG webhook"}: ${errorMessage}`,
      },
    });

    return { ok: false, error: errorMessage ?? `Failed to send via ${isEmail ? "Email" : "IG webhook"}.` };
  }

  await prisma.lead.update({
    where: { id: state.leadId },
    data: {
      status: "CONTACTED",
      lastContactedAt: new Date(),
      nextActionAt,
      followUpActionType: inferFollowUpActionType(lead.artist, isEmail ? "email" : "ig"),
    },
  });

  await prisma.activity.create({
    data: {
      leadId: lead.id,
      type: "MESSAGE_SENT",
      note: trimmed,
    },
  });

  await prisma.messageDraft.create({
    data: {
      leadId: lead.id,
      body: trimmed,
      source: state.source ?? "sent",
      selected: true,
      ...(state.tone ? { tone: state.tone } : {}),
    },
  });

  await prisma.messageDraft.deleteMany({
    where: {
      leadId: lead.id,
      selected: false,
      OR: [
        {
          source: "reachout",
          ...(state.tone ? { tone: state.tone } : {}),
        },
        {
          source: { startsWith: "sequence:" },
          ...(isEmail
            ? { tone: { contains: "Email", mode: "insensitive" } }
            : { NOT: { tone: { contains: "Email", mode: "insensitive" } } }),
        },
      ],
    },
  });

  const contactMethod = inferContactMethod({ hasEmail: (lead.artist.emails?.length ?? 0) > 0 });
  appendContactRow({
    artistName: lead.artist.name,
    contactMethod,
    instagramHandle: lead.artist.instagramHandle,
    email: lead.artist.emails?.[0],
    website: lead.artist.officialSiteUrl,
    messageText: trimmed,
    dateContacted: new Date(),
  });

  try {
    await enrollLeadInSequence({
      leadId: lead.id,
      afterOutboundSend: true,
      onlyIfNoExistingEnrollment: true,
    });
  } catch (err) {
    console.warn("[sendMessage] Auto-enrollment skipped:", err);
  }

  revalidatePath(`/leads/${lead.id}`);
  revalidatePath("/leads");
  revalidatePath("/operations");
  revalidatePath("/sequences");
  redirect("/leads");
}

type SendCalendarLinkState = {
  leadId: string;
  channel?: "ig" | "copy";
};

export async function sendCalendarLink(state: SendCalendarLinkState) {
  const channel = state.channel ?? "ig";
  const lead = await prisma.lead.findUnique({
    where: { id: state.leadId },
    include: { artist: true },
  });

  if (!lead) return { ok: false, error: "Lead not found." };

  const bookingUrl = buildBookingUrl({
    artistName: lead.artist.name,
    artistEmail: lead.artist.emails?.[0] ?? null,
    artistHandle: lead.artist.instagramHandle,
  });

  const messageBody = buildBookingMessage({
    artistName: lead.artist.name,
    bookingUrl,
  });

  if (channel === "ig") {
    const webhookUrl = process.env.IG_DM_WEBHOOK_URL;
    if (webhookUrl) {
      await ensureBotRunning();
      const botLogin = await isBotLoggedIn();
      if (!botLogin.loggedIn) {
        return {
          ok: false,
          bookingUrl,
          error: botLogin.error || "Instagram DM bot is not logged in. Session cookies have expired.",
        };
      }
      try {
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(process.env.IG_DM_WEBHOOK_SECRET
              ? { "X-Webhook-Secret": process.env.IG_DM_WEBHOOK_SECRET }
              : {}),
          },
          body: JSON.stringify({
            leadId: lead.id,
            artist: {
              name: lead.artist.name,
              instagramHandle: lead.artist.instagramHandle,
              instagramProfileUrl: lead.artist.instagramProfileUrl,
            },
            message: {
              body: messageBody,
              source: "calendar_link",
            },
            followUpAt: null,
          }),
        });

        if (!response.ok) {
          const text = await response.text().catch(() => "No response body");
          console.error("Calendar link IG DM failed", response.status, text);
          return {
            ok: false,
            bookingUrl,
            error: `Bot server error (${response.status}): ${text.slice(0, 100)}`,
          };
        }
      } catch (error) {
        console.error("Failed to call IG DM webhook for calendar link", error);
        return {
          ok: false,
          bookingUrl,
          error: error instanceof Error ? error.message : "Network error",
        };
      }
    }
  }

  const nextActionAt = getFollowUpDate();

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      status: "CONTACTED",
      lastContactedAt: new Date(),
      ...(nextActionAt ? { nextActionAt } : {}),
    },
  });

  await prisma.activity.create({
    data: {
      leadId: lead.id,
      type: "MESSAGE_SENT",
      note: channel === "ig"
        ? `Sent Google Calendar booking link via IG DM: ${bookingUrl}`
        : `Generated Google Calendar booking link: ${bookingUrl}`,
    },
  });

  await prisma.messageDraft.create({
    data: {
      leadId: lead.id,
      body: messageBody,
      source: "calendar_link",
      selected: true,
    },
  });

  const contactMethod = inferContactMethod({
    hasEmail: (lead.artist.emails?.length ?? 0) > 0,
  });
  appendContactRow({
    artistName: lead.artist.name,
    contactMethod,
    instagramHandle: lead.artist.instagramHandle,
    email: lead.artist.emails?.[0],
    website: lead.artist.officialSiteUrl,
    messageText: messageBody,
    dateContacted: new Date(),
  });

  revalidatePath(`/leads/${lead.id}`);
  revalidatePath("/leads");

  return { ok: true, bookingUrl };
}

const AUSTIN_LOCAL_REGEX =
  /\b(austin|round rock|cedar park|pflugerville|georgetown|kyle|buda|leander|manor|bastrop|dripping springs|lakeway|bee cave|sunset valley|rollingwood|atx)\b/i;

function isAustinLocalArea(location?: string | null, city?: string | null, state?: string | null): boolean {
  const combined = [location, city, state].filter(Boolean).join(" ");
  return AUSTIN_LOCAL_REGEX.test(combined);
}

const GENRE_STYLE_MAP: Record<string, { tone: string; igStyle: string; keywords: string[] }> = {
  hiphop: {
    keywords: ["hip hop", "hip-hop", "rap", "trap", "drill", "boom bap", "grime"],
    tone: "casual, grounded, authentic peer respect. Zero cheesy slang, zero caricature.",
    igStyle: "Talk like a fellow producer/engineer who respects beats, flow, vocal clarity, and 808s.",
  },
  metal: {
    keywords: ["metal", "heavy metal", "death metal", "black metal", "doom", "thrash", "metalcore", "deathcore", "hardcore"],
    tone: "direct, grounded, respectful of heavy music. No cheese or parody.",
    igStyle: "Acknowledge guitar tones, aggressive drums, live intensity, or songwriting punch.",
  },
  rock: {
    keywords: ["rock", "alternative", "indie rock", "punk", "garage", "grunge"],
    tone: "understated, authentic, unpretentious peer vibe",
    igStyle: "Straightforward and real; focus on songwriting, band energy, or raw room sound.",
  },
  electronic: {
    keywords: ["electronic", "edm", "house", "techno", "dubstep", "drum and bass", "dnb", "bass music", "dance"],
    tone: "production-literate, clean, conversational",
    igStyle: "Reference sound design, mix punch, low-end translation, or groove.",
  },
  pop: {
    keywords: ["pop", "indie pop", "synth pop", "dream pop", "r&b", "soul"],
    tone: "warm, polished, conversational",
    igStyle: "Appreciate vocal production, hooks, and sonic polish.",
  },
  default: {
    keywords: [],
    tone: "natural, authentic peer-to-peer musician/engineer",
    igStyle: "Conversational, genuine, unpretentious.",
  },
};

function getGenreStyle(genreText?: string | null) {
  if (!genreText) return GENRE_STYLE_MAP.default;
  const lower = genreText.toLowerCase();
  for (const [key, val] of Object.entries(GENRE_STYLE_MAP)) {
    if (key === "default") continue;
    if (val.keywords.some((kw) => lower.includes(kw))) return val;
  }
  return GENRE_STYLE_MAP.default;
}

function sanitizeDraftText(text: string): string {
  if (typeof text !== "string") return text;
  let out = text;
  out = out.replace(/\bin east austin,?\s+texas\b/gi, "in Austin, Texas");
  out = out.replace(/\bin east austin,?\s+tx\b/gi, "in Austin, TX");
  out = out.replace(/\bin east austin\b/gi, "in Austin");
  out = out.replace(/\beast austin\b/gi, "Austin");
  out = out.replace(/\bon the east side in austin\b/gi, "in Austin");
  out = out.replace(/\bon the east side\b/gi, "in Austin");

  out = out.replace(/\bi run a studio\s*\/\s*mixing and tracking room\b/gi, "I mix and produce records here in Austin");
  out = out.replace(/\bi run a studio,?\s+mixing and tracking room\b/gi, "I mix and produce records here in Austin");
  out = out.replace(/\bi run a (?:studio\s*\/\s*)?(?:mixing\s+and\s+)?tracking\s+room\b/gi, "I'm an audio engineer here in Austin");
  out = out.replace(/\bi run a (?:recording|mixing|tracking|studio)[\s\w/&-]*room\b/gi, "I'm an audio engineer here in Austin");
  out = out.replace(/\bi run a studio\b/gi, "I'm an audio engineer here in Austin");
  out = out.replace(/\brunning a (?:studio\s*\/\s*)?(?:mixing\s+and\s+)?tracking\s+room\b/gi, "engineering here in Austin");
  out = out.replace(/\brunning a (?:recording|mixing|tracking|studio)[\s\w/&-]*room\b/gi, "engineering here in Austin");
  out = out.replace(/\brunning a studio\b/gi, "engineering here in Austin");
  out = out.replace(/\b(?:a\s+)?mixing and tracking room\b/gi, "audio engineer in Austin");
  out = out.replace(/\b(?:a\s+)?tracking & mix room\b/gi, "audio engineer in Austin");
  out = out.replace(/\b(?:a\s+)?tracking and mix room\b/gi, "audio engineer in Austin");
  out = out.replace(/\btracking room\b/gi, "studio space");

  // Remove any Spectral Soundworks references from outreach drafts
  out = out.replace(/\b(?:with|at|from)\s+Spectral\s+Soundworks\b/gi, "here in Austin");
  out = out.replace(/\bSpectral[\s-]+Soundworks\b/gi, "");
  out = out.replace(/\bhere in Austin\s+in Austin\b/gi, "here in Austin");

  out = out.replace(/\bin Austin,?\s+in Austin\b/gi, "in Austin");
  out = out.replace(/\bhere in Austin,?\s+in Austin\b/gi, "here in Austin");
  out = out.replace(/[ \t]{2,}/g, " ");
  out = out.replace(/[ \t]+([.,!?])/g, "$1");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

function cleanEmailDraft(value: string, artistName: string): string {
  let text = (value || "").trim();
  text = text.replace(/\[your name\]/gi, "Kasper Pickett");
  text = text.replace(/\[your studio\]/gi, "");
  text = text.replace(/\[your contact info(?:rmation)?\]/gi, "");
  text = text.replace(/\[contact info(?:rmation)?\]/gi, "");
  text = text.replace(/\[phone\]/gi, "");
  text = text.replace(/\[email\]/gi, "");
  text = sanitizeDraftText(text);

  // Strip Spectral Soundworks from body or signature
  text = text.replace(/\n\s*Spectral[\s-]+Soundworks\s*$/gi, "");
  text = text.replace(/\bSpectral[\s-]+Soundworks\b/gi, "");
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  if (!/kasper pickett/i.test(text)) {
    text = `${text}\n\nBest,\nKasper Pickett`;
  } else {
    text = text.replace(/kasper pickett\s*(?:\n\s*spectral soundworks)?/gi, "Kasper Pickett");
  }
  return text.trim();
}

function generateDeterministicDrafts(ctx: {
  artistName: string;
  location?: string | null;
  isAustinLocal: boolean;
  releaseTitle?: string | null;
  releaseType?: string | null;
  upcomingShow?: { venue?: string; datePretty?: string } | null;
  recentPastShow?: { venue?: string; datePretty?: string } | null;
  hasEmail: boolean;
  isPortfolioCampaign: boolean;
}): { IG_A: string; IG_B: string; EMAIL_A?: string; EMAIL_B?: string } {
  const name = ctx.artistName;
  const releaseRef = ctx.releaseTitle ? `"${ctx.releaseTitle}"` : "your recent tracks";

  let igA = "";
  let igB = "";
  let emailA = "";
  let emailB = "";

  if (ctx.isPortfolioCampaign) {
    igA = ctx.releaseTitle
      ? `Hey ${name}, been spinning ${releaseRef} lately—really dig the production choices and the depth you've got on the vocal and rhythm tracks. I'm an audio engineer based here in Austin. I'm currently looking to connect with a handful of artists whose sound I respect, and I'd love to mix or master your next single on the house to see how we work together. If you're cutting new material soon or have stems ready to go, let's definitely connect!`
      : `Hey ${name}, came across your music and really love the vibe and raw energy you've got going. I'm an audio engineer based here in Austin. I'm currently collaborating with select artists to expand my mix portfolio, and I'd love to mix or track a song for you on the house to test the waters. If you have any new tunes brewing, let's connect and swap some ideas!`;

    if (ctx.upcomingShow) {
      igB = ctx.isAustinLocal
        ? `Hey ${name}, saw you've got an upcoming show lined up at ${ctx.upcomingShow.venue || "Austin"} on ${ctx.upcomingShow.datePretty || "the calendar"}—always love seeing local acts bringing that energy to the stage. I'm an audio engineer based here in town, and I'm offering a complimentary first-song mix or tracking session for artists whose sound I dig. If you're planning any new studio releases around the gig or after, let's grab coffee or chat music!`
        : `Hey ${name}, saw you're coming through Austin for your set at ${ctx.upcomingShow.venue || "a show"} on ${ctx.upcomingShow.datePretty || "the calendar"}—stoked you're hitting our local scene. I'm an audio engineer based here in Austin, and I'm offering to mix or master a single on the house for artists passing through. If you have some downtime while you're in town or want to link up on sound, let me know!`;
    } else if (ctx.recentPastShow) {
      igB = `Hey ${name}, hope your set at ${ctx.recentPastShow.venue || "the venue"} was killer last week—love the live momentum you have going. I'm an audio engineer here in Austin, and I'm offering to mix or master a new track on the house for select artists whose sound I really believe in. If you're gearing up for your next recording phase, I'd love to connect and hear what you're working on!`;
    } else {
      igB = `Hey ${name}, really appreciate what you're bringing to the scene—your sound has great atmosphere and punch. I'm an audio engineer based here in Austin. I'm doing a complimentary first-song mix or tracking session for a few select artists to build out some fresh collaborations. If you've got a demo or next single in the works, let me know if you'd like to test-drive a mix together!`;
    }

    emailA = `Subject: Question on ${ctx.releaseTitle || "your music"} mix & vocal tones\n\nHey ${name},\n\n` +
      `Been spending some time listening to ${releaseRef} and really wanted to reach out. The instrumentation, tonal balance, and overall atmosphere in your tracks have a distinctive weight that really stands out to me as an engineer.\n\n` +
      `I'm Kasper Pickett, an independent audio engineer based here in Austin. I work closely with artists on dialing in punchy, dynamic mixes and tactile production. Right now, I'm taking on a few select projects for a complimentary first-song collaboration—recording, mixing, or mastering a single completely on the house—so we can see how we vibe creatively without any upfront commitment.\n\n` +
      `If you're currently tracking new tunes or sitting on rough demos you want to hear fully mixed, I'd love to take a listen. Let me know if you'd be open to chatting or swapping stems.\n\n` +
      `Best,\nKasper Pickett`;

    emailB = `Subject: Austin sound + ${ctx.upcomingShow?.venue ? `${ctx.upcomingShow.venue} show` : "connecting on your music"}\n\nHey ${name},\n\n` +
      `${
        ctx.upcomingShow
          ? ctx.isAustinLocal
            ? `Saw you have an upcoming show at ${ctx.upcomingShow.venue || "Austin"} on ${ctx.upcomingShow.datePretty || "the calendar"}—really looking forward to seeing that live energy on stage.`
            : `Saw you're coming through Austin for your set at ${ctx.upcomingShow.venue || "a show"} on ${ctx.upcomingShow.datePretty || "the calendar"}. It's always great having out-of-town talent bring fresh energy to the local circuit.`
          : ctx.recentPastShow
            ? `Hope your set at ${ctx.recentPastShow.venue || "Austin"} was a great night—always love keeping tabs on the live scene around town.`
            : `Just wanted to drop a line because I've been following your recent music and really respect the momentum you're building.`
      }\n\n` +
      `I'm Kasper Pickett, an audio engineer based here in Austin. I'm currently offering a free first-song mix or tracking session for select artists whose sound and vision I really dig, purely to build out long-term creative relationships in the community. No strings attached—just dialed-in sound and an extra set of experienced ears.\n\n` +
      `If you're cutting new material, planning your next release, or have tracks you want to test-drive in the mix, let me know! Always down to grab a coffee or jump on a quick call.\n\n` +
      `Best,\nKasper Pickett`;
  } else {
    igA = ctx.releaseTitle
      ? `Hey ${name}, been spinning ${releaseRef} lately—really love the arrangement and the grit on the guitars and vocals. I'm an audio engineer based here in Austin. I'm always keeping an ear out for artists with a distinct identity, and I'd love to connect whenever you're tracking, mixing, or planning your next release. Let me know if you ever want to bounce mix ideas or talk shop on tones!`
      : `Hey ${name}, came across your tracks and really dig the style and musical direction you're carving out. I'm an audio engineer based here in Austin. Always excited to connect with fellow musicians in the scene—whenever you're in the middle of recording or lining up mixes for new tunes, would love to hear what you're working on!`;

    if (ctx.upcomingShow) {
      igB = ctx.isAustinLocal
        ? `Hey ${name}, noticed you've got an upcoming set at ${ctx.upcomingShow.venue || "the venue"} on ${ctx.upcomingShow.datePretty || "the calendar"}—hope rehearsals are feeling locked in. I'm an audio engineer here in Austin, always staying plugged into the local live scene. Would love to link up whenever you're back in the studio working on your next batch of songs!`
        : `Hey ${name}, saw you're coming through Austin for ${ctx.upcomingShow.venue || "your upcoming show"} on ${ctx.upcomingShow.datePretty || "the calendar"}. I'm an audio engineer based here in town—hope you have a killer set while you're in Austin, and let's definitely connect if you're ever looking for local recording or mixing ears!`;
    } else if (ctx.recentPastShow) {
      igB = `Hey ${name}, hope that set at ${ctx.recentPastShow.venue || "the gig"} was a blast last week—really loved the live crowd response. I'm an audio engineer here in Austin. Whenever you're mapping out the next record or looking to take your mixes up a notch, let's definitely connect!`;
    } else {
      igB = `Hey ${name}, really dig what you bring to the music scene—the atmosphere and songwriting on your tracks is great. I'm an audio engineer here in Austin. Always open to connecting with artists doing authentic work, so feel free to hit me up whenever you're cutting new material or testing mixes!`;
    }

    emailA = `Subject: Question on ${ctx.releaseTitle || "your sound"} mixes & production\n\nHey ${name},\n\n` +
      `Been listening to ${releaseRef} and really loved the overall sonic character and mix balance you achieved. The rhythm section punch and vocal space especially caught my ear as an engineer.\n\n` +
      `I'm Kasper Pickett, an independent audio engineer based here in Austin. I specialize in helping artists capture tactile, organic tones and dialing in mixes that translate punchy and loud without losing their dynamics or emotional warmth. Whenever you're lining up your next batch of tracks or getting ready to cut a new single, I'd love to see if we can collaborate.\n\n` +
      `If you're currently working on demos or want an experienced set of ears on rough mixes, feel free to send some audio over. Would love to chat about your next project.\n\n` +
      `Best,\nKasper Pickett`;

    emailB = `Subject: ${ctx.upcomingShow?.venue ? `${ctx.upcomingShow.venue} show + Austin music` : `${name} + Austin audio collaboration`}\n\nHey ${name},\n\n` +
      `${
        ctx.upcomingShow
          ? ctx.isAustinLocal
            ? `Looking forward to your upcoming show at ${ctx.upcomingShow.venue || "Austin"} on ${ctx.upcomingShow.datePretty || "the calendar"}—hope show prep and rehearsals are feeling great.`
            : `Saw you're coming through Austin for your show at ${ctx.upcomingShow.venue || "Austin"} on ${ctx.upcomingShow.datePretty || "the calendar"}. Hope you have a great run while you're in town.`
          : ctx.recentPastShow
            ? `Hope that set at ${ctx.recentPastShow.venue || "Austin"} was a great night—always love keeping up with live gigs in the community.`
            : `Just wanted to say I've been following your music and really dig the consistency and live presence you bring.`
      }\n\n` +
      `I'm Kasper Pickett, an audio engineer based here in Austin. I'm always looking to connect with artists doing inspiring, thoughtful work in the scene. Whether you're tracking new tunes, looking for high-end mix engineering, or just wanting to bounce ideas on production, I'm always down to talk sound.\n\n` +
      `Whenever you're planning your next release or heading back into the studio, let's grab coffee in town or jump on a call.\n\n` +
      `Best,\nKasper Pickett`;
  }

  const result: { IG_A: string; IG_B: string; EMAIL_A?: string; EMAIL_B?: string } = {
    IG_A: sanitizeDraftText(igA),
    IG_B: sanitizeDraftText(igB),
  };
  if (ctx.hasEmail) {
    result.EMAIL_A = cleanEmailDraft(emailA, name);
    result.EMAIL_B = cleanEmailDraft(emailB, name);
  }
  return result;
}

async function isLeadInPortfolioCampaign(leadId: string): Promise<boolean> {
  const attempt = await prisma.outreachAttempt.findFirst({
    where: {
      leadId,
      campaign: {
        type: "PORTFOLIO_BUILDING",
        status: "ACTIVE",
      },
    },
    select: { id: true },
  });
  return Boolean(attempt);
}

async function generateReachoutWithAI(ctx: {
  spotifyArtistId?: string | null;
  artistName: string;
  genreText?: string | null;
  location?: string | null;
  bio?: string | null;
  releaseTitle?: string | null;
  releaseType?: string | null;
  releaseTiming?: string | null;
  isUpcomingRelease: boolean;
  upcomingShow?: { venue?: string; datePretty?: string; daysUntil?: number; title?: string } | null;
  recentPastShow?: { venue?: string; datePretty?: string; daysAgo?: number; title?: string } | null;
  recentPosts?: string | null;
  personalHook?: string | null;
  productionNeedLevel?: string | null;
  productionNeedEvidence?: string[];
  hasEmail: boolean;
  isPortfolioCampaign: boolean;
  styleHint?: string;
}): Promise<{ IG_A: string; IG_B: string; EMAIL_A?: string; EMAIL_B?: string }> {
  ctx = { ...ctx, releaseTitle: await verifiedTrackTitle(ctx.spotifyArtistId, ctx.releaseTitle) };
  const now = new Date();
  const currentDateStr = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(now);

  const isLocal = isAustinLocalArea(ctx.location);
  const genreStyle = getGenreStyle(ctx.genreText);

  let upcomingSection = "";
  if (ctx.upcomingShow) {
    upcomingSection = `
• CONFIRMED UPCOMING AUSTIN SHOW (IN THE FUTURE):
  Event: ${ctx.upcomingShow.title || "Show"} at ${ctx.upcomingShow.venue || "venue"} on ${ctx.upcomingShow.datePretty} (in ${ctx.upcomingShow.daysUntil} days).
  ${isLocal
    ? `MANDATORY: Artist is an Austin local! Mention looking forward to their gig at ${ctx.upcomingShow.venue || "the show"}, but NEVER say "while you're in town" or treat them like a visiting tourist.`
    : `MANDATORY: Artist is visiting Austin from out of town. Invite them to stop by the studio while they are in town for their show at ${ctx.upcomingShow.venue || "Austin"}. Keep it low-pressure.`
  }`;
  }

  let pastSection = "";
  if (!ctx.upcomingShow && ctx.recentPastShow) {
    pastSection = `
• RECENT PAST SHOW (ALREADY HAPPENED):
  Event: ${ctx.recentPastShow.title || "Show"} at ${ctx.recentPastShow.venue || "venue"} was on ${ctx.recentPastShow.datePretty} (${ctx.recentPastShow.daysAgo} days ago).
  MANDATORY: This gig ALREADY HAPPENED in the past! Speak strictly in the PAST TENSE (e.g. "Hope that set at ${ctx.recentPastShow.venue || "the gig"} was killer"). NEVER treat it as upcoming or say "tonight" or "can't wait to see you play"!`;
  }

  const noShowSection = !ctx.upcomingShow && !ctx.recentPastShow
    ? "• NO CONFIRMED AUSTIN SHOWS: Artist does NOT have an upcoming show on the calendar. Do NOT invent or mention any live show."
    : "";

  const releaseSection = ctx.releaseTitle
    ? `Spotify-verified music: "${ctx.releaseTitle}" (${ctx.releaseType || "release"}) — ${ctx.releaseTiming || "Catalog release"}`
    : "No catalog release title specified; speak to their sound and music in general.";

  const portfolioOfferBlock = ctx.isPortfolioCampaign
    ? `PORTFOLIO COLLABORATION HOOK (CASUAL & PEER-TO-PEER):
Kasper is offering to record, mix, or master their next single/track on the house (at no cost) as part of building out his mix portfolio with select artists in Austin.
DO NOT mention 'Spectral Soundworks'. Introduce Kasper as an independent audio engineer here in Austin.
Present this casually and directly as a peer musician/producer, NOT as a contractual pitch or legal disclaimer.
Natural examples:
• "Down to mix your next single on the house if you want an extra set of ears on it."
• "Would love to track or mix a song for you at no cost if you're looking to cut new tunes in Austin."
• "Happy to do a complimentary mix/master on your next track to see how we vibe together."
NEVER use stiff corporate terms like "within agreed song scope", "deliverables", or "contractual unlimited revisions".`
    : `STANDARD OUTREACH (NO FREE-SESSION PITCH):
This lead is NOT part of a portfolio building campaign. Do NOT offer free sessions or free songs.
Introduce Kasper as an Austin audio engineer, compliment their sound, and casually leave the door open to collaborate, track, or mix when they're working on new material.
DO NOT mention 'Spectral Soundworks'.`;

  const systemText = TRACK_TITLE_RULE +
    "You write outreach for Kasper Pickett, an independent audio engineer based in Austin, Texas.\n" +
    "CRITICAL REQUIREMENT: Do NOT mention 'Spectral Soundworks' anywhere in the message, subject, or signoff. Introduce Kasper simply as an independent Austin audio engineer.\n" +
    "Your objective: Initiate a genuine, substantive connection between fellow music creators. Sound like a seasoned, thoughtful Austin audio engineer—conversational, warm, peer-to-peer, confident, and grounded. Zero marketing fluff, corporate jargon, or sales desperation.\n\n" +
    "TEMPORAL ACCURACY RULES (CRITICAL & MANDATORY):\n" +
    `- Today's date is ${currentDateStr}.\n` +
    "- NEVER refer to any event, show, tour date, or social post that occurred before today as 'upcoming', 'coming up', 'soon', 'tonight', 'tomorrow', or 'next week'.\n" +
    "- If a show or event date occurred before today, it is in the PAST. You may ONLY refer to it in the past tense.\n" +
    "- Pay close attention to post date prefixes. If an older post announced a gig or track release, that event has ALREADY happened! Never frame past post announcements as future events.\n" +
    "- Only refer to a show as upcoming if it is explicitly listed under 'Upcoming Show' with a future date relative to today.\n\n" +
    "Banned phrases and clichés (do not use):\n" +
    "- Spectral Soundworks / spectral soundworks (DO NOT USE)\n" +
    "- i run a studio / run a studio\n" +
    "- mixing and tracking room\n" +
    "- tracking room / tracking & mix room\n" +
    "- in east Austin / in East Austin\n" +
    "- East Austin / east Austin\n" +
    "- on the east side\n" +
    "- love what you're building\n" +
    "- super clean work\n" +
    "- really solid stuff\n" +
    "- momentum\n" +
    "- resonated\n" +
    "- quick message\n" +
    "- no pressure\n" +
    "- hope this finds you well\n" +
    "- reaching out to see\n" +
    "- game-changer / next level\n" +
    "- just wanted to drop a line\n" +
    "- delve / dive into\n\n" +
    "CHANNEL FORMATTING & LENGTH RULES:\n" +
    "1. INSTAGRAM DMS (IG_A, IG_B):\n" +
    "   - LENGTH & CHARACTER COUNT: Substantive and conversational. 2 to 4 sentences, roughly 60–100 words (approx 350–600 characters). Do NOT make it a truncated 1-line blurb. Give it enough room to genuinely highlight their music, introduce Kasper's craft, and propose an authentic next step.\n" +
    "   - STYLE: Conversational DM style. Jump directly into their track/sound or live show with specific musical detail, introduce Kasper as an Austin audio engineer, and make a casual invite or offer.\n" +
    "   - NO 'Spectral Soundworks' mention.\n" +
    "   - EMOJIS: 0 to 1 natural emoji max, or none.\n" +
    "2. EMAILS (EMAIL_A, EMAIL_B):\n" +
    "   - LENGTH & CHARACTER COUNT: Full, thoughtful, well-developed emails. 120–180 words (approx 750–1,200 characters). Not a bare-bones blurb; provide substantial commentary on their music and a clear peer-level engineering introduction.\n" +
    "   - STRUCTURE:\n" +
    "     * Line 1: Must begin with 'Subject: [Short, natural subject line]' (e.g. 'Question on [Track] mixes & tones' or '[Venue] set + Austin sound')\n" +
    "     * Line 2: Empty line\n" +
    "     * Line 3: 'Hey [Artist],' or 'Hey [First Name],'\n" +
    "     * Line 4: Empty line\n" +
    "     * Paragraph 1 (2-3 sentences): Specific, thoughtful observation on their sound, release, vocal/instrumental tone, or live performance.\n" +
    "     * Paragraph 2 (2-3 sentences): Introduce Kasper as an Austin audio engineer, describe his tactile production aesthetic, and present an easy invite to collaborate or (if portfolio campaign) offer to mix a single on the house.\n" +
    "     * Paragraph 3 (1-2 sentences): A low-pressure invite to chat, swap stems/demos, grab coffee in Austin, or talk through future recording.\n" +
    "     * Signoff:\n" +
    "       Best,\n" +
    "       Kasper Pickett\n" +
    "       (DO NOT append 'Spectral Soundworks')\n" +
    "   - Clean, authentic, zero emojis.\n\n" +
    "TACTICAL ANGLES:\n" +
    "- VARIANT A (IG_A, EMAIL_A) = THE CRAFT & SOUND ANGLE:\n" +
    "  Focus on their music, production, instrumentation, mix tones, or recent release. If they have a release, weave it in naturally (e.g. 'Been spinning [Title]').\n" +
    "- VARIANT B (IG_B, EMAIL_B) = THE LIVE SCENE & COMMUNITY ANGLE:\n" +
    "  Focus on their upcoming gig in Austin, recent show, local scene ties, or live performance.\n";

  let productionNeedText = "";
  if (ctx.productionNeedLevel && ctx.productionNeedLevel !== "NONE") {
    productionNeedText = `Detected Production Need: ${ctx.productionNeedLevel}. Evidence: ${ctx.productionNeedEvidence?.join("; ") || "Active production intent"}\nNote: In Variant A, naturally connect this to their music or future tracks without being pushy.`;
  }

  const userText =
    `Context:\n` +
    `Current Date: ${currentDateStr}\n` +
    `Artist: ${ctx.artistName}\n` +
    `Location: ${ctx.location || "Unknown"} (Austin Local: ${isLocal ? "YES" : "NO"})\n` +
    `Genre (verified artist metadata): ${ctx.genreText || "Not specified"} (Tone guidance only: ${genreStyle.tone})\n` +
    `GENRE FACTUALITY RULE: Treat the verified genre above as the only source of truth. Do not invent, substitute, or upgrade it into another genre or subgenre. Do not describe the artist as metal, doom, rock, punk, electronic, pop, hip hop, or any other genre unless that exact genre is present in the verified genre metadata. If the genre is not specified, do not use genre labels at all. Never infer genre from a release title, bio, image, post, venue, or musical cliché.\n` +
    (ctx.styleHint ? `Style tweak requested: ${ctx.styleHint}\n` : "") +
    `\n${portfolioOfferBlock}\n\n` +
    `MUSIC & RELEASES:\n${releaseSection}\n` +
    `MANDATORY: For Variant A, reference their music naturally! Talk like a real engineer (e.g., "Been spinning [Title]—that mix punch is great" or "Really dug the tones on [Title]"). Never use robotic templates like "I am writing to you regarding your release [Title]".\n\n` +
    `SHOWS & GIGS:\n${upcomingSection || pastSection || noShowSection}\n\n` +
    (productionNeedText ? `${productionNeedText}\n\n` : "") +
    (ctx.personalHook ? `Personal Hook: ${ctx.personalHook}\n\n` : "") +
    (ctx.recentPosts ? `Historical Instagram Posts:\n${ctx.recentPosts}\n(Remember: captions represent past posts, not upcoming events)\n\n` : "") +
    (ctx.bio ? `Bio: ${ctx.bio}\n\n` : "") +
    `Output JSON only with keys: ${ctx.hasEmail ? "IG_A, IG_B, EMAIL_A, EMAIL_B" : "IG_A, IG_B"}.`;

  const schemaProperties: Record<string, { type: "string" }> = {
    IG_A: { type: "string" },
    IG_B: { type: "string" },
  };
  const requiredFields = ["IG_A", "IG_B"];
  if (ctx.hasEmail) {
    schemaProperties.EMAIL_A = { type: "string" };
    schemaProperties.EMAIL_B = { type: "string" };
    requiredFields.push("EMAIL_A", "EMAIL_B");
  }

  const payload = {
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    store: false,
    input: [
      { role: "system", content: [{ type: "input_text", text: systemText }] },
      { role: "user", content: [{ type: "input_text", text: userText }] },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "reachouts",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: schemaProperties,
          required: requiredFields,
        },
      },
    },
  };

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return generateDeterministicDrafts({
      artistName: ctx.artistName,
      location: ctx.location,
      isAustinLocal: isLocal,
      releaseTitle: ctx.releaseTitle,
      releaseType: ctx.releaseType,
      upcomingShow: ctx.upcomingShow,
      recentPastShow: ctx.recentPastShow,
      hasEmail: ctx.hasEmail,
      isPortfolioCampaign: ctx.isPortfolioCampaign,
    });
  }

  try {
    const apiUrl = process.env.OPENAI_API_URL || "https://api.openai.com/v1/responses";
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.warn(`OpenAI call returned ${response.status}, falling back to deterministic generation`);
      return generateDeterministicDrafts({
        artistName: ctx.artistName,
        location: ctx.location,
        isAustinLocal: isLocal,
        releaseTitle: ctx.releaseTitle,
        releaseType: ctx.releaseType,
        upcomingShow: ctx.upcomingShow,
        recentPastShow: ctx.recentPastShow,
        hasEmail: ctx.hasEmail,
        isPortfolioCampaign: ctx.isPortfolioCampaign,
      });
    }

    const text = await response.text();
    const parsed = JSON.parse(text);

    let outputJson: Record<string, string> | null = null;
    if (Array.isArray(parsed.output)) {
      for (const item of parsed.output) {
        if (Array.isArray(item?.content)) {
          for (const chunk of item.content) {
            if (chunk.type === "output_json" && chunk.json) {
              outputJson = chunk.json;
              break;
            }
            if (chunk.type === "output_text" && typeof chunk.text === "string") {
              outputJson = JSON.parse(chunk.text);
              break;
            }
          }
        }
      }
    } else if (Array.isArray(parsed.choices) && parsed.choices[0]?.message?.content) {
      outputJson = JSON.parse(parsed.choices[0].message.content);
    }

    if (!outputJson || !outputJson.IG_A || !outputJson.IG_B) {
      return generateDeterministicDrafts({
        artistName: ctx.artistName,
        location: ctx.location,
        isAustinLocal: isLocal,
        releaseTitle: ctx.releaseTitle,
        releaseType: ctx.releaseType,
        upcomingShow: ctx.upcomingShow,
        recentPastShow: ctx.recentPastShow,
        hasEmail: ctx.hasEmail,
        isPortfolioCampaign: ctx.isPortfolioCampaign,
      });
    }

    const unsupportedGenreTerms = Object.values(outputJson)
      .flatMap((value) => findUnsupportedGenreTerms(value, ctx.genreText));
    if (unsupportedGenreTerms.length > 0) {
      console.warn(
        `OpenAI draft contained unsupported genre terms (${[...new Set(unsupportedGenreTerms)].join(", ")}); falling back to genre-neutral generation`
      );
      return generateDeterministicDrafts({
        artistName: ctx.artistName,
        location: ctx.location,
        isAustinLocal: isLocal,
        releaseTitle: ctx.releaseTitle,
        releaseType: ctx.releaseType,
        upcomingShow: ctx.upcomingShow,
        recentPastShow: ctx.recentPastShow,
        hasEmail: ctx.hasEmail,
        isPortfolioCampaign: ctx.isPortfolioCampaign,
      });
    }

    const result: { IG_A: string; IG_B: string; EMAIL_A?: string; EMAIL_B?: string } = {
      IG_A: sanitizeDraftText(outputJson.IG_A),
      IG_B: sanitizeDraftText(outputJson.IG_B),
    };
    if (ctx.hasEmail) {
      result.EMAIL_A = cleanEmailDraft(outputJson.EMAIL_A || "", ctx.artistName);
      result.EMAIL_B = cleanEmailDraft(outputJson.EMAIL_B || "", ctx.artistName);
    }
    return result;
  } catch (error) {
    console.warn("OpenAI API draft generation fallback activated:", error instanceof Error ? error.message : error);
    return generateDeterministicDrafts({
      artistName: ctx.artistName,
      location: ctx.location,
      isAustinLocal: isLocal,
      releaseTitle: ctx.releaseTitle,
      releaseType: ctx.releaseType,
      upcomingShow: ctx.upcomingShow,
      recentPastShow: ctx.recentPastShow,
      hasEmail: ctx.hasEmail,
      isPortfolioCampaign: ctx.isPortfolioCampaign,
    });
  }
}

export async function generateDraftsForLead(
  leadId: string,
  options?: { styleHint?: string | null; shouldRevalidate?: boolean; portfolioOffer?: boolean }
) {
  if (!leadId) return;
  const { styleHint, shouldRevalidate = true } = options ?? {};

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      artist: true,
      messages: true,
      activities: { orderBy: { occurredAt: "desc" } },
    },
  });

  if (!lead) return;

  const now = new Date();
  const [releases, instagramPosts, inPortfolioCampaign] = await Promise.all([
    prisma.release.findMany({
      where: {
        artistId: lead.artistId,
        title: { not: "" },
        OR: [
          { spotifyTrackId: { not: null } },
          { spotifyReleaseId: { not: null } },
          { url: { not: null } },
        ],
      },
      orderBy: [{ releaseDate: "desc" }, { createdAt: "desc" }],
      take: 3,
    }),
    prisma.instagramPost.findMany({
      where: { artistId: lead.artistId },
      orderBy: [{ postedAt: "desc" }, { createdAt: "desc" }],
      take: 4,
    }),
    isLeadInPortfolioCampaign(lead.id),
  ]);

  const latestRelease = releases[0] || null;
  const releaseDate = latestRelease?.releaseDate ?? latestRelease?.createdAt ?? null;
  const daysSinceRelease = releaseDate
    ? Math.floor((now.getTime() - releaseDate.getTime()) / 86400000)
    : null;

  let releaseTiming: string | null = null;
  let isUpcomingRelease = false;
  if (daysSinceRelease !== null && releaseDate) {
    if (daysSinceRelease < -1) {
      isUpcomingRelease = true;
      releaseTiming = `Upcoming release scheduled for ${formatPrettyDate(releaseDate)} (in ${Math.abs(daysSinceRelease)} days)`;
    } else if (daysSinceRelease <= 180) {
      releaseTiming = `Recently dropped on ${formatPrettyDate(releaseDate)} (${daysSinceRelease === 0 ? "today" : `${daysSinceRelease} days ago`})`;
    } else {
      releaseTiming = `Released on ${formatPrettyDate(releaseDate)}`;
    }
  }

  const recentPosts = instagramPosts
    .map((post) => formatPostWithTimestamp(post, now))
    .filter(Boolean)
    .join(" | ");

  const personalHook =
    lead.scoreRationale && lead.scoreRationale.length <= 160
      ? lead.scoreRationale
      : null;

  const { upcomingShow, recentPastShow } = getBestShowContext(lead.activities, now);

  const evidenceList = Array.isArray(lead.productionNeedEvidence)
    ? (lead.productionNeedEvidence as string[])
    : typeof lead.productionNeedEvidence === "string"
      ? [lead.productionNeedEvidence]
      : [];

  const isPortfolio = options?.portfolioOffer !== undefined
    ? Boolean(options.portfolioOffer)
    : inPortfolioCampaign;

  const output = await generateReachoutWithAI({
    spotifyArtistId: lead.artist.spotifyArtistId,
    artistName: lead.artist.name,
    genreText: lead.artist.genre,
    location: formatLocation(
      lead.artist.location,
      lead.artist.city,
      lead.artist.state,
      lead.artist.country
    ),
    bio: lead.artist.bio,
    releaseTitle: latestRelease?.title ?? null,
    releaseType: latestRelease?.releaseType ?? "single",
    releaseTiming,
    isUpcomingRelease,
    upcomingShow: upcomingShow
      ? {
          title: upcomingShow.title,
          venue: upcomingShow.venue,
          datePretty: upcomingShow.dateStr,
          daysUntil: upcomingShow.daysDiff,
        }
      : null,
    recentPastShow: recentPastShow
      ? {
          title: recentPastShow.title,
          venue: recentPastShow.venue,
          datePretty: recentPastShow.dateStr,
          daysAgo: Math.abs(recentPastShow.daysDiff),
        }
      : null,
    recentPosts,
    personalHook,
    productionNeedLevel: lead.productionNeedLevel,
    productionNeedEvidence: evidenceList,
    hasEmail: (lead.artist.emails?.length ?? 0) > 0,
    isPortfolioCampaign: isPortfolio,
    styleHint: styleHint ?? undefined,
  });

  await prisma.messageDraft.deleteMany({
    where: { leadId: lead.id, source: "reachout" },
  });

  const drafts = [
    { tone: "IG A", body: output.IG_A },
    { tone: "IG B", body: output.IG_B },
  ];

  if (output.EMAIL_A && output.EMAIL_B) {
    drafts.push(
      { tone: "Email A", body: output.EMAIL_A },
      { tone: "Email B", body: output.EMAIL_B }
    );
  }

  await prisma.messageDraft.createMany({
    data: drafts.map((draft) => ({
      leadId: lead.id,
      body: draft.body.trim(),
      tone: draft.tone,
      source: "reachout",
      selected: false,
    })),
  });

  await prisma.activity.create({
    data: {
      leadId: lead.id,
      type: "NOTE",
      note: styleHint ? `Generated outreach drafts (${styleHint}).` : "Generated outreach drafts.",
    },
  });

  if (shouldRevalidate) {
    revalidatePath(`/leads/${lead.id}`);
  }
}

export async function generateDrafts(formData: FormData) {
  const leadId = formData.get("leadId");
  if (typeof leadId !== "string" || !leadId.trim()) return;
  const styleHintRaw = formData.get("status") || formData.get("styleHint");
  const styleHint = typeof styleHintRaw === "string" ? styleHintRaw : undefined;
  await generateDraftsForLead(leadId, { styleHint });
}

type DraftKey = "IG_A" | "IG_B" | "EMAIL_A" | "EMAIL_B";

const toneToKey = (tone: string, hasEmail: boolean): DraftKey => {
  const lower = tone.toLowerCase();
  if (lower.includes("email")) {
    return lower.includes("b") && hasEmail ? "EMAIL_B" : "EMAIL_A";
  }
  if (lower.includes("b")) return "IG_B";
  return "IG_A";
};

export async function regenerateDraft(formData: FormData) {
  const leadId = formData.get("leadId");
  const draftId = formData.get("draftId");
  const tone = formData.get("tone");
  const styleHintRaw = formData.get("styleHint");

  if (typeof leadId !== "string" || !leadId.trim()) return;
  if (typeof draftId !== "string" || !draftId.trim()) return;
  if (typeof tone !== "string" || !tone.trim()) return;

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      artist: true,
      messages: true,
      activities: { orderBy: { occurredAt: "desc" } },
    },
  });

  if (!lead) return;

  const now = new Date();
  const [releases, instagramPosts, inPortfolioCampaign] = await Promise.all([
    prisma.release.findMany({
      where: {
        artistId: lead.artistId,
        title: { not: "" },
        OR: [
          { spotifyTrackId: { not: null } },
          { spotifyReleaseId: { not: null } },
          { url: { not: null } },
        ],
      },
      orderBy: [{ releaseDate: "desc" }, { createdAt: "desc" }],
      take: 3,
    }),
    prisma.instagramPost.findMany({
      where: { artistId: lead.artistId },
      orderBy: [{ postedAt: "desc" }, { createdAt: "desc" }],
      take: 4,
    }),
    isLeadInPortfolioCampaign(lead.id),
  ]);

  const latestRelease = releases[0] || null;
  const releaseDate = latestRelease?.releaseDate ?? latestRelease?.createdAt ?? null;
  const daysSinceRelease = releaseDate
    ? Math.floor((now.getTime() - releaseDate.getTime()) / 86400000)
    : null;

  let releaseTiming: string | null = null;
  let isUpcomingRelease = false;
  if (daysSinceRelease !== null && releaseDate) {
    if (daysSinceRelease < -1) {
      isUpcomingRelease = true;
      releaseTiming = `Upcoming release scheduled for ${formatPrettyDate(releaseDate)} (in ${Math.abs(daysSinceRelease)} days)`;
    } else if (daysSinceRelease <= 180) {
      releaseTiming = `Recently dropped on ${formatPrettyDate(releaseDate)} (${daysSinceRelease === 0 ? "today" : `${daysSinceRelease} days ago`})`;
    } else {
      releaseTiming = `Released on ${formatPrettyDate(releaseDate)}`;
    }
  }

  const recentPosts = instagramPosts
    .map((post) => formatPostWithTimestamp(post, now))
    .filter(Boolean)
    .join(" | ");

  const personalHook =
    lead.scoreRationale && lead.scoreRationale.length <= 160
      ? lead.scoreRationale
      : null;

  const styleHint = typeof styleHintRaw === "string" ? styleHintRaw : undefined;

  const { upcomingShow, recentPastShow } = getBestShowContext(lead.activities, now);

  const evidenceList = Array.isArray(lead.productionNeedEvidence)
    ? (lead.productionNeedEvidence as string[])
    : typeof lead.productionNeedEvidence === "string"
      ? [lead.productionNeedEvidence]
      : [];

  const output = await generateReachoutWithAI({
    spotifyArtistId: lead.artist.spotifyArtistId,
    artistName: lead.artist.name,
    genreText: lead.artist.genre,
    location: formatLocation(
      lead.artist.location,
      lead.artist.city,
      lead.artist.state,
      lead.artist.country
    ),
    bio: lead.artist.bio,
    releaseTitle: latestRelease?.title ?? null,
    releaseType: latestRelease?.releaseType ?? "single",
    releaseTiming,
    isUpcomingRelease,
    upcomingShow: upcomingShow
      ? {
          title: upcomingShow.title,
          venue: upcomingShow.venue,
          datePretty: upcomingShow.dateStr,
          daysUntil: upcomingShow.daysDiff,
        }
      : null,
    recentPastShow: recentPastShow
      ? {
          title: recentPastShow.title,
          venue: recentPastShow.venue,
          datePretty: recentPastShow.dateStr,
          daysAgo: Math.abs(recentPastShow.daysDiff),
        }
      : null,
    recentPosts,
    personalHook,
    productionNeedLevel: lead.productionNeedLevel,
    productionNeedEvidence: evidenceList,
    hasEmail: (lead.artist.emails?.length ?? 0) > 0,
    isPortfolioCampaign: inPortfolioCampaign,
    styleHint,
  });

  const key = toneToKey(tone, (lead.artist.emails?.length ?? 0) > 0);
  const nextBody = (output as Record<string, string | undefined>)[key]?.trim();
  if (nextBody) {
    await prisma.messageDraft.update({
      where: { id: draftId },
      data: { body: nextBody, tone },
    });
    await prisma.activity.create({
      data: {
        leadId: lead.id,
        type: "NOTE",
        note: styleHint
          ? `Regenerated draft (${tone}) with style: ${styleHint}`
          : `Regenerated draft (${tone}).`,
      },
    });
    revalidatePath(`/leads/${lead.id}`);
  }
}

export async function regenerateAllDrafts(formData: FormData) {
  const leadId = formData.get("leadId");
  if (typeof leadId !== "string" || !leadId.trim()) return;
  await generateDraftsForLead(leadId, { shouldRevalidate: true });
  await prisma.activity.create({
    data: {
      leadId,
      type: "NOTE",
      note: "Regenerated all reachout drafts.",
    },
  });
}

export async function refreshLeadData(formData: FormData) {
  const leadId = formData.get("leadId");
  if (typeof leadId !== "string" || !leadId.trim()) return;

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { artist: true },
  });

  if (!lead) return;

  const ingestUrl = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/ingest`
    : "http://localhost:3000/api/ingest";

  const payload = {
    lead: { id: leadId, status: lead.status },
    artist: {
      name: lead.artist.name,
      instagramHandle: lead.artist.instagramHandle ?? undefined,
      instagramProfileUrl: lead.artist.instagramProfileUrl ?? undefined,
      spotifyArtistId: lead.artist.spotifyArtistId ?? undefined,
      spotifyArtistUrl: lead.artist.spotifyArtistUrl ?? undefined,
      officialSiteUrl: lead.artist.officialSiteUrl ?? undefined,
    },
  };

  try {
    const response = await fetch(ingestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      await prisma.activity.create({
        data: {
          leadId: lead.id,
          type: "NOTE",
          note: `Refresh failed (${response.status}). ${text.slice(0, 120)}`,
        },
      });
      return;
    }

    await prisma.activity.create({
      data: {
        leadId: lead.id,
        type: "NOTE",
        note: "Refreshed Spotify/Instagram data.",
      },
    });
  } catch (error) {
    await prisma.activity.create({
      data: {
        leadId: lead.id,
        type: "NOTE",
        note: `Refresh failed. ${error instanceof Error ? error.message : "Unknown error"}`,
      },
    });
  }

  await scoreLead(leadId);
  revalidatePath(`/leads/${leadId}`);
}

export async function updateArtistHandle(state: {
  leadId: string;
  instagramHandle: string;
}) {
  const lead = await prisma.lead.findUnique({
    where: { id: state.leadId },
    include: { artist: true },
  });

  if (!lead) return;

  const normalized = state.instagramHandle.trim().replace("@", "");
  if (!normalized) return;

  await prisma.artist.update({
    where: { id: lead.artist.id },
    data: { instagramHandle: normalized },
  });

  await prisma.activity.create({
    data: {
      leadId: lead.id,
      type: "STATUS_CHANGE",
      note: `Instagram handle updated to @${normalized}`,
    },
  });

  revalidatePath(`/leads/${lead.id}`);
}

export async function trashLeadAction(formData: FormData) {
  const leadId = formData.get("leadId");
  if (typeof leadId !== "string") return;

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { artistId: true },
  });

  if (!lead) return;

  // First delete the lead (and its messages/activities via cascade)
  await prisma.lead.delete({
    where: { id: leadId },
  });

  // Then attempt to delete the artist to completely scrub them.
  try {
    await prisma.artist.delete({
      where: { id: lead.artistId },
    });
  } catch (err) {
    console.error(`[trashLeadAction] Failed to delete artist:`, err);
  }

  revalidatePath("/leads/desk");
  redirect("/");
}

export async function updateArtistName(state: {
  artistId: string;
  name: string;
}) {
  const artist = await prisma.artist.findUnique({
    where: { id: state.artistId },
    include: { leads: true },
  });

  if (!artist || !state.name.trim()) return;

  const newName = state.name.trim();

  await prisma.artist.update({
    where: { id: artist.id },
    data: { name: newName },
  });

  // Log activity on all leads associated with this artist
  if (artist.leads.length > 0) {
    await prisma.activity.createMany({
       data: artist.leads.map(lead => ({
          leadId: lead.id,
          type: "STATUS_CHANGE",
          note: `Artist name updated from '${artist.name}' to '${newName}'`,
       }))
    });
  }

  // Revalidate paths
  revalidatePath("/");
  revalidatePath("/leads/desk");
  for (const lead of artist.leads) {
    revalidatePath(`/leads/${lead.id}`);
  }
}

export async function updateArtistLocation(state: {
  artistId: string;
  location: string;
}) {
  const artist = await prisma.artist.findUnique({
    where: { id: state.artistId },
    include: { leads: true },
  });

  if (!artist) return;

  const rawLocation = state.location?.trim() || "";
  const parsed = rawLocation ? parseLocationString(rawLocation) : null;

  const finalLocation = parsed?.formatted ?? (rawLocation || null);
  const finalCity = parsed?.city ?? null;
  const finalState = parsed?.state ?? null;
  const finalCountry = parsed?.country ?? null;

  await prisma.artist.update({
    where: { id: artist.id },
    data: {
      location: finalLocation,
      city: finalCity,
      state: finalState,
      country: finalCountry,
    },
  });

  // Re-score leads and record audit note
  for (const lead of artist.leads) {
    try {
      await scoreLead(lead.id);
    } catch (e) {
      console.error(`Failed to rescore lead ${lead.id}:`, e);
    }

    await prisma.activity.create({
      data: {
        leadId: lead.id,
        type: "STATUS_CHANGE",
        note: `Artist location updated from '${artist.location || "None"}' to '${finalLocation || "None"}'`,
      },
    });
    revalidatePath(`/leads/${lead.id}`);
  }

  revalidatePath("/");
  revalidatePath("/leads/desk");
}

export async function updateArtistGenre(state: {
  artistId: string;
  genre: string;
}) {
  const artist = await prisma.artist.findUnique({
    where: { id: state.artistId },
    include: { leads: true },
  });

  if (!artist) return;

  const finalGenre = state.genre?.trim() || null;

  await prisma.artist.update({
    where: { id: artist.id },
    data: { genre: finalGenre },
  });

  for (const lead of artist.leads) {
    try {
      await scoreLead(lead.id);
    } catch (error) {
      console.error(`Failed to rescore lead ${lead.id}:`, error);
    }

    await prisma.activity.create({
      data: {
        leadId: lead.id,
        type: "STATUS_CHANGE",
        note: `Artist genre updated from '${artist.genre || "None"}' to '${finalGenre || "None"}'`,
      },
    });
    revalidatePath(`/leads/${lead.id}`);
  }

  revalidatePath("/");
  revalidatePath("/leads");
  revalidatePath("/leads/desk");
  revalidatePath("/operations");
}

/**
 * Parses a Spotify artist ID from a URL like:
 *   https://open.spotify.com/artist/3WrFJ7ztbogyGnTHbHJFl2
 * or a bare ID.
 */
function parseSpotifyArtistInput(input: string): { id: string; url: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Full URL
  const urlMatch = trimmed.match(/spotify\.com\/artist\/([A-Za-z0-9]+)/);
  if (urlMatch) {
    return {
      id: urlMatch[1],
      url: `https://open.spotify.com/artist/${urlMatch[1]}`,
    };
  }

  // Bare ID (alphanumeric, 22 chars typical)
  if (/^[A-Za-z0-9]{10,30}$/.test(trimmed)) {
    return {
      id: trimmed,
      url: `https://open.spotify.com/artist/${trimmed}`,
    };
  }

  return null;
}

export async function updateArtistSpotifyProfile(state: {
  artistId: string;
  leadId: string;
  spotifyInput: string;
}): Promise<{ ok: boolean; error?: string }> {
  const parsed = parseSpotifyArtistInput(state.spotifyInput);
  if (!parsed) {
    return { ok: false, error: "Invalid Spotify artist URL or ID." };
  }

  const artist = await prisma.artist.findUnique({
    where: { id: state.artistId },
    include: { leads: true },
  });
  if (!artist) return { ok: false, error: "Artist not found." };

  const spotifyOwner = await prisma.artist.findUnique({
    where: { spotifyArtistId: parsed.id },
    select: { id: true, name: true },
  });
  if (spotifyOwner && spotifyOwner.id !== artist.id) {
    return {
      ok: false,
      error: `That Spotify profile is already linked to ${spotifyOwner.name}. Choose a different artist profile.`,
    };
  }

  // Fetch new Spotify artist profile
  const profile = await fetchSpotifyArtistProfile(parsed.id);
  if (!profile) {
    return { ok: false, error: "Could not fetch Spotify artist data. Check the ID and try again." };
  }

  // Fetch releases for the new artist
  const releases = await fetchSpotifyReleases(parsed.id, 6);

  // Compute accent colors from the new image
  const newImageUrl = profile.imageUrl ?? null;
  const accent = newImageUrl ? await extractAccentFromImage(newImageUrl).catch(() => null) : null;

  await prisma.$transaction(async (tx) => {
    await tx.release.deleteMany({
      where: {
        artistId: artist.id,
        OR: [
          { spotifyReleaseId: { not: null } },
          { spotifyTrackId: { not: null } },
        ],
      },
    });

    await tx.artist.update({
      where: { id: artist.id },
      data: {
        spotifyArtistId: parsed.id,
        spotifyArtistUrl: profile.url ?? parsed.url,
        spotifyImageUrl: newImageUrl,
        spotifyAccent: accent?.accent ?? null,
        spotifyAccentStrong: accent?.accentStrong ?? null,
        spotifyHighlight: accent?.highlight ?? null,
        ...(profile.genres?.length ? { genre: profile.genres[0] } : {}),
      },
    });

    for (const release of releases) {
      const releaseData = {
        artistId: artist.id,
        title: release.title,
        releaseDate: release.releaseDate ? new Date(release.releaseDate) : undefined,
        imageUrl: release.imageUrl ?? undefined,
        url: release.url ?? undefined,
        releaseType: release.releaseType ?? undefined,
      };
      await tx.release.upsert({
        where: { spotifyReleaseId: release.spotifyReleaseId },
        update: releaseData,
        create: { ...releaseData, spotifyReleaseId: release.spotifyReleaseId },
      });
    }
  });

  // Log activity
  await prisma.activity.create({
    data: {
      leadId: state.leadId,
      type: "NOTE",
      note: `Spotify profile corrected → ${profile.name ?? parsed.id} (${parsed.url})`,
    },
  });

  // Re-score
  await scoreLead(state.leadId);

  revalidatePath(`/leads/${state.leadId}`);
  return { ok: true };
}


// ---------------------------------------------------------------------------
// Production Need Management
// ---------------------------------------------------------------------------

export type ProductionNeedLevel = "NONE" | "POSSIBLE" | "PROBABLE" | "CLEAR";

export type UpdateProductionNeedState = {
  leadId: string;
  level: ProductionNeedLevel;
  evidence: string[];
  note?: string;
};

export async function updateProductionNeed(state: UpdateProductionNeedState) {
  const { leadId, level, evidence, note } = state;

  const data: Record<string, unknown> = {
    productionNeedLevel: level,
    productionNeedEvidence: evidence,
    productionNeedEvidenceNote: level === "NONE" ? null : (note?.trim() || null),
  };

  if (level === "NONE") {
    data.productionNeedEvidence = [];
    data.productionNeedApprovedAt = null;
  } else {
    data.productionNeedApprovedAt = new Date();
  }

  await prisma.lead.update({ where: { id: leadId }, data });

  const cleanNote = note?.trim();
  const activityNote =
    level === "NONE"
      ? "Production need cleared (reset to NONE)"
      : `Production need set to ${level}. Evidence: ${evidence.join("; ")}${cleanNote ? ` — ${cleanNote}` : ""}`;

  await prisma.activity.create({
    data: { leadId, type: "NOTE", note: activityNote },
  });

  await scoreLead(leadId);

  revalidatePath(`/leads/${leadId}`);
  revalidatePath(`/leads`);
  revalidatePath(`/operations`);
}

// ---------------------------------------------------------------------------
// Reply-to-Close & Follow-Up Sequence Server Actions
// ---------------------------------------------------------------------------

export async function convertLeadToProjectAction(input: {
  leadId: string;
  dealType: CloseDealType;
  packageCode?: string | null;
  customTitle?: string;
}) {
  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    select: { id: true, status: true },
  });

  if (!lead) {
    throw new Error("Lead not found");
  }

  if (lead.status !== "WON") {
    await prisma.lead.update({
      where: { id: input.leadId },
      data: {
        status: "WON",
        nextActionAt: null,
      },
    });

    await prisma.activity.create({
      data: {
        leadId: input.leadId,
        type: "STATUS_CHANGE",
        note: "Status changed to WON (closed into active studio project)",
      },
    });
  }

  const handoff = await ensureProjectHandoffOnClose({
    leadId: input.leadId,
    dealType: input.dealType,
    packageCode: input.packageCode ?? null,
    customTitle: input.customTitle?.trim() || undefined,
    overwriteExistingInvoice: true,
  });

  revalidatePath(`/leads/${input.leadId}`);
  revalidatePath("/leads");
  revalidatePath("/projects");
  revalidatePath("/operations");
  revalidatePath("/sequences");
  revalidatePath("/replies");
  revalidatePath("/");

  return handoff;
}

export async function enrollLeadSequenceAction(input: {
  leadId: string;
  sequenceId: string;
}) {
  await enrollLeadInSequence({
    leadId: input.leadId,
    sequenceId: input.sequenceId,
  });

  revalidatePath(`/leads/${input.leadId}`);
  revalidatePath("/leads");
  revalidatePath("/operations");
  revalidatePath("/sequences");
  revalidatePath("/replies");

  return { ok: true as const };
}

export async function controlLeadSequenceAction(input: {
  leadId: string;
  enrollmentId: string;
  action: "PAUSE" | "RESUME" | "CANCEL" | "ADVANCE_NOW";
}) {
  if (input.action === "ADVANCE_NOW") {
    await advanceDueEnrollments({
      enrollmentId: input.enrollmentId,
      forceNow: true,
    });
  } else {
    await updateEnrollmentLifecycle({
      enrollmentId: input.enrollmentId,
      action: input.action,
    });
  }

  revalidatePath(`/leads/${input.leadId}`);
  revalidatePath("/leads");
  revalidatePath("/operations");
  revalidatePath("/sequences");
  revalidatePath("/replies");

  return { ok: true as const };
}

