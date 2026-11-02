#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * advance-sequences.js
 *
 * Advances enrolled leads through their follow-up sequence steps.
 * For each active LeadSequenceEnrollment whose current step dayOffset has elapsed,
 * generates personalized IG/Email MessageDrafts ready for human review and advances
 * the enrollment and lead follow-up metadata.
 *
 * Usage:
 *   node scripts/advance-sequences.js
 *   node scripts/advance-sequences.js --dry-run
 */

const { withAgentRun, prisma } = require("../src/lib/agent-runner");
const {
  buildSequenceStepDrafts,
  computeStepDueDate,
  inferFollowUpActionType,
} = require("../src/lib/reply-to-close-core");
const { getBestShowContext } = require("../src/lib/show-parser");

const DRY_RUN = process.argv.includes("--dry-run");

function buildCalendarBookingLink({ artistName, artistEmail, artistHandle }) {
  const details = [
    "Booked via Spectral Soundworks.",
    artistHandle ? `Artist IG: @${String(artistHandle).replace(/^@/, "")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `Spectral Session — ${artistName}`,
    details,
  });
  if (artistEmail) {
    params.append("to", String(artistEmail).trim());
  }
  params.set("ctz", Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

async function advanceSequences() {
  const now = new Date();

  const enrollments = await prisma.leadSequenceEnrollment.findMany({
    where: { status: "ACTIVE" },
    include: {
      sequence: true,
      lead: {
        include: {
          artist: {
            select: {
              name: true,
              instagramHandle: true,
              emails: true,
              followerCount: true,
              genre: true,
              releases: {
                orderBy: { releaseDate: "desc" },
                take: 1,
                select: { title: true },
              },
            },
          },
          activities: {
            orderBy: { occurredAt: "desc" },
            take: 15,
            select: { type: true, note: true, occurredAt: true },
          },
        },
      },
    },
  });

  console.log(`📋 Active enrollments: ${enrollments.length}`);

  const results = {
    advanced: 0,
    completed: 0,
    skipped: 0,
    draftsCreated: 0,
    errors: 0,
  };

  for (const enrollment of enrollments) {
    const { lead, sequence } = enrollment;

    if (["WON", "LOST"].includes(lead.status)) {
      if (!DRY_RUN) {
        await prisma.leadSequenceEnrollment.update({
          where: { id: enrollment.id },
          data: { status: "CANCELLED", pausedAt: now },
        });
      }
      console.log(
        `  ⏹  ${lead.artist.name} — lead is ${lead.status}, cancelling enrollment`
      );
      results.skipped++;
      continue;
    }

    const steps = sequence.steps;
    if (!Array.isArray(steps) || steps.length === 0) {
      console.warn(`  ⚠️  Sequence "${sequence.name}" has no steps — skipping`);
      results.skipped++;
      continue;
    }

    const currentStep = enrollment.currentStep;

    if (currentStep >= steps.length) {
      if (!DRY_RUN) {
        await prisma.leadSequenceEnrollment.update({
          where: { id: enrollment.id },
          data: { status: "COMPLETED", completedAt: now },
        });
      }
      console.log(
        `  ✓  ${lead.artist.name} — sequence "${sequence.name}" already completed`
      );
      results.completed++;
      continue;
    }

    const step = steps[currentStep];
    const stepDueAt = computeStepDueDate(enrollment.startedAt, step);

    if (stepDueAt > now) {
      const daysUntil = Math.ceil((stepDueAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      console.log(
        `  ⏳ ${lead.artist.name} — step ${currentStep + 1}/${steps.length} due in ${daysUntil}d (${step.tone})`
      );
      results.skipped++;
      continue;
    }

    console.log(
      `\n  ▶  ${lead.artist.name} — advancing step ${currentStep + 1}/${steps.length}: "${step.tone}"`
    );

    const showContext = getBestShowContext(lead.activities, now);
    const bookingUrl = buildCalendarBookingLink({
      artistName: lead.artist.name,
      artistEmail: lead.artist.emails?.[0] ?? null,
      artistHandle: lead.artist.instagramHandle,
    });

    const drafts = buildSequenceStepDrafts({
      artistName: lead.artist.name,
      instagramHandle: lead.artist.instagramHandle,
      emails: lead.artist.emails,
      followerCount: lead.artist.followerCount,
      genre: lead.artist.genre,
      latestReleaseTitle: lead.artist.releases?.[0]?.title ?? null,
      upcomingVenue: showContext?.upcomingShow?.venue ?? null,
      bookingUrl,
      sequenceName: sequence.name,
      stepIndex: currentStep,
      totalSteps: steps.length,
      step,
    });

    if (!DRY_RUN) {
      try {
        await prisma.$transaction(async (tx) => {
          for (const draft of drafts) {
            await tx.messageDraft.create({
              data: {
                leadId: lead.id,
                tone: draft.tone,
                body: draft.body,
                source: draft.source,
                selected: false,
              },
            });
          }

          const nextStep = currentStep + 1;
          const isLast = nextStep >= steps.length;
          const nextDueAt = !isLast
            ? computeStepDueDate(enrollment.startedAt, steps[nextStep])
            : now;

          await tx.leadSequenceEnrollment.update({
            where: { id: enrollment.id },
            data: {
              currentStep: nextStep,
              status: isLast ? "COMPLETED" : "ACTIVE",
              completedAt: isLast ? now : null,
            },
          });

          await tx.lead.update({
            where: { id: lead.id },
            data: {
              status: lead.status === "CONTACTED" ? "FOLLOW_UP" : lead.status,
              nextActionAt: isLast ? now : nextDueAt,
              followUpActionType: inferFollowUpActionType(lead.artist),
            },
          });

          await tx.activity.create({
            data: {
              leadId: lead.id,
              type: "NOTE",
              note: `[SEQUENCE] "${sequence.name}" step ${nextStep}/${steps.length} ready for review (${step.tone}).`,
              occurredAt: now,
            },
          });

          if (isLast) {
            await tx.activity.create({
              data: {
                leadId: lead.id,
                type: "NOTE",
                note: `[SEQUENCE] "${sequence.name}" completed all ${steps.length} steps.`,
                occurredAt: now,
              },
            });
          }
        });

        results.advanced++;
        results.draftsCreated += drafts.length;
        if (currentStep + 1 >= steps.length) {
          results.completed++;
        }
        console.log(
          `     ✓ ${drafts.length} draft(s) created, enrollment advanced${currentStep + 1 >= steps.length ? " (COMPLETED)" : ""}`
        );
      } catch (err) {
        console.error(`     ✗ Error advancing ${lead.artist.name}:`, err.message);
        results.errors++;
      }
    } else {
      results.advanced++;
      results.draftsCreated += drafts.length;
    }
  }

  return results;
}

withAgentRun("advance-sequences", DRY_RUN ? "dry-run" : "live", advanceSequences)
  .then((results) => {
    console.log("\n📊 Summary:");
    console.log(`   Advanced:       ${results.advanced}`);
    console.log(`   Drafts Created: ${results.draftsCreated}`);
    console.log(`   Completed:      ${results.completed}`);
    console.log(`   Skipped:        ${results.skipped}`);
    console.log(`   Errors:         ${results.errors}`);
    if (DRY_RUN) console.log("\n⚠️  DRY RUN — no changes written.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Fatal:", err.message);
    process.exit(1);
  });
