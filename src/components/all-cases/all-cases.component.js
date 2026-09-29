/* --------------------------------------------------------------------------
   ALL CASES VIEW COMPONENT CONTROLLER
   Manages cases listing, status filtering, and search queries.

   Real API-backed: search goes through CasesService.search() ->
   GET /api/v1/search/cases (server-side, cross-worker — see cases.service.js).
   That endpoint has no `status` param, so the status filter tabs stay
   client-side over whatever page of results came back. The one exception is
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
import { DashboardService } from '../../services/dashboard.service.js';
import { messageFromError } from '../../services/errors.js';
import { isRole, ROLES } from '../../core/permissions.js';

// Real backend status enum (10 values) -> the 3 status tabs this screen
// exposes today. Anything not listed below (draft, pending_assignment,
// assigned, accepted, in_research) falls back to a neutral "قيد المراجعة"
// label rather than being hidden, since the tabs are a simplification of a
// richer workflow, not the full state machine.
const STATUS_DISPLAY = {
  pending_review: { label: 'قيد المراجعة', pillClass: 'dash-status-pill--warning', tab: 'pending' },
  returned_to_worker: { label: 'مرتجعة للأخصائي', pillClass: 'dash-status-pill--warning', tab: 'pending' },
  pending_approval: { label: 'قيد الاعتماد', pillClass: 'dash-status-pill--warning', tab: 'pending' },
  approved: { label: 'معتمدة', pillClass: 'dash-status-pill--success', tab: 'accepted' },
  rejected: { label: 'مرفوضة', pillClass: 'dash-status-pill--danger', tab: 'rejected' }
};

function displayForStatus(status) {
  return STATUS_DISPLAY[status] || { label: 'قيد المراجعة', pillClass: 'dash-status-pill--warning', tab: 'pending' };
}

/** Normalizes one CaseSearchResultItem (real API) into the shape the render/modal code expects. */
function normalizeCase(item) {
  const statusInfo = displayForStatus(item.status);
  return {
    id: item.displayId || item.caseNumber || item.id,
    rawId: item.id,
    name: item.beneficiaryFullName || '',
    nid: item.nationalId || '',
    phone: item.phonePrimary || '',
    charity: item.charityName || '',
    center: item.centerName || '',
    village: item.villageName || '',
    familyMembersCount: item.familyMembersCount ?? '—',
    registrationDate: item.registrationDate,
    status: statusInfo.tab,
    statusLabel: statusInfo.label,
    statusClass: statusInfo.pillClass,
    // Real backend status enum value (ungrouped) — needed by the manager-only
    // "awaiting_approval" tab, which must match exactly `pending_approval`
    // and not the broader "pending" tab grouping (pending_review +
    // returned_to_worker + pending_approval) used everywhere else.
    rawStatus: item.status
  };
}

const PAGE_SIZE = 50;

let activeFilter = 'all';
let searchQuery = '';
let casesList = [];
let isLoading = false;
let isLoadingMore = false;
let currentPage = 1;
let hasMore = false;
let searchDebounce = null;
// True once /dashboard/stats has given real global counts (not capped by
// however many pages loadCases()/loadMoreCases() have fetched so far) —
// once set, the page-local fallback stops overwriting them with a smaller number.
let statsCountsAvailable = false;
// Separate flag for "pending" specifically — only data_entry's stats expose
// a matching `pendingReview` field; reviewer/manager still need the
// page-local approximation for this one tab even once the other counts are stats-backed.
let pendingCountFromStatsAvailable = false;
// Separate flag for "awaiting_approval" (manager's `awaitingMyApproval`) — same reasoning.
let awaitingApprovalCountFromStatsAvailable = false;

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

  refreshFilterCountsFromStats();
  loadCases();
}

export function setCasesFilter(filterName) {
  const previousFilter = activeFilter;
  activeFilter = filterName || 'all';
  const filterBtns = DOM.qsa('.btn-case-filter');
  filterBtns.forEach(btn => {
    const f = btn.getAttribute('data-filter');
    btn.classList.toggle('btn-case-filter--active', f === activeFilter);
  });
  // 'mine' (GET /cases?createdByMe=true) and 'all' (/search/cases) load from
  // different endpoints — casesList from one isn't valid for the other, so a
  // switch between them needs a real re-fetch, not just a client re-filter.
  if (activeFilter === 'mine' || previousFilter === 'mine') {
    loadCases();
    return;
  }
  renderAllCasesGrid();
}

