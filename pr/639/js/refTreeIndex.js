(function () {
  var form = document.getElementById('rt-search-form');
  var input = document.getElementById('rt-docid');
  var errorEl = document.getElementById('rt-search-error');
  var resultsEl = document.getElementById('rt-search-results');
  var listEl = document.getElementById('rt-most-connected');

  // Shared registry data + index
  var registryDocs = null;
  var registryIndexBuilt = false;

  function safeLen(v) {
    if (Array.isArray(v)) return v.length;
    if (v && typeof v === 'object') return Object.keys(v).length;
    return 0;
  }

  function normalizeCompact(str) {
    return String(str || '')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[–—\-]+/g, '-') // normalize dashes
      .replace(/\./g, '');
  }

  // Simple HTML-escape helper for safe rendering
  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function buildSearchIndex() {
    if (!Array.isArray(registryDocs) || registryIndexBuilt) return;
    // No heavy structures needed yet; we compute scores on the fly in search.
    registryIndexBuilt = true;
  }

  // Load registry once and reuse
  var registryPromise = (function () {
    if (!listEl && !form) return Promise.resolve([]);
    return fetch('../docs/_data/documents.json')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (docs) {
        if (!Array.isArray(docs)) docs = [];
        registryDocs = docs;
        buildSearchIndex();
        // Populate most-connected list if present
        if (listEl) {
          populateMostConnected();
        }
        return docs;
      })
      .catch(function (err) {
        console.error('[refTreeIndex] Failed to load documents.json:', err);
        if (listEl) {
          listEl.innerHTML = '<li class="text-muted small">Could not load registry data.</li>';
        }
        return [];
      });
  })();

  function populateMostConnected() {
    if (!listEl) return;
    if (!Array.isArray(registryDocs) || !registryDocs.length) {
      listEl.innerHTML = '<li class="text-muted small">No registry data available.</li>';
      return;
    }

    var scored = [];
    for (var i = 0; i < registryDocs.length; i++) {
      var d = registryDocs[i] || {};
      var id = d.docId;
      if (!id) continue;

      var upstream = safeLen(d.referencedBy);

      var refsResolved = d.referencesResolved || {};
      var norm = Array.isArray(refsResolved.normative) ? refsResolved.normative : [];
      var bib = Array.isArray(refsResolved.bibliographic) ? refsResolved.bibliographic : [];
      var downstream = norm.length + bib.length;

      var total = upstream + downstream;
      if (!total) continue; // skip totally isolated docs

      scored.push({
        id: id,
        label: d.docLabel || d.docTitle || id,
        title: d.docTitle || '',
        upstream: upstream,
        downstream: downstream,
        total: total
      });
    }

    if (!scored.length) {
      listEl.innerHTML = '<li class="text-muted small">No connected documents found.</li>';
      return;
    }

    scored.sort(function (a, b) {
      if (b.total !== a.total) return b.total - a.total;
      return a.id.localeCompare(b.id);
    });

    var topN = scored.slice(0, 10);
    listEl.innerHTML = '';

    topN.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'mb-2';

      var link = document.createElement('a');
      link.className = 'd-inline-block';
      link.href = '../reftree/' + encodeURIComponent(item.id) + '/';
      link.textContent = (item.label || item.id) + ' (' + item.id + ')';

      var titleDiv = document.createElement('div');
      titleDiv.className = 'text-muted small';
      if (item.title) {
        titleDiv.textContent = item.title;
      }

      var meta = document.createElement('div');
      meta.className = 'text-muted small';
      meta.textContent =
        item.upstream + ' upstream \u2022 ' + item.downstream + ' downstream';

      li.appendChild(link);
      if (item.title) {
        li.appendChild(titleDiv);
      }
      li.appendChild(meta);
      listEl.appendChild(li);
    });
  }

  function clearSearchMessages() {
    if (errorEl) {
      errorEl.classList.add('d-none');
      errorEl.textContent = '';
    }
    if (resultsEl) {
      resultsEl.innerHTML = '';
      resultsEl.classList.add('d-none');
    }
  }

  function showError(msg) {
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.classList.remove('d-none');
  }

  function showSuggestions(query, matches) {
    if (!resultsEl) return;
    if (!matches || !matches.length) {
      resultsEl.innerHTML = '<div class="text-muted">Try a different docId, label, or part of the title.</div>';
      resultsEl.classList.remove('d-none');
      return;
    }

    var html = '<div class="fw-semibold mb-1">Multiple matches found for "<span class="fst-italic">' +
      escapeHtml(query) +
      '</span>":</div>';
    html += '<ul class="list-unstyled mb-0">';
    matches.slice(0, 10).forEach(function (m) {
      html += '<li class="mb-1">';
      html += '<a href="../reftree/' + encodeURIComponent(m.id) + '/" class="link-primary">' +
        escapeHtml(m.label || m.id) + ' (' + escapeHtml(m.id) + ')' +
        '</a>';
      if (m.title) {
        html += '<div class="text-muted small">' + escapeHtml(m.title) + '</div>';
      }
      html += '</li>';
    });
    if (matches.length > 10) {
      html += '<li class="mt-2">';
      html += '<button type="button" id="rt-show-all" class="btn btn-outline-secondary btn-sm">';
      html += 'Show all ' + matches.length + ' matches';
      html += '</button>';
      html += '</li>';
    }
    html += '</ul>';
    resultsEl.innerHTML = html;
    resultsEl.classList.remove('d-none');

    var btn = resultsEl.querySelector('#rt-show-all');
    if (btn) {
      btn.addEventListener('click', function () {
        var fullHtml = '<div class="fw-semibold mb-1">Showing all ' +
          matches.length + ' matches for "<span class="fst-italic">' +
          escapeHtml(query) +
          '</span>":</div>';
        fullHtml += '<ul class="list-unstyled mb-0">';
        matches.forEach(function (m) {
          fullHtml += '<li class="mb-1">';
          fullHtml += '<a href="../reftree/' + encodeURIComponent(m.id) + '/" class="link-primary">' +
            escapeHtml(m.label || m.id) + ' (' + escapeHtml(m.id) + ')' +
            '</a>';
          if (m.title) {
            fullHtml += '<div class="text-muted small">' + escapeHtml(m.title) + '</div>';
          }
          fullHtml += '</li>';
        });
        fullHtml += '</ul>';
        resultsEl.innerHTML = fullHtml;
      });
    }
  }

  function scoreDocAgainstQuery(doc, query, queryCompact) {
    var id = String(doc.docId || '');
    var label = String(doc.docLabel || doc.docTitle || id);
    var title = String(doc.docTitle || '');

    var idLower = id.toLowerCase();
    var labelLower = label.toLowerCase();
    var titleLower = title.toLowerCase();
    var idCompact = normalizeCompact(id);
    var labelCompact = normalizeCompact(label);

    // Exact-style matches first
    if (idLower === query) return 100;
    if (labelLower === query) return 95;
    if (titleLower === query) return 90;

    // Compact matches (handles spaces vs dots vs dashes)
    if (idCompact === queryCompact) return 85;
    if (labelCompact === queryCompact) return 80;

    // Substring matches in label/title
    if (labelLower.indexOf(query) !== -1) return 70;
    if (titleLower.indexOf(query) !== -1) return 65;

    // Substring match in docId as a weaker signal
    if (idLower.indexOf(query) !== -1) return 60;

    return 0;
  }

  function findBestMatches(rawQuery) {
    if (!Array.isArray(registryDocs) || !registryDocs.length) return [];

    var q = String(rawQuery || '').trim().toLowerCase();
    if (!q) return [];

    var qCompact = normalizeCompact(q);
    var scored = [];

    for (var i = 0; i < registryDocs.length; i++) {
      var d = registryDocs[i];
      if (!d || !d.docId) continue;
      var s = scoreDocAgainstQuery(d, q, qCompact);
      if (s > 0) {
        scored.push({
          score: s,
          id: d.docId,
          label: d.docLabel || d.docTitle || d.docId,
          title: d.docTitle || ''
        });
      }
    }

    if (!scored.length) return [];

    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.id.localeCompare(b.id);
    });

    return scored;
  }

  function handleSearchSubmit(evt) {
    evt.preventDefault();
    if (!input) return;

    var raw = (input.value || '').trim();
    clearSearchMessages();

    if (!raw) {
      showError('Please enter something to search');
      return;
    }

    registryPromise.then(function () {
      if (!Array.isArray(registryDocs) || !registryDocs.length) {
        showError('Registry data is not available yet. Try again after the page finishes loading.');
        return;
      }

      var matches = findBestMatches(raw);
      if (!matches.length) {
        showError('No matching documents found.');
        showSuggestions(raw, []);
        return;
      }

      // If there is exactly one clear match, go straight to it.
      if (matches.length === 1 || (matches[0].score >= 90 && (matches.length === 1 || matches[0].score > matches[1].score))) {
        var targetId = matches[0].id;
        var target = '../reftree/' + encodeURIComponent(targetId) + '/';
        window.location.assign(target);
        return;
      }

      // Otherwise, present choices to the user and avoid 404s.
      showSuggestions(raw, matches);
    });
  }

  if (form && input) {
    form.addEventListener('submit', handleSearchSubmit);
  }
})();