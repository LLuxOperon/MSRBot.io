document.addEventListener('DOMContentLoaded', () => {
  const cards = Array.from(document.querySelectorAll('.group-card'));
  if (!cards.length) return;

  const searchInput       = document.getElementById('groupSearch');
  const pageSizeSelect    = document.getElementById('groupPageSize');
  const clearBtn          = document.getElementById('groupClearFilters');

  const resultCountEl     = document.getElementById('groupResultCount');
  const totalCountEl      = document.getElementById('groupTotalCount');
  const filterSummaryEl   = document.getElementById('groupFilterSummary');
  const activeFiltersEl   = document.getElementById('groupActiveFilters');
  const resultsLineEl     = document.getElementById('groupResultsLine');
  const totalGroups       = cards.length;

  // pager bits
  const prevBtn           = document.getElementById('groupPrevPage');
  const nextBtn           = document.getElementById('groupNextPage');
  const prevBtnBottom     = document.getElementById('groupPrevPageBottom');
  const nextBtnBottom     = document.getElementById('groupNextPageBottom');
  const pageNumsEl        = document.getElementById('groupPageNums');
  const pageNumsBottomEl  = document.getElementById('groupPageNumsBottom');
  const pageMetaEl        = document.getElementById('groupPageMeta');
  const pageMetaBottomEl  = document.getElementById('groupPageMetaBottom');

  const facetRoot         = document.getElementById('groupFacet');
  const facetDrawerBody   = document.getElementById('groupFacetDrawerBody');

  const state = {
    search: '',
    org:    new Set(),
    tc:     new Set(),
    type:   new Set(),
    status: new Set(),
    page:   1,
    size:   20,
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

  // --- URL sync (page/size/search/filters) ---
  function initFromURL(){
    try {
      const sp = new URLSearchParams(window.location.search);
      const p = parseInt(sp.get('page'), 10);
      const s = parseInt(sp.get('size'), 10);
      if (Number.isFinite(p) && p >= 1) state.page = p;
      if (Number.isFinite(s) && s > 0) state.size = s;

      const q = sp.get('q');
      if (typeof q === 'string') state.search = q;

      sp.forEach((val, key) => {
        if (!key.startsWith('f.')) return;
        const facet = key.slice(2);
        const arr = String(val).split(',').map(x => x.trim()).filter(Boolean);
        const set = state[facet];
        if (set instanceof Set) arr.forEach(v => set.add(v));
      });
    } catch {}
  }

  function updateURLAll(push){
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('page', String(state.page));
      url.searchParams.set('size', String(state.size));

      if (state.search && String(state.search).trim() !== '') {
        url.searchParams.set('q', String(state.search).trim());
      } else {
        url.searchParams.delete('q');
      }

      const toDelete = [];
      url.searchParams.forEach((_, key) => { if (key.startsWith('f.')) toDelete.push(key); });
      toDelete.forEach(k => url.searchParams.delete(k));

      ['org','tc','type','status'].forEach(k => {
        const set = state[k];
        if (set instanceof Set && set.size) {
          url.searchParams.set(`f.${k}`, Array.from(set).map(String).join(','));
        }
      });

      if (push) window.history.pushState({}, '', url);
      else window.history.replaceState({}, '', url);
    } catch {}
  }
  // --- end URL sync ---

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
    state.page = 1;
    updateURLAll(true); 
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

  function renderPageNumbersInto(container, totalPages){
    if (!container) return;
    const p = state.page;
    const max = totalPages;
    const parts = [];

    const makeBtn = (label, page, {active=false, disabled=false}={}) => (
      `<button type="button" class="btn btn-outline-secondary btn-sm${active ? ' active' : ''}"`+
      `${disabled ? ' disabled' : ''} data-page="${page}" aria-label="Page ${label}">${label}</button>`
    );

    const addRange = (from, to) => {
      for (let i = from; i <= to; i++) parts.push(makeBtn(String(i), i, {active: i === p}));
    };

    if (max <= 7) {
      addRange(1, max);
    } else {
      addRange(1, 2);
      const start = Math.max(3, p - 1);
      const end   = Math.min(max - 2, p + 1);
      if (start > 3) parts.push(makeBtn('…', p, {disabled:true}));
      addRange(start, end);
      if (end < max - 2) parts.push(makeBtn('…', p, {disabled:true}));
      addRange(max - 1, max);
    }

    container.innerHTML = parts.join('');
  }

  function wirePagerClicks(){
    const handler = (e) => {
      const btn = e.target.closest('button[data-page]');
      if (!btn) return;
      const page = parseInt(btn.getAttribute('data-page'), 10);
      if (Number.isFinite(page)) {
        state.page = page;
        updateURLAll(true);
        applyFilters();
      }
    };
    if (pageNumsEl) pageNumsEl.addEventListener('click', handler);
    if (pageNumsBottomEl) pageNumsBottomEl.addEventListener('click', handler);
  }

  function applyFilters() {
    const search = state.search.trim().toLowerCase();

    const filtered = [];
    cards.forEach(card => {
      const ds = card.dataset;
      let ok = true;

      if (search) {
        if (!ds.searchText || !ds.searchText.includes(search)) ok = false;
      }
      if (ok && state.org.size && !state.org.has(ds.org)) ok = false;
      if (ok && state.tc.size) {
        const tc = ds.tc || '';
        if (!tc || !state.tc.has(tc)) ok = false;
      }
      if (ok && state.type.size && !state.type.has(ds.type)) ok = false;
      if (ok && state.status.size && !state.status.has(ds.status)) ok = false;

      if (ok) filtered.push(card);
    });

    const totalVisible = filtered.length;
    const total = totalGroups;
    const size = Math.max(1, state.size || 20);
    const totalPages = Math.max(1, Math.ceil(totalVisible / size));

    if (state.page > totalPages) state.page = totalPages;
    if (state.page < 1) state.page = 1;

    const start = (state.page - 1) * size;
    const end = start + size;
    const pageSlice = filtered.slice(start, end);

    const pageSet = new Set(pageSlice);
    cards.forEach(card => {
      card.style.display = pageSet.has(card) ? '' : 'none';
    });

    if (resultCountEl) resultCountEl.textContent = String(totalVisible);
    if (totalCountEl) totalCountEl.textContent = String(total);

    if (resultsLineEl) {
      if (!totalVisible) {
        resultsLineEl.textContent = 'No groups found';
      } else {
        const startNum = start + 1;
        const endNum = Math.min(end, totalVisible);
        const isFiltered = (state.org.size || state.tc.size || state.type.size || state.status.size || search);
        const filteredSuffix = isFiltered && totalVisible < total
          ? ` (filtered from ${total} total)`
          : '';
        resultsLineEl.textContent = `Showing ${startNum}–${endNum} of ${totalVisible} groups${filteredSuffix}`;
      }
    }

    const canPrev = state.page > 1;
    const canNext = state.page < totalPages;
    if (prevBtn) prevBtn.disabled = !canPrev;
    if (nextBtn) nextBtn.disabled = !canNext;
    if (prevBtnBottom) prevBtnBottom.disabled = !canPrev;
    if (nextBtnBottom) nextBtnBottom.disabled = !canNext;

    if (pageMetaEl) pageMetaEl.textContent = `Page ${state.page} of ${totalPages}`;
    if (pageMetaBottomEl) pageMetaBottomEl.textContent = `Page ${state.page} of ${totalPages}`;

    renderPageNumbersInto(pageNumsEl, totalPages);
    renderPageNumbersInto(pageNumsBottomEl, totalPages);

    renderActiveFilters();
    updateFilterSummary();

    return filtered;
  }

  function findIndexById(list, id){
    if (!id) return -1;
    return list.findIndex(card => String(card.dataset.groupId) === String(id));
  }

  function highlightAndScrollTo(id){
    const anchor = document.getElementById(id);
    if (!anchor) return;
    const card = anchor.closest('.group-card') || anchor;
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const prevOutline = card.style.outline;
    const prevShadow = card.style.boxShadow;
    card.style.outline = '2px solid #1398b0';
    card.style.boxShadow = '0 0 0 4px rgba(19,152,176,0.15)';
    setTimeout(()=>{
      card.style.outline = prevOutline || '';
      card.style.boxShadow = prevShadow || '';
    }, 1600);
  }

  function navigateToCardById(id){
    if (!id) return;
    let rows = applyFilters();
    let pos = findIndexById(rows, id);

    if (pos === -1) {
      state.search = '';
      state.org.clear();
      state.tc.clear();
      state.type.clear();
      state.status.clear();
      rows = applyFilters();
      pos = findIndexById(rows, id);
      if (pos === -1) return;
    }

    const targetPage = Math.floor(pos / state.size) + 1;
    state.page = targetPage;
    updateURLAll(true);
    applyFilters();

    requestAnimationFrame(() => requestAnimationFrame(() => highlightAndScrollTo(id)));
  }

  function initHashDeepLink(){
    const h = (window.location.hash || '').replace(/^#/, '').trim();
    if (h) navigateToCardById(h);

    window.addEventListener('hashchange', () => {
      const hh = (window.location.hash || '').replace(/^#/, '').trim();
      if (hh) navigateToCardById(hh);
    });
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
        state.page = 1;
        updateURLAll(true);
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
        state.page = 1;
        updateURLAll(true);     
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
      state.page = 1;
      updateURLAll(true);
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

      state.page = 1;
      updateURLAll(true);
      syncFacetInputs();
      applyFilters();
    });
  }

 // Init URL → state
  initFromURL();

  // Prime UI from URL state
  if (searchInput && state.search) searchInput.value = state.search;
  if (pageSizeSelect) pageSizeSelect.value = String(state.size);

  // Build facets
  buildFacetAccordions();

  // Pager wiring
  const goPrev = () => {
    if (state.page > 1) {
      state.page--;
      updateURLAll(true);
      applyFilters();
    }
  };
  const goNext = () => {
    state.page++;
    updateURLAll(true);
    applyFilters();
  };

  if (prevBtn) prevBtn.addEventListener('click', goPrev);
  if (nextBtn) nextBtn.addEventListener('click', goNext);
  if (prevBtnBottom) prevBtnBottom.addEventListener('click', goPrev);
  if (nextBtnBottom) nextBtnBottom.addEventListener('click', goNext);
  wirePagerClicks();

  if (pageSizeSelect) {
    pageSizeSelect.addEventListener('change', () => {
      const v = parseInt(pageSizeSelect.value, 10);
      if (Number.isFinite(v) && v > 0) state.size = v;
      state.page = 1;
      updateURLAll(true);
      applyFilters();
    });
  }

  // Initial render
  applyFilters();

  // Hash deep-link support
  initHashDeepLink();
});