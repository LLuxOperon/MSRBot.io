/**
 * URL Rules — deterministic canonical URL resolvers (EXPECTATIONS)
 *
 * Goal in this context: define what a URL for a given publisher *should* look like.
 * These expectations are used by validators to flag store/host drift and by enrichers
 * (optionally) to polish a known good `resolvedUrl` — but should never *invent* links.
 *
 * API:
 *   resolveExpected(ctx) -> { field, expected, rule } | null
 *
 * ctx:
 *   {
 *     entry,          // the document/group/project record
 *     field,          // 'href' | 'repo' | 'groupLink' | 'groupRepo' | 'projectLink' ...
 *     url,            // candidate url (resolvedUrl or original)
 *     docId,          // document id if present
 *     publisher,      // publisher/org string if present
 *   }
 */

// -- helpers -----------------------------------------------------------------
const getPublisher = (e) => (e && e.publisher) || '';
const hasHost = (host, url) => {
  try { return new URL(url).hostname.toLowerCase().includes(host.toLowerCase()); } catch { return false; }
};
const ensureHttps = (u) => {
  try { const x = new URL(u); x.protocol = 'https:'; return x.toString(); } catch { return null; }
};
const stripHashQuery = (u) => {
  try { const x = new URL(u); x.hash = ''; x.search = ''; return x.toString(); } catch { return null; }
};
const trimTrailingSlash = (u) => typeof u === 'string' ? u.replace(/\/$/, '') : u;

// Build a safe https+no-fragment baseline without rewriting host
const baselineNormalize = (u) => trimTrailingSlash(stripHashQuery(ensureHttps(u)) || u);

// Prefer explicit doc type filters when available
const getDocType = (e) => (e && e.docType) || '';
const hasDocType = (e, ...types) => {
  const t = String(getDocType(e)).toLowerCase();
  if (!t) return false;
  return types.some(x => t.includes(String(x).toLowerCase()));
};

// -- rule definitions ---------------------------------------------------------
// Each rule exposes: { name, when(ctx), resolve(ctx) -> expectedUrl|null }

// WHATWG — keep host/path, https, no fragment
const ruleWHATWG = {
  name: 'WHATWG',
  when: ({ url, publisher }) => hasHost('whatwg.org', url) || /whatwg/i.test(publisher || ''),
  resolve: ({ url }) => baselineNormalize(url)
};

// IETF / RFC-Editor — prefer rfc-editor canonical when RFC number is known from docId; otherwise baseline
const ruleIETF = {
  name: 'IETF',
  when: ({ url, publisher, docId }) => (
    hasHost('ietf.org', url) || hasHost('rfc-editor.org', url) || hasHost('datatracker.ietf.org', url) || /ietf/i.test(publisher || '') || /RFC[-.]?\d{3,5}/i.test(String(docId || ''))
  ),
  resolve: ({ url, docId }) => {
    const m = String(docId || '').match(/RFC[-.]?(\d{3,5})/i);
    if (m) return `https://www.rfc-editor.org/rfc/rfc${m[1]}`;
    return baselineNormalize(url);
  }
};

// W3C TR — https, no fragment; do not synthesize shortnames (too risky)
const ruleW3C = {
  name: 'W3C',
  when: ({ url, publisher }) => hasHost('w3.org', url) || /\bW3C\b/i.test(publisher || ''),
  resolve: ({ url }) => baselineNormalize(url)
};

// NIST — prefer https
const ruleNIST = {
  name: 'NIST',
  when: ({ url, publisher }) => hasHost('nist.gov', url) || /nist/i.test(publisher || ''),
  resolve: ({ url }) => baselineNormalize(url)
};

// SMPTE — prefer https and stable path
const ruleSMPTE = {
  name: 'SMPTE',
  when: ({ url, publisher }) => hasHost('smpte.org', url) || /smpte/i.test(publisher || ''),
  resolve: ({ url }) => baselineNormalize(url)
};