/**
 * فلتر "حالاتي" (`mine`) بيمر بـ GET /cases?createdByMe=true بدل /search/cases،
 * لأن الأخيرة مالهاش createdByMe. باقي الفلاتر (all/pending/accepted/...)
 * فاضلة على /search/cases زي ما هي.
 */
function fetchCasesPage(page) {
  if (activeFilter === 'mine') {
    return CasesService.list({ createdByMe: true, page, limit: PAGE_SIZE });
  }
  const trimmedQuery = searchQuery.trim();
  const q = trimmedQuery.length >= 2 ? trimmedQuery : undefined;
  return CasesService.search({ q, page, limit: PAGE_SIZE });
}

/** Loads page 1 from the real API, applying the free-text search. Status stays client-side (see header note). */
async function loadCases() {
  isLoading = true;
  currentPage = 1;
  hasMore = false;
  renderAllCasesGrid();
  try {
    const result = await fetchCasesPage(1);
    const items = (result && result.items) || [];
    casesList = items.map(normalizeCase);
    hasMore = Boolean(result && result.hasNext);
  } catch (err) {
    casesList = [];
    showToast(`تعذر تحميل قائمة الحالات: ${messageFromError(err)} ⚠️`);
  } finally {
    isLoading = false;
    updateFilterCountsFromLoadedPage();
    renderAllCasesGrid();
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
    updateFilterCountsFromLoadedPage();
    // Append-only: avoids rebuilding every previously-rendered card's HTML
    // just to add one more page — matters once casesList grows into the
    // hundreds, where a full re-render means re-creating hundreds of DOM nodes.
    renderAllCasesGrid({ appendCases: newCases });
    return;
  } catch (err) {
    showToast(`تعذر تحميل المزيد من الحالات: ${messageFromError(err)} ⚠️`);
  } finally {
    isLoadingMore = false;
  }
  updateFilterCountsFromLoadedPage();
  renderAllCasesGrid();
}

function setFilterCount(key, value) {
  const el = DOM.qs(`.case-filter-count[data-filter-count="${key}"]`);
  if (el) el.textContent = String(value);
}

/**
 * True global counts from GET /dashboard/stats (reviewer/manager only —
 * totalCases/acceptedCases/rejectedCases). Unlike counting the loaded search
 * page, these aren't capped at loadCases()'s limit:100, so they match what
 * the dashboard's own KPI cards show. data_entry's stats shape has none of
 * these fields, so it silently falls through to the page-local approximation.
 */
async function refreshFilterCountsFromStats() {
  try {
    const stats = await DashboardService.getStats();
    if (typeof stats.totalCases === 'number' && typeof stats.acceptedCases === 'number' && typeof stats.rejectedCases === 'number') {
      setFilterCount('all', stats.totalCases);
      setFilterCount('accepted', stats.acceptedCases);
      setFilterCount('rejected', stats.rejectedCases);
      statsCountsAvailable = true;
    }
    // "قيد المراجعة" here must match the exact figure the homepage KPI card
    // shows (§15 data_entry's `pendingReview`) — NOT totalCases minus
    // accepted/rejected, which also sweeps in draft/pending_assignment/
    // assigned/accepted-by-worker/in_research and overcounts badly.
    // reviewer/manager stats don't expose an equivalent single field, so
    // their tab stays on the page-local approximation below.
    if (typeof stats.pendingReview === 'number') {
      setFilterCount('pending', stats.pendingReview);
      pendingCountFromStatsAvailable = true;
    }
    // data_entry's "حالاتي" tab count — same field as the dashboard's
    // "حالات أدخلتها" KPI card.
    if (typeof stats.createdByMe === 'number') {
      setFilterCount('mine', stats.createdByMe);
    }
    // Same field the dashboard's "بانتظار اعتمادك" KPI card reads — manager only.
    if (typeof stats.awaitingMyApproval === 'number') {
      setFilterCount('awaiting_approval', stats.awaitingMyApproval);
      awaitingApprovalCountFromStatsAvailable = true;
    }
  } catch (err) {
    // Stay on the page-local fallback below rather than showing an error on the tabs.
  }
}

