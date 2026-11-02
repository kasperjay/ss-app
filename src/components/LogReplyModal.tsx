"use client";

import React, { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export interface LogReplyLeadOption {
  id: string;
  status: string;
  artistName: string;
  instagramHandle: string | null;
  email: string | null;
}

type ReplyChannel = "INSTAGRAM_DM" | "EMAIL" | "SMS" | "PHONE" | "IN_PERSON";

export function LogReplyModal({ leads }: { leads: LogReplyLeadOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<string>(leads[0]?.id ?? "");
  const [channel, setChannel] = useState<ReplyChannel>("EMAIL");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return leads.slice(0, 60);
    return leads
      .filter(
        (l) =>
          l.artistName.toLowerCase().includes(q) ||
          (l.instagramHandle && l.instagramHandle.toLowerCase().includes(q)) ||
          (l.email && l.email.toLowerCase().includes(q))
      )
      .slice(0, 60);
  }, [leads, search]);

  const effectiveLeadId = useMemo(() => {
    if (filteredLeads.some((l) => l.id === selectedLeadId)) {
      return selectedLeadId;
    }
    return filteredLeads[0]?.id ?? "";
  }, [filteredLeads, selectedLeadId]);

  const selectedLead = useMemo(
    () => leads.find((l) => l.id === effectiveLeadId) ?? null,
    [leads, effectiveLeadId]
  );

  function handleSelectLead(nextId: string) {
    setSelectedLeadId(nextId);
    const found = leads.find((l) => l.id === nextId);
    if (found) {
      if (found.email && !found.instagramHandle) {
        setChannel("EMAIL");
      } else if (found.instagramHandle && !found.email) {
        setChannel("INSTAGRAM_DM");
      }
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveLeadId) {
      setError("Select an artist lead first.");
      return;
    }
    const trimmed = message.trim();
    if (!trimmed) {
      setError("Paste or summarize the artist's reply.");
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/replies/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leadId: effectiveLeadId,
            channel,
            message: trimmed,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "Failed to log reply.");
          return;
        }
        setMessage("");
        setSearch("");
        setOpen(false);
        router.refresh();
      } catch {
        setError("Network error while logging reply.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="rounded-md bg-[var(--accent)] px-3 py-2 text-xs font-bold text-black hover:opacity-90 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] transition-all"
      >
        + Log Reply
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-[#0d0d12] p-6 shadow-2xl space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/35">
                  Manual Reply Capture
                </p>
                <h2 className="mt-1 text-lg font-bold text-white">
                  Log Inbound Artist Reply
                </h2>
                <p className="mt-0.5 text-xs text-white/45">
                  Pauses any active follow-up sequence and adds the message to Needs Triage.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-bold text-white/50 hover:border-white/20 hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-white/35">
                  Find Artist Lead
                </label>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by artist name, @handle, or email..."
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white placeholder:text-white/25 focus:border-[var(--accent)] focus:outline-none"
                />
                <select
                  value={effectiveLeadId}
                  onChange={(e) => handleSelectLead(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs font-semibold text-white/90 focus:border-[var(--accent)] focus:outline-none"
                >
                  {filteredLeads.length === 0 ? (
                    <option value="" className="bg-[#0d0d12]">
                      No matching leads
                    </option>
                  ) : (
                    filteredLeads.map((lead) => (
                      <option key={lead.id} value={lead.id} className="bg-[#0d0d12] text-white">
                        {lead.artistName}
                        {lead.instagramHandle ? ` (@${lead.instagramHandle.replace(/^@/, "")})` : ""}
                        {` · ${lead.status}`}
                      </option>
                    ))
                  )}
                </select>
                {selectedLead && (
                  <p className="text-[11px] text-white/35">
                    {selectedLead.instagramHandle
                      ? `IG: @${selectedLead.instagramHandle.replace(/^@/, "")}`
                      : "No IG handle"}
                    {" · "}
                    {selectedLead.email ? `Email: ${selectedLead.email}` : "No email on file"}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-white/35 mb-1.5">
                  Channel
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                  {(
                    [
                      { value: "EMAIL", label: "Email" },
                      { value: "INSTAGRAM_DM", label: "IG DM" },
                      { value: "SMS", label: "SMS" },
                      { value: "PHONE", label: "Phone" },
                      { value: "IN_PERSON", label: "In Person" },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setChannel(item.value)}
                      className={`rounded-md border px-2.5 py-1.5 text-[11px] font-bold transition-all ${
                        channel === item.value
                          ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
                          : "border-white/10 bg-white/3 text-white/50 hover:border-white/20 hover:text-white"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-white/35 mb-1.5">
                  Reply Content
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  placeholder="Paste the artist's email/DM reply or call notes..."
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white/85 placeholder:text-white/25 focus:border-[var(--accent)] focus:outline-none resize-none"
                />
              </div>

              {error && <p className="text-xs font-medium text-rose-400">{error}</p>}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-bold text-white/60 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending || !effectiveLeadId}
                  className="rounded-md bg-[var(--accent)] px-4 py-2 text-xs font-bold text-black hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {isPending ? "Logging..." : "Log & Queue for Triage"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
