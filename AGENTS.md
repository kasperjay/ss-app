# Spectral Soundworks Implementation Plan

This document tracks the current automation, data quality, outreach, and client-portal roadmap for Spectral Soundworks.

Last reevaluated: 2026-10-12

> **Session summary (2026-05-05):** Completed all 7 items from the Suggested Implementation Order: consolidated scoring tests, implemented email delivery via SMTP, added `AgentRun` logging across all agents, built the Operations Queue UI, added structured `ContactInfo` tracking, hardened duplicate merge with `MergeProposal` persistence and audit trails, and replaced the README with full project documentation.

## Current Progress

The app has moved beyond the original "planned agents" phase. The repo now includes working lead ingestion, enrichment, scoring, contact discovery, message delivery, campaign reporting, duplicate detection, genre cleanup, a projects workspace, client portals, file uploads, feedback, invoices, and billing views.

The next phase should focus less on adding isolated scripts and more on making the system reliable as an operating workflow: shared scoring logic, safe data mutations, scheduled runs, surfaced notifications, and tighter handoff from lead to project to invoice.

## Implemented Automation

| Area | Status | Entry Point | Notes |
| --- | --- | --- | --- |
| Lead scoring | Consolidated | `src/lib/scoring-core.js`, `src/lib/scoring.ts`, `scripts/score-leads.js` | API and CLI scoring now use the same shared scoring core. Scores are capped at 100. |
| Event-driven scoring | Consolidated | `scripts/score-auto.js`, `/api/ingest` | Ingest and auto-scoring now use the same shared scoring core. |
| Data enrichment and staleness | Implemented, needs scheduling | `scripts/enrich-stale.js`, `/api/ingest` | Detects stale data and can re-ingest artists; needs operational scheduling and run logs. |
| Follow-up reminders | Implemented, needs UI surfacing | `scripts/followup-remind.js` | Finds due follow-ups and logs reminders; should feed a dashboard queue. |
| Contact discovery | Implemented, needs confidence persistence | `scripts/discover-contacts.js`, `src/lib/email.ts` | Finds emails but confidence is only in activity notes, not queryable structured data. |
| Campaign reporting | Implemented, recently aligned to schema | `scripts/report-campaign.js` | Now uses `WON` rather than legacy `CONVERTED`; needs export formats and dashboard integration. |
| Duplicate detection | Implemented, recently aligned to schema | `scripts/detect-duplicates.js` | Removed non-schema `bandcampUrl` merge field; should add merge audit logging. |
| Genre standardization | Implemented, recently fixed auto-fix logging | `scripts/standardize-genres.js` | Auto-fix now looks up a lead before writing Activity. |
| Message delivery | Partially implemented | `scripts/send-messages.js` | IG webhook delivery exists; email path is still placeholder behavior. |
| Discovery jobs | Implemented | `/api/discover`, `/api/discover/status`, `/api/discover/calendar` | Instagram discovery still uses Apify; venue searches cover 23 active Austin sources, in parallel, with 30-second per-venue limits and individual artist results: 21 Do512 listings, The Cut's official calendar, and Far Out's official event feed. Empire Control Room & Garage is excluded after closure. Venue-calendar imports bypass Apify discovery/profile scraping. |
| Client projects and portals | Implemented | `src/app/projects`, `src/app/portal/[token]` | Strong base for delivery workflow, feedback, visibility, invoices, and completion ratings. |

## Fixes Completed In This Reevaluation

- Updated campaign reporting to use the schema's `WON` status instead of old `CONVERTED` labels.
- Updated high-performer and underperformer segments to use valid statuses: `CONTACTED`, `FOLLOW_UP`, `WON`, `NEW`, and `QUALIFIED`.
- Removed references to non-schema `bandcampUrl` from contact discovery and duplicate merge data.
- Fixed genre standardization auto-fix so Activity records include the required `leadId` when a lead exists.
- Replaced the stale and mojibake-heavy agent plan with this current implementation plan.

## Highest-Priority Next Steps

### 1. Centralize Scoring Logic

**Status:** ✅ Complete. Shared scoring core in `src/lib/scoring-core.js`. Tests added in `src/lib/scoring-core.test.js`. Run with `npm run test`.

### 2. Add Agent Run Logging

**Status:** ✅ Complete. `AgentRun` model added to Prisma schema. `src/lib/agent-runner.js` wraps all major CLI scripts: `score-leads`, `score-auto`, `enrich-stale`, `send-messages`, `discover-contacts`, `detect-duplicates`, `standardize-genres`.

### 3. Surface Action Queues In The UI

**Status:** ✅ Complete. `/operations` page built in `src/app/operations/page.tsx`. Surfaces due follow-ups and high-score uncontacted leads.

### 4. Harden Destructive And Semi-Destructive Jobs

**Status:** ✅ Complete. Both `detect-duplicates.js` and `standardize-genres.js` now default to dry-run. Merge applies Activity audit notes with full artist JSON snapshots. Merge proposals persisted in `MergeProposal` table and marked `APPLIED` after execution.

### 5. Complete Message Delivery

