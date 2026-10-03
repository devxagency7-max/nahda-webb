/* --------------------------------------------------------------------------
   CHARITIES MANAGEMENT COMPONENT CONTROLLER
   Real API-backed: list/create/update/delete all go through CharitiesService
   (WEB_API_DOCUMENTATION.md §22 "Charities"). Cascading center/village
   dropdowns are still sourced by NAME from store.beniSuefLocations (unchanged
   rendering/markup), but every write resolves the selected names to the real
   `centerId`/`villageId` GUIDs via store.locationIds before calling the API,
   and every update echoes the `rowVersion` the list last read.
   -------------------------------------------------------------------------- */
import { store } from '../../state/store.js';
import { DataService } from '../../services/data.js';
import { DOM } from '../../utils/dom.js';
import { showToast } from '../../utils/toast.js';
import { EventBus, EVENTS } from '../../core/event-bus.js';
import { CharitiesService } from '../../services/charities.service.js';
import { LocationsService } from '../../services/locations.service.js';
import { messageFromError } from '../../services/errors.js';
import { errorStateHTML, bindRetry } from '../../utils/error-state.js';
import { confirmDialog } from '../../utils/dialog.js';
import { onViewEnter } from '../../core/view-lifecycle.js';

/** Field-level validation details -> one readable Arabic line. */
function detailsToMessage(details) {
  if (!details || typeof details !== 'object') return '';
  const lines = [];
  Object.values(details).forEach(fieldErrors => {
    if (Array.isArray(fieldErrors)) lines.push(...fieldErrors);
  });
  return lines.join(' — ');
}

function reportError(err, fallbackPrefix = '') {
  const detail = err && err.details ? detailsToMessage(err.details) : '';
  const msg = messageFromError(err);
  showToast(`${fallbackPrefix}${detail || msg} ⚠️`);
}

