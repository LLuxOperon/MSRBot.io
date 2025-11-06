# MSRBot.io — Consolidated Technical Chronicle

**Status:** Gold-copy consolidation  
**Consolidation Date:** 2025-11-05

This document consolidates the MSRBot.io worklog into a single, category‑organized technical chronicle. Dates are de‑emphasized in favor of system architecture and implementation detail. All filenames, scripts, fields, and JSON keys are shown in monospace.

## 1 Extraction & Automation Pipeline

### 1.1 HTML + PDF Fallback Extraction (SMPTE milestone)
- End‑to‑end ingestion for SMPTE documents with HTML primary parsing and safe PDF‑only fallback.
- `index.html` missing → treated as likely PDF‑only; `inferMetadataFromPath()` derives `docId`, `releaseTag`, `publicationDate`, `doi`, `href`, `docType`, `docNumber`, `docPart`, `publisher`. Inferred fields are merged without overwriting existing data.
- Amendment suffix handling corrected end‑to‑end: `docId`, `doi`, and `href` are derived from the final ID including amendment suffixes (e.g., `.2011Am1.2013`).
- Added `revisionOf` extraction from HTML via `<meta itemprop="pubRevisionOf">`; value stored as array.

### 1.2 Status Wiring & Normalization
- Only one document per lineage can have `status.latestVersion: true`; that document is also `status.active: true` and `status.superseded: false`. All others: `latestVersion: false`, `active: false`, `superseded: true`.
- Deterministic mapping for ambiguous cases: unknown → `superseded: false`.
- Base releases without amendments receive explicit defaults: `status.amended = false`, `status.amendedBy = []`.
- `status.supersededBy` wiring: each base points to the next base in sequence; amendments inherit the base’s pointer. `status.supersededDate` injected from the next base’s `releaseTag`. `$meta` injected for both fields on create/update.
- **Publisher status derivation:** `status.active` and `status.superseded` automatically computed from `status.latestVersion`. Guarantees lineage consistency and prevents conflicting “active” flags.
- Amendment promotion logic: when an **amendment** is the latest, the amendment is `active: true, latestVersion: true`; the **base** remains `active: false, superseded: true`.   
_Prevents incorrect base flips when an amendment becomes latest._

### 1.3 Reference Parsing & Resilience
- Reference arrays are always present and normalized: defaults for `references.normative` and `references.bibliographic`.
- `$meta` injected consistently for new docs and updates; avoids emission for undefined or empty arrays.
- Latest‑version determination aligned with wrapper `releaseTag` ordering.

### 1.4 Folder & Publisher Parsing
- Version‑folder regex upgraded to handle amendments and publication stages; accepts `*-dp`.
- Publisher parsed from `<span itemprop="publisher">` (defaults to SMPTE only if missing). Guards prevent `-undefined` in `docId`/`docLabel`/`doi`.
- `docLabel` formatting for amendments standardized (space before `Am`, e.g., `SMPTE ST 429-2:2011 Am1:2013`).
- **Publisher taxonomy refinement:** standardized publisher metadata and document group classification across SMPTE, ISO/IEC, ITU, AES, and related families.  
  Prevents mismatched publisher aliases during extraction and validation.  
- **Normalized OM/AG handling:** standardized organizational markers  
  (e.g., `AG10b → AG10B`; removed “SMPTE ” prefix in OM titles).
- **Automated publisher detection:** extraction automatically maps publisher metadata using `url.rules.js` expectations, selecting the correct organization context during parsing.


