# Spectral Soundworks code review

2026-11-13. Targeted review of discovery, uploads, downloads, proxy handling, project guidance, and test coverage. This is not an exhaustive application security audit.

## Fixed

Five major issues:

- Upload fields were asserted as types without runtime validation. Invalid file, project ID, and file category now return 400; missing projects return 404 before disk writes.
- Millisecond-based upload names could overwrite concurrent uploads. UUID keys and exclusive writes prevent overwrites.
- Failed metadata saves left orphan files. Failed saves now remove the newly written file, with cleanup failures logged.
- Discovery logged a credential prefix. Logs now identify only the credential category.
- Failed active-run lookups returned zero and allowed more work. Lookup failures now stop the request.

One minor issue: removed redundant discovery credential-selection branches, an unnecessary any cast, boxed String typing, and stale upload comments.

Corrected implementations are in src/app/api/upload/route.ts and src/app/api/discover/route.ts. Twelve route-level regression cases exercise real handlers with filesystem/database/provider boundaries mocked. No real outreach or discovery jobs were triggered.

## Remaining risks

- Critical: uploaded files live in public/uploads and are also served by /api/uploads/[filename] without portal payment/rating checks. A known direct file URL can bypass those checks. Correcting this requires private storage plus an owner-authentication design that preserves staff previews and token-based client downloads. Existing links and visibility were preserved in this pass.
- Major: next.config.ts ignores TypeScript build errors. A separate tsc --noEmit check was run for this change; builds alone are not a type-safety check.
- Major: portal-gating.test.js tests locally duplicated authorization logic rather than the download handler. It cannot prove enforcement on actual HTTP routes.
- Major: active-run checks are not atomic across simultaneous discovery requests; provider-side concurrency enforcement remains necessary.
- Uploads still buffer entire files and have no explicit application size limit. Choose a limit appropriate to studio media before enforcing one.

## Validation

173 Node tests passed; 31 Vitest tests passed, including 12 new route tests. Production build completed. Separate TypeScript check completed without diagnostics.
