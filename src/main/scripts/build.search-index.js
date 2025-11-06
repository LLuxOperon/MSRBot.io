#!/usr/bin/env node
/**
 * Build a minimal, 1‑to‑1 search index directly from documents.json
 * plus friendly joins from groups.json/projects.json. No parallel truth;
 * all display fields derive from canonical registry fields.
 *
 * Output:
 *   build/docs/search-index.json  — flat rows for cards + client search
 *   build/docs/facets.json        — precomputed facet counts + labels
 */

const fs = require('fs').promises;
const path = require('path');

const REG_DEFAULT = path.join('src','main','data','documents.json');
const GROUPS = path.join('src','main','data','groups.json');
const PROJECTS = path.join('src','main','data','projects.json');
const OUT = 'build/docs';
const DATA_OUT = path.join(OUT, '_data');
const IDX = path.join(DATA_OUT, 'search-index.json');
const FAC = path.join(DATA_OUT, 'facets.json');
const SYN = path.join('src','main','lib','synonyms.json'); // optional

/** Optional override: accept docs JSON path via argv[2] */
const DOCS_PATH = (process.argv[2] && String(process.argv[2]).trim()) || REG_DEFAULT;


/** Parse full ISO date → timestamp (or null) without throwing */
function toTs(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const t = Date.parse(dateStr);
  return Number.isNaN(t) ? null : t;
}

/** Compact/clean string helpers */
const compact = s => String(s || '').trim();
const squash = s => compact(s).replace(/\s+/g, ' ');

