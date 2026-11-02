"use client";

import React, { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SequenceStepDef } from "@/lib/reply-to-close-core";

export interface SequenceCardItem {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  steps: SequenceStepDef[];
  activeCount: number;
  pausedCount: number;
  completedCount: number;
}

export interface SequenceEnrollmentRow {
  id: string;
  sequenceId: string;
  sequenceName: string;
  status: "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED" | string;
  currentStep: number;
  totalSteps: number;
  nextStepTone: string | null;
  dueDateLabel: string;
  isDueNow: boolean;
  pendingSequenceDrafts: number;
  lead: {
    id: string;
    status: string;
    artistName: string;
    instagramHandle: string | null;
    followerCount: number | null;
  };
}

export interface CandidateEnrollLead {
  id: string;
  status: string;
  artistName: string;
  instagramHandle: string | null;
  followerCount: number | null;
}

interface SequencesManagerProps {
  sequences: SequenceCardItem[];
  enrollments: SequenceEnrollmentRow[];
  candidateLeads: CandidateEnrollLead[];
  stats: {
    totalSequences: number;
    activeEnrollments: number;
    dueNowCount: number;
    pausedEnrollments: number;
  };
}

type StatusFilter = "ALL" | "DUE" | "ACTIVE" | "PAUSED" | "COMPLETED";

