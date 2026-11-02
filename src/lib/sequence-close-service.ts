import type { Prisma } from "local-prisma-client";
import { prisma } from "@/lib/prisma";
import { buildBookingUrl } from "@/lib/google-calendar";
import { generateInvoiceNumber } from "@/lib/invoice";
import { getBestShowContext } from "@/lib/show-parser";
import { isLowFollowerArtist } from "@/lib/portfolio-priority";
import {
  DEFAULT_SEQUENCES,
  buildCloseProjectSpec,
  buildSequenceStepDrafts,
  computeStepDueDate,
  inferFollowUpActionType,
  resolveInitialStepIndex,
  type CloseDealType,
  type SequenceStepDef,
} from "@/lib/reply-to-close-core";

type DbClient = Prisma.TransactionClient | typeof prisma;

export async function ensureDefaultSequences(db: DbClient = prisma) {
  const existing = await db.followUpSequence.findMany({
    select: { id: true, name: true },
  });
  const byName = new Set(existing.map((s) => s.name));

  for (const seq of DEFAULT_SEQUENCES) {
    if (!byName.has(seq.name)) {
      await db.followUpSequence.create({
        data: {
          name: seq.name,
          description: seq.description,
          isDefault: seq.isDefault,
          steps: seq.steps,
        },
      });
    }
  }

  return db.followUpSequence.findMany({
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
}

export async function pauseActiveEnrollmentsForLead(params: {
  leadId: string;
  reason: string;
  terminalStatus?: "PAUSED" | "CANCELLED";
  db?: DbClient;
}) {
  const db = params.db ?? prisma;
  const targetStatus = params.terminalStatus ?? "PAUSED";
  const now = new Date();

  const active = await db.leadSequenceEnrollment.findMany({
    where: { leadId: params.leadId, status: "ACTIVE" },
    include: { sequence: { select: { name: true } } },
  });

  if (active.length === 0) return { count: 0 };

  await db.leadSequenceEnrollment.updateMany({
    where: { leadId: params.leadId, status: "ACTIVE" },
    data: {
      status: targetStatus,
      pausedAt: now,
    },
  });

  const names = active.map((e) => `"${e.sequence.name}"`).join(", ");
  await db.activity.create({
    data: {
      leadId: params.leadId,
      type: "NOTE",
      note: `[SEQUENCE] ${targetStatus === "CANCELLED" ? "Stopped" : "Paused"} ${names} (${params.reason}).`,
      occurredAt: now,
    },
  });

  return { count: active.length };
}

export async function enrollLeadInSequence(params: {
  leadId: string;
  sequenceId?: string | null;
  sequenceName?: string | null;
  afterOutboundSend?: boolean;
  startedAt?: Date;
  onlyIfNoExistingEnrollment?: boolean;
  db?: DbClient;
}) {
  const db = params.db ?? prisma;
  await ensureDefaultSequences(db);

  const lead = await db.lead.findUnique({
    where: { id: params.leadId },
    include: {
      artist: { select: { name: true, instagramHandle: true, emails: true } },
    },
  });
  if (!lead) {
    throw new Error("Lead not found");
  }

  if (params.onlyIfNoExistingEnrollment) {
    const existingAny = await db.leadSequenceEnrollment.findFirst({
      where: {
        leadId: params.leadId,
        status: { in: ["ACTIVE", "PAUSED", "COMPLETED"] },
      },
      select: { id: true },
    });
    if (existingAny) {
      return null;
    }
  }

  const sequence = params.sequenceId
    ? await db.followUpSequence.findUnique({ where: { id: params.sequenceId } })
    : params.sequenceName
      ? await db.followUpSequence.findFirst({ where: { name: params.sequenceName } })
      : await db.followUpSequence.findFirst({
          where: { isDefault: true },
          orderBy: { createdAt: "asc" },
        });

  if (!sequence) {
    throw new Error("Follow-up sequence not found");
  }

  const steps = Array.isArray(sequence.steps)
    ? (sequence.steps as unknown as SequenceStepDef[])
    : [];
  if (steps.length === 0) {
    throw new Error(`Sequence "${sequence.name}" has no steps`);
  }

  const now = new Date();
  const startedAt = params.startedAt ?? now;
  const initialStep = resolveInitialStepIndex(steps, {
    afterOutboundSend: params.afterOutboundSend,
  });

  // Pause any other active enrollment on a different sequence so only one sequence runs at a time
  await db.leadSequenceEnrollment.updateMany({
    where: {
      leadId: params.leadId,
      status: "ACTIVE",
      sequenceId: { not: sequence.id },
    },
    data: { status: "CANCELLED", pausedAt: now },
  });

  const enrollment = await db.leadSequenceEnrollment.upsert({
    where: {
      leadId_sequenceId: {
        leadId: params.leadId,
        sequenceId: sequence.id,
      },
    },
    create: {
      leadId: params.leadId,
      sequenceId: sequence.id,
      currentStep: initialStep,
      startedAt,
      status: "ACTIVE",
      completedAt: null,
      pausedAt: null,
    },
    update: {
      currentStep: initialStep,
      startedAt,
      status: "ACTIVE",
      completedAt: null,
      pausedAt: null,
    },
    include: { sequence: true },
  });

  const nextStepDef = steps[initialStep];
  const nextDue = nextStepDef ? computeStepDueDate(startedAt, nextStepDef) : null;
  const followUpActionType = inferFollowUpActionType(lead.artist);

  if (nextDue) {
    await db.lead.update({
      where: { id: params.leadId },
      data: {
        nextActionAt: nextDue,
        followUpActionType,
      },
    });
  }

  await db.activity.create({
    data: {
      leadId: params.leadId,
      type: "NOTE",
      note: `[SEQUENCE] Enrolled in "${sequence.name}" (step ${initialStep + 1}/${steps.length}: ${nextStepDef?.tone ?? "follow-up"}).`,
      occurredAt: now,
    },
  });

  return enrollment;
}

export async function updateEnrollmentLifecycle(params: {
  enrollmentId: string;
  action: "PAUSE" | "RESUME" | "CANCEL";
  db?: DbClient;
}) {
  const db = params.db ?? prisma;
  const now = new Date();

  const existing = await db.leadSequenceEnrollment.findUnique({
    where: { id: params.enrollmentId },
    include: {
      sequence: true,
      lead: { include: { artist: { select: { instagramHandle: true, emails: true } } } },
    },
  });

  if (!existing) {
    throw new Error("Enrollment not found");
  }

  if (params.action === "PAUSE") {
    const updated = await db.leadSequenceEnrollment.update({
      where: { id: existing.id },
      data: { status: "PAUSED", pausedAt: now },
      include: { sequence: true },
    });
    await db.activity.create({
      data: {
        leadId: existing.leadId,
        type: "NOTE",
        note: `[SEQUENCE] Paused "${existing.sequence.name}".`,
        occurredAt: now,
      },
    });
    return updated;
  }

  if (params.action === "CANCEL") {
    const updated = await db.leadSequenceEnrollment.update({
      where: { id: existing.id },
      data: { status: "CANCELLED", pausedAt: now },
      include: { sequence: true },
    });
    await db.activity.create({
      data: {
        leadId: existing.leadId,
        type: "NOTE",
        note: `[SEQUENCE] Cancelled "${existing.sequence.name}".`,
        occurredAt: now,
      },
    });
    return updated;
  }

  // RESUME: shift startedAt forward by paused duration so remaining steps schedule cleanly from now
  const steps = Array.isArray(existing.sequence.steps)
    ? (existing.sequence.steps as unknown as SequenceStepDef[])
    : [];
  const stepDef = steps[existing.currentStep];
  const stepOffsetMs = Math.max(0, Number(stepDef?.dayOffset) || 0) * 86400000;
  const adjustedStartedAt = new Date(now.getTime() - stepOffsetMs + 86400000);
  const nextDue = stepDef ? computeStepDueDate(adjustedStartedAt, stepDef) : null;

  const updated = await db.leadSequenceEnrollment.update({
    where: { id: existing.id },
    data: {
      status: "ACTIVE",
      pausedAt: null,
      startedAt: adjustedStartedAt,
    },
    include: { sequence: true },
  });

  if (nextDue) {
    await db.lead.update({
      where: { id: existing.leadId },
      data: {
        nextActionAt: nextDue,
        followUpActionType: inferFollowUpActionType(existing.lead.artist),
      },
    });
  }

  await db.activity.create({
    data: {
      leadId: existing.leadId,
      type: "NOTE",
      note: `[SEQUENCE] Resumed "${existing.sequence.name}" at step ${existing.currentStep + 1}/${steps.length}.`,
      occurredAt: now,
    },
  });

  return updated;
}

export async function advanceDueEnrollments(options?: {
  enrollmentId?: string;
  leadId?: string;
  forceNow?: boolean;
  dryRun?: boolean;
}) {
  const now = new Date();
  const where: Prisma.LeadSequenceEnrollmentWhereInput = {
    status: "ACTIVE",
    ...(options?.enrollmentId ? { id: options.enrollmentId } : {}),
    ...(options?.leadId ? { leadId: options.leadId } : {}),
  };

  const enrollments = await prisma.leadSequenceEnrollment.findMany({
    where,
    include: {
      sequence: true,
      lead: {
        include: {
          artist: {
            include: {
              releases: {
                orderBy: [{ releaseDate: "desc" }, { createdAt: "desc" }],
                take: 1,
              },
            },
          },
          activities: {
            orderBy: { occurredAt: "desc" },
            take: 10,
          },
        },
      },
    },
  });

  const results = {
    checked: enrollments.length,
    advanced: 0,
    completed: 0,
    draftsCreated: 0,
    skipped: 0,
    errors: 0,
  };

  for (const enrollment of enrollments) {
    const { lead, sequence } = enrollment;

    // Never advance sequences on terminal leads
    if (["WON", "LOST"].includes(lead.status)) {
      if (!options?.dryRun) {
        await prisma.leadSequenceEnrollment.update({
          where: { id: enrollment.id },
          data: { status: "CANCELLED", pausedAt: now },
        });
      }
      results.skipped++;
      continue;
    }

    const steps = Array.isArray(sequence.steps)
      ? (sequence.steps as unknown as SequenceStepDef[])
      : [];
    if (steps.length === 0) {
      results.skipped++;
      continue;
    }

    if (enrollment.currentStep >= steps.length) {
      if (!options?.dryRun) {
        await prisma.leadSequenceEnrollment.update({
          where: { id: enrollment.id },
          data: { status: "COMPLETED", completedAt: now },
        });
      }
      results.completed++;
      continue;
    }

    const step = steps[enrollment.currentStep];
    const stepDueAt = computeStepDueDate(enrollment.startedAt, step);

    if (!options?.forceNow && stepDueAt > now) {
      results.skipped++;
      continue;
    }

    const showContext = getBestShowContext(lead.activities, now);
    const bookingUrl = buildBookingUrl({
      artistName: lead.artist.name,
      artistEmail: lead.artist.emails?.[0] ?? null,
      artistHandle: lead.artist.instagramHandle,
    });

    const generatedDrafts = buildSequenceStepDrafts({
      artistName: lead.artist.name,
      instagramHandle: lead.artist.instagramHandle,
      emails: lead.artist.emails,
      followerCount: lead.artist.followerCount,
      genre: lead.artist.genre,
      latestReleaseTitle: lead.artist.releases?.[0]?.title ?? null,
      upcomingVenue: showContext?.upcomingShow?.venue ?? null,
      bookingUrl,
      sequenceName: sequence.name,
      stepIndex: enrollment.currentStep,
      totalSteps: steps.length,
      step,
    });

    if (options?.dryRun) {
      results.advanced++;
      results.draftsCreated += generatedDrafts.length;
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        for (const draft of generatedDrafts) {
          await tx.messageDraft.create({
            data: {
              leadId: lead.id,
              tone: draft.tone,
              body: draft.body,
              source: draft.source,
              selected: false,
            },
          });
        }

        const nextStep = enrollment.currentStep + 1;
        const isLast = nextStep >= steps.length;

        await tx.leadSequenceEnrollment.update({
          where: { id: enrollment.id },
          data: {
            currentStep: nextStep,
            status: isLast ? "COMPLETED" : "ACTIVE",
            completedAt: isLast ? now : null,
          },
        });

        const nextStepDef = !isLast ? steps[nextStep] : null;
        const nextDueAt = nextStepDef
          ? computeStepDueDate(enrollment.startedAt, nextStepDef)
          : now;

        await tx.lead.update({
          where: { id: lead.id },
          data: {
            status: lead.status === "CONTACTED" ? "FOLLOW_UP" : lead.status,
            nextActionAt: isLast ? now : nextDueAt,
            followUpActionType: inferFollowUpActionType(lead.artist),
          },
        });

        await tx.activity.create({
          data: {
            leadId: lead.id,
            type: "NOTE",
            note: `[SEQUENCE] "${sequence.name}" step ${enrollment.currentStep + 1}/${steps.length} ready for review (${step.tone}).`,
            occurredAt: now,
          },
        });

        if (isLast) {
          results.completed++;
        }
      });

      results.advanced++;
      results.draftsCreated += generatedDrafts.length;
    } catch (error) {
      console.error("[sequence-close-service] Error advancing enrollment", enrollment.id, error);
      results.errors++;
    }
  }

  return results;
}

