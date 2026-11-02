"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GlassCard } from "@/components/GlassCard";
import { NeonButton } from "@/components/NeonButton";
import {
  computeStepDueDate,
  type CloseDealType,
  type SequenceStepDef,
} from "@/lib/reply-to-close-core";
import {
  convertLeadToProjectAction,
  enrollLeadSequenceAction,
  controlLeadSequenceAction,
} from "@/app/leads/[id]/actions";

export interface SerializedSequenceOption {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  steps: SequenceStepDef[];
}

export interface SerializedLeadEnrollment {
  id: string;
  sequenceId: string;
  currentStep: number;
  startedAt: string;
  completedAt: string | null;
  pausedAt: string | null;
  status: string;
  sequence: {
    id: string;
    name: string;
    steps: SequenceStepDef[];
  };
}

export interface SerializedActiveProject {
  id: string;
  title: string | null;
  portalToken: string;
  workflowStage: string;
  paywallDeliverables: boolean;
  invoice: {
    id: string;
    invoiceNumber: string;
    status: string;
    totalCents: number;
  } | null;
}

export interface LeadWorkflowPanelProps {
  lead: {
    id: string;
    status: string;
    nextActionAt: string | null;
    followUpActionType: string | null;
    artist: {
      name: string;
      followerCount: number | null;
      instagramHandle: string | null;
      emails: string[];
    };
  };
  sequences: SerializedSequenceOption[];
  enrollments: SerializedLeadEnrollment[];
  activeProject: SerializedActiveProject | null;
}

export const STUDIO_PACKAGE_OPTIONS = [
  { code: "MIX_MASTER_BUNDLE", label: "Complete Mix & Master Bundle", priceLabel: "$350" },
  { code: "MIX_SINGLE", label: "Standard Mix Package (Single)", priceLabel: "$250" },
  { code: "MASTER_SINGLE", label: "Dedicated Mastering (Single)", priceLabel: "$85" },
  { code: "VOCAL_TUNING", label: "Vocal Production & Tuning", priceLabel: "$150" },
  { code: "EP_PACKAGE", label: "Full EP Production (5 Tracks)", priceLabel: "$1,400" },
  { code: "ALBUM_PACKAGE", label: "Full Album Production (10 Tracks)", priceLabel: "$2,600" },
] as const;

type LogReplyChannel = "INSTAGRAM_DM" | "EMAIL" | "SMS" | "PHONE" | "IN_PERSON";

