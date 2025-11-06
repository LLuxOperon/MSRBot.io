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

const axios = require('axios');

async function resolveUrl(url) {
  try {
    const res = await axios.head(url, {
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: () => true,
    });

    if (res.status >= 200 && res.status < 400) {
      const resolvedUrl = res.request?.res?.responseUrl || url;
      return {
        ok: true,
        resolvedUrl
      };
    } else {
      return {
        ok: false,
        message: `Unreachable (${res.status})`,
        code: String(res.status)
      };
    }
  } catch (e) {
    const errCode = String(e.response?.status || e.code || e.message);
    return {
      ok: false,
      message: `Unreachable (${errCode})`,
      code: errCode
    };
  }
}

// Inject resolvedHref into the document object if needed
async function resolveUrlAndInject(obj, field = 'href') {
  if (!obj || !obj[field]) return;

  const url = obj[field];
  try {
    const result = await resolveUrl(url);
    if (result.ok && result.resolvedUrl && result.resolvedUrl !== url) {
      const resolvedField = `resolved${field.charAt(0).toUpperCase()}${field.slice(1)}`;
      obj[resolvedField] = result.resolvedUrl;
    }
  } catch (err) {
    console.warn(`⚠️ Failed to resolve URL: ${url}`);
  }
}

// Simple reachability check — HEAD first, GET fallback for PDF/HEAD-blocking servers
async function urlReachable(url) {
  try {
    // HEAD check
    const head = await axios.head(url, {
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: () => true,
    });
    if (head.status >= 200 && head.status < 400) return true;

    // Some servers 405/403 on HEAD for PDFs — fallback to lightweight GET
    if (head.status === 405 || head.status === 403) {
      const get = await axios.get(url, {
        timeout: 10000,
        maxRedirects: 5,
        validateStatus: () => true,
        responseType: 'stream', // don’t download full file
      });
      if (get.data && typeof get.data.destroy === 'function') get.data.destroy();
      return get.status >= 200 && get.status < 400;
    }
  } catch (_) {
    // ignore, return false below
  }
  return false;
}

module.exports = { resolveUrlAndInject, resolveUrl, urlReachable };