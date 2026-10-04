/* --------------------------------------------------------------------------
   CASE SUPPORT FILTER CONTROLLER (MANAGER-ONLY)
   Filters cases by charity (`charityId`, exact GUID match on cases.charity_id)
   combined with support type actually RECEIVED (`supportType`, matches
   case_support_history — not case_assessed_needs and not approved_support).
   Both go through the extended GET /search/cases (see cases.service.js).
   Exports the current result page to an official-branded PDF via
   case-pdf.service.js's exportCaseListToPdf().

   The charity picker itself mirrors the "الجمعية والنطاق الجغرافي" card in
   the personal-data wizard (location-cascade.component.js): المركز/القرية
   narrow the charity <select>'s options, same store.locationIds source via
   LocationsService — but a free-text search box stays independent of that
   narrowing so every charity is always reachable, never hidden behind a
   center/village pick.
   -------------------------------------------------------------------------- */
import { DOM } from '../../utils/dom.js';
import { showToast } from '../../utils/toast.js';
import { store } from '../../state/store.js';
import { EventBus, EVENTS } from '../../core/event-bus.js';
import { CasesService } from '../../services/cases.service.js';
import { CharitiesService } from '../../services/charities.service.js';
import { LocationsService } from '../../services/locations.service.js';
import { messageFromError } from '../../services/errors.js';
import { onViewEnter } from '../../core/view-lifecycle.js';
import { supportTypeLabel } from '../../utils/support-labels.js';

// Real production values from the backend's case_support_history column,
// stored as-is (case-sensitive, no normalization) — do not re-derive this
// list client-side, the backend confirmed these are the exact stored strings.
const SUPPORT_TYPES = [
  'مصروفات دراسية',
  'زي مدرسي',
  'كرتونة',
  'لحمة',
  'وصلة مياه',
  'سقف',
  'مرشح لبنك الطعام',
  'عمليات',
  'سماعات',
  'صرف',
  'منح دراسية',
  'مرحاض',
  'أثاث',
  'أجهزة',
  'تجهيز عرائس',
  'الاذنين',
  'بناء غرفة',
  'كهرباء',
  'علاج دوري',
  'يمين',
  'طرف صناعي',
  'يسار',
  'أخري',
  'كرسى متحرك عادى',
  'حفاضات طبيه',
  'دعم تجريبى',
  'ألبان أطفال',
  'علاج سكر',
  'منحة تعلمية',
  'كرسى متحرك كهرباء'
];

// The backend caps combined supportType values at 10 per request.
const MAX_SUPPORT_TYPES = 10;

// Backend max page size — fewer round-trips when walking every page.
const PAGE_SIZE = 100;

const STATUS_LABELS = {
  draft: 'مسودة',
  pending_assignment: 'بانتظار التعيين',
  assigned: 'معيّنة',
  accepted: 'مقبولة من الأخصائي',
  in_research: 'قيد البحث الميداني',
  pending_review: 'قيد المراجعة',
  returned_to_worker: 'مرتجعة للأخصائي',
  pending_approval: 'قيد الاعتماد',
  approved: 'معتمدة',
  rejected: 'مرفوضة'
};

let selectedCharityId = '';
let appliedHeader = { charityName: '', center: '', village: '' };
let selectedSupportTypes = [];
let currentResults = [];
let totalCount = 0;
let isLoading = false;
let hasAppliedOnce = false;

// Live roster from CharitiesService, enriched with center/village NAMES via
// store.locationIds — same shape/source as location-cascade.component.js's
// allCharities, so this picker narrows exactly the way the reference card does.
let allCharities = [];
let charitySearchQuery = '';