/** Build */
(async () => {
  const [docsRaw, groupsRaw, projectsRaw] = await Promise.all([
    fs.readFile(DOCS_PATH, 'utf8').catch(() => '[]'),
    fs.readFile(GROUPS, 'utf8').catch(() => '[]'),
    fs.readFile(PROJECTS, 'utf8').catch(() => '[]'),
  ]);

  /** Canonical sources */
  const docs = JSON.parse(docsRaw);
  const groups = JSON.parse(groupsRaw);
  const projects = JSON.parse(projectsRaw);

  await fs.mkdir(OUT, { recursive: true });
  await fs.mkdir(DATA_OUT, { recursive: true });

  /** Reverse-lookup: docId → [groupIds] (from groups.json) */
  const groupsByDoc = new Map();
  for (const g of Array.isArray(groups) ? groups : []) {
    const list = Array.isArray(g.docs) ? g.docs
               : Array.isArray(g.documents) ? g.documents : [];
    for (const did of list) {
      if (!did) continue;
      const arr = groupsByDoc.get(did) || [];
      const gid = g.groupId || g.id || g.name;
      if (gid && !arr.includes(gid)) arr.push(gid);
      groupsByDoc.set(did, arr);
    }
  }

  /** GroupId → Friendly label: "org name desc" (squashed) */
  const groupNameById = new Map();
  for (const g of Array.isArray(groups) ? groups : []) {
    const gid = g.groupId || g.id || g.name;
    if (!gid) continue;
    const parts = [g.groupOrg, g.groupName || g.name || gid, g.groupDesc]
      .map(squash)
      .filter(Boolean);
    const full = parts.join(' ');
    groupNameById.set(gid, full || String(gid));
  }

  /** currentWork join from projects.json and workInfo.review */
  const workByDoc = new Map();
  function pushWork(did, label){
    if (!did || !label) return;
    const arr = workByDoc.get(did) || [];
    if (!arr.includes(label)) arr.push(label);
    workByDoc.set(did, arr);
  }

  for (const p of Array.isArray(projects) ? projects : []) {
    const wt = p.workType;
    const ps = p.projectStatus;
    const label = [wt, ps].filter(Boolean).join(' - ');
    if (p.docId && label) pushWork(p.docId, label);
    const affected = Array.isArray(p.docAffected) ? p.docAffected : [];
    for (const did of affected) pushWork(did, label);
  }

  /** Build the flat, minimal index strictly from canonical doc fields */
  const idx = [];
  for (const d of Array.isArray(docs) ? docs : []) {
    if (!d || !d.docId) continue;

    const label = d.docLabel;
    const title = d.docTitle;

    // Status: derive canonical booleans, then emit an array of all true flags
    const st = (d.status && typeof d.status === 'object') ? d.status : {};
    const statusFlags = {
      active: !!st.active,
      latestVersion: !!st.latestVersion,
      superseded: !!st.superseded,
      withdrawn: !!st.withdrawn,
      draft: !!st.draft,
      stabilized: !!st.stabilized,
      reaffirmed: !!st.reaffirmed,
      amended: !!st.amended,
      versionless: !!st.versionless
    };
    // Guardrails: normalize implied relationships
    if (statusFlags.latestVersion) {
      statusFlags.active = true;
      statusFlags.superseded = false;
      statusFlags.withdrawn = false;
    }
    if (statusFlags.withdrawn) {
      statusFlags.active = false;
      statusFlags.latestVersion = false;
      statusFlags.superseded = false;
    }
    // Emit "status" as an array of every true flag; no primary/singleton
    const status = Object.entries(statusFlags)
      .filter(([, v]) => v === true)
      .map(([k]) => k);
    if (!status.length) status.push('unknown');

    // Publication dating (full string + parsed timestamp + year)
    const pubDate = d.publicationDate || '';
    const pubTs = toTs(pubDate);
    const year = /^\d{4}/.test(pubDate) ? parseInt(pubDate.slice(0,4), 10) : null;

    // Group membership: prefer doc.group; fallback to groups.json reverse index
    let group = [];
    if (Array.isArray(d.group)) group = d.group.filter(Boolean);
    else if (d.group) group = [d.group];
    else group = groupsByDoc.get(d.docId) || [];
    const groupNames = group.map(gid => groupNameById.get(gid) || gid);

    // Current work from projects + reviewNeeded flags
    const currentWork = (workByDoc.get(d.docId) || []).slice();
    const works = d.workInfo || {};
    if (works && works.review && Array.isArray(works.review)) {
      for (const r of works.review) {
        const rP = r && r.reviewPeriod;
        const rN = r && r.reviewNeeded;
        if (rN === true && rP) currentWork.push(`${rP} Review Needed`);
      }
    }
    const hasCurrentWork = currentWork.length > 0;

    // Keywords:
    // - facetKeywords: from canonical d.keywords array (for filtering)
    // - searchKeywords: assembled terms for free-text search
    const facetKeywords = Array.isArray(d.keywords) ? d.keywords.map(squash).filter(Boolean) : [];
    const searchKeywords = Array.from(new Set([
      d.docId,
      title,
      d.docTitle,
      d.docLabel,
      ...(Array.isArray(currentWork) ? currentWork : [])
    ].filter(Boolean).map(squash)));

    // Minimal row — 1‑to‑1 with canonical where applicable
    idx.push({
      id: d.docId,
      title,                 // display title for cards
      label,                 // canonical label (useful for details view)
      publisher: d.publisher || 'Unknown',
      docType: d.docType,                  // required field
      docTypeAbr: d.docTypeAbr || null,    // optional abbreviation (e.g., ST, RP)
      status,                // array of all true flags (no primary)
      statusFlags,           // canonical booleans
      pubDate,               // full canonical date
      pubTs,                 // parsed timestamp for sort
      year,
      hasDoi: Boolean(d.doi),
      hasReleaseTag: Boolean(d.releaseTag),
      group,
      groupNames,
      currentWork,
      hasCurrentWork,
      keywords: facetKeywords,        // facet values (from documents.json)
      keywordsSearch: searchKeywords, // assembled search tokens
      href: d.href || null,
      doi: d.doi || null
    });
  }

  /** Build facet counts (using the flat index) */
  const facets = {
    publisher: {},
    group: {},
    docType: {},
    status: {},
    statusLabels: {
      active: "Active",
      latestVersion: "Latest Version",
      superseded: "Superseded",
      withdrawn: "Withdrawn",
      draft: "Draft",
      stabilized: "Stabilized",
      reaffirmed: "Reaffirmed",
      amended: "Amended",
      versionless: "Versionless",
      unknown: "Unknown"
    },
    year: {},
    currentWork: {},
    keywords: {},
    hasDoi: { true: 0, false: 0 },
    hasReleaseTag: { true: 0, false: 0 },
    groupLabels: Object.fromEntries(Array.from(groupNameById.entries()))
  };

  for (const r of idx) {
    facets.publisher[r.publisher] = (facets.publisher[r.publisher] || 0) + 1;
    if (Array.isArray(r.group)) {
      for (const g of r.group) {
        if (!g) continue;
        facets.group[g] = (facets.group[g] || 0) + 1;
      }
    }
    facets.docType[r.docType] = (facets.docType[r.docType] || 0) + 1;
    if (Array.isArray(r.status) && r.status.length) {
      for (const s of r.status) {
        facets.status[s] = (facets.status[s] || 0) + 1;
      }
    } else {
      const s = r.status || 'unknown';
      facets.status[s] = (facets.status[s] || 0) + 1;
    }
    if (r.year != null) facets.year[r.year] = (facets.year[r.year] || 0) + 1;
    if (Array.isArray(r.currentWork)) {
      for (const w of r.currentWork) {
        const key = String(w).trim();
        if (!key) continue;
        facets.currentWork[key] = (facets.currentWork[key] || 0) + 1;
      }
    }
    if (Array.isArray(r.keywords)) {
      for (const k of r.keywords) {
        const key = String(k).trim();
        if (!key) continue;
        facets.keywords[key] = (facets.keywords[key] || 0) + 1;
      }
    }
    facets.hasDoi[String(r.hasDoi)]++;
    facets.hasReleaseTag[String(r.hasReleaseTag)]++;
  }

  /** Optional assets: synonyms + MiniSearch UMD for client */
  try {
    // Copy synonyms.json if present
    const synRaw = await fs.readFile(SYN, 'utf8').catch(() => null);
    if (synRaw) {
      await fs.writeFile(path.join(DATA_OUT, 'synonyms.json'), synRaw, 'utf8');
    }
  } catch (e) {
    console.warn('[cards] No synonyms.json found (optional):', e && e.message ? e.message : e);
  }
  // --- MiniSearch UMD: ensure a browser-usable bundle is available under build/docs/minisearch/umd/index.min.js ---
  try {
    const https = require('https');
    const destDir = path.join(OUT, 'minisearch', 'umd');
    const destUmd = path.join(destDir, 'index.min.js');
    await fs.mkdir(destDir, { recursive: true });

    async function pathExists(p){
      try { await fs.stat(p); return true; } catch { return false; }
    }
    async function fetchToFile(url, outFile){
      await fs.mkdir(path.dirname(outFile), { recursive: true });
      await new Promise((resolve, reject) => {
        https.get(url, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            // follow redirects
            return fetchToFile(res.headers.location, outFile).then(resolve, reject);
          }
          if (res.statusCode !== 200) return reject(new Error(`GET ${url} -> ${res.statusCode}`));
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', async () => {
            try {
              const buf = Buffer.concat(chunks);
              await fs.writeFile(outFile, buf);
              resolve();
            } catch (e) { reject(e); }
          });
        }).on('error', reject);
      });
    }

    // Prefer a locally installed UMD if present
    const localUmd = path.join('node_modules', 'minisearch', 'dist', 'umd', 'index.min.js');
    if (await pathExists(localUmd)) {
      const data = await fs.readFile(localUmd);
      await fs.writeFile(destUmd, data);
    } else {
      // Fallback to CDN
      try {
        await fetchToFile('https://cdn.jsdelivr.net/npm/minisearch/dist/umd/index.min.js', destUmd);
      } catch {
        await fetchToFile('https://unpkg.com/minisearch/dist/umd/index.min.js', destUmd);
      }
    }
  } catch (e) {
    console.warn('[cards] Could not acquire MiniSearch UMD (local or CDN):', e && e.message ? e.message : e);
    console.warn('[cards] Search will fall back to plain includes() if MiniSearch cannot be loaded.');
  }

  /** Write outputs */
  await fs.writeFile(IDX, JSON.stringify(idx, null, 2), 'utf8');
  await fs.writeFile(FAC, JSON.stringify(facets, null, 2), 'utf8');
  console.log(`[cards] Wrote ${IDX} (${idx.length} docs), ${FAC}`);
})().catch(err => {
  console.error('[cards] Index build failed:', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});