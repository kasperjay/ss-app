export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { LeadStatus } from "local-prisma-client";
import DraftCopy from "./DraftCopy";
import SendMessageModal from "./SendMessageModal";
import SendCalendarLinkModal from "./SendCalendarLinkModal";
import { GlassCard } from "@/components/GlassCard";
import { NeonButton } from "@/components/NeonButton";
import { StatusPill } from "@/components/StatusPill";
import { DynamicThemeShell } from "@/components/DynamicThemeShell";
import { EditableArtistName } from "@/components/EditableArtistName";
import { EditableArtistLocation } from "@/components/EditableArtistLocation";
import { EditableSpotifyProfile } from "@/components/EditableSpotifyProfile";
import LeadBottomNavigation from "@/components/LeadBottomNavigation";
import { LeadWorkflowPanel } from "@/components/LeadWorkflowPanel";
import {
  generateDraftsForLead,
  refreshLeadData,
  regenerateDraft,
  regenerateAllDrafts,
  updateLeadStatus,
} from "./actions";
import { buildBookingUrl } from "@/lib/google-calendar";
import { ensureDefaultSequences } from "@/lib/sequence-close-service";
import type { SequenceStepDef } from "@/lib/reply-to-close-core";

const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const formatRelativeDate = (date: Date | null | undefined) => {
  if (!date) return "Unknown";
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (Math.abs(diffDays) < 7) return formatter.format(diffDays, "day");
  const diffWeeks = Math.round(diffDays / 7);
  if (Math.abs(diffWeeks) < 5) return formatter.format(diffWeeks, "week");
  const diffMonths = Math.round(diffDays / 30);
  return formatter.format(diffMonths, "month");
};

const formatStatusLabel = (status: string) => {
  if (status === "PAUSED") return "Paused / Ignore";
  return status
    .toLowerCase()
    .split("_")
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
};

const proxiedHelper = (url: string | null) => {
  if (!url) return undefined;
  // Proxy Instagram through the server since the server can reach Instagram CDN
  // even when browsers get blocked. Always proxy Instagram URLs.
  const isInstagram = url.includes("cdninstagram.com") || url.includes("instagram.com") || url.includes("fbcdn.net");
  if (isInstagram) {
    return `/api/proxy?url=${encodeURIComponent(url)}`;
  }
  // Spotify and other CDNs go through proxy for CORS / header handling
  const needsProxy = [
    "fbcdn.net", "instagram.com", "fbsbx.com", "cdninstagram.com",
    "scdn.co", "spotifycdn.com", "i.scdn.co",
  ].some((d) => url.includes(d));
  if (needsProxy) {
    return `/api/proxy?url=${encodeURIComponent(url)}`;
  }
  return undefined;
};

const statusOptions: LeadStatus[] = ["NEW", "QUALIFIED", "CONTACTED", "FOLLOW_UP", "WON", "LOST", "PAUSED"];

type LeadDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ rPage?: string; pPage?: string; igPage?: string; emailPage?: string }>;
};

const parsePage = (value?: string) => {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isNaN(parsed) || parsed < 1 ? 1 : parsed;
};

function hrefWith(params: {
  rPage: number;
  pPage: number;
  igPage: number;
  emailPage: number;
}) {
  const search = new URLSearchParams({
    rPage: String(params.rPage),
    pPage: String(params.pPage),
    igPage: String(params.igPage),
    emailPage: String(params.emailPage),
  });
  return `?${search.toString()}`;
}

