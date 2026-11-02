export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pauseActiveEnrollmentsForLead } from "@/lib/sequence-close-service";
import { triggerIgReplyNotification } from "@/lib/novu";
import { fetchInstagramProfile } from "@/lib/instagram";

/**
 * POST /api/ig/reply
 *
 * This endpoint is called by your IG bot service when an artist replies
 * to an outreach DM. The bot should POST a JSON body like:
 *
 * {
 *   "instagramHandle": "someartist",
 *   "messageText": "Hey, thanks for reaching out!",
 *   "leadId": "optional-lead-id",
 *   "secret": "your-webhook-secret"   // optional HMAC or shared secret
 * }
 *
 * On receipt, this route:
 * 1. Verifies the shared secret (if IG_DM_WEBHOOK_SECRET is set)
 * 2. Looks up the lead by Instagram handle
 * 3. Logs the reply as a REPLY_RECEIVED Activity
 * 4. Triggers a Novu in-app notification to the operator
 */
export async function POST(req: NextRequest) {
  // --- 1. Parse body ---
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    instagramHandle,
    messageText,
    leadId: bodyLeadId,
    secret,
  } = body as {
    instagramHandle?: string;
    messageText?: string;
    leadId?: string;
    secret?: string;
  };

  // --- 2. Verify shared secret (if configured) ---
  const expectedSecret = process.env.IG_DM_WEBHOOK_SECRET;
  if (expectedSecret) {
    // The bot should pass the same secret value in the body or as a header
    const headerSecret = req.headers.get("x-webhook-secret");
    const providedSecret = secret ?? headerSecret;
    if (providedSecret !== expectedSecret) {
      console.warn("[ig/reply] Rejected request — secret mismatch");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!instagramHandle && !bodyLeadId) {
    return NextResponse.json(
      { error: "instagramHandle or leadId is required" },
      { status: 400 }
    );
  }

  const messageSnippet = messageText?.trim().slice(0, 200) ?? "Replied to your message.";

  // --- 3. Look up the lead ---
  let leadId: string | null = bodyLeadId ?? null;
  let artistName = instagramHandle ?? "Unknown Artist";
  let profileImageUrl: string | null = null;

  try {
    let lead = leadId
      ? await prisma.lead.findUnique({
          where: { id: leadId },
          include: { artist: true },
        })
      : null;

    // If no leadId provided, look up by Instagram handle
    if (!lead && instagramHandle) {
      const handle = instagramHandle.replace(/^@/, "").toLowerCase();
      const artist = await prisma.artist.findFirst({
        where: {
          instagramHandle: {
            equals: handle,
            mode: "insensitive",
          },
        },
        include: {
          leads: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });

      if (artist?.leads?.[0]) {
        lead = await prisma.lead.findUnique({
          where: { id: artist.leads[0].id },
          include: { artist: true },
        });
      }
    }

    if (lead) {
      leadId = lead.id;
      artistName = lead.artist.name;
      profileImageUrl = lead.artist.instagramProfileImageUrl;

      // Fetch profile image if we have the handle but no image URL
      if (instagramHandle && !profileImageUrl) {
        const igHandle = instagramHandle.replace(/^@/, "");
        try {
          const profile = await fetchInstagramProfile(igHandle);
          if (profile?.profileImageUrl) {
            profileImageUrl = profile.profileImageUrl;
            // Optionally cache this back to the artist record
            await prisma.artist.update({
              where: { id: lead.artistId },
              data: { instagramProfileImageUrl: profileImageUrl },
            });
          }
        } catch (err) {
          console.warn("[ig/reply] Failed to fetch profile image:", err);
        }
      }

      // --- 4. Log the reply as an Activity ---
      await prisma.activity.create({
        data: {
          leadId: lead.id,
          type: "REPLY_RECEIVED",
          note: `IG reply from @${instagramHandle ?? lead.artist.instagramHandle}: "${messageSnippet}"`,
        },
      });

      await pauseActiveEnrollmentsForLead({
        leadId: lead.id,
        reason: "artist replied on Instagram",
      });

      // Update lead status to FOLLOW_UP if they're in pre-reply outreach state
      if (["NEW", "QUALIFIED", "CONTACTED"].includes(lead.status)) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            status: "FOLLOW_UP",
            followUpActionType: "DM",
            nextActionAt: lead.nextActionAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });
      }

      console.log(`[ig/reply] Logged reply from ${artistName} (lead ${leadId})`);
    } else {
      // Try to fetch profile image for the artist even if no lead exists
      if (instagramHandle) {
        const igHandle = instagramHandle.replace(/^@/, "");
        try {
          const profile = await fetchInstagramProfile(igHandle);
          if (profile?.profileImageUrl) {
            profileImageUrl = profile.profileImageUrl;
          }
        } catch (err) {
          console.warn("[ig/reply] Failed to fetch profile image:", err);
        }
      }
    }
  } catch (err) {
    console.error("[ig/reply] DB error:", err);
    // Still try to send the notification even if DB fails
  }

  // --- 5. Trigger Novu in-app notification ---
  await triggerIgReplyNotification({
    artistName,
    artistImageUrl: profileImageUrl,
    instagramHandle,
    leadId,
    messageSnippet,
  });

  return NextResponse.json({ ok: true });
}

/**
 * GET /api/ig/reply
 * Health check for the webhook URL (some bots verify the endpoint before use)
 */
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "ig-reply-webhook" });
}