// IEEE — https baseline; public access varies so avoid deeper rewrites
const ruleIEEE = {
  name: 'IEEE',
  when: ({ url, publisher }) => hasHost('ieee.org', url) || hasHost('ieeexplore.ieee.org', url) || /ieee/i.test(publisher || ''),
  resolve: ({ url }) => baselineNormalize(url)
};

// ETSI — conservative baseline
const ruleETSI = {
  name: 'ETSI',
  when: ({ url, publisher }) => hasHost('etsi.org', url) || /etsi/i.test(publisher || ''),
  resolve: ({ url }) => baselineNormalize(url)
};

// 3GPP — conservative baseline
const rule3GPP = {
  name: '3GPP',
  when: ({ url, publisher }) => hasHost('3gpp.org', url) || /3gpp/i.test(publisher || ''),
  resolve: ({ url }) => baselineNormalize(url)
};

// ISO/IEC — vendor portals vary; keep to https baseline only
const ruleISOIEC = {
  name: 'ISO/IEC',
  when: ({ url, publisher }) => hasHost('iso.org', url) || hasHost('iec.ch', url) || /(\bISO\b|\bIEC\b)/i.test(publisher || ''),
  resolve: ({ url }) => baselineNormalize(url)
};

const RULES = [
  ruleWHATWG,
  ruleIETF,
  ruleW3C,
  ruleNIST,
  ruleSMPTE,
  ruleIEEE,
  ruleETSI,
  rule3GPP,
  ruleISOIEC,
];

// ---------------- EXPECTATION CHECKS (non-rewriting) -------------------------
// These rules do not construct URLs. They assert that a given field value
// matches an expected *shape* (e.g., prefix/host) and report mismatches.

function startsWithPrefix(u, prefix) {
  if (!u || !prefix) return false;
  try { return String(u).startsWith(prefix); } catch { return false; }
}

// Expectation rule signature:
//  { name, when(ctx), check(ctx) -> { ok, expectedPrefix, actual, field }|null }

const isSMPTE = (e) => /^SMPTE$/i.test((e && e.publisher) || '');

const expSMPTE_HREF_DOI = {
  name: 'SMPTE.href.doi-prefix',
  when: ({ entry, field }) => 
    field === 'href' && 
    isSMPTE(entry) &&
    hasDocType(entry, 'Standard', 'Recommended Practice', 'Engineering Guideline', 'Registered Disclosure Document', 'Overview Document', 'Journal Article'),
  check: ({ url, field }) => {
    const expectedPrefix = 'https://doi.org/10.5594/';
    const ok = startsWithPrefix(url, expectedPrefix);
    return { ok, expectedPrefix, actual: url, field };
  }
};

const expSMPTE_HREF_AG = {
  name: 'SMPTE.href.ag-prefix',
  when: ({ entry, field }) => 
    field === 'href' && 
    isSMPTE(entry) &&
    hasDocType(entry, 'Administrative Guideline', 'Operations Manual'),
  check: ({ url, field }) => {
    const expectedPrefix = 'https://doc.smpte-doc.org/';
    const ok = startsWithPrefix(url, expectedPrefix);
    return { ok, expectedPrefix, actual: url, field };
  }
};

const expSMPTE_REPO_GH = {
  name: 'SMPTE.repo.gh-prefix',
  when: ({ entry, field }) => 
    field === 'repo' && 
    isSMPTE(entry),
  check: ({ url, field }) => {
    const expectedPrefix = 'https://github.com/SMPTE/';
    const ok = startsWithPrefix(url, expectedPrefix);
    return { ok, expectedPrefix, actual: url, field };
  }
};

const expSMPTE_RESOLVED_STANDARDS = {
  name: 'SMPTE.resolvedHref.standards-prefix',
  when: ({ entry, field }) => (
    field === 'resolvedHref' &&
    isSMPTE(entry) &&
    hasDocType(entry, 'Standard', 'Recommended Practice', 'Engineering Guideline', 'Registered Disclosure Document', 'Overview Document')
  ),
  check: ({ url, field }) => {
    const expectedPrefix = 'https://pub.smpte.org/doc/';
    const ok = startsWithPrefix(url, expectedPrefix);
    return { ok, expectedPrefix, actual: url, field };
  }
};

