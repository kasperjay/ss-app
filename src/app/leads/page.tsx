export const dynamic = "force-dynamic";

import Link from "next/link";
import { LeadQueue, SkippableLead } from "./LeadQueue";
import { Prisma, LeadStatus } from "local-prisma-client";
import { prisma } from "@/lib/prisma";
import { GlassCard } from "@/components/GlassCard";
import { NeonButton } from "@/components/NeonButton";
import { StatusPill } from "@/components/StatusPill";
import { formatRelativeDate, formatLocation, clampScore } from "@/lib/utils";
import { updateLeadStatus } from "./[id]/actions";
import { AUSTIN_AREA_CITIES } from "@/lib/location-parser";
import { isNonLocalWithPastGigOnly } from "@/lib/show-parser";
import {
  comparePortfolioLeads,
  isLowFollowerArtist,
  normalizeFollowerCount,
} from "@/lib/portfolio-priority";

const STATUS_OPTIONS = [
  "ALL",
  "NEW",
  "QUALIFIED",
  "CONTACTED",
  "FOLLOW_UP",
  "WON",
  "LOST",
  "PAUSED",
] as const;

const SCORE_OPTIONS = [
  "ALL",
  "80_PLUS",
  "60_PLUS",
  "60_79",
  "40_59",
  "UNDER_40",
  "UNSCORED",
] as const;

const LOCATION_OPTIONS = [
  "ALL",
  "AUSTIN",
  "TEXAS",
  "TEXAS_NON_AUSTIN",
  "OUT_OF_STATE",
  "UNKNOWN",
] as const;

const NEED_OPTIONS = [
  "ALL",
  "PROBABLE",
  "CLEAR",
  "POSSIBLE",
  "ANY_NEED",
  "NONE",
] as const;

const CONTACT_OPTIONS = [
  "ALL",
  "WITH_CONTACT",
  "NO_CONTACT",
] as const;

const SORT_OPTIONS = [
  "portfolio_desc",
  "score_desc",
  "score_asc",
  "updated_desc",
  "updated_asc",
  "name_asc",
  "name_desc",
  "created_desc",
  "created_asc",
] as const;

