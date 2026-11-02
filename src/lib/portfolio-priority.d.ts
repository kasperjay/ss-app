export const LOW_FOLLOWER_THRESHOLD: 5000;

export type PortfolioArtistInput = {
  followerCount?: number | null;
  emails?: string[];
  instagramHandle?: string | null;
  officialSiteUrl?: string | null;
  location?: string | null;
  city?: string | null;
  state?: string | null;
  lastPostAt?: Date | string | null;
  releases?: Array<{ releaseDate?: Date | string | null; createdAt?: Date | string | null }>;
};

export type PortfolioLead = {
  score: number | null;
  status: string;
  artist: PortfolioArtistInput;
};

export function normalizeFollowerCount(followerCount: unknown): number | null;
export function isLowFollowerArtist(artist: { followerCount?: number | null } | null | undefined): boolean;
export function portfolioPriority(lead: PortfolioLead, nowMs?: number): number;
export function comparePortfolioLeads(a: PortfolioLead, b: PortfolioLead, nowMs?: number): number;
