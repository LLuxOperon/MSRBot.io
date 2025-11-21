document.addEventListener('DOMContentLoaded', () => {
  const cards = Array.from(document.querySelectorAll('.group-card'));
  if (!cards.length) return;

  const searchInput       = document.getElementById('groupSearch');
  const clearBtn          = document.getElementById('groupClearFilters');
  const resultCountEl     = document.getElementById('groupResultCount');
  const filterSummaryEl   = document.getElementById('groupFilterSummary');
  const activeFiltersEl   = document.getElementById('groupActiveFilters');
  const resultsLineEl     = document.getElementById('groupResultsLine');
  const totalGroups       = cards.length;

  const facetRoot         = document.getElementById('groupFacet');
  const facetDrawerBody   = document.getElementById('groupFacetDrawerBody');

  const state = {
    search: '',
    org:    new Set(),
    tc:     new Set(),
    type:   new Set(),
    status: new Set(),
  };

  // --- Build basic map for TC ancestry: id -> { id, type, parent }
  const groupMap = new Map();
  cards.forEach(card => {
    const ds = card.dataset;
    groupMap.set(ds.groupId, {
      id:     ds.groupId,
      type:   ds.type || '',
      parent: ds.parentId || ''
    });
  });

  function findTcId(groupId) {
    let node = groupMap.get(groupId);
    while (node) {
      if (node.type === 'TC') return node.id;
      if (!node.parent) break;
      node = groupMap.get(node.parent);
    }
    return '';
  }

  // Precompute TC ids + search text on each card
  cards.forEach(card => {
    const ds  = card.dataset;
    const gid = ds.groupId;
    const type = ds.type || '';

    let tcId = '';
    if (type === 'TC') {
      tcId = gid;
    } else {
      tcId = findTcId(gid);
    }
    if (tcId) {
      card.dataset.tc = tcId;
    }

    const text = [
      ds.org || '',
      ds.type || '',
      ds.status || '',
      ds.tc || '',
      (card.textContent || '')
    ]
      .join(' ')
      .toLowerCase();

    card.dataset.searchText = text;
  });

  // --- Build TC label lookup: tcId -> human label (org + name + desc)
  const tcLabelMap = new Map();
  cards.forEach(card => {
    const ds = card.dataset;
    const gid = ds.groupId || '';
    const type = ds.type || '';
    if (!gid) return;
    if (type === 'TC') {
      const org  = ds.org || '';
      const name = ds.groupName || '';
      const desc = ds.groupDesc || '';
      const label = [org, name, desc].filter(Boolean).join(' ').trim() || gid;
      tcLabelMap.set(gid, label);
    }
  });

  // --- Collect facet values
  const orgValues    = new Set();
  const tcValues     = new Set();
  const typeValues   = new Set();
  const statusValues = new Set();

  // --- Facet value counts
  const orgCounts    = new Map();
  const tcCounts     = new Map();
  const typeCounts   = new Map();
  const statusCounts = new Map();

  cards.forEach(card => {
    const ds = card.dataset;
    if (ds.org) {
      orgValues.add(ds.org);
      orgCounts.set(ds.org, (orgCounts.get(ds.org) || 0) + 1);
    }
    if (ds.tc) {
      tcValues.add(ds.tc);
      tcCounts.set(ds.tc, (tcCounts.get(ds.tc) || 0) + 1);
    }
    if (ds.type) {
      typeValues.add(ds.type);
      typeCounts.set(ds.type, (typeCounts.get(ds.type) || 0) + 1);
    }
    if (ds.status) {
      statusValues.add(ds.status);
      statusCounts.set(ds.status, (statusCounts.get(ds.status) || 0) + 1);
    }
  });


  function syncFacetInputs() {
    const allInputs = document.querySelectorAll(
      '#groupFacet input.form-check-input[data-facet-key], ' +
      '#groupFacetDrawerBody input.form-check-input[data-facet-key]'
    );
    allInputs.forEach(cb => {
      const key = cb.dataset.facetKey;
      const value = cb.value;
      const set = state[key];
      if (set instanceof Set && set.has(value)) {
        cb.checked = true;
      } else {
        cb.checked = false;
      }
    });
  }

  function toggleFacetSelection(key, value) {
    const set = state[key];
    if (!(set instanceof Set)) return;

    if (set.has(value)) {
      set.delete(value);
    } else {
      set.add(value);
    }
    syncFacetInputs();
    applyFilters();
  }


  // Build accordion facets for both sidebar and offcanvas drawer
  function buildFacetAccordions() {
    const makeSection = (title, values, counts, facetKey, idPrefix) => {
      const arr = Array.from(values).sort((a, b) => String(a).localeCompare(String(b)));
      if (!arr.length) return '';
      const collapseId = `${idPrefix}-facet-${facetKey}`;
      const headerId   = `${collapseId}-hdr`;
      const isDefaultOpen = facetKey !== 'tc';

      const buttons = arr.map(val => {
        const count = counts && counts.get(val) ? counts.get(val) : 0;
        const safeId = `${idPrefix}-${facetKey}-${String(val).replace(/[^\w-]+/g, '_')}`;
        return (
          `<div class="form-check mb-1">` +
            `<input class="form-check-input" id="${safeId}" type="checkbox" ` +
              `data-facet-key="${facetKey}" value="${val}">` +
            `<label class="form-check-label d-flex justify-content-between" for="${safeId}">` +
              `<span>${facetKey === 'tc' ? (tcLabelMap.get(val) || val) : val}</span>` +
              `<span class="text-muted small ms-2">${count}</span>` +
            `</label>` +
          `</div>`
        );
      }).join('');

      return `
        <div class="accordion-item">
          <h2 class="accordion-header" id="${headerId}">
            <button class="accordion-button${isDefaultOpen ? '' : ' collapsed'}" type="button"
              data-bs-toggle="collapse" data-bs-target="#${collapseId}"
              aria-expanded="${isDefaultOpen ? 'true' : 'false'}" aria-controls="${collapseId}">
              ${title}
            </button>
          </h2>
          <div id="${collapseId}" class="accordion-collapse collapse${isDefaultOpen ? ' show' : ''}" aria-labelledby="${headerId}">
            <div class="accordion-body p-2">
              <div class="facet-list">
                ${buttons}
              </div>
            </div>
          </div>
        </div>`;
    };

    const sections = [
      ['Organization',        orgValues,    orgCounts,    'org'],
      ['Technical Committee', tcValues,     tcCounts,     'tc'],
      ['Group Type',          typeValues,   typeCounts,   'type'],
      ['Status',              statusValues, statusCounts, 'status'],
    ];

    const desktopHtml = `
      <div class="accordion" id="facetAcc">
        ${sections.map(([title, values, counts, key]) => makeSection(title, values, counts, key, 'groupFacet')).join('')}
      </div>`;

    if (facetRoot) {
      facetRoot.innerHTML = desktopHtml;
    }

    if (facetDrawerBody) {
      const drawerHtml = `
        <div class="accordion" id="facetAccDrawer">
          ${sections.map(([title, values, counts, key]) => makeSection(title, values, counts, key, 'groupFacetDrawer')).join('')}
        </div>`;
      facetDrawerBody.innerHTML = drawerHtml;
    }

    // Wire up facet checkboxes (desktop + drawer) to use the same toggle logic
    function onFacetChange(e) {
      const cb = e.target.closest('input.form-check-input[data-facet-key]');
      if (!cb) return;
      const key = cb.dataset.facetKey;
      const value = cb.value;
      toggleFacetSelection(key, value);
    }

    if (facetRoot) {
      facetRoot.addEventListener('change', onFacetChange);
    }
    if (facetDrawerBody) {
      facetDrawerBody.addEventListener('change', onFacetChange);
    }

    // Ensure checked state matches current filters
    syncFacetInputs();
  }

  function applyFilters() {
    const search = state.search.trim().toLowerCase();
    let visibleCount = 0;

    cards.forEach(card => {
      const ds = card.dataset;
      let visible = true;

      if (search) {
        if (!ds.searchText || !ds.searchText.includes(search)) visible = false;
      }

      if (visible && state.org.size) {
        if (!state.org.has(ds.org)) visible = false;
      }

      if (visible && state.tc.size) {
        const tc = ds.tc || '';
        if (!tc || !state.tc.has(tc)) visible = false;
      }

      if (visible && state.type.size) {
        if (!state.type.has(ds.type)) visible = false;
      }

      if (visible && state.status.size) {
        if (!state.status.has(ds.status)) visible = false;
      }

      card.style.display = visible ? '' : 'none';
      if (visible) visibleCount++;
    });

    if (resultCountEl) {
      resultCountEl.textContent = String(visibleCount);
    }
    const total = totalGroups;

    if (resultsLineEl) {
      if (!visibleCount) {
        resultsLineEl.textContent = 'No groups found';
      } else if (visibleCount < total) {
        resultsLineEl.textContent =
          `Showing ${visibleCount} of ${total} groups (filtered from ${total} total groups)`;
      } else {
        resultsLineEl.textContent = `Showing ${visibleCount} of ${total} groups`;
      }
    }

    // Keep the total count span in sync if present
    const totalEl = document.getElementById('groupTotalCount');
    if (totalEl) {
      totalEl.textContent = String(total);
    }

    renderActiveFilters();
    updateFilterSummary();
  }

  function renderActiveFilters() {
    if (!activeFiltersEl) return;

    const chips = [];

    const pushChips = (labelPrefix, setKey) => {
      const set = state[setKey];
      if (!(set instanceof Set) || !set.size) return;
      for (const val of set) {
        const displayVal = (setKey === 'tc') ? (tcLabelMap.get(val) || val) : val;
        const safeLabel = labelPrefix ? `${labelPrefix}: ${displayVal}` : displayVal;
        chips.push(
          `<span class="chip" data-facet-key="${setKey}" data-value="${val}">${safeLabel} ` +
          `<button type="button" class="btn btn-sm btn-link p-0 ms-1 chip-x" aria-label="Remove">×</button>` +
          `</span>`
        );
      }
    };

    pushChips('',       'org');
    pushChips('',     'tc');
    pushChips('',   'type');
    pushChips('', 'status');

    const hasChips = chips.length > 0;
    const clearAll = hasChips
      ? `<button id="groupClearAllFilters" type="button" class="btn btn-sm btn-outline-secondary ms-1">Clear all</button>`
      : '';

    activeFiltersEl.innerHTML = chips.join('') + clearAll;

    // Wire chip removals
    activeFiltersEl.querySelectorAll('.chip-x').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const chip = e.currentTarget.closest('.chip');
        if (!chip) return;
        const facetKey = chip.getAttribute('data-facet-key');
        const value    = chip.getAttribute('data-value');
        const set      = state[facetKey];
        if (!(set instanceof Set)) return;

        set.delete(value);

        syncFacetInputs();
        applyFilters();
      });
    });

    // Wire "Clear all"
    const clearAllBtn = document.getElementById('groupClearAllFilters');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => {
        state.search = '';
        state.org.clear();
        state.tc.clear();
        state.type.clear();
        state.status.clear();

        if (searchInput) searchInput.value = '';

        syncFacetInputs();
        applyFilters();
      });
    }
  }

  function updateFilterSummary() {
    if (!filterSummaryEl) return;
    const bits = [];

    if (state.org.size) {
      bits.push('Organization: ' + Array.from(state.org).join(' + '));
    }
    if (state.tc.size) {
      const tcLabels = Array.from(state.tc).map(v => tcLabelMap.get(v) || v);
      bits.push('TC: ' + tcLabels.join(' + '));
    }
    if (state.type.size) {
      bits.push('Type: ' + Array.from(state.type).join(' + '));
    }
    if (state.status.size) {
      bits.push('Status: ' + Array.from(state.status).join(' + '));
    }
    if (state.search.trim()) {
      bits.push(`Search: “${state.search.trim()}”`);
    }

    filterSummaryEl.textContent = bits.length
      ? `Filtered by — ${bits.join('  |  ')}`
      : '';
  }

  // Search wiring
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      state.search = searchInput.value || '';
      applyFilters();
    });
  }

  // Clear filters
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      state.search = '';
      state.org.clear();
      state.tc.clear();
      state.type.clear();
      state.status.clear();

      if (searchInput) searchInput.value = '';

      syncFacetInputs();
      applyFilters();
    });
  }

  // Build accordion facets for both sidebar and offcanvas drawer
  buildFacetAccordions();

  // Initial sync + render
  applyFilters();
});