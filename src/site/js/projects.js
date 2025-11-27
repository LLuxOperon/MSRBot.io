document.addEventListener('DOMContentLoaded', async () => {
  const cardsRoot = document.getElementById('projectCards');
  if (!cardsRoot) return;

  async function loadJSONTry(candidates){
    const errs = [];
    for (const url of candidates) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res.ok) return await res.json();
        errs.push(`${url} → ${res.status}`);
      } catch (e) {
        errs.push(`${url} → ${e.message || e}`);
      }
    }
    throw new Error(`Failed to fetch any candidate: ${errs.join(' | ')}`);
  }

  async function ensureHandlebars(){
    if (window.Handlebars) return true;
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/handlebars@4.7.8/dist/handlebars.min.js';
      s.async = true;
      s.onload = () => resolve(!!window.Handlebars);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }

  let projects = [];
  try {
    const raw = await loadJSONTry([
      '/projects/_data/projects.json',
      'projects/_data/projects.json',
      '../projects/_data/projects.json',
      './_data/projects.json'
    ]);

    if (Array.isArray(raw)) {
      projects = raw;
    } else if (raw && Array.isArray(raw.data)) {
      projects = raw.data;
    } else {
      projects = [];
    }
  } catch (e) {
    console.error('[projects] Failed to load projects.json:', e);
    cardsRoot.innerHTML = '<div class="alert alert-warning">Projects view could not load data.</div>';
    return;
  }

  // Load normalized groups for lookups
  let groups = [];
  try {
    const gRaw = await loadJSONTry([
      '/groups/_data/groups.json',
      'groups/_data/groups.json',
      '../groups/_data/groups.json',
      './_data/groups.json'
    ]);
    if (Array.isArray(gRaw)) {
      groups = gRaw;
    }
  } catch (e) {
    console.warn('[projects] Failed to load groups.json for lookups:', e);
  }

  // Load documents for getLabel(docId) lookups (doc labels in Affects section)
  let documents = [];
  try {
    const dRaw = await loadJSONTry([
      '/docs/_data/documents.json',
      'docs/_data/documents.json',
      '../docs/_data/documents.json',
      './_data/documents.json'
    ]);
    if (Array.isArray(dRaw)) {
      documents = dRaw;
    } else if (dRaw && Array.isArray(dRaw.data)) {
      documents = dRaw.data;
    }
  } catch (e) {
    console.warn('[projects] Failed to load documents.json for labels:', e);
  }


  await ensureHandlebars();
  // --- Client-side Handlebars helpers (match docList behavior enough for projects cards)
  if (window.Handlebars) {
    // Try to load publisher logos + urls config (optional; safe to fail)
    let __publisherLogos = {}, __publisherLogosDark = {}, __publisherLogoHeight = 18, __publisherAliases = {};
    let __publisherUrls = {}, __publisherUrlAliases = {};
    try {
      const cfg = await loadJSONTry([
        '/_data/publisher-logos.json',
        '../_data/publisher-logos.json',
        '._data/publisher-logos.json',
        '/docs/_data/publisher-logos.json'
      ]);
      if (cfg && typeof cfg === 'object') {
        const logos = cfg.logos || cfg.publisherLogos || {};
        const logosDark = cfg.logosDark || cfg.publisherLogosDark || {};
        const height = cfg.height || cfg.publisherLogoHeight;
        const aliases = cfg.aliases || cfg.publisherLogoAliases || {};

        __publisherLogos = logos;
        __publisherLogosDark = logosDark;
        __publisherLogoHeight = Number(height) || 18;
        __publisherAliases = (aliases && typeof aliases === 'object') ? aliases : {};
      }
    } catch {}
    try {
      const ucfg = await loadJSONTry([
        '/_data/publisher-urls.json',
        '../_data/publisher-urls.json',
        '._data/publisher-urls.json',
        '/docs/_data/publisher-urls.json'
      ]);
      if (ucfg && typeof ucfg === 'object') {
        __publisherUrls = ucfg.urls || {};
        __publisherUrlAliases = (ucfg.aliases && typeof ucfg.aliases === 'object') ? ucfg.aliases : {};
      }
    } catch {}

    function resolvePublisherLogoFromMap(map, aliases, pubRaw){
      const input = String(pubRaw || '').trim();
      if (!input || !map || typeof map !== 'object') return null;

      // 1) Exact
      if (map[input]) return map[input];

      // 2) Alias (case-insensitive keys)
      const lowerAliases = aliases.__lowerCache || (aliases.__lowerCache = (() => {
        const m = {};
        for (const [a, c] of Object.entries(aliases)) {
          m[String(a).toLowerCase()] = String(c);
        }
        return m;
      })());
      const canonFromAlias = lowerAliases[input.toLowerCase()];
      if (canonFromAlias && map[canonFromAlias]) return map[canonFromAlias];

      // 3) Simple tokenization: take first token before common separators (mdash/en dash, hyphen, comma, paren)
      const firstToken = input.split(/[–—-]|,|\(|\)|:/)[0].trim();
      if (firstToken && map[firstToken]) return map[firstToken];

      // 4) Case-insensitive direct match on keys
      const lowerKey = input.toLowerCase();
      for (const [k, v] of Object.entries(map)) {
        if (String(k).toLowerCase() === lowerKey) return v;
      }
      return null;
    }

    function resolvePublisherLogo(pubRaw){
      return resolvePublisherLogoFromMap(__publisherLogos, __publisherAliases, pubRaw);
    }

    function resolvePublisherLogoDark(pubRaw){
      if (!__publisherLogosDark || !Object.keys(__publisherLogosDark).length) return null;
      return resolvePublisherLogoFromMap(__publisherLogosDark, __publisherAliases, pubRaw);
    }
    function resolvePublisherUrl(pubRaw){
      const input = String(pubRaw || '').trim();
      if (!input) return null;
      if (__publisherUrls[input]) return __publisherUrls[input];
      const lowerAliases = __publisherUrlAliases.__lowerCache || (__publisherUrlAliases.__lowerCache = (() => {
        const m = {}; for (const [a,c] of Object.entries(__publisherUrlAliases)) m[String(a).toLowerCase()] = String(c); return m;
      })());
      const canon = lowerAliases[input.toLowerCase()];
      if (canon && __publisherUrls[canon]) return __publisherUrls[canon];
      const firstToken = input.split(/[–—-]|,|\(|\)|:/)[0].trim();
      if (firstToken && __publisherUrls[firstToken]) return __publisherUrls[firstToken];
      const lowerKey = input.toLowerCase();
      for (const [k,v] of Object.entries(__publisherUrls)) if (String(k).toLowerCase() === lowerKey) return v;
      return null;
    }

    window.Handlebars.registerHelper('publisherLogo', function(pub){
      const relLight = resolvePublisherLogo(pub);
      if (!relLight) return '';

      const relDark = resolvePublisherLogoDark(pub);
      const alt = `${pub} logo`;
      const h = __publisherLogoHeight;

      const lightUrl = `../${relLight}`;
      const attrs = [
        `src="${lightUrl}"`,
        `alt="${alt}"`,
        `height="${h}"`,
        'class="align-text-bottom me-1 publisher-logo"',
        'loading="lazy"',
        `data-logo-light="${lightUrl}"`
      ];

      if (relDark) {
        attrs.push(`data-logo-dark="../${relDark}"`);
      }

      return new window.Handlebars.SafeString(
        `<img ${attrs.join(' ')}>`
      );
    });
    window.Handlebars.registerHelper('publisherLink', function(pub){
      return resolvePublisherUrl(pub) || '';
    });

    // simple utility helpers
    window.Handlebars.registerHelper('ifeq', function(a, b, opts) {
      return (a == b) ? opts.fn(this) : opts.inverse(this);
    });
    window.Handlebars.registerHelper('ifnoteq', function(a, b, opts) {
      return (a != b) ? opts.fn(this) : opts.inverse(this);
    });
    window.Handlebars.registerHelper('join', (arr, sep) => Array.isArray(arr) ? arr.join(sep||', ') : '');
    window.Handlebars.registerHelper('len', v => (Array.isArray(v)||typeof v==='string') ? v.length : (v&&typeof v==='object'?Object.keys(v).length:0));
    window.Handlebars.registerHelper('hasAny', arr => Array.isArray(arr) && arr.length>0);
    window.Handlebars.registerHelper('any', function(){ const args = Array.prototype.slice.call(arguments,0,-1); return args.some(v=>!!v); });
    window.Handlebars.registerHelper('spaceReplace', s => encodeURIComponent(String(s||'').trim()).replace(/%20/g,'%20'));

    // Build a docId → document map for label lookups
    const __docById = new Map(
      Array.isArray(documents)
        ? documents
            .map(d => {
              const id = String(d.docId || d.id || '').trim();
              return id ? [id, d] : null;
            })
            .filter(Boolean)
        : []
    );

    // getLabel: prefer document label/title when available, fall back to docId
    window.Handlebars.registerHelper('getLabel', function(docId) {
      const id = String(docId || '').trim();
      if (!id) return '';
      const doc = __docById.get(id);
      if (!doc) return id;
      const label = doc.label || doc.docLabel || doc.title || doc.docId || id;
      return String(label);
    });

    // projectIdLookup: ignore passed data arg, use normalized projects map
    const __projectById = new Map(Array.isArray(projects) ? projects.map(x => [String(x.projectId), x]) : []);
    window.Handlebars.registerHelper('projectIdLookup', function(_dataIgnored, id){
      if (!id) return null;
      return __projectById.get(String(id)) || null;
    });

    // groupIdLookup: ignore passed data arg, use normalized groups map
    const __groupById = new Map(Array.isArray(groups) ? groups.map(x => [String(x.groupId), x]) : []);
    window.Handlebars.registerHelper('groupIdLookup', function(_dataIgnored, id){
      if (!id) return null;
      return __groupById.get(String(id)) || null;
    });

  }
  // --- end helpers
  const tplSrc = document.getElementById('project-card-tpl-src');
  let hbCard = null;
  if (tplSrc && window.Handlebars) {
    try { hbCard = window.Handlebars.compile(tplSrc.innerHTML); } catch {}
  }

  function renderCard(g){
    if (hbCard) {
      try { return hbCard(g); }
      catch (e) {
        console.warn('[projects] Card template failed for', g && g.projectId, e);
      }
    }
    // ultra-fallback, should rarely be used
    const esc = s => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    return `
      <article class="card-reg project-card"
        data-group="${esc(g.projectGroup)}"
        data-type="${esc(g.projectType)}"
        data-status="${esc(g.statusText)}"
        data-project-id="${esc(g.projectId)}"
        data-project-name="${esc(g.projectName)}"
        data-project-desc="${esc(g.projectDesc)}"
      >
        <header class="d-flex align-items-start gap-2 mb-1">
          <a class="anchor" id="${esc(g.projectId)}" href="#${esc(g.projectId)}"></a>
          <div class="title-block mb-2 flex-grow-1">
            <h3 class="h6 mb-1"><code class="me-1">${esc(g.projectId)}</code> ${esc(g.projectLabel||g.projectName||'')}</h3>
          </div>
          <div class="status-badges ms-auto">${g.isActive ? '<span class="badge text-bg-success">Active</span>' : '<span class="badge text-bg-secondary">Closed</span>'}</div>
        </header>
      </article>`;
  }

  // Render all cards from normalized data
  cardsRoot.innerHTML = projects.map(renderCard).join('');

  // Now discover cards from DOM
  const cards = Array.from(cardsRoot.querySelectorAll('.project-card'));
  if (!cards.length) return;

  const searchInput       = document.getElementById('projectSearch');
  const pageSizeSelect    = document.getElementById('projectPageSize');
  const sortSelect        = document.getElementById('projectSort');
  const clearBtn          = document.getElementById('projectClearFilters');

  const resultCountEl     = document.getElementById('projectResultCount');
  const totalCountEl      = document.getElementById('projectTotalCount');
  const filterSummaryEl   = document.getElementById('projectFilterSummary');
  const activeFiltersEl   = document.getElementById('projectActiveFilters');
  const resultsLineEl     = document.getElementById('projectResultsLine');
  const totalProjects     = cards.length;
  if (totalCountEl) totalCountEl.textContent = String(totalProjects);

  // --- Sticky offset (navbar + projects topbar) so hash jumps don't hide cards
  function computeStickyOffset(){
    const sels = ['.navbar.sticky-top', '#projects-topbar'];
    let h = 0;
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const topPx = parseFloat(cs.top) || 0;
      const isAffixed = (cs.position === 'sticky' || cs.position === 'fixed');
      const isAtTop = isAffixed && (r.top <= topPx + 2);
      if (isAtTop) h += r.height;
    }
    h = Math.max(0, Math.floor(h + 8));
    document.documentElement.style.setProperty('--sticky-offset', h + 'px');
    return h;
  }
  function refreshStickyOffset(){
    _stickyOffsetPx = computeStickyOffset();
    // Apply scroll-margin-top to cards so hash jumps respect sticky UI
    const m = `var(--sticky-offset, 0px)`;
    cards.forEach(c => { c.style.scrollMarginTop = m; });
  }
  window.addEventListener('resize', refreshStickyOffset);
  window.addEventListener('load', refreshStickyOffset);
  // Initial application
  refreshStickyOffset();
  // --- end sticky offset

  // pager bits
  const prevBtn           = document.getElementById('projectPrevPage');
  const nextBtn           = document.getElementById('projectNextPage');
  const prevBtnBottom     = document.getElementById('projectPrevPageBottom');
  const nextBtnBottom     = document.getElementById('projectNextPageBottom');
  const pageNumsEl        = document.getElementById('projectPageNums');
  const pageNumsBottomEl  = document.getElementById('projectPageNumsBottom');
  const pageMetaEl        = document.getElementById('projectPageMeta');
  const pageMetaBottomEl  = document.getElementById('projectPageMetaBottom');

  const pagerTopWrap      = document.getElementById('projectPager');
  const pagerBottomWrap   = document.getElementById('projectPagerBottom');

  // Track whether pagination is needed so the observer can respect single-page cases
  let _hasMultiplePages = false;

  const facetRoot         = document.getElementById('projectFacet');
  const facetDrawerBody   = document.getElementById('projectFacetDrawerBody');

  const state = {
    search: '',
    org:    new Set(),
    tc:     new Set(),
    type:   new Set(),
    status: new Set(),
    page:   1,
    size:   20,
    sort:   'id:asc',
  };

  // Helper to keep the page-size dropdown in sync with state.size
  function syncPageSizeSelectFromState() {
    if (!pageSizeSelect) return;
    const val = String(state.size || 20);
    // Ensure an option exists matching the current size; if not, add it
    if (![...pageSizeSelect.options].some(o => o.value === val)) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = val;
      pageSizeSelect.appendChild(opt);
    }
    pageSizeSelect.value = val;
  }

  // Precompute search text for each project card
  cards.forEach(card => {
    const ds = card.dataset;
    const text = [
      ds.projectId || '',
      ds.org || '',
      ds.type || '',
      ds.status || '',
      (card.textContent || '')
    ]
      .join(' ')
      .toLowerCase();
    card.dataset.searchText = text;
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

      const sortParam = sp.get('sort');
      if (typeof sortParam === 'string' && sortParam.trim() !== '') {
        state.sort = sortParam.trim();
      }

      sp.forEach((val, key) => {
        if (!key.startsWith('f.')) return;
        const facet = key.slice(2);
        // Map URL facet name to internal state key
        const stateKey = (facet === 'group') ? 'org' : facet;
        const arr = String(val).split(',').map(x => x.trim()).filter(Boolean);
        const set = state[stateKey];
        if (set instanceof Set) arr.forEach(v => set.add(v));
      });

      const sortSelect = document.getElementById('projectSort');
      if (sortSelect) {
        const next = state.sort || 'id:asc';
        if (![...sortSelect.options].some(o => o.value === next)) {
          
          const opt = document.createElement('option');
          opt.value = next; opt.textContent = next;
          sortSelect.appendChild(opt);
        }
        sortSelect.value = next;
      }
    } catch {}
  }

  function updateURLAll(push){
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('page', String(state.page));
      url.searchParams.set('size', String(state.size));
      url.searchParams.set('sort', String(state.sort || 'id:asc'));

      if (state.search && String(state.search).trim() !== '') {
        url.searchParams.set('q', String(state.search).trim());
      } else {
        url.searchParams.delete('q');
      }

      const toDelete = [];
      url.searchParams.forEach((_, key) => { if (key.startsWith('f.')) toDelete.push(key); });
      toDelete.forEach(k => url.searchParams.delete(k));

      // Map internal state keys to URL facet names: org → group
      const facetMap = [
        ['org',   'group'],
        ['type',  'type'],
        ['status','status'],
      ];

      facetMap.forEach(([stateKey, urlKey]) => {
        const set = state[stateKey];
        if (set instanceof Set && set.size) {
          url.searchParams.set(`f.${urlKey}`, Array.from(set).map(String).join(','));
        }
      });

      if (push) window.history.pushState({}, '', url);
      else window.history.replaceState({}, '', url);
    } catch {}
  }
  // --- end URL sync ---


  // --- Collect facet values
  const orgValues    = new Set();
  const typeValues   = new Set();
  const statusValues = new Set();

  // --- Facet value counts
  const orgCounts    = new Map();
  const typeCounts   = new Map();
  const statusCounts = new Map();

  cards.forEach(card => {
    const ds = card.dataset;
    if (ds.org) {
      orgValues.add(ds.org);
      orgCounts.set(ds.org, (orgCounts.get(ds.org) || 0) + 1);
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
      '#projectFacet input.form-check-input[data-facet-key], ' +
      '#projectFacetDrawerBody input.form-check-input[data-facet-key]'
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
      const isDefaultOpen = true;

      const buttons = arr.map(val => {
        const count = counts && counts.get(val) ? counts.get(val) : 0;
        const safeId = `${idPrefix}-${facetKey}-${String(val).replace(/[^\w-]+/g, '_')}`;
        return (
          `<div class="form-check mb-1">` +
            `<input class="form-check-input" id="${safeId}" type="checkbox" ` +
              `data-facet-key="${facetKey}" value="${val}">` +
            `<label class="form-check-label d-flex justify-content-between" for="${safeId}">` +
              `<span>${val}</span>` +
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
      ['Group',        orgValues,    orgCounts,    'org'],
      ['Work Type',    typeValues,   typeCounts,   'type'],
      ['Status',       statusValues, statusCounts, 'status'],
    ];

    const desktopHtml = `
      <div class="accordion" id="facetAcc">
        ${sections.map(([title, values, counts, key]) => makeSection(title, values, counts, key, 'projectFacet')).join('')}
      </div>`;

    if (facetRoot) {
      facetRoot.innerHTML = desktopHtml;
    }

    if (facetDrawerBody) {
      const drawerHtml = `
        <div class="accordion" id="facetAccDrawer">
          ${sections.map(([title, values, counts, key]) => makeSection(title, values, counts, key, 'projectFacetDrawer')).join('')}
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

  function sortCards(list) {
    const sortSpec = String(state.sort || 'id:asc');
    const [rawKey, rawDir] = sortSpec.split(':');
    const key = rawKey || 'group';
    const dir = (rawDir === 'desc') ? -1 : 1;

    const collator = new Intl.Collator(undefined, {
      numeric: true,
      sensitivity: 'base',
    });

    return list.slice().sort((a, b) => {
      const da = a.dataset || {};
      const db = b.dataset || {};

      let va = '';
      let vb = '';

      switch (key) {
        case 'group':
          // Full resolved group string from data-org
          va = da.org || '';
          vb = db.org || '';
          break;
        case 'type':
          va = da.type || '';
          vb = db.type || '';
          break;
        case 'status':
          va = da.status || '';
          vb = db.status || '';
          break;
        case 'id':
          va = da.projectId || '';
          vb = db.projectId || '';
          break;
        default:
          // Fallback: same as group sort
          va = da.org || '';
          vb = db.org || '';
          break;
      }

      const cmp = collator.compare(va, vb);
      if (cmp !== 0) return cmp * dir;

      // Deterministic tie-breaker on projectId
      const ta = da.projectId || '';
      const tb = db.projectId || '';
      return collator.compare(ta, tb);
    });
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
      if (ok && state.type.size && !state.type.has(ds.type)) ok = false;
      if (ok && state.status.size && !state.status.has(ds.status)) ok = false;

      if (ok) filtered.push(card);
    });

    const totalVisible = filtered.length;
    const total = totalProjects;
    const size = Math.max(1, state.size || 0);
    const totalPages = Math.max(1, Math.ceil(totalVisible / size));
    // Recompute sticky offset after layout changes (filters/paging) but avoid scroll-jitter
    refreshStickyOffset();

    if (state.page > totalPages) state.page = totalPages;
    if (state.page < 1) state.page = 1;

    const sorted = sortCards(filtered);

    const start = (state.page - 1) * size;
    const end = start + size;
    const pageSlice = sorted.slice(start, end);

    // Reorder visible cards in DOM to match the sorted page slice
    const frag = document.createDocumentFragment();
    pageSlice.forEach(card => frag.appendChild(card));
    cardsRoot.appendChild(frag);

    // Hide all non-page cards, show only current page slice
    const pageSet = new Set(pageSlice);
    cards.forEach(card => {
      card.style.display = pageSet.has(card) ? '' : 'none';
    });

    if (resultCountEl) resultCountEl.textContent = String(totalVisible);
    if (totalCountEl) totalCountEl.textContent = String(total);

    if (resultsLineEl) {
      if (!totalVisible) {
        resultsLineEl.textContent = 'No projects found';
      } else {
        const startNum = start + 1;
        const endNum = Math.min(end, totalVisible);
        const isFiltered = (state.org.size || state.type.size || state.status.size || search);
        const filteredSuffix = isFiltered && totalVisible < total
          ? ` (filtered from ${total} total)`
          : '';
        resultsLineEl.textContent = `Showing ${startNum}–${endNum} of ${totalVisible} projects${filteredSuffix}`;
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

    // Return the sorted list so helpers like navigateToCardById
    // compute pages against the same ordering the user sees.
    return sorted;
  }

  function findIndexById(list, id){
    if (!id) return -1;
    return list.findIndex(card => String(card.dataset.projectId) === String(id));
  }

  function highlightAndScrollTo(id){
    const anchor = document.getElementById(id);
    if (!anchor) return;
    const card = anchor.closest('.project-card') || anchor;
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
      // Not present under current filters; clear all filters/search and try full index
      state.search = '';
      state.org.clear();
      state.tc.clear();
      state.type.clear();
      state.status.clear();

      if (searchInput) searchInput.value = '';
      syncFacetInputs();

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
      ? `<button id="projectClearAllFilters" type="button" class="btn btn-sm btn-outline-secondary ms-1">Clear all</button>`
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
    const clearAllBtn = document.getElementById('projectClearAllFilters');
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
      bits.push('Group: ' + Array.from(state.org).join(' + '));
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
  syncPageSizeSelectFromState();

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
      syncPageSizeSelectFromState();
      applyFilters();
    });
  }

  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      const v = sortSelect.value || 'projectGroup:asc';
      state.sort = v;
      state.page = 1;
      updateURLAll(true);
      applyFilters();
    });
  }

  // Initial render
  applyFilters();

  // After initial render, honor any #GROUPID hash in the URL
  initHashDeepLink();

  // Auto-hide bottom pager when the top pager is actually visible (not covered by sticky headers)
  (function(){
    if (!pagerBottomWrap) return; // nothing to control

    const headerSelectors = ['.navbar.sticky-top', '#projects-topbar'];
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
      pagerBottomWrap.style.display = hide ? 'none' : '';
    }

    function fallbackToggle(){
      if (!pagerTopWrap) { setHidden(false); return; }
      const r = pagerTopWrap.getBoundingClientRect();
      const offset = headerOffsetPx();
      const visible = (r.bottom > offset) && (r.top < window.innerHeight);
      setHidden(!!visible);
    }

    let io = null;
    function initObserver(){
      if (!pagerTopWrap || !('IntersectionObserver' in window)) return;
      const offset = headerOffsetPx();
      if (io) { io.disconnect(); io = null; }
      io = new IntersectionObserver((entries) => {
        for (const e of entries) setHidden(e.isIntersecting);
      }, {
        root: null,
        threshold: 0,
        rootMargin: `-${Math.max(0, Math.floor(offset))}px 0px 0px 0px`
      });
      io.observe(pagerTopWrap);
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

  // Hash deep-link support
  initHashDeepLink();
});