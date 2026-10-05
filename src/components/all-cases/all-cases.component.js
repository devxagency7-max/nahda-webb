/* --------------------------------------------------------------------------
   ALL CASES VIEW COMPONENT CONTROLLER
   Manages cases listing, status filtering, and search queries.

   Real API-backed: search goes through CasesService.search() ->
   GET /api/v1/search/cases (server-side, cross-worker — see cases.service.js).
   Both the free-text search and the status tabs are filtered by the server
   (`q` + repeated `status`), so a tab shows every matching case, not just the
   ones on the first loaded page. The one exception is
   the "حالاتي" tab (data_entry only), which goes through CasesService.list()
   -> GET /api/v1/cases?createdByMe=true instead, since /search/cases has no
   such param. The "open full case" button hands off to
   case-details.component.js's openCaseDetailsPage(), which fetches the rest
   (GET /cases/{id}, family-members, support, attachments) by the real
   server GUID.
   -------------------------------------------------------------------------- */
import { DOM } from '../../utils/dom.js';
import { showToast } from '../../utils/toast.js';
import { CasesService } from '../../services/cases.service.js';
import { CharitiesService } from '../../services/charities.service.js';
import { EmployeesService } from '../../services/employees.service.js';
import { errorStateHTML, bindRetry, retryToast } from '../../utils/error-state.js';
import { isRole, ROLES } from '../../core/permissions.js';
import { onViewEnter } from '../../core/view-lifecycle.js';
import { DataService } from '../../services/data.js';
import { store } from '../../state/store.js';
import { EventBus, EVENTS } from '../../core/event-bus.js';

// Real backend status enum (10 values) -> label + pill + status tab.
// Every wire value gets its own label — a status must never be shown as a
// different one (a reviewer-created `draft` used to fall back to
// "قيد المراجعة"). `tab` is the tab the case is listed under besides
// "جميع الحالات"; `null` = only under "جميع الحالات". The "pending"
// (قيد المراجعة) tab is exactly `pending_review`, nothing else.
const STATUS_DISPLAY = {
  draft: { label: 'مسودة', pillClass: 'dash-status-pill--info', tab: null },
  pending_assignment: { label: 'بانتظار الإسناد', pillClass: 'dash-status-pill--info', tab: null },
  assigned: { label: 'مسندة لأخصائي', pillClass: 'dash-status-pill--info', tab: null },
  accepted: { label: 'مقبولة من الأخصائي', pillClass: 'dash-status-pill--info', tab: null },
  in_research: { label: 'قيد البحث الميداني', pillClass: 'dash-status-pill--info', tab: null },
  pending_review: { label: 'بانتظار المراجعة', pillClass: 'dash-status-pill--warning', tab: 'pending' },
  returned_to_worker: { label: 'أعيدت للأخصائي', pillClass: 'dash-status-pill--warning', tab: 'returned' },
  pending_approval: { label: 'قيد الاعتماد', pillClass: 'dash-status-pill--warning', tab: null },
  approved: { label: 'معتمدة', pillClass: 'dash-status-pill--success', tab: 'accepted' },
  rejected: { label: 'مرفوضة', pillClass: 'dash-status-pill--danger', tab: 'rejected' }
};

function displayForStatus(status, apiLabel) {
  const known = STATUS_DISPLAY[status];
  if (known) return { ...known, label: apiLabel || known.label };
  // Unknown wire value (backend added a status): show the server's label if
  // it sent one, never pretend it's "under review".
  return { label: apiLabel || status || '—', pillClass: 'dash-status-pill--info', tab: null };
}

/** Normalizes one CaseSearchResultItem (real API) into the shape the render/modal code expects. */
function normalizeCase(item) {
  const statusInfo = displayForStatus(item.status, item.statusLabel);
  return {
    id: item.displayId || item.caseNumber || item.id,
    rawId: item.id,
    name: item.beneficiaryFullName || '',
    nid: item.nationalId || '',
    phone: item.phonePrimary || '',
    charity: item.charityName || '',
    center: item.centerName || '',
    village: item.villageName || '',
    // Not part of the search item today (WEB_FRONTEND_API_REFERENCE §7.1) —
    // the card shows the row only once the backend starts sending it.
    familyMembersCount: typeof item.familyMembersCount === 'number' ? item.familyMembersCount : null,
    registrationDate: item.registrationDate || '',
    workerName: item.assignedToName || '',
    status: statusInfo.tab,
    statusLabel: statusInfo.label,
    statusClass: statusInfo.pillClass,
    // Real backend status enum value (ungrouped) — needed by the manager-only
    // "awaiting_approval" tab, which matches exactly `pending_approval`.
    rawStatus: item.status
  };
}

