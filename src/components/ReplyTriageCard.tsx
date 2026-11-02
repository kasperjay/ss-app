"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  RECOMMENDED_SEQUENCE_BY_INTENT,
  buildTriageReplySuggestion,
  type CloseDealType,
} from "@/lib/reply-to-close-core";
import { STUDIO_PACKAGE_OPTIONS } from "@/components/LeadWorkflowPanel";

export type ReplyIntent =
  | "INTERESTED"
  | "NOT_NOW"
  | "PRICING_REQUEST"
  | "WRONG_CONTACT"
  | "UNSUBSCRIBED"
  | "BOOKED"
  | "UNCLEAR";

export type LeadStatus =
  | "NEW"
  | "QUALIFIED"
  | "CONTACTED"
  | "FOLLOW_UP"
  | "WON"
  | "LOST"
  | "PAUSED";

export interface ReplySequenceChoice {
  id: string;
  name: string;
  isDefault: boolean;
  stepCount: number;
}

export interface ReplyTriageData {
  id: string;
  activityId: string;
  intent: ReplyIntent;
  note: string | null;
  triaged: boolean;
  triagedAt: string | null;
}

export interface ReplyProjectSummary {
  id: string;
  title: string | null;
  portalToken: string;
  workflowStage: string;
  invoice: {
    invoiceNumber: string;
    status: string;
    totalCents: number;
  } | null;
}

export interface ReplyEnrollmentSummary {
  id: string;
  sequenceId: string;
  sequenceName: string;
  status: string;
  currentStep: number;
  totalSteps: number;
}

export interface ReplyItem {
  id: string;
  note: string | null;
  occurredAt: string;
  occurredLabel: string;
  bookingUrl: string;
  lead: {
    id: string;
    status: LeadStatus;
    nextActionAt: string | null;
    artist: {
      name: string;
      instagramHandle: string | null;
      instagramProfileImageUrl: string | null;
      followerCount: number | null;
      emails: string[];
    };
  };
  enrollment: ReplyEnrollmentSummary | null;
  activeProject: ReplyProjectSummary | null;
  replyTriage: ReplyTriageData | null;
}

const INTENT_OPTIONS: {
  value: ReplyIntent;
  label: string;
  color: string;
  desc: string;
}[] = [
  {
    value: "INTERESTED",
    label: "Interested",
    color: "text-emerald-400 border-emerald-400/30 bg-emerald-400/10",
    desc: "Ready to talk / wants more info",
  },
  {
    value: "PRICING_REQUEST",
    label: "Pricing",
    color: "text-sky-400 border-sky-400/30 bg-sky-400/10",
    desc: "Asking about rates or availability",
  },
  {
    value: "BOOKED",
    label: "Booked",
    color: "text-emerald-300 border-emerald-300/40 bg-emerald-400/15",
    desc: "Confirmed — close & create project",
  },
  {
    value: "NOT_NOW",
    label: "Not Now",
    color: "text-amber-400 border-amber-400/30 bg-amber-400/10",
    desc: "Interested later — pause 90 days",
  },
  {
    value: "UNCLEAR",
    label: "Unclear",
    color: "text-white/55 border-white/15 bg-white/5",
    desc: "Reply received, clarify next step",
  },
  {
    value: "WRONG_CONTACT",
    label: "Wrong Contact",
    color: "text-rose-400 border-rose-400/30 bg-rose-400/10",
    desc: "Not the right person / artist",
  },
  {
    value: "UNSUBSCRIBED",
    label: "Unsubscribed",
    color: "text-rose-400 border-rose-400/30 bg-rose-400/10",
    desc: "Asked to stop outreach",
  },
];

const INTENT_MAP: Record<ReplyIntent, { label: string; color: string }> =
  Object.fromEntries(
    INTENT_OPTIONS.map((o) => [o.value, { label: o.label, color: o.color }])
  ) as Record<ReplyIntent, { label: string; color: string }>;