export function initCharitiesManager() {
  // DOM Elements
  const form = DOM.qs('#charity-form');
  const editIdInput = DOM.qs('#charity-edit-id');
  const nameInput = DOM.qs('#charity-name-input');
  const centerSelect = DOM.qs('#charity-center-select');
  const centerOtherContainer = DOM.qs('#charity-center-other-container');
  const centerOtherInput = DOM.qs('#charity-center-other-input');
  const btnResetCenterSelect = DOM.qs('#btn-reset-center-select');

  const villageSelect = DOM.qs('#charity-village-select');
  const villageOtherContainer = DOM.qs('#charity-village-other-container');
  const villageOtherInput = DOM.qs('#charity-village-other-input');
  const btnResetVillageSelect = DOM.qs('#btn-reset-village-select');

  const addressInput = DOM.qs('#charity-address-input');
  const phoneInput = DOM.qs('#charity-phone-input');

  const formTitle = DOM.qs('#charity-form-title');
  const formBadge = DOM.qs('#charity-form-badge');
  const submitText = DOM.qs('#charity-submit-text');
  const btnCancelEdit = DOM.qs('#btn-cancel-edit-charity');

  const searchInput = DOM.qs('#charity-search-input');
  const centerPillsContainer = DOM.qs('#charity-center-pills');
  const tableBody = DOM.qs('#charities-table-body');
  const emptyState = DOM.qs('#charities-empty-state');
  const statTotal = DOM.qs('#stat-total-charities');
  const btnExport = DOM.qs('#btn-export-charities');

  // The whole roster is fetched (CharitiesService.listAll) but only the first
  // PAGE_SIZE rows are drawn; "تحميل المزيد" reveals another PAGE_SIZE locally.
  const PAGE_SIZE = 50;

  let activeCenterFilter = 'all';
  let searchQuery = '';

  // Live roster fetched from the server — replaces the old store.charities mock array.
  let charitiesList = [];
  let visibleCount = PAGE_SIZE;
  // Guards against an older, slower response overwriting a newer one (fetching
  // every page makes overlapping loads — fast typing, pill clicks — likelier).
  let loadSeq = 0;
  let isLoading = false;
  // آخر خطأ في تحميل القائمة — بيتعرض كحالة خطأ فيها "إعادة المحاولة" بدل "لا توجد جمعيات".
  let loadError = null;
  let submitBtn = null;

  // 1-3. Center/village pickers and the charities table load when the
  // screen is opened (the table re-fetches on every entry to pick up other
  // users' edits), not at boot behind another view.
  onViewEnter('charities', ({ firstEnter }) => {
    if (firstEnter) {
      ensureLocationsLoaded().then(() => {
        initCenterAndVillageOptions();
        initCenterFilterPills();
      });
    }
    loadCharities();
  });

  // 4. Form Submit Handler (Add / Edit)
  if (form) {
    form.addEventListener('submit', handleFormSubmit);
    submitBtn = form.querySelector('button[type="submit"]');
  }

  // 5. Cancel Edit Button
  if (btnCancelEdit) {
    btnCancelEdit.addEventListener('click', resetFormToAddMode);
  }

  // 6. Reset Buttons for In-Place Slot Swapping
  if (btnResetCenterSelect) {
    btnResetCenterSelect.addEventListener('click', () => {
      if (centerOtherContainer) centerOtherContainer.style.display = 'none';
      if (centerOtherInput) centerOtherInput.value = '';
      if (centerSelect) {
        centerSelect.style.display = 'block';
        centerSelect.value = '';
        centerSelect.focus();
      }
      populateVillages('');
    });
  }

  if (btnResetVillageSelect) {
    btnResetVillageSelect.addEventListener('click', () => {
      if (villageOtherContainer) villageOtherContainer.style.display = 'none';
      if (villageOtherInput) villageOtherInput.value = '';
      if (villageSelect) {
        villageSelect.style.display = 'block';
        villageSelect.value = '';
        villageSelect.focus();
      }
    });
  }

  // 7. Search Input Listener (server-side `search` param — debounced)
  let searchDebounce = null;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value.trim().toLowerCase();
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => loadCharities(), 350);
    });
  }

  // 8. Export CSV Handler — real server export (all active charities, unfiltered).
  if (btnExport) {
    btnExport.addEventListener('click', exportCharitiesToCSV);
  }

  // 9. Delegated Table Actions (Edit & Delete)
  if (tableBody) {
    tableBody.addEventListener('click', handleTableAction);
  }

  // 10. Listen to Reactive Store Updates via EventBus
  EventBus.on(EVENTS.LOCATIONS_UPDATED, () => {
    initCenterAndVillageOptions();
    initCenterFilterPills();
    renderCharities();
  });

  /* ------------------------------------------------------------------------
     HELPER FUNCTIONS
     ------------------------------------------------------------------------ */

  async function ensureLocationsLoaded() {
    const centerIds = store.locationIds && store.locationIds.centers;
    if (centerIds && Object.keys(centerIds).length > 0) return;
    try {
      const centers = await LocationsService.list();
      store.applyLocationsFromServer(centers);
    } catch (err) {
      // Non-fatal — the cascading pickers just stay empty until locations load elsewhere.
    }
  }

  function resolveCenterId(centerName) {
    return (store.locationIds.centers || {})[centerName] || null;
  }

  function resolveVillageId(centerName, villageName) {
    const villages = (store.locationIds.villages || {})[centerName] || {};
    return villages[villageName] || null;
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

  function initCenterAndVillageOptions() {
    if (!centerSelect || !villageSelect) return;

    const centers = DataService.getCenters();

    // Populate Centers Dropdown + أخرى
    centerSelect.innerHTML = '<option value="" selected disabled>-- اختر المركز --</option>' +
      centers.map(center => `<option value="${DOM.escapeHTML(center)}">${DOM.escapeHTML(center)}</option>`).join('') +
      '<option value="أخرى" data-is-other="true">أخرى</option>';

    // Handle Cascading Center Change
    centerSelect.addEventListener('change', () => {
      const selectedCenter = centerSelect.value;
      if (selectedCenter === 'أخرى') {
        centerSelect.style.display = 'none';
        if (centerOtherContainer) centerOtherContainer.style.display = 'block';
        if (centerOtherInput) centerOtherInput.focus();

        if (villageSelect) {
          villageSelect.style.display = 'block';
          villageSelect.innerHTML = '<option value="" selected disabled>-- اختر القرية / المنطقة --</option><option value="أخرى" data-is-other="true">أخرى</option>';
          villageSelect.disabled = false;
        }
        if (villageOtherContainer) villageOtherContainer.style.display = 'none';
      } else {
        centerSelect.style.display = 'block';
        if (centerOtherContainer) centerOtherContainer.style.display = 'none';
        if (centerOtherInput) centerOtherInput.value = '';

        populateVillages(selectedCenter);
      }
    });

    if (villageSelect) {
      villageSelect.addEventListener('change', () => {
        if (villageSelect.value === 'أخرى') {
          villageSelect.style.display = 'none';
          if (villageOtherContainer) villageOtherContainer.style.display = 'block';
          if (villageOtherInput) villageOtherInput.focus();
        } else {
          villageSelect.style.display = 'block';
          if (villageOtherContainer) villageOtherContainer.style.display = 'none';
          if (villageOtherInput) villageOtherInput.value = '';
        }
      });
    }
  }

  function populateVillages(center, selectedVillage = '') {
    if (!villageSelect) return;

    if (!center) {
      villageSelect.style.display = 'block';
      villageSelect.innerHTML = '<option value="" selected disabled>-- اختر المركز أولاً --</option>';
      villageSelect.disabled = true;
      if (villageOtherContainer) villageOtherContainer.style.display = 'none';
      if (villageOtherInput) villageOtherInput.value = '';
      return;
    }

    const villages = DataService.getVillagesByCenter(center);
    villageSelect.innerHTML = '<option value="" selected disabled>-- اختر القرية / المنطقة --</option>' +
      villages.map(v => `<option value="${DOM.escapeHTML(v)}" ${v === selectedVillage ? 'selected' : ''}>${DOM.escapeHTML(v)}</option>`).join('') +
      '<option value="أخرى" data-is-other="true">أخرى</option>';
    villageSelect.disabled = false;

    if (selectedVillage && !villages.includes(selectedVillage)) {
      villageSelect.style.display = 'none';
      villageSelect.value = 'أخرى';
      if (villageOtherContainer) villageOtherContainer.style.display = 'block';
      if (villageOtherInput) villageOtherInput.value = selectedVillage;
    } else {
      villageSelect.style.display = 'block';
      if (villageOtherContainer) villageOtherContainer.style.display = 'none';
      if (villageOtherInput) villageOtherInput.value = '';
    }
  }

  function initCenterFilterPills() {
    if (!centerPillsContainer) return;

    const centers = DataService.getCenters();
    const pillsHtml = [
      `<button type="button" class="charity-center-pill charity-center-pill--active" data-center-filter="all">الكل</button>`,
      ...centers.map(c => `<button type="button" class="charity-center-pill" data-center-filter="${DOM.escapeHTML(c)}">مركز ${DOM.escapeHTML(c)}</button>`)
    ].join('');

    centerPillsContainer.innerHTML = pillsHtml;

    centerPillsContainer.addEventListener('click', (e) => {
      const pill = e.target.closest('.charity-center-pill');
      if (pill) {
        centerPillsContainer.querySelectorAll('.charity-center-pill').forEach(p => p.classList.remove('charity-center-pill--active'));
        pill.classList.add('charity-center-pill--active');
        activeCenterFilter = pill.getAttribute('data-center-filter') || 'all';
        loadCharities();
      }
    });
  }

  /**
   * Loads every matching charity from the real API, applying the active center
   * filter + search. The visible window resets to the first PAGE_SIZE rows
   * unless `keepPaging` (reload after a save/delete, where the user is mid-list).
   */
  async function loadCharities({ keepPaging = false } = {}) {
    const seq = ++loadSeq;
    if (!keepPaging) visibleCount = PAGE_SIZE;
    isLoading = true;
    loadError = null;
    renderCharities();
    try {
      const centerId = activeCenterFilter !== 'all' ? resolveCenterId(activeCenterFilter) : undefined;
      const result = await CharitiesService.listAll({
        search: searchQuery || undefined,
        centerId: centerId || undefined
      });
      if (seq !== loadSeq) return;
      const items = (result && result.items) || [];
      charitiesList = items.map(item => ({
        id: item.id,
        name: item.name,
        governorate: item.governorate,
        centerId: item.centerId,
        villageId: item.villageId,
        center: findCenterNameById(item.centerId),
        village: findVillageNameById(findCenterNameById(item.centerId), item.villageId),
        phone: item.phone,
        address: item.address || '',
        dateAdded: item.dateAdded,
        rowVersion: item.rowVersion
      }));
    } catch (err) {
      if (seq !== loadSeq) return;
      charitiesList = [];
      loadError = err;
    } finally {
      if (seq === loadSeq) {
        isLoading = false;
        renderCharities();
      }
    }
  }

  function renderCharities() {
    if (statTotal) {
      statTotal.textContent = charitiesList.length;
    }

    if (!tableBody) return;

    if (isLoading) {
      tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 32px; color:#64748b;">⏳ جاري تحميل بيانات الجمعيات...</td></tr>`;
      if (emptyState) emptyState.style.display = 'none';
      return;
    }

    if (loadError) {
      tableBody.innerHTML = `<tr><td colspan="5">${errorStateHTML(loadError, 'الجمعيات', { compact: true })}</td></tr>`;
      bindRetry(tableBody, loadCharities);
      if (emptyState) emptyState.style.display = 'none';
      return;
    }

    // Client-side filter is only a fallback safety net now (search/centerId are
    // already applied server-side) — kept so typing feels instant between reloads.
    const filtered = charitiesList.filter(item => {
      if (searchQuery) {
        const matchName = (item.name || '').toLowerCase().includes(searchQuery);
        const matchCenter = (item.center || '').toLowerCase().includes(searchQuery);
        const matchVillage = (item.village || '').toLowerCase().includes(searchQuery);
        const matchAddress = (item.address || '').toLowerCase().includes(searchQuery);
        const matchPhone = (item.phone || '').toLowerCase().includes(searchQuery);
        return matchName || matchCenter || matchVillage || matchAddress || matchPhone;
      }
      return true;
    });

    if (filtered.length === 0) {
      tableBody.innerHTML = '';
      if (emptyState) emptyState.style.display = 'block';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    const visible = filtered.slice(0, visibleCount);
    const remaining = filtered.length - visible.length;

    const rowsHtml = visible.map((charity, index) => {
      return `
        <tr data-charity-id="${charity.id}">
          <td style="text-align: center;">
            <span class="charity-code-tag">${index + 1}</span>
          </td>
          <td>
            <div class="charity-name-cell">
              <div class="charity-avatar-icon">🏢</div>
              <div>
                <strong class="charity-table-title">${DOM.escapeHTML(charity.name)}</strong>
              </div>
            </div>
          </td>
          <td>
            <div class="charity-location-badge">
              <span class="center-name">مركز ${DOM.escapeHTML(charity.center)}</span>
              <span class="village-name">قرية ${DOM.escapeHTML(charity.village)}</span>
            </div>
          </td>
          <td>
            <div class="charity-contact-cell">
              ${charity.phone ? `<span class="charity-phone">📞 ${DOM.escapeHTML(charity.phone)}</span>` : '<span class="charity-subinfo">لا يوجد هاتف</span>'}
              ${charity.address ? `<span class="charity-address" title="${DOM.escapeHTML(charity.address)}">📍 ${DOM.escapeHTML(charity.address)}</span>` : ''}
            </div>
          </td>
          <td>
            <div class="charity-actions-cell">
              <button type="button" class="btn-action-icon btn-action-edit" data-action="edit" data-id="${DOM.escapeHTML(charity.id)}" title="تعديل الجمعية" aria-label="تعديل ${DOM.escapeHTML(charity.name)}">✏️</button>
              <button type="button" class="btn-action-icon btn-action-delete" data-action="delete" data-id="${DOM.escapeHTML(charity.id)}" title="حذف الجمعية" aria-label="حذف ${DOM.escapeHTML(charity.name)}">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    const loadMoreHtml = remaining > 0 ? `
      <tr class="charities-load-more-row">
        <td colspan="5" style="text-align: center; padding: 20px;">
          <button type="button" class="btn btn--secondary btn-load-more-charities" style="font-weight: 800;">
            تحميل المزيد (عرض ${visible.length} من ${filtered.length}) ⬇️
          </button>
        </td>
      </tr>
    ` : '';

    tableBody.innerHTML = rowsHtml + loadMoreHtml;
  }

  async function handleFormSubmit(e) {
    e.preventDefault();

    const name = nameInput ? nameInput.value.trim() : '';
    let center = centerSelect ? centerSelect.value : '';
    let village = villageSelect ? villageSelect.value : '';

    if (!name) {
      showToast('الرجاء إدخال اسم الجمعية ⚠️');
      if (nameInput) nameInput.focus();
      return;
    }

    if (!center) {
      showToast('الرجاء اختيار المركز التابع للجمعية 🏛️');
      if (centerSelect) centerSelect.focus();
      return;
    }

    if (center === 'أخرى') {
      center = centerOtherInput ? centerOtherInput.value.trim() : '';
      if (!center) {
        showToast('الرجاء كتابة اسم المركز ✍️');
        if (centerOtherInput) centerOtherInput.focus();
        return;
      }
    }

    if (!village) {
      showToast('الرجاء اختيار القرية أو المنطقة 📍');
      if (villageSelect) villageSelect.focus();
      return;
    }

    if (village === 'أخرى') {
      village = villageOtherInput ? villageOtherInput.value.trim() : '';
      if (!village) {
        showToast('الرجاء كتابة اسم القرية أو المنطقة ✍️');
        if (villageOtherInput) villageOtherInput.focus();
        return;
      }
    }

    const centerId = resolveCenterId(center);
    const villageId = resolveVillageId(center, village);

    if (!centerId || !villageId) {
      showToast('المركز أو القرية المحددة غير معروفة للسيرفر — الرجاء اختيار قيمة من القائمة الرسمية بدل "أخرى" ⚠️');
      return;
    }

    const editId = editIdInput ? editIdInput.value.trim() : '';
    const address = addressInput ? addressInput.value.trim() : '';
    const phone = phoneInput ? phoneInput.value.trim() : '';

    const charityData = {
      name,
      centerId,
      villageId,
      address: address || null,
      phone: phone || null
    };

    if (submitBtn) submitBtn.disabled = true;
    try {
      if (editId) {
        const existing = charitiesList.find(c => c.id === editId);
        await CharitiesService.update(editId, {
          ...charityData,
          rowVersion: existing ? existing.rowVersion : undefined
        });
        showToast(`تم تحديث بيانات "${name}" بنجاح ✨`);
      } else {
        await CharitiesService.create(charityData);
        showToast(`تمت إضافة جمعية "${name}" بنجاح 🏢`);
      }
      resetFormToAddMode();
      await loadCharities({ keepPaging: true });
    } catch (err) {
      reportError(err, editId ? 'تعذر تحديث بيانات الجمعية: ' : 'تعذر إضافة الجمعية: ');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  async function handleTableAction(e) {
    if (e.target.closest('.btn-load-more-charities')) {
      visibleCount += PAGE_SIZE;
      renderCharities();
      return;
    }

    const btn = e.target.closest('.btn-action-icon');
    if (!btn) return;

    const action = btn.getAttribute('data-action');
    const id = btn.getAttribute('data-id');
    const charity = charitiesList.find(c => c.id === id);

    if (!charity) return;

    if (action === 'edit') {
      startEditCharity(charity);
    } else if (action === 'delete') {
      const confirmed = await confirmDialog({
        title: 'حذف جمعية',
        message: `هل أنت متأكد من حذف "${charity.name}" من سجل الجمعيات؟`,
        confirmLabel: 'حذف',
        danger: true
      });
      if (confirmed) deleteCharity(charity);
    }
  }

  async function deleteCharity(charity) {
    try {
      await CharitiesService.remove(charity.id);
      if (editIdInput && editIdInput.value === charity.id) {
        resetFormToAddMode();
      }
      showToast(`تم حذف "${charity.name}" من السجل 🗑️`);
      await loadCharities({ keepPaging: true });
    } catch (err) {
      reportError(err, 'تعذر حذف الجمعية: ');
    }
  }

  function startEditCharity(charity) {
    if (editIdInput) editIdInput.value = charity.id;
    if (nameInput) nameInput.value = charity.name || '';
    if (addressInput) addressInput.value = charity.address || '';
    if (phoneInput) phoneInput.value = charity.phone || '';

    const knownCenters = DataService.getCenters();
    if (centerSelect) {
      if (knownCenters.includes(charity.center)) {
        centerSelect.style.display = 'block';
        centerSelect.value = charity.center;
        if (centerOtherContainer) centerOtherContainer.style.display = 'none';
        if (centerOtherInput) centerOtherInput.value = '';
      } else {
        centerSelect.style.display = 'none';
        centerSelect.value = 'أخرى';
        if (centerOtherContainer) centerOtherContainer.style.display = 'block';
        if (centerOtherInput) centerOtherInput.value = charity.center || '';
      }
      populateVillages(charity.center, charity.village);
    }

    if (formTitle) formTitle.textContent = 'تعديل بيانات الجمعية';
    if (formBadge) {
      formBadge.textContent = 'وضع التعديل';
      formBadge.className = 'badge badge--warning';
    }
    if (submitText) submitText.textContent = 'حفظ التعديلات';
    if (btnCancelEdit) btnCancelEdit.style.display = 'inline-flex';

    if (form) {
      form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      if (nameInput) nameInput.focus();
    }
  }

  function resetFormToAddMode() {
    if (form) form.reset();
    if (editIdInput) editIdInput.value = '';
    if (centerSelect) centerSelect.style.display = 'block';
    if (centerOtherContainer) centerOtherContainer.style.display = 'none';
    if (centerOtherInput) centerOtherInput.value = '';
    if (villageSelect) {
      villageSelect.style.display = 'block';
      villageSelect.innerHTML = '<option value="" selected disabled>-- اختر المركز أولاً --</option>';
      villageSelect.disabled = true;
    }
    if (villageOtherContainer) villageOtherContainer.style.display = 'none';
    if (villageOtherInput) villageOtherInput.value = '';

    if (formTitle) formTitle.textContent = 'إضافة جمعية جديدة';
    if (formBadge) {
      formBadge.textContent = 'تسجيل جديد';
      formBadge.className = 'badge badge--primary';
    }
    if (submitText) submitText.textContent = 'إضافة الجمعية';
    if (btnCancelEdit) btnCancelEdit.style.display = 'none';
  }

  /** Real server export — always ALL active charities, unfiltered (no search/centerId scoping on this route). */
  async function exportCharitiesToCSV() {
    if (btnExport) btnExport.disabled = true;
    try {
      const csvContent = await CharitiesService.exportCsv();
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `charities_beni_suef_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showToast('تم تصدير ملف الجمعيات بنجاح 📥');
    } catch (err) {
      reportError(err, 'تعذر تصدير الجمعيات: ');
    } finally {
      if (btnExport) btnExport.disabled = false;
    }
  }
}
