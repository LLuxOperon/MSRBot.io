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

'use strict';
/**
 * Shared keying/normalization helpers extracted from buildMasterSuiteIndex.js
 * NOTE: Pure functions only — no fs, no logging, no mutation of caller data.
 * Some helpers accept a doc-like object; they must treat it as read-only.
 */

// ---------------- W3C helpers & alias maps ----------------

// Shortnames that are known to be versioned families (even if the shortname itself doesn't match the digit pattern)
const W3C_VERSIONED_FAMILY_WHITELIST = new Set([
  'xmlschema', 'xkms', 'xlink', 'ttml', 'xmldsig-core', 'xmlc14n'
]);

const W3C_ALIAS_MAP = {
  'ttaf1-dfxp': 'ttml1'
};

const NIST_ALIAS_MAP = {
  KMGD: { suite: 'SP', number: '800-57', part: '1' }
};

const GLOBAL_ALIAS_MAP = {
  // e.g., 'SMPTE.AG10b.2020': 'SMPTE.AG10B.2020',
  // 'W3C.ttaf1-dfxp.20061114': 'W3C.ttml1.20061114'
};

function shallowClone(o){ return o && typeof o === 'object' ? JSON.parse(JSON.stringify(o)) : o; }

// Apply alias rewrites and light canonicalizations to a document in-place.
// If an alias is applied, sets `doc._aliasedFrom = <originalId>` and updates `doc.docId`.
function applyGlobalAliases(docLike) {
  // Pure form: returns { docId, _aliasedFrom? } without mutating input
  const out = { ...(docLike||{}) };
  if (!out.docId || typeof out.docId !== 'string') return out;
  let id = out.docId;
  let from = null;

   // 1) Exact-id alias map
  if (GLOBAL_ALIAS_MAP[id]) { from = id; id = GLOBAL_ALIAS_MAP[id]; }

  // 2) Lightweight canonicalizations that we want to handle centrally
  //    SMPTE.AG<digits><letter> → uppercase the letter (AG10b → AG10B) to keep a single lineage
  //    Allow either a dot (date tail) or end-of-id after the letter.
  const mAg = id.match(/^SMPTE\.AG(\d+)([a-z])(?=\.|$)/);
  if (mAg) {
    from = from || id;
    id = id.replace(/^SMPTE\.AG(\d+)([a-z])(?=\.|$)/, (m, d, l) => `SMPTE.AG${d}${l.toUpperCase()}`);
  }

  if (from && id !== out.docId) {
    out._aliasedFrom = from;
    out.docId = id;
  }
  return out;
}

// Patch downstream logic that pushes W3C_MISSING_VERSION
// (This is a demonstration; actual flagging is likely in the lineage building code,
// but for this patch, let's describe the function to be used for the check.)

function shouldFlagW3CMissingVersion(shortname) {
  if (!shortname) return false;
  const sn = String(shortname).toLowerCase();
  // If shortname matches the version pattern or is in the whitelist, flag if version is missing
  if (/[a-z]\d|\d[a-z]|[._-]\d/.test(sn)) return true;
  if (W3C_VERSIONED_FAMILY_WHITELIST.has(sn)) return true;
  return false;
}

function w3cExtractFromHref(href) {
  if (typeof href !== 'string') return null;
  // Matches https://www.w3.org/TR/<short>-YYYYMMDD/  (also http)  
  const m = href.match(/^https?:\/\/www\.w3\.org\/TR\/([^/]+)-(\d{8})\/?$/i);
  if (!m) return null;
  return { shortname: m[1], trDate: m[2] };
}

