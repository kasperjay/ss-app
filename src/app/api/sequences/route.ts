import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureDefaultSequences } from "@/lib/sequence-close-service";
import { z } from "zod";

const CreateSequenceSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().optional(),
  isDefault: z.boolean().optional(),
  steps: z
    .array(
      z.object({
        dayOffset: z.number().int().min(0),
        tone: z.string().min(1),
        promptHint: z.string().min(1),
      })
    )
    .min(1),
});

export async function GET() {
  await ensureDefaultSequences();

  const sequences = await prisma.followUpSequence.findMany({
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    include: {
      _count: { select: { enrollments: true } },
      enrollments: {
        orderBy: { updatedAt: "desc" },
        take: 50,
        include: {
          lead: {
            select: {
              id: true,
              status: true,
              nextActionAt: true,
              artist: {
                select: {
                  name: true,
                  instagramHandle: true,
                  followerCount: true,
                },
              },
            },
          },
        },
      },
    },
  });

  return NextResponse.json({ sequences });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CreateSequenceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }

  const sequence = await prisma.followUpSequence.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      isDefault: parsed.data.isDefault ?? false,
      steps: parsed.data.steps,
    },
  });

  revalidatePath("/sequences");

  return NextResponse.json({ sequence }, { status: 201 });
}
