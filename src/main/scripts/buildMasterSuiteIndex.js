const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const keying = require('../lib/keying');
const {
  W3C_ALIAS_MAP,
  NIST_ALIAS_MAP,
  GLOBAL_ALIAS_MAP,
  // w3c helpers
  shouldFlagW3CMissingVersion,
  normalizeW3C,
  // dates
  dateKeyFromDoc,
  yearFromDocIdTail,
  // amendment/supplement
  isAmendmentDocId,
  isSupplementDocId,
  // keying
  keyFromDocId,
  // publisher
  publisherFromDoc,
  // alias
  applyGlobalAliases
} = keying;

function arg(flag, def = null) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return def;
  const next = process.argv[i + 1];
  // If there is no next token or the next token is another flag, use the default
  if (next == null || /^--/.test(next)) return def;
  return next;
}
function has(flag) { return process.argv.includes(flag); }

const IN = arg('--in', 'src/main/data/documents.json');
const OUT = arg('--out', 'src/main/reports/masterSuiteIndex.json');
const COUNT_ONLY = has('--count-only');
const PUB_COUNTS_OUT = arg('--pub-out', 'src/main/reports/masterSuiteIndex-publisherCounts.json');
const SKIPS_OUT = arg('--skips-out', 'src/main/reports/masterSuiteIndex-skippedDocs.json');
const SEPARATE_AUX = has('--separate-aux');

function sha256File(p) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(p));
  return 'sha256:' + h.digest('hex');
}

function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

// Doc types that do not participate in lineage graphs. We still carry them in
// the skipped report as FILTERED-by-docType for auditability.
const NON_LINEAGE_DOCTYPES = new Set([
  'Journal Article',
  'Magazine Article',
  'Technical Journal',
  'Book',
  'Patent',
  'White Paper',
  'Registry',
  'Technical Bulletin',
  'Technical Note',
  'Procedure',
  'Notation',
  'Manual',
  'Study Group Report',
  'Dissertation',
  'FAQ',
  'Style Guide',
  'Template'
]);

// Helper to infer versionless (evergreen) documents
function inferVersionless(doc) {
  // Honor explicit status.versionless when present
  if (doc && doc.status && typeof doc.status.versionless === 'boolean') {
    return doc.status.versionless;
  }
  const id = (doc && doc.docId) ? String(doc.docId) : '';
  const href = (doc && doc.href) ? String(doc.href) : '';
  // Well-known versionless specs
  if (/^WHATWG\.HTML$/i.test(id)) return true;
  if (/html\.spec\.whatwg\.org/i.test(href)) return true;
  // Add more publishers/IDs here as needed
  return false;
}

