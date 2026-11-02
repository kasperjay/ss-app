/* eslint-disable @typescript-eslint/no-require-imports */
// @ts-check

const { INVOICE_PACKAGE_TEMPLATES } = require("./invoice-templates");
const { isLowFollowerArtist } = require("./portfolio-priority");

const INTENT_STATUS_MAP = {
  INTERESTED: "FOLLOW_UP",
  NOT_NOW: "PAUSED",
  PRICING_REQUEST: "FOLLOW_UP",
  WRONG_CONTACT: "LOST",
  UNSUBSCRIBED: "LOST",
  BOOKED: "WON",
  UNCLEAR: "FOLLOW_UP",
};

const DEFAULT_SEQUENCES = [
  {
    name: "Standard Outreach Cadence",
    description:
      "3-touch sequence for new artist outreach: initial contact, check-in, and a final follow-up.",
    isDefault: true,
    steps: [
      {
        dayOffset: 0,
        tone: "Initial outreach",
        promptHint:
          "Introduce Spectral Soundworks naturally. Reference a recent release or show. Keep it concise, genuine, and low-pressure.",
      },
      {
        dayOffset: 4,
        tone: "Friendly check-in",
        promptHint:
          "Brief, light follow-up. Acknowledge they may be busy. Reference the previous message casually and ask one simple open-ended question about upcoming music.",
      },
      {
        dayOffset: 10,
        tone: "Final attempt",
        promptHint:
          "Low-pressure closing message. Express genuine interest, leave the door open for the future, and invite them to reach out whenever they are tracking or mixing next.",
      },
    ],
  },
  {
    name: "Interested Consultation Cadence",
    description:
      "2-step follow-up for artists who replied with interest so momentum converts into a booked session.",
    isDefault: false,
    steps: [
      {
        dayOffset: 2,
        tone: "Session scope & booking check-in",
        promptHint:
          "Follow up warmly on their reply, share the consultation booking link, and ask what song or demo they want to start with.",
      },
      {
        dayOffset: 6,
        tone: "Gentle studio hold check-in",
        promptHint:
          "Short check-in offering to hold a slot on the studio calendar or listen to a rough bounce whenever they are ready.",
      },
    ],
  },
  {
    name: "Pricing Follow-Up Cadence",
    description:
      "2-step cadence for leads that asked about pricing or scope but haven't locked in a session yet.",
    isDefault: false,
    steps: [
      {
        dayOffset: 2,
        tone: "Pricing reminder",
        promptHint:
          "Gently follow up on the rates/scope shared earlier. Offer to tailor a single-song or EP package or hop on a quick 15-minute call.",
      },
      {
        dayOffset: 8,
        tone: "Value-add close",
        promptHint:
          "Low-pressure follow-up inviting them to start with a single track so they can hear the mix/master translation firsthand before committing to a larger project.",
      },
    ],
  },
  {
    name: "Re-engagement Cadence",
    description:
      "2-touch re-engagement for leads that said 'not right now' or went quiet.",
    isDefault: true,
    steps: [
      {
        dayOffset: 0,
        tone: "Warm reactivation",
        promptHint:
          "Reconnect warmly after giving them space. Reference their music or live activity and ask how new material is coming along.",
      },
      {
        dayOffset: 7,
        tone: "Last attempt",
        promptHint:
          "Short, zero-pressure note leaving the door open whenever they head into mixing or mastering next.",
      },
    ],
  },
];

const RECOMMENDED_SEQUENCE_BY_INTENT = {
  INTERESTED: "Interested Consultation Cadence",
  PRICING_REQUEST: "Pricing Follow-Up Cadence",
  NOT_NOW: "Re-engagement Cadence",
  UNCLEAR: null,
  BOOKED: null,
  WRONG_CONTACT: null,
  UNSUBSCRIBED: null,
};

/**
 * Infers a valid Prisma FollowUpActionType ("DM" | "EMAIL" | "CALL" | "RESEARCH" | "OTHER")
 * so triaged and sequence-enrolled leads are immediately actionable in /operations.
 *
 * @param {{ instagramHandle?: string | null; emails?: string[] | null } | null | undefined} artist
 * @param {"ig" | "email" | "call" | null} [preferredChannel]
 * @returns {"DM" | "EMAIL" | "CALL" | "OTHER"}
 */