export default async function LeadDetailPage({ params, searchParams }: LeadDetailPageProps) {
  const { id } = await params;
  const { rPage, pPage, igPage, emailPage } = await searchParams;

  const releasePage = parsePage(rPage);
  const postPage = parsePage(pPage);
  const igDraftPage = parsePage(igPage);
  const emailDraftPage = parsePage(emailPage);

  const releasePageSize = 1;
  const postPageSize = 10;
  const draftPageSize = 2;

  const leadRecord = await prisma.lead.findUnique({
    where: { id },
    include: {
      artist: true,
      messages: { orderBy: { createdAt: "desc" } },
      activities: { orderBy: { occurredAt: "desc" } },
    },
  });

  if (!leadRecord) notFound();
  let lead = leadRecord;

  const hasReachoutDraft = lead.messages.some((message) => message.source === "reachout");
  const canGenerateDrafts = lead.status === "NEW" || lead.status === "QUALIFIED";
  let draftGenerationError: string | null = null;
  if (!hasReachoutDraft && canGenerateDrafts) {
    try {
      await generateDraftsForLead(lead.id, { shouldRevalidate: false });
      const refreshedLead = await prisma.lead.findUnique({
        where: { id },
        include: {
          artist: true,
          messages: { orderBy: { createdAt: "desc" } },
          activities: { orderBy: { occurredAt: "desc" } },
        },
      });
      if (!refreshedLead) notFound();
      lead = refreshedLead;
    } catch (error) {
      console.error("Automatic draft generation failed", { leadId: lead.id, error });
      draftGenerationError = "Draft generation did not complete. The lead page is still available; use Regenerate All to retry.";
    }
  }

  const bannerRawUrl = lead.artist.spotifyImageUrl ?? lead.artist.instagramProfileImageUrl ?? null;
  const themeImageUrl = bannerRawUrl ? `/api/proxy?url=${encodeURIComponent(bannerRawUrl)}` : null;

  const postWhere = {
    artistId: lead.artist.id,
    imageUrl: { notIn: ["", " "] },
  };

  const releaseWhere = {
    artistId: lead.artist.id,
    OR: [
      { spotifyTrackId: { not: null } },
      { spotifyReleaseId: { not: null } },
      { url: { not: null } },
    ],
  };

  await ensureDefaultSequences();

  const [
    releaseRows,
    postRows,
    releaseCount,
    postCount,
    allLeadsNav,
    sequences,
    enrollments,
    activeProject,
  ] = await Promise.all([
    prisma.release.findMany({
      where: releaseWhere,
      orderBy: [
        { spotifyTrackId: { sort: "desc", nulls: "last" } },
        { spotifyReleaseId: { sort: "desc", nulls: "last" } },
        { releaseDate: "desc" },
        { createdAt: "desc" },
      ],
      skip: (releasePage - 1) * releasePageSize,
      take: releasePageSize,
    }),
    prisma.instagramPost.findMany({
      where: postWhere,
      orderBy: [{ postedAt: "desc" }, { createdAt: "desc" }],
      skip: (postPage - 1) * postPageSize,
      take: postPageSize,
    }),
    prisma.release.count({ where: releaseWhere }),
    prisma.instagramPost.count({ where: postWhere }),
    prisma.lead.findMany({
      where: {
        status: { not: "PAUSED" },
      },
      select: {
        id: true,
        score: true,
        artist: { select: { name: true } },
      },
      orderBy: [{ score: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
    }),
    prisma.followUpSequence.findMany({
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        description: true,
        isDefault: true,
        steps: true,
      },
    }),
    prisma.leadSequenceEnrollment.findMany({
      where: { leadId: lead.id },
      include: { sequence: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.project.findFirst({
      where: { artistId: lead.artist.id, status: "ACTIVE" },
      include: { invoice: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const leadIndex = allLeadsNav.findIndex((l) => l.id === id);
  const prevLead = leadIndex > 0 ? {
    id: allLeadsNav[leadIndex - 1].id,
    name: allLeadsNav[leadIndex - 1].artist.name,
    score: allLeadsNav[leadIndex - 1].score,
  } : null;
  const nextLead = leadIndex >= 0 && leadIndex < allLeadsNav.length - 1 ? {
    id: allLeadsNav[leadIndex + 1].id,
    name: allLeadsNav[leadIndex + 1].artist.name,
    score: allLeadsNav[leadIndex + 1].score,
  } : null;
  const currentIndex = leadIndex >= 0 ? leadIndex : 0;
  const totalLeads = allLeadsNav.length;

  const releaseTotalPages = Math.max(1, Math.ceil(releaseCount / releasePageSize));
  const postTotalPages = Math.max(1, Math.ceil(postCount / postPageSize));
  const featuredRelease = releaseRows[0] ?? null;

  const instagramAvatar = proxiedHelper(lead.artist.instagramProfileImageUrl ?? postRows[0]?.imageUrl ?? null);

  const reachoutDrafts = lead.messages.filter(
    (m) => !m.selected && (m.source === "reachout" || Boolean(m.source?.startsWith("sequence:")))
  );
  const igDrafts = reachoutDrafts.filter((m) => !m.tone?.toLowerCase().includes("email"));
  const emailDrafts = reachoutDrafts.filter((m) => m.tone?.toLowerCase().includes("email"));

  const igDraftTotalPages = Math.max(1, Math.ceil(igDrafts.length / draftPageSize));
  const emailDraftTotalPages = Math.max(1, Math.ceil(emailDrafts.length / draftPageSize));

  const igDraftSlice = igDrafts.slice((igDraftPage - 1) * draftPageSize, igDraftPage * draftPageSize);
  const emailDraftSlice = emailDrafts.slice((emailDraftPage - 1) * draftPageSize, emailDraftPage * draftPageSize);

  const score = lead.score?.toFixed(0) || "0";

  const accentColors = {
    accent: lead.artist.spotifyAccent ?? "#00f2ff",
    accentStrong: lead.artist.spotifyAccentStrong ?? "#7000ff",
    highlight: lead.artist.spotifyHighlight ?? "#ffffff",
  };

  const serializedSequences = sequences.map((seq) => ({
    id: seq.id,
    name: seq.name,
    description: seq.description,
    isDefault: seq.isDefault,
    steps: Array.isArray(seq.steps) ? (seq.steps as unknown as SequenceStepDef[]) : [],
  }));

  const serializedEnrollments = enrollments.map((enr) => ({
    id: enr.id,
    sequenceId: enr.sequenceId,
    currentStep: enr.currentStep,
    startedAt: enr.startedAt.toISOString(),
    completedAt: enr.completedAt?.toISOString() ?? null,
    pausedAt: enr.pausedAt?.toISOString() ?? null,
    status: enr.status,
    sequence: {
      id: enr.sequence.id,
      name: enr.sequence.name,
      steps: Array.isArray(enr.sequence.steps)
        ? (enr.sequence.steps as unknown as SequenceStepDef[])
        : [],
    },
  }));

  const serializedActiveProject = activeProject
    ? {
        id: activeProject.id,
        title: activeProject.title,
        portalToken: activeProject.portalToken,
        workflowStage: activeProject.workflowStage,
        paywallDeliverables: activeProject.paywallDeliverables,
        invoice: activeProject.invoice
          ? {
              id: activeProject.invoice.id,
              invoiceNumber: activeProject.invoice.invoiceNumber,
              status: activeProject.invoice.status,
              totalCents: activeProject.invoice.totalCents,
            }
          : null,
      }
    : null;

  const renderDraftCard = (message: (typeof reachoutDrafts)[number]) => {
    const isSequenceDraft = Boolean(message.source?.startsWith("sequence:"));
    return (
      <GlassCard key={message.id} className="p-6! bg-white/2 border-white/5 hover:border-accent/20">
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-3 py-1 rounded-full bg-accent/10 text-xs font-bold text-accent uppercase tracking-widest border border-accent/20">
                {message.tone || "Draft"}
              </span>
              {isSequenceDraft && (
                <span className="px-2.5 py-1 rounded-md bg-emerald-400/10 text-[10px] font-bold text-emerald-300 uppercase tracking-widest border border-emerald-400/30">
                  Sequence Step
                </span>
              )}
            </div>
            <DraftCopy text={message.body} />
          </div>

          <p className="text-base text-white/80 leading-relaxed font-serif italic pl-4 border-l-2 border-accent/30">
            &quot;{message.body}&quot;
          </p>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-white/5">
            {message.source === "reachout" ? (
              <details className="relative group/details">
                <summary className="list-none cursor-pointer flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/50 hover:text-white transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 8 6 6 6-6" /></svg>
                  Tune Variant
                </summary>
                <div className="absolute left-0 bottom-full mb-4 z-20 w-56 rounded-2xl border border-white/10 bg-[#0f0f13] p-2 shadow-2xl">
                  <div className="group/tone relative">
                    <div className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-widest text-white/50 hover:text-accent hover:bg-white/5 transition-colors cursor-default">
                      Change Tone
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                    </div>
                    <div className="hidden group-hover/tone:block absolute left-full bottom-0 before:content-[''] before:absolute before:top-0 before:-left-3 before:w-3 before:h-full before:z-10 pl-3 w-48 rounded-2xl border border-white/10 bg-[#0f0f13] p-2 shadow-2xl animate-in fade-in slide-in-from-left-2 transition-all">
                      {["professional", "casual"].map((hint) => (
                        <form key={hint} action={regenerateDraft}>
                          <input type="hidden" name="leadId" value={lead.id} />
                          <input type="hidden" name="draftId" value={message.id} />
                          <input type="hidden" name="tone" value={message.tone || "Draft"} />
                          <input type="hidden" name="styleHint" value={`more ${hint}`} />
                          <button type="submit" className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-widest text-white/50 hover:text-accent hover:bg-white/5 transition-colors">
                            more {hint}
                          </button>
                        </form>
                      ))}
                    </div>
                  </div>

                  <div className="group/style relative mt-1">
                    <div className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-widest text-white/50 hover:text-accent hover:bg-white/5 transition-colors cursor-default">
                      Change Style
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                    </div>
                    <div className="hidden group-hover/style:block absolute left-full bottom-0 before:content-[''] before:absolute before:top-0 before:-left-3 before:w-3 before:h-full before:z-10 pl-3 w-48 rounded-2xl border border-white/10 bg-[#0f0f13] p-2 shadow-2xl animate-in fade-in slide-in-from-left-2 transition-all">
                      {["boring", "fun"].map((hint) => (
                        <form key={hint} action={regenerateDraft}>
                          <input type="hidden" name="leadId" value={lead.id} />
                          <input type="hidden" name="draftId" value={message.id} />
                          <input type="hidden" name="tone" value={message.tone || "Draft"} />
                          <input type="hidden" name="styleHint" value={`more ${hint}`} />
                          <button type="submit" className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-widest text-white/50 hover:text-accent hover:bg-white/5 transition-colors">
                            more {hint}
                          </button>
                        </form>
                      ))}
                    </div>
                  </div>
                </div>
              </details>
            ) : (
              <span className="text-[11px] font-semibold text-white/40">
                Ready for review &amp; send
              </span>
            )}

            <SendMessageModal
              leadId={lead.id}
              label="Review + Send"
              defaultBody={message.body}
              source={message.source ?? "draft"}
              tone={message.tone ?? undefined}
              variant="primary"
            />
          </div>
        </div>
      </GlassCard>
    );
  };

  return (
    <DynamicThemeShell imageUrl={themeImageUrl} artistName={lead.artist.name} genre={lead.artist.genre} accentColors={accentColors}>
      <div className="relative min-h-screen pb-20 selection:bg-accent/30 selection:text-white">
        <div className="relative mx-auto flex max-w-7xl flex-col gap-10 px-6 pt-12">
          <div className="relative min-h-[420px] md:h-[480px] w-full rounded-[40px] overflow-hidden group shadow-2xl border border-white/10 bg-zinc-950 flex flex-col justify-between p-6 md:p-10">
            {themeImageUrl && (
              <>
                <img
                  src={themeImageUrl}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 h-full w-full object-cover blur-3xl scale-110 opacity-35 brightness-75 pointer-events-none select-none"
                />
                <img
                  src={themeImageUrl}
                  alt={lead.artist.name}
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.02]"
                  style={{ objectPosition: "center 20%" }}
                  loading="eager"
                />
              </>
            )}
            <div className="absolute inset-0 bg-linear-to-t from-black/95 via-black/40 via-45% to-transparent pointer-events-none" />
            <div className="absolute inset-0 bg-linear-to-r from-black/80 via-black/25 via-50% to-transparent pointer-events-none" />

            {/* Top Navigation Row */}
            <div className="relative z-10 flex items-center justify-between gap-4">
              <Link
                href="/leads"
                className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-white/80 hover:text-white px-4 py-2 rounded-full bg-black/40 border border-white/10 backdrop-blur-md transition-all hover:bg-black/60 hover:border-white/20 shadow-lg"
              >
                <span>← Back</span>
              </Link>
            </div>

            {/* Bottom Artist Info Row */}
            <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6 pt-12">
              <div className="flex items-center gap-5 md:gap-6 min-w-0 max-w-[85%] md:max-w-[70%]">
                {themeImageUrl && (
                  <div className="hidden sm:block h-20 w-20 md:h-24 md:w-24 shrink-0 rounded-2xl md:rounded-3xl overflow-hidden border-2 border-white/20 shadow-2xl bg-zinc-900/60 backdrop-blur-sm">
                    <img
                      src={themeImageUrl}
                      alt={lead.artist.name}
                      className="h-full w-full object-cover"
                      style={{ objectPosition: "center 20%" }}
                    />
                  </div>
                )}
                <div className="space-y-1.5 min-w-0">
                  <div className="text-3xl sm:text-4xl md:text-5xl leading-[1.05] font-black tracking-tight text-white drop-shadow-md" style={{ fontFamily: "var(--font-display)" }}>
                    <EditableArtistName artistId={lead.artist.id} initialName={lead.artist.name} />
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs font-bold uppercase tracking-[0.25em] text-white/70 pt-1">
                    <EditableArtistLocation artistId={lead.artist.id} initialLocation={lead.artist.location} />
                    <span>•</span>
                    <span className="text-white/80">{lead.artist.genre || "Social Profile"}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-start md:items-end gap-2 shrink-0">
                <div className="flex items-baseline gap-1.5 bg-black/50 border border-white/15 rounded-2xl px-5 py-2.5 backdrop-blur-md shadow-xl">
                  <span className="text-3xl font-black text-accent">{score}</span>
                  <span className="text-xs uppercase tracking-widest text-white/50 font-bold">/ 100</span>
                </div>
                {lead.scoreRationale && (
                  <span className="text-[11px] font-medium text-white/70 max-w-[280px] text-left md:text-right truncate drop-shadow-sm" title={lead.scoreRationale}>
                    {lead.scoreRationale}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-10">
            {lead.status === "PAUSED" && (
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-6 py-4 text-xs font-bold uppercase tracking-[0.2em] text-amber-200/80">
                <div className="flex items-center gap-3">
                  <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                  <span>Lead is Paused / Ignored · Completely removed from all active views</span>
                </div>
                <Link href="/leads?status=PAUSED&contact=ALL" className="text-accent hover:underline">
                  View Paused Leads →
                </Link>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/3 px-4 py-3">
              <form
                action={async (formData) => {
                  "use server";
                  const status = formData.get("status");
                  if (typeof status === "string" && statusOptions.includes(status as LeadStatus)) {
                    await updateLeadStatus({ leadId: lead.id, status: status as LeadStatus });
                  }
                }}
                className="flex flex-wrap items-center gap-3"
              >
                <select
                  name="status"
                  defaultValue={lead.status}
                  className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs font-bold uppercase tracking-[0.2em] text-white/70 focus:border-accent focus:outline-none"
                >
                  {statusOptions.map((status) => (
                    <option key={status} value={status} className="bg-[#0f0f0f] text-white">
                      {formatStatusLabel(status)}
                    </option>
                  ))}
                </select>
                <NeonButton variant="outline" size="sm" type="submit">Update Status</NeonButton>
              </form>

              <form action={refreshLeadData}>
                <input type="hidden" name="leadId" value={lead.id} />
                <NeonButton type="submit" variant="outline" size="sm">Update Profile</NeonButton>
              </form>

              <SendCalendarLinkModal
                leadId={lead.id}
                artistName={lead.artist.name}
                bookingUrl={buildBookingUrl({
                  artistName: lead.artist.name,
                  artistEmail: lead.artist.emails?.[0] ?? null,
                  artistHandle: lead.artist.instagramHandle,
                })}
              />

              <div className="ml-auto">
                <StatusPill status={lead.status} />
              </div>
            </div>

            <LeadWorkflowPanel
              lead={{
                id: lead.id,
                status: lead.status,
                nextActionAt: lead.nextActionAt?.toISOString() ?? null,
                followUpActionType: lead.followUpActionType ?? null,
                artist: {
                  name: lead.artist.name,
                  followerCount: lead.artist.followerCount ?? null,
                  instagramHandle: lead.artist.instagramHandle ?? null,
                  emails: lead.artist.emails ?? [],
                },
              }}
              sequences={serializedSequences}
              enrollments={serializedEnrollments}
              activeProject={serializedActiveProject}
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <GlassCard className="p-6! bg-white/2 border-white/5">
                <div className="flex items-start gap-4 mb-6">
                  <div className="h-16 w-16 rounded-2xl overflow-hidden border border-white/10 bg-black/30 shrink-0">
                    {instagramAvatar ? (
                      <img src={instagramAvatar} alt={lead.artist.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-white/20 text-xs font-bold">IG</div>
                    )}
                  </div>
                  <div className="space-y-2 min-w-0">
                    <p className="text-sm font-bold text-white truncate">@{(lead.artist.instagramHandle || "unknown").replace(/^@/, "")}</p>
                    <p className="text-xs text-white/55 leading-relaxed line-clamp-3">{lead.artist.bio || "No Instagram bio available."}</p>
                    <div className="flex flex-wrap items-center gap-3 text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
                      <span>{lead.artist.followerCount?.toLocaleString() || "0"} followers</span>
                      <span>Last post {formatRelativeDate(lead.artist.lastPostAt)}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-[0.25em] text-white/35">Latest Posts</h3>
                    <div className="flex items-center gap-3 text-xs font-bold text-white/35">
                      <form action={refreshLeadData}>
                        <input type="hidden" name="leadId" value={lead.id} />
                        <button
                          type="submit"
                          title="Refresh Instagram data"
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-white/10 bg-white/3 text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-accent hover:border-accent/30 hover:bg-accent/5 transition-all"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 2v6h-6" />
                            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                            <path d="M3 22v-6h6" />
                            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                          </svg>
                          Refresh
                        </button>
                      </form>
                      <div className="flex items-center gap-2">
                      <Link
                        href={hrefWith({ rPage: releasePage, pPage: Math.max(1, postPage - 1), igPage: igDraftPage, emailPage: emailDraftPage })}
                        className={`px-2 py-1 rounded border ${postPage > 1 ? "border-white/20 hover:border-accent/40" : "border-white/5 opacity-40 pointer-events-none"}`}
                      >
                        Prev
                      </Link>
                      <span>{postPage}/{postTotalPages}</span>
                      <Link
                        href={hrefWith({ rPage: releasePage, pPage: Math.min(postTotalPages, postPage + 1), igPage: igDraftPage, emailPage: emailDraftPage })}
                        className={`px-2 py-1 rounded border ${postPage < postTotalPages ? "border-white/20 hover:border-accent/40" : "border-white/5 opacity-40 pointer-events-none"}`}
                      >
                        Next
                      </Link>
                      </div>
                    </div>
                  </div>


                  <div className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory custom-scrollbar">
                    {postRows.length === 0 ? (
                      <div className="text-xs text-white/35 py-8">No Instagram posts available.</div>
                    ) : (
                      postRows.map((post) => (
                        <a
                          key={post.id}
                          href={post.url || "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="snap-start shrink-0 w-[220px] rounded-2xl border border-white/10 bg-black/30 overflow-hidden hover:border-accent/30 transition-all"
                        >
                          <div className="h-[150px] w-full bg-black/30">
                            {post.imageUrl ? (
                              <img src={proxiedHelper(post.imageUrl)} alt="Instagram post" className="h-full w-full object-cover" />
                            ) : null}
                          </div>
                          <div className="p-3 space-y-1">
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">{formatRelativeDate(post.postedAt || post.createdAt)}</p>
                            <p className="text-xs text-white/70 line-clamp-2">{post.caption || "No caption"}</p>
                          </div>
                        </a>
                      ))
                    )}
                  </div>
                </div>
              </GlassCard>

              <GlassCard className="p-6! bg-white/2 border-white/5">
                <div className="space-y-5">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-[0.25em] text-white/35">Spotify</h3>
                    <EditableSpotifyProfile
                      artistId={lead.artist.id}
                      leadId={lead.id}
                      spotifyName={lead.artist.name}
                      spotifyUrl={lead.artist.spotifyArtistUrl}
                    />
                  </div>

                  {featuredRelease ? (
                    <iframe
                      style={{ borderRadius: '12px' }}
                      src={
                        featuredRelease.spotifyTrackId
                          ? `https://open.spotify.com/embed/track/${featuredRelease.spotifyTrackId}`
                          : featuredRelease.spotifyReleaseId
                          ? `https://open.spotify.com/embed/album/${featuredRelease.spotifyReleaseId}`
                          : featuredRelease.url
                          ? `https://open.spotify.com/embed${featuredRelease.url.split('spotify.com')[1]}`
                          : ""
                      }
                      width="100%"
                      height="352"
                      frameBorder="0"
                      allowFullScreen
                      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                      loading="lazy"
                    />
                  ) : (
                    <p className="text-xs text-white/35">No releases available.</p>
                  )}
                </div>
              </GlassCard>
            </div>

            <div className="space-y-6">
              <div className="flex items-center justify-between border-b border-white/5 pb-3">
                <h3 className="text-xs font-bold uppercase tracking-[0.3em] text-white/25">Outreach Drafts</h3>
                <form action={regenerateAllDrafts}>
                  <input type="hidden" name="leadId" value={lead.id} />
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/3 text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-accent hover:border-accent/30 hover:bg-accent/5 transition-all"
                  >
                    Regenerate All
                  </button>
                </form>
              </div>

              {draftGenerationError && (
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
                  {draftGenerationError}
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <GlassCard className="p-5! bg-white/2 border-white/5">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/35">IG DM</p>
                    <div className="flex items-center gap-2 text-xs font-bold text-white/35">
                      <Link
                        href={hrefWith({ rPage: releasePage, pPage: postPage, igPage: Math.max(1, igDraftPage - 1), emailPage: emailDraftPage })}
                        className={`px-2 py-1 rounded border ${igDraftPage > 1 ? "border-white/20 hover:border-accent/40" : "border-white/5 opacity-40 pointer-events-none"}`}
                      >
                        Prev
                      </Link>
                      <span>{igDraftPage}/{igDraftTotalPages}</span>
                      <Link
                        href={hrefWith({ rPage: releasePage, pPage: postPage, igPage: Math.min(igDraftTotalPages, igDraftPage + 1), emailPage: emailDraftPage })}
                        className={`px-2 py-1 rounded border ${igDraftPage < igDraftTotalPages ? "border-white/20 hover:border-accent/40" : "border-white/5 opacity-40 pointer-events-none"}`}
                      >
                        Next
                      </Link>
                    </div>
                  </div>
                  <div className="space-y-4">
                    {igDraftSlice.length === 0 ? <p className="text-xs text-white/35">No IG drafts yet.</p> : igDraftSlice.map(renderDraftCard)}
                  </div>
                </GlassCard>

                <GlassCard className="p-5! bg-white/2 border-white/5">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/35">Email</p>
                    <div className="flex items-center gap-2 text-xs font-bold text-white/35">
                      <Link
                        href={hrefWith({ rPage: releasePage, pPage: postPage, igPage: igDraftPage, emailPage: Math.max(1, emailDraftPage - 1) })}
                        className={`px-2 py-1 rounded border ${emailDraftPage > 1 ? "border-white/20 hover:border-accent/40" : "border-white/5 opacity-40 pointer-events-none"}`}
                      >
                        Prev
                      </Link>
                      <span>{emailDraftPage}/{emailDraftTotalPages}</span>
                      <Link
                        href={hrefWith({ rPage: releasePage, pPage: postPage, igPage: igDraftPage, emailPage: Math.min(emailDraftTotalPages, emailDraftPage + 1) })}
                        className={`px-2 py-1 rounded border ${emailDraftPage < emailDraftTotalPages ? "border-white/20 hover:border-accent/40" : "border-white/5 opacity-40 pointer-events-none"}`}
                      >
                        Next
                      </Link>
                    </div>
                  </div>
                  <div className="space-y-4">
                    {emailDraftSlice.length === 0 ? <p className="text-xs text-white/35">No email drafts for this lead.</p> : emailDraftSlice.map(renderDraftCard)}
                  </div>
                </GlassCard>
              </div>
            </div>

            <GlassCard className="p-4! bg-white/2 border-white/5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/30">Activity History</h3>
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/20">{lead.activities.length}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {lead.activities.slice(0, 6).map((activity) => {
                  const isEmailDiscovery = activity.note?.startsWith("[AUTO-DISCOVER]");
                  if (isEmailDiscovery && activity.note) {
                    const detailStr = activity.note.replace(/^\[AUTO-DISCOVER\] Found contact\(s\):\s*/, "");
                    const entries = detailStr.split("; ").map(entry => {
                      const match = entry.match(/^(.+?)\s+\((\w+),\s*(\d+)%,\s*via\s+(\S+)\s+→\s+(\S+)\)$/);
                      if (match) {
                        return { email: match[1], confidence: match[2], score: match[3], sourceType: match[4], sourceUrl: match[5] };
                      }
                      return null;
                    }).filter(Boolean);

                    return (
                      <div key={activity.id} className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 px-3 py-2">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-400/70">📧 Email Discovered</span>
                        </div>
                        {entries.map((entry, idx) => (
                          <div key={idx} className="mt-1">
                            <p className="text-xs font-semibold text-white/90 font-mono">{entry!.email}</p>
                            <p className="text-[10px] text-white/45 mt-0.5">
                              <span className="text-emerald-400/60">{entry!.confidence}</span> · {entry!.score}% confidence
                            </p>
                            <p className="text-[10px] text-white/35 mt-0.5 truncate">
                              via <span className="text-white/50">{entry!.sourceType}</span> → <span className="text-accent/60">{entry!.sourceUrl}</span>
                            </p>
                          </div>
                        ))}
                        {entries.length === 0 && (
                          <p className="text-xs text-white/60 line-clamp-2">{activity.note}</p>
                        )}
                        <p className="text-[10px] font-bold uppercase tracking-widest text-white/25 mt-1.5">{formatRelativeDate(activity.occurredAt)}</p>
                      </div>
                    );
                  }

                  return (
                    <div key={activity.id} className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">
                      <p className="text-xs text-white/60 line-clamp-2">{activity.note || "Activity"}</p>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-white/25 mt-1">{formatRelativeDate(activity.occurredAt)}</p>
                    </div>
                  );
                })}
              </div>
            </GlassCard>

            <LeadBottomNavigation
              prevLead={prevLead}
              nextLead={nextLead}
              currentIndex={currentIndex}
              totalLeads={totalLeads}
            />
          </div>
        </div>
      </div>
    </DynamicThemeShell>
  );
}
