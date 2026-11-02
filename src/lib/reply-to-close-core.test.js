/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  INTENT_STATUS_MAP,
  DEFAULT_SEQUENCES,
  RECOMMENDED_SEQUENCE_BY_INTENT,
  inferFollowUpActionType,
  resolveInitialStepIndex,
  computeStepDueDate,
  buildSequenceStepDrafts,
  buildTriageReplySuggestion,
  buildCloseProjectSpec,
} = require("./reply-to-close-core");

test("INTENT_STATUS_MAP maps all 7 ReplyIntent values to expected LeadStatus", () => {
  assert.deepEqual(INTENT_STATUS_MAP, {
    INTERESTED: "FOLLOW_UP",
    NOT_NOW: "PAUSED",
    PRICING_REQUEST: "FOLLOW_UP",
    WRONG_CONTACT: "LOST",
    UNSUBSCRIBED: "LOST",
    BOOKED: "WON",
    UNCLEAR: "FOLLOW_UP",
  });
});

test("DEFAULT_SEQUENCES defines all 4 cadences and aligns with RECOMMENDED_SEQUENCE_BY_INTENT", () => {
  assert.equal(DEFAULT_SEQUENCES.length, 4);
  const names = DEFAULT_SEQUENCES.map((seq) => seq.name);
  assert.deepEqual(names, [
    "Standard Outreach Cadence",
    "Interested Consultation Cadence",
    "Pricing Follow-Up Cadence",
    "Re-engagement Cadence",
  ]);

  for (const seq of DEFAULT_SEQUENCES) {
    assert.ok(seq.steps.length >= 2, `${seq.name} should have at least 2 steps`);
    for (const step of seq.steps) {
      assert.equal(typeof step.dayOffset, "number");
      assert.ok(step.dayOffset >= 0);
      assert.ok(step.tone.length > 0);
      assert.ok(step.promptHint.length > 0);
    }
  }

  assert.equal(RECOMMENDED_SEQUENCE_BY_INTENT.INTERESTED, "Interested Consultation Cadence");
  assert.equal(RECOMMENDED_SEQUENCE_BY_INTENT.PRICING_REQUEST, "Pricing Follow-Up Cadence");
  assert.equal(RECOMMENDED_SEQUENCE_BY_INTENT.NOT_NOW, "Re-engagement Cadence");
  assert.equal(RECOMMENDED_SEQUENCE_BY_INTENT.UNCLEAR, null);
  assert.equal(RECOMMENDED_SEQUENCE_BY_INTENT.BOOKED, null);
  assert.equal(RECOMMENDED_SEQUENCE_BY_INTENT.WRONG_CONTACT, null);
  assert.equal(RECOMMENDED_SEQUENCE_BY_INTENT.UNSUBSCRIBED, null);

  for (const rec of Object.values(RECOMMENDED_SEQUENCE_BY_INTENT)) {
    if (rec !== null) {
      assert.ok(names.includes(rec), `Recommended sequence "${rec}" must exist in DEFAULT_SEQUENCES`);
    }
  }
});

test("inferFollowUpActionType respects preferredChannel and artist contact availability", () => {
  const both = { instagramHandle: "neonhorizon", emails: ["band@neon.com"] };
  const igOnly = { instagramHandle: "neonhorizon", emails: [] };
  const emailOnly = { instagramHandle: null, emails: ["band@neon.com"] };
  const none = { instagramHandle: null, emails: [] };

  assert.equal(inferFollowUpActionType(both, "call"), "CALL");
  assert.equal(inferFollowUpActionType(both, "email"), "EMAIL");
  assert.equal(inferFollowUpActionType(both, "ig"), "DM");
  assert.equal(inferFollowUpActionType(both, null), "DM");

  assert.equal(inferFollowUpActionType(igOnly, "email"), "DM");
  assert.equal(inferFollowUpActionType(emailOnly, "ig"), "EMAIL");
  assert.equal(inferFollowUpActionType(emailOnly), "EMAIL");
  assert.equal(inferFollowUpActionType(none), "OTHER");
  assert.equal(inferFollowUpActionType(null), "OTHER");
  assert.equal(inferFollowUpActionType(undefined), "OTHER");
});

test("resolveInitialStepIndex skips dayOffset 0 after outbound send when later steps exist", () => {
  const standardSteps = DEFAULT_SEQUENCES[0].steps;
  const interestedSteps = DEFAULT_SEQUENCES[1].steps;

  assert.equal(resolveInitialStepIndex(standardSteps, { afterOutboundSend: true }), 1);
  assert.equal(resolveInitialStepIndex(standardSteps, { afterOutboundSend: false }), 0);
  assert.equal(resolveInitialStepIndex(standardSteps), 0);
  assert.equal(resolveInitialStepIndex(interestedSteps, { afterOutboundSend: true }), 0);
  assert.equal(resolveInitialStepIndex([{ dayOffset: 0 }], { afterOutboundSend: true }), 0);
  assert.equal(resolveInitialStepIndex([], { afterOutboundSend: true }), 0);
});