// Collect skipped (unkeyed or filtered) docs for reporting
function collectSkipped(allDocs) {
  const skipped = [];
  for (const d of allDocs) {
    if (!d || !d.docId) continue;
    
    // Apply global aliases for skipped/added parity
    applyGlobalAliases(d);
    // Normalize W3C like buildIndex does to keep parity
    normalizeW3C(d);

    const pub = publisherFromDoc(d);

    // Versionless policy: do NOT filter out versionless if it keys; include it in lineage.
    // If a doc fails to key, always classify as UNKEYED (even if it appears versionless),
    // so we don't mask parser gaps behind a "versionless" reason.

    // 1) DocType-first policy: if this is a non-lineage document type, mark as FILTERED
    const dt = (d.docType || '').trim();
    if (dt && NON_LINEAGE_DOCTYPES.has(dt)) {
      skipped.push({
        docId: d.docId,
        publisher: pub,
        reason: 'FILTERED',
        rule: 'FILTERED',
        ruleDetail: `docType=${dt}`,
        category: 'docType'
      });
      continue;
    }

    // 2) Draft policy: filter documents explicitly marked as draft (status.draft === true)
    if (d && d.status && d.status.draft === true) {
      skipped.push({
        docId: d.docId,
        publisher: pub,
        reason: 'FILTERED',
        rule: 'FILTERED',
        ruleDetail: 'status.draft=true',
        category: 'policy'
      });
      continue;
    }

    // 3) Otherwise, try to key it; if unkeyed, it's a parser coverage gap.
    //    Classify as UNKEYED first to avoid mislabeling e.g. versionless-but-unkeyed as "versionless".
    const k = keyFromDocId(d.docId, d);
    if (!k) {
      skipped.push({
        docId: d.docId,
        publisher: pub,
        reason: 'UNKEYED',
        rule: 'UNKEYED',
        ruleDetail: 'noRegexMatch',
        category: 'standard'
      });
      continue;
    }

    // 4) Keyed but policy-filtered (e.g., IEEE journals by suite)
    if (shouldSkipKey(k)) {
      const suite = (k.suite || '').toUpperCase();
      const cat = (k.publisher === 'IEEE' && /^(JRPROC|TMAG)$/.test(suite)) ? 'journal' : 'policy';
      skipped.push({
        docId: d.docId,
        publisher: pub,
        reason: 'FILTERED',
        rule: 'FILTERED',
        ruleDetail: `policy:${k.publisher}.${suite || ''}`,
        category: cat,
        key: [k.publisher, k.suite || '', k.number, k.part || ''].join('|')
      });
    }
  }
  return skipped;
}

// Compute publisher → docId counts (sorted descending by count)
function computePublisherCounts(allDocs) {
  const counts = {};
  let total = 0;
  for (const d of allDocs) {
    if (!d || !d.docId) continue;
    const pub = publisherFromDoc(d);
    counts[pub] = (counts[pub] || 0) + 1;
    total++;
  }
  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {});
  return { total, counts: sorted };
}

function computeFlagSummary(lineages, maxExamplesPerType = 250) {
  const acc = {
    totalFlags: 0,
    byType: {}
  };
  if (!Array.isArray(lineages)) return acc;

  for (const li of lineages) {
    const lineageKey = li && li.key ? String(li.key) : '(unknown-key)';
    let flags = Array.isArray(li.flagInconsistencies) ? li.flagInconsistencies.slice() : [];

    // --- PATCH W3C_MISSING_VERSION FLAGGING LOGIC ---
    // Remove W3C_MISSING_VERSION if it does not meet the new criteria
    if (flags.includes("W3C_MISSING_VERSION")) {
      // Try to get shortname from lineage or first doc
      let shortname = null;
      if (li.w3cFamily) shortname = li.w3cFamily;
      else if (li.docs && li.docs.length && li.docs[0] && li.docs[0]._w3c && li.docs[0]._w3c.shortname)
        shortname = li.docs[0]._w3c.shortname;
      if (!shouldFlagW3CMissingVersion(shortname)) {
        // Remove the flag
        flags = flags.filter(f => f !== "W3C_MISSING_VERSION");
        li.flagInconsistencies = flags;
      }
    }

    for (const raw of flags) {
      const type = String(raw).split(':')[0]; // namespaced types keep prefix before first ':'
      if (!acc.byType[type]) acc.byType[type] = { count: 0, examples: [] };
      acc.byType[type].count++;
      acc.totalFlags++;
      // Keep a compact example (lineage key plus the raw flag for context)
      if (acc.byType[type].examples.length < maxExamplesPerType) {
        acc.byType[type].examples.push({ lineage: lineageKey, flag: raw });
      }
    }
  }

  // Stable sort by descending count when rendering to console (we don't mutate structure here)
  return acc;
}