const STATUS_COLORS: Record<LeadStatus, string> = {
  NEW: "text-white/40 bg-white/5 border-white/10",
  QUALIFIED: "text-sky-400 bg-sky-400/10 border-sky-400/20",
  CONTACTED: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  FOLLOW_UP: "text-amber-300 bg-amber-400/10 border-amber-400/25",
  WON: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  LOST: "text-rose-400 bg-rose-400/10 border-rose-400/20",
  PAUSED: "text-white/35 bg-white/5 border-white/10",
};

function extractMessageText(note: string | null): { channelBadge: string; body: string } {
  if (!note) return { channelBadge: "Reply", body: "No message content" };
  const igMatch = note.match(/^IG reply from [^:]+:\s*"?(.+?)"?$/s);
  if (igMatch) return { channelBadge: "IG DM", body: igMatch[1].slice(0, 360) };
  const emailMatch = note.match(/^Email reply from [^:]+:\s*"?(.+?)"?$/s);
  if (emailMatch) return { channelBadge: "Email", body: emailMatch[1].slice(0, 360) };
  const genericMatch = note.match(/^([A-Z_]+) reply from [^:]+:\s*"?(.+?)"?$/s);
  if (genericMatch) {
    return {
      channelBadge: genericMatch[1].replace(/_/g, " "),
      body: genericMatch[2].slice(0, 360),
    };
  }
  return { channelBadge: "Reply", body: note.slice(0, 360) };
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

type ReplyDeliveryOption = "draft" | "ig" | "email" | "none";

interface Props {
  item: ReplyItem;
  sequences: ReplySequenceChoice[];
  initialTriaged?: boolean;
}

export function ReplyTriageCard({
  item,
  sequences,
  initialTriaged = false,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [triaged, setTriaged] = useState(
    initialTriaged || item.replyTriage?.triaged === true
  );
  const [selectedIntent, setSelectedIntent] = useState<ReplyIntent | null>(
    item.replyTriage?.intent ?? null
  );
  const [note, setNote] = useState(item.replyTriage?.note ?? "");
  const [nextActionAt, setNextActionAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deliveryFeedback, setDeliveryFeedback] = useState<string | null>(null);
  const [currentStatus, setCurrentStatus] = useState<LeadStatus>(item.lead.status);

  const isLowFollower =
    item.lead.artist.followerCount !== null &&
    item.lead.artist.followerCount < 5000;
  const hasIg = Boolean(item.lead.artist.instagramHandle);
  const hasEmail = item.lead.artist.emails.length > 0;

  const [enrollSequenceId, setEnrollSequenceId] = useState<string>("__NONE__");
  const [dealType, setDealType] = useState<CloseDealType>(
    isLowFollower ? "PORTFOLIO_FREE" : "PAID"
  );
  const [packageCode, setPackageCode] = useState<string>("MIX_MASTER_BUNDLE");
  const [projectTitle, setProjectTitle] = useState<string>(
    item.activeProject?.title ?? ""
  );
  const [replyBody, setReplyBody] = useState<string>("");
  const [deliveryOption, setDeliveryOption] = useState<ReplyDeliveryOption>("draft");
  const [provisionedProject, setProvisionedProject] =
    useState<ReplyProjectSummary | null>(item.activeProject);
  const [provisionedEnrollment, setProvisionedEnrollment] =
    useState<ReplyEnrollmentSummary | null>(item.enrollment);
  const [copiedPortal, setCopiedPortal] = useState(false);

  const canEnrollSequence =
    selectedIntent === "INTERESTED" ||
    selectedIntent === "PRICING_REQUEST" ||
    selectedIntent === "NOT_NOW" ||
    selectedIntent === "UNCLEAR";

  const canComposeReply =
    selectedIntent === "INTERESTED" ||
    selectedIntent === "PRICING_REQUEST" ||
    selectedIntent === "NOT_NOW" ||
    selectedIntent === "UNCLEAR" ||
    selectedIntent === "BOOKED";

  const needsDatePicker =
    selectedIntent === "INTERESTED" ||
    selectedIntent === "PRICING_REQUEST" ||
    selectedIntent === "NOT_NOW";

  function resolveRecommendedSeqId(intent: ReplyIntent): string {
    const recName = RECOMMENDED_SEQUENCE_BY_INTENT[intent];
    if (!recName) return "__NONE__";
    const found = sequences.find((s) => s.name === recName);
    return found ? found.id : "__NONE__";
  }

  function handleTriage(intent: ReplyIntent) {
    setSelectedIntent(intent);
    setError(null);
    setDeliveryFeedback(null);

    setEnrollSequenceId(resolveRecommendedSeqId(intent));

    const suggestion = buildTriageReplySuggestion({
      intent,
      artistName: item.lead.artist.name,
      followerCount: item.lead.artist.followerCount,
      bookingUrl: item.bookingUrl,
      portalUrl: provisionedProject
        ? `/portal/${provisionedProject.portalToken}`
        : null,
    });
    setReplyBody(suggestion);
    setDeliveryOption(suggestion ? "draft" : "none");
  }

  function handleInsertBookingLink() {
    if (!item.bookingUrl) return;
    setReplyBody((prev) =>
      prev.includes(item.bookingUrl)
        ? prev
        : `${prev.trim()}\n\nBook a slot here: ${item.bookingUrl}`.trim()
    );
  }

  async function handleCopyPortal(token: string) {
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    try {
      await navigator.clipboard.writeText(`${origin}/portal/${token}`);
      setCopiedPortal(true);
      setTimeout(() => setCopiedPortal(false), 2000);
    } catch {
      setError("Clipboard unavailable — copy /portal link manually.");
    }
  }

  function handleSubmit() {
    if (!selectedIntent) return;
    setError(null);
    setDeliveryFeedback(null);

    startTransition(async () => {
      try {
        const trimmedReply =
          deliveryOption !== "none" ? replyBody.trim() : "";

        const res = await fetch("/api/replies/triage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            activityId: item.id,
            leadId: item.lead.id,
            intent: selectedIntent,
            note: note.trim() || undefined,
            nextActionAt: nextActionAt
              ? new Date(nextActionAt).toISOString()
              : undefined,
            enrollSequenceId:
              canEnrollSequence && enrollSequenceId !== "__NONE__"
                ? enrollSequenceId
                : null,
            ...(selectedIntent === "BOOKED"
              ? {
                  dealType,
                  packageCode: dealType === "PAID" ? packageCode : null,
                  projectTitle: projectTitle.trim() || undefined,
                }
              : {}),
            ...(trimmedReply
              ? {
                  replyBody: trimmedReply,
                  ...(deliveryOption === "ig" || deliveryOption === "email"
                    ? { sendReplyChannel: deliveryOption }
                    : {}),
                }
              : {}),
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "Failed to save triage.");
          return;
        }

        if (data.lead?.status) {
          setCurrentStatus(data.lead.status);
        }
        if (data.projectHandoff?.project) {
          setProvisionedProject({
            id: data.projectHandoff.project.id,
            title: data.projectHandoff.project.title,
            portalToken: data.projectHandoff.project.portalToken,
            workflowStage: data.projectHandoff.project.workflowStage,
            invoice: data.projectHandoff.invoice
              ? {
                  invoiceNumber: data.projectHandoff.invoice.invoiceNumber,
                  status: data.projectHandoff.invoice.status,
                  totalCents: data.projectHandoff.invoice.totalCents,
                }
              : null,
          });
        }
        if (data.enrollment) {
          const seqMatch = sequences.find(
            (s) => s.id === data.enrollment.sequenceId
          );
          setProvisionedEnrollment({
            id: data.enrollment.id,
            sequenceId: data.enrollment.sequenceId,
            sequenceName: seqMatch?.name ?? "Follow-up sequence",
            status: data.enrollment.status,
            currentStep: data.enrollment.currentStep,
            totalSteps: seqMatch?.stepCount ?? 1,
          });
        }
        if (data.replyWarning) {
          setDeliveryFeedback(data.replyWarning);
        } else if (data.replyDelivery?.mode === "sent") {
          setDeliveryFeedback(
            `Sent reply via ${data.replyDelivery.channel === "email" ? "Email" : "Instagram DM"}.`
          );
        } else if (data.replyDelivery?.mode === "draft_saved") {
          setDeliveryFeedback("Saved reply draft on lead page.");
        }

        setTriaged(true);
        router.refresh();
      } catch {
        setError("Network error. Please try again.");
      }
    });
  }

  const parsedMessage = extractMessageText(item.note);
  const intent = selectedIntent ? INTENT_MAP[selectedIntent] : null;

  if (triaged && selectedIntent) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/3 p-4 space-y-3 transition-all">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="h-9 w-9 shrink-0 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white/50 uppercase">
              {item.lead.artist.name.slice(0, 2)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Link
                  href={`/leads/${item.lead.id}`}
                  className="text-sm font-bold text-white hover:text-[var(--accent)] transition-colors"
                >
                  {item.lead.artist.name}
                </Link>
                {item.lead.artist.instagramHandle && (
                  <span className="text-[11px] text-white/35 font-mono">
                    @{item.lead.artist.instagramHandle.replace(/^@/, "")}
                  </span>
                )}
                {isLowFollower && (
                  <span className="rounded border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-1.5 py-0.5 text-[10px] font-bold text-[var(--accent)] tabular-nums">
                    &lt;5k ({item.lead.artist.followerCount?.toLocaleString("en-US")})
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-white/45 line-clamp-1">
                {parsedMessage.body}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border ${intent?.color}`}
            >
              {intent?.label}
            </span>
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border ${STATUS_COLORS[currentStatus]}`}
            >
              {currentStatus.replace("_", " ")}
            </span>
            <button
              type="button"
              onClick={() => setTriaged(false)}
              className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white/50 hover:border-white/20 hover:text-white transition-colors"
            >
              Re-triage
            </button>
          </div>
        </div>

        {(provisionedProject || provisionedEnrollment || deliveryFeedback) && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/8 text-xs">
            {provisionedProject && (
              <>
                <Link
                  href={`/projects/${provisionedProject.id}`}
                  className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-[11px] font-bold text-black hover:opacity-90 transition-opacity"
                >
                  Open Project →
                </Link>
                <button
                  type="button"
                  onClick={() => handleCopyPortal(provisionedProject.portalToken)}
                  className="rounded-md border border-white/15 bg-black/40 px-2.5 py-1 text-[11px] font-mono font-semibold text-white/80 hover:border-[var(--accent)]/40 hover:text-[var(--accent)] transition-colors"
                >
                  {copiedPortal
                    ? "Copied Portal Link!"
                    : `Copy /portal/${provisionedProject.portalToken.slice(0, 8)}…`}
                </button>
                {provisionedProject.invoice && (
                  <span className="text-[11px] text-white/45 tabular-nums">
                    {provisionedProject.invoice.totalCents === 0
                      ? "$0 Portfolio PAID"
                      : `${formatCents(provisionedProject.invoice.totalCents)} ${provisionedProject.invoice.status}`}
                  </span>
                )}
              </>
            )}

            {provisionedEnrollment && provisionedEnrollment.status === "ACTIVE" && (
              <span className="rounded-md border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300 tabular-nums">
                Cadence: {provisionedEnrollment.sequenceName}
              </span>
            )}

            {deliveryFeedback && (
              <span className="text-[11px] text-amber-300/90">
                {deliveryFeedback}
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/4 p-5 space-y-4 transition-all hover:border-white/15">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="h-10 w-10 shrink-0 rounded-full bg-white/10 flex items-center justify-center text-sm font-bold text-white/55 uppercase">
            {item.lead.artist.name.slice(0, 2)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href={`/leads/${item.lead.id}`}
                className="text-sm font-bold text-white hover:text-[var(--accent)] transition-colors"
              >
                {item.lead.artist.name}
              </Link>
              {item.lead.artist.instagramHandle && (
                <span className="text-[11px] text-white/35 font-mono">
                  @{item.lead.artist.instagramHandle.replace(/^@/, "")}
                </span>
              )}
              <span
                className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${STATUS_COLORS[item.lead.status]}`}
              >
                {item.lead.status.replace("_", " ")}
              </span>
              <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/55">
                {parsedMessage.channelBadge}
              </span>
              {isLowFollower && (
                <span className="rounded border border-[var(--accent)]/35 bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--accent)] tabular-nums">
                  &lt;5k Priority ({item.lead.artist.followerCount?.toLocaleString("en-US")})
                </span>
              )}
              {item.enrollment && (
                <span
                  className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider tabular-nums ${
                    item.enrollment.status === "PAUSED"
                      ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
                      : "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                  }`}
                >
                  {item.enrollment.status === "PAUSED"
                    ? `Sequence paused (${item.enrollment.sequenceName})`
                    : `Sequence active (${item.enrollment.currentStep + 1}/${item.enrollment.totalSteps})`}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-white/35 tabular-nums">
              {item.occurredLabel}
            </p>
          </div>
        </div>
      </div>

      {/* Message content */}
      <div className="rounded-xl bg-black/30 border border-white/8 px-4 py-3">
        <p className="text-sm text-white/80 leading-relaxed">
          &ldquo;{parsedMessage.body}&rdquo;
        </p>
      </div>

      {/* Intent buttons */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-white/30 mb-2">
          1. Classify intent
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {INTENT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleTriage(opt.value)}
              className={`rounded-md border px-3 py-2 text-left transition-all ${
                selectedIntent === opt.value
                  ? opt.color + " ring-1 ring-current"
                  : "border-white/8 bg-white/3 text-white/45 hover:border-white/15 hover:text-white/75"
              }`}
            >
              <div className="text-xs font-bold">{opt.label}</div>
              <div className="text-[10px] opacity-75 mt-0.5 leading-tight">
                {opt.desc}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* BOOKED -> Close Deal & Project Provisioning */}
      {selectedIntent === "BOOKED" && (
        <div className="rounded-xl border border-emerald-400/25 bg-emerald-950/20 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">
              2. Close Deal → Project & Client Portal Handoff
            </p>
            {isLowFollower && (
              <span className="text-[10px] font-semibold text-emerald-200/80">
                &lt;5k artist · Portfolio $0 first song pre-selected
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDealType("PORTFOLIO_FREE")}
              className={`rounded-lg border p-3 text-left transition-all ${
                dealType === "PORTFOLIO_FREE"
                  ? "border-emerald-400/60 bg-emerald-400/15 text-white"
                  : "border-white/10 bg-black/30 text-white/55 hover:border-white/20"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold">Portfolio Collaboration</span>
                <span className="text-xs font-bold text-emerald-300 tabular-nums">$0</span>
              </div>
              <p className="mt-1 text-[10px] text-white/55">
                Complimentary first song · PAID $0 invoice · Portal unlocked
              </p>
            </button>

            <button
              type="button"
              onClick={() => setDealType("PAID")}
              className={`rounded-lg border p-3 text-left transition-all ${
                dealType === "PAID"
                  ? "border-emerald-400/60 bg-emerald-400/15 text-white"
                  : "border-white/10 bg-black/30 text-white/55 hover:border-white/20"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold">Paid Studio Package</span>
                <span className="text-xs font-bold text-amber-300">ISSUED</span>
              </div>
              <p className="mt-1 text-[10px] text-white/55">
                Generates studio invoice & paywalls final bounces until paid
              </p>
            </button>
          </div>

          {dealType === "PAID" && (
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-white/35 mb-1">
                Studio Package
              </label>
              <select
                value={packageCode}
                onChange={(e) => setPackageCode(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-xs font-semibold text-white/90 focus:border-[var(--accent)] focus:outline-none tabular-nums"
              >
                {STUDIO_PACKAGE_OPTIONS.map((pkg) => (
                  <option key={pkg.code} value={pkg.code} className="bg-[#0d0d12] text-white">
                    {pkg.label} — {pkg.priceLabel}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-white/35 mb-1">
              Project Title <span className="text-white/20">(optional)</span>
            </label>
            <input
              type="text"
              value={projectTitle}
              onChange={(e) => setProjectTitle(e.target.value)}
              placeholder={
                dealType === "PORTFOLIO_FREE"
                  ? `Portfolio Collaboration — ${item.lead.artist.name} (First Song)`
                  : `Complete Mix & Master Bundle — ${item.lead.artist.name}`
              }
              className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-xs text-white/85 placeholder:text-white/25 focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
        </div>
      )}

      {/* Sequence Enrollment selector for non-terminal intents */}
      {canEnrollSequence && sequences.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-black/25 p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-white/40">
              2. Follow-Up Cadence
            </label>
            {RECOMMENDED_SEQUENCE_BY_INTENT[selectedIntent] && (
              <span className="text-[10px] text-[var(--accent)] font-semibold">
                Recommended: {RECOMMENDED_SEQUENCE_BY_INTENT[selectedIntent]}
              </span>
            )}
          </div>
          <select
            value={enrollSequenceId}
            onChange={(e) => setEnrollSequenceId(e.target.value)}
            className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-xs font-semibold text-white/85 focus:border-[var(--accent)] focus:outline-none tabular-nums"
          >
            <option value="__NONE__" className="bg-[#0d0d12] text-white/70">
              Do not enroll in a sequence (manual follow-up only)
            </option>
            {sequences.map((seq) => (
              <option key={seq.id} value={seq.id} className="bg-[#0d0d12] text-white">
                {seq.name} ({seq.stepCount} steps)
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Quick Reply Composer */}
      {canComposeReply && (
        <div className="rounded-xl border border-white/10 bg-black/25 p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">
              {selectedIntent === "BOOKED"
                ? "3. Kickoff Reply (optional)"
                : "3. Suggested Reply"}
            </span>
            <button
              type="button"
              onClick={handleInsertBookingLink}
              className="rounded border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-bold text-white/75 hover:border-[var(--accent)]/40 hover:text-[var(--accent)] transition-colors"
            >
              + Booking Link
            </button>
          </div>

          <textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            rows={3}
            placeholder="Write a reply or leave blank..."
            className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-xs text-white/85 placeholder:text-white/25 focus:border-[var(--accent)] focus:outline-none resize-y"
          />

          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { value: "draft", label: "Queue Draft on Lead", enabled: true },
                { value: "ig", label: "Send via IG DM", enabled: hasIg },
                { value: "email", label: "Send via Email", enabled: hasEmail },
                { value: "none", label: "Skip Reply", enabled: true },
              ] as const
            )
              .filter((opt) => opt.enabled)
              .map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDeliveryOption(opt.value)}
                  className={`rounded-md border px-2.5 py-1 text-[11px] font-bold transition-all ${
                    deliveryOption === opt.value
                      ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
                      : "border-white/10 bg-white/3 text-white/45 hover:border-white/20 hover:text-white/75"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Date + internal note fields */}
      {selectedIntent && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          {needsDatePicker && (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-white/30 block mb-1.5">
                Next action date{" "}
                <span className="text-white/20">(optional)</span>
              </label>
              <input
                type="datetime-local"
                value={nextActionAt}
                onChange={(e) => setNextActionAt(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/85 focus:border-[var(--accent)] focus:outline-none tabular-nums"
              />
            </div>
          )}
          <div className={needsDatePicker ? "" : "sm:col-span-2"}>
            <label className="text-[10px] font-bold uppercase tracking-wider text-white/30 block mb-1.5">
              Internal triage note{" "}
              <span className="text-white/20">(optional)</span>
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Internal context (stems ETA, rate quoted, target release date)..."
              rows={2}
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/85 placeholder:text-white/25 focus:border-[var(--accent)] focus:outline-none resize-none"
            />
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-rose-400 font-medium">{error}</p>
      )}

      {selectedIntent && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-[11px] text-white/35">
            Sets lead to{" "}
            <strong className="text-white/70">
              {selectedIntent === "INTERESTED" ||
              selectedIntent === "PRICING_REQUEST" ||
              selectedIntent === "UNCLEAR"
                ? "FOLLOW UP"
                : selectedIntent === "NOT_NOW"
                  ? "PAUSED"
                  : selectedIntent === "BOOKED"
                    ? "WON + Active Project"
                    : "LOST"}
            </strong>
          </p>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className="rounded-md bg-[var(--accent)] px-4 py-2 text-xs font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isPending
              ? "Saving…"
              : selectedIntent === "BOOKED"
                ? "Close & Create Project"
                : "Save Triage"}
          </button>
        </div>
      )}
    </div>
  );
}
