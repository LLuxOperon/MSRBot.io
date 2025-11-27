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

// Theme preference handling (light/dark/auto via localStorage)
(function () {
  var STORAGE_KEY = 'msrTheme';
  var MODE_SYSTEM = 'system';

  function getStoredMode() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }

  function storeMode(mode) {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch (e) {
      // ignore storage failures
    }
  }

  function getSystemMode() {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  }

  function describeMode(requested) {
    if (requested === MODE_SYSTEM) {
      return 'Auto';
    }
    if (requested === 'light') {
      return 'Light';
    }
    if (requested === 'dark') {
      return 'Dark';
    }
    return requested;
  }

  function getEffectiveThemeFromDom() {
    var eff = document.documentElement.getAttribute('data-bs-theme');
    return (eff === 'dark') ? 'dark' : 'light';
  }

  function applyThemeToPublisherLogos(effectiveMode) {
    var mode = effectiveMode || getEffectiveThemeFromDom();
    var isDark = (mode === 'dark');
    var imgs = document.querySelectorAll('img.publisher-logo');

    imgs.forEach(function (img) {
      if (!img) return;
      var light = img.getAttribute('data-logo-light');
      var dark = img.getAttribute('data-logo-dark');
      var target = null;

      if (isDark && dark) {
        target = dark;
      } else if (light) {
        target = light;
      }

      if (target && img.getAttribute('src') !== target) {
        img.setAttribute('src', target);
      }
    });
  }

  // Expose a hook so other scripts (e.g., docList.js) can force a re-sync after rendering
  if (!window.msrApplyThemeToPublisherLogos) {
    window.msrApplyThemeToPublisherLogos = applyThemeToPublisherLogos;
  }

  function installPublisherLogoObserver() {
    if (typeof MutationObserver === 'undefined') return;
    try {
      var observer = new MutationObserver(function (mutations) {
        var hasAdded = false;
        for (var i = 0; i < mutations.length; i++) {
          var m = mutations[i];
          if (m.addedNodes && m.addedNodes.length) {
            hasAdded = true;
            break;
          }
        }
        if (!hasAdded) return;
        // Re-sync any newly added publisher-logo images to the current effective theme
        applyThemeToPublisherLogos();
      });
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      } else {
        document.addEventListener('DOMContentLoaded', function () {
          if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
          }
        });
      }
    } catch (e) {
      if (window.console && console.warn) {
        console.warn('[msrbot] Failed to install publisher logo observer:', e);
      }
    }
  }

  function updateThemeIndicators(requested) {
    var label = describeMode(requested);

    // Update Preferences link tooltip to reflect current mode
    var prefsTrigger = document.getElementById('user-prefs');
    if (prefsTrigger) {
      prefsTrigger.title = 'Set Preferences';
    }

    // Update the inline label next to Theme in both the hidden template
    // and any currently visible popover content.
    var labelNodes = document.querySelectorAll(
      '#user-prefs-popover-content #theme-current-label, .popover #theme-current-label'
    );
    labelNodes.forEach(function (el) {
      el.textContent = '(Current Selection: ' + label + ')';
    });
  }

  function applyMode(mode) {
    var requested = mode || MODE_SYSTEM;
    var effective = (!mode || mode === MODE_SYSTEM) ? getSystemMode() : mode;
    // Store the logical mode (system/light/dark) for debugging/inspection
    document.documentElement.setAttribute('data-msr-theme', requested);
    document.documentElement.setAttribute('data-bs-theme', effective);

    // Keep UI indicators in sync (tooltip + inline label)
    updateThemeIndicators(requested);

    // Flip publisher logos to match the effective theme
    applyThemeToPublisherLogos(effective);
  }

  function initTheme() {
    var stored = getStoredMode();
    var mode = stored || MODE_SYSTEM;
    applyMode(mode);
  }

  function handleSystemChange() {
    var stored = getStoredMode();
    // Only react to system changes when user preference is Auto (system)
    if (!stored || stored === MODE_SYSTEM) {
      applyMode(MODE_SYSTEM);
    }
  }

  // Watch for OS-level dark/light changes when matchMedia is available
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) {
      mq.addEventListener('change', handleSystemChange);
    } else if (mq.addListener) {
      mq.addListener(handleSystemChange);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    initTheme();
    installPublisherLogoObserver();
  });

  // Delegate clicks from Preferences popover buttons/links
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-bs-theme-choice]');
    if (!btn) return;

    e.preventDefault();
    var mode = btn.getAttribute('data-bs-theme-choice') || MODE_SYSTEM;
    storeMode(mode);
    applyMode(mode);

    // Hide the preferences popover if it is open
    if (window.bootstrap && bootstrap.Popover) {
      var trigger = document.getElementById('user-prefs');
      if (trigger) {
        var inst = bootstrap.Popover.getInstance(trigger);
        if (inst) inst.hide();
      }
    }
  });
})();