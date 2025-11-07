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

const fs = require("fs");
const Ajv = require("ajv");
const jsonSourceMap = require("json-source-map");
const { listRegistries } = require("./utils/registryList");

async function registries() {
  const ajvFactory = new Ajv({ allErrors: true });
  const regs = {};

  for (const reg of listRegistries()) {
    if (!fs.existsSync(reg.dataPath)) {
      console.warn(`[WARN] No data file found for ${reg.name}, skipping...`);
      continue;
    }

    console.log(`\nChecking ${reg.name} registry...`);

    // Load schema + data
    const schema = JSON.parse(fs.readFileSync(reg.schemaPath, "utf8"));
    const data = JSON.parse(fs.readFileSync(reg.dataPath, "utf8"));

    // Compile and validate schema
    const validateFn = ajvFactory.compile(schema);
    const valid = validateFn(data);

    if (!valid) {
      let errorMessage = '';
      const sourceMap = jsonSourceMap.stringify(data, null, 2);
      const jsonLines = sourceMap.json.split('\n');

      validateFn.errors.forEach(error => {
        errorMessage += '\n\n' + ajvFactory.errorsText([error]);
        const errorPointer = sourceMap.pointers[error.instancePath || error.dataPath];
        if (errorPointer) {
          errorMessage += '\n> ' + jsonLines
            .slice(errorPointer.value.line, errorPointer.valueEnd.line)
            .join('\n> ');
        }
      });

      console.error(`❌ Schema validation failed for ${reg.name} registry:\n${errorMessage}`);
      throw new Error(`Schema validation failed for ${reg.name}`);
    }

    console.log(`✅ Schema validation passed for ${reg.name}`);

    // ---- Clear separation for registry-specific validation ----
    console.log(`🔍 Running additional validation for ${reg.name}...`);

    try {
      if (fs.existsSync(reg.validatePath)) {
        const additionalChecks = require(reg.validatePath);
        if (typeof additionalChecks === "function") {
          additionalChecks(data, reg.name);
        }
      }
    } catch (err) {
      if (err.code !== "MODULE_NOT_FOUND") throw err;
    }

    regs[reg.name] = { name: reg.name, data, dataFilePath: reg.dataPath };
  }

  return regs;
}

async function validateAll() {
  console.log("Starting full schema + additional validation...");
  const regs = await registries();
  console.log(`\nAll ${Object.keys(regs).length} registries validated successfully.`);
}

if (require.main === module) {
  validateAll().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { registries };