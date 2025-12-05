/*
Copyright (c) 2025 Steve LLamb (https://github.com/SteveLLamb) and PrZ3(https://github.com/PrZ3r)

Redistribution and use in source and binary forms, with or without modification, 
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

3. Redistributions in binary form must reproduce the above copyright notice, this
   list of conditions and the following disclaimer in the documentation and/or
   other materials provided with the distribution.

4. Neither the name of the copyright holder nor the names of its contributors may
   be used to endorse or promote products derived from this software without specific 
   prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS “AS IS” AND 
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED 
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE 
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE 
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL 
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR 
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER 
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR 
TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF 
THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

/**
 * Prune MRI to keep only sightings present in the given index.
 * @param {Set<string>} index - Set of keys `${refId}||${docId}||${type}` representing current truth.
 * @param {object} opts - Options: { removeEmptyRefs?: boolean }
 * @returns {{ removedVariants: number, removedRefs: number }}
 */
function mriPruneToSightings(index, opts = {}) {
  // index: Set of keys `${refId}||${docId}||${type}` representing CURRENT truth
  const removeEmptyRefs = opts.removeEmptyRefs !== false; // default true
  const mri = _loadMRI();
  let removedVariants = 0;
  let removedRefs = 0;

  for (const [refId, entry] of Object.entries(mri.refs || {})) {
    const before = Array.isArray(entry.rawVariants) ? entry.rawVariants.length : 0;
    if (before) {
      const kept = [];
      for (const v of entry.rawVariants) {
        const key = `${refId}||${v.docId || ''}||${v.type || ''}`;
        if (index.has(key)) kept.push(v); else removedVariants++;
      }
      if (kept.length !== before) {
        entry.rawVariants = kept;
        _dirty = true;
      }
    }

    // Optionally drop the entire refId if it has no variants and isn't a source doc itself
    const hasAny = Array.isArray(entry.rawVariants) && entry.rawVariants.length > 0;
    const isSource = !!(entry.resolution && entry.resolution.sourcePresent);
    if (removeEmptyRefs && !hasAny && !isSource) {
      delete mri.refs[refId];
      removedRefs++;
      _dirty = true;
    }
  }

  // Recompute stats
  mri.stats.uniqueRefIds = Object.keys(mri.refs || {}).length;

  // Orphan pruning: drop orphans that are now resolvable or belong to removed docs
  let removedOrphans = 0;
  if (mri.orphans && Array.isArray(mri.orphans.unmapped)) {
    // Build a quick set of docIds present in current truth for fast lookups
    const presentDocIds = new Set();
    for (const key of index) {
      const parts = String(key).split('||');
      // key format: `${refId}||${docId}||${type}`
      if (parts.length >= 3 && parts[1]) presentDocIds.add(parts[1]);
    }

    const keptOrphans = [];
    for (const o of mri.orphans.unmapped) {
      const docId = o && o.docId ? String(o.docId) : '';
      const type = o && o.type ? String(o.type) : '';

      // If the document no longer exists in current truth, drop the orphan
      const docGone = docId && !presentDocIds.has(docId);

      // If we can now resolve this orphan to a refId and that sighting exists, drop it
      let nowResolved = false;
      try {
        const rid = parseRefId(o && o.cite ? o.cite : '', o && o.href ? o.href : '');
        if (rid) {
          const key = `${rid}||${docId}||${type}`;
          if (index.has(key)) nowResolved = true;
        }
      } catch {}

      if (docGone || nowResolved) {
        removedOrphans++;
        _dirty = true;
      } else {
        keptOrphans.push(o);
      }
    }

    if (keptOrphans.length !== mri.orphans.unmapped.length) {
      mri.orphans.unmapped = keptOrphans;
    }
  }

  if (process.env.DEBUG || process.env.MSR_DEBUG) {
    console.log(`🧹 MRI prune: removedVariants=${removedVariants}, removedRefs=${removedRefs}, removedOrphans=${typeof removedOrphans === 'number' ? removedOrphans : 0}`);
  }

  return { removedVariants, removedRefs, removedOrphans: typeof removedOrphans === 'number' ? removedOrphans : 0 };
}

// referencing.js — shared helpers for building references from HTML
// Centralizes refMap pattern loading, cite→refId mapping, and DOM extraction

