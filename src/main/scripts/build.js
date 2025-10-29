/*
Copyright (c), Steve LLamb

This work is licensed under the Creative Commons Attribution 4.0 International License.

You should have received a copy of the license along with this work.  If not, see <https://creativecommons.org/licenses/by/4.0/>.
*/

/* pass the option  */

const path = require('path');
const fs = require('fs').promises;
const { promisify } = require('util');
const execFile = promisify(require('child_process').execFile);


const hb = require('handlebars');
// Minimal shared keying import for MSI lineage lookups
const keying = require('../lib/keying');
const { lineageKeyFromDoc, lineageKeyFromDocId } = keying;

const REGISTRIES_REPO_PATH = "src/main";
const SITE_PATH = "src/site";
const BUILD_PATH = "build";

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

const argv = require('yargs').argv;
const { readFile, writeFile } = require('fs').promises;
const { json2csvAsync } = require('json-2-csv');

/* list the available registries type (lower case), id (single, for links), titles (Upper Case), and schema builds */

const registries = [
  {
    "listType": "documents",
    "templateType": "documents",
    "templateName": "index",
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
    "listTitle": "Document Dependancies",
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

// Enable Inspector build only for dev runs
const ENABLE_INSPECTOR = (argv && (argv.dev === true || argv.dev === '1')) || process.env.MSR_BUILD_DEV === '1';
if (ENABLE_INSPECTOR) {
  registries.push({
    listType: 'documents',
    templateType: 'documents',
    templateName: 'index',       // reuse documents template
    idType: 'document',
    listTitle: 'Inspector',
    subRegistry: ['groups','projects'],
    output: 'inspector.html',
    extras: { inspector: true }
  });
}

/* load and build the templates */

async function buildRegistry ({ listType, templateType, templateName, idType, listTitle, subRegistry, output, extras }) {
  console.log(`Building ${templateName} started`)

  var DATA_PATH = path.join(REGISTRIES_REPO_PATH, "data/" + listType + ".json");
  var DATA_SCHEMA_PATH = path.join(REGISTRIES_REPO_PATH, "schemas/" + listType + ".schema.json");
  var TEMPLATE_PATH = "src/main/templates/" + templateName + ".hbs";
  var PAGE_SITE_PATH
  if (output) {
    PAGE_SITE_PATH = output;
  } else if (templateName == "index") {
    PAGE_SITE_PATH = templateName + ".html";
  } else {
    PAGE_SITE_PATH = templateName + "/index.html";
  }

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
  for (const sub of subRegistry) {
    const subDataPath = path.join(REGISTRIES_REPO_PATH, `data/${sub}.json`);
    try {
      const subData = JSON.parse(await fs.readFile(subDataPath, 'utf8'));
      if (sub === 'groups') registryGroup = subData;
      if (sub === 'projects') registryProject = subData;
    } catch (err) {
      // If a sub-registry file is missing, warn and continue; templates will handle absent data
      console.warn(`[WARN] Could not load data for sub-registry "${sub}" at ${subDataPath}: ${err.message}`);
    }
  }

  // If this build target is the Inspector, decorate docs with joined fields
  const __isInspector = !!(extras && extras.inspector);
  if (__isInspector) {
    // Build quick lookups: docId -> projects / groups
    const byDocProjects = new Map();
    (registryProject || []).forEach(p => {
      const list = Array.isArray(p.docs) ? p.docs : (Array.isArray(p.documents) ? p.documents : []);
      list.forEach(did => {
        const arr = byDocProjects.get(did) || [];
        arr.push(p);
        byDocProjects.set(did, arr);
      });
    });

    const byDocGroups = new Map();
    (registryGroup || []).forEach(g => {
      const list = Array.isArray(g.docs) ? g.docs : (Array.isArray(g.documents) ? g.documents : []);
      list.forEach(did => {
        const arr = byDocGroups.get(did) || [];
        arr.push(g);
        byDocGroups.set(did, arr);
      });
    });

    (registryDocument || []).forEach(item => {
      const did = item && item.docId;
      if (!did) return;
      const projects = (byDocProjects.get(did) || []).map(p => p.projectId || p.name || p.id).filter(Boolean);
      const pubDate  = item.publicationDate || null;
      const year     = pubDate && /^\d{4}/.test(pubDate) ? parseInt(pubDate.slice(0,4), 10) : null;

      item.__projects = projects;
      item.__year = year;

    });
  }

  // --- Load MasterSuiteIndex (MSI) once and build a lineage → latest lookup
  const MSI_PATH = path.join(REGISTRIES_REPO_PATH, 'reports/masterSuiteIndex.json');
  let __msiLatestByLineage = null;
  try {
    const msiRaw = await fs.readFile(MSI_PATH, 'utf8');
    const msi = JSON.parse(msiRaw);
    if (msi && Array.isArray(msi.lineages)) {
      __msiLatestByLineage = new Map(
        msi.lineages
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
      const msiRaw = await fs.readFile(MSI_PATH, 'utf8');
      const msi = JSON.parse(msiRaw);
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
      // Optional visibility: uncomment for diagnostics
      // console.log(`[MSI] Built baseIndex entries: ${__msiBaseIndex.size}`);
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
      // Backwards compatibility flag for templates
      if (doc.isLatestAny) {
        doc.latestDoc = true;
        doc.docBase = key
        doc.docBaseLabel = labelFromLineageKey(key);
      } else {
        doc.newerDoc = true;
      }

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
  const __emitRefWarnings = (templateName === 'index');

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

      // Optional visibility: uncomment for diagnostics
      //console.log(`++ Checking refs for ${docId} ++`)

      const normResolved = [];
      const bibResolved = [];

      // Always consult MSI; only *upgrade* when the ref is undated.
      function getLatestRef(r, kind) {
        // Compute base form by stripping a date tail once; treat rest as the lineage base token
        const base = typeof r === 'string' ? r.replace(DATED_TAIL_RE, '') : r;
        const wasUndated = (base === r);
        let resolved = r;

        // Optional visibility: uncomment for diagnostics
        //console.log(`... checking ${r}`);
        //if (!wasUndated) console.log(`       (dated; base=${base})`);

        // If this reference is an exact docId present in our registry, skip MSI checks entirely
        if (__docIdSet && __docIdSet.has(r)) {
          //console.log(`    skipping ${r} (exact docId present in registry)`);
          refs.push(resolved);
          return { id: resolved };
        }

        if (__msiLatestByLineage) {
          // 1) Base-index fast path: try the base token regardless of dated/undated;
          //    only *apply* upgrade when undated to avoid rewriting explicit dates.
          if (__msiBaseIndex) {
            const hit = __msiBaseIndex.get(base);
            if (hit) {
              if (wasUndated) {
                const next = hit.latestBaseId || hit.latestAnyId || r;
                if (next !== r) {
                  resolved = next;
                  // Optional visibility: uncomment for diagnostics
                  //console.log(`   [Refs] Upgraded via baseIndex ${r} → ${resolved}`);
                }
              } 
                // Optional visibility: uncomment for diagnostics
                //else {
                //console.log(`[Refs] baseIndex hit for ${base} (dated ref, no upgrade)`);
              //}
            }
          }

          // 2) Fallback: compute lineage key from the *base* token and ask MSI by lineage
          if (resolved === r) {
            // Some keyers (ISO/IEC/IEC) expect a trailing '.' after the base token in docIds.
            // Example: "ISO.15444-1" → matcher is anchored up to a dot before the date tail.
            const baseForKey = (typeof base === 'string' && !base.endsWith('.')) ? (base + '.') : base;
            const key = lineageKeyFromDocId(baseForKey);
            // Optional visibility: uncomment for diagnostics
            //if (wasUndated) {
            //  console.log(`   [Refs] MSI probe undated: ${r}`);
            //  console.log(`       probeBase: ${baseForKey}`);
            //}
            if (key) {
              // Optional visibility: uncomment for diagnostics
              //if (wasUndated) {
              //  console.log(`       key: ${key}`);
              //}
              const li = __msiLatestByLineage.get(key);
              if (li) {
                if (wasUndated) {
                  // Optional visibility: uncomment for diagnostics
                  //console.log(`       HIT in MSI (latestBaseId=${li.latestBaseId} latestAnyId=${li.latestAnyId})`);
                  const next = li.latestBaseId || li.latestAnyId || r;
                  if (next !== r) {
                    resolved = next;
                    // Optional visibility: uncomment for diagnostics
                    //console.log(`   [Refs] Upgraded via lineage ${r} → ${resolved}`);
                  }
                } // Optional visibility: uncomment for diagnostics
                  //else {
                  //console.log('       MSI lineage hit (dated ref, no upgrade)');
                //}
              } // Optional visibility: uncomment for diagnostics
                //else if (wasUndated) {
                //console.log('       MISS in MSI');
                //}
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
      // Optional visibility: uncomment for diagnostics
      //console.log(`[Refs] for docId: ${docId}`)
      //console.log(refs)

      docReferences[docId] = refs;
      if (__emitRefWarnings && __noKeyWarned.size) {
        console.log(`[Refs] ${docId}: missing-lineage refs (unique) = ${__noKeyWarned.size}`);
      }
    }
  }

  /* load referenced by docs */

  for (let i in registryDocument) {

    let docId = registryDocument[i].docId

    function findReferenceBy(obj = docReferences, doc = docId) {
      
      var referencedBy = []

      Object.keys(obj).forEach((key) => {
        if (
          typeof obj[key] === 'object' &&
          obj[key] !== null &&
          obj[key].map((k) => k).includes(doc)
        ) {
          findReferenceBy(obj[key])
          referencedBy.push(key)
        }
      })

      if (!referencedBy.length) {
        return
      }
      registryDocument[i].referencedBy = referencedBy;
      referencedBy.sort();
      return referencedBy; 

    };

    findReferenceBy();
  }

  /* load reference tree */

  const referenceTree = []

  for (let i in docReferences) {

    let refs = docReferences[i]
    let allRefs = []

    function getAllDocs() {

      for (let docRefs in refs) {

        let docId = refs[docRefs]

        if (allRefs.includes(docId) !== true) {
          allRefs.push(docId)
        } 

        let nestedDocs = []
        let nestLevel = 1

        function docLookup() {
        
          if (Object.keys(docReferences).includes(docId) === true)  {

            let docs = docReferences[docId]
            let arrayLength = docs.length

            for (var d = 0; d < arrayLength; d++) {

              nestedDocs.push(docs[d])

              if (allRefs.includes(docs[d]) !== true) {
                allRefs.push(docs[d])              
              } 

            }

          } 

          if (nestedDocs.length) {
            nestLevel++
            while (nestLevel < 4) {
              for (let nD in nestedDocs) {
                docId = nestedDocs[nD]
                docLookup();
              }
            }
          }

        }
        docLookup();
      }

    }

    getAllDocs();   
    allRefs.sort();
    referenceTree[i] = allRefs

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
    } //else {
      //console.error(`Cannot find the status for referenced document: ${docId}`);
    //}

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

  const docProjs = []
  for (let i in registryProject) {
    
    let projs = registryProject[i]["docAffected"]
    for (let p in projs) {

      var docProj = {}
      docProj["docId"] = projs[p]
      docProj["workType"] = registryProject[i]["workType"]
      docProj["projectStatus"] = registryProject[i]["projectStatus"]
      docProj["newDoc"] = registryProject[i]["docId"]
      docProj["projApproved"] = registryProject[i]["projApproved"]
      docProjs.push(docProj)

    }
  }

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

      if (pD === registryDocument[i]["docId"]) {
        currentWork.push(pW + " - " + pS)
      }
    }

    for (let ps in docProjs) {
      let psD = docProjs[ps]["docId"]
      let psW = docProjs[ps]["workType"]
      let psS = docProjs[ps]["projectStatus"]

      if (psD === registryDocument[i]["docId"]) {
        currentWork.push(psW + " - " + psS)
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
            r = registryDocument[d]["repo"]
            registryProject[i].repo = r
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
              r = registryDocument[d]["repo"]
              registryProject[i].repo = r
            }
          }
        }
      }
    }  

  }

  /* external json lookup helpers */

  hb.registerHelper('docProjLookup', function(collection, id) {
      var collectionLength = collection.length;

      for (var i = 0; i < collectionLength; i++) {
          if (collection[i].docId === id) {
              return collection[i];
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

  /* determine if build on GH to remove "index.html" from internal link */

  let htmlLink = "index.html"

  if ('GH_PAGES_BUILD' in process.env) {
    htmlLink = ""
  }
  
  /* apply template */
  
  var html = template({
    "data" : registryDocument,
    "dataDocuments": registryDocument,
    "dataGroups" : registryGroup,
    "dataProjects" : registryProject,
    "inspector": __isInspector,
    "htmlLink": htmlLink,
    "docProjs": docProjs,
    "date" :  new Date(),
    "csv_path": CSV_SITE_PATH,
    "site_version": site_version,
    "listType": listType,
    "idType": idType,
    "listTitle": listTitle,
    "templateName": templateName
  });
  
  /* write HTML file */
  
  await fs.writeFile(path.join(BUILD_PATH, PAGE_SITE_PATH), html, 'utf8');
  
  /* copy in static resources */
  await copyRecursive(SITE_PATH, BUILD_PATH);
  
  // Build card search index (search-index.json + facets.json) once per run
  // Only trigger from the main index page to avoid duplicate executions
  if (templateName === 'index') {
    try {
      const { stdout } = await execFile('node', [path.join('src','main','scripts','build.search-index.js')]);
      if (stdout && stdout.trim()) console.log(stdout.trim());
    } catch (e) {
      console.warn('[cards] Index build failed:', e && e.message ? e.message : e);
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
    const csv = await json2csvAsync(data);
    await writeCSV(outputFileName, csv);
  })();

  console.log(`Build of ${templateName} completed`)
};

module.exports = {
  buildRegistry,
}

void (async () => {

  for (const cfg of registries) {
    await buildRegistry(cfg);
  }

  const tplCards = await fs.readFile(path.join('src','main','templates','cards.hbs'), 'utf8');
  const renderCards = hb.compile(tplCards);
  await fs.writeFile(path.join('build','cards.html'), renderCards({ 
    templateName: 'cards',
    listTitle: 'Cards',
    htmlLink: 'index.html',
    listType: 'documents',
    csv_path: 'documents.csv',
    site_version: (await execFile('git', ['rev-parse','HEAD'])).stdout.trim(),
    date: new Date().toISOString()
  }), 'utf8');
  console.log('[build] Wrote build/cards.html');

})().catch(console.error)