export function initCaseSupportFilterComponent() {
  const districtSelect = DOM.qs('#csf-district-select');
  const villageSelect = DOM.qs('#csf-village-select');
  const charitySelect = DOM.qs('#csf-charity-select');
  const charitySearchInput = DOM.qs('#csf-charity-search-input');
  const chipsContainer = DOM.qs('#csf-support-chips');
  const applyBtn = DOM.qs('#btn-csf-apply');
  const resetBtn = DOM.qs('#btn-csf-reset');
  const exportBtn = DOM.qs('#btn-csf-export-pdf');

  if (!charitySelect || !chipsContainer) return; // view not mounted (non-manager build, defensive)

  renderSupportChips(chipsContainer);

  // Pickers are filled when the screen is first opened, not at boot. The
  // charity roster comes from the reference cache, so this is normally free.
  let pickersLoaded = false;
  onViewEnter('case-support-filter', () => {
    pickersLoaded = true;
    ensureLocationsLoaded().then(() => {
      updateDistrictOptions(districtSelect);
      loadCharities(charitySelect, districtSelect, villageSelect);
    });
  }, { once: true });

  if (districtSelect) {
    districtSelect.addEventListener('change', () => {
      updateVillageOptions(villageSelect, districtSelect.value);
      renderCharityOptions(charitySelect, districtSelect.value, villageSelect ? villageSelect.value : '');
    });
  }

  if (villageSelect) {
    villageSelect.addEventListener('change', () => {
      renderCharityOptions(charitySelect, districtSelect ? districtSelect.value : '', villageSelect.value);
    });
  }

  if (charitySearchInput) {
    let searchDebounce = null;
    charitySearchInput.addEventListener('input', () => {
      charitySearchQuery = charitySearchInput.value.trim().toLowerCase();
      clearTimeout(searchDebounce);
      // A free-text search always looks across ALL charities, ignoring the
      // center/village narrowing — the two coexist rather than combine, so
      // no charity is ever unreachable behind a center/village pick.
      searchDebounce = setTimeout(() => {
        renderCharityOptions(charitySelect, districtSelect ? districtSelect.value : '', villageSelect ? villageSelect.value : '');
      }, 250);
    });
  }

  chipsContainer.addEventListener('click', (e) => {
    const chip = e.target.closest('.csf-support-chip');
    if (!chip) return;
    const checkbox = chip.querySelector('input[type="checkbox"]');
    if (!checkbox) return;
    if (e.target !== checkbox) {
      checkbox.checked = !checkbox.checked;
    }
    toggleSupportType(checkbox.value, checkbox.checked, chip, checkbox);
  });

  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      // With neither a charity nor a support type the query carries no
      // filter at all and /search/cases returns every case — require at
      // least one real criterion (المركز/القرية only narrow the picker,
      // they are not sent to the server).
      if (!charitySelect.value && selectedSupportTypes.length === 0) {
        showToast('اختر جمعية أو نوع دعم واحد على الأقل قبل تطبيق الفلتر ⚠️');
        return;
      }
      selectedCharityId = charitySelect.value || '';
      // Roster header identity comes from the chosen charity's own record
      // (its registered مركز/قرية), falling back to the geo pickers — never
      // from the cases, which can live in several villages.
      const charity = allCharities.find(c => c.id === selectedCharityId);
      appliedHeader = {
        charityName: charity ? charity.name : '',
        center: (charity && charity.center) || (districtSelect ? districtSelect.value : ''),
        village: (charity && charity.village) || (villageSelect ? villageSelect.value : '')
      };
      applyFilter();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (districtSelect) districtSelect.value = '';
      if (villageSelect) {
        villageSelect.value = '';
        villageSelect.disabled = true;
        villageSelect.innerHTML = '<option value="" selected>-- اختر المركز أولاً --</option>';
      }
      if (charitySearchInput) charitySearchInput.value = '';
      charitySearchQuery = '';
      renderCharityOptions(charitySelect, '', '');
      charitySelect.value = '';
      selectedCharityId = '';
      appliedHeader = { charityName: '', center: '', village: '' };
      selectedSupportTypes = [];
      DOM.qsa('.csf-support-chip', chipsContainer).forEach(chip => {
        chip.classList.remove('csf-support-chip--active');
        const cb = chip.querySelector('input[type="checkbox"]');
        if (cb) cb.checked = false;
      });
      filterRequestId++; // drop any fetch still in flight
      isLoading = false;
      currentResults = [];
      totalCount = 0;
      hasAppliedOnce = false;
      renderResults();
    });
  }

  if (exportBtn) {
    exportBtn.addEventListener('click', handleExportPdf);
  }


  EventBus.on(EVENTS.CHARITIES_UPDATED, () => {
    if (!pickersLoaded) return; // first open will load the current roster anyway
    loadCharities(charitySelect, districtSelect, villageSelect);
  });

  EventBus.on(EVENTS.LOCATIONS_UPDATED, () => {
    if (!pickersLoaded) return;
    updateDistrictOptions(districtSelect);
    updateVillageOptions(villageSelect, districtSelect ? districtSelect.value : '');
    // Center/village names for already-loaded charities depend on
    // store.locationIds, which LOCATIONS_UPDATED just (re)populated —
    // re-derive them, not just re-render with the stale names.
    loadCharities(charitySelect, districtSelect, villageSelect);
  });
}