### 1.5 Master Suite Index (MSI) & Lineage
- `buildMasterSuiteIndex.js` produces a lineage view with `publisher`, `suite`, `number`, `part`, history, and latest flags.
- Diagnostics and flags: `MISSING_BASE_FOR_AMENDMENT`, `MULTIPLE_LATEST_FLAGS`, draft filtering (`status.draft: true`), versionless handling via `inferVersionless()` and `statusVersionless`.
- Output is stably sorted with counts, latest IDs, and consolidated publisher normalization across SMPTE, ISO/IEC, NIST, W3C, IETF, DCI, ATSC, ITU, AMWA, AES, AMPAS, AIM, ARIB, NFPA, etc.
- Documents now explicitly annotated with lineage keys:  
  `msiLatestBase`, `msiLatestAny`, `latestDoc`, `docBase`, and `docBaseLabel` for stable linkage between MSI and MSR datasets.  
  These fields are injected with `$meta` provenance during index build.
- Added SMPTE-only sanity flag **`SMPTE_MISSING_RELEASE_TAG:<docId>`**; surfaces missing `releaseTag` on SMPTE documents during MSI build.


### 1.6 Reference Mapping, MSI Integration, and MRI Foundations
- `src/main/lib/keying.js` centralizes keying logic; MSI loaded once to build `latestByLineage` and `baseIndex` maps used across extraction and site build.
- Reference upgrader behavior: dated citations left as‑is; undated citations upgraded via lineage (trailing‑dot probe algorithm). Confirmed upgrades include `IEC.61966-2-1`, `ISO.10646`, `ISO.15444-1`, `ISO.15948`.
- Missed hits upgraded cleanly; template shows undated labels while links resolve to latest. Optional hover tip supported.
- Structural refactor initiated: move reference parsing/building into a single `referencing.js` library for both extraction and build.
- **Master Reference Index (MRI)**: new artifact planned under `src/main/reports/`, logging all seen refs, parsed IDs, source doc, raw forms, and titles; serves as the first point of truth for orphans and future PDF parsing.
- Added detailed **reference-upgrader diagnostics** — logs now trace probe → key → HIT → upgrade sequence for transparency when resolving undated citations.  
- Confirmed upgrade coverage explicitly documented for *ISO 15444-1*, *ISO 10646*, and *IEC 61966-2-1* families.
- **Manual namespace backfill:** temporary process remains in use until full automated extraction of `targetNamespace` and `import` structures is implemented.


## 2 Metadata & Provenance System
- `$meta` injection logic overhauled to write only when a field value actually changes; eliminates false‑positive diffs and redundant metadata writes.
- Inferred vs. parsed provenance tracked. Default `confidence: "medium"` applied to inferred fields; `source` annotated per field path.
- Namespace metadata extended: `xmlNamespace` objects include `deprecated: boolean` (foundation for structured namespace tracking with `uri`, `targetNamespace`, `imported`, `sourceDocId`, `schemaLocation`).
- **`$meta.note` definition mapping:** centralized through `metaConfig` for provenance consistency; future extensions may enrich note templates with field-specific context.
- Introduced **`$meta.excludeChanges: true`** as a field-level lock (applies to any field, including nested like `status.active`, `status.latestVersion`, `status.superseded`). Extraction respects locks via `setFieldIfAllowed(doc, fieldPath, newValue)` and `isFieldExcluded()`.
- Nested awareness: `isFieldExcluded()` handles one-level nested paths (e.g., `status.active`) with extension headroom for deeper hierarchies.
- Behavior: locked fields are skipped cleanly during extraction/inference (console log only, no PR entry); `$meta.overridden` and PR diffs update **only** when a change is allowed and actually occurs.


## 3 Validation & URL Resolution

### 3.1 URL Validation (`url.validate.js`)
- Added “good URL” count alongside unreachable and redirect totals.
- Redirect issues split into two buckets: `undefined` (missing resolved target) and `mismatch` (existing redirect differs from expectation).
- Unified audit written to `src/main/reports/url_validate_audit.json` with a clear header summary.

### 3.2 URL Normalization (`url.normalize.js`)
- Replaces `url.enrich.js`. Performs targeted backfill for `resolvedHref` with `$meta` tracking.
- Defaults to validation‑only; writes only in apply mode.
- Emits `src/main/reports/url_validate_normalize.json` summarizing proposed/applied normalizations for CI gating.

