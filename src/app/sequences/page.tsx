export const dynamic = "force-dynamic";

import React from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ensureDefaultSequences } from "@/lib/sequence-close-service";
import {
  computeStepDueDate,
  type SequenceStepDef,
} from "@/lib/reply-to-close-core";
import {
  SequencesManager,
  type CandidateEnrollLead,
  type SequenceCardItem,
  type SequenceEnrollmentRow,
} from "@/components/SequencesManager";

async function getSequencesPageData() {
  const now = new Date();
  await ensureDefaultSequences();

  const [sequencesRaw, enrollmentsRaw, candidateLeadsRaw] = await Promise.all([
    prisma.followUpSequence.findMany({
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      include: {
        enrollments: {
          select: { status: true },
        },
      },
    }),
    prisma.leadSequenceEnrollment.findMany({
      orderBy: [{ updatedAt: "desc" }],
      take: 200,
      include: {
        sequence: true,
        lead: {
          select: {
            id: true,
            status: true,
            messages: {
              where: {
                selected: false,
                source: { startsWith: "sequence:" },
              },
              select: { id: true },
            },
            artist: {
              select: {
                name: true,
                instagramHandle: true,
                followerCount: true,
              },
            },
          },
        },
      },
    }),
    prisma.lead.findMany({
      where: { status: { notIn: ["WON", "LOST"] } },
      orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
      take: 200,
      select: {
        id: true,
        status: true,
        artist: {
          select: {
            name: true,
            instagramHandle: true,
            followerCount: true,
          },
        },
      },
    }),
  ]);

  const sequences: SequenceCardItem[] = sequencesRaw.map((seq) => {
    const steps = Array.isArray(seq.steps)
      ? (seq.steps as unknown as SequenceStepDef[])
      : [];
    return {
      id: seq.id,
      name: seq.name,
      description: seq.description,
      isDefault: seq.isDefault,
      steps,
      activeCount: seq.enrollments.filter((e) => e.status === "ACTIVE").length,
      pausedCount: seq.enrollments.filter((e) => e.status === "PAUSED").length,
      completedCount: seq.enrollments.filter((e) => e.status === "COMPLETED")
        .length,
    };
  });

  let dueNowCount = 0;
  let activeEnrollments = 0;
  let pausedEnrollments = 0;

  const enrollments: SequenceEnrollmentRow[] = enrollmentsRaw.map((enr) => {
    const steps = Array.isArray(enr.sequence.steps)
      ? (enr.sequence.steps as unknown as SequenceStepDef[])
      : [];
    const currentStepDef =
      enr.currentStep < steps.length ? steps[enr.currentStep] : null;
    const dueDate = currentStepDef
      ? computeStepDueDate(enr.startedAt, currentStepDef)
      : null;

    const isDueNow =
      enr.status === "ACTIVE" &&
      Boolean(dueDate && dueDate.getTime() <= now.getTime());

    if (enr.status === "ACTIVE") activeEnrollments++;
    if (enr.status === "PAUSED") pausedEnrollments++;
    if (isDueNow) dueNowCount++;

    const dueDateLabel =
      enr.status === "COMPLETED"
        ? "All steps completed"
        : enr.status === "PAUSED"
          ? "Paused"
          : !dueDate
            ? "Unscheduled"
            : isDueNow
              ? `Due now (${dueDate.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })})`
              : `Due ${dueDate.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}`;

    return {
      id: enr.id,
      sequenceId: enr.sequenceId,
      sequenceName: enr.sequence.name,
      status: enr.status,
      currentStep: enr.currentStep,
      totalSteps: steps.length,
      nextStepTone: currentStepDef?.tone ?? null,
      dueDateLabel,
      isDueNow,
      pendingSequenceDrafts: enr.lead.messages.length,
      lead: {
        id: enr.lead.id,
        status: enr.lead.status,
        artistName: enr.lead.artist.name,
        instagramHandle: enr.lead.artist.instagramHandle,
        followerCount: enr.lead.artist.followerCount ?? null,
      },
    };
  });

  const candidateLeads: CandidateEnrollLead[] = candidateLeadsRaw.map((l) => ({
    id: l.id,
    status: l.status,
    artistName: l.artist.name,
    instagramHandle: l.artist.instagramHandle,
    followerCount: l.artist.followerCount ?? null,
  }));

  return {
    sequences,
    enrollments,
    candidateLeads,
    stats: {
      totalSequences: sequences.length,
      activeEnrollments,
      dueNowCount,
      pausedEnrollments,
    },
  };
}

export default async function SequencesPage() {
  const { sequences, enrollments, candidateLeads, stats } =
    await getSequencesPageData();

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.35em] text-white/30 mb-1">
            Outreach Cadences
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">
            Follow-Up Sequences
          </h1>
          <p className="mt-1 text-sm text-white/45">
            Multi-step follow-up cadences that generate personalized IG &amp; Email drafts for human review and auto-pause on reply.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <Link
            href="/replies"
            className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-white/70 hover:text-white hover:border-white/20 transition-colors"
          >
            Reply Inbox
          </Link>
          <Link
            href="/operations"
            className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-white/70 hover:text-white hover:border-white/20 transition-colors"
          >
            Operations Queue
          </Link>
        </div>
      </header>

      <SequencesManager
        sequences={sequences}
        enrollments={enrollments}
        candidateLeads={candidateLeads}
        stats={stats}
      />
    </main>
  );
}