function w3cExtractFromDocId(docId) {
  if (typeof docId !== 'string') return null;
  const m = docId.match(/^W3C\.([A-Za-z0-9._-]+)\.(\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (!m) return null;
  return { shortname: m[1], trDate: /\d{8}/.test(m[2]) ? m[2] : null };
}

function w3cSplitFamilyVersion(shortname) {
  if (!shortname) return { family: null, version: null };
  const sn = String(shortname).toLowerCase();
  const alias = W3C_ALIAS_MAP[sn];
  const canonical = alias || sn;

  // Special-case: xmlc14n followed immediately by dotted version (e.g., xmlc14n1.1)
  let m = canonical.match(/^(.*?c14n)(\d(?:\.\d+)*)$/);
  if (m && m[1] && m[2]) return { family: m[1], version: m[2] };

  m = canonical.match(/^(.*?)(?:[._-](\d+(?:\.\d+)*))$/);
  if (m && m[1] && m[2]) return { family: m[1], version: m[2] };

  m = canonical.match(/^(.*?)(\d)$/);
  if (m && m[1] && m[2]) return { family: m[1].replace(/[._-]$/, ''), version: m[2] };

  m = canonical.match(/^(.*?c14n)(\d{2})$/);
  if (m) return { family: m[1], version: `${m[2][0]}.${m[2][1]}` };

  return { family: canonical, version: null };
}

function inferVersionFromTitleOrLabel(doc) {
  const title = typeof doc?.docTitle === 'string' ? doc.docTitle : '';
  const label = typeof doc?.docLabel === 'string' ? doc.docLabel : '';
  let m = title.match(/\b(?:Version|Level)\s*(\d+(?:\.\d+)*)\b/i) ||
          label.match(/\b(?:Version|Level)\s*(\d+(?:\.\d+)*)\b/i);
  if (m) return m[1];
  m = title.match(/\b(\d+\.\d+(?:\.\d+)*)\b/) || label.match(/\b(\d+\.\d+(?:\.\d+)*)\b/);
  if (m) return m[1];
  const intM = title.match(/\b(\d{1,2})\b/) || label.match(/\b(\d{1,2})\b/);
  const hasCue = /\b(?:Version|Level|Spec(?:ification)?|Rec(?:ommendation)?)\b/i.test(title) || /\b(?:Version|Level|Spec(?:ification)?|Rec(?:ommendation)?)\b/i.test(label);
  if (intM && hasCue) return intM[1];
  return null;
}

function inferEditionFromTitle(doc) {
  const t = String(doc?.docTitle || '');
  const mOrd = t.match(/\b(First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth)\s+Edition\b/i);
  if (mOrd) { const map = { first:1, second:2, third:3, fourth:4, fifth:5, sixth:6, seventh:7, eighth:8, ninth:9, tenth:10 }; return map[mOrd[1].toLowerCase()] || null; }
  const mNum = t.match(/\b(\d+)(?:st|nd|rd|th)\s+Edition\b/i);
  return mNum ? parseInt(mNum[1],10) : null;
}

function normalizeW3C(docLike) {
  const d = shallowClone(docLike);
  if (!d || typeof d.docId !== 'string') return d;
  if (!(d.publisher === 'W3C' || /^W3C\./i.test(d.docId))) return d;
  const fromHref = w3cExtractFromHref(d.href);
  const fromId   = w3cExtractFromDocId(d.docId);
  const shortname = (fromHref?.shortname) || (fromId?.shortname) || null;
  const trDate    = (fromHref?.trDate)    || (fromId?.trDate)    || null;
  let { family, version } = w3cSplitFamilyVersion(shortname);
  if (shortname && /^(?:rec-)?html(?:5|52)$/i.test(shortname)) { family = 'HTML'; version = null; }
  if (!version) {
    const sn = shortname || '';
    const shortSuggestsVersion = /[a-z]\d|\d[a-z]|[._-]\d/i.test(sn);
    const isVersionedFamily = W3C_VERSIONED_FAMILY_WHITELIST.has(sn.toLowerCase());
    const textHasCue = /\b(?:Version|Level)\b/i.test(d.docTitle||'') || /\b(?:Version|Level)\b/i.test(d.docLabel||'');
    if (shortSuggestsVersion || isVersionedFamily || textHasCue) {
      const inf = inferVersionFromTitleOrLabel(d); if (inf) version = inf;
    }
  }
  const edition = inferEditionFromTitle(d);
  d._w3c = { shortname, trDate, family, version, edition };
  return d;
}

// ---------------- Dates & tails ----------------
function dateKeyFromDoc(d) {
  const keys = [];
  if (typeof d?.releaseTag === 'string') { const m = d.releaseTag.match(/^(\d{8})/); if (m) keys.push(m[1]); }
  if (typeof d?.publicationDate === 'string') { const m = d.publicationDate.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (m) keys.push(`${m[1]}${m[2]}${m[3]}`); }
  if (typeof d?.docId === 'string') {
    const id = d.docId;
    let m = id.match(/\.([12]\d{7})$/); if (m) keys.push(m[1]);
    if (!m) { const x = id.match(/\.([12]\d{3})-(\d{2})-(\d{2})$/); if (x) keys.push(`${x[1]}${x[2]}${x[3]}`); }
    if (!m) { const x = id.match(/\.([12]\d{3})-(\d{4})$/); if (x) keys.push(`${x[1]}${x[2]}`); }
    if (!m) { const x = id.match(/\.([12]\d{3})-(\d{2})$/); if (x) keys.push(`${x[1]}${x[2]}00`); }
    if (!m) { const x = id.match(/\.([12]\d{3})$/); if (x) keys.push(`${x[1]}0000`); }
  }
  if (!keys.length) return '00000000';
  keys.sort();
  return keys[keys.length-1];
}

function isDatedDoc(d){ return dateKeyFromDoc(d) !== '00000000'; }

function yearFromDocIdTail(docId){
  const m8 = docId?.match(/\.([12]\d{3})(?:\d{2}){2}$/); if (m8) return parseInt(m8[1],10);
  const mYM = docId?.match(/\.([12]\d{3})-\d{2}$/); if (mYM) return parseInt(mYM[1],10);
  const mY = docId?.match(/\.([12]\d{3})$/); if (mY) return parseInt(mY[1],10);
  return null;
}

// ---------------- Amendments / supplements ----------------
function isAmendmentDocId(docId) {
  const smpteAm = /\.20\d{2}(?:-\d{2})?Am\d\.\d{4}(?:-\d{2})?$/i;
  const isoIecAmCor = /\.(?:19|20)\d{2}(?:-\d{2})?(?:amd|cor)\d+\.(?:19|20)\d{2}(?:-\d{2})?$/i;
  const nistSpInline = /^NIST\.SP\.\d+-[A-Za-z0-9]+(?:ad|add|amd)\d+(?:\.(?:\d{4}(?:-\d{2})?|\d{8}))?$/i;
  const nistSpHyphen  = /^NIST\.SP\.\d+-[A-Za-z0-9]+-(?:ad|add|amd)(?:\d+)?(?:\.(?:\d{4}(?:-\d{2})?|\d{8}))?$/i;
  const aesAd = /\.(?:19|20)\d{2}(?:-\d{2})?ad\d+\.(?:19|20)\d{2}(?:-\d{2})?$/i;
  const ituTAmErr = /^T-REC-[A-Za-z]\.[0-9A-Za-z.]+\.(?:\d{6}|\d{4})(?:am\d+|e\d+)\.(?:\d{6}|\d{4})$/i;
  const ituRAmErr = /^R-REC-[A-Za-z]\.[0-9A-Za-z.]+-(?:a\d+|e\d+)\.(?:\d{6}|\d{4})$/i;
  const iccErrata = /\.(?:19|20)\d{2}e\.?\d{4}$/i;
  return smpteAm.test(docId) || isoIecAmCor.test(docId) || nistSpInline.test(docId) || nistSpHyphen.test(docId) || aesAd.test(docId) || ituTAmErr.test(docId) || ituRAmErr.test(docId) || iccErrata.test(docId);
}

function isSupplementDocId(docId) {
  const atscAnnex = /^ATSC\.[^.]+\.[^.]+\.(?:a|annex[a-z])\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i;
  const ebuSupp = /^EBU\.(?:R|Tech)\d+s\d+\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i;
  return atscAnnex.test(docId) || ebuSupp.test(docId);
}

// ---------------- Keying (subset; mirrors MSI behavior) ----------------
function keyFromDocId(docId, doc = {}) {
  // keep exact MSI patterns — copied verbatim
  let m;
  m = docId.match(/^SMPTE\.RP(\d+)v\d+\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) return { publisher: 'SMPTE', suite: 'RP', number: m[1], part: null };

  m = docId.match(/^OWASP\.([A-Za-z0-9]+)\.([A-Za-z0-9-]+)$/i);
  if (m) return { publisher: 'OWASP', suite: m[1].toUpperCase(), number: m[2], part: null };

  m = docId.match(/^SMPTE\.(AG|OM)(\d+[A-Za-z]?)(?:-([0-9]+))?(?:\.(?:\d{4}(?:-\d{2}){0,2}|\d{8}))?$/i);
  if (m) return { publisher: 'SMPTE', suite: m[1].toUpperCase(), number: m[2], part: m[3] || null };

  m = docId.match(/^SMPTE\.OM\.([A-Za-z][A-Za-z0-9-]*)(?:\.(?:\d{8}|\d{4}(?:-\d{2})?))?$/i);
  if (m) return { publisher: 'SMPTE', suite: 'OM', number: m[1], part: null };

  m = docId.match(/^SMPTE\.(OM|AG|ST|RP|EG|ER|RDD|OV|TSP)(\d+[A-Za-z]*)(?:-(\d+))?\./i);
  if (m) { const docType=m[1].toUpperCase(); const num=m[2]; let part=m[3]||null; if (docType==='OV') part=part||'0'; return { publisher:'SMPTE', suite:docType, number:num, part }; }

  m = docId.match(/^OMG\.([A-Za-z0-9]+)(?:\.[A-Za-z0-9.-]+)?$/i);
  if (m) return { publisher: 'OMG', suite: m[1].toUpperCase(), number: null, part: null };

  m = docId.match(/^ISO\.Dir-P(\d+)\.(\d{4}(?:-\d{2})?)$/i);
  if (m) return { publisher: 'ISO/IEC', suite: 'Dir', number: `P${m[1]}`, part: null };

  m = docId.match(/^(ISO(?:\.IEC)?|IEC)\.(\d+)(?:-([0-9-]+))?\./i);
  if (m) return { publisher: m[1].toUpperCase(), suite: null, number: m[2], part: m[3] || null };

  m = docId.match(/^IESNA\.RP(\d+)\.(\d{4})$/i);
  if (m) return { publisher: 'IESNA', suite: 'RP', number: m[1], part: null };

  m = docId.match(/^IMFUG\.BP\.([A-Za-z0-9-]+)\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) return { publisher: 'IMFUG', suite: 'BP', number: m[1], part: null };

  m = docId.match(/^ISDCF\.([A-Za-z0-9-]+)(?:\.(\d{4}(?:-\d{2}){0,2}|\d{8}))?$/i);
  if (m) return { publisher: 'ISDCF', suite: null, number: m[1], part: null };

  m = docId.match(/^TI\.DLP-([A-Za-z0-9-]+)(?:\.[A-Za-z0-9.-]+)?(?:\.(?:\d{8}|\d{4}(?:-\d{2})?))?$/i);
  if (m) return { publisher: 'TI', suite: 'DLP', number: m[1], part: null };

  m = docId.match(/^UNICODE\.STD\.TR(\d+)(?:[-.][A-Za-z0-9.-]+)?$/i);
  if (m) return { publisher: 'UNICODE CONSORTIUM', suite: 'STD', number: 'TR', part: m[1] };
  m = docId.match(/^UNICODE\.STD\.(\d+(?:\.\d+){1,2})$/i);
  if (m) return { publisher: 'UNICODE CONSORTIUM', suite: 'STD', number: null, part: null };

  m = docId.match(/^W3C\.([A-Za-z0-9._-]+)\.(\d{8}|\d{4}(?:-\d{2})?|LATEST)$/i);
  if (m) {
    const d = normalizeW3C({ docId });
    if (d?._w3c?.family) { const fam=d._w3c.family; const num=(fam.toUpperCase()==='HTML')?null:(d._w3c.version||null); return { publisher:'W3C', suite:fam, number:num, part:null }; }
    let token = m[1].replace(/^REC-/i,'');
    if (/^html(?:5|52)$/i.test(token)) return { publisher:'W3C', suite:'HTML', number:null, part:null };
    const vm = token.match(/^(.*?)(?:[._-]?(\d+(?:\.\d+)*))$/);
    if (vm && vm[2]) return { publisher:'W3C', suite:vm[1], number:vm[2], part:null };
    return { publisher:'W3C', suite:token, number:null, part:null };
  }

  m = docId.match(/^WHATWG\.([A-Za-z0-9-]+)$/i);
  if (m) return { publisher: 'WHATWG', suite: m[1].toUpperCase(), number: null, part: null };

  m = docId.match(/^rfc(\d+)$/i);
  if (m) return { publisher: 'IETF', suite: 'RFC', number: m[1], part: null };

  m = docId.match(/^IETF\.([A-Za-z0-9-]+)(?:\.[A-Za-z0-9._-]+)?\.(\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) return { publisher: 'IETF', suite: m[1].toUpperCase(), number: null, part: null };

  m = docId.match(/^NAB\.STD\.([A-Za-z0-9-]+)(?:\.(?:\d{8}|\d{4}(?:-\d{2})?))?$/i);
  if (m) return { publisher: 'NAB', suite: 'STD', number: m[1], part: null };

  m = docId.match(/^NIST\.FIPS\.(\d+(?:-\d+)?)$/i);
  if (m) { const token=m[1]; const fam=token.replace(/^(\d+).*/, '$1'); return { publisher:'NIST', suite:'FIPS', number:fam, part:null }; }

  m = docId.match(/^NIST\.([A-Za-z0-9-]+)(?:\.(?:\d{8}|\d{4}(?:-\d{2}){1,2}|\d{4}-\d{4}))?$/i);
  if (m) { const token=m[1].toUpperCase(); if (NIST_ALIAS_MAP[token]) { const a=NIST_ALIAS_MAP[token]; return { publisher:'NIST', suite:a.suite, number:a.number, part:a.part||null }; } }

  m = docId.match(/^NIST\.SP\.([A-Za-z0-9-]+)(?:\.(\d{4}(?:-\d{2})?|\d{8}))?$/i);
  if (m) { const tail=m[1]; const famMatch=tail.match(/^(\d+-[0-9A-Za-z]+?)(?=(?:pt|p|part)\s*\d+|(?:-?(?:ad|add|amd))(?:\s*\d+)?|r\s*\d+|$)/i); if (famMatch){ const family=famMatch[1]; const rest=tail.slice(family.length); let part=null; const pm=rest.match(/(?:^|[^A-Za-z])(pt|p|part)\s*([0-9]+)/i); if (pm) part=String(parseInt(pm[2],10)); return { publisher:'NIST', suite:'SP', number:family, part }; } return { publisher:'NIST', suite:'SP', number:tail, part:null }; }

  m = docId.match(/^DCI\.([A-Za-z]+)\.(v\d+(?:\.\d+)*)\.(?:\d{8}|\d{4}(?:-\d{2}){1,2}|\d{4}-\d{4})$/i);
  if (m && /^DCSS$/i.test(m[1])) return { publisher: 'DCI', suite: m[1].toUpperCase(), number: null, part: null };

  m = docId.match(/^DCI\.DCA-([A-Za-z0-9]+)\.(?:\d{8}|\d{4}(?:-\d{2}){1,2}|\d{4}-\d{4})$/i);
  if (m) return { publisher: 'DCI', suite: 'DCA', number: m[1].toUpperCase(), part: null };

  m = docId.match(/^DCI\.M-([A-Za-z0-9]+)\.(?:\d{8}|\d{4}(?:-\d{2}){1,2}|\d{4}-\d{4})$/i);
  if (m) return { publisher: 'DCI', suite: 'M', number: null, part: m[1].toUpperCase() };

  m = docId.match(/^DCI\.([A-Za-z]+)-([A-Za-z0-9]+)\.(?:\d{8}|\d{4}(?:-\d{2}){1,2}|\d{4}-\d{4})$/i);
  if (m) return { publisher: 'DCI', suite: m[1].toUpperCase(), number: m[2].toUpperCase(), part: null };

  m = docId.match(/^EIDR\.([A-Za-z0-9-]+)\.(\d{6}|\d{4}(?:-\d{2})?)$/i);
  if (m) return { publisher: 'EIDR', suite: null, number: m[1].toUpperCase(), part: null };

  m = docId.match(/^ICC\.(\d+)\.(?:\d{4})(?:e\.?\d{4})?$/i);
  if (m) return { publisher: 'ICC', suite: null, number: m[1], part: null };

  m = docId.match(/^AMWA\.(AAF)(?:\.(?:\d{8}|\d{4}(?:-\d{2}){1,2}|\d{4}-\d{4}))?$/i);
  if (m) return { publisher: 'AMWA', suite: m[1].toUpperCase(), number: null, part: null };
  m = docId.match(/^AMWA\.(AS)-(\d+)(?:\.(?:\d{8}|\d{4}(?:-\d{2}){1,2}|\d{4}-\d{4}))?$/i);
  if (m) return { publisher: 'AMWA', suite: m[1].toUpperCase(), number: m[2], part: null };

  m = docId.match(/^ANSI\.S(\d+)(?:\.(\d+))?(?:\.(p?\d+))?\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) { const suite=`S${m[1]}`; const number=m[2]||null; const rawPart=m[3]||null; const part=rawPart?String(rawPart).replace(/^p/i,''):null; return { publisher:'ASA', suite, number, part }; }

  m = docId.match(/^ASA\.S(\d+)(?:\.(\d+))?(?:\.(p?\d+))?\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) { const suite=`S${m[1]}`; const number=m[2]||null; const rawPart=m[3]||null; const part=rawPart?String(rawPart).replace(/^p/i,''):null; return { publisher:'ASA', suite, number, part }; }

  m = docId.match(/^PIMA\.IT(\d+)(?:\.(\d+))?\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) return { publisher: 'PIMA', suite: 'IT', number: m[1], part: m[2] || null };

  m = docId.match(/^UL\.([A-Za-z0-9.-]+)\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) return { publisher: 'UL', suite: null, number: m[1], part: null };

  m = docId.match(/^INCITS\.([A-Za-z0-9]+)\.([A-Za-z0-9.-]+)\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) return { publisher: 'INCITS', suite: m[1], number: m[2], part: null };

  m = docId.match(/^NFPA\.([0-9A-Za-z.-]+)\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) return { publisher: 'NFPA', suite: null, number: m[1], part: null };

  m = docId.match(/^AIIM\.([A-Za-z]+)(\d+)\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) return { publisher: 'AIIM', suite: m[1].toUpperCase(), number: m[2], part: null };

  m = docId.match(/^ASHRAE\.([0-9A-Za-z.-]+)\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) return { publisher: 'ASHRAE', suite: null, number: m[1], part: null };

  m = docId.match(/^NAPM\.IT(\d+)(?:\.(\d+))?\.(?:\d{8}|\d{4}(?:-\d{2})?)(?:T\d+\.\d+\.\d{4})?$/i);
  if (m) return { publisher: 'NAPM', suite: 'IT', number: m[1], part: m[2] || null };

  m = docId.match(/^NAPM\.(\d+)\.(\d+)\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) return { publisher: 'NAPM', suite: null, number: m[1], part: m[2] };

  m = docId.match(/^AIM\.([A-Za-z]+)-?(\d+)\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) return { publisher: 'AIM', suite: m[1].toUpperCase(), number: m[2], part: null };

  m = docId.match(/^ARIB\.([A-Za-z]+)-([A-Za-z]\d+(?:\.[A-Za-z0-9]+)?)\.v\d+(?:\.\d+)*\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) return { publisher: 'ARIB', suite: m[1].toUpperCase(), number: m[2].toUpperCase(), part: null };

  m = docId.match(/^T-REC-([A-Za-z])\.([0-9A-Za-z.]+?)\.(\d{6}|\d{4})(?:(am\d+|e\d+)\.(\d{6}|\d{4}))?$/i);
  if (m) return { publisher: 'ITU-T', suite: m[1].toUpperCase(), number: m[2], part: null };

  m = docId.match(/^R-REC-([A-Za-z]{1,3})\.([0-9A-Za-z.]+?)(?:-(a\d+|e\d+|[0-9]+))?\.(\d{6}|\d{4})$/i);
  if (m) {
    const suite = m[1].toUpperCase();
    const core = m[2];
    let number = core; let part = null;
    const rev = core.match(/^(\d+)-(\d+)$/);
    if (rev) {
      const left = rev[1], right = parseInt(rev[2],10);
      if (suite==='BR' && left.length===4 && right>=1 && right<=9) { number = left; part = String(right); }
      else if (right>=1 && right<=30) { number = left; }
      else { number = core; }
    }
    return { publisher: 'ITU-R', suite, number, part };
  }

  m = docId.match(/^ATSC\.([A-Za-z0-9-]+)\.([A-Za-z0-9-]+)\.(?:(?:a|annex[a-z])\.)?(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) return { publisher: 'ATSC', suite: m[1].toUpperCase(), number: m[2].toUpperCase(), part: null };

  m = docId.match(/^TIFF\.r\d+(?:\.(?:\d{8}|\d{4}(?:-\d{2})?))?$/i);
  if (m) return { publisher: 'Aldus Corp/Adobe', suite: 'TIFF', number: null, part: null };

  m = docId.match(/^IEEE\.(?:STD)?([0-9]+(?:\.[0-9]+)?)\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) return { publisher: 'IEEE', suite: 'STD', number: m[1], part: null };

  m = docId.match(/^AES\.(\d+)(?:-([0-9]+))?\.(?:\d{8}|\d{4}(?:-\d{2})?)(?:ad\d+\.(?:\d{8}|\d{4}(?:-\d{2})?))?$/i);
  if (m) return { publisher: 'AES', suite: null, number: m[1], part: m[2] || null };
  m = docId.match(/^aes(\d+)(?:-([0-9]+))?\.(?:\d{8}|\d{4}(?:-\d{2})?)(?:ad\d+\.(?:\d{8}|\d{4}(?:-\d{2})?))?$/i);
  if (m) return { publisher: 'AES', suite: null, number: m[1], part: m[2] || null };
  m = docId.match(/^AES[-\.]R(\d+)\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) return { publisher: 'AES', suite: 'R', number: m[1], part: null };

  m = docId.match(/^AMPAS\.S\.(\d{4})-(\d{3})$/i);
  if (m) return { publisher: 'AMPAS', suite: 'S', number: m[1], part: m[2] };

  m = docId.match(/^CEA\.(\d+)\.(\d{4}(?:-\d{2})?)$/i);
  if (m) return { publisher: 'CEA', suite: null, number: m[1], part: null };

  m = docId.match(/^CEN\.(EN|TR)\.([A-Za-z0-9-]+)\.(\d{4}(?:-\d{2})?)$/i);
  if (m) return { publisher: 'CEN', suite: m[1].toUpperCase(), number: m[2], part: null };

  m = docId.match(/^EBU\.(R|Tech)(\d+)(?:s\d*)?\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) return { publisher: 'EBU', suite: m[1].toUpperCase(), number: m[2], part: null };

  m = docId.match(/^ETSI\.([A-Za-z]+)-([0-9-]+)\.(\d{4}(?:-\d{2})?)$/i);
  if (m) return { publisher: 'ETSI', suite: m[1].toUpperCase(), number: m[2], part: null };

  m = docId.match(/^CIE\.(\d{3})\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) return { publisher: 'CIE', suite: null, number: m[1], part: null };

  m = docId.match(/^CTA\.(\d+)-[A-Za-z]\.(\d{4})$/i);
  if (m) return { publisher: 'CTA', suite: null, number: m[1], part: null };

  m = docId.match(/^FIAF\.([A-Za-z]+)\.([A-Za-z0-9.-]+)\.(?:\d{8}|\d{4}(?:-\d{2})?)$/i);
  if (m) return { publisher: 'FIAF', suite: m[1].toUpperCase(), number: m[2], part: null };

  m = docId.match(/^DMA\.(TR)\.([0-9.]+)$/i);
  if (m) return { publisher: 'U.S. DEFENSE MAPPING AGENCY', suite: m[1].toUpperCase(), number: m[2], part: null };

  m = docId.match(/^DPP\.(\d{3})$/i);
  if (m) return { publisher: 'DPP', suite: null, number: m[1], part: null };

  return null;
}

/**
 * lineageKeyFromParts
 * Deterministically formats a lineage key from discrete parts.
 * Format: `${publisher}|${suite||''}|${number||''}|${part||''}`
 * Notes:
 *  - `publisher` is required (UPPERCASE recommended upstream)
 *  - suite/number/part may be null/undefined and are rendered as empty segments
 *  - This mirrors MSI's lineage key joiner so MSI and build.js agree 1:1.
 */
function lineageKeyFromParts(parts) {
  if (!parts || typeof parts !== 'object') return null;
  const publisher = parts.publisher || null;
  const suite     = parts.suite ?? '';
  const number    = parts.number ?? '';
  const part      = parts.part ?? '';
  if (!publisher) return null;
  return [publisher, suite || '', number || '', part || ''].join('|');
}

/**
 * lineageKeyFromDocId
 * Keys a docId using the same regex family as MSI and returns the canonical lineage key string.
 * Returns null when the ID cannot be keyed.
 * Pure: does not mutate `doc` (doc is only used for certain publisher-specific normalizations).
 */
function lineageKeyFromDocId(docId, doc = {}) {
  const k = keyFromDocId(docId, doc);
  if (!k) return null;
  return lineageKeyFromParts(k);
}

/**
 * lineageKeyFromDoc
 * Convenience wrapper for objects that carry `docId`.
 * Applies lightweight alias normalization in read-only form to maximize parity with MSI.
 */
function lineageKeyFromDoc(docLike) {
  if (!docLike || typeof docLike.docId !== 'string') return null;
  const aliased = applyGlobalAliases({ docId: docLike.docId });
  const normed  = normalizeW3C({ docId: aliased.docId, docTitle: docLike.docTitle, docLabel: docLike.docLabel, href: docLike.href });
  // normalizeW3C returns void in-place in MSI; here we called it on a throwaway object to stay pure.
  const id = (aliased.docId);
  return lineageKeyFromDocId(id, docLike);
}

function publisherFromDoc(d){
  if (d?.publisher && typeof d.publisher === 'string' && d.publisher.trim()) {
    const raw = d.publisher.trim().toUpperCase();
    return raw.startsWith('ANSI/') ? raw.slice(5) : raw;
  }
  if (typeof d?.docId === 'string') {
    const k = keyFromDocId(d.docId, d);
    if (k?.publisher) return String(k.publisher).toUpperCase();
    if (/^RFC\d+$/i.test(d.docId)) return 'IETF';
    const m = d.docId.match(/^([A-Za-z]{2,})\./); if (m) return m[1].toUpperCase();
  }
  return 'UNKNOWN';
}

module.exports = {
  // maps/constants
  W3C_VERSIONED_FAMILY_WHITELIST,
  W3C_ALIAS_MAP,
  NIST_ALIAS_MAP,
  GLOBAL_ALIAS_MAP,
  // w3c helpers
  shouldFlagW3CMissingVersion,
  w3cExtractFromHref,
  w3cExtractFromDocId,
  w3cSplitFamilyVersion,
  inferVersionFromTitleOrLabel,
  inferEditionFromTitle,
  normalizeW3C,
  // dates
  dateKeyFromDoc,
  isDatedDoc,
  yearFromDocIdTail,
  // amendment/supplement
  isAmendmentDocId,
  isSupplementDocId,
  // keying
  keyFromDocId,
  // lineage keys
  lineageKeyFromParts,
  lineageKeyFromDocId,
  lineageKeyFromDoc,
  // publisher
  publisherFromDoc,
  // alias
  applyGlobalAliases
};