/** Fallback for roles/failures without global stats: counts only the currently loaded search page. */
function updateFilterCountsFromLoadedPage() {
  if (statsCountsAvailable && pendingCountFromStatsAvailable && awaitingApprovalCountFromStatsAvailable) return;
  const counts = { all: casesList.length, pending: 0, accepted: 0, rejected: 0, awaiting_approval: 0 };
  casesList.forEach(c => {
    if (counts[c.status] !== undefined) counts[c.status] += 1;
    if (c.rawStatus === 'pending_approval') counts.awaiting_approval += 1;
  });
  if (!statsCountsAvailable) {
    setFilterCount('all', counts.all);
    setFilterCount('accepted', counts.accepted);
    setFilterCount('rejected', counts.rejected);
  }
  if (!pendingCountFromStatsAvailable) {
    setFilterCount('pending', counts.pending);
  }
  if (!awaitingApprovalCountFromStatsAvailable) {
    setFilterCount('awaiting_approval', counts.awaiting_approval);
  }
}

/** Builds one case card's HTML — shared by the full render and the append-only path. */
function caseCardHTML(c) {
  return `
    <div class="glass-card case-item-card">
      <div class="case-item-card__header">
        <div>
          <span class="dash-status-pill ${c.statusClass}" style="margin-bottom: 6px; display: inline-block;">${c.statusLabel}</span>
          <h3 class="case-item-card__name">${DOM.escapeHTML(c.name)}</h3>
        </div>
        <span class="badge" style="background: rgba(255,255,255,0.7); color: var(--color-primary); font-weight: 800;">${c.id}</span>
      </div>

      <!-- Outer Card Properties (الاسم - الرقم القومي - عدد أفراد الأسرة) -->
      <div class="case-item-card__details">
        <div class="case-item-detail-row">
          <span class="detail-label">🪪 الرقم القومي:</span>
          <span class="detail-val" style="font-family: monospace; font-weight: 800; font-size: 14px;">${c.nid}</span>
        </div>
        <div class="case-item-detail-row">
          <span class="detail-label">👨‍👩‍👧‍👦 عدد أفراد الأسرة:</span>
          <span class="detail-val" style="font-weight: 800;">${c.familyMembersCount} أفراد</span>
        </div>
        <div class="case-item-detail-row">
          <span class="detail-label">🏢 الجمعية والموقع:</span>
          <span class="detail-val" style="font-size: 12px;">${DOM.escapeHTML(c.charity)} (${c.center} — ${c.village})</span>
        </div>
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
  const trimmedQuery = searchQuery.trim().toLowerCase();
  const newlyVisible = appendCases.filter(c => {
    // 'mine' is already server-scoped (GET /cases?createdByMe=true) — no
    // extra status filtering on top, same as 'all'.
    const matchesFilter = activeFilter === 'all' || activeFilter === 'mine'
      || (activeFilter === 'awaiting_approval' ? c.rawStatus === 'pending_approval' : c.status === activeFilter);
    const matchesSearch = !trimmedQuery ||
      c.name.toLowerCase().includes(trimmedQuery) ||
      c.nid.includes(trimmedQuery) ||
      c.village.toLowerCase().includes(trimmedQuery) ||
      c.center.toLowerCase().includes(trimmedQuery);
    return matchesFilter && matchesSearch;
  });

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

  // Client-side: status tab filter (no `status` param on search/cases) +
  // a same-query safety-net filter, since the server call above may still
  // be in-flight/debounced for very short queries.
  const trimmedQuery = searchQuery.trim().toLowerCase();
  const filtered = casesList.filter(c => {
    // 'mine' is already server-scoped (GET /cases?createdByMe=true) — no
    // extra status filtering on top, same as 'all'.
    const matchesFilter = activeFilter === 'all' || activeFilter === 'mine'
      || (activeFilter === 'awaiting_approval' ? c.rawStatus === 'pending_approval' : c.status === activeFilter);
    const matchesSearch = !trimmedQuery ||
      c.name.toLowerCase().includes(trimmedQuery) ||
      c.nid.includes(trimmedQuery) ||
      c.village.toLowerCase().includes(trimmedQuery) ||
      c.center.toLowerCase().includes(trimmedQuery);

    return matchesFilter && matchesSearch;
  });

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
