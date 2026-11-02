export const dynamic = "force-dynamic";
import React from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import OperationsQueue from "@/components/OperationsQueue";
import {
  buildQueueItem,
  comparePriority,
  isNonLocalWithPastGigOnly,
  QueueItem,
} from "@/lib/priority-queue";

type LeadWithWorkflowMeta = {
  id: string;
  sequenceBadge: string | null;
  sequenceDraftCount: number;
};

function toClientItem(
  item: QueueItem,
  metaById: Map<string, LeadWithWorkflowMeta>
) {
  const meta = metaById.get(item.lead.id);
  return {
    lead: {
      id: item.lead.id,
      status: item.lead.status,
      artist: {
        name: item.lead.artist.name,
        genre: item.lead.artist.genre ?? null,
        followerCount:
          typeof (item.lead.artist as { followerCount?: number | null })
            .followerCount === "number"
            ? (item.lead.artist as { followerCount?: number | null })
                .followerCount ?? null
            : null,
      },
    },
    priority: {
      score: item.priority.score,
      components: item.priority.components,
      reasons: item.priority.reasons,
      topReasons: item.priority.topReasons,
      productionNeed: {
        expired: item.priority.productionNeed.expired,
        needsReview: item.priority.productionNeed.needsReview,
      },
    },
    dueReason: item.dueReason,
    eligibility: { cleanup: item.eligibility.cleanup },
    sequenceBadge: meta?.sequenceBadge ?? null,
    sequenceDraftCount: meta?.sequenceDraftCount ?? 0,
  };
}

async function getOperationsPageData() {
  const now = new Date();
  const [leads, untriagedRepliesCount, activeSequencesCount] =
    await Promise.all([
      prisma.lead.findMany({
        where: { status: { notIn: ["WON", "LOST", "PAUSED"] } },
        include: {
          artist: {
            select: {
              name: true,
              genre: true,
              followerCount: true,
              emails: true,
              instagramHandle: true,
              city: true,
              state: true,
              location: true,
              country: true,
              bio: true,
            },
          },
          activities: {
            select: { type: true, note: true },
          },
          sequenceEnrollments: {
            where: { status: { in: ["ACTIVE", "PAUSED"] } },
            orderBy: { updatedAt: "desc" },
            take: 1,
            include: {
              sequence: { select: { name: true, steps: true } },
            },
          },
          messages: {
            where: {
              selected: false,
              source: { startsWith: "sequence:" },
            },
            select: { id: true },
          },
        },
      }),
      prisma.activity.count({
        where: {
          type: "REPLY_RECEIVED",
          OR: [{ replyTriage: null }, { replyTriage: { triaged: false } }],
        },
      }),
      prisma.leadSequenceEnrollment.count({
        where: { status: "ACTIVE" },
      }),
    ]);

  const metaById = new Map<string, LeadWithWorkflowMeta>();
  for (const lead of leads) {
    const enr = lead.sequenceEnrollments[0] ?? null;
    const totalSteps =
      enr && Array.isArray(enr.sequence.steps) ? enr.sequence.steps.length : 0;
    const sequenceBadge = enr
      ? enr.status === "PAUSED"
        ? `Paused: ${enr.sequence.name}`
        : `${enr.sequence.name} · Step ${Math.min(
            enr.currentStep + 1,
            Math.max(totalSteps, 1)
          )}/${totalSteps}`
      : null;

    metaById.set(lead.id, {
      id: lead.id,
      sequenceBadge,
      sequenceDraftCount: lead.messages.length,
    });
  }

  const activeLeads = leads.filter(
    (lead) =>
      !isNonLocalWithPastGigOnly(
        lead as unknown as Parameters<typeof isNonLocalWithPastGigOnly>[0],
        now
      )
  );

  const outreachItems = activeLeads.map((lead) =>
    buildQueueItem(
      lead as unknown as Parameters<typeof buildQueueItem>[0],
      "outreach",
      now
    )
  );
  const followUpItems = activeLeads.map((lead) =>
    buildQueueItem(
      lead as unknown as Parameters<typeof buildQueueItem>[0],
      "follow-up",
      now
    )
  );

  const outreach = {
    actionable: outreachItems
      .filter((item: QueueItem) => item.eligibility.actionable)
      .sort(comparePriority)
      .map((item) => toClientItem(item, metaById)),
    cleanup: outreachItems
      .filter((item: QueueItem) => !item.eligibility.actionable)
      .map((item) => toClientItem(item, metaById)),
  };
  const followUps = {
    actionable: followUpItems
      .filter((item: QueueItem) => item.eligibility.actionable)
      .sort(comparePriority)
      .map((item) => toClientItem(item, metaById)),
    cleanup: followUpItems
      .filter((item: QueueItem) => !item.eligibility.actionable)
      .map((item) => toClientItem(item, metaById)),
  };

  return {
    outreach,
    followUps,
    untriagedRepliesCount,
    activeSequencesCount,
    updatedAt: now.toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }),
  };
}

export default async function OperationsPage() {
  const {
    outreach,
    followUps,
    untriagedRepliesCount,
    activeSequencesCount,
    updatedAt,
  } = await getOperationsPageData();

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="mb-2 text-4xl font-bold">Operations Queue</h1>
          <p className="text-white/60">
            The next best action across first outreach, due follow-ups, and sequence drafts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            href="/replies"
            className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-white/75 hover:border-white/25 hover:text-white transition-colors tabular-nums"
          >
            Reply Inbox{untriagedRepliesCount > 0 ? ` (${untriagedRepliesCount} pending)` : ""}
          </Link>
          <Link
            href="/sequences"
            className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-white/75 hover:border-white/25 hover:text-white transition-colors tabular-nums"
          >
            Sequences ({activeSequencesCount} active)
          </Link>
        </div>
      </header>
      <OperationsQueue
        outreach={outreach}
        followUps={followUps}
        updatedAt={updatedAt}
      />
    </main>
  );
}