function inferFollowUpActionType(artist, preferredChannel = null) {
  if (preferredChannel === "call") return "CALL";
  if (preferredChannel === "email" && (artist?.emails?.length ?? 0) > 0) return "EMAIL";
  if (preferredChannel === "ig" && artist?.instagramHandle) return "DM";
  if (artist?.instagramHandle) return "DM";
  if ((artist?.emails?.length ?? 0) > 0) return "EMAIL";
  return "OTHER";
}

/**
 * Determines which step index an enrollment should start on.
 * When enrolling immediately after sending initial outreach, skips dayOffset === 0
 * so the lead advances to the first true follow-up step instead of duplicating initial contact.
 *
 * @param {Array<{ dayOffset?: number }>} steps
 * @param {{ afterOutboundSend?: boolean }} [options]
 * @returns {number}
 */
function resolveInitialStepIndex(steps, options = {}) {
  if (!Array.isArray(steps) || steps.length === 0) return 0;
  if (options.afterOutboundSend && Number(steps[0]?.dayOffset ?? 0) === 0 && steps.length > 1) {
    return 1;
  }
  return 0;
}

/**
 * Computes the due Date for a given sequence step.
 * ForNOT_NOW re-engagement or custom base timestamps, offsets from startedAt.
 *
 * @param {Date | string | number} startedAt
 * @param {{ dayOffset?: number }} step
 * @returns {Date}
 */
function computeStepDueDate(startedAt, step) {
  const base = startedAt instanceof Date ? startedAt.getTime() : new Date(startedAt).getTime();
  const offsetDays = Math.max(0, Number(step?.dayOffset) || 0);
  return new Date(base + offsetDays * 86400000);
}

/**
 * Generates personalized, ready-to-review IG DM and/or Email follow-up drafts
 * for a sequence step without placeholder stubs.
 *
 * @param {{
 *   artistName: string;
 *   instagramHandle?: string | null;
 *   emails?: string[] | null;
 *   followerCount?: number | null;
 *   genre?: string | null;
 *   latestReleaseTitle?: string | null;
 *   upcomingVenue?: string | null;
 *   bookingUrl?: string | null;
 *   sequenceName: string;
 *   stepIndex: number;
 *   totalSteps: number;
 *   step: { dayOffset: number; tone: string; promptHint: string };
 * }} ctx
 * @returns {Array<{ channel: "ig" | "email"; tone: string; body: string; source: string }>}
 */