async function ensureLocationsLoaded() {
  const centerIds = store.locationIds && store.locationIds.centers;
  if (centerIds && Object.keys(centerIds).length > 0) return;
  try {
    const centers = await LocationsService.list();
    store.applyLocationsFromServer(centers);
  } catch {
    // Non-fatal — المركز/القرية stay empty, the charity <select> and its
    // free-text search still work unfiltered.
  }
}

function updateDistrictOptions(districtSelect) {
  if (!districtSelect) return;
  const centers = Object.keys(store.beniSuefLocations || {});
  const currentVal = districtSelect.value;
  districtSelect.innerHTML = '<option value="" selected>-- كل المراكز --</option>' +
    centers.map(c => `<option value="${DOM.escapeHTML(c)}">${DOM.escapeHTML(c)}</option>`).join('');
  if (currentVal && centers.includes(currentVal)) districtSelect.value = currentVal;
}

function updateVillageOptions(villageSelect, center) {
  if (!villageSelect) return;
  if (!center) {
    villageSelect.innerHTML = '<option value="" selected>-- اختر المركز أولاً --</option>';
    villageSelect.disabled = true;
    return;
  }
  const villages = (store.beniSuefLocations || {})[center] || [];
  const currentVal = villageSelect.value;
  villageSelect.innerHTML = '<option value="" selected>-- كل القرى --</option>' +
    villages.map(v => `<option value="${DOM.escapeHTML(v)}">${DOM.escapeHTML(v)}</option>`).join('');
  villageSelect.disabled = false;
  if (currentVal && villages.includes(currentVal)) villageSelect.value = currentVal;
}

function findCenterNameById(centerId) {
  if (!centerId) return '';
  const centerIds = store.locationIds.centers || {};
  const match = Object.entries(centerIds).find(([, id]) => id === centerId);
  return match ? match[0] : '';
}

function findVillageNameById(centerName, villageId) {
  if (!villageId || !centerName) return '';
  const villages = (store.locationIds.villages || {})[centerName] || {};
  const match = Object.entries(villages).find(([, id]) => id === villageId);
  return match ? match[0] : '';
}

/** Narrows the charity <select> by center/village (if chosen) AND the free-text search (if typed) — both apply together, neither hides a charity the other would show alone once cleared. */
function renderCharityOptions(charitySelect, center, village) {
  if (!charitySelect) return;
  const currentVal = charitySelect.value;

  let matching = allCharities;
  if (center) matching = matching.filter(c => c.center === center);
  if (village) matching = matching.filter(c => c.village === village);
  if (charitySearchQuery) {
    matching = matching.filter(c => c.name.toLowerCase().includes(charitySearchQuery));
  }

  if (allCharities.length === 0) {
    charitySelect.innerHTML = '<option value="">لا توجد جمعيات مسجلة حالياً</option>';
    return;
  }

  if (matching.length === 0) {
    charitySelect.innerHTML = '<option value="">لا توجد جمعيات مطابقة لمعايير البحث الحالية</option>';
    return;
  }

  charitySelect.innerHTML = '<option value="">-- جميع الجمعيات --</option>' +
    matching.map(c => `<option value="${DOM.escapeHTML(c.id)}">${DOM.escapeHTML(c.name)}${c.center ? ` — مركز ${DOM.escapeHTML(c.center)}${c.village ? ` (${DOM.escapeHTML(c.village)})` : ''}` : ''}</option>`).join('');

  if (currentVal && [...charitySelect.options].some(o => o.value === currentVal)) {
    charitySelect.value = currentVal;
  }
}

