import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  advanceDueEnrollments,
  enrollLeadInSequence,
  updateEnrollmentLifecycle,
} from "@/lib/sequence-close-service";

const EnrollLeadSchema = z.object({
  leadId: z.string().min(1),
  afterOutboundSend: z.boolean().optional(),
});

const LifecyclePatchSchema = z.object({
  enrollmentId: z.string().min(1),
  action: z.enum(["PAUSE", "RESUME", "CANCEL", "ADVANCE_NOW"]),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = EnrollLeadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }

  const { leadId, afterOutboundSend } = parsed.data;

  try {
    const enrollment = await enrollLeadInSequence({
      leadId,
      sequenceId: id,
      afterOutboundSend,
    });

    revalidatePath("/sequences");
    revalidatePath("/operations");
    revalidatePath("/replies");
    revalidatePath(`/leads/${leadId}`);

    return NextResponse.json({ ok: true, enrollment });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to enroll lead in sequence";
    const status = /not found/i.test(message) ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = LifecyclePatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }

  const { enrollmentId, action } = parsed.data;

  try {
    const result =
      action === "ADVANCE_NOW"
        ? await advanceDueEnrollments({ enrollmentId, forceNow: true })
        : await updateEnrollmentLifecycle({ enrollmentId, action });

    revalidatePath("/sequences");
    revalidatePath("/operations");
    revalidatePath("/leads");
    if (result && "leadId" in result && typeof result.leadId === "string") {
      revalidatePath(`/leads/${result.leadId}`);
    }

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update enrollment";
    const status = /not found/i.test(message) ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