test("computeStepDueDate offsets accurately from Date, ISO string, or epoch ms", () => {
  const baseIso = "2026-11-01T12:00:00.000Z";
  const baseDate = new Date(baseIso);

  assert.equal(
    computeStepDueDate(baseDate, { dayOffset: 4 }).toISOString(),
    "2026-11-05T12:00:00.000Z"
  );
  assert.equal(
    computeStepDueDate(baseIso, { dayOffset: 0 }).toISOString(),
    "2026-11-01T12:00:00.000Z"
  );
  assert.equal(
    computeStepDueDate(baseDate.getTime(), { dayOffset: -3 }).toISOString(),
    "2026-11-01T12:00:00.000Z"
  );
});

test("buildSequenceStepDrafts produces real IG + Email copy with zero stubs and enforces <5k portfolio offer rules", () => {
  for (const seq of DEFAULT_SEQUENCES) {
    seq.steps.forEach((step, idx) => {
      const under5kDrafts = buildSequenceStepDrafts({
        artistName: "Velvet Static",
        instagramHandle: "velvetstatic",
        emails: ["velvet@atx.music"],
        followerCount: 1450,
        genre: "Shoestring Indie",
        latestReleaseTitle: "Glass Highway",
        upcomingVenue: "Mohawk",
        bookingUrl: "https://calendar.google.com/calendar/render?action=TEMPLATE",
        sequenceName: seq.name,
        stepIndex: idx,
        totalSteps: seq.steps.length,
        step,
      });

      assert.equal(under5kDrafts.length, 2);
      assert.deepEqual(
        under5kDrafts.map((d) => d.channel),
        ["ig", "email"]
      );

      for (const draft of under5kDrafts) {
        assert.ok(!draft.body.includes("[SEQUENCE DRAFT"), "Must never emit stub placeholders");
        assert.ok(!draft.body.includes("TODO"), "Must never emit TODO placeholders");
        assert.ok(draft.body.includes("Velvet Static"));
        assert.equal(draft.source, `sequence:${seq.name}:step${idx}`);
        if (draft.channel === "email") {
          assert.match(draft.body, /^Subject:\s+/);
        }
      }
    });
  }

  const checkInUnder5k = buildSequenceStepDrafts({
    artistName: "Sub5k Band",
    instagramHandle: "sub5k",
    emails: ["hi@sub5k.com"],
    followerCount: 2200,
    sequenceName: "Standard Outreach Cadence",
    stepIndex: 1,
    totalSteps: 3,
    step: DEFAULT_SEQUENCES[0].steps[1],
  });
  assert.match(checkInUnder5k[0].body, /completely free|no cost|complimentary/i);
  assert.match(checkInUnder5k[1].body, /no cost|complimentary/i);

  const checkInOver5k = buildSequenceStepDrafts({
    artistName: "Arena Act",
    instagramHandle: "arenaact",
    emails: ["mgmt@arenaact.com"],
    followerCount: 8400,
    sequenceName: "Standard Outreach Cadence",
    stepIndex: 1,
    totalSteps: 3,
    step: DEFAULT_SEQUENCES[0].steps[1],
  });
  assert.doesNotMatch(checkInOver5k[0].body, /completely free|no cost|complimentary/i);
  assert.doesNotMatch(checkInOver5k[1].body, /completely free|no cost|complimentary/i);
});

test("buildTriageReplySuggestion tailors templates across all ReplyIntent values", () => {
  const interestedUnder5k = buildTriageReplySuggestion({
    intent: "INTERESTED",
    artistName: "Luna Moth",
    followerCount: 1800,
    bookingUrl: "https://cal.example/kasper",
  });
  assert.match(interestedUnder5k, /no cost/);
  assert.match(interestedUnder5k, /https:\/\/cal\.example\/kasper/);

  const pricingUnder5k = buildTriageReplySuggestion({
    intent: "PRICING_REQUEST",
    artistName: "Luna Moth",
    followerCount: 1800,
  });
  assert.match(pricingUnder5k, /\$350/);
  assert.match(pricingUnder5k, /first song completely free/i);

  const bookedWithPortal = buildTriageReplySuggestion({
    intent: "BOOKED",
    artistName: "Luna Moth",
    portalUrl: "https://ss.example/portal/tok_123",
  });
  assert.match(bookedWithPortal, /https:\/\/ss\.example\/portal\/tok_123/);

  assert.equal(
    buildTriageReplySuggestion({ intent: "UNSUBSCRIBED", artistName: "Luna Moth" }),
    ""
  );
});

test("buildCloseProjectSpec builds $0 unlocked PORTFOLIO_FREE spec and paywalled PAID package specs", () => {
  const freeSpec = buildCloseProjectSpec({
    artistName: "Sunburst Kid",
    dealType: "PORTFOLIO_FREE",
  });
  assert.equal(freeSpec.dealType, "PORTFOLIO_FREE");
  assert.equal(freeSpec.totalCents, 0);
  assert.equal(freeSpec.invoiceStatus, "PAID");
  assert.equal(freeSpec.paywallDeliverables, false);
  assert.equal(freeSpec.title, "Portfolio Collaboration — Sunburst Kid (First Song)");

  const paidBundle = buildCloseProjectSpec({
    artistName: "Midnight Choir",
    dealType: "PAID",
    packageCode: "MIX_MASTER_BUNDLE",
  });
  assert.equal(paidBundle.dealType, "PAID");
  assert.equal(paidBundle.templateCode, "MIX_MASTER_BUNDLE");
  assert.equal(paidBundle.totalCents, 35000);
  assert.equal(paidBundle.invoiceStatus, "ISSUED");
  assert.equal(paidBundle.paywallDeliverables, true);
});
