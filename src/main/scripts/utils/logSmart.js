const fs = require('fs');
const path = require('path');

// Where the full, untruncated log is written
const RUNNER_TEMP = process.env.RUNNER_TEMP || '/tmp';
const FULL_LOG = path.join(RUNNER_TEMP, 'extract-full.log');

// Tripwire: how many bytes to allow to console before auto-quieting
// Defaults to ~3.5 MiB to stay under GitHub Actions' ~4 MiB/step limit.
const BYTE_BUDGET = Number(process.env.MSR_CONSOLE_BUDGET || 3.5 * 1024 * 1024);

// Heartbeat: print a progress line every N docs (default 100)
const HEARTBEAT_EVERY = Number(process.env.MSR_HEARTBEAT_EVERY || 50);
const HEARTBEAT_PREFIX = process.env.MSR_HEARTBEAT_PREFIX || ' 💓 ... still processing';

console.log(`[ Heartbeat and log settings ]\nMSR_CONSOLE_BUDGE: ${BYTE_BUDGET} (bytes) \nMSR_HEARTBEAT_EVERY: ${HEARTBEAT_EVERY} \n  MSR_HEARTBEAT_PREFIX: "${HEARTBEAT_PREFIX}"`);

// Internal state
const _origConsoleLog = console.log.bind(console);
const _logStream = fs.createWriteStream(FULL_LOG, { flags: 'a' });
let _consoleBytes = 0;
let _hushed = false;
let _lastBeatCount = 0;

// Always write to file; optionally to console (until hushed)
function logSmart(line) {
  const s = String(line);
  _logStream.write(s + '\n');
  if (_hushed) return;

  const b = Buffer.byteLength(s + '\n');
  if (_consoleBytes + b > BYTE_BUDGET) {
    _hushed = true;
    _origConsoleLog(`🔇 Console quieted after ~${(_consoleBytes/1048576).toFixed(2)} MiB. Continuing in ${FULL_LOG}`);
    return;
    // (Subsequent lines will be file-only until process end)
  }
  _consoleBytes += b;
  _origConsoleLog(s);
}
// Optional: use as a drop-in replacement where you had console.log on noisy paths
// console.log(...)  ->  logSmart(...)

// Heartbeat helper — call periodically with (done, total)
function heartbeat(done, total) {
  if (done - _lastBeatCount < HEARTBEAT_EVERY) return;
  _lastBeatCount = done;
  const pct = total ? ` (${Math.floor((done / total) * 100)}%)` : '';
  logSmart(`[HB pid:${process.pid}] ${HEARTBEAT_PREFIX} — ${done}${total ? '/' + total : ''}${pct}`);
}

process.on('exit', () => {
  _logStream.write(`Full extract log saved to: ${FULL_LOG}\n`);
  _logStream.end();
});

module.exports = { logSmart, heartbeat };