function formatCalendarDate(iso: string | Date | null | undefined): string {
  if (!iso) return "Unscheduled";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "Unscheduled";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatStage(stage: string): string {
  return stage
    .toLowerCase()
    .split("_")
    .map((part) => (part[0] ? part[0].toUpperCase() + part.slice(1) : ""))
    .join(" ");
}

export function LeadWorkflowPanel({
  lead,
  sequences,
  enrollments,
  activeProject,
}: LeadWorkflowPanelProps) {
  const router = useRouter();
  const [isSeqPending, startSeqTransition] = useTransition();
  const [isClosePending, startCloseTransition] = useTransition();
  const [isLogPending, startLogTransition] = useTransition();

  const activeOrPaused =
    enrollments.find((e) => e.status === "ACTIVE") ??
    enrollments.find((e) => e.status === "PAUSED") ??
    null;
  const latestCompleted =
    !activeOrPaused ? enrollments.find((e) => e.status === "COMPLETED") ?? null : null;

  const defaultSequenceId =
    sequences.find((s) => s.isDefault)?.id ?? sequences[0]?.id ?? "";
  const [selectedSequenceId, setSelectedSequenceId] = useState<string>(
    activeOrPaused?.sequenceId ?? defaultSequenceId
  );
  const [seqFeedback, setSeqFeedback] = useState<string | null>(null);
  const [seqError, setSeqError] = useState<string | null>(null);

  const isLowFollower =
    lead.artist.followerCount !== null && lead.artist.followerCount < 5000;
  const [dealType, setDealType] = useState<CloseDealType>(
    isLowFollower ? "PORTFOLIO_FREE" : "PAID"
  );
  const [packageCode, setPackageCode] = useState<string>("MIX_MASTER_BUNDLE");
  const [customTitle, setCustomTitle] = useState<string>(activeProject?.title ?? "");
  const [showUpdateScope, setShowUpdateScope] = useState<boolean>(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closeFeedback, setCloseFeedback] = useState<string | null>(null);
  const [copiedPortal, setCopiedPortal] = useState<boolean>(false);
  const [localProject, setLocalProject] = useState<SerializedActiveProject | null>(null);

  const [showLogReply, setShowLogReply] = useState<boolean>(false);
  const [replyChannel, setReplyChannel] = useState<LogReplyChannel>(
    lead.artist.instagramHandle ? "INSTAGRAM_DM" : "EMAIL"
  );
  const [replyText, setReplyText] = useState<string>("");
  const [logError, setLogError] = useState<string | null>(null);
  const [logSuccess, setLogSuccess] = useState<boolean>(false);

  const effectiveProject = localProject ?? activeProject;

  const activeSteps = activeOrPaused?.sequence.steps ?? [];
  const nextStepDef =
    activeOrPaused && activeOrPaused.currentStep < activeSteps.length
      ? activeSteps[activeOrPaused.currentStep]
      : null;
  const computedDueDate =
    activeOrPaused && nextStepDef
      ? computeStepDueDate(activeOrPaused.startedAt, nextStepDef)
      : lead.nextActionAt
        ? new Date(lead.nextActionAt)
        : null;

  function handleEnroll() {
    if (!selectedSequenceId) return;
    setSeqError(null);
    setSeqFeedback(null);
    startSeqTransition(async () => {
      try {
        await enrollLeadSequenceAction({
          leadId: lead.id,
          sequenceId: selectedSequenceId,
        });
        const chosen = sequences.find((s) => s.id === selectedSequenceId);
        setSeqFeedback(`Enrolled in ${chosen?.name ?? "sequence"}.`);
        router.refresh();
      } catch (err) {
        setSeqError(err instanceof Error ? err.message : "Failed to enroll lead.");
      }
    });
  }

  function handleSequenceControl(
    enrollmentId: string,
    action: "PAUSE" | "RESUME" | "CANCEL" | "ADVANCE_NOW"
  ) {
    setSeqError(null);
    setSeqFeedback(null);
    startSeqTransition(async () => {
      try {
        await controlLeadSequenceAction({
          leadId: lead.id,
          enrollmentId,
          action,
        });
        setSeqFeedback(
          action === "ADVANCE_NOW"
            ? "Sequence draft generated — review below in Generated Replies."
            : action === "PAUSE"
              ? "Sequence paused."
              : action === "RESUME"
                ? "Sequence resumed."
                : "Sequence cancelled."
        );
        router.refresh();
      } catch (err) {
        setSeqError(err instanceof Error ? err.message : "Sequence update failed.");
      }
    });
  }

  function handleConvertOrUpdateProject() {
    setCloseError(null);
    setCloseFeedback(null);
    startCloseTransition(async () => {
      try {
        const result = await convertLeadToProjectAction({
          leadId: lead.id,
          dealType,
          packageCode: dealType === "PAID" ? packageCode : null,
          customTitle: customTitle.trim() || undefined,
        });
        setLocalProject({
          id: result.project.id,
          title: result.project.title,
          portalToken: result.project.portalToken,
          workflowStage: result.project.workflowStage,
          paywallDeliverables: result.project.paywallDeliverables,
          invoice: {
            id: result.invoice.id,
            invoiceNumber: result.invoice.invoiceNumber,
            status: result.invoice.status,
            totalCents: result.invoice.totalCents,
          },
        });
        setShowUpdateScope(false);
        setCloseFeedback(
          result.created
            ? "Project workspace & client portal created."
            : "Project deal scope & invoice updated."
        );
        router.refresh();
      } catch (err) {
        setCloseError(
          err instanceof Error ? err.message : "Could not create or update project."
        );
      }
    });
  }

  async function handleCopyPortal(portalToken: string) {
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    const url = `${origin}/portal/${portalToken}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedPortal(true);
      setTimeout(() => setCopiedPortal(false), 2000);
    } catch {
      setCloseError("Clipboard unavailable — copy the portal path manually.");
    }
  }

  function handleLogInboundReply(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = replyText.trim();
    if (!trimmed) {
      setLogError("Paste the artist's reply text first.");
      return;
    }
    setLogError(null);
    setLogSuccess(false);
    startLogTransition(async () => {
      try {
        const res = await fetch("/api/replies/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leadId: lead.id,
            channel: replyChannel,
            message: trimmed,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setLogError(data.error ?? "Failed to log inbound reply.");
          return;
        }
        setReplyText("");
        setLogSuccess(true);
        router.refresh();
      } catch {
        setLogError("Network error while logging reply.");
      }
    });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Card 1: Follow-Up Sequence */}
      <GlassCard className="p-6! bg-white/3 border-white/10 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/35">
              Outreach Automation
            </p>
            <h3 className="mt-1 text-lg font-bold tracking-tight text-white">
              Follow-Up Sequence
            </h3>
          </div>
          <Link
            href="/sequences"
            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white/55 hover:border-accent/30 hover:text-accent transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            All Sequences →
          </Link>
        </div>

        {activeOrPaused ? (
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-bold text-sm text-white">
                {activeOrPaused.sequence.name}
              </div>
              <span
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  activeOrPaused.status === "ACTIVE"
                    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                    : "border-amber-400/30 bg-amber-400/10 text-amber-300"
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {activeOrPaused.status}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/65 tabular-nums">
              <span>
                Step {Math.min(activeOrPaused.currentStep + 1, Math.max(activeSteps.length, 1))} of{" "}
                {activeSteps.length}
                {nextStepDef ? ` · Next: ${nextStepDef.tone}` : ""}
              </span>
              <span className="text-white/45">
                Due {formatCalendarDate(computedDueDate)}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/8">
              {activeOrPaused.status === "ACTIVE" && (
                <button
                  type="button"
                  disabled={isSeqPending}
                  onClick={() => handleSequenceControl(activeOrPaused.id, "ADVANCE_NOW")}
                  className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-accent hover:bg-accent hover:text-black active:scale-[0.99] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-50 transition-all"
                >
                  Generate Due Draft Now
                </button>
              )}

              {activeOrPaused.status === "ACTIVE" ? (
                <button
                  type="button"
                  disabled={isSeqPending}
                  onClick={() => handleSequenceControl(activeOrPaused.id, "PAUSE")}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white/70 hover:border-white/20 hover:text-white active:scale-[0.99] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-50 transition-all"
                >
                  Pause
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isSeqPending}
                  onClick={() => handleSequenceControl(activeOrPaused.id, "RESUME")}
                  className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-300 hover:bg-emerald-400 hover:text-black active:scale-[0.99] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400 disabled:opacity-50 transition-all"
                >
                  Resume
                </button>
              )}

              <button
                type="button"
                disabled={isSeqPending}
                onClick={() => handleSequenceControl(activeOrPaused.id, "CANCEL")}
                className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-rose-300/80 hover:border-rose-500/40 hover:text-rose-200 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-rose-400 disabled:opacity-50 transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/8 bg-black/25 px-4 py-3.5 text-xs text-white/50">
            {latestCompleted ? (
              <span>
                Completed <strong className="text-white/75">{latestCompleted.sequence.name}</strong>{" "}
                on{" "}
                <span className="tabular-nums">
                  {formatCalendarDate(latestCompleted.completedAt)}
                </span>
                . Enroll in another cadence below to continue outreach.
              </span>
            ) : (
              <span>
                Not enrolled in a follow-up cadence yet. Sending an initial message auto-enrolls in
                the default sequence, or pick one manually below.
              </span>
            )}
          </div>
        )}

        <div className="space-y-2">
          <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
            {activeOrPaused ? "Switch / Re-enroll Sequence" : "Enroll in Sequence"}
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              value={selectedSequenceId}
              onChange={(e) => setSelectedSequenceId(e.target.value)}
              disabled={isSeqPending || sequences.length === 0}
              className="flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs font-semibold text-white/85 focus:border-accent focus:outline-none tabular-nums"
            >
              {sequences.map((seq) => (
                <option key={seq.id} value={seq.id} className="bg-[#0f0f13] text-white">
                  {seq.name} ({seq.steps.length} steps{seq.isDefault ? " · Default" : ""})
                </option>
              ))}
            </select>
            <NeonButton
              type="button"
              variant="outline"
              size="sm"
              disabled={isSeqPending || !selectedSequenceId}
              onClick={handleEnroll}
            >
              {isSeqPending ? "Saving..." : activeOrPaused ? "Switch" : "Enroll"}
            </NeonButton>
          </div>
        </div>

        {seqFeedback && (
          <p className="text-xs font-medium text-emerald-300">{seqFeedback}</p>
        )}
        {seqError && (
          <p className="text-xs font-medium text-rose-400">{seqError}</p>
        )}
      </GlassCard>

      {/* Card 2: Reply & Deal Close Handoff */}
      <GlassCard className="p-6! bg-white/3 border-white/10 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/35">
                Reply & Close Handoff
              </p>
              {isLowFollower && (
                <span className="rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent tabular-nums">
                  &lt;5k Priority ({lead.artist.followerCount?.toLocaleString("en-US")})
                </span>
              )}
            </div>
            <h3 className="mt-1 text-lg font-bold tracking-tight text-white">
              {effectiveProject ? "Active Studio Workspace" : "Close Deal → Project & Portal"}
            </h3>
          </div>
          <Link
            href="/replies"
            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white/55 hover:border-accent/30 hover:text-accent transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            Reply Inbox →
          </Link>
        </div>

        {effectiveProject ? (
          <div className="space-y-3">
            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-950/20 p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white truncate">
                    {effectiveProject.title || `Project for ${lead.artist.name}`}
                  </p>
                  <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-white/45">
                    Stage: {formatStage(effectiveProject.workflowStage)}
                  </p>
                </div>
                {effectiveProject.invoice && (
                  <span
                    className={`rounded-md border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider tabular-nums ${
                      effectiveProject.invoice.totalCents === 0 ||
                      effectiveProject.invoice.status === "PAID"
                        ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                        : "border-amber-400/30 bg-amber-400/10 text-amber-300"
                    }`}
                  >
                    {effectiveProject.invoice.totalCents === 0
                      ? "$0.00 Portfolio PAID"
                      : `${formatCents(effectiveProject.invoice.totalCents)} ${effectiveProject.invoice.status}`}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/10">
                <Link
                  href={`/projects/${effectiveProject.id}`}
                  className="inline-flex items-center rounded-lg bg-accent px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-black hover:opacity-90 transition-opacity"
                >
                  Open Project →
                </Link>
                <button
                  type="button"
                  onClick={() => handleCopyPortal(effectiveProject.portalToken)}
                  className="rounded-lg border border-white/15 bg-black/40 px-3 py-1.5 text-[11px] font-bold text-white/80 hover:border-accent/40 hover:text-accent active:scale-[0.99] transition-all font-mono"
                >
                  {copiedPortal
                    ? "Copied Portal URL!"
                    : `Copy /portal/${effectiveProject.portalToken.slice(0, 10)}…`}
                </button>
                <button
                  type="button"
                  onClick={() => setShowUpdateScope((prev) => !prev)}
                  className="ml-auto text-[11px] font-bold uppercase tracking-wider text-white/45 hover:text-white transition-colors"
                >
                  {showUpdateScope ? "Hide Scope" : "Update Deal Scope"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {(!effectiveProject || showUpdateScope) && (
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDealType("PORTFOLIO_FREE")}
                className={`rounded-xl border p-3 text-left transition-all ${
                  dealType === "PORTFOLIO_FREE"
                    ? "border-accent/50 bg-accent/10 text-white"
                    : "border-white/10 bg-white/3 text-white/55 hover:border-white/20 hover:text-white/80"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold">Portfolio Collaboration</span>
                  <span className="text-[11px] font-bold text-accent tabular-nums">$0</span>
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-white/50">
                  Complimentary first song · Unlocks client portal immediately
                </p>
              </button>

              <button
                type="button"
                onClick={() => setDealType("PAID")}
                className={`rounded-xl border p-3 text-left transition-all ${
                  dealType === "PAID"
                    ? "border-accent/50 bg-accent/10 text-white"
                    : "border-white/10 bg-white/3 text-white/55 hover:border-white/20 hover:text-white/80"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold">Paid Studio Package</span>
                  <span className="text-[11px] font-bold text-emerald-300 tabular-nums">
                    Invoice
                  </span>
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-white/50">
                  Issues studio invoice & paywalls final deliverables until paid
                </p>
              </button>
            </div>

            {dealType === "PAID" && (
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-white/35 mb-1">
                  Studio Package
                </label>
                <select
                  value={packageCode}
                  onChange={(e) => setPackageCode(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs font-semibold text-white/85 focus:border-accent focus:outline-none tabular-nums"
                >
                  {STUDIO_PACKAGE_OPTIONS.map((pkg) => (
                    <option key={pkg.code} value={pkg.code} className="bg-[#0f0f13] text-white">
                      {pkg.label} — {pkg.priceLabel}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-white/35 mb-1">
                Project Title <span className="text-white/20">(optional)</span>
              </label>
              <input
                type="text"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder={
                  dealType === "PORTFOLIO_FREE"
                    ? `Portfolio Collaboration — ${lead.artist.name} (First Song)`
                    : `Complete Mix & Master Bundle — ${lead.artist.name}`
                }
                className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white/85 placeholder:text-white/25 focus:border-accent focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end">
              <NeonButton
                type="button"
                variant="lime"
                size="sm"
                disabled={isClosePending}
                onClick={handleConvertOrUpdateProject}
              >
                {isClosePending
                  ? "Provisioning..."
                  : effectiveProject
                    ? "Save Deal Scope"
                    : "Close as WON & Create Workspace"}
              </NeonButton>
            </div>
          </div>
        )}

        {closeFeedback && (
          <p className="text-xs font-medium text-emerald-300">{closeFeedback}</p>
        )}
        {closeError && (
          <p className="text-xs font-medium text-rose-400">{closeError}</p>
        )}

        {/* Compact + Log Inbound Reply toggle */}
        <div className="pt-2 border-t border-white/8">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setShowLogReply((prev) => !prev);
                setLogError(null);
                setLogSuccess(false);
              }}
              className="text-[11px] font-bold uppercase tracking-wider text-white/55 hover:text-accent transition-colors"
            >
              {showLogReply ? "− Hide Reply Logger" : "+ Log Inbound Reply"}
            </button>
            {logSuccess && (
              <Link
                href="/replies"
                className="text-[11px] font-bold text-emerald-300 hover:underline"
              >
                Logged! Triage in /replies →
              </Link>
            )}
          </div>

          {showLogReply && (
            <form onSubmit={handleLogInboundReply} className="mt-3 space-y-2.5">
              <div className="flex items-center gap-2">
                <select
                  value={replyChannel}
                  onChange={(e) => setReplyChannel(e.target.value as LogReplyChannel)}
                  className="rounded-xl border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs font-semibold text-white/80 focus:border-accent focus:outline-none"
                >
                  <option value="INSTAGRAM_DM" className="bg-[#0f0f13]">Instagram DM</option>
                  <option value="EMAIL" className="bg-[#0f0f13]">Email</option>
                  <option value="SMS" className="bg-[#0f0f13]">SMS</option>
                  <option value="PHONE" className="bg-[#0f0f13]">Phone</option>
                  <option value="IN_PERSON" className="bg-[#0f0f13]">In Person</option>
                </select>
                <span className="text-[11px] text-white/35">
                  Auto-pauses active sequence & queues in /replies
                </span>
              </div>
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                rows={2}
                placeholder={`Paste ${lead.artist.name}'s reply...`}
                className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white/85 placeholder:text-white/25 focus:border-accent focus:outline-none resize-none"
              />
              {logError && <p className="text-xs text-rose-400">{logError}</p>}
              <div className="flex justify-end">
                <NeonButton
                  type="submit"
                  variant="outline"
                  size="sm"
                  disabled={isLogPending}
                >
                  {isLogPending ? "Logging..." : "Log Reply"}
                </NeonButton>
              </div>
            </form>
          )}
        </div>
      </GlassCard>
    </div>
  );
}
