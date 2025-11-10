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

/* pass the option  */

const path = require('path');
const fs = require('fs').promises;
const { promisify } = require('util');
const execFile = promisify(require('child_process').execFile);


const hb = require('handlebars');
// Server-side helper to pass through raw blocks used to embed client-side templates
hb.registerHelper('raw', function(options) {
  return new hb.SafeString(options.fn(this));
});
// Minimal shared keying import for MSI lineage lookups
const keying = require('../lib/keying');
const { lineageKeyFromDoc, lineageKeyFromDocId } = keying;


const REGISTRIES_REPO_PATH = "src/main";
const SITE_PATH = "src/site";
const BUILD_PATH = "build";

// --- Site config used for meta and structured data (single source of truth: src/main/config/site.json)
let siteConfig = null;
async function loadSiteConfig() {
  try {
    const cfgRaw = await fs.readFile(path.join('src','main','config','site.json'), 'utf8');
    const cfg = JSON.parse(cfgRaw);
    siteConfig = cfg;
  } catch (e) {
    console.error('[build] FATAL: site config missing or invalid at src/main/config/site.json');
    console.error('[build] Create the file with keys: { "siteName", "siteDescription", "canonicalBase" }');
    throw e;
  }
  // Allow environment overrides (e.g., staging)
  if (process.env.SITE_CANONICAL_BASE) siteConfig.canonicalBase = process.env.SITE_CANONICAL_BASE;
  if (process.env.SITE_NAME) siteConfig.siteName = process.env.SITE_NAME;
  if (process.env.SITE_DESCRIPTION) siteConfig.siteDescription = process.env.SITE_DESCRIPTION;
}

// Recursively copy directories/files (promises API)
async function copyRecursive(src, dest) {
  const stat = await fs.lstat(src);
  if (stat.isDirectory()) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src);
    for (const name of entries) {
      const from = path.join(src, name);
      const to = path.join(dest, name);
      await copyRecursive(from, to);
    }
  } else {
    // ensure parent exists (defensive for nested files)
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
  }
}

// Warn once per process for empty MSI
let __msiWarnedEmpty = false;
const { readFile, writeFile } = require('fs').promises;
const { json2csvAsync } = require('json-2-csv');

/* list the available registries type (lower case), id (single, for links), titles (Upper Case), and schema builds */

const registries = [
  {
    "listType": "documents",
    "templateType": "documents",
    "templateName": "documents",
    "idType": "document",
    "listTitle": "Documents",
    "subRegistry": [
      "groups",
      "projects"
    ]
  },
  {
    "listType": "documents",
    "templateType": "documents",
    "templateName": "dependancies",
    "idType": "document",
    "listTitle": "Ref Tree",
    "subRegistry": [
      "documents",
      "groups",
      "projects"
    ]
  },
  {
    "listType": "projects",
    "templateType": "projects",
    "templateName": "projects",
    "idType": "project",
    "listTitle": "Projects",
    "subRegistry": [
      "groups",
      "documents"
    ]
  },
  {
    "listType": "groups",
    "templateType": "groups",
    "templateName": "groups",
    "idType": "group",
    "listTitle": "Groups",
    "subRegistry": [
      "projects",
      "documents"
    ]
  }
]

/* load and build the templates */