const VIEW_OPTIONS = ["portfolio", "score"] as const;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function asSingle(value: string | string[] | undefined, fallback: string): string {
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

export default async function LeadsPage(props: PageProps) {
  const params = await props.searchParams;

  const view = asSingle(params.view, "portfolio").toLowerCase();
  const safeView = VIEW_OPTIONS.includes(view as (typeof VIEW_OPTIONS)[number]) ? view : "portfolio";
  const isPortfolioView = safeView === "portfolio";
  const status = asSingle(params.status, isPortfolioView ? "ALL" : "QUALIFIED").toUpperCase();
  const score = asSingle(params.score, "ALL").toUpperCase();
  const location = asSingle(params.location, "ALL").toUpperCase();
  const need = asSingle(params.need, "ALL").toUpperCase();
  const contact = asSingle(params.contact, "WITH_CONTACT").toUpperCase();
  const sort = asSingle(params.sort, isPortfolioView ? "portfolio_desc" : "score_desc").toLowerCase();
  const q = asSingle(params.q, "").trim();
  const loc = asSingle(params.loc, "").trim();
  const minScoreRaw = asSingle(params.minScore, "").trim();
  const maxScoreRaw = asSingle(params.maxScore, "").trim();

  const safeStatus = STATUS_OPTIONS.includes(status as (typeof STATUS_OPTIONS)[number]) ? status : "QUALIFIED";
  const safeScore = SCORE_OPTIONS.includes(score as (typeof SCORE_OPTIONS)[number]) ? score : "ALL";
  const safeLocation = LOCATION_OPTIONS.includes(location as (typeof LOCATION_OPTIONS)[number]) ? location : "ALL";
  const safeNeed = NEED_OPTIONS.includes(need as (typeof NEED_OPTIONS)[number]) ? need : "ALL";
  const safeContact = CONTACT_OPTIONS.includes(contact as (typeof CONTACT_OPTIONS)[number]) ? contact : "WITH_CONTACT";
  const safeSort = SORT_OPTIONS.includes(sort as (typeof SORT_OPTIONS)[number])
    ? sort
    : isPortfolioView
      ? "portfolio_desc"
      : "score_desc";

  const where: Prisma.LeadWhereInput = {};

  // Status Filter: Always remove PAUSED unless explicitly filtered for
  if (safeStatus !== "ALL") {
    where.status = safeStatus as LeadStatus;
  } else {
    where.status = { not: "PAUSED" };
  }

  // Score Range Filter
  if (minScoreRaw || maxScoreRaw) {
    const min = minScoreRaw ? parseFloat(minScoreRaw) : undefined;
    const max = maxScoreRaw ? parseFloat(maxScoreRaw) : undefined;
    where.score = {
      ...(min !== undefined && !isNaN(min) ? { gte: min } : {}),
      ...(max !== undefined && !isNaN(max) ? { lte: max } : {}),
    };
  } else if (safeScore === "80_PLUS") {
    where.score = { gte: 80 };
  } else if (safeScore === "60_PLUS") {
    where.score = { gte: 60 };
  } else if (safeScore === "60_79") {
    where.score = { gte: 60, lte: 79.99 };
  } else if (safeScore === "40_59") {
    where.score = { gte: 40, lte: 59.99 };
  } else if (safeScore === "UNDER_40") {
    where.score = { lt: 40 };
  } else if (safeScore === "UNSCORED") {
    where.score = null;
  }

  // Production Need Filter
  if (safeNeed === "PROBABLE" || safeNeed === "CLEAR") {
    where.productionNeedLevel = { in: ["PROBABLE", "CLEAR"] };
  } else if (safeNeed === "POSSIBLE") {
    where.productionNeedLevel = "POSSIBLE";
  } else if (safeNeed === "ANY_NEED") {
    where.productionNeedLevel = { in: ["PROBABLE", "CLEAR", "POSSIBLE"] };
  } else if (safeNeed === "NONE") {
    where.productionNeedLevel = "NONE";
  }

  // Artist-level conditions (combined safely via AND)
  const artistAndConditions: Prisma.ArtistWhereInput[] = [];

  // Contact Readiness
  if (safeContact === "WITH_CONTACT") {
    artistAndConditions.push({
      OR: [
        { emails: { isEmpty: false } },
        { instagramHandle: { not: null } },
        { officialSiteUrl: { not: null } },
      ],
    });
  } else if (safeContact === "NO_CONTACT") {
    artistAndConditions.push({
      AND: [
        { emails: { isEmpty: true } },
        { instagramHandle: null },
        { officialSiteUrl: null },
      ],
    });
  }

  // Location Preset Filters
  const austinVariations = Array.from(
    new Set([
      ...AUSTIN_AREA_CITIES,
      ...AUSTIN_AREA_CITIES.map((c) => c.charAt(0).toUpperCase() + c.slice(1)),
      "Austin",
      "ATX",
      "Austin, TX",
      "Austin, Texas",
    ])
  );

  if (safeLocation === "AUSTIN") {
    artistAndConditions.push({
      OR: [
        { city: { in: austinVariations } },
        { location: { contains: "austin", mode: "insensitive" } },
        { location: { contains: "atx", mode: "insensitive" } },
        { location: { contains: "round rock", mode: "insensitive" } },
        { location: { contains: "san marcos", mode: "insensitive" } },
        { location: { contains: "cedar park", mode: "insensitive" } },
        { location: { contains: "georgetown", mode: "insensitive" } },
        { location: { contains: "pflugerville", mode: "insensitive" } },
        { location: { contains: "buda", mode: "insensitive" } },
        { location: { contains: "kyle", mode: "insensitive" } },
      ],
    });
  } else if (safeLocation === "TEXAS") {
    artistAndConditions.push({
      OR: [
        { state: { in: ["TX", "Texas", "tx", "texas"] } },
        { location: { contains: "TX", mode: "insensitive" } },
        { location: { contains: "Texas", mode: "insensitive" } },
      ],
    });
  } else if (safeLocation === "TEXAS_NON_AUSTIN") {
    artistAndConditions.push({
      OR: [
        { state: { in: ["TX", "Texas", "tx", "texas"] } },
        { location: { contains: "TX", mode: "insensitive" } },
        { location: { contains: "Texas", mode: "insensitive" } },
      ],
      NOT: [
        { city: { in: austinVariations } },
        { location: { contains: "austin", mode: "insensitive" } },
      ],
    });
  } else if (safeLocation === "OUT_OF_STATE") {
    artistAndConditions.push({
      OR: [
        { state: { not: null, notIn: ["TX", "Texas", "tx", "texas", ""] } },
        { country: { not: null, notIn: ["USA", "US", "United States", ""] } },
      ],
      NOT: [
        { state: { in: ["TX", "Texas", "tx", "texas"] } },
        { location: { contains: "austin", mode: "insensitive" } },
        { location: { contains: "texas", mode: "insensitive" } },
      ],
    });
  } else if (safeLocation === "UNKNOWN") {
    artistAndConditions.push({
      AND: [
        { OR: [{ city: null }, { city: "" }] },
        { OR: [{ state: null }, { state: "" }] },
        { OR: [{ location: null }, { location: "" }] },
      ],
    });
  }

  // Location Free Text Search
  if (loc) {
    artistAndConditions.push({
      OR: [
        { city: { contains: loc, mode: "insensitive" } },
        { state: { contains: loc, mode: "insensitive" } },
        { country: { contains: loc, mode: "insensitive" } },
        { location: { contains: loc, mode: "insensitive" } },
      ],
    });
  }

  if (artistAndConditions.length > 0) {
    where.artist = { AND: artistAndConditions };
  }

  // General Text Search (q)
  if (q) {
    where.OR = [
      { artist: { name: { contains: q, mode: "insensitive" } } },
      { artist: { genre: { contains: q, mode: "insensitive" } } },
      { artist: { bio: { contains: q, mode: "insensitive" } } },
      { scoreRationale: { contains: q, mode: "insensitive" } },
    ];
  }

  // Sort Order
  const orderBy =
    safeSort === "portfolio_desc"
      ? [{ updatedAt: "desc" as const }]
      :
    safeSort === "score_asc"
      ? [{ score: "asc" as const }, { updatedAt: "desc" as const }]
      : safeSort === "updated_desc"
        ? [{ updatedAt: "desc" as const }]
        : safeSort === "updated_asc"
          ? [{ updatedAt: "asc" as const }]
          : safeSort === "name_asc"
            ? [{ artist: { name: "asc" as const } }]
            : safeSort === "name_desc"
              ? [{ artist: { name: "desc" as const } }]
              : safeSort === "created_asc"
                ? [{ createdAt: "asc" as const }]
                : safeSort === "created_desc"
                  ? [{ createdAt: "desc" as const }]
                  : [{ score: "desc" as const }, { updatedAt: "desc" as const }];

  const rawLeads = await prisma.lead.findMany({
    where,
    include: {
      artist: {
        include: {
          releases: {
            orderBy: [{ releaseDate: "desc" }, { createdAt: "desc" }],
            take: 1,
          },
        },
      },
      activities: {
        orderBy: { occurredAt: "desc" },
        take: 20,
      },
    },
    orderBy,
  });

  // Non-local artists whose gigs in Austin have already been played are removed from the lead queue
  const leads = rawLeads.filter((lead) => safeStatus === "PAUSED" || !isNonLocalWithPastGigOnly(lead));
  if (safeSort === "portfolio_desc") {
    leads.sort((a, b) => comparePortfolioLeads(a, b));
  }

  // Calculate active filter count and chips for UI feedback
  const activeChips: string[] = [];
  if (q) activeChips.push(`"${q}"`);
  if (safeStatus !== "ALL") activeChips.push(`Status: ${safeStatus}`);
  if (safeScore !== "ALL") {
    const scoreMap: Record<string, string> = {
      "80_PLUS": "Score 80+",
      "60_PLUS": "Score 60+",
      "60_79": "Score 60–79",
      "40_59": "Score 40–59",
      UNDER_40: "Score <40",
      UNSCORED: "Unscored",
    };
    activeChips.push(scoreMap[safeScore] || safeScore);
  }
  if (safeLocation !== "ALL") {
    const locMap: Record<string, string> = {
      AUSTIN: "Austin Metro",
      TEXAS: "All Texas",
      TEXAS_NON_AUSTIN: "Texas (Non-Austin)",
      OUT_OF_STATE: "Out of State",
      UNKNOWN: "Unknown Location",
    };
    activeChips.push(locMap[safeLocation] || safeLocation);
  }
  if (loc) activeChips.push(`Loc: "${loc}"`);
  if (safeNeed !== "ALL") {
    const needMap: Record<string, string> = {
      PROBABLE: "Probable Need (+12)",
      CLEAR: "Probable Need (+12)",
      POSSIBLE: "Possible Need (+8)",
      ANY_NEED: "Any Production Need",
      NONE: "No Need",
    };
    activeChips.push(needMap[safeNeed] || safeNeed);
  }
  if (safeContact !== "ALL") {
    activeChips.push(safeContact === "WITH_CONTACT" ? "Has Contacts" : "Missing Contacts");
  }
  if (isPortfolioView) activeChips.unshift("Portfolio Building: <5k Followers First");

  return (
    <div className="relative min-h-screen bg-transparent">
      <div className="mx-auto max-w-7xl space-y-10 px-6 py-20">
        {/* Header Section */}
        <header className="flex flex-col gap-8 relative">
          <div className="absolute -top-24 -right-24 h-96 w-96 bg-accent-warm/10 blur-[120px] rounded-full pointer-events-none" />

          <div className="flex flex-wrap items-end justify-between gap-8 pb-10 border-b border-white/5 relative z-10">
            <div className="space-y-4">
              <Link
                href="/"
                className="inline-flex items-center gap-2 group text-xs font-bold uppercase tracking-[0.3em] text-white/30 hover:text-accent transition-all"
              >
                <span className="transition-transform group-hover:-translate-x-1 text-lg leading-none">←</span>
                Dashboard
              </Link>
              <div className="flex items-center gap-3">
                <span className="h-px w-8 bg-accent/40" />
                <p className="text-xs uppercase tracking-[0.3em] text-accent/60 font-bold">
                  Lead Directory & Intelligence
                </p>
              </div>
              <h1 className="font-display text-5xl font-bold tracking-tighter md:text-6xl lg:text-7xl">
                Lead <span className="premium-gradient-text italic">Management</span>
              </h1>
              <p className="text-white/40 text-sm max-w-2xl font-medium leading-relaxed">
                Portfolio building view for artists of any genre, prioritizing emerging artists under 5k followers while preserving Smart Score as a long-term intelligence signal.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <div className="flex flex-col items-end gap-2 bg-white/2 backdrop-blur-sm border border-white/5 p-6 rounded-[32px]">
                <span className="text-xs font-bold text-white/30 uppercase tracking-[0.2em]">Current Mode</span>
                <span className="text-sm font-bold uppercase tracking-[0.15em] text-accent">
                  {isPortfolioView ? "Portfolio Building" : "Smart Score"}
                </span>
              </div>
              <div className="flex flex-col items-end gap-2 bg-white/2 backdrop-blur-sm border border-white/5 p-6 rounded-[32px]">
                <span className="text-xs font-bold text-white/30 uppercase tracking-[0.2em]">Lead Records</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-sans font-extrabold text-accent tabular-nums">{leads.length}</span>
                  <span className="text-xs font-bold text-white/10 uppercase tracking-widest">
                    {activeChips.length > 0 ? "Filtered" : "Active"}
                  </span>
                </div>
              </div>

              <Link href="/leads/discover">
                <NeonButton variant="outline" size="md">
                  + New Search
                </NeonButton>
              </Link>
            </div>
          </div>
        </header>

        {/* Multi-Dimensional Filter Suite */}
        <section className="relative z-10">
          <GlassCard className="p-6! border-white/5 bg-white/2 space-y-6">
            <form
              key={`${safeView}:${safeStatus}:${safeScore}:${safeLocation}:${safeNeed}:${safeContact}:${safeSort}:${q}:${loc}:${minScoreRaw}:${maxScoreRaw}`}
              method="GET"
              action="/leads"
              className="space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-accent/20 bg-accent/5 px-4 py-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent">
                      {isPortfolioView ? "Portfolio building" : "Smart score intelligence"}
                    </p>
                    {isPortfolioView && (
                      <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/25">
                        ★ &lt;5k followers first
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-white/45">
                    {isPortfolioView
                      ? "Prioritizes artists under 5,000 followers alongside reachability and recent activity across every genre. Smart Score remains visible and unchanged."
                      : "Uses the existing scoring model and rationale for long-term lead intelligence."
                    }
                  </p>
                </div>
                <label className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.15em] text-white/50">
                  View
                  <select
                    name="view"
                    defaultValue={safeView}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-accent/30"
                  >
                    <option value="portfolio">Portfolio Building · &lt;5k Followers First</option>
                    <option value="score">Smart Score Intelligence</option>
                  </select>
                </label>
              </div>
              {/* Row 1: Core Triage Filters */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Search */}
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-bold uppercase tracking-[0.2em] text-white/30">Keyword / Bio</span>
                  <input
                    name="q"
                    defaultValue={q}
                    placeholder="Artist, bio, sound..."
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-accent/30"
                  />
                </label>

                {/* Score Range Filter */}
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-bold uppercase tracking-[0.2em] text-accent/70">Score Range</span>
                  <select
                    name="score"
                    defaultValue={safeScore}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-accent/30"
                  >
                    <option value="ALL">All Scores (0 – 100)</option>
                    <option value="80_PLUS">80+ · Top Priority (Tier 1)</option>
                    <option value="60_PLUS">60+ · All Qualified Targets</option>
                    <option value="60_79">60 – 79 · Standard Qualified</option>
                    <option value="40_59">40 – 59 · Emerging / Moderate</option>
                    <option value="UNDER_40">&lt; 40 · Low Priority</option>
                    <option value="UNSCORED">Unscored Leads</option>
                  </select>
                </label>

                {/* Location Filter */}
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-bold uppercase tracking-[0.2em] text-accent/70">Location Region</span>
                  <select
                    name="location"
                    defaultValue={safeLocation}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-accent/30"
                  >
                    <option value="ALL">All Locations</option>
                    <option value="AUSTIN">Austin &amp; Local Metro</option>
                    <option value="TEXAS">All Texas (Austin + State)</option>
                    <option value="TEXAS_NON_AUSTIN">Texas (Outside Austin)</option>
                    <option value="OUT_OF_STATE">Out of State / Non-TX</option>
                    <option value="UNKNOWN">Unknown / Missing Location</option>
                  </select>
                </label>

                {/* Status */}
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-bold uppercase tracking-[0.2em] text-white/30">Lead Status</span>
                  <select
                    name="status"
                    defaultValue={safeStatus}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-accent/30"
                  >
                    <option value="ALL">All Active Statuses</option>
                    <option value="NEW">New</option>
                    <option value="QUALIFIED">Qualified</option>
                    <option value="CONTACTED">Contacted</option>
                    <option value="FOLLOW_UP">Follow Up</option>
                    <option value="WON">Won (Converted)</option>
                    <option value="LOST">Lost (Closed)</option>
                    <option value="PAUSED">Paused / Ignore</option>
                  </select>
                </label>
              </div>

              {/* Row 2: Precision & Signal Filters */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                {/* Specific Location Search */}
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-bold uppercase tracking-[0.2em] text-white/30">City / State Search</span>
                  <input
                    name="loc"
                    defaultValue={loc}
                    placeholder="e.g. San Marcos, Houston, Denver..."
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-accent/30"
                  />
                </label>

                {/* Production Need */}
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-bold uppercase tracking-[0.2em] text-white/30">Production Need</span>
                  <select
                    name="need"
                    defaultValue={safeNeed}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-accent/30"
                  >
                    <option value="ALL">All Production Needs</option>
                    <option value="PROBABLE">★ Probable Need (Studio / Mix / Track)</option>
                    <option value="POSSIBLE">Possible Need (Releases / Drops)</option>
                    <option value="ANY_NEED">Any Need (Probable + Possible)</option>
                    <option value="NONE">No Detected Need</option>
                  </select>
                </label>

                {/* Contact Signals */}
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-bold uppercase tracking-[0.2em] text-white/30">Contact Signals</span>
                  <select
                    name="contact"
                    defaultValue={safeContact}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-accent/30"
                  >
                    <option value="ALL">All Contact Readiness</option>
                    <option value="WITH_CONTACT">Has Contact Signals (Ready)</option>
                    <option value="NO_CONTACT">Missing Contact Signals</option>
                  </select>
                </label>

                {/* Sort */}
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-bold uppercase tracking-[0.2em] text-white/30">Sort Order</span>
                  <select
                    name="sort"
                    defaultValue={safeSort}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-accent/30"
                  >
                    <option value="portfolio_desc">Portfolio Priority (&lt;5k Followers → Reachability → Fit)</option>
                    <option value="score_desc">Smart Score (High → Low)</option>
                    <option value="score_asc">Smart Score (Low → High)</option>
                    <option value="updated_desc">Last Updated (Newest)</option>
                    <option value="updated_asc">Last Updated (Oldest)</option>
                    <option value="name_asc">Artist Name (A → Z)</option>
                    <option value="name_desc">Artist Name (Z → A)</option>
                    <option value="created_desc">Created (Newest)</option>
                    <option value="created_asc">Created (Oldest)</option>
                  </select>
                </label>
              </div>

              {/* Action Buttons & Filter Summary */}
              <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-white/5">
                <div className="flex flex-wrap items-center gap-2">
                  {activeChips.length > 0 ? (
                    <>
                      <span className="text-xs font-bold uppercase tracking-[0.2em] text-white/30 mr-1">
                        Active ({activeChips.length}):
                      </span>
                      {activeChips.map((chip, idx) => (
                        <span
                          key={idx}
                          className="px-3 py-1 rounded-full bg-accent/10 border border-accent/25 text-accent text-xs font-bold"
                        >
                          {chip}
                        </span>
                      ))}
                    </>
                  ) : (
                    <span className="text-xs text-white/20 font-medium">
                      Showing all active leads sorted by Smart Score. Use filters above to isolate specific cohorts.
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-4 ml-auto">
                  {activeChips.length > 0 && (
                    <Link
                      href="/leads"
                      className="text-xs font-bold uppercase tracking-[0.2em] text-white/40 hover:text-white transition-colors whitespace-nowrap"
                    >
                      Reset All
                    </Link>
                  )}
                  <NeonButton variant="purple" size="md" className="text-xs! tracking-[0.2em]! font-bold! px-8!">
                    Apply Filters
                  </NeonButton>
                </div>
              </div>
            </form>
          </GlassCard>
        </section>

        {/* Lead List */}
        <LeadQueue view={safeView}>
        <main className="space-y-6 relative z-10">
          {leads.length === 0 ? (
            <GlassCard className="py-20 text-center p-12!">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/30 max-w-sm mx-auto leading-relaxed">
                No leads match this filter combination.
              </p>
              <div className="mt-8 flex items-center justify-center gap-4">
                <Link href="/leads">
                  <NeonButton variant="purple" size="md" className="text-xs! tracking-[0.2em]! font-bold!">
                    Clear Filters
                  </NeonButton>
                </Link>
                <Link href="/leads/discover">
                  <NeonButton variant="outline" size="md" className="text-xs! tracking-[0.2em]! font-bold!">
                    + New Search
                  </NeonButton>
                </Link>
              </div>
            </GlassCard>
          ) : (
            <div className="grid gap-6">
              {leads.map((lead) => {
                const score = clampScore(lead.score);
                const followerCount = normalizeFollowerCount(lead.artist.followerCount);
                const isPriorityFollower = isPortfolioView && isLowFollowerArtist(lead.artist);
                const hasEmail = (lead.artist.emails?.length ?? 0) > 0;
                const hasIg = Boolean(lead.artist.instagramHandle);
                const hasSite = Boolean(lead.artist.officialSiteUrl);
                const hasContactSignals = hasEmail || hasIg || hasSite;
                const latestRelease = lead.artist.releases[0];
                const locationText = formatLocation(
                  lead.artist.location,
                  lead.artist.city,
                  lead.artist.state,
                  lead.artist.country
                ) || "Location Unknown";

                const isAustinArtist =
                  lead.artist.city?.toLowerCase() === "austin" ||
                  (lead.artist.location && /austin|atx/i.test(lead.artist.location));

                return (
                  <SkippableLead key={lead.id} id={lead.id} name={lead.artist.name}>
                  <GlassCard
                    className={`group p-8! transition-all hover:bg-white/4 hover:border-accent/30 shadow-2xl ${
                      isPriorityFollower ? "border-accent/20" : "border-white/5"
                    }`}
                  >
                    {/* Header Row */}
                    <div className="flex flex-wrap items-start justify-between gap-6 mb-6 border-b border-white/5 pb-6">
                      <div className="space-y-2">
                        <h3 className="text-3xl font-bold tracking-tighter">
                          <Link
                            href={`/leads/${lead.id}`}
                            className="premium-gradient-text hover:brightness-125 transition-all decoration-accent/20 underline underline-offset-8 decoration-1"
                          >
                            {lead.artist.name}
                          </Link>
                        </h3>
                        <div className="flex flex-wrap items-center gap-3 text-xs font-bold uppercase tracking-[0.2em]">
                          <span className={isAustinArtist ? "text-accent" : "text-white/40"}>
                            {locationText}
                          </span>
                          <span className="h-1 w-1 rounded-full bg-white/10" />
                          <span className="text-white/30">{lead.artist.genre || "Genre Unknown"}</span>
                          <span className="h-1 w-1 rounded-full bg-white/10" />
                          <span className={`tabular-nums ${isPriorityFollower ? "text-accent" : "text-white/30"}`}>
                            {followerCount !== null ? `${followerCount.toLocaleString()} followers` : "Followers unknown"}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        {isPriorityFollower && (
                          <span className="px-3 py-1.5 rounded-xl bg-accent/10 border border-accent/30 text-accent text-[10px] font-bold uppercase tracking-[0.2em]">
                            ★ &lt;5k Priority
                          </span>
                        )}
                        {(lead.productionNeedLevel === "PROBABLE" || lead.productionNeedLevel === "CLEAR") && (
                          <span className="px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold uppercase tracking-[0.2em]">
                            ★ Probable Need
                          </span>
                        )}
                        {lead.productionNeedLevel === "POSSIBLE" && (
                          <span className="px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px] font-bold uppercase tracking-[0.2em]">
                            Possible Need
                          </span>
                        )}

                        <StatusPill status={lead.status} />

                        <div
                          className={`px-4 py-2 rounded-xl border text-xs font-bold uppercase tracking-[0.2em] ${
                            score >= 80
                              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                              : score >= 60
                              ? "bg-accent/10 border-accent/30 text-accent"
                              : score >= 40
                              ? "bg-accent-secondary/10 border-accent-secondary/30 text-accent-secondary"
                              : "bg-white/5 border-white/10 text-white/50"
                          }`}
                        >
                          Smart Score {score}%
                        </div>
                      </div>
                    </div>

                    {/* Rationale Quote */}
                    {lead.scoreRationale && (
                      <p className="text-sm text-white/60 leading-relaxed border-l border-white/10 pl-6 py-1 italic font-medium mb-6">
                        &ldquo;{lead.scoreRationale}&rdquo;
                      </p>
                    )}

                    {/* Signal Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                      <div className="rounded-2xl bg-white/3 border border-white/8 p-4">
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35 mb-2">Contact Signals</p>
                        <p className={`text-xs font-bold uppercase tracking-[0.2em] ${hasContactSignals ? "text-accent" : "text-white/35"}`}>
                          {hasContactSignals ? "Ready" : "Missing"}
                        </p>
                        <p className="text-xs text-white/45 mt-2 leading-relaxed">
                          {hasEmail ? `${lead.artist.emails.length} email${lead.artist.emails.length > 1 ? "s" : ""}` : "No email"}
                          {hasIg ? " • IG" : ""}
                          {hasSite ? " • Site" : ""}
                        </p>
                      </div>

                      <div className="rounded-2xl bg-white/3 border border-white/8 p-4">
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35 mb-2">Latest Release</p>
                        <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/60 truncate" title={latestRelease?.title}>
                          {latestRelease ? `"${latestRelease.title}"` : "No releases"}
                        </p>
                        <p className="text-xs text-white/45 mt-2">
                          {latestRelease ? formatRelativeDate(latestRelease.releaseDate ?? latestRelease.createdAt) : "—"}
                        </p>
                      </div>
                    </div>

                    {/* Footer Row */}
                    <div className="flex flex-wrap items-center justify-between gap-4 pt-6 border-t border-white/5">
                      <div className="text-xs text-white/40 font-bold uppercase tracking-[0.2em]">
                        Updated {formatRelativeDate(lead.updatedAt)}
                      </div>
                      <div className="flex items-center gap-3">
                        {lead.status !== "PAUSED" ? (
                          <form
                            action={async () => {
                              "use server";
                              await updateLeadStatus({ leadId: lead.id, status: "PAUSED" });
                            }}
                          >
                            <button
                              type="submit"
                              title="Pause / Ignore this lead (hides from all active views)"
                              className="text-xs font-bold uppercase tracking-[0.2em] text-white/30 hover:text-rose-400 transition-colors px-3 py-2 rounded-xl hover:bg-rose-500/10 cursor-pointer"
                            >
                              Pause
                            </button>
                          </form>
                        ) : (
                          <form
                            action={async () => {
                              "use server";
                              await updateLeadStatus({ leadId: lead.id, status: "NEW" });
                            }}
                          >
                            <button
                              type="submit"
                              title="Restore lead to active pipeline"
                              className="text-xs font-bold uppercase tracking-[0.2em] text-accent/70 hover:text-accent transition-colors px-3 py-2 rounded-xl hover:bg-accent/10 cursor-pointer"
                            >
                              Restore
                            </button>
                          </form>
                        )}
                        <Link href={`/leads/${lead.id}`}>
                          <NeonButton variant="purple" size="md" className="text-xs! tracking-[0.2em]! font-bold! px-8!">
                            Open Lead →
                          </NeonButton>
                        </Link>
                      </div>
                    </div>
                  </GlassCard>
                  </SkippableLead>
                );
              })}
            </div>
          )}
        </main>
        </LeadQueue>
      </div>
    </div>
  );
}
