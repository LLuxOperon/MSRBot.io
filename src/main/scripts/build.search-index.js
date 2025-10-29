#!/usr/bin/env node
/**
 * Build a minimal, 1‑to‑1 search index directly from documents.json
 * plus friendly joins from groups.json/projects.json. No parallel truth;
 * all display fields derive from canonical registry fields.
 *
 * Output:
 *   build/cards/search-index.json  — flat rows for cards + client search
 *   build/cards/facets.json        — precomputed facet counts + labels
 */

const fs = require('fs').promises;
const path = require('path');

const REG = path.join('src','main','data','documents.json');
const GROUPS = path.join('src','main','data','groups.json');
const PROJECTS = path.join('src','main','data','projects.json');
const OUT = 'build/cards';
const IDX = path.join(OUT, 'search-index.json');
const FAC = path.join(OUT, 'facets.json');

/** Normalize status to a facet bucket, but keep raw flags for 1‑1 use */
function statusFacet(st) {
  if (!st || typeof st !== 'object') return 'unknown';
  if (st.withdrawn) return 'withdrawn';
  if (st.superseded) return 'superseded';
  if (st.active && st.latestVersion) return 'latest';
  if (st.active) return 'active';
  if (st.draft) return 'draft';
  return 'unknown';
}

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
    fs.readFile(REG, 'utf8').catch(() => '[]'),
    fs.readFile(GROUPS, 'utf8').catch(() => '[]'),
    fs.readFile(PROJECTS, 'utf8').catch(() => '[]'),
  ]);

  /** Canonical sources */
  const docs = JSON.parse(docsRaw);
  const groups = JSON.parse(groupsRaw);
  const projects = JSON.parse(projectsRaw);

  await fs.mkdir(OUT, { recursive: true });

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

    // Status: keep canonical flags for UI; compute a facet bucket for filtering
    const st = (d.status && typeof d.status === 'object') ? d.status : {};
    const status = statusFacet(st);
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
    // Compute statuses array and statusPrimary (legacy single value)
    const statuses = Object.entries(statusFlags)
      .filter(([k,v]) => v)
      .map(([k]) => k);
    const statusPrimary = status; // keep old single-value under a new name

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

    // Keywords: keep simple, dedup
    const kw = Array.from(new Set([d.docId, title, d.docTitle, d.docLabel].filter(Boolean)));

    // Minimal row — 1‑to‑1 with canonical where applicable
    idx.push({
      id: d.docId,
      title,                 // display title for cards
      label,                 // canonical label (useful for details view)
      publisher: d.publisher || 'Unknown',
      docType: d.docTypeAbr || d.docType || 'Unknown',
      status,                // legacy single-value bucket (back-compat)
      statusPrimary,         // explicit primary bucket
      statuses,              // all true flags
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
      keywords: kw,
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
    year: {},
    hasCurrentWork: { true: 0, false: 0 },
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
    facets.status[r.status] = (facets.status[r.status] || 0) + 1;
    if (r.year != null) facets.year[r.year] = (facets.year[r.year] || 0) + 1;
    facets.hasCurrentWork[String(r.hasCurrentWork)]++;
    facets.hasDoi[String(r.hasDoi)]++;
    facets.hasReleaseTag[String(r.hasReleaseTag)]++;
  }

  /** Write outputs */
  await fs.writeFile(IDX, JSON.stringify(idx, null, 2), 'utf8');
  await fs.writeFile(FAC, JSON.stringify(facets, null, 2), 'utf8');
  console.log(`[cards] Wrote ${IDX} (${idx.length} docs), ${FAC}`);
})().catch(err => {
  console.error('[cards] Index build failed:', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});