const PAGE_SIZE = 50;

// Tab -> the status wire values sent to /search/cases. 'all' and 'mine' send
// none ('mine' is scoped by createdByMe instead).
const FILTER_STATUSES = {
  pending: ['pending_review'],
  awaiting_approval: ['pending_approval'],
  returned: ['returned_to_worker'],
  accepted: ['approved'],
  rejected: ['rejected']
};

let activeFilter = 'all';
let searchQuery = '';
let casesList = [];
let isLoading = false;
let isLoadingMore = false;
// آخر خطأ في تحميل الصفحة الأولى — بيتعرض كحالة خطأ فيها زر إعادة محاولة
// بدل ما يتشاف كأنه "لا توجد نتائج".
let loadError = null;
let currentPage = 1;
let hasMore = false;
let searchDebounce = null;
let loadRequestId = 0;

// "قيد المراجعة"-only filters, all applied by the server (AND with status/q).
// center/village are picked by NAME (same lists as the intake form) and
// resolved to ids via store.locationIds.
const REVIEW_FILTER_TAB = 'pending';
const reviewFilters = { charityId: '', socialWorkerId: '', center: '', village: '' };
let reviewOptionsLoaded = false;

export function initAllCasesComponent() {
  const searchInput = DOM.qs('#all-cases-search-input');
  const filterBtns = DOM.qsa('.btn-case-filter');

  // "بانتظار اعتمادك" is the manager's exact pending_approval queue (same
  // number as the dashboard's "بانتظار اعتمادك" KPI card) — a narrower slice
  // than the shared "قيد المراجعة" tab, so only the manager sees it.
  const awaitingApprovalBtn = DOM.qs('#btn-filter-awaiting-approval');
  if (awaitingApprovalBtn) {
    awaitingApprovalBtn.style.display = isRole(ROLES.MANAGER) ? '' : 'none';
  }

  // "حالاتي" (GET /cases?createdByMe=true) only makes sense for data_entry —
  // it's their own intake work, mirrored from the "حالات أدخلتها" KPI card.
  const mineBtn = DOM.qs('#btn-filter-mine');
  if (mineBtn) {
    mineBtn.style.display = isRole(ROLES.DATA_ENTRY) ? '' : 'none';
  }

  if (filterBtns.length > 0) {
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => setCasesFilter(btn.getAttribute('data-filter') || 'all'));
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value.trim();
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => loadCases(), 350);
    });
  }

  bindReviewFilters();

  // Fetched when the screen is opened (and re-fetched on every re-entry so
  // the register reflects other users' work), not at boot behind another view.
  onViewEnter('all-cases', () => {
    syncReviewFiltersBar();
    refreshFilterCounts();
    loadCases();
  });
}

export function setCasesFilter(filterName) {
  activeFilter = filterName || 'all';
  const filterBtns = DOM.qsa('.btn-case-filter');
  filterBtns.forEach(btn => {
    const f = btn.getAttribute('data-filter');
    btn.classList.toggle('btn-case-filter--active', f === activeFilter);
  });
  syncReviewFiltersBar();
  // Every tab is its own server query (status / createdByMe) — re-fetch.
  loadCases();
}

/** The `q` actually sent — the server rejects text queries under 2 chars. */
function serverQuery() {
  const trimmedQuery = searchQuery.trim();
  return trimmedQuery.length >= 2 ? trimmedQuery : undefined;
}

/* --------------------------------------------------------------------------
   REVIEW FILTERS — «قيد المراجعة»: الجمعية + الأخصائي المسند + المنطقة
   -------------------------------------------------------------------------- */

