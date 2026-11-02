export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { triggerIgReplyNotification } from "@/lib/novu";
import { markRespondedRow } from "@/lib/google-sheets";
import { pauseActiveEnrollmentsForLead } from "@/lib/sequence-close-service";

/**
 * GET /api/ig/meta-webhook
 *
 * Meta calls this when you first register the webhook in the Developer Console.
 * It sends three query params and expects `hub.challenge` echoed back.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

  if (!verifyToken) {
    console.error("[meta-webhook] META_WEBHOOK_VERIFY_TOKEN is not set");
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  if (mode === "subscribe" && token === verifyToken) {
    console.log("[meta-webhook] ✅ Webhook verified by Meta");
    return new NextResponse(challenge, { status: 200 });
  }

  console.warn("[meta-webhook] Verification failed — token mismatch or wrong mode");
  return new NextResponse("Forbidden", { status: 403 });
}

/**
 * POST /api/ig/meta-webhook
 *
 * Meta posts here whenever an Instagram DM is received on your connected page.
 *
 * Payload shape:
 * {
 *   "object": "instagram",
 *   "entry": [{
 *     "id": "PAGE_ID",
 *     "messaging": [{
 *       "sender": { "id": "SENDER_PSID" },
 *       "recipient": { "id": "PAGE_ID" },
 *       "timestamp": 1234567890,
 *       "message": { "mid": "MSG_ID", "text": "Hey!" }
 *     }]
 *   }]
 * }
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Only handle Instagram webhooks
  if (body.object !== "instagram") {
    return NextResponse.json({ ok: true, skipped: "not instagram" });
  }

  const entries = (body.entry as Array<{
    id?: string;
    messaging?: Array<{
      sender?: { id?: string };
      recipient?: { id?: string };
      timestamp?: number;
      message?: { mid?: string; text?: string; is_echo?: boolean };
    }>;
  }>) ?? [];

  for (const entry of entries) {
    for (const event of entry.messaging ?? []) {
      // Skip echo messages (messages YOU sent — not replies from artists)
      if (event.message?.is_echo) continue;

      const senderId = event.sender?.id;
      const messageText = event.message?.text?.trim();

      if (!senderId || !messageText) continue;

      console.log(`[meta-webhook] Incoming DM from PSID ${senderId}: "${messageText.slice(0, 60)}..."`);

      // Look up Instagram username from the sender's PSID
      const instagramHandle = await resolveUsername(senderId);

      // Look up the lead
      let leadId: string | null = null;
      let artistName = instagramHandle ?? `IG User ${senderId}`;

      if (instagramHandle) {
        try {
          const artist = await prisma.artist.findFirst({
            where: { instagramHandle: { equals: instagramHandle, mode: "insensitive" } },
            include: { leads: { orderBy: { createdAt: "desc" }, take: 1 } },
          });

          if (artist?.leads?.[0]) {
            leadId = artist.leads[0].id;
            artistName = artist.name;

            await prisma.activity.create({
              data: {
                leadId,
                type: "REPLY_RECEIVED",
                note: `IG reply from @${instagramHandle}: "${messageText.slice(0, 200)}"`,
              },
            });

            await pauseActiveEnrollmentsForLead({
              leadId,
              reason: "artist replied on Instagram",
            });

            const lead = artist.leads[0];
            const shouldBumpToFollowUp = ["NEW", "QUALIFIED", "CONTACTED"].includes(
              lead.status
            );
            await prisma.lead.update({
              where: { id: leadId },
              data: {
                ...(shouldBumpToFollowUp ? { status: "FOLLOW_UP" } : {}),
                followUpActionType: "DM",
                nextActionAt:
                  lead.nextActionAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
              },
            });

            await markRespondedRow(artistName);

            console.log(`[meta-webhook] Matched lead ${leadId} for @${instagramHandle}`);
          } else {
            console.warn(`[meta-webhook] No lead found for @${instagramHandle} — notifying without DB record`);
          }
        } catch (err) {
          console.error("[meta-webhook] DB error:", err);
        }
      }

      await triggerIgReplyNotification({
        artistName,
        instagramHandle,
        leadId,
        messageSnippet: messageText.slice(0, 200),
      });
    }
  }

  // Meta requires a 200 response quickly — always return OK
  return NextResponse.json({ ok: true });
}

/**
 * Resolve an Instagram Page-Scoped User ID (PSID) to a username.
 * Requires META_PAGE_ACCESS_TOKEN to be set.
 */
async function resolveUsername(psid: string): Promise<string | null> {
  const accessToken = process.env.META_PAGE_ACCESS_TOKEN;
  if (!accessToken) {
    console.warn("[meta-webhook] META_PAGE_ACCESS_TOKEN not set — cannot resolve username from PSID");
    return null;
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${psid}?fields=username&access_token=${accessToken}`
    );

    if (!res.ok) {
      const text = await res.text();
      console.warn(`[meta-webhook] Username lookup failed (${res.status}):`, text.slice(0, 200));
      return null;
    }

    const data = (await res.json()) as { username?: string };
    return data.username ?? null;
  } catch (err) {
    console.error("[meta-webhook] Username lookup error:", err);
    return null;
  }
}
