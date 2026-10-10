/* --------------------------------------------------------------------------
   AGRICULTURAL HOLDING & LIVESTOCK COMPONENT (STAGE 4: الحيازة والأصول الزراعية)
   Mirrors the mobile app's AgriculturalHoldingTab: two explicit yes/no radio
   questions (land / livestock) that reveal their own sub-fields, and a
   conditional rent-vs-annual-income field depending on land tenure type.

   Responsibilities:
   - قراءة/كتابة بيانات المرحلة في الـ store (حفظ واستعادة بعد الـ refresh)
   - مسح الحقول المخفية فعليًا علشان ما يبقاش فيه "بيانات شبح"
   - تطبيع الأرقام العربية ومنع القيم السالبة
   -------------------------------------------------------------------------- */
import { triggerWorkflowRecalc } from '../../core/state.js';
import { store } from '../../state/store.js';
import { DOM } from '../../utils/dom.js';
import { normalizeDecimalNumerals } from '../../utils/nationalId.js';

const OTHER_OPTION = 'أخرى';
const NUMERIC_FIELD_IDS = ['agri-area', 'agri-rent-amount', 'agri-annual-income'];

// initAgricultureManager() بيتنادى مرة واحدة بس عند فتح التطبيق، وrestore()
// جوه الـ closure بتاعته بتقرا store.agriculture مرة واحدة بس وقت الفتح ده —
// لو حد عدّل store.agriculture بعد كده (زي فتح حالة موجودة للتعديل)، مفيش
// طريقة تخلي الفورم يعرض القيم الجديدة غير عن طريق callback بيتسجّل هنا.
let _restoreCallback = null;

/** يعيد ملى فورم الزراعة من store.agriculture الحالي — بيتنادى بعد تحميل حالة للتعديل. */
export function restoreAgricultureManager() {
  if (_restoreCallback) _restoreCallback();
}

/* ---------- Helpers القراءة ---------- */

function landAnswer() {
  const yes = DOM.qs('#agri-has-land-yes');
  const no = DOM.qs('#agri-has-land-no');
  if (yes && yes.checked) return 'yes';
  if (no && no.checked) return 'no';
  return '';
}

function livestockAnswer() {
  const yes = DOM.qs('#agri-has-livestock-yes');
  const no = DOM.qs('#agri-has-livestock-no');
  if (yes && yes.checked) return 'yes';
  if (no && no.checked) return 'no';
  return '';
}

function livestockChipField() {
  return DOM.qs('#step-pane-4 .chip-field[data-field="livestock"]');
}

function readLivestockChips() {
  const field = livestockChipField();
  if (!field) return { selected: [], otherText: '' };
  const selected = DOM.qsa('.chip-btn.chip-btn--active', field).map(c => c.dataset.value);
  const otherInput = field.querySelector('.chip-field__other');
  return { selected, otherText: otherInput ? otherInput.value.trim() : '' };
}

function val(id) {
  const el = DOM.qs(`#${id}`);
  return el ? el.value.trim() : '';
}

/**
 * يقرأ كل بيانات المرحلة الخامسة من الـ DOM كأوبچكت واحد قابل للحفظ.
 * الحقول التابعة لإجابة "لا" بترجع فاضية دايمًا — مفيش بيانات شبح.
 */
export function readAgricultureData() {
  const hasLand = landAnswer();
  const hasLivestock = livestockAnswer();
  const landType = hasLand === 'yes' ? val('agri-land-type') : '';
  const chips = hasLivestock === 'yes' ? readLivestockChips() : { selected: [], otherText: '' };

  return {
    hasLand,
    landType,
    area: hasLand === 'yes' ? val('agri-area') : '',
    rentAmount: hasLand === 'yes' && landType === 'إيجار' ? val('agri-rent-amount') : '',
    annualIncome: hasLand === 'yes' && landType === 'تمليك' ? val('agri-annual-income') : '',
    hasLivestock,
    livestockTypes: chips.selected,
    livestockOther: chips.otherText,
    livestockDetails: hasLivestock === 'yes' ? val('agri-livestock-details') : '',
    notes: val('agri-notes')
  };
}