export async function ensureProjectHandoffOnClose(params: {
  leadId: string;
  dealType?: CloseDealType;
  packageCode?: string | null;
  customTitle?: string | null;
  overwriteExistingInvoice?: boolean;
  db?: DbClient;
}) {
  const db = params.db ?? prisma;
  const now = new Date();

  const lead = await db.lead.findUnique({
    where: { id: params.leadId },
    include: {
      artist: {
        select: {
          id: true,
          name: true,
          followerCount: true,
        },
      },
    },
  });

  if (!lead) {
    throw new Error("Lead not found");
  }

  const defaultDealType: CloseDealType = isLowFollowerArtist(lead.artist)
    ? "PORTFOLIO_FREE"
    : "PAID";
  const spec = buildCloseProjectSpec({
    artistName: lead.artist.name,
    dealType: params.dealType ?? defaultDealType,
    packageCode: params.packageCode ?? "MIX_MASTER_BUNDLE",
    customTitle: params.customTitle,
  });

  // Cancel any active outreach sequences now that the lead has closed
  await pauseActiveEnrollmentsForLead({
    leadId: lead.id,
    reason: "lead closed as WON",
    terminalStatus: "CANCELLED",
    db,
  });

  const existingProject = await db.project.findFirst({
    where: { artistId: lead.artist.id, status: "ACTIVE" },
    include: { invoice: true },
    orderBy: { createdAt: "desc" },
  });

  let created = false;
  let project = existingProject;

  if (!project) {
    created = true;
    project = await db.project.create({
      data: {
        artistId: lead.artist.id,
        title: spec.title,
        status: "ACTIVE",
        workflowStage: "IN_MIXING",
        paywallDeliverables: spec.paywallDeliverables,
      },
      include: { invoice: true },
    });
  } else if (params.overwriteExistingInvoice) {
    project = await db.project.update({
      where: { id: project.id },
      data: {
        title: params.customTitle?.trim() || project.title || spec.title,
        paywallDeliverables: spec.paywallDeliverables,
      },
      include: { invoice: true },
    });
  }

  let matchedTemplateId: string | null = null;
  if (spec.templateCode) {
    const matchedTpl = await db.invoiceTemplate.findFirst({
      where: { code: spec.templateCode },
      select: { id: true },
    });
    matchedTemplateId = matchedTpl?.id ?? null;
  }

  let invoice = project.invoice;
  if (!invoice) {
    invoice = await db.projectInvoice.create({
      data: {
        projectId: project.id,
        templateId: matchedTemplateId,
        invoiceNumber: generateInvoiceNumber(project.id),
        status: spec.invoiceStatus,
        issuedAt: now,
        paidAt: spec.invoiceStatus === "PAID" ? now : null,
        paymentReference:
          spec.dealType === "PORTFOLIO_FREE"
            ? "Complimentary Portfolio First-Song Collaboration"
            : null,
        currency: "USD",
        lineItems: spec.lineItems,
        subtotalCents: spec.subtotalCents,
        taxCents: spec.taxCents,
        totalCents: spec.totalCents,
        notes: spec.notes,
      },
    });
  } else if (params.overwriteExistingInvoice) {
    invoice = await db.projectInvoice.update({
      where: { id: invoice.id },
      data: {
        templateId: matchedTemplateId,
        status: spec.invoiceStatus,
        paidAt: spec.invoiceStatus === "PAID" ? now : null,
        paymentReference:
          spec.dealType === "PORTFOLIO_FREE"
            ? "Complimentary Portfolio First-Song Collaboration"
            : invoice.paymentReference,
        lineItems: spec.lineItems,
        subtotalCents: spec.subtotalCents,
        taxCents: spec.taxCents,
        totalCents: spec.totalCents,
        notes: spec.notes,
      },
    });
  }

  if (created || params.overwriteExistingInvoice) {
    await db.projectActivityLog.create({
      data: {
        projectId: project.id,
        actorRole: "ENGINEER",
        action: created ? "PROJECT_CREATED_FROM_CLOSE" : "PROJECT_SCOPE_UPDATED",
        metadata: {
          leadId: lead.id,
          dealType: spec.dealType,
          packageCode: spec.templateCode,
          totalCents: spec.totalCents,
        },
      },
    });

    await db.activity.create({
      data: {
        leadId: lead.id,
        type: "NOTE",
        note:
          spec.dealType === "PORTFOLIO_FREE"
            ? `[CLOSE → PROJECT] Created Portfolio Collaboration workspace "${project.title}" ($0 complimentary first song · portal /portal/${project.portalToken}).`
            : `[CLOSE → PROJECT] Created studio project "${project.title}" ($${(spec.totalCents / 100).toFixed(2)} invoice · portal /portal/${project.portalToken}).`,
        occurredAt: now,
      },
    });
  }

  return {
    created,
    dealType: spec.dealType,
    project: {
      id: project.id,
      title: project.title,
      portalToken: project.portalToken,
      portalPath: `/portal/${project.portalToken}`,
      projectPath: `/projects/${project.id}`,
      paywallDeliverables: project.paywallDeliverables,
      workflowStage: project.workflowStage,
    },
    invoice: {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      totalCents: invoice.totalCents,
    },
  };
}
