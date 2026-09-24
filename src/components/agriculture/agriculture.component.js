/* --------------------------------------------------------------------------
   AGRICULTURAL HOLDING & LIVESTOCK COMPONENT (STAGE 5: الحيازة والأصول الزراعية)
   Mirrors the mobile app's AgriculturalHoldingTab: two explicit yes/no radio
   questions (land / livestock) that reveal their own sub-fields, and a
   conditional rent-vs-annual-income field depending on land tenure type.

   Responsibilities:
   - قراءة/كتابة بيانات المرحلة في الـ store (حفظ واستعادة بعد الـ refresh)
   - مسح الحقول المخفية فعليًا علشان ما يبقاش فيه "بيانات شبح"
   - تطبيع الأرقام العربية ومنع القيم السالبة
   - التحقق من اكتمال المرحلة قبل السماح بالانتقال منها
   -------------------------------------------------------------------------- */
import { triggerWorkflowRecalc } from '../../core/state.js';
import { store } from '../../state/store.js';
import { DOM } from '../../utils/dom.js';
import { normalizeDecimalNumerals } from '../../utils/nationalId.js';

const OTHER_OPTION = 'أخرى';
const NUMERIC_FIELD_IDS = ['agri-area', 'agri-rent-amount', 'agri-annual-income'];

/* ---------- Helpers مشتركة بين القراءة والتحقق ---------- */

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
  return DOM.qs('#step-pane-5 .chip-field[data-field="livestock"]');
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

/**
 * تحقق اكتمال المرحلة الخامسة. بيرجع قائمة المشاكل مع العنصر المسؤول عن كل
 * واحدة علشان نقدر نبرزها بصريًا وننقل التركيز لأول حقل ناقص.
 */
export function validateAgriculture() {
  const issues = [];
  const data = readAgricultureData();

  if (data.hasLand === '') {
    issues.push({ el: DOM.qs('#agri-land-yesno'), group: true, message: 'من فضلك جاوب على سؤال الأرض الزراعية (نعم / لا).' });
  } else if (data.hasLand === 'yes') {
    if (data.landType === '') {
      issues.push({ el: DOM.qs('#agri-land-type'), message: 'اختر طبيعة حيازة الأرض (تمليك / إيجار).' });
    }
    if (data.area === '') {
      issues.push({ el: DOM.qs('#agri-area'), message: 'أدخل مساحة الأرض بالفدان.' });
    } else if (parseFloat(data.area) < 0) {
      issues.push({ el: DOM.qs('#agri-area'), message: 'مساحة الأرض لا يمكن أن تكون قيمة سالبة.' });
    }
    if (data.landType === 'إيجار' && data.rentAmount !== '' && parseFloat(data.rentAmount) < 0) {
      issues.push({ el: DOM.qs('#agri-rent-amount'), message: 'قيمة الإيجار لا يمكن أن تكون سالبة.' });
    }
    if (data.landType === 'تمليك' && data.annualIncome !== '' && parseFloat(data.annualIncome) < 0) {
      issues.push({ el: DOM.qs('#agri-annual-income'), message: 'الدخل السنوي لا يمكن أن يكون قيمة سالبة.' });
    }
  }

  if (data.hasLivestock === '') {
    issues.push({ el: DOM.qs('#agri-livestock-yesno'), group: true, message: 'من فضلك جاوب على سؤال المواشي (نعم / لا).' });
  } else if (data.hasLivestock === 'yes') {
    if (data.livestockTypes.length === 0) {
      issues.push({ el: livestockChipField(), chip: true, message: 'اختر نوعًا واحدًا على الأقل من المواشي.' });
    } else if (data.livestockTypes.includes(OTHER_OPTION) && data.livestockOther === '') {
      issues.push({ el: livestockChipField(), chip: true, message: 'اكتب تفاصيل خيار "أخرى" في المواشي.' });
    }
  }

  return issues;
}

/** نسبة إكمال المرحلة — مصدر واحد للحقيقة يستخدمه شريط التقدّم. */
export function agricultureProgress() {
  // مرحلة لسه محدش فتحها = 0% مهما كانت حالة الحقول الافتراضية.
  if (!store.isStageVisited(5)) return 0;

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

/* ---------- إبراز/مسح حالات الخطأ ---------- */

export function clearAgricultureErrors() {
  DOM.qsa('#step-pane-5 .field-invalid').forEach(el => el.classList.remove('field-invalid'));
  DOM.qsa('#step-pane-5 .agri-yesno--invalid').forEach(el => el.classList.remove('agri-yesno--invalid'));
  DOM.qsa('#step-pane-5 .chip-field--invalid').forEach(el => el.classList.remove('chip-field--invalid'));
}

export function highlightAgricultureIssues(issues) {
  clearAgricultureErrors();
  issues.forEach(issue => {
    if (!issue.el) return;
    if (issue.group) issue.el.classList.add('agri-yesno--invalid');
    else if (issue.chip) issue.el.classList.add('chip-field--invalid');
    else issue.el.classList.add('field-invalid');
  });

  const first = issues.find(i => i.el);
  if (first && first.el) {
    const focusTarget = first.group
      ? first.el.querySelector('input[type="radio"]')
      : (first.chip ? first.el.querySelector('.chip-btn') : first.el);
    if (focusTarget && typeof focusTarget.focus === 'function') {
      focusTarget.focus({ preventScroll: true });
    }
    first.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
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
    // الحقل المخفي بيتمسح فعليًا — مايفضلش محتفظ بقيمة قديمة تتحسب في المرحلة 6.
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
      clearAgricultureErrors();
      persist();
      triggerWorkflowRecalc();
    });
  });

  livestockRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      syncLivestockVisibility();
      clearAgricultureErrors();
      persist();
      triggerWorkflowRecalc();
    });
  });

  if (landTypeSelect) {
    landTypeSelect.addEventListener('change', () => {
      syncLandTypeFields();
      clearAgricultureErrors();
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
        clearAgricultureErrors();
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
  // إبلاغ المرحلة 6 وشريط التقدّم بالقيم المستعادة.
  triggerWorkflowRecalc();
}
