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

module.exports = (registry, name) => {
  /* Check for duplicate keys in the registry */
  const keys = [];

  for (let i in registry) {
    if (keys.includes(registry[i].docId)) {
      throw name + " registry key " + registry[i].docId + " is duplicated";
    }
    keys.push(registry[i].docId);
  }

  /* Ensure registry is sorted */
  for (let i = 1; i < registry.length; i++) {
    if ((registry[i - 1].docId).toUpperCase() >= (registry[i].docId).toUpperCase()) {
      throw name + " sort order " + registry[i - 1].docId + " is " +
        ((registry[i - 1].docId === registry[i].docId) ? "duplicated" : "not sorted");
    }
  }

  /* ---- $meta presence check ---- */
  const containerFields = new Set(["status", "references", "workInfo"]);

  function checkMeta(obj, path = "", rootDocId = null) {
    for (const key of Object.keys(obj)) {
      if (key.endsWith("$meta")) continue;

      // Skip container-level $meta checks at top level
      if (containerFields.has(key) && path === "") {
        if (typeof obj[key] === "object") {
          checkMeta(obj[key], `${key}.`, rootDocId);
        }
        continue;
      }

      const metaKey = `${key}$meta`;
      if (!(metaKey in obj)) {
        console.warn(
          `[WARN] Missing $meta for '${path}${key}' in docId '${rootDocId || "(unknown)"}'`
        );
      }

      // Recurse into nested objects
      if (typeof obj[key] === "object" && !Array.isArray(obj[key])) {
        checkMeta(obj[key], `${path}${key}.`, rootDocId);
      }
    }
  }

  registry.forEach(doc => checkMeta(doc, "", doc.docId));
};