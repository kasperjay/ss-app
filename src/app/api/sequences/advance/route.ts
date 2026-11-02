import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { advanceDueEnrollments } from "@/lib/sequence-close-service";

const AdvanceSequencesSchema = z.object({
  enrollmentId: z.string().min(1).optional(),
  leadId: z.string().min(1).optional(),
  forceNow: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  let rawBody: unknown = {};
  const rawText = await req.text();
  if (rawText.trim()) {
    try {
      rawBody = JSON.parse(rawText);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  }

  const parsed = AdvanceSequencesSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }

  try {
    const results = await advanceDueEnrollments(parsed.data);

    revalidatePath("/sequences");
    revalidatePath("/operations");
    revalidatePath("/leads");
    if (parsed.data.leadId) {
      revalidatePath(`/leads/${parsed.data.leadId}`);
    }

    return NextResponse.json({ ok: true, results });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to advance due enrollments";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