const expSMPTE_RESOLVED_JOURNALS = {
  name: 'SMPTE.resolvedHref.journals-prefix',
  when: ({ entry, field }) => (
    field === 'resolvedHref' && 
    isSMPTE(entry) &&
    hasDocType(entry, 'Journal Article')
  ),
  check: ({ url, field }) => {
    const expectedPrefix = 'https://journal.smpte.org/periodicals/';
    const ok = startsWithPrefix(url, expectedPrefix);
    return { ok, expectedPrefix, actual: url, field };
  }
};

// Add more expectation rules per-publisher as needed
const EXPECTATION_RULES = [
  expSMPTE_HREF_DOI,
  expSMPTE_HREF_AG,
  expSMPTE_REPO_GH,
  expSMPTE_RESOLVED_STANDARDS,
  expSMPTE_RESOLVED_JOURNALS,
];

/**
 * checkExpectations(ctx)
 * Returns an array of findings for rules that apply. Each finding has:
 *   { rule, ok, expectedPrefix, actual, field }
 */
function checkExpectations(ctx) {
  const findings = [];
  const safeCtx = {
    entry: ctx.entry,
    field: ctx.field,
    url: ctx.url,
    docId: ctx.docId || (ctx.entry && ctx.entry.docId) || '',
    publisher: ctx.publisher || getPublisher(ctx.entry)
  };
  for (const r of EXPECTATION_RULES) {
    try {
      if (r.when(safeCtx)) {
        const f = r.check(safeCtx);
        if (f) findings.push({ rule: r.name, ...f });
      }
    } catch {/* ignore */}
  }
  return findings;
}

/**
 * Try rules in order and return the first deterministic expectation produced.
 * Never fabricate a URL from thin air — we either normalize the given url, or, when
 * safe (IETF RFC), synthesize from docId pattern.
 */
function resolveExpected(ctx) {
  // Derive defaults commonly used by rules
  const safeCtx = {
    entry: ctx.entry,
    field: ctx.field,
    url: ctx.url,
    docId: ctx.docId || (ctx.entry && ctx.entry.docId) || '',
    publisher: ctx.publisher || getPublisher(ctx.entry)
  };

  for (const r of RULES) {
    try {
      if (r.when(safeCtx)) {
        const expected = r.resolve(safeCtx);
        if (expected && typeof expected === 'string') {
          return { field: safeCtx.field, expected, rule: r.name };
        }
      }
    } catch {/* ignore rule errors */}
  }
  return null;
}

function suggestAutofix(ctx) {
  const out = [];
  // Only make suggestions for resolved* fields (post-redirect truth)
  const isResolvedField = String(ctx.field || '').startsWith('resolved');
  if (!isResolvedField || !ctx.url) return out;
  let host = '';
  try { host = new URL(ctx.url).hostname.toLowerCase(); } catch {}

  // IETF: rfc-editor.org is canonical for RFCs — safe to backfill resolved*
  if (host.endsWith('rfc-editor.org')) {
    out.push({
      type: 'set',
      field: ctx.field,          // e.g., 'resolvedHref'
      newValue: ctx.url,
      autofix: true,
      confidence: 'high',
      rationale: 'IETF canonical host (rfc-editor.org) observed via redirect.'
    });
  }
  // W3C: TR space on w3.org is stable enough for resolved* backfill
  else if (host.endsWith('w3.org')) {
    out.push({
      type: 'set',
      field: ctx.field,
      newValue: ctx.url,
      autofix: true,
      confidence: 'high',
      rationale: 'W3C TR host (w3.org) observed via redirect.'
    });
  }
  return out;
}

module.exports = {
  RULES,
  resolveExpected,
  EXPECTATION_RULES,
  checkExpectations,
  suggestAutofix
};