// Bridge lineages to versionless successors (e.g., W3C HTML → WHATWG HTML)
// If a lineage has flag SUPERSEDED_BY_OUT_OF_LINEAGE:src->target and the target
// looks versionless, attach an externalLatest pointer for downstream "resolve latest".
function attachVersionlessSuccessors(lineages) {
  if (!Array.isArray(lineages)) return;
  const FLAG_RE = /^SUPERSEDED_BY_OUT_OF_LINEAGE:([^>]+)->([A-Za-z0-9._-]+)$/;

  for (const li of lineages) {
    const flags = Array.isArray(li.flagInconsistencies) ? li.flagInconsistencies : [];
    for (const f of flags) {
      const m = String(f).match(FLAG_RE);
      if (!m) continue;
      const targetId = m[2];

      // Minimal stub so inferVersionless/publisherFromDoc work without needing the full doc
      const stub = { docId: targetId };
      const isVersionless = inferVersionless(stub);
      if (isVersionless) {
        li.externalSuccessor = {
          reason: 'external-versionless',
          docId: targetId,
          publisher: publisherFromDoc(stub)
        }
        // Note: we intentionally do NOT change latestAnyId here.
        // Callers can prefer externalLatest when present.
      }
    }
  }
}


function shouldSkipKey(k) {
  // Filter from the main report for now.

  return false;
}

// --- main ------------------------------------------------------------------

