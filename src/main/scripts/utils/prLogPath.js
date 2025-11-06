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
const path = require('path');

function getPrLogPath() {
  // PR/CI mode (pull_request OR manual run flagged as PR)
  if (
    process.env.GITHUB_EVENT_NAME === "pull_request" ||
    process.env.IS_PR_RUN === "true"
  ) {
    if (process.env.PR_LOG_PATH) {
      // If PR_LOG_PATH ends with '.log', treat it as a file path
      if (process.env.PR_LOG_PATH.endsWith('.log')) {
        return process.env.PR_LOG_PATH;
      }
      // Otherwise treat as a directory and append file name
      return path.join(process.env.PR_LOG_PATH, 'pr-log.log');
    }
    // Default: use runner temp dir
    return path.join(process.env.RUNNER_TEMP || '.', 'pr-log.log');
  }

  // Local run → reports folder with timestamp
  const reportsDir = path.resolve(__dirname, '../../logs/extract-runs/');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  const ts = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
  return path.join(reportsDir, `pr-log-${ts}.log`);
}

module.exports = { getPrLogPath };