function buildSequenceStepDrafts(ctx) {
  const name = (ctx.artistName || "there").trim();
  const hasIg = Boolean(ctx.instagramHandle);
  const hasEmail = (ctx.emails?.length ?? 0) > 0;
  const isPortfolioFit = isLowFollowerArtist({ followerCount: ctx.followerCount });
  const releaseRef = ctx.latestReleaseTitle ? `"${ctx.latestReleaseTitle}"` : null;
  const showRef = ctx.upcomingVenue ? `your upcoming set at ${ctx.upcomingVenue}` : null;
  const musicHook = releaseRef
    ? `spinning ${releaseRef}`
    : showRef
      ? `seeing ${showRef}`
      : ctx.genre
        ? `checking out your ${ctx.genre.toLowerCase()} material`
        : "checking out your music";

  const toneLower = (ctx.step?.tone || "Follow-up").toLowerCase();
  const isFinal =
    ctx.stepIndex >= ctx.totalSteps - 1 ||
    /final|last|close/i.test(toneLower);
  const isPricing = /pricing|rate|value/i.test(toneLower) || /pricing/i.test(ctx.sequenceName);
  const isConsultation = /session|scope|booking|hold/i.test(toneLower);
  const isReactivation = /reactivat|reconnect/i.test(toneLower);

  let igBody = "";
  let emailSubject = "";
  let emailBody = "";

  if (isPricing) {
    if (isFinal) {
      igBody =
        `Hey ${name} — wanted to follow up one last time on rates in case you're lining up mixes soon. ` +
        `Happy to start with a single track so you can hear how it translates in your monitors before committing to anything bigger. ` +
        (ctx.bookingUrl ? `If you want to talk scope, grab a quick slot anytime: ${ctx.bookingUrl}` : `Just say the word if you want to bounce ideas — Kasper (Spectral Soundworks)`);
      emailSubject = `Starting with a single track — ${name} x Spectral Soundworks`;
      emailBody =
        `Subject: ${emailSubject}\n\n` +
        `Hey ${name},\n\n` +
        `Following up briefly on studio rates and project scope. If you have new material queued up${releaseRef ? ` after ${releaseRef}` : ""}, starting with a single song is always the easiest way to hear the mix and master translation firsthand.\n\n` +
        (ctx.bookingUrl ? `Feel free to grab a quick 15-min call whenever timing feels right:\n${ctx.bookingUrl}\n\n` : "") +
        `Best,\nKasper\nSpectral Soundworks (Austin, TX)`;
    } else {
      igBody =
        `Hey ${name} — circling back on the studio rates I sent over! ` +
        `Whether you need a single mix/master ($350 bundle) or custom stem work, happy to tailor around your release timeline. ` +
        (ctx.bookingUrl ? `Want to hop on a quick call this week? ${ctx.bookingUrl}` : `Any questions on turnaround or stem prep, just let me know!`);
      emailSubject = `Quick follow-up on mix/master rates for ${name}`;
      emailBody =
        `Subject: ${emailSubject}\n\n` +
        `Hey ${name},\n\n` +
        `Wanted to gently follow up on the pricing details and see what kind of timeline you're working toward. Happy to customize a single-track mix ($250), master ($85), or full mix + master bundle ($350) around your release schedule.\n\n` +
        (ctx.bookingUrl ? `If it helps to talk through your rough mixes for 15 minutes, grab a time here:\n${ctx.bookingUrl}\n\n` : "") +
        `Best,\nKasper\nSpectral Soundworks`;
    }
  } else if (isConsultation) {
    igBody =
      `Hey ${name} — stoked you're down to connect! ` +
      (isPortfolioFit
        ? `I'd love to lock in that complimentary first-song recording, mix, and master (at no cost, with unlimited revisions in our agreed song scope). `
        : `Would love to hear what you're working on next${releaseRef ? ` following ${releaseRef}` : ""}. `) +
      (ctx.bookingUrl
        ? `Grab a quick time that works for you here so we can map out the track: ${ctx.bookingUrl}`
        : `Send over a rough demo or let me know a good time for a quick call this week!`);
    emailSubject = `Locking in your session — ${name} x Spectral Soundworks`;
    emailBody =
      `Subject: ${emailSubject}\n\n` +
      `Hey ${name},\n\n` +
      `Great hearing back from you! ` +
      (isPortfolioFit
        ? `As mentioned, I'm offering recording, mixing, and mastering on our first song together completely free (at no cost), with unlimited revisions within the agreed song scope.\n\n`
        : `I'd love to hear the rough demos you're putting together${releaseRef ? ` after ${releaseRef}` : ""} and map out the mix/master approach.\n\n`) +
      (ctx.bookingUrl ? `You can grab a quick slot on my calendar here:\n${ctx.bookingUrl}\n\n` : `Reply with a rough bounce or a couple times that work for a quick call this week.\n\n`) +
      `Talk soon,\nKasper\nSpectral Soundworks`;
  } else if (isReactivation) {
    igBody =
      `Hey ${name} — hope everything's been rolling smoothly! Wanted to check back in after giving you some space since ${musicHook}. ` +
      `Are you tracking or prepping any new singles for the coming months? — Kasper`;
    emailSubject = `Checking back in — new music on deck for ${name}?`;
    emailBody =
      `Subject: ${emailSubject}\n\n` +
      `Hey ${name},\n\n` +
      `Hope things have been going great since we last spoke. Wanted to reconnect warmly and hear how new songs are shaping up${releaseRef ? ` since ${releaseRef}` : ""}.\n\n` +
      `If you have mixes or masters coming up on the horizon, I'd love to listen to where things are headed.\n\n` +
      `Best,\nKasper\nSpectral Soundworks`;
  } else if (isFinal) {
    igBody =
      `Hey ${name} — last quick note from me so I don't crowd your inbox! Really dig what you're doing after ${musicHook}. ` +
      (isPortfolioFit
        ? `Whenever you're ready to put a new song together, the offer for a free first-song recording, mix & master stands. Wishing you a killer run of shows — Kasper`
        : `Whenever you need fresh ears on mixing or mastering down the road, my door's always open. Wishing you a great run ahead — Kasper`);
    emailSubject = `Leaving the door open — ${name} x Spectral Soundworks`;
    emailBody =
      `Subject: ${emailSubject}\n\n` +
      `Hey ${name},\n\n` +
      `Just one final low-pressure note so I'm not crowding your inbox. Really enjoyed ${musicHook}, and ` +
      (isPortfolioFit
        ? `if timing lines up down the road, I'd still love to cover recording, mixing, and mastering on a first song together at no cost.\n\n`
        : `whenever you're lining up mixing or mastering for upcoming releases, feel free to reach out anytime.\n\n`) +
      `All the best,\nKasper\nSpectral Soundworks`;
  } else {
    igBody =
      `Hey ${name} — quick check-in in case my last message got buried! Been ${musicHook} and ` +
      (isPortfolioFit
        ? `wanted to make sure you saw my note about covering recording, mixing, and mastering on a first song together completely free (unlimited revisions in scope). Got any new demos brewing?`
        : `curious if you have any new singles or mixes in the works right now? — Kasper`);
    emailSubject = `Quick check-in — ${name} x Spectral Soundworks`;
    emailBody =
      `Subject: ${emailSubject}\n\n` +
      `Hey ${name},\n\n` +
      `Wanted to float this back to the top of your inbox in case things have been busy! Been ${musicHook}, and ` +
      (isPortfolioFit
        ? `I'm currently taking on select artists for a complimentary first-song collaboration — covering recording, mixing, and mastering at no cost with unlimited revisions in the agreed song scope.\n\n`
        : `wanted to see if you're currently working on new material that needs mixing or mastering.\n\n`) +
      `Are you sitting on any demos or upcoming singles right now?\n\n` +
      `Best,\nKasper\nSpectral Soundworks`;
  }

  const source = `sequence:${ctx.sequenceName}:step${ctx.stepIndex}`;
  const drafts = [];

  if (hasIg || !hasEmail) {
    drafts.push({
      channel: /** @type {"ig"} */ ("ig"),
      tone: `Sequence IG · ${ctx.step.tone}`,
      body: igBody,
      source,
    });
  }
  if (hasEmail) {
    drafts.push({
      channel: /** @type {"email"} */ ("email"),
      tone: `Sequence Email · ${ctx.step.tone}`,
      body: emailBody,
      source,
    });
  }

  return drafts;
}