async function buildRegistry ({ listType, templateType, templateName, idType, listTitle, subRegistry, output, extras }) {
  console.log(`Building ${templateName} started`)

  var DATA_PATH = path.join(REGISTRIES_REPO_PATH, "data/" + listType + ".json");
  var TEMPLATE_PATH = "src/main/templates/" + templateName + ".hbs";
  var PAGE_SITE_PATH
  if (output) {
    PAGE_SITE_PATH = output;
  } else if (templateName == "index") {
    PAGE_SITE_PATH = templateName + ".html";
  } else {
    PAGE_SITE_PATH = templateName + "/index.html";
  }

  // Build canonical URL for this page
  // "index.html" should canonicalize to root "/"
  const pagePathForCanonical = (PAGE_SITE_PATH === 'index.html') ? '/' : `/${PAGE_SITE_PATH}`;
  const canonicalUrl = new URL(pagePathForCanonical, siteConfig.canonicalBase).href;
  // OG defaults (fallbacks) for pages that don't set them explicitly
  const ogTitle = (listTitle ? `${listTitle} — ${siteConfig.siteName}` : siteConfig.siteName);
  const ogDescription = siteConfig.siteDescription;
  const ogImage = new URL(siteConfig.ogImage, siteConfig.canonicalBase).href;
  const ogImageAlt = siteConfig.ogImageAlt;
  // Asset prefix for relative local assets in header/footer
  const assetPrefix = '../';
  var CSV_SITE_PATH = templateType + ".csv";
  const inputFileName = DATA_PATH;
  const outputFileName = BUILD_PATH + "/" + CSV_SITE_PATH;

  /* load header and footer for templates */
  hb.registerPartial('header', await fs.readFile("src/main/templates/partials/header.hbs", 'utf8'));
  hb.registerPartial('footer', await fs.readFile("src/main/templates/partials/footer.hbs", 'utf8'));

  /* instantiate template */
  let template = hb.compile(
    await fs.readFile(
      TEMPLATE_PATH,
      'utf8'
    )
  );
  
  if (!template) {
    throw "Cannot load HTML template";
  }

  /* if Conditional helpers */

  hb.registerHelper('ifeq', function (a, b, options) {
    if (a == b) { 
      return options.fn(this); 
    }
    return options.inverse(this);
  });

  hb.registerHelper('ifactive', function (a, b, options) {
      return a + '-' + b
  });

  hb.registerHelper('ifnoteq', function (a, b, options) {
    if (a !== b) { 
      return options.fn(this); 
    }
    return options.inverse(this);
  });

  hb.registerHelper('ifinc', function (a, b, options) {
    if (a.includes(b)) { 
      return options.fn(this); 
    }
    return options.inverse(this);
  });

  // Returns the length of arrays/strings, or the number of keys for objects
  hb.registerHelper('len', function (val) {
    if (Array.isArray(val)) return val.length;
    if (typeof val === 'string') return val.length;
    if (val && typeof val === 'object') return Object.keys(val).length;
    return 0;
  });

  // Helper to ensure a value is always an array
  hb.registerHelper('asArray', function (val) {
    if (Array.isArray(val)) return val;
    if (val == null) return [];
    return [val];
  });

  // Render a human-friendly label from a lineage key like "ISO||15444|1" → "ISO 15444-1"
  hb.registerHelper('formatLineageKey', function(key) {
    if (!key || typeof key !== 'string') return '';
    const [pub = '', suite = '', number = '', part = ''] = key.split('|');
    let out = pub || '';
    if (suite) out += (out ? ' ' : '') + suite;
    if (number) out += (out ? ' ' : '') + number + (part ? `-${part}` : '');
    return out.trim();
  });
  
  // --- Load registries (data only). 
  let registryDocument = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
  // Fast lookup of existing docIds in the current registry — used to short-circuit MSI ref upgrades
  const __docIdSet = new Set(Array.isArray(registryDocument) ? registryDocument.map(d => d && d.docId).filter(Boolean) : []);
  let registryGroup = [];
  let registryProject = [];

  // Load any declared sub-registries if their data files exist
  // Keep separate arrays so templates can always access the full documents/groups/projects sets,
  // regardless of what the primary listType is for this build.
  let registryDocsAll = null;
  for (const sub of subRegistry) {
    const subDataPath = path.join(REGISTRIES_REPO_PATH, `data/${sub}.json`);
    try {
      const subData = JSON.parse(await fs.readFile(subDataPath, 'utf8'));
      if (sub === 'groups')   registryGroup = subData;
      if (sub === 'projects') registryProject = subData;
      if (sub === 'documents') registryDocsAll = subData;
    } catch (err) {
      console.warn(`[WARN] Could not load data for sub-registry "${sub}" at ${subDataPath}: ${err.message}`);
    }
  }

  // --- Load MasterSuiteIndex (MSI) once and build a lineage → latest lookup
  const MSI_PATH = path.join(REGISTRIES_REPO_PATH, 'reports/masterSuiteIndex.json');
  let __msiLatestByLineage = null;
  let __msiParsed = null; // cache to avoid re-reading the file
  try {
    const msiRaw = await fs.readFile(MSI_PATH, 'utf8');
    __msiParsed = JSON.parse(msiRaw);
    if (__msiParsed && Array.isArray(__msiParsed.lineages)) {
      __msiLatestByLineage = new Map(
        __msiParsed.lineages
          .filter(li => li && typeof li.key === 'string')
          .map(li => [li.key, { latestAnyId: li.latestAnyId || null, latestBaseId: li.latestBaseId || null }])
      );
    }
  } catch (e) {
    if (!__msiWarnedEmpty) {
      console.warn(`[WARN] Could not load MSI at ${MSI_PATH}: ${e.message}`);
      __msiWarnedEmpty = true;
    }
  }

  // Build a base-id → { lineageKey, latestBaseId, latestAnyId } index from MSI for undated ref resolution
  let __msiBaseIndex = null;
  if (__msiLatestByLineage) {
    __msiBaseIndex = new Map();
    const TAIL_RE = /\.(?:\d{4}(?:-\d{2}){0,2}|\d{8})(?:[A-Za-z0-9].*)?$/;
    const safeBase = (id) => (typeof id === 'string') ? id.replace(TAIL_RE, '') : id;

    try {
      const msi = __msiParsed;
      if (msi && Array.isArray(msi.lineages)) {
        for (const li of msi.lineages) {
          if (!li || !li.key || !Array.isArray(li.docs)) continue;
          const latestBaseId = li.latestBaseId || null;
          const latestAnyId  = li.latestAnyId  || null;
          const payload = { lineageKey: li.key, latestBaseId, latestAnyId };

          // Index bases for every doc in the lineage
          for (const d of li.docs) {
            const base = safeBase(d && d.docId);
            if (base) __msiBaseIndex.set(base, payload);
          }
          // Also ensure bases for latest ids are present (belt-and-suspenders)
          if (latestBaseId) __msiBaseIndex.set(safeBase(latestBaseId), payload);
          if (latestAnyId)  __msiBaseIndex.set(safeBase(latestAnyId),  payload);
        }
      }
    } catch (e) {
      if (!__msiWarnedEmpty) {
        console.warn(`[WARN] Could not rebuild MSI baseIndex: ${e.message}`);
        __msiWarnedEmpty = true;
      }
    }
  }

  // --- Annotate each document with MSI latest flags (no rewrites)
  // Utility to render a human-friendly label from a lineage key
  const labelFromLineageKey = (key) => {
    if (!key || typeof key !== 'string') return '';
    const [pub = '', suite = '', number = '', part = ''] = key.split('|');
    let out = pub || '';
    if (suite) out += (out ? ' ' : '') + suite;
    if (number) out += (out ? ' ' : '') + number + (part ? `-${part}` : '');
    return out.trim();
  };
  if (__msiLatestByLineage) {
    for (const doc of registryDocument) {
      if (!doc || !doc.docId) continue;
      const key = lineageKeyFromDoc(doc);
      if (!key) continue;
      const li = __msiLatestByLineage.get(key);
      if (!li) continue;
      const { latestAnyId, latestBaseId } = li;
      // expose read-only annotations for templates/consumers
      doc.msiLatestAny = latestAnyId || null;
      doc.msiLatestBase = latestBaseId || null;
      doc.isLatestAny = latestAnyId ? (doc.docId === latestAnyId) : false;
      doc.docBase = key
      doc.docBaseLabel = labelFromLineageKey(key);
      // Ensure a status object exists
      doc.status = doc.status && typeof doc.status === 'object' ? doc.status : {};
      // Update nested status flag rather than top-level field
      doc.status.latestVersion = !!doc.isLatestAny;
      doc.isLatestBase = latestBaseId ? (doc.docId === latestBaseId) : false;
    }
  }

  /* load the SMPTE abreviated docType */

  for (let i in registryDocument) {
    if (registryDocument[i]["publisher"] == "SMPTE"){
      let docType = registryDocument[i]["docType"];
      var dTA = ""
      if(docType == "Administrative Guideline"){
        dTA = "AG"
      }
      else if(docType == "Advisory Note"){
        dTA = "AN"
      }
      else if(docType == "Engineering Guideline"){
        dTA = "EG"
      }
      else if(docType == "Engineering Report"){
        dTA = "ER"
      }
      else if(docType == "Operations Manual"){
        dTA = "OM"
      }
      else if(docType == "Overview Document"){
        dTA = "EG"
      }
      else if(docType == "Recommended Practice"){
        dTA = "RP"
      }
      else if(docType == "Registered Disclosure Document"){
        dTA = "RDD"
      }
      else if(docType == 'Specification'){
        dTA = "TSP"
      }
      else if(docType == 'Standard'){
        dTA = "ST"
      }
      else if(docType == 'Study Group Report'){
        dTA = "SGR"
      }
      registryDocument[i].docTypeAbr = dTA;
    }
  }

  /* lightweight ref parsing (no MSI lookups) */
  const DATED_TAIL_RE = /\.(?:\d{8}|\d{4}(?:-\d{2})(?:-\d{2})?)$/;
  function isUndatedRef(id) {
    return typeof id === 'string' ? !DATED_TAIL_RE.test(id) : false;
  }

  /* load all references per doc */
  // Emit reference warnings only for the main documents index (avoid dupes from \"dependancies\")
  const __emitRefWarnings = (templateName === 'documents');
  const docReferences = []

  for (let i in registryDocument) {
    let references = registryDocument[i]["references"];
    if (references) {
      let docId = registryDocument[i].docId
      let refs = []
      let normRefs = references.normative
      let bibRefs = references.bibliographic

      // De-duplicate noisy warnings per docId
      const __noKeyWarned = new Set();
      const normResolved = [];
      const bibResolved = [];

      // Always consult MSI; only *upgrade* when the ref is undated.
      function getLatestRef(r, kind) {
        // Compute base form by stripping a date tail once; treat rest as the lineage base token
        const base = typeof r === 'string' ? r.replace(DATED_TAIL_RE, '') : r;
        const wasUndated = (base === r);
        let resolved = r;

        // If this reference is an exact docId present in our registry, skip MSI checks entirely
        if (__docIdSet && __docIdSet.has(r)) {
          refs.push(resolved);
          return { id: resolved };
        }

        if (__msiLatestByLineage) {
          // 1) Base-documents fast path: try the base token regardless of dated/undated;
          //    only *apply* upgrade when undated to avoid rewriting explicit dates.
          if (__msiBaseIndex) {
            const hit = __msiBaseIndex.get(base);
            if (hit) {
              if (wasUndated) {
                const next = hit.latestBaseId || hit.latestAnyId || r;
                if (next !== r) {
                  resolved = next;
                }
              } 
            }
          }

          // 2) Fallback: compute lineage key from the *base* token and ask MSI by lineage
          if (resolved === r) {
            // Some keyers (ISO/IEC/IEC) expect a trailing '.' after the base token in docIds.
            // Example: "ISO.15444-1" → matcher is anchored up to a dot before the date tail.
            const baseForKey = (typeof base === 'string' && !base.endsWith('.')) ? (base + '.') : base;
            const key = lineageKeyFromDocId(baseForKey);

            if (key) {
              const li = __msiLatestByLineage.get(key);
              if (li) {
                if (wasUndated) {
                  const next = li.latestBaseId || li.latestAnyId || r;
                  if (next !== r) {
                    resolved = next;
                  }
                } 
              } 
            } else if (wasUndated) {
              const warnKey = `${docId}::${r}`;
              if (!__noKeyWarned.has(warnKey)) {
                __noKeyWarned.add(warnKey);
                if (__emitRefWarnings) {
                  console.warn(`[WARN] No lineage key derivable: ref="${r}" (docId=${docId}, kind=${kind || 'unknown'})`);
                }
              }
            }
          }
        }

        // Build parallel structures only; do not mutate original arrays
        refs.push(resolved);
        return { id: resolved, undated: wasUndated };
      }

      if (normRefs && Array.isArray(normRefs)) {
        normRefs.sort();
        for (let i = 0; i < normRefs.length; i++) {
          const r = normRefs[i];
          const obj = getLatestRef(r, 'normative');
          // do NOT overwrite normRefs[i]; leave the source data untouched
          normResolved.push(obj);
        }
      }

      if (bibRefs && Array.isArray(bibRefs)) {
        bibRefs.sort();
        for (let i = 0; i < bibRefs.length; i++) {
          const r = bibRefs[i];
          const obj = getLatestRef(r, 'bibliographic');
          // do NOT overwrite bibRefs[i]; leave the source data untouched
          bibResolved.push(obj);
        }
      }

      // Expose structured references so the template can render undated labels when appropriate
      const resolvedOut = {};
      if (normResolved.length) resolvedOut.normative = normResolved;
      if (bibResolved.length) resolvedOut.bibliographic = bibResolved;
      if (Object.keys(resolvedOut).length) {
        registryDocument[i].referencesResolved = resolvedOut;
      }

      docReferences[docId] = refs;
      if (__emitRefWarnings && __noKeyWarned.size) {
        console.log(`[Refs] ${docId}: missing-lineage refs (unique) = ${__noKeyWarned.size}`);
      }
    }
  }

  /* load referenced by docs (one-pass, no bogus recursion) */
  for (let i in registryDocument) {
    const docId = registryDocument[i].docId;
    const referrers = Object.keys(docReferences).filter(k => {
      const arr = docReferences[k];
      return Array.isArray(arr) && arr.includes(docId);
    });
    if (referrers.length) {
      referrers.sort();
      registryDocument[i].referencedBy = referrers;
    }
  }

  /* load reference tree (bounded DFS up to depth 3 to prevent cycles) */
  const referenceTree = {};
  const MAX_DEPTH = 3;
  for (const baseId of Object.keys(docReferences)) {
    const all = new Set();
    const stack = (Array.isArray(docReferences[baseId]) ? [...docReferences[baseId]] : []).map(id => ({ id, depth: 1 }));
    const visited = new Set();
    while (stack.length) {
      const { id, depth } = stack.pop();
      if (!id || visited.has(id)) continue;
      visited.add(id);
      all.add(id);
      if (depth >= MAX_DEPTH) continue;
      const children = docReferences[id];
      if (Array.isArray(children)) {
        for (const c of children) stack.push({ id: c, depth: depth + 1 });
      }
    }
    referenceTree[baseId] = Array.from(all).sort();
  }

  for (let i in registryDocument) {
    let docId = registryDocument[i].docId
    if (Object.keys(referenceTree).includes(docId) === true) {
      registryDocument[i].referenceTree = referenceTree[docId]
    }
  }

  /* check if referenced by or reference tree exist (for rendering on page) */ 

  let docDependancy
  for (let i in registryDocument) {
    let depCheck = true
    let depPresent
    if (registryDocument[i].referencedBy && registryDocument[i].referenceTree) {
      docDependancy = true
    }
    else if (registryDocument[i].referencedBy) {
      docDependancy = true
    }
    else if (registryDocument[i].referenceTree) {
      docDependancy = true
    }
    else {
      docDependancy = false
    } 
    registryDocument[i].docDependancy = docDependancy
  }

  /* load the doc Current Statuses and Labels */

  for (let i in registryDocument) {
    const d = registryDocument[i] || {};
    const status = (d.status && typeof d.status === 'object') ? d.status : {};
    let cS = "";

    if (status.active) {
      cS = "Active";
      if (status.versionless) cS += ", Versionless";
      if (status.amended) cS += ", Amended";
      if (status.stabilized) cS += ", Stabilized"; else if (status.reaffirmed) cS += ", Reaffirmed";
    } else if (status.draft) {
      cS = "Draft";
      if (status.publicCd) cS += ", Public CD";
    } else if (status.withdrawn) {
      cS = "Withdrawn";
    } else if (status.superseded) {
      cS = "Superseded";
    } else if (status.unknown) {
      cS = "Unknown";
    } else {
      cS = "Unknown";
    }

    if (status.statusNote) cS += "*";
    d.currentStatus = cS;
    registryDocument[i] = d;
  }

  const docStatuses = {}
  registryDocument.forEach(item => { docStatuses[item.docId] = item.currentStatus} );

  hb.registerHelper("getStatus", function(docId) {
    if (!docStatuses.hasOwnProperty(docId)) {
      return "NOT IN REGISTRY";
    } else {
      return docStatuses[docId];
    }
  });

  /* create Status Button and Label based on current document status */

  hb.registerHelper("getstatusButton", function(docId, btnSize) {
    
    var status = docStatuses[docId]
    if (status !== undefined) {
      if (status.includes("Active")) { 
        return '<svg xmlns="http://www.w3.org/2000/svg" width="' + btnSize + '" height="' + btnSize + '" fill="#0c9c16" class="bi bi-check-circle-fill align-baseline" viewBox="0 0 16 16"><path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zm-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z"/></svg>'; 
      }
      else if (status.includes("Superseded") || status.includes("Withdrawn")){
        return '<svg xmlns="http://www.w3.org/2000/svg" width="' + btnSize + '" height="' + btnSize + '" fill="#ff0000" class="bi bi-slash-circle-fill align-baseline" viewBox="0 0 16 16"><path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zm-4.646-2.646a.5.5 0 0 0-.708-.708l-6 6a.5.5 0 0 0 .708.708l6-6z"/></svg>'
      }
      else {
        return "";
      }
    } 
    return docStatuses[docId];
  });

  const docLabels = {}
  registryDocument.forEach(item => { 
    if (item.docType === "Journal Article" || item.docType === "White Paper" || item.docType === "Book" || item.docType === "Guideline" || item.docType === "Registry" )  {
      docLabels[item.docId] = (item.docTitle)
    } else {
      docLabels[item.docId] = (item.docLabel)
    }    
  } );

  hb.registerHelper("getLabel", function(docId) {
    if (!docLabels.hasOwnProperty(docId)) {
      return docId;
    } else {
      return docLabels[docId];
    }
  });

  const docTitles = {}
  registryDocument.forEach(item => { docTitles[item.docId] = (item.docTitle)} );

  hb.registerHelper("getTitle", function(docId) {
    return docTitles[docId];
  });

  // Render a label without trailing date (e.g., "SMPTE ST 429-2:2023-09" -> "SMPTE ST 429-2")
  hb.registerHelper("getUndatedLabel", function(docId) {
    const label = docLabels.hasOwnProperty(docId) ? docLabels[docId] : docId;
    // Strip ":YYYY", ":YYYY-MM" or ":YYYYMMDD" and anything after
    return String(label).replace(/:\s?\d{4}(?:-\d{2}){0,2}.*$/, '');
  });

  /* lookup if any projects exist for current document */
  
  // Build a docId → project summary index that includes BOTH:
  //  - the project's primary docId (i.e., the new/replacing doc under development)
  //  - every entry listed in docAffected (i.e., existing docs being updated)
  //
  // If multiple projects touch the same docId, prefer any non-"Complete" status.
  const docProjsMap = new Map();
  
  function upsertDocProj(key, payload) {
    if (!key) return;
    const prev = docProjsMap.get(key);
    if (!prev) {
      docProjsMap.set(key, payload);
      return;
    }
    // Prefer a project that is not "Complete" over one that is "Complete".
    const prevDone = String(prev.projectStatus || '').toLowerCase() === 'complete';
    const nextDone = String(payload.projectStatus || '').toLowerCase() === 'complete';
    if (prevDone && !nextDone) {
      docProjsMap.set(key, payload);
    }
    // Otherwise, keep the first seen; we don't attempt deep merges here.
  }
  
  for (const proj of registryProject) {
    if (!proj || (typeof proj !== 'object')) continue;
    const payload = {
      workType: proj.workType,
      projectStatus: proj.projectStatus,
      newDoc: proj.newDoc,             // the new/replacing doc being created
      projApproved: proj.projApproved,
      projectId: proj.projectId
    };
  
    // 1) Index by the project's primary docId (new/replacing doc under development)
    if (proj.newDoc) {
      upsertDocProj(proj.newDoc, { newDoc: proj.newDoc, ...payload });
    }
    // 2) Index by each affected existing document
    const affected = Array.isArray(proj.docAffected) ? proj.docAffected : (proj.docAffected ? [proj.docAffected] : []);
    for (const a of affected) {
      if (!a) continue;
      upsertDocProj(a, { docId: a, ...payload });
    }
  }
  
  // Handlebars templates currently expect an array; provide both forms just in case.
  const docProjs = Array.from(docProjsMap.values());
  
  /* Load Current Work on Doc for filtering */

  for (let i in registryDocument) {
    const currentWork = []
    let works = registryDocument[i]["workInfo"]
    for (let w in works) {

      if (w === "review") {
        for (let r in works[w]) {
          let rP = works[w][r]["reviewPeriod"]
          let rN = works[w][r]["reviewNeeded"]

          if (rN === true) {
            currentWork.push(rP + " Review Needed")
          }
        }
      }
    }
    for (let p in registryProject) {
      let pD = registryProject[p]["docId"]
      let pW = registryProject[p]["workType"]
      let pS = registryProject[p]["projectStatus"]

      if (pS !== "Complete") {
        if (pD === registryDocument[i]["docId"]) {
          currentWork.push(pW + " - " + pS)
        }
      }

    }
    for (let ps in docProjs) {
      let psD = docProjs[ps]["docId"]
      let psW = docProjs[ps]["workType"]
      let psS = docProjs[ps]["projectStatus"]

      if (psS !== "Complete") {
        if (psD === registryDocument[i]["docId"]) {
          currentWork.push(psW + " - " + psS)
        }
      }
    }
    
    if (currentWork.length !== 0) {
      registryDocument[i]["currentWork"] = currentWork
    }
  }

  /* lookup if Repo exists for any project */

  for (let i in registryProject) {
    var repo
    let doc = registryProject[i]["docId"]
    if (typeof doc !== "undefined") {
      for (let d in registryDocument) {
        if (registryDocument[d]["docId"] === doc) {
          if (typeof registryDocument[d]["repo"] !== "undefined") {
            registryProject[i].repo = registryDocument[d]["repo"]
          }
        }
      }
    }
    let docAff = registryProject[i]["docAffected"]
    for (let dA in docAff) {
      let doc = docAff[dA]
      if (typeof doc !== "undefined") {
        for (let d in registryDocument) {
          if (registryDocument[d]["docId"] === doc) {
            if (typeof registryDocument[d]["repo"] !== "undefined") {
              registryProject[i].repo = registryDocument[d]["repo"]
            }
          }
        }
      }
    }  
  }

  /* external json lookup helpers */

hb.registerHelper('docProjLookup', function(collection, id) {
  if (!id || !collection) return null;

  // Map support
  if (typeof collection.get === 'function') {
    return collection.get(id) || null;
  }
  // Object/dictionary support
  if (!Array.isArray(collection) && typeof collection === 'object') {
    return collection[id] || null;
  }
  // Array (legacy) support
  if (Array.isArray(collection)) {
    for (let i = 0; i < collection.length; i++) {
      const item = collection[i];
      if (item && item.docId === id) return item;
    }
  }
  return null;
});

  hb.registerHelper('groupIdLookup', function(collection, id) {
      var collectionLength = collection.length;
      for (var i = 0; i < collectionLength; i++) {
          if (collection[i].groupId === id) {
              return collection[i];
          }
      }
      return null;
  });

  hb.registerHelper('projectIdLookup', function(collection, id) {
      var collectionLength = collection.length;
      for (var i = 0; i < collectionLength; i++) {
          if (collection[i].projectId === id) {
              return collection[i];
          }
      }
      return null;
  });

  /* helpers to replace spaces and dots for links */

  hb.registerHelper('spaceReplace', function(str) {
      return str.replace(/\s/g , '%20')
  });

  hb.registerHelper('dotReplace', function(str) {
      return str.replace(/\./g, '-')
  });

  hb.registerHelper('publisherLogo', function (pub, opts) {
    if (!pub || typeof pub !== 'string') return '';

    // Resolve config maps
    const logos = (siteConfig && siteConfig.publisherLogos && typeof siteConfig.publisherLogos === 'object')
      ? siteConfig.publisherLogos
      : null;
    const rel = logos ? logos[pub] : null;
    if (!rel) return '';

    // Access render root for assetPrefix + default height
    const root = (opts && opts.data && opts.data.root) ? opts.data.root : {};
    const assetPrefix = (typeof root.assetPrefix === 'string') ? root.assetPrefix : '';

    // Height precedence: explicit hash height > root.publisherLogoHeight > siteConfig.publisherLogoHeight > 25
    let h = 25;
    if (opts && opts.hash && opts.hash.height != null && !Number.isNaN(Number(opts.hash.height))) {
      h = Number(opts.hash.height);
    } else if (typeof root.publisherLogoHeight === 'number') {
      h = root.publisherLogoHeight;
    } else if (siteConfig && typeof siteConfig.publisherLogoHeight === 'number') {
      h = siteConfig.publisherLogoHeight;
    }

    const alt = `${pub} logo`;
    const src = rel.startsWith('/') ? rel : `${assetPrefix}${rel}`;

    return new hb.SafeString(
      `<img src="${src}" alt="${alt}" height="${h}" class="align-text-bottom me-1" loading="lazy">`
    );
  });
  
  // Publisher link resolver: resolves publisher to URL using siteConfig.publisherUrls and optional aliases
  hb.registerHelper('publisherLink', function (pub) {
    if (!pub || typeof pub !== 'string') return '';
    const urlMap = (siteConfig && siteConfig.publisherUrls && typeof siteConfig.publisherUrls === 'object')
      ? siteConfig.publisherUrls
      : null;
    if (!urlMap) return '';

    // Normalize basic alias mapping reusing publisherLogoAliases when present
    const aliases = (siteConfig && siteConfig.publisherLogoAliases && typeof siteConfig.publisherLogoAliases === 'object')
      ? siteConfig.publisherLogoAliases
      : {};

    const raw = String(pub).trim();
    // 1) Exact
    if (urlMap[raw]) return urlMap[raw];

    // 2) Alias (case-insensitive)
    const lowerAliases = {};
    for (const [a, c] of Object.entries(aliases)) {
      lowerAliases[String(a).toLowerCase()] = String(c);
    }
    const canon = lowerAliases[raw.toLowerCase()];
    if (canon && urlMap[canon]) return urlMap[canon];

    // 3) First-token fallback (before dash/comma/paren/colon)
    const first = raw.split(/[–—-]|,|\(|\)|:/)[0].trim();
    if (first && urlMap[first]) return urlMap[first];

    // 4) Case-insensitive direct key match
    const lower = raw.toLowerCase();
    for (const [k, v] of Object.entries(urlMap)) {
      if (String(k).toLowerCase() === lower) return v;
    }
    return '';
  });
  
  /* get the version field */
  
  let site_version = "Unknown version"
  
  try {
    site_version = (await execFile('git', [ 'rev-parse', 'HEAD' ])).stdout.trim()
  } catch (e) {
    console.warn(e);
  }
  
  /* create build directory */
  
  await fs.mkdir(BUILD_PATH, { recursive: true });
    if (templateName != "index") { 
      await fs.mkdir(BUILD_PATH + "/" + templateName, { recursive: true });
    }
    // Ensure _data directory exists
    await fs.mkdir(path.join(BUILD_PATH, '_data'), { recursive: true });
    // Emit publisher logos + optional aliases for client-side docList.js
    try {
      const logosOut = {};
      if (siteConfig && siteConfig.publisherLogos && typeof siteConfig.publisherLogos === 'object') {
        for (const [k, v] of Object.entries(siteConfig.publisherLogos)) {
          if (!v) continue;
          const rel = String(v).trim();
          // Normalize to root-absolute so client doesn't need per-page assetPrefix
          logosOut[String(k).trim()] = rel.startsWith('/') ? rel : '/' + rel;
        }
      }
      // Optional alias map: { "smpte": "SMPTE", "SMPTE – Society of Motion Picture…": "SMPTE" }
      const aliasesOut = {};
      if (siteConfig && siteConfig.publisherLogoAliases && typeof siteConfig.publisherLogoAliases === 'object') {
        for (const [alias, canon] of Object.entries(siteConfig.publisherLogoAliases)) {
          if (!alias || !canon) continue;
          aliasesOut[String(alias).trim()] = String(canon).trim();
        }
      }
      const logosPayload = {
        logos: logosOut,
        height: (typeof siteConfig.publisherLogoHeight === 'number' ? siteConfig.publisherLogoHeight : 25),
        aliases: aliasesOut
      };
      await fs.writeFile(
        path.join(BUILD_PATH, '_data', 'publisher-logos.json'),
        JSON.stringify(logosPayload, null, 2),
        'utf8'
      );
    } catch (e) {
      console.warn('[build] Could not emit publisher-logos.json:', e && e.message ? e.message : e);
    }

    // Emit publisher URLs (for client-side cards)
    try {
      const urlsOut = {};
      if (siteConfig && siteConfig.publisherUrls && typeof siteConfig.publisherUrls === 'object') {
        for (const [k, v] of Object.entries(siteConfig.publisherUrls)) {
          if (!v) continue;
          urlsOut[String(k).trim()] = String(v).trim();
        }
      }
      const urlAliasesOut = {};
      if (siteConfig && siteConfig.publisherLogoAliases && typeof siteConfig.publisherLogoAliases === 'object') {
        for (const [alias, canon] of Object.entries(siteConfig.publisherLogoAliases)) {
          if (!alias || !canon) continue;
          urlAliasesOut[String(alias).trim()] = String(canon).trim();
        }
      }
      const urlsPayload = {
        urls: urlsOut,
        aliases: urlAliasesOut
      };
      await fs.writeFile(
        path.join(BUILD_PATH, '_data', 'publisher-urls.json'),
        JSON.stringify(urlsPayload, null, 2),
        'utf8'
      );
    } catch (e) {
      console.warn('[build] Could not emit publisher-urls.json:', e && e.message ? e.message : e);
    }

  /* determine if build on GH to remove "index.html" from internal link */

  let htmlLink = "index.html"
  if ('GH_PAGES_BUILD' in process.env) {
    htmlLink = ""
  }
  
  /* apply template */
  
    var html = template({
      "data": registryDocument,
      // If this page's subRegistry included documents, prefer that complete dataset for cross-lookups.
      // Otherwise, fall back to the primary dataset only when the primary listType is "documents".
      "dataDocuments": (registryDocsAll && Array.isArray(registryDocsAll)) 
                        ? registryDocsAll 
                        : (listType === 'documents' ? registryDocument : []),
      "dataGroups": registryGroup,
      "dataProjects": registryProject,
      "docProjs": docProjs,
      "htmlLink": htmlLink,
      "date" :  new Date(),
      "csv_path": CSV_SITE_PATH,
      "site_version": site_version,
      "listType": listType,
      "idType": idType,
      "listTitle": listTitle,
      "templateName": templateName,
      // meta
      "siteName": siteConfig.siteName,
      "author": siteConfig.author,
      "authorUrl": siteConfig.authorUrl,
      "copyright": siteConfig.copyright,
      "copyrightHolder": siteConfig.copyrightHolder,
      "copyrightYear": siteConfig.copyrightYear,
      "license": siteConfig.license,
      "licenseUrl": siteConfig.licenseUrl,
      "locale": siteConfig.locale,
      "siteDescription": siteConfig.siteDescription,
      "siteTitle": (listTitle ? `${listTitle} — ${siteConfig.siteName}` : siteConfig.siteName),
      "canonicalBase": siteConfig.canonicalBase,
      "canonicalUrl": canonicalUrl,
      "ogTitle": ogTitle,
      "ogDescription": ogDescription,
      "ogImage": ogImage,
      "ogImageAlt": ogImageAlt,
      "assetPrefix": assetPrefix,
      "publisherUrls": siteConfig.publisherUrls,
    });

  // --- Safe normalization for per‑doc rendering (prevents .length on undefined)
  function __normArray(v) { return Array.isArray(v) ? v : []; }
  function __normStr(v) { return (typeof v === 'string') ? v : ''; }
  function __normObj(v) { return (v && typeof v === 'object') ? v : {}; }

  function prepareDocForRender(d) {
    const out = { ...d };

    // Core strings
    out.docId = __normStr(out.docId);
    out.docLabel = __normStr(out.docLabel);
    out.docTitle = __normStr(out.docTitle);
    out.publisher = __normStr(out.publisher);
    out.docType = __normStr(out.docType);
    out.docTypeAbr = __normStr(out.docTypeAbr);
    out.publicationDate = __normStr(out.publicationDate);
    out.href = __normStr(out.href);
    out.doi = __normStr(out.doi);

    // Status object (and nested flags)
    out.status = __normObj(out.status);

    // References (raw + resolved)
    out.references = __normObj(out.references);
    out.references.normative = __normArray(out.references.normative);
    out.references.bibliographic = __normArray(out.references.bibliographic);

    out.referencesResolved = __normObj(out.referencesResolved);
    out.referencesResolved.normative = __normArray(out.referencesResolved.normative);
    out.referencesResolved.bibliographic = __normArray(out.referencesResolved.bibliographic);

    // Dependency graph
    out.referencedBy = __normArray(out.referencedBy);
    out.referenceTree = __normArray(out.referenceTree);
    out.relatedDocs = __normArray(out.relatedDocs);

    // Work/state
    out.currentWork = __normArray(out.currentWork);

    // Namespaces (singular legacy or plural new)
    if (Array.isArray(out.xmlNamespace)) {
      // keep as-is
    } else if (Array.isArray(out.xmlNamespaces)) {
      out.xmlNamespace = out.xmlNamespaces;
    } else {
      out.xmlNamespace = [];
    }

    return out;
  }
  // --- Emit per-document static detail pages at /docs/{docId}/index.html
  try {
    const docTplSrc = await fs.readFile('src/main/templates/docId.hbs', 'utf8');
    const docTpl = hb.compile(docTplSrc);
    const docsOutRoot = path.join(BUILD_PATH, 'docs');
    await fs.mkdir(docsOutRoot, { recursive: true });

    let __ok = 0, __fail = 0;
    for (const d of registryDocument) {
      if (!d || !d.docId) continue;
      const id = String(d.docId);
      const docDir = path.join(docsOutRoot, id);
      await fs.mkdir(docDir, { recursive: true });
      try {
        // Per‑doc canonical + social meta
        const perDocCanonical = new URL(`/docs/${encodeURIComponent(id)}/`, siteConfig.canonicalBase).href;
        const perDocTitle = (d.docLabel || d.docId) + ' — ' + siteConfig.siteName;
        const perDocDesc = d.docTitle || siteConfig.siteDescription;

        const safeDoc = prepareDocForRender(d);
        const docHtml = docTpl({
          // data for this document (flat access in template)
          ...safeDoc,
          // collections if template needs lookups
          dataDocuments: registryDocument,
          dataGroups: registryGroup,
          dataProjects: registryProject,
          docProjs: docProjs,
          // site/meta
          site_version: site_version,
          siteName: siteConfig.siteName,
          author: siteConfig.author,
          authorUrl: siteConfig.authorUrl,
          copyright: siteConfig.copyright,
          copyrightHolder: siteConfig.copyrightHolder,
          copyrightYear: siteConfig.copyrightYear,
          license: siteConfig.license,
          listTitle: (d.docLabel || d.docId),
          licenseUrl: siteConfig.licenseUrl,
          locale: siteConfig.locale,
          siteDescription: perDocDesc,
          siteTitle: perDocTitle,
          ogTitle: perDocTitle,
          canonicalBase: siteConfig.canonicalBase,
          canonicalUrl: perDocCanonical,
          ogImage: new URL(siteConfig.ogImage, siteConfig.canonicalBase).href,
          ogImageAlt: siteConfig.ogImageAlt,
          assetPrefix: '../../',
          htmlLink: ('GH_PAGES_BUILD' in process.env) ? '' : 'index.html',
          date: new Date(),
          publisherLogoHeight: 25,
          publisherUrls: siteConfig.publisherUrls,
        });

        const outFile = path.join(docDir, 'index.html');
        await fs.writeFile(outFile, docHtml, 'utf8');
        __ok++;
      } catch (perDocErr) {
        __fail++;
        console.warn(
          `[build] Per-doc emit failed for ${id} — pub:${d.publisher || 'unknown'}, type:${d.docType || 'unknown'}, refs:${Array.isArray(d.references?.normative) || Array.isArray(d.references?.bibliographic) ? 'yes' : 'no'}`,
          '\nReason:',
          perDocErr && perDocErr.stack ? perDocErr.stack : (perDocErr && perDocErr.message ? perDocErr.message : perDocErr)
        );
        continue;
      }
    }
    if (__fail) {
      console.warn(`[build] Per-doc pages emitted with warnings: ok=${__ok}, failed=${__fail}`);
    } else {
      // console.log(`[build] Per-doc pages emitted: ${__ok}`);
    }
  } catch (e) {
    console.warn('[build] Could not emit per-doc pages:', e && e.message ? e.message : e);
  }
  
  /* write HTML file */
  await fs.writeFile(path.join(BUILD_PATH, PAGE_SITE_PATH), html, 'utf8');

  // Build docList search index (search-index.json + facets.json) once per run
  // Only trigger from the main index page to avoid duplicate executions
    if (templateName === 'documents') {
      // Persist the in-memory documents state for downstream consumers (docs/search-index)
      const EFFECTIVE_DOCS_PATH = path.join('build','docs','_data','documents.json');
      try {
        await fs.mkdir(path.dirname(EFFECTIVE_DOCS_PATH), { recursive: true });
        // Remove all deep keys that contain "$meta" before writing effective docs snapshot
        const cleanEffective = JSON.parse(
          JSON.stringify(
            registryDocument,
            (key, val) => (typeof key === 'string' && key.includes('$meta') ? undefined : val)
          )
        );
        await fs.writeFile(EFFECTIVE_DOCS_PATH, JSON.stringify(cleanEffective, null, 2), 'utf8');
        console.log(`[build] Wrote ${EFFECTIVE_DOCS_PATH}`);
      } catch (e) {
        console.warn('[build] Could not write documents snapshot:', e && e.message ? e.message : e);
      }
      try {
        const { stdout } = await execFile('node', [path.join('src','main','scripts','build.search-index.js'), EFFECTIVE_DOCS_PATH]);
        if (stdout && stdout.trim()) console.log(stdout.trim());
      } catch (e) {
        console.warn('[docList] Index build failed:', e && e.message ? e.message : e);
      }
    }
  
  /* set the CHROMEPATH environment variable to provide your own Chrome executable */
  var pptr_options = {};
  
  if (process.env.CHROMEPATH) {
    pptr_options.executablePath = process.env.CHROMEPATH;
  }

  async function parseJSONFile (fileName) {
    try {
      const file = await readFile(fileName);
      return JSON.parse(file);
    } catch (err) {
      console.log(err);
      process.exit(1);
    }
  }

  async function writeCSV (fileName, data) {
    await writeFile(fileName, data, 'utf8');
  }

  (async () => {
    const data = await parseJSONFile(inputFileName);
    // Remove all fields where the key contains "$meta" before exporting to CSV
    const stripped = JSON.parse(
      JSON.stringify(
        data,
        (key, val) => (typeof key === 'string' && key.includes('$meta') ? undefined : val)
      )
    );
    const csv = await json2csvAsync(stripped);
    await writeCSV(outputFileName, csv);
  })();

  console.log(`Build of ${templateName} completed`)
};

