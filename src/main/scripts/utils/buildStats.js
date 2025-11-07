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

const fs = require('fs');

// Source registry snapshot used for stats
const docsPath = 'src/main/data/documents.json';
const documents = JSON.parse(fs.readFileSync(docsPath, 'utf8'));

// Basic counts
const totalDocs = documents.length;
const activeDocs = documents.filter(d => d?.status?.active === true).length;
const supersededDocs = documents.filter(d => d?.status?.superseded === true).length;

// Reference counts (normative + bibliographic)
const references = documents.reduce((sum, d) => {
  const normative = Array.isArray(d.references?.normative) ? d.references.normative.length : 0;
  const bibliographic = Array.isArray(d.references?.bibliographic) ? d.references.bibliographic.length : 0;
  return sum + normative + bibliographic;
}, 0);

// Publisher stats (unique count)
const publishers = new Set(
  documents
    .map(d => (typeof d.publisher === 'string' && d.publisher.trim().length ? d.publisher.trim() : null))
    .filter(Boolean)
).size;

// docType distribution (grouped counts)
const docsByType = documents.reduce((acc, d) => {
  const key = (typeof d.docType === 'string' && d.docType.trim().length) ? d.docType.trim() : 'Unknown';
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

// Compose stats object
const stats = {
  generatedAt: new Date().toISOString(),

  // New structured top-level bucket to allow future siblings (e.g., "namespaces", "references", etc.)
  documents: {
    total: totalDocs,
    references,
    publishers,
    active: activeDocs,
    //superseded: supersededDocs,
    docTypes: Object.keys(docsByType).length,
    docsByType
  }
};

// Write to the API stats file (consumed by site as /api/stats.json)
const outPath = 'build/api/stats.json';
fs.mkdirSync('build/api', { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(stats, null, 2));