/**
 * Generates an editable quick-reply template inside /replies based on triaged intent.
 *
 * @param {{
 *   intent: keyof typeof INTENT_STATUS_MAP;
 *   artistName: string;
 *   followerCount?: number | null;
 *   bookingUrl?: string | null;
 *   portalUrl?: string | null;
 * }} ctx
 * @returns {string}
 */
function buildTriageReplySuggestion(ctx) {
  const name = (ctx.artistName || "there").trim();
  const isPortfolioFit = isLowFollowerArtist({ followerCount: ctx.followerCount });
  const bookingLine = ctx.bookingUrl
    ? `Grab a quick 20-min slot that works for you here:\n${ctx.bookingUrl}`
    : `What day this week works for a quick 15-min call?`;

  switch (ctx.intent) {
    case "INTERESTED":
      return isPortfolioFit
        ? `Hey ${name} — awesome to hear from you! As mentioned, your first song gets full recording, mixing, and mastering at no cost (with unlimited revisions in our agreed song scope). Send over a rough demo if you have one, or let's lock in a quick chat to map it out:\n${bookingLine}`
        : `Hey ${name} — awesome to hear from you! Would love to hear the rough tracks and talk through what you're envisioning. ${bookingLine}`;
    case "PRICING_REQUEST":
      return (
        `Hey ${name} — appreciate you asking! Here's how my standard single-track rates break down:\n` +
        `• Complete Mix & Master Bundle: $350\n` +
        `• Standalone Stereo Mix: $250\n` +
        `• Standalone Master: $85\n` +
        (isPortfolioFit
          ? `\nSince we haven't worked together yet, I can also cover your first song completely free as a portfolio collaboration so you can hear the results firsthand.\n\n`
          : `\nHappy to put together EP/bundle pricing too if you have multiple tracks.\n\n`) +
        bookingLine
      );
    case "BOOKED":
      return (
        `Hey ${name} — stoked to get started on this! ` +
        (ctx.portalUrl
          ? `I set up your dedicated Spectral client portal here where you can upload stems/demos, leave timestamped mix notes, and grab deliverables:\n${ctx.portalUrl}\n\n`
          : `I just spun up your project workspace — I'll send your upload & review portal link right over. `) +
        `Looking forward to diving into the track!`
      );
    case "NOT_NOW":
      return `Totally understand, ${name} — appreciate you getting back to me! I'll check back in down the road, and feel free to hit me anytime you're gearing up for the next release.`;
    case "UNCLEAR":
      return `Hey ${name} — thanks for hitting me back! Are you currently working on any new tracks or demos you're planning to release soon?`;
    default:
      return "";
  }
}

