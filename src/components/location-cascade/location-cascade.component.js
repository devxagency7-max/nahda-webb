import { DataService } from '../../services/data.js';
import { store } from '../../state/store.js';
import { DOM } from '../../utils/dom.js';
import { EventBus, EVENTS } from '../../core/event-bus.js';
import { CharitiesService } from '../../services/charities.service.js';
import { messageFromError } from '../../services/errors.js';
import { showToast } from '../../utils/toast.js';

export function initLocationCascade() {
  // -------------------------------------------------------------------------
  // Referral Card Dropdowns Cascade & Charities Synchronization
  // -------------------------------------------------------------------------
  initReferralCardCascade();
}

function initReferralCardCascade() {
  const refDistrict = DOM.qs('#referral-district-select');
  const refVillage = DOM.qs('#referral-village-select');
  const refCharity = DOM.qs('#referral-charity-select');

  if (!refDistrict || !refVillage || !refCharity) return;

  // Live roster fetched from the real API (WEB_API_DOCUMENTATION.md §22
  // "Charities") — same source as charities.component.js. store.charities is
  // dead state (nothing populates it anymore) and must not be used here.
  let allCharities = [];

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

  async function loadReferralCharities() {
    try {
      const result = await CharitiesService.list({ limit: 100 });
      const items = (result && result.items) || [];
      allCharities = items.map(item => ({
        id: item.id,
        name: item.name,
        centerId: item.centerId,
        villageId: item.villageId,
        center: findCenterNameById(item.centerId),
        village: findVillageNameById(findCenterNameById(item.centerId), item.villageId)
      }));
    } catch (err) {
      allCharities = [];
      showToast(`تعذر تحميل قائمة الجمعيات: ${messageFromError(err)}`);
    }
    updateReferralCharities(refDistrict.value, refVillage.value);
  }

  function updateReferralDistricts() {
    const centers = DataService.getCenters();
    const currentVal = refDistrict.value;

    refDistrict.innerHTML = '<option value="" disabled selected>-- اختر المركز --</option>' +
      centers.map(c => `<option value="${c}">${c}</option>`).join('');

    if (currentVal && centers.includes(currentVal)) {
      refDistrict.value = currentVal;
    }
  }

  function updateReferralVillages(center) {
    if (!center) {
      refVillage.innerHTML = '<option value="" disabled selected>-- اختر المركز أولاً --</option>';
      refVillage.disabled = true;
      return;
    }

    const villages = DataService.getVillagesByCenter(center);
    const currentVal = refVillage.value;

    refVillage.innerHTML = '<option value="" disabled selected>-- اختر القرية / المنطقة --</option>' +
      villages.map(v => `<option value="${v}">${v}</option>`).join('');
    refVillage.disabled = false;

    if (currentVal && villages.includes(currentVal)) {
      refVillage.value = currentVal;
    }
  }

  function updateReferralCharities(center = '', village = '') {
    const currentVal = refCharity.value;

    let matching = allCharities;
    if (center) {
      matching = matching.filter(c => c.center === center);
    }
    if (village) {
      const villageMatches = matching.filter(c => c.village === village);
      if (villageMatches.length > 0) {
        matching = villageMatches;
      }
    }

    if (allCharities.length === 0) {
      refCharity.innerHTML = '<option value="" selected disabled>لا توجد جمعيات مسجلة حالياً (يمكن الإضافة من إدارة الجمعيات)</option>' +
        '<option value="أخرى" data-is-other="true">أخرى</option>';
      return;
    }

    if (matching.length === 0) {
      refCharity.innerHTML = '<option value="" selected disabled>لا توجد جمعيات مسجلة لهذا المركز/القرية (عرض جميع الجمعيات بالأسفل)</option>' +
        allCharities.map(c => `<option value="${c.id}">${DOM.escapeHTML(c.name)} — مركز ${DOM.escapeHTML(c.center)} (${DOM.escapeHTML(c.village)})</option>`).join('') +
        '<option value="أخرى" data-is-other="true">أخرى</option>';
    } else {
      refCharity.innerHTML = '<option value="" selected disabled>-- اختر الجمعية --</option>' +
        matching.map(c => `<option value="${c.id}">${DOM.escapeHTML(c.name)} — مركز ${DOM.escapeHTML(c.center)} (${DOM.escapeHTML(c.village)})</option>`).join('') +
        '<option value="أخرى" data-is-other="true">أخرى</option>';
    }

    if (currentVal && [...refCharity.options].some(o => o.value === currentVal)) {
      refCharity.value = currentVal;
    }
  }

  refDistrict.addEventListener('change', () => {
    updateReferralVillages(refDistrict.value);
    updateReferralCharities(refDistrict.value, refVillage.value);
  });

  refVillage.addEventListener('change', () => {
    updateReferralCharities(refDistrict.value, refVillage.value);
  });

  EventBus.on(EVENTS.CHARITIES_UPDATED, () => {
    loadReferralCharities();
  });

  EventBus.on(EVENTS.LOCATIONS_UPDATED, () => {
    updateReferralDistricts();
    updateReferralVillages(refDistrict.value);
    // Center/village names for already-loaded charities depend on
    // store.locationIds, which LOCATIONS_UPDATED just (re)populated —
    // re-derive them, not just re-render with the stale names.
    loadReferralCharities();
  });

  // Initial population
  updateReferralDistricts();
  loadReferralCharities();
}