/** The review filters in effect; empty unless the review tab is active. */
function activeReviewFilters() {
  if (activeFilter !== REVIEW_FILTER_TAB) return {};
  const ids = store.locationIds || {};
  const { center, village } = reviewFilters;
  return {
    charityId: reviewFilters.charityId || undefined,
    socialWorkerId: reviewFilters.socialWorkerId || undefined,
    centerId: (center && (ids.centers || {})[center]) || undefined,
    villageId: (center && village && ((ids.villages || {})[center] || {})[village]) || undefined,
    // Names, for /search/cases (which only has the text `region` filter).
    centerName: center || undefined,
    villageName: village || undefined
  };
}

function hasActiveReviewFilters() {
  const f = activeReviewFilters();
  return Boolean(f.charityId || f.socialWorkerId || f.centerName);
}

function fillLocationSelect(select, placeholder, names) {
  const current = select.value;
  select.innerHTML = `<option value="">${placeholder}</option>` +
    names.map(n => `<option value="${DOM.escapeHTML(n)}">${DOM.escapeHTML(n)}</option>`).join('');
  if (current && names.includes(current)) select.value = current;
}

/** Center list + the chosen center's villages (village disabled until a center is picked). */
function renderReviewLocationOptions() {
  const centerSelect = DOM.qs('#review-filter-center');
  const villageSelect = DOM.qs('#review-filter-village');
  if (!centerSelect || !villageSelect) return;
  fillLocationSelect(centerSelect, 'كل المراكز', DataService.getCenters());
  reviewFilters.center = centerSelect.value;
  const villages = reviewFilters.center ? DataService.getVillagesByCenter(reviewFilters.center) : [];
  fillLocationSelect(villageSelect, 'كل القرى', villages);
  villageSelect.disabled = !reviewFilters.center;
  reviewFilters.village = villageSelect.value;
}

/** Shows the bar only on the review tab; loads its pickers the first time. */
function syncReviewFiltersBar() {
  const bar = DOM.qs('#all-cases-review-filters');
  if (!bar) return;
  bar.hidden = activeFilter !== REVIEW_FILTER_TAB;
  if (!bar.hidden) renderReviewLocationOptions();
  if (!bar.hidden && !reviewOptionsLoaded) loadReviewFilterOptions();
}

function fillSelect(select, placeholder, options) {
  const current = select.value;
  select.innerHTML = `<option value="">${placeholder}</option>` +
    options.map(o => `<option value="${DOM.escapeHTML(o.id)}">${DOM.escapeHTML(o.label)}</option>`).join('');
  if (current && options.some(o => o.id === current)) select.value = current;
}