function buildIndex(allDocs) {
  const map = new Map(); // keyStr -> { key, docs: [...] }

  for (const d of allDocs) {
    if (!d || !d.docId) continue;
    // Policy-aligned early skips (collectSkipped() already logs these)
    const dt = (d.docType || '').trim();
    if (dt && NON_LINEAGE_DOCTYPES.has(dt)) {
      continue; // filtered docTypes do not participate in lineage
    }
    if (d && d.status && (d.status.draft === true || String(d.status.state || '').toLowerCase() === 'draft')) {
      continue; // drafts are excluded from lineage
    }
    // Normalize obvious aliases before any parsing/keying
    applyGlobalAliases(d);
    // Enrich W3C documents with normalized family/version info for stable keying
    normalizeW3C(d);
    const k = keyFromDocId(d.docId, d);
    if (!k || shouldSkipKey(k)) continue;

    // Capture original SMPTE doc type token and part (if present) for lineage diagnostics
    let _srcDocType = null;
    let _srcPart = null;
    // More permissive: supports alpha identifiers like OM.BL and AG.10C (alphanumeric) before the year
    const smpteHead = d.docId.match(/^SMPTE\.([A-Z]+)([0-9A-Z]*)(?:-([0-9A-Z]+))?\./i);
    if (smpteHead) {
      _srcDocType = smpteHead[1] ? smpteHead[1].toUpperCase() : null;
      // Preserve previous OV special-case; otherwise use captured hyphen-part token if present
      _srcPart = smpteHead[3] ? String(smpteHead[3]) : (_srcDocType === 'OV' ? '0' : null);
    }

    const keyStr = [k.publisher, k.suite || '', k.number, k.part || ''].join('|');
    if (!map.has(keyStr)) map.set(keyStr, { key: k, docs: [] });

    const status = d.status || {};
    const _statusLatest = !!(status.latestVersion === true);
    const statusActive = (typeof status.active === 'boolean') ? status.active : _statusLatest;
    const statusSuperseded = (typeof status.superseded === 'boolean') ? status.superseded : (!_statusLatest && (typeof status.latestVersion === 'boolean'));
    const statusWithdrawn = !!status.withdrawn;
    const statusStabilized = !!status.stabilized;
    const statusAmended = !!status.amended;
    const statusVersionless = d.status.versionless === true
    const releaseTag = typeof d.releaseTag === 'string' ? d.releaseTag : null;
    const _isSupplement = isSupplementDocId(d.docId);

    map.get(keyStr).docs.push({
      docId: d.docId,
      publicationDate: d.publicationDate || null,
      releaseTag,
      statusActive,
      statusSuperseded,
      statusWithdrawn,
      statusStabilized,
      statusAmended,
      statusVersionless,
      _dk: dateKeyFromDoc(d),
      _isBase: !isAmendmentDocId(d.docId) && !_isSupplement,
      _isSupplement,
      _statusLatest,
      _srcDocType,
      _srcPart,
      // Graph lineage hints (private)
      _supersededBy: Array.isArray(status.supersededBy) ? status.supersededBy.slice() : [],
      _supersededDate: (status && status.supersededDate) ? String(status.supersededDate) : null,
      // W3C debug fields for alias/collision checks
      _w3cShortname: (d._w3c && d._w3c.shortname) || null,
      _w3cFamily: (d._w3c && d._w3c.family) || null,
      // Global alias provenance
      _aliasedFrom: d._aliasedFrom || null,
    });
  }

  const lineages = [];
  for (const [keyStr, entry] of map.entries()) {
    // Sort ascending by date key
    entry.docs.sort((a, b) => a._dk.localeCompare(b._dk));

    // Build quick lookup for in-lineage docId → doc (for graph analysis)
    const idIndex = new Map(entry.docs.map(d => [d.docId, d]));

    const bases = entry.docs.filter(x => x._isBase);
    const supplements = entry.docs.filter(x => x._isSupplement);
    const amendments  = entry.docs.filter(x => !x._isBase && !x._isSupplement); 
    const flaggedBases = bases.filter(x => x._statusLatest);
    const flaggedAny = entry.docs.filter(x => x._statusLatest);

    // Helper: choose the newest by date key from a list
    const pickNewest = (arr) => arr.length ? arr.reduce((a, b) => (a._dk >= b._dk ? a : b)) : null;

    // Graph candidates: nodes with no supersededBy edge that stays within this lineage
    const baseGraphHeads = bases.filter(b => !b._supersededBy.some(id => idIndex.has(id) && idIndex.get(id)._isBase));
    const anyGraphHeads  = entry.docs.filter(d => !d._supersededBy.some(id => idIndex.has(id)));

    // Resolution order: explicit latest flag → graph heads → newest by date
    const latestBase = flaggedBases.length ? pickNewest(flaggedBases)
                        : (baseGraphHeads.length ? pickNewest(baseGraphHeads)
                        : pickNewest(bases));

    const latestAny  = flaggedAny.length ? pickNewest(flaggedAny)
                        : (anyGraphHeads.length ? pickNewest(anyGraphHeads)
                        : pickNewest(entry.docs));

    // Lineage-level helpers
    const hasActiveBase = bases.some(x => x.statusActive === true);
    const hasWithdrawn = entry.docs.some(x => x.statusWithdrawn === true);
    const hasStabilized = entry.docs.some(x => x.statusStabilized === true);

    const activeBases = bases.filter(x => x.statusActive === true);
    const supersededBases = bases.filter(x => x.statusSuperseded === true);
    const latestActiveBase = activeBases.length ? activeBases[activeBases.length - 1] : null;
    const latestSupersededBase = supersededBases.length ? supersededBases[supersededBases.length - 1] : null;

    // Previous base pointer (immediately before latestActiveBase by date order)
    let prevBase = null;
    if (latestActiveBase) {
      const idx = bases.indexOf(latestActiveBase);
      if (idx > 0) prevBase = bases[idx - 1];
    }

    // Inconsistency flags (lineage-level)
    const flags = [];
    // W3C lineage diagnostics
    if (entry.key.publisher === 'W3C') {
      // If this lineage aggregates multiple docs but has no version in key, flag for cleanup
      if (entry.docs.length > 1 && (entry.key.number == null || entry.key.number === '')) {
        flags.push('W3C_MISSING_VERSION');
      }

      // Detect raw shortname alias collisions collapsing to one family
      const rawShorts = Array.from(new Set(entry.docs.map(x => x._w3cShortname).filter(Boolean)));
      const famSet = new Set(entry.docs.map(x => x._w3cFamily).filter(Boolean));
      if (rawShorts.length > 1 && famSet.size === 1) {
        // If any of the raw shortnames is a known alias for another present token, flag it
        for (const [alias, canonical] of Object.entries(W3C_ALIAS_MAP)) {
          if (rawShorts.includes(alias) && (rawShorts.includes(canonical) || famSet.has(canonical))) {
            flags.push(`W3C_ALIAS_COLLISION:${alias}=>${canonical}`);
            break;
          }
        }
        // Generic multi-shortname collapse into single family
        if (!flags.some(f => f.startsWith('W3C_ALIAS_COLLISION:'))) {
          flags.push(`W3C_ALIAS_COLLISION:${rawShorts.join(',')}=>${Array.from(famSet)[0]}`);
        }
      }
    }
    if (flaggedAny.length > 1) flags.push('MULTIPLE_LATEST_FLAGS');
    if (flaggedAny.length >= 1) {
      const maxDk = entry.docs[entry.docs.length - 1]?._dk || null;
      // if any latest-flagged doc predates the max date key, warn
      const anyLatestBeforeMax = flaggedAny.some(x => maxDk && x._dk < maxDk);
      if (anyLatestBeforeMax) flags.push('LATEST_FLAG_BEFORE_DATE');
    }
    if (entry.docs.some(x => !x._isBase) && bases.length === 0) {
      flags.push('MISSING_BASE_FOR_AMENDMENT');
    }

    // SMPTE cross-type lineage diagnostics: same numeric family but mixed doc types (e.g., RP6 + RDD6)
    if (entry.key.publisher === 'SMPTE') {
      const typeSet = new Set(entry.docs.map(x => x._srcDocType).filter(Boolean));
      if (typeSet.size > 1) {
        flags.push('MIXED_SMPTE_DOCTYPES');
        const anyParts = entry.docs.some(x => x._srcPart !== null && x._srcPart !== undefined && x._srcPart !== '');
        if (!anyParts) {
          flags.push('DOC_TYPE_CHANGE_WITHOUT_PART');
        }
      }
    }

    // Superseded graph diagnostics
    // 1) Edges pointing outside this lineage
    for (const d of entry.docs) {
      for (const tgt of d._supersededBy || []) {
        if (!idIndex.has(tgt)) {
          flags.push(`SUPERSEDED_BY_OUT_OF_LINEAGE:${d.docId}->${tgt}`);
        }
      }
    }
    // 2) If there are explicit latest flags but graph suggests a different head
    if (flaggedAny.length) {
      const graphHead = pickNewest(anyGraphHeads);
      const flagHead  = pickNewest(flaggedAny);
      if (graphHead && flagHead && graphHead.docId !== flagHead.docId) {
        flags.push(`LATEST_FLAG_CONFLICT_WITH_GRAPH:any:${flagHead.docId}<>${graphHead.docId}`);
      }
    }
    if (flaggedBases.length) {
      const graphBaseHead = pickNewest(baseGraphHeads);
      const flagBaseHead  = pickNewest(flaggedBases);
      if (graphBaseHead && flagBaseHead && graphBaseHead.docId !== flagBaseHead.docId) {
        flags.push(`LATEST_FLAG_CONFLICT_WITH_GRAPH:base:${flagBaseHead.docId}<>${graphBaseHead.docId}`);
      }
    }

    // Per-doc sanity checks -> emit concise, namespaced flags (no auto-fix)
    for (const x of entry.docs) {
      // Alias lineage flag: always surface if an alias rewrite occurred
      if (x._aliasedFrom) {
        flags.push(`ALIASED_ID:${x._aliasedFrom}->${x.docId}`);
      }
      // 1) Contradictory status combos
      if (x.statusWithdrawn && x.statusActive) {
        flags.push(`CONTRADICTORY_STATUS_FLAGS:${x.docId}:ACTIVE_AND_WITHDRAWN`);
      }
      if (x.statusSuperseded && x.statusActive) {
        flags.push(`CONTRADICTORY_STATUS_FLAGS:${x.docId}:ACTIVE_AND_SUPERSEDED`);
      }

      // 2) docId year vs publicationDate year mismatch
      if (x.publicationDate && /^\d{4}-\d{2}-\d{2}$/.test(x.publicationDate)) {
        const pubYear = parseInt(x.publicationDate.slice(0, 4), 10);
        const idYear = yearFromDocIdTail(x.docId);
        if (idYear && pubYear && idYear !== pubYear) {
          flags.push(`DOCID_PUBDATE_MISMATCH:${x.docId}:docIdYear=${idYear},pubYear=${pubYear}`);
        }
      }

      // W3C edition without a reliable date (TR date or publicationDate)
      if (entry.key.publisher === 'W3C') {
        const hasEdition = d => d && d._w3c && Number.isInteger(d._w3c.edition);
        const src = (allDocs || []).find(dd => dd && dd.docId === x.docId);
        if (src && hasEdition(src)) {
          const hasDate = Boolean(x.releaseTag) || Boolean(x.publicationDate);
          if (!hasDate) {
            flags.push(`W3C_EDITION_WITHOUT_DATE:${x.docId}`);
          }
        }
      }

      // SMPTE-only: flag documents missing a releaseTag
      // Skip Application Guides (AG) and Operational Metadata (OM)
      if (entry.key.publisher === 'SMPTE') {
        const rt = (x.releaseTag == null) ? '' : String(x.releaseTag).trim();
        const token = (x._srcDocType || entry.key.suite || '').toUpperCase();
        if (!rt && token !== 'AG' && token !== 'OM') {
          flags.push(`SMPTE_MISSING_RELEASE_TAG:${x.docId}`);
        }
      }

    }

    // Emit lean docs (drop private fields, but include helpful status fields)
    const docsPublic = entry.docs.map(x => ({
      docId: x.docId,
      publicationDate: x.publicationDate,
      releaseTag: x.releaseTag,
      statusActive: x.statusActive,
      statusSuperseded: x.statusSuperseded,
      statusWithdrawn: x.statusWithdrawn,
      statusStabilized: x.statusStabilized,
      statusAmended: x.statusAmended,
      statusVersionless: x.statusVersionless
    }));

    const lineageObj = {
      key: keyStr,
      publisher: entry.key.publisher,
      suite: entry.key.suite,
      number: entry.key.number,
      part: entry.key.part,
      // W3C lineage annotations for clarity in reports
      w3cFamily: entry.key.publisher === 'W3C' ? entry.key.suite : undefined,
      w3cVersion: entry.key.publisher === 'W3C' ? (entry.key.number || null) : undefined,
      docs: docsPublic,
      latestBaseId: latestBase ? latestBase.docId : null,
      latestAnyId: latestAny ? latestAny.docId : null,
      latestDateKey: latestAny ? latestAny._dk : null,
      hasActiveBase,
      hasWithdrawn,
      hasStabilized,
      latestActiveBaseId: latestActiveBase ? latestActiveBase.docId : null,
      latestSupersededBaseId: latestSupersededBase ? latestSupersededBase.docId : null,
      prevBaseId: prevBase ? prevBase.docId : null,
      flagInconsistencies: flags,
      counts: {
        bases: bases.length,
        amendments: amendments.length,
        supplements: supplements.length
      }
    };

      lineages.push(lineageObj);

  }

  // Stable sort for deterministic output: by publisher, suite, number (numeric/lex), part (numeric/lex)
  lineages.sort((a, b) => {
    const ap = a.publisher.localeCompare(b.publisher);
    if (ap) return ap;
    const as = (a.suite || '').localeCompare(b.suite || '');
    if (as) return as;
    const aNum = Number(a.number), bNum = Number(b.number);
    if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
      if (aNum !== bNum) return aNum - bNum;
    } else {
      const s = String(a.number).localeCompare(String(b.number));
      if (s) return s;
    }
    const aPartNum = Number(a.part), bPartNum = Number(b.part);
    if (!Number.isNaN(aPartNum) && !Number.isNaN(bPartNum)) {
      if (aPartNum !== bPartNum) return aPartNum - bPartNum;
    } else {
      return String(a.part || '').localeCompare(String(b.part || ''));
    }
    return 0;
  });

  return lineages;
}

