import type { FollowUpActionType, LeadStatus, ReplyIntent } from "local-prisma-client";

export type SequenceStepDef = {
  dayOffset: number;
  tone: string;
  promptHint: string;
};

export type DefaultSequenceSeed = {
  name: string;
  description: string;
  isDefault: boolean;
  steps: SequenceStepDef[];
};

export const INTENT_STATUS_MAP: Record<ReplyIntent, LeadStatus>;
export const DEFAULT_SEQUENCES: DefaultSequenceSeed[];
export const RECOMMENDED_SEQUENCE_BY_INTENT: Record<ReplyIntent, string | null>;

export function inferFollowUpActionType(
  artist: { instagramHandle?: string | null; emails?: string[] | null } | null | undefined,
  preferredChannel?: "ig" | "email" | "call" | null
): FollowUpActionType;

export function resolveInitialStepIndex(
  steps: Array<{ dayOffset?: number }>,
  options?: { afterOutboundSend?: boolean }
): number;

export function computeStepDueDate(
  startedAt: Date | string | number,
  step: { dayOffset?: number }
): Date;

export function buildSequenceStepDrafts(ctx: {
  artistName: string;
  instagramHandle?: string | null;
  emails?: string[] | null;
  followerCount?: number | null;
  genre?: string | null;
  latestReleaseTitle?: string | null;
  upcomingVenue?: string | null;
  bookingUrl?: string | null;
  sequenceName: string;
  stepIndex: number;
  totalSteps: number;
  step: SequenceStepDef;
}): Array<{
  channel: "ig" | "email";
  tone: string;
  body: string;
  source: string;
}>;

export function buildTriageReplySuggestion(ctx: {
  intent: ReplyIntent;
  artistName: string;
  followerCount?: number | null;
  bookingUrl?: string | null;
  portalUrl?: string | null;
}): string;

export type CloseDealType = "PORTFOLIO_FREE" | "PAID";

export function buildCloseProjectSpec(input: {
  artistName: string;
  dealType?: CloseDealType;
  packageCode?: string | null;
  customTitle?: string | null;
}): {
  dealType: CloseDealType;
  title: string;
  paywallDeliverables: boolean;
  invoiceStatus: "PAID" | "ISSUED";
  templateCode: string | null;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPriceCents: number;
    amountCents: number;
  }>;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  notes: string;
};