function toggleSupportType(value, checked, chipEl, checkboxEl) {
  if (checked) {
    if (selectedSupportTypes.length >= MAX_SUPPORT_TYPES) {
      checkboxEl.checked = false;
      showToast(`أقصى عدد أنواع دعم يمكن دمجها معًا هو ${MAX_SUPPORT_TYPES} ⚠️`);
      return;
    }
    if (!selectedSupportTypes.includes(value)) selectedSupportTypes.push(value);
    chipEl.classList.add('csf-support-chip--active');
  } else {
    selectedSupportTypes = selectedSupportTypes.filter(v => v !== value);
    chipEl.classList.remove('csf-support-chip--active');
  }
}

function renderSupportChips(container) {
  container.innerHTML = SUPPORT_TYPES.map(type => `
    <label class="csf-support-chip">
      <input type="checkbox" value="${DOM.escapeHTML(type)}">
      <span>${DOM.escapeHTML(supportTypeLabel(type))}</span>
    </label>
  `).join('');
}

async function loadCharities(charitySelect, districtSelect, villageSelect) {
  try {
    const result = await CharitiesService.listReference();
    const items = (result && result.items) || [];
    allCharities = items.map(item => {
      const center = findCenterNameById(item.centerId);
      return {
        id: item.id,
        name: item.name,
        centerId: item.centerId,
        villageId: item.villageId,
        center,
        village: findVillageNameById(center, item.villageId)
      };
    });
  } catch (err) {
    allCharities = [];
    showToast(`تعذر تحميل قائمة الجمعيات: ${messageFromError(err)} ⚠️`);
  }
  renderCharityOptions(charitySelect, districtSelect ? districtSelect.value : '', villageSelect ? villageSelect.value : '');
}

function normalizeResultItem(item) {
  return {
    id: item.id,
    displayId: item.displayId || item.caseNumber || item.id,
    caseNumber: item.caseNumber || '',
    beneficiaryFullName: item.beneficiaryFullName || '',
    nationalId: item.nationalId || '',
    phonePrimary: item.phonePrimary || '',
    charityName: item.charityName || '',
    centerName: item.centerName || '',
    villageName: item.villageName || '',
    status: item.status || '',
    statusLabel: STATUS_LABELS[item.status] || item.status || '—',
    matchedSupport: Array.isArray(item.matchedSupport) ? item.matchedSupport : []
  };
}

// This screen only ever shows approved cases — a fixed, non-optional part of
// this filter (product decision), not a manager-toggleable option. /search/cases
// has no server-side `status` param (only the separate GET /cases does, which
// lacks charityId/supportType) — see cases.service.js — so status is filtered
// client-side. That only gives a correct count over the WHOLE result set: a
// single page mixes statuses, so "approved on page 1" made an unfiltered
// charity look smaller than the same charity + a support type (whose matches
// are mostly approved). So every server page is fetched, then filtered.
const APPROVED_STATUS = 'approved';

// Bumped on every apply/reset so a slow, superseded fetch can't overwrite newer results.
let filterRequestId = 0;

function currentFilterQuery(page) {
  return {
    charityId: selectedCharityId || undefined,
    supportType: selectedSupportTypes.length ? selectedSupportTypes : undefined,
    page,
    limit: PAGE_SIZE
  };
}

/** Walks every server page and returns the approved cases, de-duplicated by id. */
async function fetchAllApproved(requestId) {
  const byId = new Map();
  let page = 1;

  while (true) {
    const result = await CasesService.search(currentFilterQuery(page));
    if (requestId !== filterRequestId) return null;
    const items = (result && result.items) || [];
    items
      .filter(item => item.status === APPROVED_STATUS && !byId.has(item.id))
      .forEach(item => byId.set(item.id, item));
    if (!(result && result.hasNext) || items.length === 0) break;
    page += 1;
  }

  return [...byId.values()];
}

async function applyFilter() {
  const requestId = ++filterRequestId;
  hasAppliedOnce = true;
  currentResults = [];
  totalCount = 0;
  isLoading = true;
  renderResults();

  try {
    const approvedItems = await fetchAllApproved(requestId);
    if (approvedItems === null) return;
    currentResults = approvedItems.map(normalizeResultItem);
    totalCount = currentResults.length;
  } catch (err) {
    if (requestId !== filterRequestId) return;
    currentResults = [];
    totalCount = 0;
    showToast(`تعذر تطبيق الفلتر: ${messageFromError(err)} ⚠️`);
  } finally {
    if (requestId === filterRequestId) {
      isLoading = false;
      renderResults();
    }
  }
}