export function SequencesManager({
  sequences,
  enrollments,
  candidateLeads,
  stats,
}: SequencesManagerProps) {
  const router = useRouter();
  const [isAdvancePending, startAdvanceTransition] = useTransition();
  const [isCreatePending, startCreateTransition] = useTransition();
  const [isActionPending, startActionTransition] = useTransition();

  const [banner, setBanner] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);

  const [showBuilder, setShowBuilder] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newIsDefault, setNewIsDefault] = useState(false);
  const [newSteps, setNewSteps] = useState<SequenceStepDef[]>([
    {
      dayOffset: 0,
      tone: "Initial touch",
      promptHint: "Open a natural studio conversation referencing a recent song or show.",
    },
    {
      dayOffset: 4,
      tone: "Friendly check-in",
      promptHint: "Keep it brief and low-pressure; ask what they are working on next.",
    },
  ]);

  const [enrollTargetBySeq, setEnrollTargetBySeq] = useState<
    Record<string, string>
  >({});
  const [filter, setFilter] = useState<StatusFilter>("ALL");

  const filteredEnrollments = useMemo(() => {
    return enrollments.filter((row) => {
      if (filter === "ALL") return row.status !== "CANCELLED";
      if (filter === "DUE") return row.status === "ACTIVE" && row.isDueNow;
      return row.status === filter;
    });
  }, [enrollments, filter]);

  function handleRunDueSteps() {
    setBanner(null);
    startAdvanceTransition(async () => {
      try {
        const res = await fetch("/api/sequences/advance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setBanner({
            tone: "error",
            text: data.error ?? "Failed to advance due sequence steps.",
          });
          return;
        }
        const r = data.results ?? {};
        setBanner({
          tone: "ok",
          text: `Processed due steps: ${r.advanced ?? 0} advanced, ${r.draftsCreated ?? 0} draft(s) queued for review, ${r.completed ?? 0} completed.`,
        });
        router.refresh();
      } catch {
        setBanner({
          tone: "error",
          text: "Network error while advancing sequences.",
        });
      }
    });
  }

  function handleAddStepRow() {
    const lastOffset =
      newSteps.length > 0 ? newSteps[newSteps.length - 1].dayOffset : 0;
    setNewSteps((prev) => [
      ...prev,
      {
        dayOffset: lastOffset + 5,
        tone: "Follow-up touch",
        promptHint: "Short, respectful follow-up leaving the door open.",
      },
    ]);
  }

  function handleRemoveStepRow(index: number) {
    if (newSteps.length <= 1) return;
    setNewSteps((prev) => prev.filter((_, idx) => idx !== index));
  }

  function handleStepChange(
    index: number,
    field: keyof SequenceStepDef,
    value: string | number
  ) {
    setNewSteps((prev) =>
      prev.map((step, idx) =>
        idx === index ? { ...step, [field]: value } : step
      )
    );
  }

  function handleCreateSequence(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = newName.trim();
    if (!trimmedName) {
      setBanner({ tone: "error", text: "Sequence name is required." });
      return;
    }

    setBanner(null);
    startCreateTransition(async () => {
      try {
        const res = await fetch("/api/sequences", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: trimmedName,
            description: newDesc.trim() || undefined,
            isDefault: newIsDefault,
            steps: newSteps.map((s) => ({
              dayOffset: Math.max(0, Number(s.dayOffset) || 0),
              tone: s.tone.trim() || "Follow-up",
              promptHint: s.promptHint.trim() || "Follow up naturally.",
            })),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setBanner({
            tone: "error",
            text: data.error ?? "Failed to create sequence.",
          });
          return;
        }
        setNewName("");
        setNewDesc("");
        setNewIsDefault(false);
        setShowBuilder(false);
        setBanner({
          tone: "ok",
          text: `Created sequence "${trimmedName}".`,
        });
        router.refresh();
      } catch {
        setBanner({
          tone: "error",
          text: "Network error while creating sequence.",
        });
      }
    });
  }

  function handleQuickEnroll(sequenceId: string) {
    const chosenLeadId =
      enrollTargetBySeq[sequenceId] ?? candidateLeads[0]?.id ?? "";
    if (!chosenLeadId) return;

    setBanner(null);
    startActionTransition(async () => {
      try {
        const res = await fetch(`/api/sequences/${sequenceId}/enroll`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId: chosenLeadId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setBanner({
            tone: "error",
            text: data.error ?? "Failed to enroll lead.",
          });
          return;
        }
        setBanner({
          tone: "ok",
          text: "Lead enrolled in sequence.",
        });
        router.refresh();
      } catch {
        setBanner({
          tone: "error",
          text: "Network error while enrolling lead.",
        });
      }
    });
  }

  function handleEnrollmentControl(
    sequenceId: string,
    enrollmentId: string,
    action: "PAUSE" | "RESUME" | "CANCEL" | "ADVANCE_NOW"
  ) {
    setBanner(null);
    startActionTransition(async () => {
      try {
        const res = await fetch(`/api/sequences/${sequenceId}/enroll`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enrollmentId, action }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setBanner({
            tone: "error",
            text: data.error ?? "Failed to update enrollment.",
          });
          return;
        }
        setBanner({
          tone: "ok",
          text:
            action === "ADVANCE_NOW"
              ? "Personalized draft generated and queued on lead page."
              : `Enrollment ${action.toLowerCase()}d.`,
        });
        router.refresh();
      } catch {
        setBanner({
          tone: "error",
          text: "Network error while updating enrollment.",
        });
      }
    });
  }

  return (
    <div className="space-y-8">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1 min-w-[280px]">
          {[
            {
              label: "Cadences",
              value: stats.totalSequences,
              color: "text-white",
            },
            {
              label: "Active Leads",
              value: stats.activeEnrollments,
              color: "text-emerald-400",
            },
            {
              label: "Due Now",
              value: stats.dueNowCount,
              color: stats.dueNowCount > 0 ? "text-amber-400" : "text-white/40",
            },
            {
              label: "Paused (Replied)",
              value: stats.pausedEnrollments,
              color: "text-sky-400",
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-white/10 bg-white/3 px-4 py-3"
            >
              <div className={`text-2xl font-bold tabular-nums ${stat.color}`}>
                {stat.value}
              </div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-white/30 mt-0.5">
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isAdvancePending}
            onClick={handleRunDueSteps}
            className="rounded-md bg-[var(--accent)] px-4 py-2.5 text-xs font-bold text-black hover:opacity-90 active:scale-[0.99] disabled:opacity-50 transition-all tabular-nums"
          >
            {isAdvancePending
              ? "Generating Drafts…"
              : `Run Due Steps (${stats.dueNowCount})`}
          </button>
          <button
            type="button"
            onClick={() => setShowBuilder((prev) => !prev)}
            className="rounded-md border border-white/15 bg-white/5 px-3.5 py-2.5 text-xs font-bold text-white/80 hover:border-white/30 hover:text-white transition-colors"
          >
            {showBuilder ? "Close Builder" : "+ New Sequence"}
          </button>
        </div>
      </div>

      {banner && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs font-semibold ${
            banner.tone === "ok"
              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
              : "border-rose-400/30 bg-rose-400/10 text-rose-300"
          }`}
        >
          {banner.text}
        </div>
      )}

      {/* New Sequence Builder */}
      {showBuilder && (
        <form
          onSubmit={handleCreateSequence}
          className="rounded-2xl border border-white/15 bg-white/4 p-6 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-white">
              Create Follow-Up Cadence
            </h2>
            <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer">
              <input
                type="checkbox"
                checked={newIsDefault}
                onChange={(e) => setNewIsDefault(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              Mark as default outreach sequence
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-white/35 mb-1">
                Sequence Name
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Portfolio <5k Follow-Up Cadence"
                className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-xs text-white placeholder:text-white/25 focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-white/35 mb-1">
                Description
              </label>
              <input
                type="text"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="When should this cadence be used?"
                className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-xs text-white placeholder:text-white/25 focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-white/35">
                Steps
              </span>
              <button
                type="button"
                onClick={handleAddStepRow}
                className="rounded border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-white/75 hover:text-white transition-colors"
              >
                + Add Step
              </button>
            </div>

            {newSteps.map((step, idx) => (
              <div
                key={idx}
                className="grid grid-cols-1 sm:grid-cols-12 gap-2 rounded-xl border border-white/10 bg-black/30 p-3 items-start"
              >
                <div className="sm:col-span-2">
                  <label className="block text-[10px] text-white/35 uppercase font-bold mb-1">
                    Day Offset
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={step.dayOffset}
                    onChange={(e) =>
                      handleStepChange(
                        idx,
                        "dayOffset",
                        Number.parseInt(e.target.value || "0", 10)
                      )
                    }
                    className="w-full rounded-md border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-white tabular-nums focus:border-[var(--accent)] focus:outline-none"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-[10px] text-white/35 uppercase font-bold mb-1">
                    Step Tone
                  </label>
                  <input
                    type="text"
                    value={step.tone}
                    onChange={(e) =>
                      handleStepChange(idx, "tone", e.target.value)
                    }
                    className="w-full rounded-md border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-white focus:border-[var(--accent)] focus:outline-none"
                  />
                </div>
                <div className="sm:col-span-6">
                  <label className="block text-[10px] text-white/35 uppercase font-bold mb-1">
                    Guidance / Angle
                  </label>
                  <input
                    type="text"
                    value={step.promptHint}
                    onChange={(e) =>
                      handleStepChange(idx, "promptHint", e.target.value)
                    }
                    className="w-full rounded-md border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-white focus:border-[var(--accent)] focus:outline-none"
                  />
                </div>
                <div className="sm:col-span-1 flex sm:justify-end pt-4">
                  <button
                    type="button"
                    disabled={newSteps.length <= 1}
                    onClick={() => handleRemoveStepRow(idx)}
                    className="rounded border border-rose-500/20 px-2 py-1 text-[11px] font-bold text-rose-300/80 hover:border-rose-500/40 disabled:opacity-30"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowBuilder(false)}
              className="rounded-md border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-bold text-white/60 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isCreatePending}
              className="rounded-md bg-[var(--accent)] px-4 py-2 text-xs font-bold text-black hover:opacity-90 disabled:opacity-50"
            >
              {isCreatePending ? "Creating…" : "Save Sequence"}
            </button>
          </div>
        </form>
      )}

      {/* Cadence Templates Grid */}
      <section className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-[0.25em] text-white/40">
          Configured Cadences
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sequences.map((seq) => {
            const selectedLead =
              enrollTargetBySeq[seq.id] ?? candidateLeads[0]?.id ?? "";
            return (
              <div
                key={seq.id}
                className="rounded-2xl border border-white/10 bg-white/3 p-5 flex flex-col justify-between gap-4"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-bold text-white">
                          {seq.name}
                        </h3>
                        {seq.isDefault && (
                          <span className="rounded border border-[var(--accent)]/35 bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
                            Auto-Default
                          </span>
                        )}
                      </div>
                      {seq.description && (
                        <p className="mt-1 text-xs text-white/45 leading-relaxed">
                          {seq.description}
                        </p>
                      )}
                    </div>
                    <div className="text-right text-[11px] text-white/45 tabular-nums shrink-0">
                      <div>
                        <strong className="text-emerald-300">
                          {seq.activeCount}
                        </strong>{" "}
                        active
                      </div>
                      <div>{seq.pausedCount} paused</div>
                    </div>
                  </div>

                  <div className="space-y-1.5 rounded-xl border border-white/8 bg-black/30 p-3">
                    {seq.steps.map((step, i) => (
                      <div
                        key={i}
                        className="flex items-baseline justify-between gap-3 text-xs"
                      >
                        <span className="font-semibold text-white/80">
                          <span className="text-white/35 font-mono tabular-nums mr-1.5">
                            {i + 1}.
                          </span>
                          {step.tone}
                        </span>
                        <span className="text-[11px] font-mono text-white/40 tabular-nums shrink-0">
                          Day +{step.dayOffset}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {candidateLeads.length > 0 && (
                  <div className="pt-2 border-t border-white/8 flex items-center gap-2">
                    <select
                      value={selectedLead}
                      onChange={(e) =>
                        setEnrollTargetBySeq((prev) => ({
                          ...prev,
                          [seq.id]: e.target.value,
                        }))
                      }
                      className="flex-1 min-w-0 rounded-md border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-white/85 focus:border-[var(--accent)] focus:outline-none"
                    >
                      {candidateLeads.slice(0, 120).map((lead) => (
                        <option
                          key={lead.id}
                          value={lead.id}
                          className="bg-[#0d0d12] text-white"
                        >
                          {lead.artistName}
                          {lead.followerCount !== null &&
                          lead.followerCount < 5000
                            ? ` (<5k · ${lead.followerCount.toLocaleString("en-US")})`
                            : ""}{" "}
                          · {lead.status}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={isActionPending || !selectedLead}
                      onClick={() => handleQuickEnroll(seq.id)}
                      className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-bold text-white/85 hover:border-[var(--accent)]/40 hover:text-[var(--accent)] disabled:opacity-50 transition-colors shrink-0"
                    >
                      Enroll
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Enrollments Table */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xs font-bold uppercase tracking-[0.25em] text-white/40">
            Lead Sequence Enrollments
          </h2>
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { value: "ALL", label: "All Active/History" },
                { value: "DUE", label: `Due Now (${stats.dueNowCount})` },
                { value: "ACTIVE", label: "Active" },
                { value: "PAUSED", label: "Paused" },
                { value: "COMPLETED", label: "Completed" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setFilter(tab.value)}
                className={`rounded-md border px-2.5 py-1 text-[11px] font-bold tabular-nums transition-all ${
                  filter === tab.value
                    ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
                    : "border-white/10 bg-white/3 text-white/45 hover:text-white/80"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {filteredEnrollments.length === 0 ? (
          <div className="rounded-2xl border border-white/8 bg-white/3 px-6 py-10 text-center text-xs text-white/40">
            No sequence enrollments match this filter.
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredEnrollments.map((row) => {
              const isLowFollower =
                row.lead.followerCount !== null &&
                row.lead.followerCount < 5000;
              return (
                <div
                  key={row.id}
                  className="rounded-xl border border-white/10 bg-white/3 p-4 flex flex-wrap items-center justify-between gap-4"
                >
                  <div className="space-y-1 min-w-[220px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/leads/${row.lead.id}`}
                        className="text-sm font-bold text-white hover:text-[var(--accent)] transition-colors"
                      >
                        {row.lead.artistName}
                      </Link>
                      {row.lead.instagramHandle && (
                        <span className="text-[11px] font-mono text-white/35">
                          @{row.lead.instagramHandle.replace(/^@/, "")}
                        </span>
                      )}
                      {isLowFollower && (
                        <span className="rounded border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-1.5 py-0.5 text-[10px] font-bold text-[var(--accent)] tabular-nums">
                          &lt;5k ({row.lead.followerCount?.toLocaleString("en-US")})
                        </span>
                      )}
                      {row.pendingSequenceDrafts > 0 && (
                        <Link
                          href={`/leads/${row.lead.id}`}
                          className="rounded border border-emerald-400/35 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300 hover:bg-emerald-400/20 tabular-nums"
                        >
                          {row.pendingSequenceDrafts} Draft Ready →
                        </Link>
                      )}
                    </div>

                    <div className="text-xs text-white/50 tabular-nums">
                      <strong className="text-white/75">{row.sequenceName}</strong>
                      {" · "}
                      Step {Math.min(row.currentStep + 1, Math.max(row.totalSteps, 1))}/
                      {row.totalSteps}
                      {row.nextStepTone ? ` (${row.nextStepTone})` : ""}
                      {" · "}
                      <span
                        className={
                          row.isDueNow && row.status === "ACTIVE"
                            ? "text-amber-300 font-semibold"
                            : "text-white/40"
                        }
                      >
                        {row.dueDateLabel}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        row.status === "ACTIVE"
                          ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                          : row.status === "PAUSED"
                            ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
                            : "border-white/15 bg-white/5 text-white/50"
                      }`}
                    >
                      {row.status}
                    </span>

                    {row.status === "ACTIVE" && (
                      <button
                        type="button"
                        disabled={isActionPending}
                        onClick={() =>
                          handleEnrollmentControl(
                            row.sequenceId,
                            row.id,
                            "ADVANCE_NOW"
                          )
                        }
                        className="rounded-md border border-[var(--accent)]/35 bg-[var(--accent)]/10 px-2.5 py-1 text-[11px] font-bold text-[var(--accent)] hover:bg-[var(--accent)] hover:text-black disabled:opacity-50 transition-colors"
                      >
                        Generate Draft Now
                      </button>
                    )}

                    {row.status === "ACTIVE" && (
                      <button
                        type="button"
                        disabled={isActionPending}
                        onClick={() =>
                          handleEnrollmentControl(
                            row.sequenceId,
                            row.id,
                            "PAUSE"
                          )
                        }
                        className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-white/70 hover:text-white disabled:opacity-50"
                      >
                        Pause
                      </button>
                    )}

                    {row.status === "PAUSED" && (
                      <button
                        type="button"
                        disabled={isActionPending}
                        onClick={() =>
                          handleEnrollmentControl(
                            row.sequenceId,
                            row.id,
                            "RESUME"
                          )
                        }
                        className="rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-bold text-emerald-300 hover:bg-emerald-400 hover:text-black disabled:opacity-50 transition-colors"
                      >
                        Resume
                      </button>
                    )}

                    {(row.status === "ACTIVE" || row.status === "PAUSED") && (
                      <button
                        type="button"
                        disabled={isActionPending}
                        onClick={() =>
                          handleEnrollmentControl(
                            row.sequenceId,
                            row.id,
                            "CANCEL"
                          )
                        }
                        className="rounded-md border border-rose-500/20 bg-rose-500/5 px-2.5 py-1 text-[11px] font-bold text-rose-300/80 hover:border-rose-500/40 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
