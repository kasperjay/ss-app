import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { inferFollowUpActionType } from "@/lib/reply-to-close-core";
import { pauseActiveEnrollmentsForLead } from "@/lib/sequence-close-service";

const LogReplySchema = z
  .object({
    leadId: z.string().min(1),
    channel: z
      .enum(["EMAIL", "INSTAGRAM_DM", "SMS", "PHONE", "IN_PERSON", "OTHER"])
      .default("EMAIL"),
    message: z.string().trim().min(1).max(4000).optional(),
    messageText: z.string().trim().min(1).max(4000).optional(),
  })
  .refine((val) => Boolean(val.message || val.messageText), {
    message: "Reply message is required",
    path: ["message"],
  });

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = LogReplySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }

  const { leadId, channel } = parsed.data;
  const trimmedMessage = (parsed.data.message ?? parsed.data.messageText ?? "").trim();

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      artist: {
        select: {
          name: true,
          instagramHandle: true,
          emails: true,
        },
      },
    },
  });

  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  const cleanHandle = lead.artist.instagramHandle?.replace(/^@/, "");
  const note =
    channel === "EMAIL"
      ? `Email reply from ${lead.artist.name}: "${trimmedMessage}"`
      : channel === "INSTAGRAM_DM"
        ? `IG reply from ${cleanHandle ? `@${cleanHandle}` : lead.artist.name}: "${trimmedMessage}"`
        : `${channel} reply from ${lead.artist.name}: "${trimmedMessage}"`;

  const preferredChannel =
    channel === "EMAIL"
      ? "email"
      : channel === "INSTAGRAM_DM"
        ? "ig"
        : channel === "PHONE"
          ? "call"
          : null;

  const activity = await prisma.$transaction(async (tx) => {
    const createdActivity = await tx.activity.create({
      data: {
        leadId,
        type: "REPLY_RECEIVED",
        note,
        occurredAt: new Date(),
      },
    });

    await pauseActiveEnrollmentsForLead({
      leadId,
      reason: "inbound reply logged",
      db: tx,
    });

    if (["NEW", "QUALIFIED", "CONTACTED"].includes(lead.status)) {
      await tx.lead.update({
        where: { id: leadId },
        data: {
          status: "FOLLOW_UP",
          followUpActionType: inferFollowUpActionType(lead.artist, preferredChannel),
          nextActionAt: lead.nextActionAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    }

    return createdActivity;
  });

  revalidatePath("/replies");
  revalidatePath("/operations");
  revalidatePath("/sequences");
  revalidatePath(`/leads/${leadId}`);

  return NextResponse.json({ ok: true, activity });
}
