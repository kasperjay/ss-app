"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { updateArtistGenre } from "@/app/leads/[id]/actions";

interface EditableArtistGenreProps {
  artistId: string;
  initialGenre: string | null;
}

export function EditableArtistGenre({ artistId, initialGenre }: EditableArtistGenreProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [genre, setGenre] = useState(initialGenre || "");
  const [isSaving, setIsSaving] = useState(false);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) inputRef.current?.focus();
  }, [isEditing]);

  const cancel = () => {
    setGenre(initialGenre || "");
    setIsEditing(false);
  };

  const handleSave = async () => {
    const trimmed = genre.trim();
    if (trimmed === (initialGenre || "").trim()) {
      setIsEditing(false);
      return;
    }

    try {
      setIsSaving(true);
      await updateArtistGenre({ artistId, genre: trimmed });
      setGenre(trimmed);
      router.refresh();
      setIsEditing(false);
    } catch (error) {
      console.error("Failed to update artist genre", error);
      cancel();
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") handleSave();
    if (event.key === "Escape") cancel();
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-2 relative z-20">
        <input
          ref={inputRef}
          type="text"
          value={genre}
          placeholder="e.g. indie rock"
          onChange={(event) => setGenre(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isSaving}
          aria-label="Artist genre"
          className="text-xs font-bold uppercase tracking-[0.2em] text-white bg-black/60 border border-white/20 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent transition-all min-w-[180px]"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider bg-accent/20 hover:bg-accent/30 text-accent border border-accent/30 rounded-lg transition-colors"
        >
          {isSaving ? "..." : "Save"}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={isSaving}
          className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-white/50 hover:text-white transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setIsEditing(true)}
      className="group/genre inline-flex items-center gap-1.5 text-left"
      title="Edit Genre"
    >
      <span className={genre ? "text-white/80" : "text-amber-400/80 italic font-normal"}>
        {genre || "Set genre"}
      </span>
      <span className="opacity-0 group-hover/genre:opacity-100 transition-opacity text-white/40 group-hover/genre:text-accent" aria-hidden="true">
        ✎
      </span>
    </button>
  );
}