/** Total quantity across every matched support record (e.g. 3 "لحوم" + 2 "كرتونة" -> 5) — the roster's "الكمية" column is one number, not per-type pills. */
function totalMatchedQuantity(matchedSupport) {
  if (!Array.isArray(matchedSupport) || matchedSupport.length === 0) return 0;
  return matchedSupport.reduce((sum, m) => sum + (m.totalCount ?? 0), 0);
}

function resultRowHtml(row, index) {
  return `
    <tr>
      <td style="text-align: center;">${index + 1}</td>
      <td>
        <div style="font-weight: 700;">${DOM.escapeHTML(row.beneficiaryFullName)}</div>
        <div style="font-size: 11px; color: var(--text-secondary); font-family: monospace;">${DOM.escapeHTML(row.nationalId)}</div>
      </td>
      <td>${DOM.escapeHTML(row.charityName)}</td>
      <td>${DOM.escapeHTML(row.centerName)} — ${DOM.escapeHTML(row.villageName)}</td>
      <td>${DOM.escapeHTML(row.statusLabel)}</td>
      <td style="text-align: center; font-weight: 800;">${totalMatchedQuantity(row.matchedSupport)}</td>
    </tr>
  `;
}

function renderResults() {
  const tbody = DOM.qs('#csf-results-body');
  const emptyState = DOM.qs('#csf-empty-state');
  const initialState = DOM.qs('#csf-initial-state');
  const countBadge = DOM.qs('#csf-results-count');
  const exportBtn = DOM.qs('#btn-csf-export-pdf');
  if (!tbody) return;

  if (countBadge) countBadge.textContent = `${totalCount} حالة`;

  if (!hasAppliedOnce) {
    tbody.innerHTML = '';
    if (initialState) initialState.style.display = '';
    if (emptyState) emptyState.style.display = 'none';
    if (exportBtn) exportBtn.disabled = true;
    return;
  }

  if (initialState) initialState.style.display = 'none';

  if (isLoading && currentResults.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 24px;">⏳ جاري التحميل...</td></tr>`;
    if (emptyState) emptyState.style.display = 'none';
    if (exportBtn) exportBtn.disabled = true;
    return;
  }

  if (currentResults.length === 0) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = '';
    if (exportBtn) exportBtn.disabled = true;
    return;
  }

  if (emptyState) emptyState.style.display = 'none';
  if (exportBtn) exportBtn.disabled = false;

  tbody.innerHTML = currentResults.map((row, i) => resultRowHtml(row, i)).join('');
}

/** A single shared value across all loaded results, or 'متعدد' when they differ (e.g. no charity filter applied). */
function commonLabelAcrossResults(field) {
  const values = new Set(currentResults.map(r => r[field]).filter(Boolean));
  if (values.size === 0) return '—';
  if (values.size === 1) return [...values][0];
  return 'متعدد';
}

async function handleExportPdf() {
  if (!currentResults.length) return;
  const exportBtn = DOM.qs('#btn-csf-export-pdf');
  if (exportBtn) exportBtn.disabled = true;

  try {
    // تحميل كسول: jsPDF + html2canvas تقيلين ومش لازمين إلا عند الضغط على تصدير.
    const { exportCaseListToPdf } = await import('../../services/case-pdf.service.js');
    await exportCaseListToPdf(currentResults, {
      charityLabel: appliedHeader.charityName || commonLabelAcrossResults('charityName'),
      centerLabel: appliedHeader.center || commonLabelAcrossResults('centerName'),
      villageLabel: appliedHeader.village || commonLabelAcrossResults('villageName'),
      supportTypes: selectedSupportTypes,
      total: totalCount
    });
    showToast('تم تصدير الكشف PDF بنجاح 📄');
  } catch (err) {
    showToast('تعذر إنشاء ملف الـ PDF. يرجى المحاولة مرة أخرى ⚠️');
  } finally {
    if (exportBtn) exportBtn.disabled = false;
  }
}