const fs = require('fs');
const path = require('path');

// ---- documents.json presence index (for quick source checks) ----
// Resolve documents.json robustly (works no matter where Node is launched from)
function _resolveDocumentsPath() {
  const candidates = [
    // Relative to this file's directory (preferred)
    path.resolve(__dirname, '..', 'data', 'documents.json'), // src/main/reports/documents.json
    // Relative to repo root based on common cwd patterns
    path.resolve(process.cwd(), 'src/main/data/documents.json'),
    path.resolve(process.cwd(), 'data', 'documents.json'),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return candidates[0]; // fallback to the expected path relative to __dirname
}

let _DOCS_PATH = null;
function _getDocsPath() {
  if (_DOCS_PATH) return _DOCS_PATH;
  _DOCS_PATH = _resolveDocumentsPath();
  return _DOCS_PATH;
}
let _docIdIndex = null; // Set<string> of docIds from documents.json
let _docBaseIndex = null; // Map<string base, string[]> of docIds by base
const DATED_TAIL_RE = /\.(?:\d{8}|\d{4}(?:-\d{2}){0,2})$/; // .YYYY | .YYYY-MM | .YYYY-MM-DD | .YYYYMMDD

function _loadDocumentsIndex() {
  if (_docIdIndex && _docBaseIndex) return _docIdIndex;
  try {
    _docIdIndex = new Set();
    _docBaseIndex = new Map();
    const DOCS_PATH = _getDocsPath();
    if (!fs.existsSync(DOCS_PATH)) {
      if (process.env.DEBUG || process.env.MSR_DEBUG) {
        console.warn(`⚠️ documents.json not found at ${DOCS_PATH} — sourcePresent checks will return false`);
      }
      return _docIdIndex;
    }
    const raw = fs.readFileSync(DOCS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);

    const addId = (id) => {
      if (!id || typeof id !== 'string') return;
      _docIdIndex.add(id);
      const base = id.replace(DATED_TAIL_RE, '');
      if (base) {
        const arr = _docBaseIndex.get(base) || [];
        if (!arr.includes(id)) arr.push(id);
        _docBaseIndex.set(base, arr);
      }
    };

    if (Array.isArray(parsed)) {
      for (const d of parsed) {
        if (d && typeof d === 'object') {
          if (typeof d.docId === 'string') addId(d.docId);
          if (typeof d.docBase === 'string') addId(d.docBase);
        }
      }
    } else if (parsed && typeof parsed === 'object') {
      for (const k of Object.keys(parsed)) addId(k);
      for (const v of Object.values(parsed)) {
        if (v && typeof v === 'object') {
          if (typeof v.docId === 'string') addId(v.docId);
          if (typeof v.docBase === 'string') addId(v.docBase);
        }
      }
    }
  } catch {
    _docIdIndex = new Set();
    _docBaseIndex = new Map();
  }
  return _docIdIndex;
}

function _hasDocId(id) {
  if (!id) return false;
  const idx = _loadDocumentsIndex();
  return idx.has(String(id));
}

function _dateRankFromId(id) {
  // Return a numeric rank for comparing dated ids; higher = newer. Undated -> -Infinity.
  if (!id || typeof id !== 'string') return Number.NEGATIVE_INFINITY;
  const m = id.match(/\.(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$|\.(\d{8})$/);
  if (!m) return Number.NEGATIVE_INFINITY;
  if (m[4]) { // YYYYMMDD
    return parseInt(m[4], 10);
  }
  const y = parseInt(m[1], 10);
  const mo = m[2] ? parseInt(m[2], 10) : 0;
  const d = m[3] ? parseInt(m[3], 10) : 0;
  return y * 10000 + mo * 100 + d;
}

function _findSourceDocIdForRefId(refId) {
  if (!refId) return null;
  _loadDocumentsIndex();
  const id = String(refId);
  // 1) exact id present
  if (_docIdIndex && _docIdIndex.has(id)) return id;
  // 2) base match: choose the latest dated docId for the same base
  const base = id.replace(DATED_TAIL_RE, '');
  let arr = _docBaseIndex ? _docBaseIndex.get(base) : null;

  // Fallback: if base map is empty (e.g., index built from array without docBase fields),
  // derive candidates by scanning all docIds that start with `${base}.` or `${base}-`
  if ((!arr || arr.length === 0) && _docIdIndex && _docIdIndex.size) {
    const dotPrefix = `${base}.`;
    const dashPrefix = `${base}-`;
    arr = [];
    for (const cand of _docIdIndex) {
      if (
        cand === base ||
        cand.startsWith(dotPrefix) ||
        cand.startsWith(dashPrefix)
      ) {
        arr.push(cand);
      }
    }
  }

  if (arr && arr.length) {
    // Prefer exact base if present, else highest date rank
    let best = null;
    let bestRank = Number.NEGATIVE_INFINITY;
    for (const cand of arr) {
      if (cand === base) return cand; // exact base id present
      const r = _dateRankFromId(cand);
      if (r > bestRank) {
        bestRank = r;
        best = cand;
      }
    }
    // If all ranks were -Infinity (unparseable dates), just pick the first candidate
    return best || arr[0] || null;
  }
  return null;
}

function _hasDocIdOrBase(id) {
  return !!_findSourceDocIdForRefId(id);
}

function reloadDocumentsIndex() {
  _docIdIndex = null;
  _docBaseIndex = null;
  _DOCS_PATH = null;
  return _loadDocumentsIndex();
}

// ---- refMap pattern loading / normalization ----

// ---- Master Reference Index (MRI) helpers ----
const MRI_PATH = path.resolve(process.cwd(), 'src/main/reports/masterReferenceIndex.json');
let _mri = null;
let _dirty = false;

function _initEmptyMRI() {
  return {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    stats: { uniqueRefIds: 0 },
    refs: {},
    reverse: {},
    orphans: { unmapped: [] }
  };
}

function _stableSort(arr, keyFn) {
  return arr
    .map((v, i) => ({ v, i }))
    .sort((a, b) => {
      const ka = keyFn(a.v);
      const kb = keyFn(b.v);
      if (ka < kb) return -1;
      if (ka > kb) return 1;
      return a.i - b.i;
    })
    .map(x => x.v);
}

function _loadMRI() {
  if (_mri) return _mri;
  try {
    if (fs.existsSync(MRI_PATH)) {
      const raw = fs.readFileSync(MRI_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      _mri = parsed && typeof parsed === 'object' ? parsed : _initEmptyMRI();
    } else {
      // ensure folder exists
      fs.mkdirSync(path.dirname(MRI_PATH), { recursive: true });
      _mri = _initEmptyMRI();
    }
  } catch {
    _mri = _initEmptyMRI();
  }
  return _mri;
}

function _ensureRef(refId) {
  const mri = _loadMRI();
  if (!mri.refs[refId]) {
    mri.refs[refId] = {
      refId,
      normalized: null,
      resolution: null,
      provenance: { firstSeen: null, mapSource: [], mapDetails: [] },
      rawVariants: []
    };
  }
  return mri.refs[refId];
}

function _dedupeVariants(arr) {
  const seen = new Set();
  const out = [];
  for (const r of arr) {
    const key = [
      r.docId,
      r.type,
      (r.cite || '').trim(),
      (r.href || '').trim(),
      (r.rawRef || '').trim(),
      (r.title || '').trim()
    ].join('||');
    if (!seen.has(key)) {
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}

function _dedupeStrings(arr) {
  const s = new Set();
  const out = [];
  for (const v of arr) {
    if (!s.has(v)) {
      s.add(v);
      out.push(v);
    }
  }
  return out;
}

function mriRecordSighting({ docId, type, refId, cite, href, mapSource, mapDetail, rawRef, title }) {
  const mri = _loadMRI();

  _dirty = true;

  if (refId) {
    const entry = _ensureRef(refId);
    // provenance
    if (!entry.provenance.firstSeen) {
      entry.provenance.firstSeen = new Date().toISOString();
    }
    if (mapSource) {
      entry.provenance.mapSource = _dedupeStrings([...(entry.provenance.mapSource || []), String(mapSource)]);
    }
    if (mapDetail) {
      const details = [...(entry.provenance.mapDetails || []), String(mapDetail)];
      entry.provenance.mapDetails = _dedupeStrings(details);
    }
    // resolution/source presence: note if this refId exists as a source doc in documents.json
    entry.resolution = entry.resolution || {};
    // Tentative hint; final truth set in mriFlush after documents.json is finalized
    if (typeof entry.resolution.sourcePresent !== 'boolean') {
      entry.resolution.sourcePresent = _hasDocIdOrBase(refId);
    }
    // variants (merge by (docId,type); never overwrite filled fields with blanks)
    entry.rawVariants = entry.rawVariants || [];
    const norm = v => (typeof v === 'string' ? v : (v == null ? '' : String(v)));
    const newVar = { docId, type, cite: norm(cite), href: norm(href), rawRef: norm(rawRef), title: title == null ? '' : String(title) };

    let merged = false;
    for (let i = 0; i < entry.rawVariants.length; i++) {
      const v = entry.rawVariants[i] || {};
      if (v.docId === newVar.docId && v.type === newVar.type) {
        const out = { ...v };
        // Enrich field-wise: prefer existing non-empty; fill from new when existing is empty
        out.cite   = (out.cite && out.cite.trim().length)     ? out.cite   : newVar.cite;
        out.href   = (out.href && out.href.trim().length)     ? out.href   : newVar.href;
        out.rawRef = (out.rawRef && out.rawRef.trim().length) ? out.rawRef : newVar.rawRef;
        // title can legitimately be null; treat empty-string as missing
        const oldTitle = (out.title == null || String(out.title).trim() === '') ? '' : String(out.title);
        const newTitle = (newVar.title == null || String(newVar.title).trim() === '') ? '' : String(newVar.title);
        out.title = oldTitle || newTitle || null;

        // Only mark dirty if something actually changed
        const changed = (
          out.cite !== v.cite ||
          out.href !== v.href ||
          out.rawRef !== v.rawRef ||
          (out.title || null) !== (v.title || null)
        );
        if (changed) {
          entry.rawVariants[i] = out;
        }
        merged = true;
        break;
      }
    }
    if (!merged) {
      // Normalize empty fields to '' except title→null for consistency
      const v = { ...newVar, title: (newVar.title && newVar.title.trim().length) ? newVar.title : null };
      entry.rawVariants.push(v);
    }
    // Final safety: collapse any accidental dupes
    entry.rawVariants = _dedupeVariants(entry.rawVariants);
  } else {
    // orphan
    mri.orphans = mri.orphans || { unmapped: [] };
    const orphan = { docId, type, cite, href, rawRef, title };
    const key = JSON.stringify(orphan);
    const exists = (mri.orphans.unmapped || []).some(x => JSON.stringify(x) === key);
    if (!exists) {
      (mri.orphans.unmapped ||= []).push(orphan);
    }
  }

  // stats
  const keys = Object.keys(mri.refs);
  mri.stats.uniqueRefIds = keys.length;
}

mriFlush
function mriFlush(opts = {}) {
  const { force = false } = opts;
  const mri = _loadMRI();
  const fileExists = fs.existsSync(MRI_PATH);
  const shouldWrite = force || _dirty || !fileExists;

  // Ensure documents index reflects the final state of this run
  try { reloadDocumentsIndex(); } catch {}

  // Optionally, print debug info about which documents.json path was used
  if (process.env.DEBUG || process.env.MSR_DEBUG) {
    try { console.log(`🔎 Using documents.json at: ${_getDocsPath()}`); } catch {}
  }

  // --- Check if only generatedAt changed, so we can skip writing and log a distinct reason
  if (!force && fileExists) {
    // Prepare comparable objects for diff, ignoring generatedAt
    let existing = null;
    try {
      existing = JSON.parse(fs.readFileSync(MRI_PATH, 'utf-8'));
    } catch {}
    if (existing) {
      // Prepare baseOut and existingComparable (without generatedAt)
      const sortedRefsKeys = Object.keys(mri.refs || {}).sort();
      const refsOut = {};
      for (const k of sortedRefsKeys) {
        const e = mri.refs[k];
        const sortedVariants = _stableSort(e.rawVariants || [], v => `${v.docId}||${v.type}||${(v.cite || '').toLowerCase()}`);
        const sortedMapSource = (e.provenance?.mapSource || []).slice().sort();
        const sortedMapDetails = (e.provenance?.mapDetails || []).slice(); // keep order

        // Final authority: check documents.json (docId and docBase) now that it should be finalized
        const matchDocId = _findSourceDocIdForRefId(e.refId);
        const present = !!matchDocId;
        e.resolution = e.resolution || {};
        const prevPresent = !!e.resolution.sourcePresent;
        const prevDoc = e.resolution.sourceDocId || null;
        if (present !== prevPresent || matchDocId !== prevDoc) {
          e.resolution.sourcePresent = present;
          e.resolution.sourceDocId = matchDocId || null;
          if (present && !e.resolution.firstConfirmedSourceAt) {
            e.resolution.firstConfirmedSourceAt = new Date().toISOString();
          }
          _dirty = true;
        }

        refsOut[k] = {
          refId: e.refId,
          normalized: e.normalized || null,
          resolution: e.resolution || null,
          provenance: {
            firstSeen: e.provenance?.firstSeen || null,
            mapSource: sortedMapSource.length ? sortedMapSource : undefined,
            mapDetails: sortedMapDetails.length ? sortedMapDetails : undefined
          },
          rawVariants: sortedVariants.length ? sortedVariants : undefined
        };
      }
      const baseOut = {
        version: mri.version || '1.0.0',
        // omit generatedAt for comparison
        stats: { uniqueRefIds: Object.keys(refsOut).length },
        refs: refsOut,
        reverse: mri.reverse || {},
        orphans: {
          unmapped: (mri.orphans?.unmapped || []).slice(0, 200)
        }
      };
      // Build comparable version of existing (without generatedAt)
      const { generatedAt, ...existingComparable } = existing;
      if (JSON.stringify(existingComparable) === JSON.stringify(baseOut)) {
        _dirty = false;
        return {
          path: MRI_PATH,
          wrote: false,
          reason: 'timestamp-only',
          uniqueRefIds: baseOut.stats.uniqueRefIds,
          orphanCount: baseOut.orphans.unmapped.length
        };
      }
    }
  }

  if (!shouldWrite) {
    return { path: MRI_PATH, wrote: false, reason: 'unchanged', uniqueRefIds: Object.keys(mri.refs || {}).length, orphanCount: (mri.orphans?.unmapped || []).length };
  }

  // Sort keys/arrays for stable diffs
  const sortedRefsKeys = Object.keys(mri.refs || {}).sort();
  const refsOut = {};
  for (const k of sortedRefsKeys) {
    const e = mri.refs[k];
    const sortedVariants = _stableSort(e.rawVariants || [], v => `${v.docId}||${v.type}||${(v.cite || '').toLowerCase()}`);
    const sortedMapSource = (e.provenance?.mapSource || []).slice().sort();
    const sortedMapDetails = (e.provenance?.mapDetails || []).slice(); // keep order

    // Final authority: check documents.json (docId and docBase) now that it should be finalized
    const matchDocId = _findSourceDocIdForRefId(e.refId);
    const present = !!matchDocId;
    e.resolution = e.resolution || {};
    const prevPresent = !!e.resolution.sourcePresent;
    const prevDoc = e.resolution.sourceDocId || null;
    if (present !== prevPresent || matchDocId !== prevDoc) {
      e.resolution.sourcePresent = present;
      e.resolution.sourceDocId = matchDocId || null;
      if (present && !e.resolution.firstConfirmedSourceAt) {
        e.resolution.firstConfirmedSourceAt = new Date().toISOString();
      }
      _dirty = true;
    }

    refsOut[k] = {
      refId: e.refId,
      normalized: e.normalized || null,
      resolution: e.resolution || null,
      provenance: {
        firstSeen: e.provenance?.firstSeen || null,
        mapSource: sortedMapSource.length ? sortedMapSource : undefined,
        mapDetails: sortedMapDetails.length ? sortedMapDetails : undefined
      },
      rawVariants: sortedVariants.length ? sortedVariants : undefined
    };
  }
  const out = {
    version: mri.version || '1.0.0',
    generatedAt: mri.generatedAt || new Date().toISOString(),
    stats: { uniqueRefIds: Object.keys(refsOut).length },
    refs: refsOut,
    reverse: mri.reverse || {},
    orphans: {
      unmapped: (mri.orphans?.unmapped || []).slice(0, 200)
    }
  };
  if (shouldWrite) {
    out.generatedAt = new Date().toISOString();
  }
  fs.mkdirSync(path.dirname(MRI_PATH), { recursive: true });
  fs.writeFileSync(MRI_PATH, JSON.stringify(out, null, 2) + '\n');

  _dirty = false;
  return { path: MRI_PATH, wrote: true, uniqueRefIds: Object.keys(refsOut).length, orphanCount: out.orphans.unmapped.length };
}

function mriEnsureFile() {
  // Will write if file is missing; otherwise no-op thanks to dirty guard
  return mriFlush({ force: false });
}
let _patternIndex = null;
let _refMapLoadError = null;

function _normalizePatterns(val) {
  if (Array.isArray(val)) return val.filter(v => typeof v === 'string' && v.trim().length > 0);
  if (typeof val === 'string' && val.trim().length > 0) return [val];
  return [];
}

function _buildPatternIndex(refMap) {
  const out = [];
  if (!refMap || typeof refMap !== 'object') return out;
  const byCitePatterns = refMap.byCitePatterns || {};
  for (const [refId, patternsVal] of Object.entries(byCitePatterns)) {
    const patterns = _normalizePatterns(patternsVal);
    if (!patterns.length) continue;
    for (const pat of patterns) {
      const m = pat.match(/^\s*\/(.*)\/([a-z]*)\s*$/i);
      if (m) {
        const body = m[1];
        const flags = m[2] || 'i';
        try { out.push({ type: 'regex', re: new RegExp(body, flags), refId }); } catch {/* ignore bad regex */}
      } else {
        const key = String(pat).replace(/\s+/g, ' ').trim().toLowerCase();
        if (key) out.push({ type: 'plain', key, refId });
      }
    }
  }
  return out;
}

function _lazyLoadPatternIndex() {
  if (_patternIndex) return _patternIndex;
  try {
    const refMapPath = path.resolve(process.cwd(), 'src/main/input/refMap.json');
    const raw = fs.readFileSync(refMapPath, 'utf-8');
    const refMap = JSON.parse(raw);
    _patternIndex = _buildPatternIndex(refMap);
  } catch (e) {
    _refMapLoadError = e;
    _patternIndex = [];
  }
  return _patternIndex;
}

function reloadRefMap() {
  _patternIndex = null;
  _refMapLoadError = null;
  return _lazyLoadPatternIndex();
}

// ---- cite→refId helpers ----
function mapRefByCiteDiag(text) {
  if (!text) return { refId: null, mapSource: null, mapDetail: null };
  const idx = _lazyLoadPatternIndex();
  const raw = String(text);
  const norm = raw.replace(/\s+/g, ' ').trim().toLowerCase();
  // plain first
  for (const p of idx) {
    if (p.type === 'plain' && p.key === norm) {
      return { refId: p.refId, mapSource: 'plain', mapDetail: `=${norm}` };
    }
  }
  // regex next
  for (const p of idx) {
    if (p.type === 'regex') {
      try {
        if (p.re.test(raw)) return { refId: p.refId, mapSource: 'regex', mapDetail: p.re.toString() };
      } catch {}
    }
  }
  return { refId: null, mapSource: null, mapDetail: null };
}

function mapRefByCite(text) {
  if (!text) return null;
  const idx = _lazyLoadPatternIndex();
  const norm = String(text).replace(/\s+/g, ' ').trim().toLowerCase();
  // 1) plain exact matches first (normalized)
  for (const p of idx) {
    if (p.type === 'plain' && p.key === norm) return p.refId;
  }
  // 2) regex patterns
  for (const p of idx) {
    if (p.type === 'regex') { try { if (p.re.test(text)) return p.refId; } catch {} }
  }
  return null;
}

// Main parser: derive a canonical refId from a citation text + optional href
function parseRefId(text, href = '', opts = {}) {
  const wantDiag = !!opts.wantDiag;
  // allow explicit cite→refId normalization via refMap.json
  const diag = mapRefByCiteDiag(text);
  if (diag.refId) return wantDiag ? { refId: diag.refId, diag } : diag.refId;

  // W3C dated REC
  if (/w3\.org\/TR\/\d{4}\/REC-([^\/]+)-(\d{8})\//i.test(href)) {
    const [, shortname, yyyymmdd] = href.match(/REC-([^\/]+)-(\d{8})/i);
    { const refId = `W3C.${shortname}.${yyyymmdd}`; return wantDiag ? { refId, diag: { mapSource: 'href', mapDetail: 'w3c:dated-REC' } } : refId; }
  }
  // W3C undated shortname
  if (/w3\.org\/TR\/([^\/]+)\/?$/i.test(href)) {
    const [, shortname] = href.match(/w3\.org\/TR\/([^\/]+)\/?$/i);
    { const refId = `W3C.${shortname}`; return wantDiag ? { refId, diag: { mapSource: 'href', mapDetail: 'w3c:shortname' } } : refId; }
  }

  // Handle multi-part cite strings split by '|', prefer ISO/IEC slice if present
  const parts = String(text).split('|').map(p => p.trim());
  text = parts.find(p => /ISO\/IEC|ISO/.test(p)) || parts[0];

  // SMPTE (ST/RP/RDD/EG/AG/OV), optional part, optional year[:YYYY or YYYY-MM]
  {
    const smpteRe = /SMPTE\s+(ST|RP|RDD|EG|AG|OV)[\s\u00A0\u2010-\u2015\-]+(\d+[A-Za-z]?)(?:-(\d+))?(?::\s*(\d{4})(?:-(\d{2}))?)?/i;
    const m = text.match(smpteRe);
    if (m) {
      const [, type, numRaw, part, year, month] = m;
      const num = String(numRaw).toUpperCase();
      const lineage = `SMPTE.${type.toUpperCase()}${part ? `${num}-${part}` : num}`;
      if (year) {
        const y = parseInt(year, 10);
        const suffix = (y >= 2023 && month) ? `${year}-${month}` : year;
        { const refId = `${lineage}.${suffix}`; return wantDiag ? { refId, diag: { mapSource: 'regex', mapDetail: 'smpte-designator' } } : refId; }
      }
      { const refId = `${lineage}`; return wantDiag ? { refId, diag: { mapSource: 'regex', mapDetail: 'smpte-designator' } } : refId; }
    }
  }

  // RFC
  if (/RFC\s*(\d+)/i.test(text)) {
    { const refId = `RFC${text.match(/RFC\s*(\d+)/i)[1]}`; return wantDiag ? { refId, diag: { mapSource: 'regex', mapDetail: 'rfc-number' } } : refId; }
  }

  // NIST via DOI href
  if (/10\.6028\/NIST\.(.+)/i.test(href)) {
    const [, id] = href.match(/10\.6028\/NIST\.(.+)/i);
    { const refId = `NIST.${id}`; return wantDiag ? { refId, diag: { mapSource: 'href', mapDetail: 'nist-doi' } } : refId; }
  }
  // NIST FIPS (strip optional PUB)
  if (/NIST\s+FIPS\s+(?:PUB\s+)?(\d+)(-\d+)?/i.test(text)) {
    const [, num, rev] = text.match(/NIST\s+FIPS\s+(?:PUB\s+)?(\d+)(-\d+)?/i);
    { const refId = `NIST.FIPS.${num}${rev || ''}`; return wantDiag ? { refId, diag: { mapSource: 'regex', mapDetail: 'nist-fips' } } : refId; }
  }
  // FIPS structure in hrefs .../fips/186/2/...
  if (/csrc\.nist\.gov\/.+\/fips\/(\d+)(?:\/(\d+))?/i.test(href)) {
    const m = href.match(/fips\/(\d+)(?:\/(\d+))?/i);
    const num = m[1];
    const rev = m[2] ? `-${m[2]}` : '';
    { const refId = `NIST.FIPS.${num}${rev}`; return wantDiag ? { refId, diag: { mapSource: 'href', mapDetail: 'nist-fips-path' } } : refId; }
  }

  // ISO/IEC family — capture the highest year present, if any
  if (/ISO\/IEC\s+([\d\-]+)(:[\dA-Za-z+:\.-]+)?/.test(text)) {
    const [, base, suffix] = text.match(/ISO\/IEC\s+([\d\-]+)(:[\dA-Za-z+:\.-]+)?/);
    const years = suffix ? [...suffix.matchAll(/(\d{4})/g)].map(m => parseInt(m[1])) : [];
    const year = years.length ? Math.max(...years) : null;
    { const refId = `ISO.${base}${year ? `.${year}` : ''}`; return wantDiag ? { refId, diag: { mapSource: 'regex', mapDetail: 'iso|iec designator' } } : refId; }
  }
  if (/ISO\s+([\d\-]+)(:[\dA-Za-z+:\.-]+)?/.test(text)) {
    const [, base, suffix] = text.match(/ISO\s+([\d\-]+)(:[\dA-Za-z+:\.-]+)?/);
    const years = suffix ? [...suffix.matchAll(/(\d{4})/g)].map(m => parseInt(m[1])) : [];
    const year = years.length ? Math.max(...years) : null;
    { const refId = `ISO.${base}${year ? `.${year}` : ''}`; return wantDiag ? { refId, diag: { mapSource: 'regex', mapDetail: 'iso|iec designator' } } : refId; }
  }
  if (/IEC\s+([\d\-]+)(:[\dA-Za-z+:\.-]+)?/.test(text)) {
    const [, base, suffix] = text.match(/IEC\s+([\d\-]+)(:[\dA-Za-z+:\.-]+)?/);
    const years = suffix ? [...suffix.matchAll(/(\d{4})/g)].map(m => parseInt(m[1])) : [];
    const year = years.length ? Math.max(...years) : null;
    { const refId = `IEC.${base}${year ? `.${year}` : ''}`; return wantDiag ? { refId, diag: { mapSource: 'regex', mapDetail: 'iso|iec designator' } } : refId; }
  }

  return wantDiag ? { refId: null, diag: { mapSource: null, mapDetail: null } } : null;
}

// Extract references from a cheerio-loaded doc
// Returns: { references: {normative?, bibliographic?}, badRefs: [...] }
function extractRefs($, currentDocId) {
  const out = { references: {}, badRefs: [] };
  const sections = [
    { id: 'normative-references', key: 'normative' },
    { id: 'bibliography', key: 'bibliographic' }
    // W3C occasionally uses 'informative-references'; add here if needed
  ];

  for (const s of sections) {
    const list = [];
    $(`#sec-${s.id} ul li`).each((_, el) => {
      const cite = $(el).find('cite');
      const refText = cite.text();
      const href = $(el).find('a.ext-ref').attr('href') || '';
      // Collect rawRef (entire LI text) and title (text between <cite> and <a>)
      const rawRef = $(el).text().replace(/\s+/g, ' ').trim();
      const $clone = $(el).clone();
      const citeOnly = $clone.find('cite').text() || '';
      $clone.find('a').remove();
      $clone.find('cite').remove();
      let midText = $clone.text().replace(/\s+/g, ' ').trim();
      // Drop leading comma/space and any trailing "url: ..." segment
      midText = midText.replace(/^,?\s*/, '').replace(/\burl:\s*.*$/i, '').trim();
      const titleText = midText || null;
      const parsed = parseRefId(refText, href, { wantDiag: true });
      const refId = parsed && parsed.refId ? parsed.refId : null;
      if (refId) {
        if (Array.isArray(refId)) {
          for (const r of refId) {
            list.push(r);
            mriRecordSighting({
              docId: currentDocId,
              type: s.key,
              refId: r,
              cite: refText,
              href,
              mapSource: parsed.diag?.mapSource,
              mapDetail: parsed.diag?.mapDetail,
              rawRef,
              title: titleText
            });
          }
        } else {
          list.push(refId);
          mriRecordSighting({
            docId: currentDocId,
            type: s.key,
            refId,
            cite: refText,
            href,
            mapSource: parsed.diag?.mapSource,
            mapDetail: parsed.diag?.mapDetail,
            rawRef,
            title: titleText
          });
        }
      } else {
        out.badRefs.push({ docId: currentDocId, type: s.key, refText, href });
        mriRecordSighting({
          docId: currentDocId,
          type: s.key,
          refId: null,
          cite: refText,
          href,
          mapSource: null,
          mapDetail: null,
          rawRef,
          title: titleText
        });
      }
    });
    if (list.length > 0) out.references[s.key] = list;
  }
  return out;
}

module.exports = {
  mapRefByCite,
  parseRefId,
  extractRefs,
  reloadRefMap,
  reloadDocumentsIndex,
  // MRI helpers
  mriRecordSighting,
  mriFlush,
  mriEnsureFile,
  mriPruneToSightings
};