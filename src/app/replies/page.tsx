export const dynamic = "force-dynamic";

import React from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { buildBookingUrl } from "@/lib/google-calendar";
import { ensureDefaultSequences } from "@/lib/sequence-close-service";
import {
  ReplyTriageCard,
  type ReplyItem,
  type ReplySequenceChoice,
} from "@/components/ReplyTriageCard";
import {
  LogReplyModal,
  type LogReplyLeadOption,
} from "@/components/LogReplyModal";

function formatOccurredLabel(date: Date, nowMs: number): string {
  const diffMs = Math.max(0, nowMs - date.getTime());
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

async function getRepliesPageData(): Promise<{
  untriaged: ReplyItem[];
  triaged: ReplyItem[];
  total: number;
  sequences: ReplySequenceChoice[];
  candidateLeads: LogReplyLeadOption[];
}> {
  const nowMs = Date.now();
  await ensureDefaultSequences();

  const [activities, sequencesRaw, candidateLeadsRaw] = await Promise.all([
    prisma.activity.findMany({
      where: { type: "REPLY_RECEIVED" },
      orderBy: { occurredAt: "desc" },
      take: 100,
      include: {
        lead: {
          select: {
            id: true,
            status: true,
            nextActionAt: true,
            sequenceEnrollments: {
              where: { status: { in: ["ACTIVE", "PAUSED"] } },
              orderBy: { updatedAt: "desc" },
              take: 1,
              include: {
                sequence: {
                  select: { id: true, name: true, steps: true },
                },
              },
            },
            artist: {
              select: {
                id: true,
                name: true,
                instagramHandle: true,
                instagramProfileImageUrl: true,
                followerCount: true,
                emails: true,
                projects: {
                  where: { status: "ACTIVE" },
                  orderBy: { updatedAt: "desc" },
                  take: 1,
                  include: { invoice: true },
                },
              },
            },
          },
        },
        replyTriage: true,
      },
    }),
    prisma.followUpSequence.findMany({
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: { id: true, name: true, isDefault: true, steps: true },
    }),
    prisma.lead.findMany({
      where: { status: { not: "LOST" } },
      orderBy: [{ updatedAt: "desc" }],
      take: 250,
      select: {
        id: true,
        status: true,
        artist: {
          select: {
            name: true,
            instagramHandle: true,
            emails: true,
          },
        },
      },
    }),
  ]);

  const serialize = (a: (typeof activities)[number]): ReplyItem => {
    const activeEnr = a.lead.sequenceEnrollments[0] ?? null;
    const activeEnrSteps =
      activeEnr && Array.isArray(activeEnr.sequence.steps)
        ? activeEnr.sequence.steps.length
        : 0;
    const proj = a.lead.artist.projects[0] ?? null;

    return {
      id: a.id,
      note: a.note,
      occurredAt: a.occurredAt.toISOString(),
      occurredLabel: formatOccurredLabel(a.occurredAt, nowMs),
      bookingUrl: buildBookingUrl({
        artistName: a.lead.artist.name,
        artistEmail: a.lead.artist.emails?.[0] ?? null,
        artistHandle: a.lead.artist.instagramHandle,
      }),
      lead: {
        id: a.lead.id,
        status: a.lead.status as ReplyItem["lead"]["status"],
        nextActionAt: a.lead.nextActionAt?.toISOString() ?? null,
        artist: {
          name: a.lead.artist.name,
          instagramHandle: a.lead.artist.instagramHandle,
          instagramProfileImageUrl:
            a.lead.artist.instagramProfileImageUrl ?? null,
          followerCount: a.lead.artist.followerCount ?? null,
          emails: a.lead.artist.emails ?? [],
        },
      },
      enrollment: activeEnr
        ? {
            id: activeEnr.id,
            sequenceId: activeEnr.sequenceId,
            sequenceName: activeEnr.sequence.name,
            status: activeEnr.status,
            currentStep: activeEnr.currentStep,
            totalSteps: activeEnrSteps,
          }
        : null,
      activeProject: proj
        ? {
            id: proj.id,
            title: proj.title,
            portalToken: proj.portalToken,
            workflowStage: proj.workflowStage,
            invoice: proj.invoice
              ? {
                  invoiceNumber: proj.invoice.invoiceNumber,
                  status: proj.invoice.status,
                  totalCents: proj.invoice.totalCents,
                }
              : null,
          }
        : null,
      replyTriage: a.replyTriage
        ? {
            id: a.replyTriage.id,
            activityId: a.replyTriage.activityId,
            intent: a.replyTriage.intent as NonNullable<
              ReplyItem["replyTriage"]
            >["intent"],
            note: a.replyTriage.note,
            triaged: a.replyTriage.triaged,
            triagedAt: a.replyTriage.triagedAt?.toISOString() ?? null,
          }
        : null,
    };
  };

  const untriaged = activities
    .filter((a) => !a.replyTriage || !a.replyTriage.triaged)
    .map(serialize);

  const triaged = activities
    .filter((a) => a.replyTriage?.triaged === true)
    .map(serialize);

  const sequences: ReplySequenceChoice[] = sequencesRaw.map((seq) => ({
    id: seq.id,
    name: seq.name,
    isDefault: seq.isDefault,
    stepCount: Array.isArray(seq.steps) ? seq.steps.length : 0,
  }));

  const candidateLeads: LogReplyLeadOption[] = candidateLeadsRaw.map((l) => ({
    id: l.id,
    status: l.status,
    artistName: l.artist.name,
    instagramHandle: l.artist.instagramHandle,
    email: l.artist.emails?.[0] ?? null,
  }));

  return {
    untriaged,
    triaged,
    total: activities.length,
    sequences,
    candidateLeads,
  };
}

export default async function RepliesPage() {
  const { untriaged, triaged, total, sequences, candidateLeads } =
    await getRepliesPageData();

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-8">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.35em] text-white/30 mb-1">
            Reply-to-Close Inbox
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">
            Replies
          </h1>
          <p className="mt-1 text-sm text-white/45">
            Classify inbound replies, enroll intent-matched follow-up cadences, or close into a live client portal.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {untriaged.length > 0 && (
            <span className="rounded-md bg-[var(--accent)]/15 border border-[var(--accent)]/40 px-2.5 py-1.5 text-xs font-bold text-[var(--accent)] tabular-nums">
              {untriaged.length} pending
            </span>
          )}
          <LogReplyModal leads={candidateLeads} />
          <Link
            href="/sequences"
            className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-white/70 hover:text-white hover:border-white/20 transition-colors"
          >
            Sequences
          </Link>
          <Link
            href="/operations"
            className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-white/70 hover:text-white hover:border-white/20 transition-colors"
          >
            Operations
          </Link>
        </div>
      </header>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {
            label: "Total Replies",
            value: total,
            color: "text-white",
          },
          {
            label: "Needs Triage",
            value: untriaged.length,
            color: untriaged.length > 0 ? "text-amber-400" : "text-white/40",
          },
          {
            label: "Triaged",
            value: triaged.length,
            color: "text-emerald-400",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-white/8 bg-white/3 px-4 py-3"
          >
            <div className={`text-2xl font-bold tabular-nums ${stat.color}`}>
              {stat.value}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-white/25 mt-0.5">
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* Untriaged section */}
      {untriaged.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
            <h2 className="text-xs font-bold uppercase tracking-[0.25em] text-white/45 tabular-nums">
              Needs Triage ({untriaged.length})
            </h2>
          </div>
          <div className="space-y-3">
            {untriaged.map((item) => (
              <ReplyTriageCard
                key={item.id}
                item={item}
                sequences={sequences}
              />
            ))}
          </div>
        </section>
      ) : (
        <div className="rounded-2xl border border-white/8 bg-white/3 px-6 py-10 text-center">
          <div className="mx-auto mb-3 h-10 w-10 rounded-full bg-emerald-400/10 flex items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-emerald-400"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <p className="text-sm font-bold text-white/50">
            All replies triaged
          </p>
          <p className="text-xs text-white/25 mt-1">
            Incoming IG DM replies arrive automatically, or use + Log Reply to record email/SMS responses.
          </p>
        </div>
      )}

      {/* Triaged section */}
      {triaged.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-[0.25em] text-white/30 tabular-nums">
            Triaged ({triaged.length})
          </h2>
          <div className="space-y-2">
            {triaged.map((item) => (
              <ReplyTriageCard
                key={item.id}
                item={item}
                sequences={sequences}
                initialTriaged={true}
              />
            ))}
          </div>
        </section>
      )}

      {total === 0 && (
        <div className="rounded-2xl border border-white/8 bg-white/3 px-6 py-16 text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-white/5 flex items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-white/20"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <p className="text-sm font-bold text-white/35">No replies logged yet</p>
          <p className="text-xs text-white/20 mt-1 max-w-sm mx-auto">
            Replies from Instagram DMs appear here automatically, or click + Log Reply above to capture email and phone responses.
          </p>
        </div>
      )}
    </main>
  );
}