/**
 * Builds the Project + starter ProjectInvoice specification when a lead closes (BOOKED / WON).
 *
 * @param {{
 *   artistName: string;
 *   dealType?: "PORTFOLIO_FREE" | "PAID";
 *   packageCode?: string | null;
 *   customTitle?: string | null;
 * }} input
 */
function buildCloseProjectSpec(input) {
  const artistName = (input.artistName || "Artist").trim();
  const dealType = input.dealType === "PAID" ? "PAID" : "PORTFOLIO_FREE";

  if (dealType === "PORTFOLIO_FREE") {
    return {
      dealType: "PORTFOLIO_FREE",
      title: input.customTitle?.trim() || `Portfolio Collaboration — ${artistName} (First Song)`,
      paywallDeliverables: false,
      invoiceStatus: /** @type {"PAID"} */ ("PAID"),
      templateCode: null,
      lineItems: [
        {
          description:
            "Portfolio Collaboration — Complimentary First Song (Recording, Mixing & Mastering, Unlimited Revisions in Agreed Scope)",
          quantity: 1,
          unitPriceCents: 0,
          amountCents: 0,
        },
      ],
      subtotalCents: 0,
      taxCents: 0,
      totalCents: 0,
      notes:
        "Complimentary first-song portfolio collaboration with Spectral Soundworks ($0.00 — deliverables unlocked).",
    };
  }

  const matchedTemplate =
    INVOICE_PACKAGE_TEMPLATES.find((tpl) => tpl.code === input.packageCode) ||
    INVOICE_PACKAGE_TEMPLATES.find((tpl) => tpl.code === "MIX_MASTER_BUNDLE") ||
    INVOICE_PACKAGE_TEMPLATES[0];

  const lineItems = matchedTemplate.lineItems.map((item) => ({
    description: item.description,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    amountCents: item.amountCents,
  }));
  const subtotalCents = lineItems.reduce((sum, item) => sum + item.amountCents, 0);

  return {
    dealType: "PAID",
    title: input.customTitle?.trim() || `${matchedTemplate.name} — ${artistName}`,
    paywallDeliverables: true,
    invoiceStatus: /** @type {"ISSUED"} */ ("ISSUED"),
    templateCode: matchedTemplate.code,
    lineItems,
    subtotalCents,
    taxCents: 0,
    totalCents: subtotalCents,
    notes: `${matchedTemplate.name}: ${matchedTemplate.description}`,
  };
}

module.exports = {
  INTENT_STATUS_MAP,
  DEFAULT_SEQUENCES,
  RECOMMENDED_SEQUENCE_BY_INTENT,
  inferFollowUpActionType,
  resolveInitialStepIndex,
  computeStepDueDate,
  buildSequenceStepDrafts,
  buildTriageReplySuggestion,
  buildCloseProjectSpec,
};