### 3.3 URL Rules (`url.rules.js`)
- Publisher‑specific expectation map (SMPTE, W3C, IETF, etc.). Informational for now; reports mismatches without auto‑fix.
- Establishes foundation for enforcing expected `href` patterns and redirect targets.

### 3.4 Documents Validation
- `documents.validate.js` checks duplicate `docId`, registry sort order, and performs soft URL reachability checks.
- Modular `resolveUrlAndInject()` shared across extraction and validation; injects `resolvedHref` when missing or changed.
- All URL‑related reports written under `src/main/reports/` with consistent JSON headers.

### 3.5 Overrides Audit
- Added **`src/main/scripts/audit.overrides.js`** to scan for `$meta.overridden === true`.
- Outputs **`src/main/reports/overrides_audit.json`** (JSON-only; CSV export dropped). No PR creation and no MSI dependency.
- Skips trivial/null/empty `originalValue` entries; groups results alphabetically by field with per-field totals.

## 4 Workflow & CI/CD

### 4.1 Chain Orchestration (MSI → MRI → MSR)
- Workflows run in strict sequence using `workflow_run` triggers. Any upstream change triggers the full chain rebuild.
- Concurrency protections:
  - MSI: `mastersuite-index`
  - MRI: `masterreference-index`
  - MSR Site ([MSRBot.io](https://msrbot.io/)): `msr-site-${{ github.ref_name }}` with cancel‑in‑progress enabled
- Permissions set per workflow: `contents: write`, `pull-requests: write`, `issues: write`.

### 4.2 MRI Workflow (`build-master-reference-index.yml`)
- Metadata‑only paths (`generatedAt` updates) commit directly to `main` (no empty PRs).
- Commits both `masterReferenceIndex.json` and `mri_presence_audit.json` directly to `main` when in metadata‑only mode; no hard reset to avoid file loss.
- Issue creation rebuilt: proper Markdown newlines, readable bullets for `cite`, `title`, `href`, `rawRef`. Missing‑ref issues auto‑close when resolved. `onlyMeta=true` suppresses PR creation.
- **PR base parameter fix:** all MRI workflow PRs now set `base: ${{ github.event.repository.default_branch }}` explicitly to ensure correct merge targeting.  
_Prevents orphaned branches from detached workflows._

### 4.3 Weekly MSI Workflow Hardening
- UNKEYED issues: one per `docKey`, idempotent, closed only from default‑branch runs.
- PR policy: lineage/inventory deltas → PR; flags/UNKEYED/metadata → auto‑commit to `main`.
- Diff classifier (`inventoryChanged`) routes outputs appropriately. PR bodies include flags and UNKEYED counts.
- Triggers: weekly cron (04:15 UTC), `push` to `main`, and manual dispatch.

### 4.4 PR Preview & Build Chain (`pr-build-preview.yml`)
- Automatic PR previews deployed to `gh-pages/pr/<PR#>/` with a comment posting the live link.
- Works for both direct PRs and `workflow_run` triggers from extraction; preview check appears in the PR Checks tab and links to the deployed preview.
- Reliability improvements: fixed reused‑PR gaps, retry logic, stable `destination_dir`, `keep_files: true` to preserve previews, and CNAME‑safe redirects.

### 4.5 Branch Hygiene (Branch Sweeper)
- `.github/workflows/branch-sweeper.yml` cleans stale branches with dry‑run support.
- Protections: default branch, `main`, `master`, `gh-pages`, and branches with open PRs.
- Options: exclude `chore/` prefixes by default; manual runs can include them. Logs show would‑delete/deleted/skipped categories with reasons.
- Fixes include injected `core` globals, robust YAML boolean coercion, full input sanity logging, commit‑date fallbacks, and pagination for repos with >100 branches.

### 4.6 Repo/Workflow Ops
- Node cache for faster CI startup. Conditional normalization + PR creation gated on real change signals (`redirectUndefinedCount > 0`, `applied > 0`).
- Post‑audit sync‑to‑main prevents base/head conflicts. Normalization PRs use a rolling branch `chore/url-normalize` and auto‑delete on merge; guards prevent self‑trigger.
- README documentation expanded with an “Automated Workflow Chain (with Samples)” section: triggers, datasets, expected outputs, and sample links to runs, reports, PRs, and issues.

### 4.7 PrZ3 Unit Integration — Phase 1 (GitHub App Identity)
- Adopted **PrZ3 Unit** (GitHub App) as the unified automation identity across all workflows; replaces `github-actions[bot]`.
- App connection established to the `PrZ3r` organization and `MSRBot.io` repository.

**Core Setup**
- Secrets added: `APP_ID`, `APP_PRIVATE_KEY`.

**Behavior & Identity**
- Commits authored as: `PrZ3 Unit <prz3-unit[bot]@users.noreply.github.com>`.
- PRs and comments show actor: `prz3-unit[bot]`.
- Issue automation (resolve/close) confirmed (“Resolved: no outstanding 404s…”, etc.).
- Preview builds post comments and deploy commits as the bot.
- Validation and extract PRs open with bot authorship; auto-closing logic intact.

**Operational Notes**
- Actions audit trail displays consistent bot identity across runs.

**Verification**
- App token issuance and usage validated end-to-end.
- Commit history, PRs, and Pages deploy/cleanup all operate correctly under PrZ3 Unit.

**Result**
- All automation now runs under a single, auditable identity with minimal token sprawl and App-based security hardening.

### 4.8 URL Validation Workflow Enhancements (Publisher & Item-Level Issue Expansion)
- Scope: `.github/workflows/validate-urls.yml`

**Additions**
- New error categories with full upsert + autoclose behavior:
  - **403** — per publisher (labels: `automated`, `url`, `403`)
  - **HPE_INVALID_CONSTANT** — per publisher (labels: `automated`, `url`, `hpe-invalid-constant`)
  - **ERR_BAD_REQUEST** — per item (labels: `automated`, `url`, `bad-request`)
  - **UNABLE_TO_VERIFY_LEAF_SIGNATURE** — per item (labels: `automated`, `url`, `leaf-signature`)
- Integrated into audit parsing, issue creation, and autoclose passes.
- Issue bodies use a deterministic summary (Count, docIds, URLs, run tag), matching existing ENOTFOUND/404/400 conventions.
- Added **ENOTFOUND** handling (treated equivalently to 404) with deterministic issue body and canonical labels.
- Capped per-issue body list to first 25 entries with a total count noted.
- Mirrored behavior applied to 404 for consistency.

**Refinements**
- Label scheme cleaned:
  - Removed legacy single-labels (e.g., `url-404`, `url-enotfound`).
  - All issues now use canonical multi-label sets: `automated`, `url`, `<category>`.
- Autoclose logic validated across new and existing issue types.
- Body formatting aligned to established deterministic Markdown style.
- Removed the `postChunks()` helper and all call sites across grouped/publisher sections.
- Applied a **unified issue body structure** to all **publisher-level** categories:
  - **404**, **403**, **ENOTFOUND**, **HPE_INVALID_CONSTANT**, **ERR_FR_TOO_MANY_REDIRECTS**, **SMPTE.resolvedHref.standards-prefix**
- Left **per-item** categories unchanged (bodies link directly to the audit JSON):
  - **400**, **ERR_BAD_REQUEST**, **UNABLE_TO_VERIFY_LEAF_SIGNATURE**
- Verified **autoclose** and **label** handling remain unaffected.

**Outcome**
- Workflow now covers **9 error/mismatch categories** with consistent publisher vs. item separation, self-updating issue bodies, and full autoclose hygiene.
- Old label compatibility removed; unified label taxonomy is authoritative going forward.
- Issue bodies are clean, consistent, and readable at a glance.
- Full datasets remain accessible via a single stable link: `src/main/reports/url_validate_audit.json`.
- Large audits avoid comment spam; runs stay fast and quiet.

## 5 Registry Architecture & Data Model Evolution
- Consolidated `metaConfig` governs notes for `status.stabilized`, `status.withdrawn`, and `status.withdrawnNotice`.
- Withdrawn notice handling:
  - Reachability check performed once per URL.
  - Non‑enumerable `__withdrawnNoticeSuffix` tracks "verified reachable" or "link unreachable at extraction".
  - On create: `$meta.note` combines base note + suffix (deduplicated). On update: `$meta.note` updated only if URL changes. Regex normalizer strips duplicate suffixes.
- Repo URL validation: HEAD checks before writing `repo` prevent invalid links.
- Discovery output cleanup: suite/child formatting improved; merge/update phase uses `logSmart`.
- **Withdrawn and stabilized flag extraction:** extraction recognizes and populates `status.withdrawn` and `status.stabilized` fields directly from document metadata for registry completeness.

## 6 Frontend & Site Publishing
- PR previews deployed for each open PR with a durable URL. Checks include write permission and attach to the PR’s head SHA.
- Links are stable under both `github.io` and the CNAME (`msrbot.io`).
- Plan: staging subdomain (e.g., `test.msrbot.io`) for broader pre‑prod validation.

### 6.1 Frontend Refresh I — Card-Based Registry View
- Refactored registry interface to a responsive **card-based view** using Handlebars templates with synchronized filters and facets.
- Implemented **`src/site/js/cards.js`** to load `search-index.json` and `facets.json`, render cards via Handlebars, and manage live filtering.
- Added helper functions: `join`, `len`, `gt`, `statusBadge`, `coalesce`, and `hasAny` for inline template logic.
- Introduced fallback diagnostics for missing templates (`#card-tpl` / `#card-tpl-src`) to prevent silent render failures.
- Corrected **publiccd** mapping within `statusBadge` to ensure proper badge display across document types.
- Added **`syncFacetCheckboxes()`** to maintain state parity between filter chips and facet checkboxes, including the **“Clear All”** action.
- Updated **`mobile.css`** for badge right-alignment and text wrapping on small screens.
- Updated **`cards.hbs`** to integrate existing Bootstrap header/footer, sticky topbar, and unified card render block.
- Verified automatic facet expansion for **status** and **docType**; confirmed live synchronization between chip removal and facet checkboxes.
- Result: responsive, visually consistent registry cards with fully synchronized filters and improved mobile usability.

### 6.2 Frontend Refresh II — Branding, SEO & 404 Overhaul
- **Project rebrand and repository migration:** moved to `PrZ3r/MSRBot.io`; redirects active for previous repo and domain.
- **Domain alignment:** `msrbot.io` established as canonical host; `mediastandardsregistry.org` configured to redirect via DNS.
- **Single-source configuration:** introduced `src/main/config/site.json` as canonical metadata store; removed duplicate inline defaults from `build.js`.
- **Environment variable overrides:** supports `SITE_CANONICAL_BASE`, `SITE_NAME`, and `SITE_DESCRIPTION` for staging.
- **Meta & SEO injection:** build now applies `siteName`, `siteDescription`, `canonicalUrl`, `ogTitle`, `ogDescription`, and `ogImage` across all pages.
- **Header partial overhaul (`header.hbs`):** canonical URL, Open Graph, and JSON-LD schema (WebSite + searchAction); robots meta (index/noindex) applied dynamically.
- Added comprehensive favicon and language metadata; optimized preconnects and HTTPS-only links.
- **Generated build assets:** `robots.txt`, `sitemap.xml`, `opensearch.xml`, and `404.html` all rendered with header/footer and OG context.
- **Dynamic 404 page (“Disappointed Penguin Edition”):** Handlebars-driven layout with randomized, config-based message list; robots meta = noindex,follow.
- **Asset and link cleanup:** introduced `assetPrefix` for consistent partial reuse; navbar links now root-absolute; redundant defaults removed.
- **OG image generation:** 1200×630 PNG featuring new penguin + logo branding on teal/circuit background.
- **Identity & icon:** finalized **MSRBot.io logo** and SVG favicon (clean circular mark, document-forward, non-derivative); scalable and consistent across all resolutions.
- Result: complete brand, SEO, and metadata integration; clean 404 UX; site now fully single-config, portable, and identity-consistent.

### 6.3 Frontend Refresh III — Registry Cards & Search System
- Extended **card-based registry UI** with full search, filtering, and navigation logic.

**Rendering & Layout**
- Handlebars runtime loaded on demand for client-side rendering.
- Status badge alignment/wrapping corrected; consistent badge classes and typo cleanup.
- Introduced sticky bottom pager (later removed sticky top) with proper persistence.
- Added results summary line: *“Showing X–Y of N (filtered from M)”*.
- Page-size selector improved for clarity; auto-selects current value.

**Filters & Chips**
- Two-way synchronization between facet checkboxes and active chips.
- “Clear All” now clears filters, chips, and search box.
- Removing a chip unchecks the corresponding facet.
- Replaced `hasCurrentWork` boolean with `currentWork` list facet; updated labels and search mapping.

**Sorting**
- `Newest`/`Oldest` now sort by `pubTs` with fallbacks.
- Added `Title` and `Label` A↔Z sorts with article stripping (“the”, “a”, “an”).
- Introduced reversible sort toggling for all modes.

**Pagination & Navigation**
- Numbered page jumpers with prev/next and keyboard navigation.
- URL-synced pagination and page size for deep-linking and browser history.
- Bottom pager hidden when top is visible to reduce clutter.
- Year facet implemented as a compact dropdown (“All years” default) linked with chips and clear-all.

**Deep Links & Anchors**
- `#docId` anchors locate items across pages/filters; if filtered out, filters reset and jump performed.
- Scroll offset accounts for sticky navbar and topbar with highlight flash.
- On filter/sort/page/search change, hash stripped to prevent accidental jumps.
- Offset tuned for consistent landing beneath both sticky elements.

**URL State**
- Query string now mirrors `page`, `size`, `sort`, `q`, and `f` (filters).
- On load, state rehydrates search box, sort, page size, and filters from URL.
- Year dropdown and page-size controls initialize from URL state.

**Search Engine**

*Index Build (Node)*
- `build.search-index.js` generates:
  - `build/cards/search-index.json` (flat rows from `documents.json` + group/project joins).
  - `build/cards/facets.json` with counts and group-label map.
- Optional `synonyms.json` copied into build.
- MiniSearch UMD resolved from `node_modules` or CDN (redirect-follow supported).
- Fixed `undefined.false` builder error; tightened status bucketing.

*MiniSearch (Client)*
- Loader prefers UMD; falls back to simple `includes()` if unavailable.
- Field boosts: `title:6`, `id:5`, `label:4`, `keywords:3`, `keywordsSearch:2`, `currentWork:1`.
- Token rules: prefix ≥ 3 chars; fuzzy 0.1 ≥ 4 chars (to curb over-broad hits).
- Bi-directional synonyms and intra-group linking  
  (`"isdcf" ↔ "inter-society digital cinema forum"` etc.).
- Quoted phrases perform literal matches via precomputed haystack intersection.
- Search syntax supports field scopes (`publisher:isdcf`, `title:"accessibility"`), exclusions (`-draft`), and facet combination.

**Behavior Fixes & Polish**
- Keywords now included in both faceting and weighted search.
- Search bar updates URL state; “Clear All” resets it.
- Guarded MiniSearch failure path logs error, falls back gracefully.
- Fixed chip/checkbox desync edge cases.
- Case-insensitive, article-stripped sorting for label/title.
- Resolved “0 results” initialization bug from state-init order.
- Page truncation at 40 fixed; page-size control honored via URL.
- Year-facet chip removal resets dropdown correctly.
- Deterministic facet-section order; `docType` and `status` expand by default.

**Result**
- Registry now offers full-fidelity search, deep-linkable state, and robust filter synchronization within a responsive, mobile-friendly card interface.

### 6.4 Frontend Refresh IV — Search Index & UX Enhancements

**Search Index & Schema**
- Enriched search index rows with `publisher`, `doi`, `group`, and `publicationDate`; verified propagation to cards and facets.
- `docType` now stores the full name (e.g., “Standard”); abbreviations (e.g., “ST”) moved to `docTypeAbr`.
- Removed `Unknown` fallback — `docType` is mandatory.

**Search Behavior**
- MiniSearch tuning:
  - Improved exact-phrase detection for quoted queries.
  - Adjusted fuzzy and prefix thresholds to reduce over-broad matches.
  - Enforced true **AND** semantics across multiple terms (eliminates OR overloads).
  - Document-number normalization (e.g., `429-2:2020`) returns exact matches reliably.
- Introduced mode toggle scaffolding for **simple** vs **smart** search (future-ready).

**Facet & Status Logic**
- Removed `statusPrimary`; facets and badges now derive from any `statusFlags` marked `true`.
- Added `facets.statusLabels` for user-friendly names (e.g., “Active”, “Amended”); consistent badge order on cards.
- Multi-flag **AND** logic for status filtering (e.g., “Active + Amended” requires both).

**File Organization**
- Build outputs reorganized: `documents.json` now emitted under `build/cards/_data/` for clearer separation.
- Card views render exclusively from the **search index**; no dependency on the root `documents.json`.

**UI Enhancements**
- Added a Bootstrap **Search Tips** popover:
  - Covers phrase matching, AND logic, field filters, doc-number normalization, fuzzy rules, and synonyms.
  - Keyboard shortcut **`?`** opens tips from the search bar.
  - Placement refined to sit just before the sort dropdown (discoverable and unobtrusive).

**Resilience & Integration**
- Tip-button installer guarded against duplicates (safe on `popstate` reloads).
- Works with Bootstrap fallback (`alert()` version) if JS is unavailable.
- `popstate` re-invokes `installSearchTips()` to maintain functionality on back/forward navigation.

**Result**
- Deterministic search/filtering with consistent `docType`, status, and metadata rendering.
- Clear, discoverable search UX; build and data pipelines write to the correct directories.

## 7 Logging, Diffing, and PR Output
- `logSmart.js` centralizes logging with a console budget (~3.5 MiB). Excess console chatter is tripwired while full logs are persisted to file.
- Heartbeats and tripwires: periodic progress messages (`[HB pid:####] ... still processing — X/Y (Z%)`) with a start‑of‑run settings banner.
- Full extract log artifacts (`extract-full.log`) uploaded for every run, including early exits or skipped PRs.
- PR log formatting:
  - One‑line diffs for `status` children, `revisionOf`, and reference updates.
  - Duplicate‑skip reporting simplified: PR shows only a count; detailed list in workflow logs.
  - Diff linking: PR body includes a `__PR_DETAILS_DIFF_LINK__` token replaced with a link to the PR Files tab anchored to the details file blob SHA.
- PR creation skip: legacy `skip-pr-flag.log` removed; PR body text check governs skipping.
- **Heartbeat + Tripwire logging:** `logSmart` now emits periodic heartbeats during long extraction runs and tripwire alerts when log volume approaches budget.  
  Ensures visibility in CI logs without exceeding console limits.

## 8 URL Validation & Normalization Suite — Summary (Operational)
- URL Validator reports: good URL totals, unreachable and redirect mismatches split by cause. Audit logged to `src/main/reports/url_validate_audit.json`.
- URL Normalizer operates in validate‑only by default; writes only in apply mode. Summary emitted to `src/main/reports/url_validate_normalize.json`.
- URL Rules provide publisher‑specific checks and expected patterns (informational baseline for future enforcement).
- Repository hygiene and scheduling configured for weekly runs, manual dispatch, and PR‑merge triggers; runs auto‑cancel when superseded.

## 9 Net Results / System Readiness
- End‑to‑end weekly chain hardened. MSI → MRI → MSR runs reliably and in order.
- PR previews deploy deterministically and self‑report via PR checks.
- URL validator, normalizer, and branch sweeper operate on schedules with clean, uniform reports.
- All major CI workflows are concurrency‑protected and idempotent.
- Project emits core JSON reports under `src/main/reports/` with uniform headers.
- Clean metadata‑only commit flow (no empty PRs); auto‑closing issues for missing references.
- Cite‑first resolution logic with `refMap` overrides; undated references upgraded via lineage when appropriate.
- Extractor honors `$meta` locks; normal flows unaffected for unlocked fields.
- MSI checks extended with SMPTE `releaseTag` audit.
- Provenance corrections verified in practice (examples: docLabel normalization 2086→2085, publicationDate normalized to HTML `pubDateTime`, amendment promotion behaves as specified).

## Appendix A: Implementation Notes (selected specifics retained)
- MSI lineage logic refined across publishers; draft and versionless handling normalized; ICC errata regex fixed; console logs simplified (Found vs Added vs Skipped) with reduced UNKNOWN noise via early publisher normalization.
- Safety guard on references: skip MSI probing if `docId` already exists in `documents.json` to reduce unnecessary lookups and false gaps.
- README expanded: automated chain diagram, sample outputs, triggers, and dataset descriptions.

---

**Gold‑Copy Guidance**
This file is the current gold‑copy consolidation. If corruption or lock‑up occurs in downstream artifacts, restore from this document and only re‑apply changes made after the consolidation date above.

> _Maintained by [Steve LLamb](https://github.com/SteveLLamb) — MSRBot.io_ 

## Appendix B: Daily Done List Protocol

To simplify ongoing updates, each day’s accomplishments can be logged in a structured “Done List” that is parsed and merged into this changelog. Use the format below for clarity and automation compatibility.

### Template

```
# Done List — YYYY‑MM‑DD

## 1 Extraction & Automation Pipeline
- [summary of task or fix; include filename or script if relevant]

## 2 Metadata & Provenance System
- [$meta or status logic updates]

## 3 Validation & URL Resolution
- [url.validate.js or url.normalize.js changes]

## 4 Workflow & CI/CD
- [workflow name or YAML file update]

## 5 Registry Architecture & Data Model
- [structural schema or field changes]

## 6 Frontend & Site Publishing
- [public site or preview deployment details]

## 7 Logging, Diffing, PR Output
- [logging or PR formatting changes]

## 8 Misc / Notes
- [anything cross‑cutting or prep for next session]
```

### Usage Rules
- Keep bullets short, declarative, and in past tense (one per atomic change).  
- Include filenames or JSON keys for traceability.  
- No dates or emojis inside bullets; they are stripped on import.  
- Omit empty sections — they collapse automatically.  
- Duplicate items are flagged as Merged/Implicit instead of duplicated.

### Processing Workflow
1. Drop the formatted Done List into chat.  
2. The assistant parses, normalizes, and compares entries against the current gold‑copy changelog.  
3. A Markdown patch block is generated for commit.  
4. Each item is classified as ✅ New addition, ⚙️ Merged, or ✏️ Reworded/clarified.  
5. Paste the block into the appropriate sections and commit the update.

### Optional Short Form
```
Done List — YYYY‑MM‑DD
- Extraction: added DOI fix for PDF fallback.
- Metadata: tuned $meta.note for status.superseded.
- Workflow: fixed YAML boolean coercion.
```
Short form lines are auto‑routed to their matching sections.