(async function(){
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  function err(msg){
    const box = document.createElement('div');
    box.className = 'alert alert-warning m-3';
    box.innerHTML = `<strong>Cards view couldn't load</strong><br>${msg}`;
    document.body.prepend(box);
  }

  // --- Ensure Handlebars runtime is present (async loader)
  async function ensureHandlebars(){
    if (window.Handlebars) return true;
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/handlebars@4.7.8/dist/handlebars.min.js';
      s.async = true;
      s.onload = () => resolve(!!window.Handlebars);
      s.onerror = () => {
        console.error('[cards] Failed to load Handlebars runtime.');
        resolve(false);
      };
      document.head.appendChild(s);
    });
  }

  async function loadJSON(url){
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (e) {
      throw new Error(`Failed to fetch ${url}. ${e.message}. If you opened this file directly (file://), start a local server and open via http:// (e.g., npx http-server build).`);
    }
  }

  let idx, facets;
  try {
    [idx, facets] = await Promise.all([
      loadJSON('search-index.json'),
      loadJSON('facets.json')
    ]);
  } catch (e) {
    err(e.message);
    return;
  }

  // Optional client-side Handlebars card template
  let hbCard = null;
  let tplEl = document.getElementById('card-tpl');
  if (!tplEl) {
    const src = document.getElementById('card-tpl-src');
    if (src) {
      const scr = document.createElement('script');
      scr.id = 'card-tpl';
      scr.type = 'text/x-handlebars-template';
      scr.innerHTML = src.innerHTML;
      document.body.appendChild(scr);
      tplEl = scr;
    }
  }
  if (!tplEl) {
    console.error('[cards] [TEMPLATE] Missing #card-tpl and #card-tpl-src. The page must include <template id="card-tpl-src">…</template>.');
  } else if (!tplEl.innerHTML || tplEl.innerHTML.trim().length === 0) {
    console.error('[cards] [TEMPLATE] card template node is empty. Check cards.hbs for the inline template content.');
  }

  if (!(await ensureHandlebars())) {
    console.error('[cards] [RUNTIME] Handlebars not available; templates cannot render.');
  }

  if (tplEl && window.Handlebars) {
    // minimal helpers
    window.Handlebars.registerHelper('join', function(arr, sep){ return Array.isArray(arr) ? arr.join(sep||', ') : ''; });
    window.Handlebars.registerHelper('len', function(x){ return (Array.isArray(x) || typeof x === 'string') ? x.length : 0; });
    window.Handlebars.registerHelper('gt', function(a,b){ return Number(a) > Number(b); });
    window.Handlebars.registerHelper('statusBadge', function(status){
      const s = String(status || '').toLowerCase();
      const cls = {
        unknown:   'text-bg-danger',
        withdrawn: 'text-bg-danger',
        superseded:'text-bg-warning',
        draft:     'text-bg-warning',
        publiccd:  'text-bg-success',
        active:    'text-bg-success',
        versionless:'text-bg-info',
        amended:   'text-bg-secondary',
        reaffirmed:'text-bg-info',
        stabilized:'text-bg-primary'
      }[s] || 'text-bg-light';
      const label = s ? `[ ${s.toUpperCase()} ]` : '[ UNKNOWN ]';
      return new window.Handlebars.SafeString(`<span class="label badge ${cls}">${label}</span>`);
    });
    // coalesce helper: returns first non-empty arg (skipping options hash)
    window.Handlebars.registerHelper('coalesce', function(){
      const args = Array.prototype.slice.call(arguments, 0, -1); // drop options hash
      for (let i = 0; i < args.length; i++) {
        const v = args[i];
        if (v !== undefined && v !== null && String(v).trim() !== '') return v;
      }
      return '';
    });
    // hasAny helper: checks if an array is non-empty
    window.Handlebars.registerHelper('hasAny', function(arr){
      return Array.isArray(arr) && arr.length > 0;
    });
    try {
      hbCard = window.Handlebars.compile(tplEl.innerHTML);
    } catch (e) {
      console.error('[cards] [COMPILE] Handlebars failed to compile card template:', e);
    }
  }

  // --- State
  const state = { q:'', f:{}, sort:'year:desc', page:1, size:40 };
  // Compute combined sticky offset (navbar + cards-topbar) and expose as CSS var
  function computeStickyOffset(){
    const sels = ['.navbar.sticky-top', '#cards-topbar'];
    let h = 0;
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const topPx = parseFloat(cs.top) || 0;
      const isAffixed = (cs.position === 'sticky' || cs.position === 'fixed');
      const isAtTop = isAffixed && (r.top <= topPx + 2); // element is pinned at its top offset
      if (isAtTop) h += r.height; // only the height blocks content; top offset just positions it
    }
    h = Math.max(0, Math.floor(h + 8)); // + small padding
    document.documentElement.style.setProperty('--sticky-offset', h + 'px');
  }
  computeStickyOffset();
  window.addEventListener('resize', computeStickyOffset);
  window.addEventListener('scroll', computeStickyOffset, { passive: true });
  let _initialDeepLinked = false; // prevents double-render overriding initial hash navigation

  // --- URL sync (page,size) ---
  function initPageSizeFromURL(){
    try {
      const sp = new URLSearchParams(window.location.search);
      const p = parseInt(sp.get('page'), 10);
      const s = parseInt(sp.get('size'), 10);
      if (Number.isFinite(p) && p >= 1) state.page = p;
      if (Number.isFinite(s) && s > 0) state.size = s;
    } catch {}
  }
  function updateURLPageSize(push){
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('page', String(state.page));
      url.searchParams.set('size', String(state.size));
      if (push) window.history.pushState({}, '', url);
      else window.history.replaceState({}, '', url);
    } catch {}
  }

  // --- URL sync (filters) ---
  function initFiltersFromURL(){
    try {
      const sp = new URLSearchParams(window.location.search);
      const newF = {};
      sp.forEach((val, key) => {
        if (!key.startsWith('f.')) return;
        const facet = key.slice(2);
        const arr = String(val).split(',').map(s => s.trim()).filter(Boolean);
        if (arr.length) newF[facet] = arr;
      });
      state.f = newF;
      syncFacetCheckboxesFromState();
    } catch {}
  }
  function updateURLAll(push){
    try {
      const url = new URL(window.location.href);
      // page + size
      url.searchParams.set('page', String(state.page));
      url.searchParams.set('size', String(state.size));
      // sync search query
      if (state.q && String(state.q).trim() !== '') url.searchParams.set('q', String(state.q).trim());
      else url.searchParams.delete('q');
      // wipe old f.* params
      const toDelete = [];
      url.searchParams.forEach((_, key) => { if (key.startsWith('f.')) toDelete.push(key); });
      toDelete.forEach(k => url.searchParams.delete(k));
      // add current filters
      Object.entries(state.f).forEach(([k, arr]) => {
        if (Array.isArray(arr) && arr.length) url.searchParams.set(`f.${k}`, arr.map(String).join(','));
      });
      if (push) window.history.pushState({}, '', url);
      else window.history.replaceState({}, '', url);
    } catch {}
  }
  // --- End URL sync (filters) ---
  // --- URL sync (search) ---
  function initSearchFromURL(){
    try {
      const sp = new URLSearchParams(window.location.search);
      const q = sp.get('q');
      if (typeof q === 'string') {
        state.q = q;
        const qInput = document.querySelector('#q');
        if (qInput) qInput.value = q;
      }
    } catch {}
  }
  // --- End URL sync (search) ---
  // --- End URL sync ---

  // --- Helpers
  const facetLabel = (k, v) => {
    if (k === 'group' && facets.groupLabels && facets.groupLabels[v]) return facets.groupLabels[v];
    if ((k === 'hasCurrentWork' || k === 'hasDoi' || k === 'hasReleaseTag') && (v === 'true' || v === true)) return ({
      hasCurrentWork: 'Has current work', hasDoi: 'Has DOI', hasReleaseTag: 'Has releaseTag'
    })[k];
    if ((k === 'hasCurrentWork' || k === 'hasDoi' || k === 'hasReleaseTag') && (v === 'false' || v === false)) return ({
      hasCurrentWork: 'No current work', hasDoi: 'No DOI', hasReleaseTag: 'No releaseTag'
    })[k];
    return String(v);
  };

  // --- Central sync: facet checkboxes <= state.f ---
  function syncFacetCheckboxesFromState() {
    const boxes = Array.from(document.querySelectorAll('input[type="checkbox"][name]'));
    for (const cb of boxes) {
      const k = cb.name;
      const v = cb.value;
      const arr = (state.f[k] || []);
      const shouldCheck = arr.includes(String(v));
      if (cb.checked !== shouldCheck) cb.checked = shouldCheck;
    }
  }
  // --- End central sync ---

  // --- Deep-link to a card by #id (supports pagination + filters reset if needed) ---
  function findIndexById(rows, id){
    if (!id) return -1;
    return rows.findIndex(d => String(d.id) === String(id));
  }
  function highlightAndScrollTo(id){
    const anchor = document.getElementById(id);
    if (!anchor) return;
    // Prefer the card element for visual highlight
    const card = anchor.closest('.card-reg') || anchor;

    // Use native scrollIntoView; offset handled by CSS scroll-margin-top on .card-reg
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Transient highlight for orientation
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
    // try within current filtered rows first
    let rows = applyFilters();
    let pos = findIndexById(rows, id);
    if (pos === -1) {
      // not present under current filters; clear filters/search and try full index
      state.f = {};
      state.q = '';
      const qInput = document.querySelector('#q');
      if (qInput) qInput.value = '';
      syncFacetCheckboxesFromState();
      rows = applyFilters(); // reuses current sort with empty filters
      pos = findIndexById(rows, id);
      if (pos === -1) return; // not found at all
    }
    const targetPage = Math.floor(pos / state.size) + 1;
    state.page = targetPage;
    updateURLAll(true);
    render();
    // Defer scroll until after render paints (next animation frame ensures layout is flushed)
    requestAnimationFrame(() => requestAnimationFrame(() => highlightAndScrollTo(id)));
  }
  // Handle initial hash and changes
  function initHashDeepLink(){
    let did = false;
    const h = (window.location.hash || '').replace(/^#/, '').trim();
    if (h) { navigateToCardById(h); did = true; }
    window.addEventListener('hashchange', () => {
      const hh = (window.location.hash || '').replace(/^#/, '').trim();
      if (hh) navigateToCardById(hh);
    });
    return did;
  }
  // --- End deep-link helpers ---

  function renderActiveFilters(){
    const root = $('#activeFilters'); if (!root) return;
    const chips = [];
    for (const [k, arr] of Object.entries(state.f)) {
      if (!arr || !arr.length) continue;
      for (const v of arr) {
        const label = facetLabel(k, v);
        chips.push(`<span class="chip" data-k="${k}" data-v="${v}">${label} <button type="button" class="btn btn-sm btn-link p-0 ms-1 chip-x" aria-label="Remove">×</button></span>`);
      }
    }
    const clearAll = chips.length ? `<button id="clearFilters" type="button" class="btn btn-sm btn-outline-secondary ms-1">Clear all</button>` : '';
    root.innerHTML = chips.join('') + clearAll;

    root.querySelectorAll('.chip-x').forEach(btn => btn.addEventListener('click', e => {
      const p = e.currentTarget.parentElement;
      const k = p.getAttribute('data-k');
      const v = p.getAttribute('data-v');
      state.f[k] = (state.f[k] || []).filter(x => x !== v);
      state.page = 1;
      updateURLAll(true);
      syncFacetCheckboxesFromState();
      render();
    }));
    const ca = $('#clearFilters');
    if (ca) ca.addEventListener('click', () => {
      state.f = {};
      state.q = '';
      const qInput = document.querySelector('#q');
      if (qInput) qInput.value = '';
      syncFacetCheckboxesFromState();
      state.page = 1;
      updateURLAll(true);
      render();
    });
  }

  function renderFilterSummary(){
    const el = $('#filterSummary'); if (!el) return;
    const parts = [];
    for (const [k, arr] of Object.entries(state.f)) {
      if (!arr || !arr.length) continue;
      const labels = arr.map(v => facetLabel(k, v));
      parts.push(`${k}: ${labels.join(' + ')}`);
    }
    el.textContent = parts.length ? `Filtered by — ${parts.join('  |  ')}` : '';
  }

  function applyFilters(){
    const q = state.q.trim().toLowerCase();
    const pass = d => {
      if (q && !(d.title?.toLowerCase().includes(q) || (d.keywords||[]).join(' ').toLowerCase().includes(q))) return false;
      for (const [k, vs] of Object.entries(state.f)) {
        if (!vs?.length) continue;
        const val = d[k];
        if (Array.isArray(val)) { if (!val.some(x=>vs.includes(String(x)))) return false; }
        else if (!vs.includes(String(val))) return false;
      }
      return true;
    };
    let rows = idx.filter(pass);
    if (state.sort === 'year:desc') {
      rows.sort((a,b)=>{
        const bt = (typeof b.pubTs === 'number') ? b.pubTs : (b.year? Date.UTC(b.year,0,1): 0);
        const at = (typeof a.pubTs === 'number') ? a.pubTs : (a.year? Date.UTC(a.year,0,1): 0);
        return bt - at;
      });
    }
    if (state.sort === 'title:asc') {
      const normalizeTitle = t => (t ? String(t).trim().toLowerCase()
        .replace(/^(the|a|an)\s+/i, '') : '');
      rows.sort((a, b) =>
        normalizeTitle(a.title).localeCompare(normalizeTitle(b.title), 'en', { sensitivity: 'base' })
      );
    }
    if (state.sort === 'label:asc') rows.sort((a,b)=>String(a.label).localeCompare(String(b.label)));
    return rows;
    return rows;
  }

  function cardHTML(d, opts){
    if (!hbCard) {
      console.error('[cards] [RENDER] No compiled template. Causes: missing #card-tpl-src, Handlebars not loaded, or compile error.');
      return `<div class="alert alert-danger">Cards cannot render: template missing or Handlebars runtime unavailable.</div>`;
    }
    try {
      return hbCard(Object.assign({}, d, opts||{}, {
        hideGroup: !!(state.f.group && state.f.group.length)
      }));
    } catch (err) {
      console.error('[cards] Template render error:', err);
      return `<div class="alert alert-danger">[cards] Template render error: ${err.message}</div>`;
    }
  }

  function renderFacets(){
    const root = $('#facet'); if (!root) return;
    const makeList = (name, map, labels) => {
      const keys = Object.keys(map || {}).sort((a,b)=>String(a).localeCompare(String(b)));
      const items = keys.map(k => {
        const id = `${name}_${String(k).replace(/[^\w-]+/g,'_')}`;
        const label = (labels && labels[k]) ? labels[k] : k;
        return `
          <div class="form-check mb-1">
            <input class="form-check-input" id="${id}" type="checkbox" name="${name}" value="${k}">
            <label class="form-check-label d-flex justify-content-between" for="${id}">
              <span>${label}</span>
              <span class="text-muted small ms-2">${map[k]}</span>
            </label>
          </div>`;
      }).join('');
      const collapseId = `facet_${name}`;
      // Mark docType and status as open by default
      const isDefaultOpen = (name === 'docType' || name === 'status');
      return `
        <div class="accordion-item">
          <h2 class="accordion-header" id="hdr_${collapseId}">
            <button class="accordion-button${isDefaultOpen ? '' : ' collapsed'}" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="${isDefaultOpen}" aria-controls="${collapseId}">
              ${name}
            </button>
          </h2>
          <div id="${collapseId}" class="accordion-collapse collapse${isDefaultOpen ? ' show' : ''}" aria-labelledby="hdr_${collapseId}">
            <div class="accordion-body p-2">
              <div class="facet-list">${items || '<div class="text-muted">none</div>'}</div>
            </div>
          </div>
        </div>`;
    };

    const sections = [
      ['docType', facets.docType, null],
      ['status', facets.status, null],
      ['publisher', facets.publisher, null],
      ['group', facets.group, facets.groupLabels],
      ['hasCurrentWork', facets.hasCurrentWork, null],
      ['hasDoi', facets.hasDoi, null],
      ['hasReleaseTag', facets.hasReleaseTag, null]
    ];

    const accHTML = `
      <div class="accordion" id="facetAcc">
        ${sections.map(([n,m,l]) => makeList(n,m,l)).join('')}
      </div>`;

    root.innerHTML = accHTML;

    // Mirror facets into the offcanvas body (one-time clone of HTML)
    const drawerBody = $('#facetDrawerBody');
    if (drawerBody) drawerBody.innerHTML = accHTML;

    // Event delegation: handle checkbox changes from either container
    function onFacetChange(e){
      const cb = e.target;
      if (!(cb && cb.matches('input[type=checkbox][name]'))) return;
      const k = cb.name, v = cb.value;
      state.f[k] = state.f[k] || [];
      if (cb.checked) { if (!state.f[k].includes(v)) state.f[k].push(v); }
      else { state.f[k] = state.f[k].filter(x=>x!==v); }
      state.page = 1; updateURLAll(true); render();
      // keep the mirrored checkbox in sync
      const mirrorSel = `input[type=checkbox][name="${k}"][value="${CSS.escape(v)}"]`;
      document.querySelectorAll(mirrorSel).forEach(el => { if (el !== cb) el.checked = cb.checked; });
    }

    // Remove old listeners to avoid duplicates, then add fresh ones
    root.removeEventListener('change', onFacetChange);
    document.removeEventListener('change', onFacetChange, true);
    root.addEventListener('change', onFacetChange);
    if (drawerBody) drawerBody.addEventListener('change', onFacetChange);
  }

  // Render numbered page jumpers into #pageNums
  function renderPageNumbers(totalPages){
    const cont = document.querySelector('#pageNums');
    if (!cont) return;
    const p = state.page;
    const max = totalPages;
    const parts = [];
    const makeBtn = (label, page, {active=false, disabled=false}={}) => (
      `<button type="button" class="btn btn-outline-secondary btn-sm${active ? ' active' : ''}"`+
      `${disabled ? ' disabled' : ''} data-page="${page}" aria-label="Page ${label}">${label}</button>`
    );
    const addRange = (from, to) => { for (let i = from; i <= to; i++) parts.push(makeBtn(String(i), i, {active: i === p})); };

    if (max <= 7) {
      addRange(1, max);
    } else {
      addRange(1, 2); // first two
      const start = Math.max(3, p - 1);
      const end   = Math.min(max - 2, p + 1);
      if (start > 3) parts.push(makeBtn('…', p, {disabled:true}));
      addRange(start, end);
      if (end < max - 2) parts.push(makeBtn('…', p, {disabled:true}));
      addRange(max - 1, max); // last two
    }
    cont.innerHTML = parts.join('');
  }

  // Render numbered page jumpers into an arbitrary container (e.g., bottom pager)
  function renderPageNumbersInto(selector, totalPages){
    const cont = document.querySelector(selector);
    if (!cont) return;
    const p = state.page;
    const max = totalPages;
    const parts = [];
    const makeBtn = (label, page, {active=false, disabled=false}={}) => (
      `<button type="button" class="btn btn-outline-secondary btn-sm${active ? ' active' : ''}"`+
      `${disabled ? ' disabled' : ''} data-page="${page}" aria-label="Page ${label}">${label}</button>`
    );
    const addRange = (from, to) => { for (let i = from; i <= to; i++) parts.push(makeBtn(String(i), i, {active: i === p})); };

    if (max <= 7) {
      addRange(1, max);
    } else {
      addRange(1, 2); // first two
      const start = Math.max(3, p - 1);
      const end   = Math.min(max - 2, p + 1);
      if (start > 3) parts.push(makeBtn('…', p, {disabled:true}));
      addRange(start, end);
      if (end < max - 2) parts.push(makeBtn('…', p, {disabled:true}));
      addRange(max - 1, max); // last two
    }
    cont.innerHTML = parts.join('');
  }

  function render(){
    const rows = applyFilters();
    const total = idx.length;
    const filtered = rows.length;

    // clamp page
    const totalPages = Math.max(1, Math.ceil(filtered / state.size || 1));
    if (state.page > totalPages) state.page = totalPages;
    if (state.page < 1) state.page = 1;
    renderPageNumbers(totalPages);
    renderPageNumbersInto('#pageNumsBottom', totalPages);

    const startIdx = (state.page - 1) * state.size;      // 0-based
    const endIdx   = Math.min(startIdx + state.size, filtered); // exclusive
    const startHuman = filtered ? startIdx + 1 : 0;      // 1-based display
    const endHuman   = endIdx;

    // Results line
    const resultsLine = $('#resultsLine');
    if (resultsLine) {
      if (filtered === 0) {
        resultsLine.textContent = 'No documents found';
      } else if (filtered < total) {
        resultsLine.textContent = `Showing ${startHuman} to ${endHuman} of ${filtered} entries (filtered from ${total} total entries)`;
      } else {
        resultsLine.textContent = `Showing ${startHuman} to ${endHuman} of ${total} entries`;
      }
    }

    // Page meta + button states
    const pageMeta = $('#pageMeta');
    if (pageMeta) pageMeta.textContent = `Page ${filtered ? state.page : 1} of ${filtered ? totalPages : 1}`;
    const prevBtn = $('#prevPage'), nextBtn = $('#nextPage');
    const atFirst = state.page <= 1;
    const atLast  = state.page >= totalPages;
    if (prevBtn) prevBtn.disabled = atFirst || filtered === 0;
    if (nextBtn) nextBtn.disabled = atLast  || filtered === 0;

    // Bottom pager button states and meta
    const prevBtnB = $('#prevPageBottom');
    const nextBtnB = $('#nextPageBottom');
    if (prevBtnB) prevBtnB.disabled = atFirst || filtered === 0;
    if (nextBtnB) nextBtnB.disabled = atLast  || filtered === 0;

    const pageMetaB = $('#pageMetaBottom');
    if (pageMetaB) pageMetaB.textContent = `Page ${filtered ? state.page : 1} of ${filtered ? totalPages : 1}`;

    // Draw chips/summary
    renderActiveFilters();
    renderFilterSummary();

    // Slice page rows and render cards
    const pageRows = rows.slice(startIdx, endIdx);
    const tgt = $('#cards'); if (!tgt) return;
    tgt.innerHTML = pageRows.length
      ? pageRows.map(d => cardHTML(d)).join('')
      : '<div class="text-muted p-3">No results. Adjust filters or search.</div>';
  }
  // Pager click handler for numbered page jumpers
  const pager = document.querySelector('#pager');
  if (pager) pager.addEventListener('click', (e) => {
    const a = e.target.closest('[data-page]');
    if (!a) return;
    e.preventDefault();
    const n = parseInt(a.getAttribute('data-page'), 10);
    if (!Number.isFinite(n) || n < 1) return;
    if (n === state.page) return;
    state.page = n;
    updateURLAll(true);
    render();
  });

  // Bottom pager click handler
  const pagerBottom = document.querySelector('#pager-bottom');
  if (pagerBottom) pagerBottom.addEventListener('click', (e) => {
    const a = e.target.closest('[data-page]');
    if (!a) return;
    e.preventDefault();
    const n = parseInt(a.getAttribute('data-page'), 10);
    if (!Number.isFinite(n) || n < 1) return;
    if (n === state.page) return;
    state.page = n;
    updateURLAll(true);
    render();
  });

  // Keyboard navigation for pagination (ignored while typing in inputs)
  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.isComposing) return;
    if (e.key === 'ArrowLeft') {
      state.page = Math.max(1, state.page - 1);
      updateURLAll(true);
      render();
    } else if (e.key === 'ArrowRight') {
      state.page = state.page + 1; // clamped in render()
      updateURLAll(true);
      render();
    } else if (e.key === 'Home') {
      state.page = 1;
      updateURLAll(true);
      render();
    } else if (e.key === 'End') {
      state.page = 1e9; // effectively "last", clamped in render()
      updateURLAll(true);
      render();
    }
  });

  // Auto-hide bottom pager when the top pager is actually visible (not covered by sticky headers)
  (function(){
    const topPagerEl = document.querySelector('#pager');
    const bottomWrap = document.querySelector('#cards-main .sticky-bottom') || document.querySelector('.sticky-bottom');
    if (!bottomWrap) return; // nothing to control

    const headerSelectors = ['.navbar.sticky-top', '#cards-topbar'];
    function headerOffsetPx(){
      return headerSelectors.reduce((sum, sel) => {
        const el = document.querySelector(sel);
        if (!el) return sum;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const topPx = parseFloat(cs.top) || 0;
        const isAffixed = (cs.position === 'sticky' || cs.position === 'fixed');
        const isAtTop = isAffixed && (r.top <= topPx + 2);
        return sum + (isAtTop ? r.height : 0);
      }, 0);
    }

    function setHidden(hide){
      bottomWrap.style.display = hide ? 'none' : '';
    }

    function fallbackToggle(){
      if (!topPagerEl) { setHidden(false); return; }
      const r = topPagerEl.getBoundingClientRect();
      const offset = headerOffsetPx();
      const visible = (r.bottom > offset) && (r.top < window.innerHeight);
      setHidden(!!visible);
    }

    let io = null;
    function initObserver(){
      if (!topPagerEl || !('IntersectionObserver' in window)) return;
      const offset = headerOffsetPx();
      if (io) { io.disconnect(); io = null; }
      io = new IntersectionObserver((entries) => {
        for (const e of entries) setHidden(e.isIntersecting);
      }, { root: null, threshold: 0, rootMargin: `-${Math.max(0, Math.floor(offset))}px 0px 0px 0px` });
      io.observe(topPagerEl);
      // initial state using precise geometry
      fallbackToggle();
    }

    // init + listeners
    initObserver();
    if (!io) {
      window.addEventListener('scroll', fallbackToggle, { passive: true });
      window.addEventListener('resize', fallbackToggle);
      fallbackToggle();
    } else {
      window.addEventListener('resize', initObserver);
    }
  })();

  // Wire basics
  const q = $('#q');
  if (q) {
    const onSearchInput = (e) => {
      state.q = e.target.value;
      state.page = 1;
      updateURLAll(false); // replaceState while typing/clearing
      render();
    };
    q.addEventListener('input', onSearchInput);
    q.addEventListener('search', onSearchInput); // Safari/Chrome clear (Ⓧ) emits 'search'
    q.addEventListener('change', onSearchInput); // commit on blur/enter
  }
  const sort = $('#sort'); if (sort) sort.addEventListener('change', e => { state.sort = e.target.value; state.page=1; render(); });

  // Page size selector
  const pageSizeSel = $('#pageSize');
  if (pageSizeSel) {
    pageSizeSel.addEventListener('change', e => {
      const n = parseInt(e.target.value, 10);
      state.size = Number.isFinite(n) && n > 0 ? n : 40;
      state.page = 1;
      updateURLAll(true);
      render();
    });
  }

  // Prev/Next
  const prevBtn = $('#prevPage');
  const nextBtn = '#nextPage' && $('#nextPage');

  if (prevBtn) prevBtn.addEventListener('click', () => {
    state.page = Math.max(1, state.page - 1);
    updateURLAll(true);
    render();
  });
  if (nextBtn) nextBtn.addEventListener('click', () => {
    // totalPages will be clamped in render(), so a quick render is fine
    state.page = state.page + 1;
    updateURLAll(true);
    render();
  });

  // Bottom Prev/Next
  const prevBtnBottom = $('#prevPageBottom');
  const nextBtnBottom = $('#nextPageBottom');
  if (prevBtnBottom) prevBtnBottom.addEventListener('click', () => {
    state.page = Math.max(1, state.page - 1);
    updateURLAll(true);
    render();
  });
  if (nextBtnBottom) nextBtnBottom.addEventListener('click', () => {
    state.page = state.page + 1; // clamp in render()
    updateURLAll(true);
    render();
  });

  // Initialize page/size from URL, then normalize URL once
  initPageSizeFromURL();
  initFiltersFromURL();
  initSearchFromURL();
  updateURLAll(false);
  // Initialize deep-linking via #id (returns true if it rendered due to hash)
  _initialDeepLinked = initHashDeepLink();

  // Back/forward navigation sync
  window.addEventListener('popstate', () => {
    initPageSizeFromURL();
    initFiltersFromURL();
    initSearchFromURL();
    render();
  });

  // Kickoff
  renderFacets();
  if (!_initialDeepLinked) {
    render();
  }
})();