module.exports = {
  buildRegistry,
}

void (async () => {
  await loadSiteConfig();

  for (const cfg of registries) {
    await buildRegistry(cfg);
  }
  // Copy static site assets once per build
  await copyRecursive(SITE_PATH, BUILD_PATH);
  console.log('[build] Copied static assets to build/.');

  const tplCards = await fs.readFile(path.join('src','main','templates','docList.hbs'), 'utf8');
  const renderCards = hb.compile(tplCards);

  // Create subdirectory for docs page
  await fs.mkdir(path.join('build','docs'), { recursive: true });

  const docsCanonical = new URL('/docs/', siteConfig.canonicalBase).href;
  const docsOgDescription = siteConfig.siteDescription;
  const docsOgTitle = `Docs — ${siteConfig.siteName}`;
  const docsOgImage = new URL(siteConfig.ogImage, siteConfig.canonicalBase).href;
  const docsOgImageAlt = siteConfig.ogImageAlt;
  const docsAssetPrefix = '../';
  await fs.writeFile(path.join('build','docs','index.html'), renderCards({
    templateName: 'docList',
    listTitle: 'Docs',
    htmlLink: '', // same relative handling as other pages
    listType: 'documents',
    csv_path: 'documents.csv',
    site_version: (await execFile('git', ['rev-parse','HEAD'])).stdout.trim(),
    date: new Date().toISOString(),
    // meta
    siteName: siteConfig.siteName,
    author: siteConfig.author,
    authorUrl: siteConfig.authorUrl,
    copyright: siteConfig.copyright,
    copyrightHolder: siteConfig.copyrightHolder,
    copyrightYear: siteConfig.copyrightYear,
    license: siteConfig.license,
    licenseUrl: siteConfig.licenseUrl,
    locale: siteConfig.locale,
    siteDescription: siteConfig.siteDescription,
    siteTitle: `Docs — ${siteConfig.siteName}`,
    canonicalBase: siteConfig.canonicalBase,
    canonicalUrl: docsCanonical,
    ogTitle: docsOgTitle,
    ogDescription: docsOgDescription,
    ogImage: docsOgImage,
    ogImageAlt: docsOgImageAlt,
    assetPrefix: docsAssetPrefix,
    publisherLogos: siteConfig.publisherLogos,
    publisherLogosJson: JSON.stringify(siteConfig.publisherLogos || {}),
    publisherLogoHeight: 25,
    publisherUrls: siteConfig.publisherUrls,
    robotsMeta: 'noindex,nofollow'
  }), 'utf8');

  console.log('[build] Wrote build/docs/index.html');

  // --- Emit Home page from index.hbs at site root
  const headerTplHome = await fs.readFile(path.join('src','main','templates','partials','header.hbs'), 'utf8');
  const footerTplHome = await fs.readFile(path.join('src','main','templates','partials','footer.hbs'), 'utf8');
  hb.registerPartial('header', headerTplHome);
  hb.registerPartial('footer', footerTplHome);

  const tplIndex = hb.compile(await fs.readFile(path.join('src','main','templates','index.hbs'), 'utf8'));
  const homeCanonical = new URL('/', siteConfig.canonicalBase).href;
  const homeHtml = tplIndex({
    templateName: 'index',
    listTitle: 'Home',
    site_version: (await execFile('git', ['rev-parse','HEAD'])).stdout.trim(),
    date: new Date().toISOString(),
    // meta
    siteName: siteConfig.siteName,
    author: siteConfig.author,
    authorUrl: siteConfig.authorUrl,
    copyright: siteConfig.copyright,
    copyrightHolder: siteConfig.copyrightHolder,
    copyrightYear: siteConfig.copyrightYear,
    license: siteConfig.license,
    licenseUrl: siteConfig.licenseUrl,
    locale: siteConfig.locale,
    siteDescription: siteConfig.siteDescription,
    siteTitle: `${siteConfig.siteName}`,
    canonicalBase: siteConfig.canonicalBase,
    canonicalUrl: homeCanonical,
    ogTitle: `${siteConfig.siteName}`,
    ogDescription: siteConfig.siteDescription,
    ogImage: new URL(siteConfig.ogImage, siteConfig.canonicalBase).href,
    ogImageAlt: siteConfig.ogImageAlt,
    assetPrefix: '',
    publisherUrls: siteConfig.publisherUrls,
  });
  await fs.writeFile(path.join(BUILD_PATH, 'index.html'), homeHtml, 'utf8');
  console.log('[build] Wrote build/index.html');

  // --- Emit robots.txt and sitemap.xml
  const robotsTxt = [
    '# MSRBot.io robots.txt',
    '# Managed by PrZ3 Unit — Penguin Parsing Protocol v3-Gen',
    'User-agent: *',
    'Allow: /',
    'Disallow: /docs/',
    'Disallow: /tmp/',
    'Disallow: /pr/',
    '',
    `Sitemap: ${new URL('/sitemap.xml', siteConfig.canonicalBase).href}`
  ].join('\n');
  await fs.writeFile(path.join(BUILD_PATH, 'robots.txt'), robotsTxt, 'utf8');
  console.log('[build] Wrote build/robots.txt');

  // Build a simple sitemap of core routes
  const nowISO = new Date().toISOString();
  const urls = [
    '/',
    '/dependancies/',
    '/groups/',
    '/projects/',
    '/docs/'
  ];
  const urlset = urls.map(u => {
    const loc = new URL(u, siteConfig.canonicalBase).href;
    return `  <url>
      <loc>${loc}</loc>
      <lastmod>${nowISO}</lastmod>
      <changefreq>daily</changefreq>
      <priority>${u === '/' ? '1.0' : '0.8'}</priority>
    </url>`;
  }).join('\n');

  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urlset}
  </urlset>
  `;
  await fs.writeFile(path.join(BUILD_PATH, 'sitemap.xml'), sitemapXml, 'utf8');
  console.log('[build] Wrote build/sitemap.xml');

  // --- Emit OpenSearch descriptor
  const openSearchXml = `<?xml version="1.0" encoding="UTF-8"?>
  <OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
    <ShortName>MSRBot</ShortName>
    <Description>Search MSRBot.io</Description>
    <Url type="text/html" template="${new URL('/search', siteConfig.canonicalBase).href}?q={searchTerms}"/>
  </OpenSearchDescription>
  `;
  await fs.writeFile(path.join(BUILD_PATH, 'opensearch.xml'), openSearchXml, 'utf8');
  console.log('[build] Wrote build/opensearch.xml');

  // --- Emit 404.html for GitHub Pages (rendered with header/footer)
  const headerTpl = await fs.readFile(path.join('src','main','templates','partials','header.hbs'), 'utf8');
  const footerTpl = await fs.readFile(path.join('src','main','templates','partials','footer.hbs'), 'utf8');
  hb.registerPartial('header', headerTpl);
  hb.registerPartial('footer', footerTpl);

  // Prepare penguin 404 messages from config
  const penguinMessagesJson = JSON.stringify(siteConfig.penguin404Messages);
  
  const tpl404 = hb.compile(`{{> header}}
    <main class="container py-5">
      <div class="row justify-content-md-center">
        <div class="col-md-8 text-center">
          <div class="card p-4 border-1 shadow-sm">
            <h3 class="h3 mb-3" id="penguin404" aria-live="polite"></h1>
            <p class="mb-4">
              The document you requested isn’t here. 
              <br>Try the <a href="{{assetPrefix}}documents/{{htmlLink}}">main documents index</a>.
            </p>
            <p>
              <img src="{{assetPrefix}}static/MSRBot-PrZ3-blue.svg" alt="MSR" width="250" height="250" class="m-2">
            </p>
            <small class="text-muted">
              <p>
                Feeling helpful, and might have found a bad link? File an issue at <i class="bi bi-github"></i> <a href="https://github.com/PrZ3r/MSRBot.io/issues" target="_blank">https://github.com/PrZ3r/MSRBot.io/issues</a> <i class="bi bi-github"></i>
              </p>
            </small> 
            <!-- Store penguin messages JSON in a hidden <code> element for safer injection -->
            <code id="penguin-messages-json" style="display: none;">{{penguinMessagesJson}}</code>
            <script>
              (function () {
                var codeEl = document.getElementById('penguin-messages-json');
                var penguinMessages = [];
                if (codeEl) {
                  try {
                    penguinMessages = JSON.parse(codeEl.textContent || '[]');
                  } catch (e) {
                    penguinMessages = [];
                  }
                }
                var el = document.getElementById('penguin404');
                if (el && Array.isArray(penguinMessages) && penguinMessages.length) {
                  var msg = penguinMessages[Math.floor(Math.random() * penguinMessages.length)];
                  // Clear any existing text and append a <code> wrapper for on-screen display
                  el.textContent = '';
                  var codeMsg = document.createElement('code');
                  codeMsg.className = 'penguin-quip';
                  codeMsg.textContent = msg;
                  el.appendChild(codeMsg);
                }
              })();
            </script>
          </div>
        </div>
      </div>
    </main>
    {{> footer}}
  </html>`);
  const fourOhFourHtml = tpl404({
    templateName: 'documents',                 // root paths for assets
    listTitle: 'Not Found',
    site_version: (await execFile('git', ['rev-parse','HEAD'])).stdout.trim(),
    date: new Date().toISOString(),
    // meta
    siteName: siteConfig.siteName,
    author: siteConfig.author,
    authorUrl: siteConfig.authorUrl,
    copyright: siteConfig.copyright,
    copyrightHolder: siteConfig.copyrightHolder,
    copyrightYear: siteConfig.copyrightYear,
    license: siteConfig.license,
    licenseUrl: siteConfig.licenseUrl,
    locale: siteConfig.locale,
    siteDescription: siteConfig.siteDescription,
    siteTitle: `Not Found — ${siteConfig.siteName}`,
    canonicalBase: siteConfig.canonicalBase,
    canonicalUrl: new URL('/404.html', siteConfig.canonicalBase).href,
    ogTitle: `Not Found — ${siteConfig.siteName}`,
    ogDescription: siteConfig.siteDescription,
    ogImage: new URL(siteConfig.ogImage, siteConfig.canonicalBase).href,
    ogImageAlt: siteConfig.ogImageAlt, 
    robotsMeta: 'noindex,follow',
    assetPrefix: '/',
    penguinMessagesJson: penguinMessagesJson,
    publisherUrls: siteConfig.publisherUrls,
  });
  await fs.writeFile(path.join(BUILD_PATH, '404.html'), fourOhFourHtml, 'utf8');
  console.log('[build] Wrote build/404.html');

})().catch(console.error)
