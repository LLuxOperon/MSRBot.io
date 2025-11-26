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

/* "Back To Top" button functionality (vanilla JS, no jQuery) */

document.addEventListener('DOMContentLoaded', function () {
  var toTopBtn = document.getElementById('toTopBtn');
  if (toTopBtn) {
    // Show/hide button based on scroll position
    window.addEventListener('scroll', function () {
      if (window.scrollY > 20) {
        toTopBtn.style.display = 'block';
      } else {
        toTopBtn.style.display = 'none';
      }
    });

    // Native smooth scroll
    toTopBtn.addEventListener('click', function (e) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
});

/* Dynamic navbar active state based on current URL vs nav hrefs (vanilla JS) */
document.addEventListener('DOMContentLoaded', function () {
  try {
    var here = window.location && window.location.href ? window.location.href : '';
    if (!here) return;

    // Normalize common index.html endings for comparison
    here = here.replace(/\/index\.html([?#].*)?$/, '/$1');

    var navLinks = document.querySelectorAll('.navbar .nav-link[id^="nav-"]');
    var bestMatch = null;
    var bestLen = 0;

    navLinks.forEach(function (link) {
      if (!link || !link.href) return;
      var href = link.href;

      // Normalize link href similarly
      href = href.replace(/\/index\.html([?#].*)?$/, '/$1');

      // We want the longest href that is a prefix of the current URL
      if (here.indexOf(href) === 0 && href.length > bestLen) {
        bestMatch = link;
        bestLen = href.length;
      }
    });

    // If nothing matched as a prefix, fall back to home if present
    if (!bestMatch) {
      bestMatch = document.getElementById('nav-home');
    }

    if (bestMatch) {
      bestMatch.classList.add('active');
    }
  } catch (e) {
    if (window && window.console && console.warn) {
      console.warn('[msrbot] Failed to set active nav link:', e);
    }
  }
});