**Status:** ✅ Complete. `nodemailer` integrated via `src/lib/email-sender.js`. `send-messages.js` now delivers to email addresses via SMTP using `mail.spacemail.com`. Channel and provider logged in Activity notes.

### 6. Structured Contact Confidence

**Status:** ✅ Complete. `ContactInfo` model added to Prisma schema. `discover-contacts.js` upserts structured records with `confidence`, `score`, `sourceUrl`, and `sourceType`. `Artist.emails` kept in sync for backward compatibility.

### 7. README Documentation

**Status:** ✅ Complete. `README.md` fully rewritten with setup instructions, environment variable reference, all CLI script docs, the data model overview, and operating notes.

## Near-Term Bug And Quality Backlog

| Priority | Item | Suggested Fix |
| --- | --- | --- |
| Done | Scoring config drift | Consolidated scoring into `src/lib/scoring-core.js`. |
| Done | Score can exceed 100 | Enforced `Math.min(total, 100)` in the shared scoring core. |
| Done | No test suite for agents | Tests added in `src/lib/scoring-core.test.js` covering all components, cap, and qualification. |
| Done | Contact confidence is not structured | `ContactInfo` model added with `confidence`, `score`, `sourceUrl`, `sourceType`, `discoveredAt`. |
| Done | Duplicate merge lacks audit trail | Activity notes with JSON artist snapshot on merge; `MergeProposal` table tracks status. |
| Medium | Agent output contains mixed Unicode/encoding artifacts | Normalize script console output to ASCII or ensure UTF-8 everywhere. |
| Medium | Staleness checks use Activity notes for follower history | Add a proper metric snapshot table for followerCount, lastPostAt, release count, and source freshness. |

## New Roadmap Ideas

These ideas build on existing project and portal features. Secure client links already exist through `Project.portalToken`, and timestamped file feedback already exists through `ProjectFeedback.timestamp` plus the portal audio player.

### Pipeline Health Agent

Create a daily job that reports data health across the whole system: missing email, missing city, missing genre, stale Instagram, stale Spotify, unscored leads, selected drafts not sent, and leads stuck in a status too long.

### Lead-to-Project Conversion Agent

When a lead becomes `WON`, suggest or auto-create a project shell using the existing secure portal token, starter invoice, and default delivery folders. This turns sales success into an operational handoff.

### Outreach QA Agent

Before sending, inspect selected message drafts for missing personalization, duplicate phrasing, overly long copy, missing artist name, unavailable channel, or too-frequent outreach.

### Reply Triage Agent

**Status:** ✅ Complete. Reply Inbox at `/replies` surfaces all `REPLY_RECEIVED` activities for classification. Triage UI sets intent (`INTERESTED`, `NOT_NOW`, `PRICING_REQUEST`, `WRONG_CONTACT`, `UNSUBSCRIBED`, `BOOKED`, `UNCLEAR`) and auto-transitions lead status. `ReplyTriage` model persists decisions. New `FollowUpSequence` and `LeadSequenceEnrollment` models enable structured multi-step cadences. `scripts/advance-sequences.js` advances enrolled leads on schedule. `scripts/seed-sequences.js` seeds 3 default sequences. API routes: `POST /api/replies/triage`, `GET /api/replies/inbox`, `GET|POST /api/sequences`, `POST /api/sequences/[id]/enroll`.

### Local Scene Intelligence

Build a lightweight venue/event signal collector for Austin/Texas artists: recent show announcements, common venues, upcoming releases, and collaboration signals. Feed those signals into score rationale and draft personalization.

### Client Delivery Follow-Up

After a project file is uploaded, timestamped feedback is left, or an invoice is issued, create reminders for unresolved feedback, payment follow-up, revision status, and completion rating. This extends the existing portal workflow into delivery operations.

### Forecasting And Capacity View

Use lead scores, follow-up stage, active projects, invoices, and project status to estimate upcoming workload and likely revenue. This would make the dashboard useful for planning, not just tracking.

## Suggested Implementation Order

All 7 items from the original order are complete as of 2026-05-05.

**Next priorities to consider:**

1. Run `npm run db:migrate` to apply the new `AgentRun`, `ContactInfo`, and `MergeProposal` migrations.
2. Install `nodemailer` with `npm install` after the updated `package.json` is deployed.
3. Build a UI for reviewing `MergeProposal` records (currently DB-only).
4. Implement Pipeline Health Agent (daily data-quality report).
5. Implement Lead-to-Project Conversion Agent (auto-create project shell on WON).
6. Add Outreach QA Agent (pre-send draft inspection).
7. Add Reply Triage Agent (inbox classification → lead status update) ✅ Complete
8. Add metric snapshot table for follower/post history (replaces Activity note approach).

## Operating Notes

- Keep all agents runnable by CLI and safe to schedule.
- Prefer dry-run defaults for data cleanup and merging jobs.
- Every substantive data change should leave either a lead-level Activity record or an AgentRun record.
- Shared business logic should live in `src/lib` or a small shared package-style module, with scripts acting as thin wrappers.
- The app should become the review surface for agent output, not just the place where final records appear.