/** Charities + social workers for the pickers. A failed list retries next time the tab opens. */
async function loadReviewFilterOptions() {
  reviewOptionsLoaded = true;
  const charitySelect = DOM.qs('#review-filter-charity');
  const workerSelect = DOM.qs('#review-filter-worker');
  const [charities, workers] = await Promise.allSettled([
    CharitiesService.listReference(),
    EmployeesService.listSocialWorkers()
  ]);

  if (charities.status === 'fulfilled' && charitySelect) {
    const items = (charities.value && charities.value.items) || [];
    fillSelect(charitySelect, 'كل الجمعيات', items
      .map(c => ({ id: c.id, label: c.name || '' }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ar')));
  }
  if (workers.status === 'fulfilled' && workerSelect) {
    const value = workers.value;
    const items = Array.isArray(value) ? value : ((value && value.items) || []);
    fillSelect(workerSelect, 'كل الأخصائيين', items
      .map(w => ({ id: w.id, label: w.fullName || w.phone || '' }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ar')));
  }

  if (charities.status === 'rejected' || workers.status === 'rejected') {
    reviewOptionsLoaded = false;
    showToast('تعذر تحميل قوائم الفلترة (الجمعيات أو الأخصائيين) ⚠️', 'error');
  }
}

function bindReviewFilters() {
  const charitySelect = DOM.qs('#review-filter-charity');
  const workerSelect = DOM.qs('#review-filter-worker');
  const centerSelect = DOM.qs('#review-filter-center');
  const villageSelect = DOM.qs('#review-filter-village');
  const clearBtn = DOM.qs('#btn-review-filters-clear');

  if (charitySelect) {
    charitySelect.addEventListener('change', () => {
      reviewFilters.charityId = charitySelect.value;
      loadCases();
    });
  }
  if (workerSelect) {
    workerSelect.addEventListener('change', () => {
      reviewFilters.socialWorkerId = workerSelect.value;
      loadCases();
    });
  }
  if (centerSelect) {
    centerSelect.addEventListener('change', () => {
      // A village only makes sense inside its own center.
      if (villageSelect) villageSelect.value = '';
      renderReviewLocationOptions();
      loadCases();
    });
  }
  if (villageSelect) {
    villageSelect.addEventListener('change', () => {
      reviewFilters.village = villageSelect.value;
      loadCases();
    });
  }
  // Centers/villages arrive (or change) via the reference sync.
  EventBus.on(EVENTS.LOCATIONS_UPDATED, renderReviewLocationOptions);
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      reviewFilters.charityId = '';
      reviewFilters.socialWorkerId = '';
      reviewFilters.center = '';
      reviewFilters.village = '';
      if (charitySelect) charitySelect.value = '';
      if (workerSelect) workerSelect.value = '';
      if (centerSelect) centerSelect.value = '';
      if (villageSelect) villageSelect.value = '';
      renderReviewLocationOptions();
      loadCases();
    });
  }
}

/** "N حالة مطابقة" next to the filters while any of them is set. */
function setReviewFiltersCount(total) {
  const el = DOM.qs('#review-filters-count');
  if (!el) return;
  el.textContent = hasActiveReviewFilters() && typeof total === 'number' ? `${total} حالة مطابقة` : '';
}

/**
 * فلتر "حالاتي" (`mine`) بيمر بـ GET /cases?createdByMe=true بدل /search/cases،
 * لأن الأخيرة مالهاش createdByMe. باقي الفلاتر بتروح /search/cases بالـ status
 * بتاعها، والسيرفر هو اللي بيفلتر.
 */
function fetchCasesPage(page) {
  if (activeFilter === 'mine') {
    return CasesService.list({ createdByMe: true, page, limit: PAGE_SIZE });
  }
  const q = serverQuery();
  const review = activeReviewFilters();
  // Review tab without search text: GET /cases filters center/village by
  // exact id. /search/cases only has `region` (partial name match, so "ناصر"
  // would also catch "عزبة ناصر" in another center) — used only when a
  // search text needs `q`, which /cases doesn't have.
  const locationIdsResolved = (!review.centerName || review.centerId) && (!review.villageName || review.villageId);
  if (activeFilter === REVIEW_FILTER_TAB && !q && locationIdsResolved) {
    return CasesService.list({
      status: FILTER_STATUSES[activeFilter][0],
      charityId: review.charityId,
      socialWorkerId: review.socialWorkerId,
      centerId: review.centerId,
      villageId: review.villageId,
      page,
      limit: PAGE_SIZE
    });
  }
  return CasesService.search({
    q,
    status: FILTER_STATUSES[activeFilter],
    charityId: review.charityId,
    socialWorkerId: review.socialWorkerId,
    region: review.villageName || review.centerName,
    page,
    limit: PAGE_SIZE
  });
}

/** Loads page 1 from the real API for the active tab + search text. */
async function loadCases() {
  // Entering the screen and a dashboard KPI click (setCasesFilter) can both
  // start a load back to back; only the latest one may paint its result.
  const requestId = ++loadRequestId;
  isLoading = true;
  loadError = null;
  currentPage = 1;
  hasMore = false;
  renderAllCasesGrid();
  try {
    const result = await fetchCasesPage(1);
    if (requestId !== loadRequestId) return;
    const items = (result && result.items) || [];
    casesList = items.map(normalizeCase);
    hasMore = Boolean(result && result.hasNext);
    const total = result && typeof result.total === 'number' ? result.total : null;
    // Without a search text or review filter, the server's total for this tab
    // IS the tab's count — keeps the badge equal to what the list can show.
    if (!serverQuery() && !hasActiveReviewFilters() && total !== null) {
      setFilterCount(activeFilter, total);
    }
    setReviewFiltersCount(total);
  } catch (err) {
    if (requestId !== loadRequestId) return;
    casesList = [];
    loadError = err;
    setReviewFiltersCount(null);
  } finally {
    if (requestId === loadRequestId) {
      isLoading = false;
      renderAllCasesGrid();
    }
  }
}

/** Appends the next page to the currently loaded list — same query, same status filtering rules as loadCases(). */
async function loadMoreCases() {
  if (isLoadingMore || !hasMore) return;
  const nextPage = currentPage + 1;

  isLoadingMore = true;
  renderAllCasesGrid();
  try {
    const result = await fetchCasesPage(nextPage);
    const items = (result && result.items) || [];
    const newCases = items.map(normalizeCase);
    casesList = casesList.concat(newCases);
    currentPage = nextPage;
    hasMore = Boolean(result && result.hasNext);
    // Append-only: avoids rebuilding every previously-rendered card's HTML
    // just to add one more page — matters once casesList grows into the
    // hundreds, where a full re-render means re-creating hundreds of DOM nodes.
    renderAllCasesGrid({ appendCases: newCases });
    return;
  } catch (err) {
    showToast('تعذر تحميل المزيد من الحالات. الحالات المعروضة كما هي.', 'error', undefined, retryToast(loadMoreCases));
  } finally {
    isLoadingMore = false;
  }
  renderAllCasesGrid();
}

function setFilterCount(key, value) {
  const el = DOM.qs(`.case-filter-count[data-filter-count="${key}"]`);
  if (el) el.textContent = String(value);
}

/** Tabs the current role can see — the hidden ones aren't worth a request. */
function visibleFilters() {
  const filters = ['all', 'pending', 'returned', 'accepted', 'rejected'];
  if (isRole(ROLES.MANAGER)) filters.push('awaiting_approval');
  if (isRole(ROLES.DATA_ENTRY)) filters.push('mine');
  return filters;
}

/**
 * Exact count for one tab = the `total` of the same query the tab lists
 * (limit 1, so only the number travels). Same source as the list itself, so
 * the badge can never promise cases the tab won't show.
 */
async function fetchFilterTotal(filter) {
  const result = filter === 'mine'
    ? await CasesService.list({ createdByMe: true, page: 1, limit: 1 })
    : await CasesService.search({ status: FILTER_STATUSES[filter], page: 1, limit: 1 });
  return result && typeof result.total === 'number' ? result.total : null;
}

/** Refreshes every visible tab's badge; a failed one keeps its last value. */
async function refreshFilterCounts() {
  await Promise.all(visibleFilters().map(async filter => {
    try {
      const total = await fetchFilterTotal(filter);
      if (total !== null) setFilterCount(filter, total);
    } catch {
      // Badge stays as it was — the list itself shows its own error state.
    }
  }));
}

/**
 * The server already filtered by status and search text; this only guards
 * the status (in case a tab's response ever comes back unfiltered) and
 * applies the search text to "حالاتي", whose endpoint has no `q`.
 */
function matchesActiveFilter(c) {
  const statuses = FILTER_STATUSES[activeFilter];
  if (statuses && !statuses.includes(c.rawStatus)) return false;
  if (activeFilter !== 'mine') return true;
  const trimmedQuery = searchQuery.trim().toLowerCase();
  return !trimmedQuery ||
    c.name.toLowerCase().includes(trimmedQuery) ||
    c.nid.includes(trimmedQuery) ||
    c.phone.includes(trimmedQuery) ||
    c.village.toLowerCase().includes(trimmedQuery) ||
    c.center.toLowerCase().includes(trimmedQuery);
}

/** "الجمعية (المركز — القرية)" without empty brackets/dashes for missing parts. */
function locationText(c) {
  const place = [c.center, c.village].filter(Boolean).join(' — ');
  const text = [c.charity, place && `(${place})`].filter(Boolean).join(' ');
  return text || '—';
}

/** Builds one case card's HTML — shared by the full render and the append-only path. */
function caseCardHTML(c) {
  return `
    <div class="glass-card case-item-card">
      <div class="case-item-card__header">
        <div>
          <span class="dash-status-pill ${c.statusClass}" style="margin-bottom: 6px; display: inline-block;">${DOM.escapeHTML(c.statusLabel)}</span>
          <h3 class="case-item-card__name">${DOM.escapeHTML(c.name || '—')}</h3>
        </div>
        <span class="badge" style="background: rgba(255,255,255,0.7); color: var(--color-primary); font-weight: 800;">${DOM.escapeHTML(String(c.id))}</span>
      </div>

      <!-- Outer Card Properties (الاسم - الرقم القومي - عدد أفراد الأسرة) -->
      <div class="case-item-card__details">
        <div class="case-item-detail-row">
          <span class="detail-label">🪪 الرقم القومي:</span>
          <span class="detail-val" style="font-family: monospace; font-weight: 800; font-size: 14px;">${DOM.escapeHTML(c.nid || '—')}</span>
        </div>
        ${c.familyMembersCount !== null ? `
        <div class="case-item-detail-row">
          <span class="detail-label">👨‍👩‍👧‍👦 عدد أفراد الأسرة:</span>
          <span class="detail-val" style="font-weight: 800;">${c.familyMembersCount} أفراد</span>
        </div>` : ''}
        <div class="case-item-detail-row">
          <span class="detail-label">🏢 الجمعية والموقع:</span>
          <span class="detail-val" style="font-size: 12px;">${DOM.escapeHTML(locationText(c))}</span>
        </div>
        ${c.workerName ? `
        <div class="case-item-detail-row">
          <span class="detail-label">👤 الأخصائي:</span>
          <span class="detail-val">${DOM.escapeHTML(c.workerName)}</span>
        </div>` : ''}
        ${c.registrationDate ? `
        <div class="case-item-detail-row">
          <span class="detail-label">📅 تاريخ التسجيل:</span>
          <span class="detail-val" style="font-family: monospace;">${DOM.escapeHTML(c.registrationDate)}</span>
        </div>` : ''}
        <div class="case-item-detail-row">
          <span class="detail-label">📞 الهاتف:</span>
          <span class="detail-val" style="font-family: monospace;">${DOM.escapeHTML(c.phone || '—')}</span>
        </div>
      </div>

      <button type="button" class="btn btn--primary btn--full btn-open-case-detail" data-case-id="${c.rawId}" style="margin-top: 16px; font-weight: 800;">
        <span>فتح فحص وتقييم الحالة بالكامل 📂</span>
      </button>
    </div>
  `;
}

/** Builds the "load more" footer card, or '' when there's no next page. */
function loadMoreFooterHTML() {
  if (!hasMore) return '';
  return `
    <div class="glass-card load-more-footer" style="padding: 24px; text-align: center; grid-column: 1 / -1;">
      <button type="button" class="btn btn--secondary btn-load-more-cases" ${isLoadingMore ? 'disabled' : ''} style="font-weight: 800;">
        ${isLoadingMore ? '⏳ جاري التحميل...' : `تحميل المزيد من الحالات (عرض ${casesList.length}) ⬇️`}
      </button>
    </div>
  `;
}

function attachCaseCardListeners(root) {
  // case-details.component.js is now API-backed (fetches GET /cases/{id} +
  // family-members/support/attachments by the real server GUID) — open it
  // directly instead of the old "coming soon" placeholder.
  root.querySelectorAll('.btn-open-case-detail').forEach(btn => {
    btn.addEventListener('click', () => {
      const caseId = btn.getAttribute('data-case-id');
      if (caseId && window.openCaseDetailsPage) window.openCaseDetailsPage(caseId);
    });
  });
}

/**
 * Appends newly-loaded-page cases straight to the existing DOM instead of
 * re-rendering the whole grid. Only valid right after loadMoreCases() —
 * requires the grid to already be showing the non-empty, filtered list from
 * the previous render (activeFilter/searchQuery unchanged since then).
 */
function appendCasesToGrid(casesGrid, appendCases) {
  const newlyVisible = appendCases.filter(matchesActiveFilter);

  const oldFooter = casesGrid.querySelector('.load-more-footer');
  if (oldFooter) oldFooter.remove();

  if (newlyVisible.length > 0) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = newlyVisible.map(caseCardHTML).join('');
    const newCards = Array.from(wrapper.children);
    newCards.forEach(node => casesGrid.appendChild(node));
    attachCaseCardListeners(casesGrid);
  }

  const footerHTML = loadMoreFooterHTML();
  if (footerHTML) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = footerHTML;
    const footerNode = wrapper.firstElementChild;
    casesGrid.appendChild(footerNode);
    const loadMoreBtn = footerNode.querySelector('.btn-load-more-cases');
    if (loadMoreBtn) loadMoreBtn.addEventListener('click', loadMoreCases);
  }
}

export function renderAllCasesGrid({ appendCases } = {}) {
  const casesGrid = DOM.qs('#all-cases-grid');
  if (!casesGrid) return;

  // Only safe once the grid is already showing real case cards — if the
  // previous render was the loading state or the "no results" empty state,
  // there's nothing to append onto, so fall through to a full render.
  if (appendCases && casesGrid.querySelector('.case-item-card')) {
    appendCasesToGrid(casesGrid, appendCases);
    return;
  }

  if (isLoading) {
    casesGrid.innerHTML = `
      <div class="glass-card" style="padding: 40px; text-align: center; grid-column: 1 / -1;">
        <span style="font-size: 13px; color: var(--text-secondary); font-weight: 700;">⏳ جاري تحميل الحالات...</span>
      </div>
    `;
    return;
  }

  if (loadError) {
    casesGrid.innerHTML = `<div class="glass-card" style="grid-column: 1 / -1;">${errorStateHTML(loadError, 'الحالات')}</div>`;
    bindRetry(casesGrid, loadCases);
    return;
  }

  // No client-side text filter on server results: the server also matches
  // phone numbers and Arabic/Hindi digits, which a local re-check would drop.
  const filtered = casesList.filter(matchesActiveFilter);

  if (filtered.length === 0) {
    // Check if searchQuery looks like a national ID (digits only, up to 14)
    const isNidSearch = /^\d+$/.test(searchQuery) && searchQuery.length >= 1;

    casesGrid.innerHTML = `
      <div class="glass-card" style="padding: 40px; text-align: center; grid-column: 1 / -1;">
        <span style="font-size: 36px; display: block; margin-bottom: 12px;">🔍</span>
        <h3 style="font-size: 18px; font-weight: 800; color: #000; margin: 0 0 6px;">لم يتم العثور على حالات مطابقة</h3>
        <p style="font-size: 13px; color: var(--text-secondary); margin: 0 0 16px;">
          ${hasMore
            ? 'لا توجد حالات مطابقة في الصفحة المحمّلة حاليًا — جرب "تحميل المزيد من الحالات" أدناه.'
            : 'جرب تغيير معيار التصفية أو البحث عن اسم/رقم قومي آخر.'}
        </p>
        ${hasMore ? `
          <button type="button" class="btn btn--secondary btn-load-more-cases" ${isLoadingMore ? 'disabled' : ''} style="font-weight: 800; margin-bottom: 10px;">
            ${isLoadingMore ? '⏳ جاري التحميل...' : 'تحميل المزيد من الحالات ⬇️'}
          </button>
        ` : ''}
        ${isNidSearch ? `
          <button type="button" class="btn btn--primary btn--sm btn-register-new-case-nid" data-prefill-nid="${DOM.escapeHTML(searchQuery)}" style="font-weight: 800; font-size: 14px; padding: 10px 24px; gap: 8px; display: inline-flex; align-items: center;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            تسجيل حالة جديدة بالرقم القومي: ${DOM.escapeHTML(searchQuery)}
          </button>
        ` : ''}
      </div>
    `;

    // Attach click handler for register new case button
    const registerBtn = casesGrid.querySelector('.btn-register-new-case-nid');
    if (registerBtn) {
      registerBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const prefillNid = registerBtn.getAttribute('data-prefill-nid');
        if (window.switchView) {
          window.switchView('personal-data');
        }
        // Prefill national ID after view switch (use setTimeout to ensure DOM is ready)
        if (prefillNid) {
          setTimeout(() => {
            const nidInput = DOM.qs('#national-id');
            if (nidInput) {
              nidInput.value = prefillNid;
              nidInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }, 100);
        }
      });
    }

    const loadMoreBtnEmpty = casesGrid.querySelector('.btn-load-more-cases');
    if (loadMoreBtnEmpty) loadMoreBtnEmpty.addEventListener('click', loadMoreCases);

    return;
  }

  casesGrid.innerHTML = filtered.map(caseCardHTML).join('') + loadMoreFooterHTML();

  attachCaseCardListeners(casesGrid);

  const loadMoreBtn = casesGrid.querySelector('.btn-load-more-cases');
  if (loadMoreBtn) loadMoreBtn.addEventListener('click', loadMoreCases);
}
