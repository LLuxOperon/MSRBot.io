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
      state.page = 1; render();
    }));
    const ca = $('#clearFilters');
    if (ca) ca.addEventListener('click', () => { state.f = {}; state.page = 1; render(); });
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
    if (state.sort === 'title:asc') rows.sort((a,b)=>String(a.title).localeCompare(String(b.title)));
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
      state.page = 1; render();
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

  function render(){
    const rows = applyFilters();
    const countEl = $('#resultCount'); if (countEl) countEl.textContent = rows.length;
    renderActiveFilters();
    renderFilterSummary();
    const start = (state.page-1)*state.size;
    const pageRows = rows.slice(start, start+state.size);
    const tgt = $('#cards'); if (!tgt) return;
    tgt.innerHTML = pageRows.map(d => cardHTML(d)).join('');
    if (!pageRows.length) {
      tgt.innerHTML = '<div class="text-muted p-3">No results. Adjust filters or search.</div>';
    }
  }

  // Wire basics
  const q = $('#q'); if (q) q.addEventListener('input', e => { state.q = e.target.value; state.page=1; render(); });
  const sort = $('#sort'); if (sort) sort.addEventListener('change', e => { state.sort = e.target.value; state.page=1; render(); });

  // Kickoff
  renderFacets();
  render();
})();