#!/usr/bin/env node
/*
 * Scans documents.json for fields where `$meta.overridden === true` and emits a flat report.
 * Defaults:
 *   --in  src/main/data/documents.json
 *   --out src/main/reports/documents_audit.json
 * Options:
 *   --publisher SMPTE     restrict to publisher (exact match); repeatable
 *   --pretty 2            JSON spaces (0 for minified)
 */

const fs = require('fs');
const path = require('path');

function has(flag) { return process.argv.includes(flag); }
function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i+1] ? process.argv[i+1] : def;
}

const IN  = arg('--in',  'src/main/data/documents.json');
const OUT = arg('--out', 'src/main/reports/documents_audit.json');
const PRETTY = Number(arg('--pretty', '2')); // 0..n

// Collect any --publisher filters (repeatable)
const PUB_FILTERS = process.argv
  .map((v, i, a) => (a[i-1] === '--publisher' ? v : null))
  .filter(Boolean);

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) {
    console.error(`✖ Failed to read ${p}:`, e.message);
    process.exit(1);
  }
}

function getAtPath(obj, pathStr) {
  if (!obj) return undefined;
  const parts = String(pathStr).split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) {
      const i = Number(p);
      if (Number.isNaN(i)) return undefined;
      cur = cur[i];
    } else {
      cur = cur[p];
    }
  }
  return cur;
}

function collectOverridesFromDoc(doc) {
  const items = [];
  function walk(node, prefix = []) {
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (!v) continue;
      if (k.endsWith('$meta') && typeof v === 'object' && v.overridden === true) {
        const baseKey = k.slice(0, -5);
        const fieldPath = [...prefix, baseKey].join('.');
        const orig = Object.prototype.hasOwnProperty.call(v, 'originalValue') ? v.originalValue : null;
        const cur = getAtPath(doc, fieldPath);
        // skip if originalValue is null, empty string, empty array, or empty object
        if (
          orig == null ||
          (typeof orig === 'string' && orig.trim() === '') ||
          (Array.isArray(orig) && orig.length === 0) ||
          (typeof orig === 'object' && !Array.isArray(orig) && Object.keys(orig).length === 0)
        ) {
          continue;
        }
        items.push({
          docId: String(doc.docId || ''),
          publisher: doc.publisher || null,
          docLabel: doc.docLabel || null,
          field: fieldPath,
          originalValue: orig,
          currentValue: cur,
          source: v.source || null,
          confidence: v.confidence || null,
          note: v.note || null,
          updated: v.updated || null
        });
      } else if (typeof v === 'object') {
        walk(v, [...prefix, k]);
      }
    }
  }
  walk(doc, []);
  return items;
}

function filterByPublisher(items) {
  if (!PUB_FILTERS.length) return items;
  const set = new Set(PUB_FILTERS);
  return items.filter(r => r.publisher && set.has(r.publisher));
}

function collect(allDocs) {
  const out = [];
  for (const d of Array.isArray(allDocs) ? allDocs : []) {
    if (!d || !d.docId) continue;
    const rows = collectOverridesFromDoc(d);
    if (rows.length) out.push(...rows);
  }
  return filterByPublisher(out);
}

function main() {
  const docs = readJson(IN);
  const items = collect(docs);

  ensureDir(OUT);

  // Group by field name and sort alphabetically
  const grouped = {};
  for (const row of items) {
    const key = row.field || '∅';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(row);
  }
  const sortedKeys = Object.keys(grouped).sort();
  const groupedReport = {};
  for (const k of sortedKeys) {
    groupedReport[k] = {
      total: grouped[k].length,
      items: grouped[k]
    };
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    sourcePath: IN,
    total: items.length,
    grouped: groupedReport
  };

  const body = JSON.stringify(payload, null, Number.isFinite(PRETTY) ? PRETTY : 2);
  fs.writeFileSync(OUT, body, 'utf8');

  console.log(`📝 Documents audit written: ${OUT} (fields=${sortedKeys.length}, rows=${items.length})`);

  // Small console peek for sanity
  const byPublisher = new Map();
  for (const r of items) {
    const k = r.publisher || '∅';
    byPublisher.set(k, (byPublisher.get(k) || 0) + 1);
  }
  console.log('📊 Overrides by publisher:', Object.fromEntries(byPublisher.entries()));
}

if (require.main === module) {
  main();
}