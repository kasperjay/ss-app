# Spectral Soundworks

An internal CRM and automation platform for managing artist leads, outreach, and client project delivery. Built for Spectral Soundworks, an Austin-based music production company.

---

## Architecture

| Layer | Technology |
|---|---|
| **Framework** | Next.js 16 (App Router, React 19) |
| **Database** | PostgreSQL (via Docker) |
| **ORM** | Prisma 7 with `@prisma/adapter-pg` |
| **Styling** | Tailwind CSS 4 |
| **Automation** | Node.js CLI agent scripts |
| **Discovery** | Self-hosted calendar discovery for 23 active Austin venues (21 Do512 listings, The Cut's official calendar, and Far Out's official feed); venue searches and imports bypass Apify, while Instagram discovery remains Apify-backed |
| **Email** | Nodemailer (SMTP) |

---

## Getting Started

### Prerequisites

- **Docker** or **Podman** (for PostgreSQL)
- **Node.js** ≥ 20
- **npm** ≥ 10

### Setup

1. **Clone and install dependencies**

   ```bash
   git clone <repo>
   cd spectral-soundworks-app
   npm install
   ```

2. **Configure environment variables**

   Copy the example env file and fill in your values:

   ```bash
   cp .env.example .env
   ```

   See [Environment Variables](#environment-variables) below for a full reference.

3. **Start the database and application**

   ```bash
   npm run launch
   ```

   This runs `scripts/launch.sh`, which detects your container engine (Docker or Podman), starts PostgreSQL, runs Prisma migrations, and starts the Next.js dev server.

4. **Alternatively, run components separately**

   ```bash
   # Start Postgres via Docker Compose
   docker compose up -d

   # Apply migrations and generate Prisma client
   npm run db:migrate

   # Start Next.js dev server
   npm run dev
   ```

---

## Environment Variables

Create a `.env` file at the project root with the following:

```env
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/spectral

# Apify (for Instagram discovery and other Apify-backed scrapers; venue calendar searches and imports do not use it)
APIFY_TOKEN=your_apify_token

# Instagram DM Webhook
IG_DM_WEBHOOK_URL=https://your-webhook-endpoint.com/ig
IG_DM_WEBHOOK_SECRET=your_secret

# SMTP Email Delivery
SMTP_HOST=mail.spacemail.com
SMTP_PORT=465
SMTP_USER=admin@spectralsound.works
SMTP_PASS=your_password
SMTP_FROM="Spectral Soundworks" <admin@spectralsound.works>

# Agent Limits
DAILY_LIMIT=12
FOLLOW_UP_DAYS=7
EMAIL_SCRAPE_MAX_PAGES=5
```

---

## CLI Agent Scripts

All scripts are runnable via `npm run <script>` or directly with `node scripts/<name>.js`. They are safe to schedule via cron.

Every script wraps its execution in an `AgentRun` database record for operational observability. Lead-level changes also leave `Activity` records for user-facing audit history.

### Scoring

| Script | Command | Description |
|---|---|---|
| `score-leads.js` | `npm run score` | Score unscored (or all) leads based on proximity, followers, genre, recency, releases, and data completeness. Scores are capped at 100. |
| `score-auto.js` | `npm run score:auto` | Event-triggered scoring, same logic as above. Supports `--all` flag. |

**Flags:** `--all`, `--dry-run`, `--limit N`, `--filter-status STATUS`

### Enrichment & Discovery

| Script | Command | Description |
|---|---|---|
| `enrich-stale.js` | `npm run enrich:stale` | Re-enriches artists whose Instagram/Spotify data is stale (> 30 days). |
| `discover-contacts.js` | `npm run discover:contacts` | Crawls artist websites and Instagram profiles to find emails. Stores structured `ContactInfo` records with confidence scores. |
| `backfill-enrich.js` | `npm run backfill:enrich` | Backfills enrichment data for artists missing key fields. |

**Flags:** `--dry-run`, `--limit N`, `--missing` (contacts only)

### Outreach

| Script | Command | Description |
|---|---|---|
| `send-messages.js` | `npm run send:messages` | Delivers unsent `MessageDraft` records. Supports Instagram DM via webhook and Email via SMTP. |

**Flags:** `--dry-run`, `--limit N`

### Data Quality

| Script | Command | Description |
|---|---|---|
| `detect-duplicates.js` | `npm run detect:duplicates` | Detects duplicate artists by name similarity and exact ID matches. Saves `MergeProposal` records to the database. **Defaults to dry-run.** Pass `--live` to enable proposal persistence. Use `--live --auto-merge` to apply high-confidence merges. |
| `standardize-genres.js` | `npm run standardize:genres` | Analyzes genre fields and maps them to a canonical taxonomy. **Defaults to dry-run.** Pass `--live --auto-fix` to apply changes. |

**Flags for both:** `--live`, `--auto-merge` / `--auto-fix`, `--threshold N` (duplicates)

### Reporting & Follow-ups

| Script | Command | Description |
|---|---|---|
| `report-campaign.js` | `npm run report:campaign` | Generates campaign reports by status segment (WON, CONTACTED, etc.). |
| `followup-remind.js` | `npm run followup:remind` | Finds leads with a past `nextActionAt` and logs reminders. |

---

## Database Management

```bash
# Apply pending migrations
npm run db:migrate

# Backup the database
npm run db:backup

# Seed the database
npm run seed

# Reset and reseed
npm run seed:reset
```

---

## Testing

The scoring core has a test suite using Node's native test runner:

```bash
npm run test
```

`npm test` covers all scoring components, the 100-point cap, and qualification threshold. `npm run test:scrapers` checks all 23 active venue adapters, excludes closed venues, validates Do512, The Cut, and Far Out, and exercises lineup splitting, 30-day filtering, event-detail enrichment, retries, timeouts, and Apify-free venue imports.

---

## Application Routes

| Route | Description |
|---|---|
| `/` | Dashboard |
| `/leads` | Lead pipeline |
| `/leads/[id]` | Lead detail view with scoring, drafts, and activity |
| `/leads/discover` | Search Instagram via Apify or search the next 30 days of 23 active Austin venue sources. Do512 venues run in parallel and read event pages for lineups; Far Out uses its official event feed. Imports bypass Apify discovery and Instagram profile scraping. Empire Control Room & Garage remains excluded because it has closed. |
| `/projects` | Client project workspace |
| `/portal/[token]` | Client-facing portal (no auth required) |
| `/operations` | Operations queue — ranked New Outreach and Follow-ups tabs with explainable priority |

---

## Data Model Overview

```
Artist ──< Lead ──< MessageDraft
       ──< Release
       ──< InstagramPost
       ──< ContactInfo          (discovered emails with confidence scores)
       ──< MergeProposal        (pending duplicate merge proposals)
       ──< Project ──< ProjectFile
                   ──< ProjectFeedback
                   ──< ProjectInvoice

AgentRun                        (operational log of script executions)
Activity                        (user-facing lead audit trail)
```

---

## Operating Notes

- All agents are safe to run from CLI or schedule via cron.
- Destructive scripts (`detect-duplicates`, `standardize-genres`) **default to dry-run**. Pass `--live` to apply changes.
- Every substantive data change leaves either a lead-level `Activity` record or an `AgentRun` record.
- Shared business logic lives in `src/lib/` — scripts are thin wrappers.

### Priority action queue

`/operations` separates reachable first-contact opportunities from existing follow-ups. New Outreach includes only `NEW` and `QUALIFIED` leads that have not been contacted and have an email or Instagram handle. Follow-ups require both `nextActionAt` and a `FollowUpActionType` (`EMAIL`, `DM`, `CALL`, `RESEARCH`, or `OTHER`); incomplete records remain visible as cleanup items.

Priority starts with the existing lead score and adds only approved, evidenced production need: `POSSIBLE` adds 8 points and `CLEAR` adds 25 points. Approved evidence expires after 45 days. Each queue row shows its top reasons and an expandable score breakdown; hard exclusions are eligibility rules rather than negative score points.

### Temporary DNS fallback

Use https://spectral-soundworks-kkkkrash.zocomputer.io with the existing route and portal token while custom-domain DNS is unavailable. Set `NEXT_PUBLIC_APP_URL` to that origin in `.env.local` and rebuild/restart after changing it. Existing navigation and portal file requests use relative paths. Previously shared custom-domain links must be re-shared with the Zo hostname; a redirect cannot repair DNS failures. The separate marketing booking site is not hosted by this CRM.

### Contact email filtering

Website discovery reads page text and mailto links, excluding scripts, styles, comments, and asset attributes. Shared validation in `src/lib/contact-email.js` rejects telemetry endpoints, placeholders, asset filenames, known concatenation errors, and Bandcamp support addresses during discovery/import/ingestion and before SMTP delivery. This filters scraping errors; it does not verify mailbox ownership or deliverability. Regression checks: `npm test` and `npx vitest run src/lib/email.test.ts`.
