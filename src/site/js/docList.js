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

(async function(){
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  function err(msg){
    const box = document.createElement('div');
    box.className = 'alert alert-warning m-3';
    box.innerHTML = `<strong>Cards view couldn't load</strong><br>${msg}`;
    document.body.prepend(box);
  }

  // --- Ensure Handlebars runtime is present (async loader)
  async function ensureHandlebars(){
    if (window.Handlebars) return true;
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/handlebars@4.7.8/dist/handlebars.min.js';
      s.async = true;
      s.onload = () => resolve(!!window.Handlebars);
      s.onerror = () => {
        console.error('[docList] Failed to load Handlebars runtime.');
        resolve(false);
      };
      document.head.appendChild(s);
    });
  }

  async function ensureMiniSearch(){
    if (window.MiniSearch) return true;

    // Prefer UMD we ship in build (no ESM/CJS mismatch).
    const tryUmd = (src) => new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve(!!window.MiniSearch);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });

    // 1) Local UMD (built by build.search-index.js)
    const localUmd = '/docs/minisearch/umd/index.min.js';
    if (await tryUmd(localUmd)) return true;

    // 2) CDN UMD fallbacks
    const cdnUmd = [
      'https://cdn.jsdelivr.net/npm/minisearch/dist/umd/index.min.js',
      'https://unpkg.com/minisearch/dist/umd/index.min.js'
    ];
    for (const src of cdnUmd) {
      if (await tryUmd(src)) return true;
    }

    // 3) As a last resort, attempt common ESM entry points (in case a future release ships them)
    const esmCandidates = [
      '/docs/minisearch/index.js',
      '/docs/minisearch/index.mjs',
      '/docs/minisearch/esm/index.js',
      '/docs/minisearch/esm/index.mjs',
      '/docs/minisearch/dist/index.js',
      '/docs/minisearch/dist/index.mjs'
    ];
    for (const spec of esmCandidates) {
      try {
        const mod = await import(spec);
        const MS = mod && (mod.default || mod.MiniSearch || mod);
        if (MS) { window.MiniSearch = MS; return true; }
      } catch {}
    }

    console.warn('[docList] MiniSearch not available (UMD/ESM). Falling back to plain includes() search.');
    return false;
  }

  async function loadJSON(url){
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (e) {
      throw new Error(`Failed to fetch ${url}. ${e.message}. If you opened this file directly (file://), start a local server and open via http:// (e.g., npx http-server build).`);
    }
  }

  // Try a list of candidate URLs in order until one loads
  async function loadJSONTry(candidates){
    const errs = [];
    for (const url of candidates) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res.ok) return await res.json();
        errs.push(`${url} → ${res.status}`);
      } catch (e) {
        errs.push(`${url} → ${e.message || e}`);
      }
    }
    throw new Error(`Failed to fetch any candidate: ${errs.join(' | ')}`);
  }

  let idx, facets, synonymsMap = {};
  try {
    [idx, facets] = await Promise.all([
      loadJSONTry(['/docs/_data/search-index.json', 'docs/_data/search-index.json', '../docs/_data/search-index.json']),
      loadJSONTry(['/docs/_data/facets.json', '/docs/_data/facets.json', 'docs/_data/facets.json', '../docs/_data/facets.json'])
    ]);
    // load synonyms if available
    try {
      synonymsMap = await loadJSONTry(['/docs/_data/synonyms.json', 'docs/_data/synonyms.json', '../docs/_data/synonyms.json']);
      if (!synonymsMap || typeof synonymsMap !== 'object') synonymsMap = {};
    } catch {
      synonymsMap = {};
    }
  } catch (e) {
    err(e.message);
    return;
  }

  // Build bi-directional, lower-cased synonym map so phrases map back to acronyms and vice versa.
  function buildBiSynonyms(map) {
    const bi = {};
    const add = (k, v) => {
      const kk = String(k || '').toLowerCase().trim();
      const vv = String(v || '').toLowerCase().trim();
      if (!kk || !vv) return;
      bi[kk] = Array.isArray(bi[kk]) ? bi[kk] : [];
      if (!bi[kk].includes(vv)) bi[kk].push(vv);
    };
    const entries = Object.entries(map || {});
    for (const [k, vals] of entries) {
      const key = String(k || '').toLowerCase().trim();
      const arr = Array.isArray(vals) ? vals : (vals ? [vals] : []);
      for (const v of arr) {
        const val = String(v || '').toLowerCase().trim();
        if (!key || !val) continue;
        add(key, val);      // key -> val
        add(val, key);      // val -> key (reverse)
        // Also connect synonyms to each other through the key
        for (const v2 of arr) {
          const val2 = String(v2 || '').toLowerCase().trim();
          if (val2 && val2 !== val) add(val, val2);
        }
      }
    }
    return bi;
  }
  const synonymsBi = buildBiSynonyms(synonymsMap);

  // Global preferred order for displaying status badges (also used by facets)
  const STATUS_ORDER = [
    'active',
    'amended',
    'reaffirmed',
    'stabilized',
    'superseded',
    'withdrawn',
    'draft',
    'versionless',
    'unknown',
    'latestVersion'
  ];
  function orderStatuses(arr){
    const list = Array.isArray(arr) ? arr.slice() : [];
    const known = STATUS_ORDER.filter(s => list.includes(s));
    const extras = list.filter(s => !STATUS_ORDER.includes(s)).sort((a,b)=>String(a).localeCompare(String(b)));
    return known.concat(extras);
  }

  // Optional client-side Handlebars card template
  let hbCard = null;
  let tplEl = document.getElementById('card-tpl');
  if (!tplEl) {
    const src = document.getElementById('card-tpl-src');
    if (src) {
      const scr = document.createElement('script');
      scr.id = 'card-tpl';
      scr.type = 'text/x-handlebars-template';
      scr.innerHTML = src.innerHTML;
      document.body.appendChild(scr);
      tplEl = scr;
    }
  }
  if (!tplEl) {
    console.error('[docList] [TEMPLATE] Missing #card-tpl and #card-tpl-src. The page must include <template id="card-tpl-src">…</template>.');
  } else if (!tplEl.innerHTML || tplEl.innerHTML.trim().length === 0) {
    console.error('[docList] [TEMPLATE] card template node is empty. Check docList.hbs for the inline template content.');
  }

  if (!(await ensureHandlebars())) {
    console.error('[docList] [RUNTIME] Handlebars not available; templates cannot render.');
  }

  if (tplEl && window.Handlebars) {
    // --- Publisher logo helper (client-side; data fetched at runtime)
    // Expects build/_data/publisher-logos.json with shape: { logos: { "SMPTE": "/static/logos/smpte.svg", ... }, height: 18 }
    let __publisherLogos = {};
    let __publisherLogoHeight = 18;
    let __publisherAliases = {};
    try {
      const cfg = await loadJSONTry(['../_data/publisher-logos.json']);
      if (cfg && typeof cfg === 'object') {
        __publisherLogos = cfg.logos || {};
        __publisherLogoHeight = Number(cfg.height) || 18;
        __publisherAliases = (cfg.aliases && typeof cfg.aliases === 'object') ? cfg.aliases : {};
      }
    } catch (e) {
      console.warn('[docList] publisher logos config not available (tried multiple paths):', e && e.message ? e.message : e);
    }
    // Publisher URLs config (link targets)
    let __publisherUrls = {};
    let __publisherUrlAliases = {};
    try {
      const ucfg = await loadJSONTry(['../_data/publisher-urls.json']);
      if (ucfg && typeof ucfg === 'object') {
        __publisherUrls = ucfg.urls || {};
        __publisherUrlAliases = (ucfg.aliases && typeof ucfg.aliases === 'object') ? ucfg.aliases : {};
      }
    } catch (e) {
      console.warn('[docList] publisher urls config not available:', e && e.message ? e.message : e);
    }

    function resolvePublisherLogo(pubRaw){
      const input = String(pubRaw || '').trim();
      if (!input) return null;

      // 1) Exact
      if (__publisherLogos[input]) return __publisherLogos[input];

      // 2) Alias (case-insensitive keys)
      const lowerAliases = __publisherAliases.__lowerCache || ( __publisherAliases.__lowerCache = (() => {
        const m = {};
        for (const [a, c] of Object.entries(__publisherAliases)) {
          m[String(a).toLowerCase()] = String(c);
        }
        return m;
      })());
      const canonFromAlias = lowerAliases[input.toLowerCase()];
      if (canonFromAlias && __publisherLogos[canonFromAlias]) return __publisherLogos[canonFromAlias];

      // 3) Simple tokenization: take first token before common separators (mdash/en dash, hyphen, comma, paren)
      const firstToken = input.split(/[–—-]|,|\(|\)|:/)[0].trim();
      if (firstToken && __publisherLogos[firstToken]) return __publisherLogos[firstToken];

      // 4) Case-insensitive direct match on keys
      const lowerKey = input.toLowerCase();
      for (const [k, v] of Object.entries(__publisherLogos)) {
        if (String(k).toLowerCase() === lowerKey) return v;
      }

      return null;
    }
    function resolvePublisherUrl(pubRaw){
      const input = String(pubRaw || '').trim();
      if (!input) return null;

      // 1) Exact
      if (__publisherUrls[input]) return __publisherUrls[input];

      // 2) Alias (case-insensitive)
      const lowerAliases = __publisherUrlAliases.__lowerCache || ( __publisherUrlAliases.__lowerCache = (() => {
        const m = {};
        for (const [a, c] of Object.entries(__publisherUrlAliases)) {
          m[String(a).toLowerCase()] = String(c);
        }
        return m;
      })());
      const canonFromAlias = lowerAliases[input.toLowerCase()];
      if (canonFromAlias && __publisherUrls[canonFromAlias]) return __publisherUrls[canonFromAlias];

      // 3) First token
      const firstToken = input.split(/[–—-]|,|\(|\)|:/)[0].trim();
      if (firstToken && __publisherUrls[firstToken]) return __publisherUrls[firstToken];

      // 4) Case-insensitive direct match
      const lowerKey = input.toLowerCase();
      for (const [k, v] of Object.entries(__publisherUrls)) {
        if (String(k).toLowerCase() === lowerKey) return v;
      }
      return null;
    }
    const __pubWarned = new Set();
    window.Handlebars.registerHelper('publisherLogo', function(pub) {
      const rel = resolvePublisherLogo(pub);
      if (!rel) {
        const key = String(pub || '');
        if (key && !__pubWarned.has(key)) {
          __pubWarned.add(key);
          console.debug('[docList] publisherLogo: no logo for publisher "%s". Available keys: %o', key, Object.keys(__publisherLogos));
        }
        return '';
      }
      const alt = `${pub} logo`;
      const h = __publisherLogoHeight;
      return new window.Handlebars.SafeString(
        `<img src="../${rel}" alt="${alt}" height="${h}" class="align-text-bottom me-1" loading="lazy">`
      );
    });
    window.Handlebars.registerHelper('publisherLink', function(pub){
      const url = resolvePublisherUrl(pub);
      return url || '';
    });
    // minimal helpers
    window.Handlebars.registerHelper('join', function(arr, sep){ return Array.isArray(arr) ? arr.join(sep||', ') : ''; });
    window.Handlebars.registerHelper('len', function(x){ return (Array.isArray(x) || typeof x === 'string') ? x.length : 0; });
    window.Handlebars.registerHelper('gt', function(a,b){ return Number(a) > Number(b); });
    window.Handlebars.registerHelper('statusBadge', function(status){
      const raw = String(status || '');
      const s = raw.toLowerCase();
      const cls = {
        unknown:   'text-bg-danger',
        withdrawn: 'text-bg-danger',
        superseded:'text-bg-warning',
        draft:     'text-bg-warning',
        publiccd:  'text-bg-info',
        active:    'text-bg-success',
        versionless:'bg-success-subtle text-info-emphasis',
        amended:   'text-bg-secondary',
        reaffirmed:'text-bg-info',
        stabilized:'text-bg-primary',
        latestversion: 'bg-info-subtle text-info-emphasis'
      }[s] || 'text-bg-light';

      // Insert spaces between camelCase boundaries and underscores, then uppercase
      const pretty = raw
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/_/g, ' ')
        .trim();

      const label = pretty ? `[${pretty.toUpperCase()}]` : '[UNKNOWN]';
      return new window.Handlebars.SafeString(`<span class="label badge ${cls}">${label}</span>`);
    });
    // coalesce helper: returns first non-empty arg (skipping options hash)
    window.Handlebars.registerHelper('coalesce', function(){
      const args = Array.prototype.slice.call(arguments, 0, -1); // drop options hash
      for (let i = 0; i < args.length; i++) {
        const v = args[i];
        if (v !== undefined && v !== null && String(v).trim() !== '') return v;
      }
      return '';
    });
    // hasAny helper: checks if an array is non-empty
    window.Handlebars.registerHelper('hasAny', function(arr){
      return Array.isArray(arr) && arr.length > 0;
    });
    // exists helper: truthy check in templates
    window.Handlebars.registerHelper('exists', function(v){
      return (v !== undefined && v !== null && String(v).trim() !== '');
    });
    // doiLink helper: clickable DOI via doi.org
    window.Handlebars.registerHelper('doiLink', function(doi){
      const d = String(doi || '').trim();
      if (!d) return '';
      const url = 'https://doi.org/' + encodeURIComponent(d);
      return new window.Handlebars.SafeString(`<a href="${url}" target="_blank" rel="noopener"><code>${d}</code></a>`);
    });
    try {
      hbCard = window.Handlebars.compile(tplEl.innerHTML);
    } catch (e) {
      console.error('[docList] [COMPILE] Handlebars failed to compile docList template:', e);
    }
  }

  // --- MiniSearch integration
  let mini = null;

  function expandSynonyms(term){
    const raw = String(term || '');
    const t = raw.toLowerCase();
    const extras = Array.isArray(synonymsBi[t]) ? synonymsBi[t] : [];
    // Return original term first, then unique extras (preserve original casing for display neutrality)
    const out = [raw];
    for (const e of extras) {
      if (!out.some(x => String(x).toLowerCase() === e)) out.push(e);
    }
    return out;
  }

  function parseQuery(qRaw){
    const q = (qRaw || '').trim();
    if (!q) return { includes: [], excludes: [], fields: [] };
    const tokens = [];
    const rx = /"([^"]+)"|(\S+)/g;
    let m;
    while ((m = rx.exec(q))) tokens.push(m[1] || m[2]);
    const includes = [], excludes = [], fields = [];
    for (const t of tokens) {
      if (t.startsWith('-') && t.length > 1) excludes.push(t.slice(1));
      else if (t.includes(':')) {
        const [f, ...rest] = t.split(':');
        const term = rest.join(':');
        if (term) fields.push({ field: f, term });
      } else includes.push(t);
    }
    return { includes, excludes, fields };
  }

  function buildHaystack(d){
    return [
      d.title || '',
      d.label || '',
      d.id || '',
      d.publisher || '',
      d.doi || '',
      d.publicationDate || '',
      ...(Array.isArray(d.groupNames) ? d.groupNames : []),
      ...(Array.isArray(d.group) ? d.group : []),
      ...(Array.isArray(d.keywords) ? d.keywords : []),
      ...(Array.isArray(d.keywordsSearch) ? d.keywordsSearch : []),
      ...(Array.isArray(d.currentWork) ? d.currentWork : [])
    ].join(' ').toLowerCase();
  }

  // Per-term MiniSearch search options based on length
  function optsForTerm(t){
    const len = (t || '').length;
    return {
      combineWith: 'AND',
      prefix: len >= 3,             // only allow prefix for length ≥ 3
      fuzzy:  len >= 4 ? 0.1 : false // tiny fuzziness, only for length ≥ 4
    };
  }

  function searchIdsWithMini(qRaw){
    const { includes, excludes, fields, forceSimple } = parseQuery(qRaw);
    let includeSet = null;
    // helper: intersect includeSet with the given id set
    const intersectWith = (ids) => {
      const s = new Set(ids);
      includeSet = (includeSet == null) ? new Set(s) : new Set([...includeSet].filter(id => s.has(id)));
    };
    const effectiveSimple = (state.searchMode === 'simple') || forceSimple;
    if (includes.length) {
      for (const t of includes) {
        const terms = expandSynonyms(t);
        const unionSet = new Set();
        for (const tt of terms) {
          const ttStr = String(tt || '');
          const isPhrase = /\s/.test(ttStr); // multi-word term
          if (isPhrase) {
            // 1) intersection of per-word MiniSearch results to narrow candidates
            const words = ttStr.split(/\s+/).filter(Boolean);
            let cand = null;
            for (const w of words) {
              const res = mini.search(w, optsForTerm(w));
              const s = new Set(res.map(r => r.id));
              cand = cand ? new Set([...cand].filter(id => s.has(id))) : s;
              if (!cand.size) break;
            }
            // 2) exact phrase check against lower-cased haystack
            if (cand && cand.size) {
              const needle = ttStr.toLowerCase();
              for (const id of cand) {
                const hay = hayById.get(id) || '';
                if (hay.includes(needle)) unionSet.add(id);
              }
            }
          } else {
            // single token — normal MiniSearch search, but allow simple mode
            const ttLc = ttStr.toLowerCase();
            if (effectiveSimple) {
              for (const [id, hay] of hayById.entries()) {
                if (hay.includes(ttLc)) unionSet.add(id);
              }
            } else {
              const res = mini.search(ttStr, optsForTerm(ttStr));
              for (const r of res) unionSet.add(r.id);
            }
          }
        }
        intersectWith(unionSet);
      }
    }
    for (const { field, term } of fields) {
      // already intersection
      if (effectiveSimple) {
        const tLc = String(term || '').toLowerCase();
        const s = new Set();
        for (const d of idx) {
          const val = d[field];
          if (Array.isArray(val)) {
            if (val.some(x => String(x).toLowerCase().includes(tLc))) s.add(d.id);
          } else if (val != null && String(val).toLowerCase().includes(tLc)) {
            s.add(d.id);
          }
        }
        includeSet = includeSet ? new Set([...includeSet].filter(id => s.has(id))) : s;
      } else {
        const res = mini.search(term, Object.assign(optsForTerm(term), { fields: [field] }));
        const s = new Set(res.map(r => r.id));
        includeSet = includeSet ? new Set([...includeSet].filter(id => s.has(id))) : s;
      }
    }
    if (!includeSet) includeSet = new Set(idx.map(r => r.id));
    for (const t of excludes) {
      const terms = expandSynonyms(t);
      const ex = new Set();
      for (const tt of terms) {
        if (effectiveSimple) {
          const ttLc = String(tt || '').toLowerCase();
          for (const [id, hay] of hayById.entries()) {
            if (hay.includes(ttLc)) ex.add(id);
          }
        } else {
          for (const r of mini.search(tt, optsForTerm(tt))) ex.add(r.id);
        }
      }
      for (const id of ex) includeSet.delete(id);
    }
    return includeSet;
  }

  // Initialize MiniSearch index (if UMD loaded)
  const hasMini = await ensureMiniSearch();
  var hayById = null;
  if (hasMini) {
    mini = new window.MiniSearch({
      fields: ['title','label','id','keywords','keywordsSearch','currentWork','publisher','doi','group','groupNames','publicationDate'],
      storeFields: ['id'],
      searchOptions: {
        // Stronger signal on human-facing identifiers; curated keywords beat assembled tokens
        boost: {
          title: 6,
          id: 5,
          label: 4,
          keywords: 3,
          keywordsSearch: 2,
          publisher: 2,
          groupNames: 2,
          group: 1,
          currentWork: 1,
          doi: 1,
          publicationDate: 2
        },
        combineWith: 'AND',
        prefix: true,   // will be gated per-term below
        fuzzy: 0.1      // will be gated per-term below
      }
    });
    const toStr = v => Array.isArray(v) ? v.join(' ') : (v || '');
    mini.addAll(idx.map(r => ({
      id: r.id,
      title: r.title || '',
      label: r.label || '',
      keywords: toStr(r.keywords),
      keywordsSearch: toStr(r.keywordsSearch),
      currentWork: toStr(r.currentWork),
      publisher: r.publisher || '',
      doi: r.doi || '',
      publicationDate: r.pubDate || '',
      group: toStr(r.group),
      groupNames: toStr(r.groupNames)
    })));
    // Precompute haystacks for exact-phrase post-filtering
    hayById = new Map();
    for (const d of idx) {
      hayById.set(d.id, buildHaystack(d));
    }
    // --- Exact-match indexes for query boosting (e.g., "429-2")
    const idIndex = new Map();
    const labelIndex = new Map();
    const keyIndex = new Map(); // normalized key: lowercased, punctuation stripped
    function normKey(s){ return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
    for (const r of idx) {
      const idL = String(r.id || '').toLowerCase();
      if (idL) idIndex.set(idL, r.id);
      const lblL = String(r.label || '').toLowerCase();
      if (lblL) labelIndex.set(lblL, r.id);
      const k1 = normKey(r.id);
      if (k1) keyIndex.set(k1, r.id);
      const k2 = normKey(r.label);
      if (k2) keyIndex.set(k2, r.id);
    }
    function exactHitIdsForQuery(q){
      const out = new Set();
      const raw = String(q || '').trim();
      if (!raw) return out;

      const lower = raw.toLowerCase();
      if (idIndex.has(lower)) out.add(idIndex.get(lower));
      if (labelIndex.has(lower)) out.add(labelIndex.get(lower));

      const nk = normKey(raw);
      if (nk) {
        // Exact normalized key equality via index
        if (keyIndex.has(nk)) out.add(keyIndex.get(nk));
        // Normalized substring scan: catch cases like "429-2:2020" within full labels like "SMPTEST42922020"
        for (const r of idx) {
          const idN = normKey(r.id);
          const lblN = normKey(r.label);
          if ((idN && (idN === nk || idN.includes(nk))) || (lblN && (lblN === nk || lblN.includes(nk)))) {
            out.add(r.id);
          }
        }
      }

      // also try tokenized pieces (split on whitespace and common punctuation)
      const parts = raw.split(/[\s,;:/]+/).filter(Boolean);
      for (const p of parts) {
        const pl = p.toLowerCase();
        if (idIndex.has(pl)) out.add(idIndex.get(pl));
        if (labelIndex.has(pl)) out.add(labelIndex.get(pl));
        const np = normKey(p);
        if (np) {
          if (keyIndex.has(np)) out.add(keyIndex.get(np));
          for (const r of idx) {
            const idN = normKey(r.id);
            const lblN = normKey(r.label);
            if ((idN && (idN === np || idN.includes(np))) || (lblN && (lblN === np || lblN.includes(np)))) {
              out.add(r.id);
            }
          }
        }
      }
      return out;
    }
  }

  // --- State
  const state = { q:'', f:{}, sort:'pubDate:desc', page:1, size:40 };
  // Compute combined sticky offset (navbar + cards-topbar) and expose as CSS var
  function computeStickyOffset(){
    const sels = ['.navbar.sticky-top', '#cards-topbar'];
    let h = 0;
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const topPx = parseFloat(cs.top) || 0;
      const isAffixed = (cs.position === 'sticky' || cs.position === 'fixed');
      const isAtTop = isAffixed && (r.top <= topPx + 2); // element is pinned at its top offset
      if (isAtTop) h += r.height; // only the height blocks content; top offset just positions it
    }
    h = Math.max(0, Math.floor(h + 8)); // + small padding
    document.documentElement.style.setProperty('--sticky-offset', h + 'px');
  }
  computeStickyOffset();
  window.addEventListener('resize', computeStickyOffset);
  window.addEventListener('scroll', computeStickyOffset, { passive: true });
  let _initialDeepLinked = false; // prevents double-render overriding initial hash navigation

  function getSearchTipsHtml(){
    return [
      '<div class="small">',
      '<strong>Search tips</strong>',
      '<ul class="mb-0 ps-3">',
      '<li><em>AND by default</em> — every word must match. Add words to narrow.</li>',
      '<li><em>Exact phrase</em> — use quotes: "digital cinema"</li>',
      '<li><em>Doc number/date</em> — type like <code>429-2:2020</code> (hyphens/colons normalized).</li>',
      '<li><em>Field filters</em> — <code>publisher:SMPTE</code>, <code>label:"SMPTE ST 429-2"</code>, <code>id:429-2</code>, <code>doi:10.</code>, <code>group:isdcf</code>, <code>groupNames:"inter-society"</code>, <code>publicationDate:2020</code></li>',
      '<li><em>Exclude</em> — prefix a minus: <code>-draft</code></li>',
      '<li><em>Prefix</em> — 3+ letters match starts of words.</li>',
      '<li><em>Fuzzy</em> — 4+ letters allow small typos (≈0.1).</li>',
      '<li><em>Synonyms</em> — bi-directional (e.g., <code>isdcf</code> ↔ <code>inter-society digital cinema forum</code>).</li>',
      '</ul>',
      '</div>'
    ].join('');
  }

  function installSearchTips(){
    try {
      const qEl = document.getElementById('q');
      // Prefer placing the button inline with the search input; fallback to topbar
      const container = (qEl && qEl.parentElement)
        || document.querySelector('#cards-topbar .toolbar-right')
        || document.querySelector('#cards-topbar')
        || document.body;

      if (!container || document.getElementById('searchTipsBtn')) return;

      const btn = document.createElement('button');
      btn.id = 'searchTipsBtn';
      btn.type = 'button';
      btn.className = 'btn btn-sm btn-outline-secondary ms-2';
      btn.setAttribute('aria-label', 'Search tips');
      btn.textContent = 'Search tips';

      if (qEl && container === qEl.parentElement) {
        // Insert directly after the search input so it reads as part of the control cluster
        container.insertBefore(btn, qEl.nextSibling);
      } else {
        container.appendChild(btn);
      }

      const html = getSearchTipsHtml();
      if (window.bootstrap && window.bootstrap.Popover) {
        new window.bootstrap.Popover(btn, {
          html: true,
          content: html,
          trigger: 'focus',
          placement: 'bottom',
          sanitize: false
        });
        btn.addEventListener('click', () => { btn.focus(); });
      } else {
        // Fallback if Bootstrap JS isn’t present
        btn.addEventListener('click', () => {
          const text = html
            .replace(/<[^>]+>/g, '\n')
            .replace(/\n\n+/g, '\n')
            .replace(/\s+\n/g, '\n')
            .trim();
          alert(text);
        });
      }

      // Keyboard shortcut inside the search box: press "?" (Shift + /)
      if (qEl) {
        qEl.addEventListener('keydown', (ev) => {
          const key = ev.key || '';
          if (key === '?' || (key === '/' && (ev.shiftKey || ev.metaKey || ev.ctrlKey))) {
            ev.preventDefault();
            btn.focus();
          }
        });
      }
    } catch (e) {
      console.warn('[docList] search tips init failed:', e && e.message ? e.message : e);
    }
  }

  // --- URL sync (page,size) ---
  function initPageSizeFromURL(){
    try {
      const sp = new URLSearchParams(window.location.search);
      const p = parseInt(sp.get('page'), 10);
      const s = parseInt(sp.get('size'), 10);
      if (Number.isFinite(p) && p >= 1) state.page = p;
      if (Number.isFinite(s) && s > 0) state.size = s;
    } catch {}
  }
  function updateURLPageSize(push){
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('page', String(state.page));
      url.searchParams.set('size', String(state.size));
      if (push) window.history.pushState({}, '', url);
      else window.history.replaceState({}, '', url);
    } catch {}
  }

  // --- URL sync (filters) ---
  function initFiltersFromURL(){
    try {
      const sp = new URLSearchParams(window.location.search);
      const newF = {};
      sp.forEach((val, key) => {
        if (!key.startsWith('f.')) return;
        const facet = key.slice(2);
        const arr = String(val).split(',').map(s => s.trim()).filter(Boolean);
        const normFacet = (facet === 'hasCurrentWork') ? 'currentWork' : facet;
        if (arr.length) newF[normFacet] = arr;
      });
      state.f = newF;
      syncFacetCheckboxesFromState();
    } catch {}
  }
  function updateURLAll(push){
    try {
      const url = new URL(window.location.href);
      // page + size + sort
      url.searchParams.set('page', String(state.page));
      url.searchParams.set('size', String(state.size));
      url.searchParams.set('sort', String(state.sort));
      // sync search query
      if (state.q && String(state.q).trim() !== '') url.searchParams.set('q', String(state.q).trim());
      else url.searchParams.delete('q');
      // wipe old f.* params
      const toDelete = [];
      url.searchParams.forEach((_, key) => { if (key.startsWith('f.')) toDelete.push(key); });
      toDelete.forEach(k => url.searchParams.delete(k));
      // add current filters
      Object.entries(state.f).forEach(([k, arr]) => {
        if (Array.isArray(arr) && arr.length) url.searchParams.set(`f.${k}`, arr.map(String).join(','));
      });
      if (push) window.history.pushState({}, '', url);
      else window.history.replaceState({}, '', url);
    } catch {}
  }
  // --- End URL sync (filters) ---
  // --- URL sync (search) ---
  function initSearchFromURL(){
    try {
      const sp = new URLSearchParams(window.location.search);
      const q = sp.get('q');
      if (typeof q === 'string') {
        state.q = q;
        const qInput = document.querySelector('#q');
        if (qInput) qInput.value = q;
      }
    } catch {}
  }
  // --- End URL sync (search) ---
  // --- URL sync (sort) ---
  function initSortFromURL(){
    try {
      const sp = new URLSearchParams(window.location.search);
      const s = sp.get('sort');
      const sel = document.querySelector('#sort');
      const next = (typeof s === 'string' && s.trim() !== '') ? s : 'pubDate:desc';
      state.sort = next;
      if (sel) {
        if (![...sel.options].some(o => o.value === next)) {
          const opt = document.createElement('option');
          opt.value = next; opt.textContent = next;
          sel.appendChild(opt);
        }
        sel.value = next;
      }
    } catch {}
  }
  // --- End URL sync (sort) ---
  // --- End URL sync ---

  // --- Helpers

  // Remove any #fragment from the URL without scrolling the page
  function clearHashNoScroll(){
    try {
      const u = new URL(window.location.href);
      if (!u.hash) return;
      u.hash = '';
      window.history.replaceState({}, '', u);
    } catch {}
  }
  
  function syncPageSizeSelectFromState(){
    const sel = document.querySelector('#pageSize');
    if (!sel) return;
    const val = String(state.size);
    // Ensure an option exists matching the current size; if not, add it
    if (![...sel.options].some(o => o.value === val)) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = val;
      sel.appendChild(opt);
    }
    sel.value = val;
  }

  function populateYearSelect(){
    const sel = document.querySelector('#yearSelect');
    if (!sel || !facets || !facets.year) return;
    const existing = new Set(Array.from(sel.options).map(o => o.value));
    const years = Object.keys(facets.year)
      .map(y => parseInt(y, 10))
      .filter(y => Number.isFinite(y))
      .sort((a,b)=> b - a); // newest first
    for (const y of years) {
      const v = String(y);
      if (existing.has(v)) continue;
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    }
  }

  function syncYearSelectFromState(){
    const sel = document.querySelector('#yearSelect');
    if (!sel) return;
    const vals = state.f.year || [];
    sel.value = (Array.isArray(vals) && vals.length) ? String(vals[0]) : '';
  }

  const facetLabel = (k, v) => {
    if (k === 'group' && facets.groupLabels && facets.groupLabels[v]) return facets.groupLabels[v];
    if ((k === 'hasDoi' || k === 'hasReleaseTag') && (v === 'true' || v === true)) return ({
      hasDoi: 'Has DOI', hasReleaseTag: 'Has Release Tag'
    })[k];
    if ((k === 'hasDoi' || k === 'hasReleaseTag') && (v === 'false' || v === false)) return ({
      hasDoi: 'No DOI', hasReleaseTag: 'No Release Tag'
    })[k];
    if (k === 'status' && facets.statusLabels && facets.statusLabels[v]) return facets.statusLabels[v];
    return String(v);
  };

  // --- Central sync: facet checkboxes <= state.f ---
  function syncFacetCheckboxesFromState() {
    const boxes = Array.from(document.querySelectorAll('input[type="checkbox"][name]'));
    for (const cb of boxes) {
      const k = cb.name;
      const v = cb.value;
      const arr = (state.f[k] || []);
      const shouldCheck = arr.includes(String(v));
      if (cb.checked !== shouldCheck) cb.checked = shouldCheck;
    }
  }
  // --- End central sync ---

  // --- Deep-link to a card by #id (supports pagination + filters reset if needed) ---
  function findIndexById(rows, id){
    if (!id) return -1;
    return rows.findIndex(d => String(d.id) === String(id));
  }
  function highlightAndScrollTo(id){
    const anchor = document.getElementById(id);
    if (!anchor) return;
    // Prefer the card element for visual highlight
    const card = anchor.closest('.card-reg') || anchor;

    // Use native scrollIntoView; offset handled by CSS scroll-margin-top on .card-reg
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Transient highlight for orientation
    const prevOutline = card.style.outline;
    const prevShadow = card.style.boxShadow;
    card.style.outline = '2px solid #1398b0';
    card.style.boxShadow = '0 0 0 4px rgba(19,152,176,0.15)';
    setTimeout(()=>{
      card.style.outline = prevOutline || '';
      card.style.boxShadow = prevShadow || '';
    }, 1600);
  }
  function navigateToCardById(id){
    if (!id) return;
    // try within current filtered rows first
    let rows = applyFilters();
    let pos = findIndexById(rows, id);
    if (pos === -1) {
      // not present under current filters; clear filters/search and try full index
      state.f = {};
      state.q = '';
      const qInput = document.querySelector('#q');
      if (qInput) qInput.value = '';
      syncFacetCheckboxesFromState();
      rows = applyFilters(); // reuses current sort with empty filters
      pos = findIndexById(rows, id);
      if (pos === -1) return; // not found at all
    }
    const targetPage = Math.floor(pos / state.size) + 1;
    state.page = targetPage;
    updateURLAll(true);
    render();
    // Defer scroll until after render paints (next animation frame ensures layout is flushed)
    requestAnimationFrame(() => requestAnimationFrame(() => highlightAndScrollTo(id)));
  }
  // Handle initial hash and changes
  function initHashDeepLink(){
    let did = false;
    const h = (window.location.hash || '').replace(/^#/, '').trim();
    if (h) { navigateToCardById(h); did = true; }
    window.addEventListener('hashchange', () => {
      const hh = (window.location.hash || '').replace(/^#/, '').trim();
      if (hh) navigateToCardById(hh);
    });
    return did;
  }
  // --- End deep-link helpers ---

  function renderActiveFilters(){
    const root = $('#activeFilters'); if (!root) return;
    const chips = [];
    for (const [k, arr] of Object.entries(state.f)) {
      if (!arr || !arr.length) continue;
      for (const v of arr) {
        const label = facetLabel(k, v);
        chips.push(`<span class="chip" data-k="${k}" data-v="${v}">${label} <button type="button" class="btn btn-sm btn-link p-0 ms-1 chip-x" aria-label="Remove">×</button></span>`);
      }
    }
    const clearAll = chips.length ? `<button id="clearFilters" type="button" class="btn btn-sm btn-outline-secondary ms-1">Clear all</button>` : '';
    root.innerHTML = chips.join('') + clearAll;

    root.querySelectorAll('.chip-x').forEach(btn => btn.addEventListener('click', e => {
      const p = e.currentTarget.parentElement;
      const k = p.getAttribute('data-k');
      const v = p.getAttribute('data-v');
      clearHashNoScroll();
      state.f[k] = (state.f[k] || []).filter(x => x !== v);
      if (!state.f[k] || state.f[k].length === 0) delete state.f[k];
      state.page = 1;
      updateURLAll(true);
      syncFacetCheckboxesFromState();
      syncYearSelectFromState();
      render();
    }));
    const ca = $('#clearFilters');
    if (ca) ca.addEventListener('click', () => {
      clearHashNoScroll();
      state.f = {};
      state.q = '';
      const qInput = document.querySelector('#q');
      if (qInput) qInput.value = '';
      syncFacetCheckboxesFromState();
      syncYearSelectFromState();
      state.page = 1;
      updateURLAll(true);
      render();
    });
  }

  function renderFilterSummary(){
    const el = $('#filterSummary'); if (!el) return;
    const parts = [];
    for (const [k, arr] of Object.entries(state.f)) {
      if (!arr || !arr.length) continue;
      const labels = arr.map(v => facetLabel(k, v));
      parts.push(`${k}: ${labels.join(' + ')}`);
    }
    el.textContent = parts.length ? `Filtered by — ${parts.join('  |  ')}` : '';
  }

  function applyFilters(){
    // MiniSearch integration for search
    let allowedBySearch = null;
    if (mini && state.q && state.q.trim() !== '') {
      allowedBySearch = searchIdsWithMini(state.q);
    }
    // Legacy fallback when MiniSearch isn't available
    let legacyQuery = null;
    if (!mini && state.q && state.q.trim() !== '') {
      legacyQuery = parseQuery(state.q);
    }
    const pass = d => {
      // MiniSearch gate (when active)
      if (allowedBySearch && !allowedBySearch.has(d.id)) return false;

      // Legacy substring search fallback — AND semantics across terms and fields
      if (legacyQuery) {
        const hay = [
          d.title || '',
          d.label || '',
          d.id || '',
          d.publisher || '',
          d.doi || '',
          d.publicationDate || '',
          ...(Array.isArray(d.groupNames) ? d.groupNames : []),
          ...(Array.isArray(d.group) ? d.group : []),
          ...(Array.isArray(d.keywords) ? d.keywords : []),
          ...(Array.isArray(d.keywordsSearch) ? d.keywordsSearch : []),
          ...(Array.isArray(d.currentWork) ? d.currentWork : [])
        ].join(' ').toLowerCase();
        const needles = (legacyQuery.includes || []).map(s => String(s).toLowerCase());
        if (needles.length && !needles.every(n => hay.includes(n))) return false;
        // fielded terms: intersect
        for (const { field, term } of (legacyQuery.fields || [])) {
          const tLc = String(term || '').toLowerCase();
          const val = d[field];
          if (Array.isArray(val)) {
            if (!val.some(x => String(x).toLowerCase().includes(tLc))) return false;
          } else if (!(val != null && String(val).toLowerCase().includes(tLc))) {
            return false;
          }
        }
        // excludes: subtract
        const ex = (legacyQuery.excludes || []).map(s => String(s).toLowerCase());
        if (ex.some(n => hay.includes(n))) return false;
      }
      for (const [k, vs] of Object.entries(state.f)) {
        if (!vs?.length) continue;
        const sourceKey = (k === 'hasCurrentWork') ? 'currentWork' : k; // legacy URL compatibility
        const val = d[sourceKey];

        if (k === 'status') {
          // AND semantics: every selected status must be present on the doc
          const arr = Array.isArray(val) ? val.map(String) : (val ? [String(val)] : []);
          if (!vs.every(sel => arr.includes(String(sel)))) return false;
        } else if (Array.isArray(val)) {
          // OR semantics (existing behavior)
          if (!val.some(x => vs.includes(String(x)))) return false;
        } else {
          if (!vs.includes(String(val))) return false;
        }
      }
      return true;
    };
    let rows = idx.filter(pass);
    // If query looks like a document number (e.g., "429-2", "428-7:2020", "ST 2110-20.2022"),
    // and we have exact ID/label hits computed, restrict the result set to those exact matches.
    const looksLikeDocNum = !!(state.q && /[0-9].*[-:.]/.test(state.q)) || !!(state.q && /[-:.].*[0-9]/.test(state.q));
    const exactSet = (typeof exactHitIdsForQuery === 'function' && state.q && state.q.trim()) ? exactHitIdsForQuery(state.q) : null;
    if (looksLikeDocNum && exactSet && exactSet.size) {
      rows = rows.filter(r => exactSet.has(r.id));
    }
    // If searching, precompute exact-match IDs to float them to the top after sorting
    if (state.sort === 'pubDate:desc') {
      rows.sort((a,b)=>{
        const bt = (typeof b.pubTs === 'number') ? b.pubTs : (b.pubDate? Date.UTC(b.pubDate,0,1): 0);
        const at = (typeof a.pubTs === 'number') ? a.pubTs : (a.pubDate? Date.UTC(a.pubDate,0,1): 0);
        return bt - at;
      });
    }
    if (state.sort === 'pubDate:asc') {
      rows.sort((a,b)=>{
        const at = (typeof a.pubTs === 'number') ? a.pubTs : (a.pubDate? Date.UTC(a.pubDate,0,1): 0);
        const bt = (typeof b.pubTs === 'number') ? b.pubTs : (b.pubDate? Date.UTC(b.pubDate,0,1): 0);
        return at - bt;
      });
    }
    
    if (state.sort === 'title:asc') {
      const normalizeTitle = t => (t ? String(t).trim().toLowerCase()
        .replace(/^(the|a|an)\s+/i, '') : '');
      rows.sort((a, b) =>
        normalizeTitle(a.title).localeCompare(normalizeTitle(b.title), 'en', { sensitivity: 'base' })
      );
    }

    if (state.sort === 'title:desc') {
      const normalizeTitle = t => (t ? String(t).trim().toLowerCase()
        .replace(/^(the|a|an)\s+/i, '') : '');
      rows.sort((a, b) =>
        normalizeTitle(b.title).localeCompare(normalizeTitle(a.title), 'en', { sensitivity: 'base' })
      );
    }

    if (state.sort === 'label:asc') rows.sort((a,b)=>String(a.label).localeCompare(String(b.label)));

    if (state.sort === 'label:desc') rows.sort((a,b)=>String(b.label).localeCompare(String(a.label)));
    // Stable partition: move exact matches to the front while preserving sort order
    if (exactSet && exactSet.size) {
      const exact = [];
      const rest = [];
      for (const r of rows) {
        (exactSet.has(r.id) ? exact : rest).push(r);
      }
      rows = exact.concat(rest);
    }
    return rows;
  }

  function cardHTML(d, opts){
    if (!hbCard) {
      console.error('[docList] [RENDER] No compiled template. Causes: missing #card-tpl-src, Handlebars not loaded, or compile error.');
      return `<div class="alert alert-danger">Cards cannot render: template missing or Handlebars runtime unavailable.</div>`;
    }
    try {
      return hbCard(Object.assign({}, d, opts||{}, {
        hideGroup: !!(state.f.group && state.f.group.length),
        statusOrdered: orderStatuses(d.status)
      }));
    } catch (err) {
      console.error('[docList] Template render error:', err);
      return `<div class="alert alert-danger">[docList] Template render error: ${err.message}</div>`;
    }
  }

  function renderFacets(){
    const root = $('#facet'); if (!root) return;
    const facetTitles = {
      docType: 'Document Type',
      status: 'Status',
      publisher: 'Publisher',
      group: 'Group',
      currentWork: 'Current Work',
      keywords: 'Keywords',
      hasDoi: 'DOI',
      hasReleaseTag: 'Release Tag'
    };
    // Preferred display order for the Status facet (non‑alpha)
    const statusOrder = [
      'active',
      'latestVersion',
      'amended',
      'reaffirmed',
      'stabilized',
      'superseded',
      'withdrawn',
      'draft',
      'versionless',
      'unknown'
    ];
    const makeList = (name, map, labels) => {
      let keys = Object.keys(map || {});
      if (name === 'status' && Array.isArray(statusOrder)) {
        // Use explicit ordering and include only keys that exist in the map
        const ordered = statusOrder.filter(k => Object.prototype.hasOwnProperty.call(map, k));
        // Append any unexpected keys (e.g., future flags) alphabetically after the known order
        const extras = keys.filter(k => !statusOrder.includes(k)).sort((a,b)=>String(a).localeCompare(String(b)));
        keys = ordered.concat(extras);
      } else {
        // Default alphabetical for all other facets
        keys.sort((a,b)=>String(a).localeCompare(String(b)));
      }
      const items = keys.map(k => {
        const id = `${name}_${String(k).replace(/[^\w-]+/g,'_')}`;
        const label = (labels && labels[k]) ? labels[k] : k;
        return `
          <div class="form-check mb-1">
            <input class="form-check-input" id="${id}" type="checkbox" name="${name}" value="${k}">
            <label class="form-check-label d-flex justify-content-between" for="${id}">
              <span>${label}</span>
              <span class="text-muted small ms-2">${map[k]}</span>
            </label>
          </div>`;
      }).join('');
      const collapseId = `facet_${name}`;
      // Mark docType and status as open by default
      const isDefaultOpen = (name === 'docType' || name === 'status');
      return `
        <div class="accordion-item">
          <h2 class="accordion-header" id="hdr_${collapseId}">
            <button class="accordion-button${isDefaultOpen ? '' : ' collapsed'}" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="${isDefaultOpen}" aria-controls="${collapseId}">
              ${facetTitles[name] || name}
            </button>
          </h2>
          <div id="${collapseId}" class="accordion-collapse collapse${isDefaultOpen ? ' show' : ''}" aria-labelledby="hdr_${collapseId}">
            <div class="accordion-body p-2">
              <div class="facet-list">${items || '<div class="text-muted">none</div>'}</div>
            </div>
          </div>
        </div>`;
    };

    const sections = [
      ['publisher', facets.publisher, null],
      ['group', facets.group, facets.groupLabels],
      ['docType', facets.docType, null],
      ['status', facets.status, facets.statusLabels],
      ['keywords', facets.keywords, null],
      ['currentWork', facets.currentWork, null],
      ['hasDoi', facets.hasDoi, null],
      ['hasReleaseTag', facets.hasReleaseTag, null]
    ];

    const accHTML = `
      <div class="accordion" id="facetAcc">
        ${sections.map(([n,m,l]) => makeList(n,m,l)).join('')}
      </div>`;

    root.innerHTML = accHTML;

    // Mirror facets into the offcanvas body (one-time clone of HTML)
    const drawerBody = $('#facetDrawerBody');
    if (drawerBody) {
      const prefixIds = (html, pfx) => html
        // element ids
        .replace(/id="([^"]+)"/g, (m, id) => `id="${pfx}${id}"`)
        // label "for" → associated control id
        .replace(/for="([^"]+)"/g, (m, id) => `for="${pfx}${id}"`)
        // aria relationships
        .replace(/aria-controls="([^"]+)"/g, (m, id) => `aria-controls="${pfx}${id}"`)
        .replace(/aria-labelledby="([^"]+)"/g, (m, id) => `aria-labelledby="${pfx}${id}"`)
        // Bootstrap targets (accordion/collapse)
        .replace(/data-bs-target="#([^"]+)"/g, (m, id) => `data-bs-target="#${pfx}${id}"`)
        // Anchor hrefs that point to in-page ids
        .replace(/href="#([^"]+)"/g, (m, id) => `href="#${pfx}${id}"`);

      const accHTMLDrawer = prefixIds(accHTML, 'drawer_');
      drawerBody.innerHTML = accHTMLDrawer;
    }

    // Event delegation: handle checkbox changes from either container
    function onFacetChange(e){
      const cb = e.target;
      if (!(cb && cb.matches('input[type=checkbox][name]'))) return;
      const k = cb.name, v = cb.value;
      clearHashNoScroll();
      state.f[k] = state.f[k] || [];
      if (cb.checked) { if (!state.f[k].includes(v)) state.f[k].push(v); }
      else { state.f[k] = state.f[k].filter(x=>x!==v); }
      state.page = 1; updateURLAll(true); render();
      // keep the mirrored checkbox in sync
      const mirrorSel = `input[type=checkbox][name="${k}"][value="${CSS.escape(v)}"]`;
      document.querySelectorAll(mirrorSel).forEach(el => { if (el !== cb) el.checked = cb.checked; });
    }

    // Remove old listeners to avoid duplicates, then add fresh ones
    root.removeEventListener('change', onFacetChange);
    document.removeEventListener('change', onFacetChange, true);
    root.addEventListener('change', onFacetChange);
    if (drawerBody) drawerBody.addEventListener('change', onFacetChange);
  }

  // Render numbered page jumpers into #pageNums
  function renderPageNumbers(totalPages){
    const cont = document.querySelector('#pageNums');
    if (!cont) return;
    const p = state.page;
    const max = totalPages;
    const parts = [];
    const makeBtn = (label, page, {active=false, disabled=false}={}) => (
      `<button type="button" class="btn btn-outline-secondary btn-sm${active ? ' active' : ''}"`+
      `${disabled ? ' disabled' : ''} data-page="${page}" aria-label="Page ${label}">${label}</button>`
    );
    const addRange = (from, to) => { for (let i = from; i <= to; i++) parts.push(makeBtn(String(i), i, {active: i === p})); };

    if (max <= 7) {
      addRange(1, max);
    } else {
      addRange(1, 2); // first two
      const start = Math.max(3, p - 1);
      const end   = Math.min(max - 2, p + 1);
      if (start > 3) parts.push(makeBtn('…', p, {disabled:true}));
      addRange(start, end);
      if (end < max - 2) parts.push(makeBtn('…', p, {disabled:true}));
      addRange(max - 1, max); // last two
    }
    cont.innerHTML = parts.join('');
  }

  // Render numbered page jumpers into an arbitrary container (e.g., bottom pager)
  function renderPageNumbersInto(selector, totalPages){
    const cont = document.querySelector(selector);
    if (!cont) return;
    const p = state.page;
    const max = totalPages;
    const parts = [];
    const makeBtn = (label, page, {active=false, disabled=false}={}) => (
      `<button type="button" class="btn btn-outline-secondary btn-sm${active ? ' active' : ''}"`+
      `${disabled ? ' disabled' : ''} data-page="${page}" aria-label="Page ${label}">${label}</button>`
    );
    const addRange = (from, to) => { for (let i = from; i <= to; i++) parts.push(makeBtn(String(i), i, {active: i === p})); };

    if (max <= 7) {
      addRange(1, max);
    } else {
      addRange(1, 2); // first two
      const start = Math.max(3, p - 1);
      const end   = Math.min(max - 2, p + 1);
      if (start > 3) parts.push(makeBtn('…', p, {disabled:true}));
      addRange(start, end);
      if (end < max - 2) parts.push(makeBtn('…', p, {disabled:true}));
      addRange(max - 1, max); // last two
    }
    cont.innerHTML = parts.join('');
  }

  function render(){
    const rows = applyFilters();
    const total = idx.length;
    const filtered = rows.length;

    // clamp page
    const totalPages = Math.max(1, Math.ceil(filtered / state.size || 1));
    if (state.page > totalPages) state.page = totalPages;
    if (state.page < 1) state.page = 1;
    renderPageNumbers(totalPages);
    renderPageNumbersInto('#pageNumsBottom', totalPages);

    const startIdx = (state.page - 1) * state.size;      // 0-based
    const endIdx   = Math.min(startIdx + state.size, filtered); // exclusive
    const startHuman = filtered ? startIdx + 1 : 0;      // 1-based display
    const endHuman   = endIdx;

    // Results line
    const resultsLine = $('#resultsLine');
    if (resultsLine) {
      if (filtered === 0) {
        resultsLine.textContent = 'No documents found';
      } else if (filtered < total) {
        resultsLine.textContent = `Showing ${startHuman} to ${endHuman} of ${filtered} entries (filtered from ${total} total entries)`;
      } else {
        resultsLine.textContent = `Showing ${startHuman} to ${endHuman} of ${total} entries`;
      }
    }

    // Page meta + button states
    const pageMeta = $('#pageMeta');
    if (pageMeta) pageMeta.textContent = `Page ${filtered ? state.page : 1} of ${filtered ? totalPages : 1}`;
    const prevBtn = $('#prevPage'), nextBtn = $('#nextPage');
    const atFirst = state.page <= 1;
    const atLast  = state.page >= totalPages;
    if (prevBtn) prevBtn.disabled = atFirst || filtered === 0;
    if (nextBtn) nextBtn.disabled = atLast  || filtered === 0;

    // Bottom pager button states and meta
    const prevBtnB = $('#prevPageBottom');
    const nextBtnB = $('#nextPageBottom');
    if (prevBtnB) prevBtnB.disabled = atFirst || filtered === 0;
    if (nextBtnB) nextBtnB.disabled = atLast  || filtered === 0;

    const pageMetaB = $('#pageMetaBottom');
    if (pageMetaB) pageMetaB.textContent = `Page ${filtered ? state.page : 1} of ${filtered ? totalPages : 1}`;

    // Draw chips/summary
    renderActiveFilters();
    renderFilterSummary();

    // Slice page rows and render cards
    const pageRows = rows.slice(startIdx, endIdx);
    const tgt = $('#cards'); if (!tgt) return;
    tgt.innerHTML = pageRows.length
      ? pageRows.map(d => cardHTML(d)).join('')
      : '<div class="text-muted p-3">No results. Adjust filters or search.</div>';
  }
  // Pager click handler for numbered page jumpers
  const pager = document.querySelector('#pager');
  if (pager) pager.addEventListener('click', (e) => {
    const a = e.target.closest('[data-page]');
    if (!a) return;
    e.preventDefault();
    const n = parseInt(a.getAttribute('data-page'), 10);
    if (!Number.isFinite(n) || n < 1) return;
    if (n === state.page) return;
    clearHashNoScroll();
    state.page = n;
    updateURLAll(true);
    render();
  });

  // Bottom pager click handler
  const pagerBottom = document.querySelector('#pager-bottom');
  if (pagerBottom) pagerBottom.addEventListener('click', (e) => {
    const a = e.target.closest('[data-page]');
    if (!a) return;
    e.preventDefault();
    const n = parseInt(a.getAttribute('data-page'), 10);
    if (!Number.isFinite(n) || n < 1) return;
    if (n === state.page) return;
    clearHashNoScroll();
    state.page = n;
    updateURLAll(true);
    render();
  });

  // Keyboard navigation for pagination (ignored while typing in inputs)
  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.isComposing) return;
    if (e.key === 'ArrowLeft') {
      clearHashNoScroll();
      state.page = Math.max(1, state.page - 1);
      updateURLAll(true);
      render();
    } else if (e.key === 'ArrowRight') {
      clearHashNoScroll();
      state.page = state.page + 1; // clamped in render()
      updateURLAll(true);
      render();
    } else if (e.key === 'Home') {
      clearHashNoScroll();
      state.page = 1;
      updateURLAll(true);
      render();
    } else if (e.key === 'End') {
      clearHashNoScroll();
      state.page = 1e9; // effectively "last", clamped in render()
      updateURLAll(true);
      render();
    }
  });

  // Auto-hide bottom pager when the top pager is actually visible (not covered by sticky headers)
  (function(){
    const topPagerEl = document.querySelector('#pager');
    const bottomWrap = document.querySelector('#cards-main .sticky-bottom') || document.querySelector('.sticky-bottom');
    if (!bottomWrap) return; // nothing to control

    const headerSelectors = ['.navbar.sticky-top', '#cards-topbar'];
    function headerOffsetPx(){
      return headerSelectors.reduce((sum, sel) => {
        const el = document.querySelector(sel);
        if (!el) return sum;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const topPx = parseFloat(cs.top) || 0;
        const isAffixed = (cs.position === 'sticky' || cs.position === 'fixed');
        const isAtTop = isAffixed && (r.top <= topPx + 2);
        return sum + (isAtTop ? r.height : 0);
      }, 0);
    }

    function setHidden(hide){
      bottomWrap.style.display = hide ? 'none' : '';
    }

    function fallbackToggle(){
      if (!topPagerEl) { setHidden(false); return; }
      const r = topPagerEl.getBoundingClientRect();
      const offset = headerOffsetPx();
      const visible = (r.bottom > offset) && (r.top < window.innerHeight);
      setHidden(!!visible);
    }

    let io = null;
    function initObserver(){
      if (!topPagerEl || !('IntersectionObserver' in window)) return;
      const offset = headerOffsetPx();
      if (io) { io.disconnect(); io = null; }
      io = new IntersectionObserver((entries) => {
        for (const e of entries) setHidden(e.isIntersecting);
      }, { root: null, threshold: 0, rootMargin: `-${Math.max(0, Math.floor(offset))}px 0px 0px 0px` });
      io.observe(topPagerEl);
      // initial state using precise geometry
      fallbackToggle();
    }

    // init + listeners
    initObserver();
    if (!io) {
      window.addEventListener('scroll', fallbackToggle, { passive: true });
      window.addEventListener('resize', fallbackToggle);
      fallbackToggle();
    } else {
      window.addEventListener('resize', initObserver);
    }
  })();

  // Wire basics
  const q = $('#q');
  if (q) {
    const onSearchInput = (e) => {
      clearHashNoScroll();
      state.q = e.target.value;
      state.page = 1;
      updateURLAll(false); // replaceState while typing/clearing
      render();
    };
    q.addEventListener('input', onSearchInput);
    q.addEventListener('search', onSearchInput); // Safari/Chrome clear (Ⓧ) emits 'search'
    q.addEventListener('change', onSearchInput); // commit on blur/enter
  }
  const sort = $('#sort');
  if (sort) sort.addEventListener('change', e => {
    clearHashNoScroll();
    state.sort = e.target.value;
    state.page = 1;
    updateURLAll(true);
    render();
  });

  // Page size selector
  const pageSizeSel = $('#pageSize');
  if (pageSizeSel) {
    pageSizeSel.addEventListener('change', e => {
      clearHashNoScroll();
      const n = parseInt(e.target.value, 10);
      state.size = Number.isFinite(n) && n > 0 ? n : 40;
      state.page = 1;
      updateURLAll(true);
      render();
    });
  }

  // Year selector
  const yearSel = document.querySelector('#yearSelect');
  if (yearSel) {
    yearSel.addEventListener('change', e => {
      clearHashNoScroll();
      const v = String(e.target.value || '');
      if (!v) {
        delete state.f.year;
      } else {
        state.f.year = [v];
      }
      state.page = 1;
      updateURLAll(true);
      render();
    });
  }

  // Prev/Next
  const prevBtn = $('#prevPage');
  const nextBtn = '#nextPage' && $('#nextPage');

  if (prevBtn) prevBtn.addEventListener('click', () => {
    clearHashNoScroll();
    state.page = Math.max(1, state.page - 1);
    updateURLAll(true);
    render();
  });
  if (nextBtn) nextBtn.addEventListener('click', () => {
    // totalPages will be clamped in render(), so a quick render is fine
    clearHashNoScroll();
    state.page = state.page + 1;
    updateURLAll(true);
    render();
  });

  // Bottom Prev/Next
  const prevBtnBottom = $('#prevPageBottom');
  const nextBtnBottom = $('#nextPageBottom');
  if (prevBtnBottom) prevBtnBottom.addEventListener('click', () => {
    state.page = Math.max(1, state.page - 1);
    clearHashNoScroll();
    updateURLAll(true);
    render();
  });
  if (nextBtnBottom) nextBtnBottom.addEventListener('click', () => {
    state.page = state.page + 1; // clamp in render()
    clearHashNoScroll();
    updateURLAll(true);
    render();
  });

  // Initialize page/size from URL, then normalize URL once
  initPageSizeFromURL();
  initFiltersFromURL();
  initSearchFromURL();
  initSortFromURL();
  installSearchTips();
  updateURLAll(false);
  syncPageSizeSelectFromState();
  populateYearSelect();
  syncYearSelectFromState();
  // Initialize deep-linking via #id (returns true if it rendered due to hash)
  _initialDeepLinked = initHashDeepLink();

  // Back/forward navigation sync
  window.addEventListener('popstate', () => {
    initPageSizeFromURL();
    initFiltersFromURL();
    initSearchFromURL();
    initSortFromURL();
    syncPageSizeSelectFromState();
    syncYearSelectFromState();
    render();
    installSearchTips();
  });

  // Kickoff
  renderFacets();
  if (!_initialDeepLinked) {
    render();
  }
})();