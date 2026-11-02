import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email-sender";
import { ensureBotRunning, isBotLoggedIn } from "@/lib/instagram-bot";
import {
  INTENT_STATUS_MAP,
  RECOMMENDED_SEQUENCE_BY_INTENT,
  inferFollowUpActionType,
} from "@/lib/reply-to-close-core";
import {
  enrollLeadInSequence,
  ensureProjectHandoffOnClose,
  pauseActiveEnrollmentsForLead,
} from "@/lib/sequence-close-service";
import { z } from "zod";
import type { LeadStatus, ReplyIntent } from "local-prisma-client";

const BodySchema = z.object({
  activityId: z.string().min(1),
  leadId: z.string().min(1),
  intent: z.enum([
    "INTERESTED",
    "NOT_NOW",
    "PRICING_REQUEST",
    "WRONG_CONTACT",
    "UNSUBSCRIBED",
    "BOOKED",
    "UNCLEAR",
  ]),
  note: z.string().optional(),
  nextActionAt: z.string().datetime().optional(),
  newStatus: z
    .enum(["NEW", "QUALIFIED", "CONTACTED", "FOLLOW_UP", "WON", "LOST", "PAUSED"])
    .optional(),
  enrollSequenceId: z.string().nullable().optional(),
  autoEnrollRecommended: z.boolean().optional(),
  dealType: z.enum(["PORTFOLIO_FREE", "PAID"]).optional(),
  packageCode: z.string().nullable().optional(),
  projectTitle: z.string().optional(),
  replyBody: z.string().optional(),
  sendReplyChannel: z.enum(["ig", "email"]).optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }

  const {
    activityId,
    leadId,
    intent,
    note,
    nextActionAt,
    newStatus,
    enrollSequenceId,
    autoEnrollRecommended,
    dealType,
    packageCode,
    projectTitle,
    replyBody,
    sendReplyChannel,
  } = parsed.data;

  const [activity, existingLead] = await Promise.all([
    prisma.activity.findUnique({
      where: { id: activityId },
      select: { id: true, leadId: true, type: true },
    }),
    prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        artist: {
          select: {
            name: true,
            instagramHandle: true,
            instagramProfileUrl: true,
            emails: true,
            followerCount: true,
          },
        },
      },
    }),
  ]);

  if (!activity || activity.leadId !== leadId) {
    return NextResponse.json({ error: "Activity not found for this lead" }, { status: 404 });
  }

  if (activity.type !== "REPLY_RECEIVED") {
    return NextResponse.json(
      { error: "Only REPLY_RECEIVED activities can be triaged" },
      { status: 400 }
    );
  }

  if (!existingLead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  const targetStatus: LeadStatus = newStatus ?? INTENT_STATUS_MAP[intent as ReplyIntent];
  const followUpActionType = inferFollowUpActionType(
    existingLead.artist,
    sendReplyChannel ?? null
  );

  const resolvedNextAction = nextActionAt
    ? new Date(nextActionAt)
    : intent === "NOT_NOW"
      ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
      : targetStatus === "FOLLOW_UP"
        ? new Date(Date.now() + 2 * 86400000)
        : undefined;

  const isTerminal = targetStatus === "WON" || targetStatus === "LOST";

  const { triage, updatedLead: txLead, enrollment, projectHandoff } =
    await prisma.$transaction(async (tx) => {
      const existingTriage = await tx.replyTriage.findUnique({
        where: { activityId },
      });

      const triageRecord = existingTriage
        ? await tx.replyTriage.update({
            where: { activityId },
            data: {
              intent: intent as ReplyIntent,
              note: note ?? null,
              triaged: true,
              triagedAt: new Date(),
            },
          })
        : await tx.replyTriage.create({
            data: {
              activityId,
              leadId,
              intent: intent as ReplyIntent,
              note: note ?? null,
              triaged: true,
              triagedAt: new Date(),
            },
          });

      await tx.lead.update({
        where: { id: leadId },
        data: {
          status: targetStatus,
          ...(targetStatus === "FOLLOW_UP" ? { followUpActionType } : {}),
          ...(isTerminal
            ? { nextActionAt: null }
            : resolvedNextAction
              ? { nextActionAt: resolvedNextAction }
              : {}),
        },
      });

      const intentLabel = intent.replace(/_/g, " ").toLowerCase();
      await tx.activity.create({
        data: {
          leadId,
          type: "STATUS_CHANGE",
          note: `Reply triaged as "${intentLabel}" → status updated to ${targetStatus}${note ? `. Note: ${note}` : ""}`,
          occurredAt: new Date(),
        },
      });

      if (isTerminal) {
        await pauseActiveEnrollmentsForLead({
          leadId,
          reason: `triaged as ${intentLabel}`,
          terminalStatus: "CANCELLED",
          db: tx,
        });
      } else if (targetStatus === "PAUSED" || intent === "UNCLEAR") {
        await pauseActiveEnrollmentsForLead({
          leadId,
          reason: `triaged as ${intentLabel}`,
          terminalStatus: "PAUSED",
          db: tx,
        });
      }

      let enrolledRecord = null;
      const explicitSeqId = enrollSequenceId?.trim();
      const recommendedSeqName = RECOMMENDED_SEQUENCE_BY_INTENT[intent as ReplyIntent];

      if (explicitSeqId) {
        enrolledRecord = await enrollLeadInSequence({
          leadId,
          sequenceId: explicitSeqId,
          startedAt: intent === "NOT_NOW" ? resolvedNextAction : undefined,
          db: tx,
        });
      } else if (
        enrollSequenceId === undefined &&
        autoEnrollRecommended &&
        recommendedSeqName
      ) {
        enrolledRecord = await enrollLeadInSequence({
          leadId,
          sequenceName: recommendedSeqName,
          startedAt: intent === "NOT_NOW" ? resolvedNextAction : undefined,
          db: tx,
        });
      }

      let handoffRecord = null;
      if (targetStatus === "WON") {
        handoffRecord = await ensureProjectHandoffOnClose({
          leadId,
          dealType,
          packageCode,
          customTitle: projectTitle,
          overwriteExistingInvoice: Boolean(dealType || packageCode),
          db: tx,
        });
      }

      const refreshedLead = await tx.lead.findUniqueOrThrow({
        where: { id: leadId },
        include: {
          artist: {
            select: {
              name: true,
              instagramHandle: true,
              emails: true,
              followerCount: true,
            },
          },
        },
      });

      return {
        triage: triageRecord,
        updatedLead: refreshedLead,
        enrollment: enrolledRecord,
        projectHandoff: handoffRecord,
      };
    });

  let finalLead = txLead;
  let replyWarning: string | undefined;
  let replyDelivery: {
    mode: "sent" | "draft_saved" | "fallback_draft";
    channel: "ig" | "email" | null;
    sent: boolean;
    draftId?: string;
    warning?: string;
    replyWarning?: string;
  } | null = null;

  const trimmedReply = replyBody?.trim();
  if (trimmedReply) {
    const artist = existingLead.artist;

    if (sendReplyChannel === "email") {
      const recipientEmail = artist.emails?.[0];
      if (!recipientEmail) {
        replyWarning = "Artist has no email address on file; saved reply as a draft instead.";
      } else {
        try {
          let subject = `Re: ${artist.name} x Spectral Soundworks`;
          let bodyText = trimmedReply;
          const subjectMatch = trimmedReply.match(/^Subject:\s*(.+?)(?:\r?\n\r?\n|\r?\n)/i);
          if (subjectMatch) {
            subject = subjectMatch[1].trim();
            bodyText = trimmedReply.slice(subjectMatch[0].length).trim();
          }
          await sendEmail(recipientEmail, subject, bodyText.replace(/\n/g, "<br>"));
          const sentAt = new Date();
          await prisma.activity.create({
            data: {
              leadId,
              type: "MESSAGE_SENT",
              note: `Sent triage email reply to ${recipientEmail}: "${bodyText.slice(0, 180)}"`,
              occurredAt: sentAt,
            },
          });
          finalLead = await prisma.lead.update({
            where: { id: leadId },
            data: { lastContactedAt: sentAt },
            include: {
              artist: {
                select: {
                  name: true,
                  instagramHandle: true,
                  emails: true,
                  followerCount: true,
                },
              },
            },
          });
          replyDelivery = { mode: "sent", channel: "email", sent: true };
        } catch (error) {
          replyWarning =
            error instanceof Error
              ? `SMTP delivery failed (${error.message}); saved reply as a draft instead.`
              : "SMTP delivery failed; saved reply as a draft instead.";
        }
      }

      if (replyWarning) {
        const savedDraft = await prisma.messageDraft.create({
          data: {
            leadId,
            tone: "Triage Email Reply",
            body: trimmedReply,
            source: "reachout",
            selected: false,
          },
        });
        replyDelivery = {
          mode: "fallback_draft",
          channel: "email",
          sent: false,
          draftId: savedDraft.id,
          warning: replyWarning,
          replyWarning,
        };
      }
    } else if (sendReplyChannel === "ig") {
      const webhookUrl = process.env.IG_DM_WEBHOOK_URL;
      if (!webhookUrl || !artist.instagramHandle) {
        replyWarning = !artist.instagramHandle
          ? "Artist has no Instagram handle on file; saved reply as a draft instead."
          : "IG DM bot webhook is not configured; saved reply as a draft instead.";
      } else {
        try {
          await ensureBotRunning();
          const botLogin = await isBotLoggedIn();
          if (!botLogin.loggedIn) {
            replyWarning =
              botLogin.error ||
              "IG DM bot is offline or not logged in; saved reply as a draft instead.";
          } else {
            const response = await fetch(webhookUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(process.env.IG_DM_WEBHOOK_SECRET
                  ? { "X-Webhook-Secret": process.env.IG_DM_WEBHOOK_SECRET }
                  : {}),
              },
              body: JSON.stringify({
                leadId,
                artist: {
                  name: artist.name,
                  instagramHandle: artist.instagramHandle,
                  instagramProfileUrl: artist.instagramProfileUrl,
                },
                message: {
                  body: trimmedReply,
                  source: "triage_reply",
                },
                followUpAt: finalLead.nextActionAt?.toISOString() ?? null,
              }),
            });

            if (!response.ok) {
              const errText = await response.text().catch(() => "");
              replyWarning = `IG DM bot returned HTTP ${response.status}${errText ? ` (${errText.slice(0, 80)})` : ""}; saved reply as a draft instead.`;
            } else {
              const sentAt = new Date();
              await prisma.activity.create({
                data: {
                  leadId,
                  type: "MESSAGE_SENT",
                  note: `Sent triage IG reply to @${artist.instagramHandle.replace(/^@/, "")}: "${trimmedReply.slice(0, 180)}"`,
                  occurredAt: sentAt,
                },
              });
              finalLead = await prisma.lead.update({
                where: { id: leadId },
                data: { lastContactedAt: sentAt },
                include: {
                  artist: {
                    select: {
                      name: true,
                      instagramHandle: true,
                      emails: true,
                      followerCount: true,
                    },
                  },
                },
              });
              replyDelivery = { mode: "sent", channel: "ig", sent: true };
            }
          }
        } catch (error) {
          replyWarning =
            error instanceof Error
              ? `IG DM bot unreachable (${error.message}); saved reply as a draft instead.`
              : "IG DM bot unreachable; saved reply as a draft instead.";
        }
      }

      if (replyWarning) {
        const savedDraft = await prisma.messageDraft.create({
          data: {
            leadId,
            tone: "IG Reply",
            body: trimmedReply,
            source: "reachout",
            selected: false,
          },
        });
        replyDelivery = {
          mode: "fallback_draft",
          channel: "ig",
          sent: false,
          draftId: savedDraft.id,
          warning: replyWarning,
          replyWarning,
        };
      }
    } else {
      const savedDraft = await prisma.messageDraft.create({
        data: {
          leadId,
          tone: artist.emails?.length ? "Triage Email Reply" : "IG Reply",
          body: trimmedReply,
          source: "reachout",
          selected: false,
        },
      });
      replyDelivery = {
        mode: "draft_saved",
        channel: null,
        sent: false,
        draftId: savedDraft.id,
      };
    }
  }

  revalidatePath("/replies");
  revalidatePath("/operations");
  revalidatePath("/sequences");
  revalidatePath("/projects");
  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);

  return NextResponse.json({
    ok: true,
    triage,
    lead: finalLead,
    enrollment,
    projectHandoff,
    replyDelivery,
    ...(replyWarning ? { replyWarning } : {}),
  });
}
