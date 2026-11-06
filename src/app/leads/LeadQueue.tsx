"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const QueueContext = createContext({ ids: [] as string[], skip: (_id: string) => {} });

export function LeadQueue({ view, children }: { view: string; children: ReactNode }) {
  return <QueueState key={view} view={view}>{children}</QueueState>;
}

function QueueState({ view, children }: { view: string; children: ReactNode }) {
  const key = `lead-queue-skipped:${view}`;
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(key) || "[]");
      if (Array.isArray(saved)) setIds(saved.filter((id): id is string => typeof id === "string"));
    } catch { /* Keep the queue usable when browser storage is unavailable. */ }
  }, [key]);

  function save(next: string[]) {
    setIds(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Skips still work for this visit. */ }
  }

  return (
    <QueueContext.Provider value={{ ids, skip: (id) => save([...new Set([...ids, id])]) }}>
      {ids.length > 0 && (
        <div className="relative z-10 flex items-center gap-4 text-sm text-white/60" role="status">
          <span>{ids.length} skipped in this view. No lead records were changed.</span>
          <button type="button" onClick={() => save([])} className="text-accent underline cursor-pointer">Restore skipped</button>
        </div>
      )}
      {children}
    </QueueContext.Provider>
  );
}

export function SkippableLead({ id, name, children }: { id: string; name: string; children: ReactNode }) {
  const { ids, skip } = useContext(QueueContext);
  if (ids.includes(id)) return null;
  return (
    <div>
      <div className="flex justify-end mb-2">
        <button type="button" onClick={() => skip(id)} aria-label={`Skip ${name}`} title="Hide from this view without changing the lead" className="rounded-xl border border-white/15 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white/60 hover:text-accent hover:border-accent/40 cursor-pointer">Skip →</button>
      </div>
      {children}
    </div>
  );
}
