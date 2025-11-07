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

/* Canonicalize the registries */

const fs = require('fs');
const stringify = require('json-stable-stringify');
const { listRegistries } = require('./utils/registryList');
const documentsCanonicalize = require('./documents.canonicalize');

async function run() {
  const regs = {};

  for (const reg of listRegistries()) {
    if (!fs.existsSync(reg.dataPath)) {
      console.warn(`[WARN] No data file found for ${reg.name}, skipping...`);
      continue;
    }
    regs[reg.name] = {
      name: reg.name,
      data: JSON.parse(fs.readFileSync(reg.dataPath, 'utf8')),
      dataFilePath: reg.dataPath
    };
  }

  // Canonicalize each registry
  for (const reg_name in regs) {
    console.log(`🔄 Canonicalizing ${regs[reg_name].name} registry`);

    if (reg_name === "documents") {
      documentsCanonicalize(regs[reg_name].data, regs[reg_name].dataFilePath);
    } else {
      fs.writeFileSync(
        regs[reg_name].dataFilePath,
        stringify(regs[reg_name].data, { space: '  ' }) + "\n"
      );
    }
  }
}

run().catch(err => {
  console.error("Cannot load registries", err);
  process.exit(1);
});