/** نسبة إكمال المرحلة — مصدر واحد للحقيقة يستخدمه شريط التقدّم. */
export function agricultureProgress() {
  // مرحلة لسه محدش فتحها = 0% مهما كانت حالة الحقول الافتراضية.
  if (!store.isStageVisited(4)) return 0;

  const data = readAgricultureData();
  let done = 0;

  if (data.hasLand === 'no') {
    done += 1;
  } else if (data.hasLand === 'yes' && data.landType !== '' && data.area !== '' && parseFloat(data.area) >= 0) {
    done += 1;
  }

  if (data.hasLivestock === 'no') {
    done += 1;
  } else if (data.hasLivestock === 'yes' && data.livestockTypes.length > 0) {
    const otherOk = !data.livestockTypes.includes(OTHER_OPTION) || data.livestockOther !== '';
    if (otherOk) done += 1;
  }

  return Math.round((done / 2) * 100);
}

/* ---------- التهيئة ---------- */

export function initAgricultureManager() {
  const landFields = DOM.qs('#agri-land-fields');
  const landTypeSelect = DOM.qs('#agri-land-type');
  const rentGroup = DOM.qs('#agri-rent-group');
  const incomeGroup = DOM.qs('#agri-income-group');
  const livestockFields = DOM.qs('#agri-livestock-fields');
  const landRadios = DOM.qsa('input[name="agri-has-land"]');
  const livestockRadios = DOM.qsa('input[name="agri-has-livestock"]');

  if (!landFields && !livestockFields) return;

  let restoring = false;

  function persist() {
    if (restoring) return;
    store.setAgriculture(readAgricultureData());
  }

  function clearFieldValues(ids) {
    ids.forEach(id => {
      const el = DOM.qs(`#${id}`);
      if (el) el.value = '';
    });
  }

  /** مسح كل اختيارات وشيبس المواشي فعليًا عند الإجابة بـ "لا". */
  function clearLivestockSelections() {
    const field = livestockChipField();
    if (!field) return;
    DOM.qsa('.chip-btn', field).forEach(c => c.classList.remove('chip-btn--active'));
    const otherInput = field.querySelector('.chip-field__other');
    if (otherInput) {
      otherInput.value = '';
      otherInput.style.display = 'none';
    }
    const countEl = field.querySelector('.chip-field__count');
    if (countEl) {
      countEl.textContent = '0 اختيار';
      countEl.classList.remove('chip-field__count--active');
    }
  }

  function syncLandTypeFields() {
    const type = landTypeSelect ? landTypeSelect.value : '';
    const isRent = type === 'إيجار';
    const isOwned = type === 'تمليك';
    if (rentGroup) rentGroup.style.display = isRent ? 'block' : 'none';
    if (incomeGroup) incomeGroup.style.display = isOwned ? 'block' : 'none';
    // الحقل المخفي بيتمسح فعليًا — مايفضلش محتفظ بقيمة قديمة تتحسب في المرحلة 5.
    if (!isRent) clearFieldValues(['agri-rent-amount']);
    if (!isOwned) clearFieldValues(['agri-annual-income']);
  }

  function syncLandVisibility() {
    const answer = landAnswer();
    const show = answer === 'yes';
    if (landFields) landFields.style.display = show ? 'flex' : 'none';
    if (!show) {
      if (landTypeSelect) landTypeSelect.value = '';
      clearFieldValues(NUMERIC_FIELD_IDS);
    }
    syncLandTypeFields();
  }

  function syncLivestockVisibility() {
    const answer = livestockAnswer();
    const show = answer === 'yes';
    if (livestockFields) livestockFields.style.display = show ? 'block' : 'none';
    if (!show) {
      clearLivestockSelections();
      clearFieldValues(['agri-livestock-details']);
    }
  }

  /* --- المستمعات --- */

  landRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      syncLandVisibility();
      persist();
      triggerWorkflowRecalc();
    });
  });

  livestockRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      syncLivestockVisibility();
      persist();
      triggerWorkflowRecalc();
    });
  });

  if (landTypeSelect) {
    landTypeSelect.addEventListener('change', () => {
      syncLandTypeFields();
      persist();
      triggerWorkflowRecalc();
    });
  }

  // تطبيع الأرقام العربية ومنع السالب في الحقول الرقمية.
  NUMERIC_FIELD_IDS.forEach(id => {
    const el = DOM.qs(`#${id}`);
    if (!el) return;
    el.addEventListener('input', () => {
      const normalized = normalizeDecimalNumerals(el.value);
      if (normalized !== el.value) el.value = normalized;
      persist();
    });
    el.addEventListener('blur', () => {
      if (el.value !== '' && parseFloat(el.value) < 0) {
        el.value = '';
        triggerWorkflowRecalc();
      }
      persist();
    });
  });

  // الحقول النصية (التفاصيل + الملاحظات) — الملاحظات كانت مهملة تمامًا قبل كده.
  ['agri-livestock-details', 'agri-notes'].forEach(id => {
    const el = DOM.qs(`#${id}`);
    if (el) el.addEventListener('input', persist);
  });

  // شيبس المواشي بتتغيّر من مكوّن الـ chip-field، فبنسمع للـ recalc العام.
  const chipField = livestockChipField();
  if (chipField) {
    chipField.addEventListener('click', (e) => {
      if (e.target.closest('.chip-btn')) {
        // التأجيل لبعد ما مكوّن الـ chip-field يبدّل الكلاس.
        setTimeout(persist, 0);
      }
    });
    const otherInput = chipField.querySelector('.chip-field__other');
    if (otherInput) otherInput.addEventListener('input', persist);
  }

  /* --- الاستعادة بعد الـ refresh --- */

  function restore() {
    const saved = store.agriculture;
    if (!saved) {
      syncLandVisibility();
      syncLivestockVisibility();
      return;
    }

    restoring = true;

    const landRadio = saved.hasLand === 'yes' ? DOM.qs('#agri-has-land-yes')
      : saved.hasLand === 'no' ? DOM.qs('#agri-has-land-no') : null;
    if (landRadio) landRadio.checked = true;

    const livestockRadio = saved.hasLivestock === 'yes' ? DOM.qs('#agri-has-livestock-yes')
      : saved.hasLivestock === 'no' ? DOM.qs('#agri-has-livestock-no') : null;
    if (livestockRadio) livestockRadio.checked = true;

    if (landTypeSelect && saved.landType) landTypeSelect.value = saved.landType;

    const setVal = (id, value) => {
      const el = DOM.qs(`#${id}`);
      if (el && value != null) el.value = value;
    };
    setVal('agri-area', saved.area);
    setVal('agri-rent-amount', saved.rentAmount);
    setVal('agri-annual-income', saved.annualIncome);
    setVal('agri-livestock-details', saved.livestockDetails);
    setVal('agri-notes', saved.notes);

    // استعادة الشيبس المختارة + نص "أخرى".
    const field = livestockChipField();
    if (field && Array.isArray(saved.livestockTypes)) {
      DOM.qsa('.chip-btn', field).forEach(chip => {
        chip.classList.toggle('chip-btn--active', saved.livestockTypes.includes(chip.dataset.value));
      });
      const otherInput = field.querySelector('.chip-field__other');
      const otherActive = saved.livestockTypes.includes(OTHER_OPTION);
      if (otherInput) {
        otherInput.style.display = otherActive ? 'block' : 'none';
        otherInput.value = otherActive ? (saved.livestockOther || '') : '';
      }
      const countEl = field.querySelector('.chip-field__count');
      if (countEl) {
        const count = saved.livestockTypes.length;
        countEl.textContent = `${count} اختيار`;
        countEl.classList.toggle('chip-field__count--active', count > 0);
      }
    }

    syncLandVisibility();
    syncLivestockVisibility();

    restoring = false;
  }

  restore();
  // إبلاغ المرحلة 5 وشريط التقدّم بالقيم المستعادة.
  triggerWorkflowRecalc();

  _restoreCallback = () => {
    restore();
    triggerWorkflowRecalc();
  };
}
