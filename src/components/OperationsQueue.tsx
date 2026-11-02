"use client";

import { useState } from "react";
import Link from "next/link";
import { GlassCard } from "@/components/GlassCard";

type QueueRow = {
  lead: {
    id: string;
    status: string;
    artist: {
      name: string;
      genre?: string | null;
      followerCount?: number | null;
    };
  };
  priority: {
    score: number;
    components: { baseScore: number; productionNeed: number };
    reasons: string[];
    topReasons: string[];
    productionNeed: { expired: boolean; needsReview: boolean };
  };
  dueReason: string | null;
  eligibility: { cleanup: string[] };
  sequenceBadge?: string | null;
  sequenceDraftCount?: number;
};

type QueueData = {
  actionable: QueueRow[];
  cleanup: QueueRow[];
};

function QueueSection({
  title,
  description,
  data,
  overdueLabel,
}: {
  title: string;
  description: string;
  data: QueueData;
  overdueLabel?: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-white/55">{description}</p>
        </div>
        <span className="rounded-md border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold text-white/70 tabular-nums">
          {data.actionable.length} actionable
        </span>
      </div>
      {overdueLabel && (
        <p className="text-xs font-medium uppercase tracking-wider text-orange-300 tabular-nums">
          {overdueLabel}
        </p>
      )}
      {data.actionable.length === 0 ? (
        <GlassCard className="p-6 text-center text-white/50">
          Nothing actionable here right now.
        </GlassCard>
      ) : (
        <div className="space-y-4">
          {data.actionable.map((item) => {
            const isExpanded = expanded === item.lead.id;
            const isLowFollower =
              typeof item.lead.artist.followerCount === "number" &&
              item.lead.artist.followerCount < 5000;
            return (
              <GlassCard key={item.lead.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/leads/${item.lead.id}`}
                        className="text-lg font-bold hover:text-[#00FF9D]"
                      >
                        {item.lead.artist.name}
                      </Link>
                      {isLowFollower && (
                        <span className="rounded border border-[#00FF9D]/30 bg-[#00FF9D]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#00FF9D] tabular-nums">
                          &lt;5k ({item.lead.artist.followerCount?.toLocaleString("en-US")})
                        </span>
                      )}
                      {item.sequenceBadge && (
                        <span className="rounded border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/70 tabular-nums">
                          {item.sequenceBadge}
                        </span>
                      )}
                      {(item.sequenceDraftCount ?? 0) > 0 && (
                        <Link
                          href={`/leads/${item.lead.id}`}
                          className="rounded border border-emerald-400/35 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300 hover:bg-emerald-400/20 tabular-nums"
                        >
                          Sequence draft ready ({item.sequenceDraftCount}) →
                        </Link>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-white/55">
                      {item.lead.status} ·{" "}
                      {item.lead.artist.genre || "Genre unknown"}
                    </p>
                    <p className="mt-3 text-sm text-white/75">
                      {item.priority.topReasons.join(" · ")}
                    </p>
                    {item.dueReason && (
                      <p className="mt-2 text-xs font-medium text-orange-300 tabular-nums">
                        {item.dueReason}
                      </p>
                    )}
                  </div>
                  <div className="text-right tabular-nums">
                    <div className="text-2xl font-bold text-[#00FF9D]">
                      {Math.round(item.priority.score)}
                      <span className="text-xs text-white/40">/100</span>
                    </div>
                    <Link
                      href={`/leads/${item.lead.id}`}
                      className="mt-2 inline-block text-xs text-white/50 hover:text-white"
                    >
                      Open lead →
                    </Link>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setExpanded(isExpanded ? null : item.lead.id)}
                  className="mt-4 text-xs font-medium text-white/60 underline decoration-white/20 underline-offset-4 hover:text-white"
                >
                  {isExpanded ? "Hide score details" : "Why this score?"}
                </button>
                {isExpanded && (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/65 tabular-nums">
                    <p>
                      Base lead score:{" "}
                      {Math.round(item.priority.components.baseScore)} points
                    </p>
                    <p>
                      Production need: +
                      {item.priority.components.productionNeed} points
                    </p>
                    {item.priority.productionNeed.needsReview && (
                      <p className="mt-2 text-amber-300">
                        Needs review: production-need evidence is incomplete.
                      </p>
                    )}
                    {item.priority.productionNeed.expired && (
                      <p className="mt-2 text-amber-300">
                        Production-need evidence is stale and contributes no
                        points.
                      </p>
                    )}
                    <ul className="mt-3 list-disc space-y-1 pl-5">
                      {item.priority.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </GlassCard>
            );
          })}
        </div>
      )}
      {data.cleanup.length > 0 && (
        <p className="text-xs text-white/45 tabular-nums">
          {data.cleanup.length} other lead{data.cleanup.length === 1 ? "" : "s"}{" "}
          need cleanup before they can enter this queue.
        </p>
      )}
    </section>
  );
}

export default function OperationsQueue({
  outreach,
  followUps,
  updatedAt,
}: {
  outreach: QueueData;
  followUps: QueueData;
  updatedAt: string;
}) {
  const [tab, setTab] = useState<"outreach" | "follow-ups">("outreach");
  const overdueCount = followUps.actionable.filter((item) =>
    item.dueReason?.includes("overdue")
  ).length;
  return (
    <div className="space-y-8">
      <div className="flex gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-2">
        <button
          type="button"
          onClick={() => setTab("outreach")}
          className={`flex-1 rounded-xl px-4 py-3 text-sm font-semibold tabular-nums ${
            tab === "outreach"
              ? "bg-[#00FF9D] text-black"
              : "text-white/60 hover:text-white"
          }`}
        >
          New Outreach ({outreach.actionable.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("follow-ups")}
          className={`flex-1 rounded-xl px-4 py-3 text-sm font-semibold tabular-nums ${
            tab === "follow-ups"
              ? "bg-[#00FF9D] text-black"
              : "text-white/60 hover:text-white"
          }`}
        >
          Follow-ups ({followUps.actionable.length})
        </button>
      </div>
      {tab === "outreach" ? (
        <QueueSection
          title="New Outreach"
          description="Reachable leads ranked by booking likelihood and approved production need."
          data={outreach}
        />
      ) : (
        <QueueSection
          title="Follow-ups"
          description="Existing next actions and due sequence drafts ranked by booking likelihood."
          data={followUps}
          overdueLabel={
            overdueCount > 0 ? `${overdueCount} overdue` : undefined
          }
        />
      )}
      <p className="text-xs text-white/35 tabular-nums">
        Last updated {updatedAt}
      </p>
    </div>
  );
}
