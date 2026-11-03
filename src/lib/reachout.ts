// src/lib/reachout.ts
import {
  REACHOUT_CONFIG,
  detectGenreStyle,
  isAustinLocal,
  buildPayload,
  extractJson,
  mentionsServices,
  validateRequired,
  cleanEmail,
  sanitizeDraftText,
  requireTitle,
  generateReachoutDrafts as coreGenerateReachoutDrafts,
} from "./reachout-core";

export { detectGenreStyle, isAustinLocal, buildPayload, sanitizeDraftText };

export type ReachoutContext = {
  artist: string;
  spotifyArtistId?: string | null;
  genreText?: string | null;
  location?: string | null;
  releaseTitle?: string | null;
  releaseDatePretty?: string | null;
  isRecentRelease: boolean;
  releaseTiming?: string | null;
  personalHook?: string | null;
  recentPosts?: string | null;
  showInfo?: string | null;
  upcomingShow?: {
    venue?: string;
    datePretty?: string;
    title?: string;
    daysUntil?: number;
  } | null;
  recentPastShow?: {
    venue?: string;
    datePretty?: string;
    title?: string;
    daysAgo?: number;
  } | null;
  bio?: string | null;
  hasEmail: boolean;
  styleHint?: string | null;
  portfolioOffer?: boolean;
  currentDate?: string;
  productionNeedLevel?: string | null;
  productionNeedEvidence?: string[] | string | null;
};

export type ReachoutOutput = {
  IG_A: string;
  IG_B: string;
  EMAIL_A?: string;
  EMAIL_B?: string;
};

export const generateReachoutDrafts = async (ctx: ReachoutContext): Promise<ReachoutOutput> => {
  return coreGenerateReachoutDrafts(ctx) as Promise<ReachoutOutput>;
};