(function main() {
  if (!fs.existsSync(IN)) {
    console.error(`❌ Input not found: ${IN}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(IN, 'utf8');
  let docs = [];
  try {
    const parsed = JSON.parse(raw);
    docs = Array.isArray(parsed) ? parsed : parsed.documents || [];
  } catch (e) {
    console.error(`❌ Failed to parse JSON: ${e.message}`);
    process.exit(1);
  }

  // Pre-calc skipped docs (unkeyed/filtered) grouped by publisher for reporting
  const skippedDocs = collectSkipped(docs);
  const skippedByPublisher = {};
  for (const s of skippedDocs) {
    const pub = (s.publisher || 'UNKNOWN').toUpperCase();
    if (!skippedByPublisher[pub]) skippedByPublisher[pub] = { count: 0, docIds: [], items: [] };
    skippedByPublisher[pub].count++;
    // Keep the legacy flat list for quick scanning
    skippedByPublisher[pub].docIds.push(s.docId);
    // Also store a rich item with the reason inline so you don't have to jump to `details`
    const { docId, publisher, reason, rule, ruleDetail, category, key } = s;
    skippedByPublisher[pub].items.push({ docId, reason, rule, ruleDetail, category, key });
  }

  // Build a simple reason summary and keep a detailed list for audits
  // Always include all possible reason categories with count 0 if not present
  const SKIP_REASONS = ['FILTERED', 'UNKEYED', 'UNKNOWN'];
  const skippedSummary = skippedDocs.reduce((acc, s) => {
    const r = s.reason || 'UNKNOWN';
    acc[r] = (acc[r] || 0) + 1;
    return acc;
  }, Object.fromEntries(SKIP_REASONS.map(r => [r, 0])));

  // Pre-calc publisher counts for unified report
  const pubCountsSummary = computePublisherCounts(docs);

  // Optional quick publisher counts
  if (has('--publisher-counts')) {
    const summary = pubCountsSummary; // already computed
    console.log('📊 Publisher → docId counts');
    for (const [pub, n] of Object.entries(summary.counts)) {
      console.log(pub.padEnd(10), '→', n);
    }
    console.log('Total docs:', summary.total);
    // Optionally write aux files even in COUNT_ONLY mode
    if (SEPARATE_AUX) {
      ensureDir(PUB_COUNTS_OUT);
      fs.writeFileSync(PUB_COUNTS_OUT, JSON.stringify(summary, null, 2));
      console.log(`📝 Publisher counts written: ${PUB_COUNTS_OUT}`);
      ensureDir(SKIPS_OUT);
      fs.writeFileSync(SKIPS_OUT, JSON.stringify({ generatedAt: new Date().toISOString(), sourcePath: IN, totalSkipped: skippedDocs.length, byPublisher: skippedByPublisher }, null, 2));
      console.log(`📝 Skipped docs report written: ${SKIPS_OUT}`);
    }
    if (COUNT_ONLY) return; // skip building the big index if we only wanted counts
  }

  const lineages = buildIndex(docs);
  attachVersionlessSuccessors(lineages);
  //attachInlineVersionless(lineages);
  const flagSummary = computeFlagSummary(lineages);
  const outObj = {
    generatedAt: new Date().toISOString(),
    sourcePath: IN,
    sourceHash: sha256File(IN),
    publisherCounts: pubCountsSummary,
    skippedDocs: {
      totalSkipped: skippedDocs.length,
      byPublisher: skippedByPublisher,
      summaryByReason: skippedSummary,
    },
    flagSummary,
    lineages
  };

  // Simple counts: found in source vs added to report
  const foundCount = docs.length;
  const addedCount = Array.isArray(lineages)
    ? lineages.reduce((acc, li) => acc + (Array.isArray(li.docs) ? li.docs.length : 0), 0)
    : 0;
  const skippedCount = Math.max(0, foundCount - addedCount);
  console.log(`\n📦 Found in source: ${foundCount}`);
  console.log(`🧩 Added to report: ${addedCount}`);
  console.log(`🕳️ Skipped (unkeyed/filtered): ${skippedCount}`);

  // Per-publisher breakdown: found vs added vs skipped
  const foundPerPub = {};
  for (const d of docs) {
    if (!d || !d.docId) continue;
    const pub = publisherFromDoc(d);
    foundPerPub[pub] = (foundPerPub[pub] || 0) + 1;
  }

  const addedPerPub = {};
  for (const li of Array.isArray(lineages) ? lineages : []) {
    const pub = (li && li.publisher) ? String(li.publisher).toUpperCase() : 'UNKNOWN';
    const n = Array.isArray(li.docs) ? li.docs.length : 0;
    addedPerPub[pub] = (addedPerPub[pub] || 0) + n;
  }

  const pubs = Array.from(new Set([...Object.keys(foundPerPub), ...Object.keys(addedPerPub)]));
  pubs.sort((a, b) => (addedPerPub[b]||0) - (addedPerPub[a]||0));

  // Optional: surface a few docIds that contributed to UNKNOWN for triage
  const unknownExamples = [];
  for (const d of docs) {
    if (!d || !d.docId) continue;
    if (publisherFromDoc(d) === 'UNKNOWN') {
      unknownExamples.push(d.docId);
      if (unknownExamples.length >= 5) break;
    }
  }
  if (unknownExamples.length) {
    console.log('\n⚠️  Example UNKNOWN publisher docIds (first 5):');
    for (const ex of unknownExamples) console.log('   ', ex);
  }

  console.log('\n📊 Per-publisher counts:');
  console.log('Publisher  Found  Added  Skipped');
  for (const p of pubs) {
    const f = foundPerPub[p] || 0;
    const a = addedPerPub[p] || 0;
    const s = Math.max(0, f - a);
    console.log(`${String(p).padEnd(10)} ${String(f).padStart(5)}  ${String(a).padStart(5)}  ${String(s).padStart(7)}`);
  }

  // Flag summary (top types by count)
  if (flagSummary && flagSummary.totalFlags) {
    // Build a sorted array of [type, {count, examples}]
    const sortedFlags = Object.entries(flagSummary.byType)
      .sort((a, b) => (b[1].count || 0) - (a[1].count || 0));

    console.log('\n🚩 Flag summary:');
    console.log(`Total flags: ${flagSummary.totalFlags}`);
    for (const [type, info] of sortedFlags) {
      console.log(`- ${type.padEnd(32)} → ${String(info.count).padStart(4)}`);
    }
  } else {
    console.log('\n🚩 No inconsistency flags present.');
  }


  // Console list of skipped docIds per publisher (brief)
  if (!skippedDocs.length) {
    console.log('\n🧾 No skipped documents detected.');
  }

  // Optionally emit separate aux files only if SEPARATE_AUX is set
  if (SEPARATE_AUX) {
    ensureDir(PUB_COUNTS_OUT);
    fs.writeFileSync(PUB_COUNTS_OUT, JSON.stringify(pubCountsSummary, null, 2));
    console.log(`📝 Publisher counts written: ${PUB_COUNTS_OUT}`);
    ensureDir(SKIPS_OUT);
    fs.writeFileSync(SKIPS_OUT, JSON.stringify({ generatedAt: new Date().toISOString(), sourcePath: IN, totalSkipped: skippedDocs.length, byPublisher: skippedByPublisher }, null, 2));
    console.log(`📝 Skipped docs report written: ${SKIPS_OUT}`);
  }

  ensureDir(OUT);
  const tmp = OUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(outObj, null, 2));
  fs.renameSync(tmp, OUT);

  console.log(`\n✅ Master Suite Index written: ${OUT}`);
  console.log(`   Lineages: ${lineages.length}`);
})();