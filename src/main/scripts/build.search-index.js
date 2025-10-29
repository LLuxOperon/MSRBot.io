#!/usr/bin/env node
const fs = require('fs').promises;
const path = require('path');

const REG = path.join('src','main','data','documents.json');
const GROUPS = path.join('src','main','data','groups.json');
const PROJECTS = path.join('src','main','data','projects.json');
const OUT = 'build/cards';
const IDX = path.join(OUT, 'search-index.json');
const FAC = path.join(OUT, 'facets.json');

function statusFacet(st) {
  if (!st || typeof st !== 'object') return 'unknown';
  if (st.superseded) return 'superseded';
  if (st.withdrawn) return 'withdrawn';
  if (st.latestVersion && st.active) return 'latest';
  if (st.active) return 'active';
  return 'unknown';
}

(async () => {
  const [docsRaw, groupsRaw, projectsRaw] = await Promise.all([
    fs.readFile(REG, 'utf8').catch(()=> '[]'),
    fs.readFile(GROUPS, 'utf8').catch(()=> '[]'),
    fs.readFile(PROJECTS, 'utf8').catch(()=> '[]'),
  ]);

  const docs = JSON.parse(docsRaw);
  const groups = JSON.parse(groupsRaw);
  const projects = JSON.parse(projectsRaw);

  await fs.mkdir(OUT, { recursive: true });

  // Build reverse lookups: docId -> [groupIds]
  const groupsByDoc = new Map();
  for (const g of Array.isArray(groups) ? groups : []) {
    const list = Array.isArray(g.docs) ? g.docs
               : Array.isArray(g.documents) ? g.documents : [];
    for (const did of list) {
      if (!did) continue;
      const arr = groupsByDoc.get(did) || [];
      const gid = g.groupId || g.name || g.id;
      if (gid && !arr.includes(gid)) arr.push(gid);
      groupsByDoc.set(did, arr);
    }
  }

  // Project/work joins (lightweight; mirrors build.js behavior)
  const workByDoc = new Map();
  function pushWork(did, label){
    if (!did || !label) return;
    const arr = workByDoc.get(did) || [];
    if (!arr.includes(label)) arr.push(label);
    workByDoc.set(did, arr);
  }

  for (const p of Array.isArray(projects) ? projects : []) {
    const primaryDoc = p.docId;
    const workType = p.workType;
    const projectStatus = p.projectStatus;
    if (primaryDoc && (workType || projectStatus)) {
      pushWork(primaryDoc, `${workType||''}${workType&&projectStatus?' - ':''}${projectStatus||''}`.trim());
    }
    const affected = Array.isArray(p.docAffected) ? p.docAffected : [];
    for (const did of affected) {
      pushWork(did, `${workType||''}${workType&&projectStatus?' - ':''}${projectStatus||''}`.trim());
    }
  }

  // Build groupId → full label (groupOrg groupName groupDesc) for groupNames mapping
  const groupNameById = new Map();
  const compact = s => String(s || '').trim();
  const squash = s => compact(s).replace(/\s+/g, ' ');
  for (const g of Array.isArray(groups) ? groups : []) {
    const gid = g.groupId || g.id || g.name;
    if (!gid) continue;
    const parts = [g.groupOrg, g.groupName || g.name || gid, g.groupDesc]
      .map(squash)
      .filter(Boolean);
    const full = parts.join(' ');
    groupNameById.set(gid, full || String(gid));
  }

  // Build index rows
  const idx = docs.map(d => {
    const title = (d.docType === 'Journal Article' || d.docType === 'White Paper' || d.docType === 'Book' || d.docType === 'Guideline' || d.docType === 'Registry')
      ? d.docTitle : d.docLabel;
    const pubDate = d.publicationDate || '';
    const year = /^\d{4}/.test(pubDate) ? parseInt(pubDate.slice(0,4), 10) : null;
    const pubTs = (() => { const t = Date.parse(pubDate); return Number.isNaN(t) ? null : t; })();
    const status = statusFacet(d.status);

    // groups for this doc — prefer group(s) stored on the document itself; fallback to groups.json lookup
    let group = [];
    if (Array.isArray(d.group)) {
      group = d.group.filter(Boolean);
    } else if (d.group) {
      group = [d.group];
    } else {
      group = groupsByDoc.get(d.docId) || [];
    }
    // Map group IDs to group names using groups.json
    const groupNames = group.map(gid => groupNameById.get(gid) || gid);

    // currentWork join + workInfo(reviewNeeded)
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

    return {
      id: d.docId,
      title: title || d.docId,
      publisher: d.publisher || 'Unknown',
      docType: d.docTypeAbr || d.docType || 'Unknown',
      status,
      pubDate,
      pubTs,
      year,
      hasDoi: Boolean(d.doi),
      hasReleaseTag: Boolean(d.releaseTag),
      group,
      groupNames,
      currentWork,
      hasCurrentWork,
      keywords: [d.docId, title].filter(Boolean),
      href: d.href || null,
      doi: d.doi || null
    };
  });

  // facet counts
  const facets = {
    publisher: {},
    group: {},
    docType: {},
    status: {},
    year: {},
    hasCurrentWork: { true: 0, false: 0 },
    hasDoi: { true: 0, false: 0 },
    hasReleaseTag: { true: 0, false: 0 }
  };

    // Pre-seed groupLabels (id → friendly name) so the UI can display names in facet lists
  facets.groupLabels = Object.fromEntries(Array.from(groupNameById.entries()));

  for (const r of idx) {
    facets.publisher[r.publisher] = (facets.publisher[r.publisher]||0)+1;
    if (Array.isArray(r.group)) for (const g of r.group) {
      if (!g) continue; facets.group[g] = (facets.group[g]||0)+1;
    }
    facets.docType[r.docType] = (facets.docType[r.docType]||0)+1;
    facets.status[r.status] = (facets.status[r.status]||0)+1;
    if (r.year != null) facets.year[r.year] = (facets.year[r.year]||0)+1;
    facets.hasCurrentWork[String(r.hasCurrentWork)]++;
    facets.hasDoi[String(r.hasDoi)]++;
    facets.hasReleaseTag[String(r.hasReleaseTag)]++;
  }

  await fs.writeFile(IDX, JSON.stringify(idx, null, 2), 'utf8');
  await fs.writeFile(FAC, JSON.stringify(facets, null, 2), 'utf8');
  console.log(`[cards] Wrote ${IDX} (${idx.length} docs), ${FAC}`);
})();