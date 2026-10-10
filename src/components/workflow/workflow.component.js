/* --------------------------------------------------------------------------
   DEVX CASE JOURNEY TIMELINE ENGINE CONTROLLER
   Unified dynamic SVG continuous snake journey for 7 stations (3 + 4).
   Features:
   - Dynamic station centers measurement relative to SVG coordinate space
   - Continuous G1-smooth 180° Cubic Bezier U-Turns
   - Individual station circular progress rings
   - Physical segment-based continuous overall progress path
   - Live National ID auto-extraction and calculation engine
   - Responsive ResizeObserver & vertical mobile layout (<768px)
   - Accessible keyboard & click step pane navigation
   -------------------------------------------------------------------------- */
import { showToast } from '../../utils/toast.js';
import { onWorkflowRecalc } from '../../core/state.js';
import { switchView } from '../../core/router.js';
import { store } from '../../state/store.js';
import { isRole, ROLES } from '../../core/permissions.js';
import { StorageService, STORAGE_KEYS } from '../../services/storage.js';
import { DOM } from '../../utils/dom.js';
import { parseEgyptianNationalId, normalizeNumerals } from '../../utils/nationalId.js';
import {
  readAgricultureData,
  agricultureProgress
} from '../agriculture/agriculture.component.js';
import {
  STEP_SAVE_HANDLERS,
  saveStep4,
  wireAttachmentUpload,
  validateStep1,
  clearStep1Errors,
  highlightStep1Issues,
  validateStep5,
  registerWizardControls
} from '../personal-data/personal-data.api.js';
import { messageFromError } from '../../services/errors.js';
import { LocationsService } from '../../services/locations.service.js';
import { CasesService } from '../../services/cases.service.js';
import { EmployeesService } from '../../services/employees.service.js';
import { resetFamilyMembersManager } from '../family-members/family-members.component.js';
import { resetSupportManager } from '../support/support.component.js';
import { resetFinancialManager } from '../financial-ledger/financial-ledger.component.js';

export const STAGES_METADATA = [
  { id: 'stage-01', step: 1, row: 1, title: '1. الأساسية والأفراد', target: 'step-pane-1', route: 'personal-data' },
  { id: 'stage-02', step: 2, row: 1, title: '2. المرفقات والوثائق', target: 'step-pane-2', route: 'personal-data' },
  // المرافق والأجهزة اتدمجت في مرحلة السكن (مفيش مرحلة مرافق منفصلة).
  { id: 'stage-03', step: 3, row: 1, title: '3. بيانات السكن', target: 'step-pane-3', route: 'personal-data' },
  { id: 'stage-04', step: 4, row: 2, title: '4. الحيازة الزراعية', target: 'step-pane-4', route: 'personal-data' },
  { id: 'stage-05', step: 5, row: 2, title: '5. الدخل والمصروفات', target: 'step-pane-5', route: 'personal-data' },
  { id: 'stage-06', step: 6, row: 2, title: '6. الدعم والقرار', target: 'step-pane-6', route: 'personal-data' },
  { id: 'stage-07', step: 7, row: 2, title: '7. الرأي', target: 'step-pane-7', route: 'personal-data' },
];

const TOTAL_STEPS = STAGES_METADATA.length;
const RING_CIRCUMFERENCE = 144.51; // 2 * Math.PI * 23
let currentPercentages = [0, 0, 0, 0, 0, 0, 0];

// POST /cases/{id}/assign (زرار "إرسال لأخصائي") مسموح بس من الحالتين دول
// عند السيرفر — أي حالة تانية بترجع 422 INVALID_STATUS_TRANSITION. بنطابق
// نفس الشرط هنا عشان نمنع الضغطة من الأساس بدل ما نسيب المستخدم يتفاجئ
// برسالة خطأ بعد المحاولة (راجع WEB_API_DOCUMENTATION.md §"POST .../assign").
const ASSIGNABLE_STATUSES = new Set(['draft', 'pending_assignment']);

// قرار منتج: زرار "إرسال لأخصائي" لمدخل البيانات بس — المراجع والمدير مايشوفوهوش.
function canAssignSpecialist() {
  return !isRole(ROLES.REVIEWER) && !isRole(ROLES.MANAGER);
}

const CASE_STATUS_LABEL = {
  draft: 'مسودة', pending_assignment: 'بانتظار الإسناد', assigned: 'مسندة لأخصائي',
  accepted: 'مقبولة من الأخصائي', in_research: 'قيد البحث الميداني',
  pending_review: 'بانتظار المراجعة', returned_to_worker: 'أعيدت للأخصائي',
  pending_approval: 'بانتظار الاعتماد', approved: 'معتمدة', rejected: 'مرفوضة'
};

/**
 * بتفعّل/تعطّل زرار "إرسال لأخصائي" حسب حالة الملف المخزنة محليًا في
 * store.currentCase.status. الملف اللي لسه ماتسجلش على السيرفر (status
 * غير موجودة) بيتعامل معاه كأنه قابل للإرسال — أول ضغطة هتتكفل بحفظه.
 * @returns {boolean} true لو الزرار اتفعّل (الحالة قابلة للإرسال دلوقتي).
 */
function syncAssignButtonEligibility(btn) {
  if (!btn) return true;
  const caseStatus = store.currentCase?.status;
  const isAssignable = !caseStatus || ASSIGNABLE_STATUSES.has(caseStatus);
  btn.disabled = !isAssignable;
  btn.classList.toggle('step-float-btn--disabled', !isAssignable);
  btn.title = isAssignable
    ? 'إرسال وتكليف الحالة لأخصائي اجتماعي'
    : `الحالة اتبعتت بالفعل (${CASE_STATUS_LABEL[caseStatus] || caseStatus}) — لا يمكن إعادة إرسالها من هنا`;
  return isAssignable;
}
let currentActiveStep = 1;
let journeyResizeObserver = null;

export function initWorkflowTabs() {
  const toggleBtn = DOM.qs('#workflow-toggle-btn');
  const toggleText = DOM.qs('#workflow-toggle-text');
  const roadWrapper = DOM.qs('#workflow-road-wrapper');
  const workflowCard = DOM.qs('#workflow-nav-card');
  const stepNodes = DOM.qsa('.workflow-tab');

  // National ID Auto Extraction Controls
  const nationalIdInput = DOM.qs('#national-id');
  const ageInput = DOM.qs('#current-age');
  const genderSelect = DOM.qs('#gender');
  const errorMsgEl = DOM.qs('#national-id-error');
  const duplicateMsgEl = DOM.qs('#national-id-duplicate');
  const checkingMsgEl = DOM.qs('#national-id-checking');
  const availableMsgEl = DOM.qs('#national-id-available');

  // بعد ما يتأكد الرقم القومي محليًا (checksum) بنسأل السيرفر لو مسجّل
  // بالفعل لحالة تانية — عشان الأخصائي يعرف من هنا بدل ما يكتشف بعد ما
  // يكمّل الفورم كله ويضغط "التالي" فيرجّعله السيرفر DUPLICATE_NATIONAL_ID.
  // debounce بسيط (350ms، زي باقي حقول البحث في المشروع) عشان مانبعتش طلب
  // مع كل حرف وقت ما لسه بيكتب/يمسح.
  let duplicateCheckDebounce = null;
  let duplicateCheckToken = 0;

  function hideDuplicateStatus() {
    if (duplicateMsgEl) duplicateMsgEl.style.display = 'none';
    if (checkingMsgEl) checkingMsgEl.style.display = 'none';
    if (availableMsgEl) availableMsgEl.style.display = 'none';
  }

  function checkDuplicateNationalId(nationalIdValue) {
    clearTimeout(duplicateCheckDebounce);
    const myToken = ++duplicateCheckToken;

    duplicateCheckDebounce = setTimeout(async () => {
      if (checkingMsgEl) checkingMsgEl.style.display = 'block';
      if (duplicateMsgEl) duplicateMsgEl.style.display = 'none';
      if (availableMsgEl) availableMsgEl.style.display = 'none';

      try {
        const result = await CasesService.search({ nationalId: nationalIdValue });
        if (myToken !== duplicateCheckToken) return; // اتبعت طلب أحدث في الأثناء

        const items = result?.items || [];
        const match = items.find(item => item.nationalId === nationalIdValue
          && item.id !== store.currentCase?.id);

        if (checkingMsgEl) checkingMsgEl.style.display = 'none';

        if (match) {
          if (duplicateMsgEl) {
            duplicateMsgEl.textContent = `⚠ هذا الرقم القومي مسجّل بالفعل — الحالة رقم ${match.caseNumber || match.displayId || ''} (${CASE_STATUS_LABEL[match.status] || match.status || ''})`;
            duplicateMsgEl.style.display = 'block';
          }
          if (availableMsgEl) availableMsgEl.style.display = 'none';
          nationalIdInput.style.borderColor = '#ef4444';
        } else {
          if (duplicateMsgEl) duplicateMsgEl.style.display = 'none';
          if (availableMsgEl) availableMsgEl.style.display = 'block';
        }
      } catch (err) {
        if (myToken !== duplicateCheckToken) return;
        if (checkingMsgEl) checkingMsgEl.style.display = 'none';
        // فشل التحقق اللحظي (شبكة/سيرفر) مايوقفش المستخدم — السيرفر لسه
        // هيرفض DUPLICATE_NATIONAL_ID فعليًا عند "التالي" لو الرقم مكرر فعلاً.
        // مانوريش "الرقم ده جديد" هنا برضه — التحقق نفسه فشل، مش أكدنا حاجة.
      }
    }, 350);
  }

  function handleNationalIdExtraction() {
    if (!nationalIdInput) return;

    // أي تعديل من المستخدم بيمسح حالة "خطأ" المفروضة من بوابة التحقق قبل
    // "التالي" (validateStep1) — منطق التحقق اللحظي تحت هيتولى عرض الحالة
    // الصح (تيل/أحمر) بنفسه، فمابنسيبش الإطار الأحمر عالق بعد ما يتصلح.
    nationalIdInput.classList.remove('field-invalid');

    const rawVal = nationalIdInput.value;
    const cleanVal = normalizeNumerals(rawVal);

    if (rawVal !== cleanVal) {
      nationalIdInput.value = cleanVal;
    }

    if (cleanVal.length === 0) {
      if (errorMsgEl) errorMsgEl.style.display = 'none';
      hideDuplicateStatus();
      clearTimeout(duplicateCheckDebounce);
      duplicateCheckToken++;
      nationalIdInput.style.borderColor = '';
      clearDerivedFields();
      calculatePercentages();
      return;
    }

    if (cleanVal.length < 14) {
      if (errorMsgEl) errorMsgEl.style.display = 'none';
      hideDuplicateStatus();
      clearTimeout(duplicateCheckDebounce);
      duplicateCheckToken++;
      nationalIdInput.style.borderColor = '';
      return;
    }

    const result = parseEgyptianNationalId(cleanVal);

    if (result.valid) {
      if (errorMsgEl) errorMsgEl.style.display = 'none';
      nationalIdInput.style.borderColor = '#0d9488';

      if (ageInput) ageInput.value = result.age;
      if (genderSelect) genderSelect.value = result.genderAr;

      showToast(`تم استخراج البيانات تلقائيًا من الرقم القومي (السن: ${result.age} سنة، المحافظة: ${result.governorateAr}، النوع: ${result.genderAr}) ✅`, 'success');
      checkDuplicateNationalId(cleanVal);
    } else {
      if (errorMsgEl) {
        errorMsgEl.textContent = result.error || 'الرقم القومي غير صحيح';
        errorMsgEl.style.display = 'block';
      }
      nationalIdInput.style.borderColor = '#ef4444';
      hideDuplicateStatus();
      clearTimeout(duplicateCheckDebounce);
      duplicateCheckToken++;
      clearDerivedFields();
    }

    calculatePercentages();
  }

  function clearDerivedFields() {
    if (ageInput) ageInput.value = '';
    if (genderSelect) genderSelect.value = '';
  }

  if (nationalIdInput) {
    nationalIdInput.addEventListener('input', handleNationalIdExtraction);
    nationalIdInput.addEventListener('change', handleNationalIdExtraction);
    nationalIdInput.addEventListener('blur', handleNationalIdExtraction);
    if (nationalIdInput.value.trim().length === 14) {
      handleNationalIdExtraction();
    }
  }

  // زي الرقم القومي — أول ما المستخدم يكتب في حقل الاسم بعد ما اتعلّم
  // كحقل ناقص، بنشيل التمييز الأحمر ورسالة الخطأ بتاعته فورًا.
  const caseNameInput = DOM.qs('#case-name');
  if (caseNameInput) {
    caseNameInput.addEventListener('input', () => {
      caseNameInput.classList.remove('field-invalid');
      const caseNameErrorEl = DOM.qs('#case-name-error');
      if (caseNameErrorEl) caseNameErrorEl.style.display = 'none';
    });
  }

  // Toggle Collapse / Expand
  if (toggleBtn && roadWrapper) {
    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';
      const arrow = toggleBtn.querySelector('.workflow-toggle-btn__arrow');

      if (isExpanded) {
        roadWrapper.classList.add('workflow-road-wrapper--collapsed');
        toggleBtn.setAttribute('aria-expanded', 'false');
        if (toggleText) toggleText.textContent = `عرض جميع الخطوات (${TOTAL_STEPS})`;
        if (arrow) arrow.style.transform = 'rotate(0deg)';
      } else {
        roadWrapper.classList.remove('workflow-road-wrapper--collapsed');
        toggleBtn.setAttribute('aria-expanded', 'true');
        if (toggleText) toggleText.textContent = 'طي الخطوات';
        if (arrow) arrow.style.transform = 'rotate(180deg)';
        requestAnimationFrame(() => {
          renderJourneyTimeline();
        });
      }
    });
  }

  // نسبة اكتمال حقول Multi-select Chips داخل خطوة معينة (زي MultiSelectField.isFilled
  // في الأبلكيشن): الحقل "مكتمل" لو فيه اختيار واحد على الأقل، ولو "أخرى" من ضمن
  // الاختيارات لازم يبقى فيه نص حر مكتوب كمان.
  function calculateChipFieldsProgress(paneSelector) {
    const pane = DOM.qs(paneSelector);
    if (!pane) return 0;
    const fields = DOM.qsa('.chip-field', pane);
    if (fields.length === 0) return 0;

    let filledCount = 0;
    fields.forEach(field => {
      const activeChips = DOM.qsa('.chip-btn.chip-btn--active', field);
      if (activeChips.length === 0) return;
      const hasOther = activeChips.some(c => c.dataset.value === 'أخرى');
      const otherInput = field.querySelector('.chip-field__other');
      const otherFilled = !hasOther || (otherInput && otherInput.value.trim() !== '');
      if (otherFilled) filledCount++;
    });

    return Math.round((filledCount / fields.length) * 100);
  }

  function calculatePercentages() {
    // 1. البيانات الأساسية وأفراد الأسرة
    const s1Fields = ['case-name', 'national-id', 'head-relation', 'address'];
    let s1Count = 0;
    s1Fields.forEach(id => {
      const el = DOM.qs(`#${id}`);
      if (el && el.value.trim() !== '') s1Count++;
    });
    const pct1 = Math.round((s1Count / s1Fields.length) * 100);

    // 2. المرفقات — مؤشر للتاب بس زي الموبايل (فيه مرفق مرفوع = 100%). مش
    // داخلة في اكتمال السيرفر ولا شرط للإرسال (رد الباك إند 2026-10-08 §7).
    const s2AttachedCount = DOM.qsa('#attachments-list .case-page-att-item[data-att-id]').length;
    const pct2 = s2AttachedCount > 0 ? 100 : 0;

    // 3. السكن والمرافق والأجهزة (حقول Multi-select Chips)
    const pct3 = calculateChipFieldsProgress('#step-pane-3');

    // 4. الحيازة والأصول الزراعية — الحساب كله في agriculture.component.js
    // (مصدر واحد للحقيقة يشاركه التحقق قبل الانتقال). مرحلة لسه محدش فتحها
    // بترجع 0% بدل ما تتحسب مكتملة بالغلط.
    const pct4 = agricultureProgress();

    // 5. الدخل والمصروفات — عدد الكروت مش دليل كافٍ على الاكتمال: في بنود
    // تلقائية ثابتة (معاش، معاش تكافل وكرامة، دخل/إيجار الأرض الزراعية، 7
    // فئات مصروفات) بتتزرع دايمًا بقيمة صفر بمجرد فتح المرحلة (راجع
    // financial-ledger.component.js: _defaultExpenseCategories/buildAutoIncomeItems)
    // — فكان عدد الكروت بيبقى أكبر من صفر فورًا وتظهر المرحلة 100% مكتملة
    // من غير ما المستخدم يسجّل أي رقم فعلي. بنتأكد بدل كده إن فيه بند دخل أو
    // مصروف واحد على الأقل بقيمة أكبر من صفر (من store.incomeItems/expenseItems
    // اللي بيحدّثها recalculateBudget مع كل تغيير — مصدر الحقيقة الحقيقي للمبالغ).
    const hasNonZeroAmount = (items) => Array.isArray(items) && items.some(item => Number(item.amount) > 0);
    const pct5 = (hasNonZeroAmount(store.incomeItems) || hasNonZeroAmount(store.expenseItems)) ? 100 : 0;

    // 6. الدعم والقرار (مطابق لـ SupportRecommendationFormData.progress في
    // الأبلكيشن: 100% لو فيه فئة دعم واحدة على الأقل متفعّلة، وإلا 0%)
    const supSelectedCount = DOM.qsa('.support-type-checkbox:checked').length;
    const pct6 = supSelectedCount > 0 ? 100 : 0;

    // 7. الرأي
    const briefOp = DOM.qs('#researcher-brief-opinion');
    const opEl = DOM.qs('#researcher-opinion');
    const pct7 = ((briefOp && briefOp.value !== '') || (opEl && opEl.value.trim() !== '')) ? 100 : 0;

    currentPercentages = [pct1, pct2, pct3, pct4, pct5, pct6, pct7];

    // Update Individual Station UI (Circular Rings, Inner Percentage Text, Completion status)
    currentPercentages.forEach((pct, idx) => {
      const stepNum = idx + 1;
      const tabEl = DOM.qs(`#step-node-${stepNum}`);
      const ringEl = DOM.qs(`#ring-fill-${stepNum}`);
      const pctTextEl = DOM.qs(`#node-pct-${stepNum}`);

      if (ringEl) {
        const offset = RING_CIRCUMFERENCE * (1 - pct / 100);
        ringEl.style.strokeDasharray = `${RING_CIRCUMFERENCE}`;
        ringEl.style.strokeDashoffset = `${offset}`;
      }

      if (pctTextEl) {
        pctTextEl.textContent = `${pct}%`;
      }

      if (tabEl) {
        tabEl.classList.remove('workflow-tab--completed', 'workflow-tab--partial', 'workflow-tab--empty');
        if (pct === 100) {
          tabEl.classList.add('workflow-tab--completed');
        } else if (pct > 0) {
          tabEl.classList.add('workflow-tab--partial');
        } else {
          tabEl.classList.add('workflow-tab--empty');
        }
      }
    });

    renderJourneyTimeline();
  }

  // Attach live listeners via delegation on the personal-data view container
  const personalDataView = DOM.qs('#view-personal-data');
  function handleDelegatedRecalc(e) {
    // الفلتر القديم كان بيسيب أي input من غير كلاس .form-input (زي الراديو
    // والشيك بوكس) بره الحساب تمامًا. بنغطي كل عناصر الإدخال دلوقتي.
    if (e.target.matches('.form-input, .form-select, input, select, textarea')) {
      calculatePercentages();
    }
  }
  if (personalDataView) {
    personalDataView.addEventListener('input', handleDelegatedRecalc);
    personalDataView.addEventListener('change', handleDelegatedRecalc);
  } else {
    DOM.qsa('.form-input, .form-select').forEach(input => {
      input.addEventListener('input', calculatePercentages);
      input.addEventListener('change', calculatePercentages);
    });
  }

  /* ---------- التحقق قبل الانتقال + إعلان المرحلة لقارئ الشاشة ---------- */

  // سجل التحقق لكل مرحلة. المراحل غير المدرجة بتعدّي بدون قيود (زي ما كانت).
  // 5 تنبيهية فقط (مفيش highlighter ليها — البيانات فعليًا اختيارية عند
  // السيرفر) بينما 1 و4 بيبرزوا الحقول الناقصة بصريًا كمان. 6 بتعدّي بدون
  // تحذير خالص — نوع الدعم اختياري بالكامل.
  const STEP_VALIDATORS = {
    1: validateStep1,
    5: validateStep5
  };

  const STEP_ERROR_CLEANERS = {
    1: clearStep1Errors
  };

  const STEP_HIGHLIGHTERS = {
    1: highlightStep1Issues
  };

  function getValidationMsgEl(step) {
    const pane = DOM.qs(`#step-pane-${step}`);
    if (!pane) return null;
    let el = pane.querySelector('.step-validation-msg');
    if (!el) {
      el = document.createElement('div');
      el.className = 'step-validation-msg';
      el.setAttribute('role', 'alert');
      const card = pane.querySelector('.glass-card') || pane;
      card.appendChild(el);
    }
    return el;
  }

  function hideValidationMsg(step) {
    const el = getValidationMsgEl(step);
    if (el) el.classList.remove('step-validation-msg--visible');
    const cleaner = STEP_ERROR_CLEANERS[step];
    if (cleaner) cleaner();
  }

  function showValidationMsg(step, issues) {
    const el = getValidationMsgEl(step);
    if (!el) return;
    const lines = issues.map(i => i.message).filter(Boolean);
    el.innerHTML = `<span>⚠️</span><span>${lines.join(' — ')}</span>`;
    el.classList.add('step-validation-msg--visible');
  }

  // المراحل اللي المستخدم اتحذّر منها مرة وأصرّ يكمّل — مابنوقفهوش تاني.
  const warnedSteps = new Set();

  /**
   * تحقق "تحذير ثم سماح" قبل مغادرة مرحلة للأمام عبر زرار التالي.
   * أول ضغطة على مرحلة ناقصة: بنوقف ونبيّن الناقص.
   * ضغطة تانية على نفس المرحلة: بنسمح بالمرور (البيانات محفوظة كمسودة
   * والنسبة بتفضل أقل من 100% في شريط التقدّم).
   * كده الموظف الميداني مايتحبسش لو ناقصه معلومة هيجيبها بعدين.
   */
  function canLeaveStep(step) {
    const validator = STEP_VALIDATORS[step];
    if (!validator) return true;

    const issues = validator();
    if (issues.length === 0) {
      hideValidationMsg(step);
      warnedSteps.delete(step);
      return true;
    }

    if (warnedSteps.has(step)) {
      // اتحذّر قبل كده — بنسيبه يعدّي ونسيب التمييز ظاهر كتذكير.
      showToast('تمام، هنكمّل — بس متنساش تراجع الحقول الناقصة قبل الحفظ النهائي', 'warning');
      return true;
    }

    warnedSteps.add(step);
    showValidationMsg(step, issues);
    const highlighter = STEP_HIGHLIGHTERS[step];
    if (highlighter) highlighter(issues);
    showToast('فيه حقول ناقصة في المرحلة دي — لو عايز تكملها بعدين، اضغط "التالي" تاني وهنكمل', 'warning');
    return false;
  }

  // منطقة إعلان مباشرة لقارئات الشاشة عند تغيير المرحلة.
  let stepLiveRegion = null;
  function announceStep(step) {
    if (!stepLiveRegion) {
      stepLiveRegion = document.createElement('div');
      stepLiveRegion.className = 'sr-only';
      stepLiveRegion.setAttribute('aria-live', 'polite');
      stepLiveRegion.setAttribute('aria-atomic', 'true');
      document.body.appendChild(stepLiveRegion);
    }
    const meta = STAGES_METADATA.find(m => m.step === step);
    stepLiveRegion.textContent = meta
      ? `المرحلة ${step} من ${TOTAL_STEPS}: ${meta.title}`
      : `المرحلة ${step} من ${TOTAL_STEPS}`;
  }

  function activateStep(step, scroll = true, direction = null) {
    const targetStep = parseInt(step, 10) || 1;
    const prevStep = currentActiveStep;
    const isForward = direction !== null ? direction === 'next' : targetStep >= prevStep;
    currentActiveStep = targetStep;

    stepNodes.forEach(n => {
      n.classList.remove('workflow-tab--active');
      n.removeAttribute('aria-current');
    });
    const targetNode = DOM.qs(`#step-node-${targetStep}`) || DOM.qs(`.workflow-tab[data-step="${targetStep}"]`);
    if (targetNode) {
      targetNode.classList.add('workflow-tab--active');
      targetNode.setAttribute('aria-current', 'step');
    }

    DOM.qsa('#view-personal-data .step-pane').forEach(pane => {
      pane.style.display = 'none';
      pane.classList.remove('step-pane--enter-next', 'step-pane--enter-prev');
    });

    const activePane = DOM.qs(`#step-pane-${targetStep}`);
    if (!activePane) {
      // الـ pane مش موجود (فشل تحميل الجزء) — ما نحفظش رقم مرحلة هيرجّع
      // المستخدم لشاشة فاضية بعد الـ refresh.
      console.warn(`[workflow] step-pane-${targetStep} غير موجود — تم إلغاء الانتقال`);
      currentActiveStep = prevStep;
      return false;
    }

    activePane.style.display = 'block';
    // Force animation restart
    void activePane.offsetWidth;
    activePane.classList.add(isForward ? 'step-pane--enter-next' : 'step-pane--enter-prev');

    if (scroll && workflowCard) {
      workflowCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // نقل التركيز للمرحلة الجديدة — مستخدم لوحة المفاتيح/قارئ الشاشة لازم
    // يعرف إن المحتوى اتغيّر، ومش كفاية إن الصفحة تسكرول.
    if (scroll) {
      activePane.focus({ preventScroll: true });
    }
    announceStep(targetStep);

    store.setActiveStage(targetStep, true);

    // Update floating buttons state
    updateFloatingNavState(currentActiveStep);

    // Update journey progress line to color up to the newly activated station
    renderJourneyTimeline();

    return true;
  }

  const NEXT_ARROW_ICON = `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="15 18 9 12 15 6"></polyline>
    </svg>`;

  const SAVE_DISK_ICON = `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
      <polyline points="17 21 17 13 7 13 7 21"></polyline>
      <polyline points="7 3 7 8 15 8"></polyline>
    </svg>`;

  function updateFloatingNavState(step) {
    const current = parseInt(step, 10) || 1;
    const btnPrev = document.querySelector('#btn-floating-prev');
    const btnNext = document.querySelector('#btn-floating-next');
    const prevLabel = document.querySelector('#floating-prev-label');
    const nextTitle = document.querySelector('#floating-next-title');
    const nextLabel = document.querySelector('#floating-next-label');
    const nextIcon = document.querySelector('#floating-next-icon');
    const btnAssignSpecialist = document.querySelector('#btn-floating-assign-specialist');

    if (!btnPrev || !btnNext) return;

    // Previous Button (السابق)
    if (current <= 1) {
      btnPrev.disabled = true;
      btnPrev.classList.add('step-float-btn--disabled');
      if (prevLabel) prevLabel.textContent = 'البداية';
    } else {
      btnPrev.disabled = false;
      btnPrev.classList.remove('step-float-btn--disabled');
      const prevMeta = STAGES_METADATA.find(s => s.step === current - 1);
      if (prevLabel) prevLabel.textContent = prevMeta ? prevMeta.title : `المرحلة ${current - 1}`;
    }

    // Last Step Specific Transformation: Next Button becomes "حفظ" + "إرسال لأخصائي" above it
    if (current >= TOTAL_STEPS) {
      // 1. Show "إرسال لأخصائي" button above it — وفعّله/عطّله حسب حالة
      // الملف الحالية بدل ما يفضل شغال دايمًا لمجرد إننا في آخر خطوة.
      if (btnAssignSpecialist) {
        if (canAssignSpecialist()) {
          btnAssignSpecialist.style.display = 'flex';
          syncAssignButtonEligibility(btnAssignSpecialist);
        } else {
          btnAssignSpecialist.style.display = 'none';
        }
      }

      // 2. Next Button becomes active "حفظ" button
      btnNext.disabled = false;
      btnNext.classList.remove('step-float-btn--disabled');
      btnNext.classList.add('step-float-btn--save');
      if (nextTitle) nextTitle.textContent = 'حفظ';
      if (nextLabel) nextLabel.textContent = 'حفظ بيانات الحالة';
      if (nextIcon) nextIcon.innerHTML = SAVE_DISK_ICON;
      btnNext.setAttribute('aria-label', 'حفظ بيانات الحالة');
      btnNext.setAttribute('title', 'حفظ وإنهاء بيانات الحالة');
    } else {
      // 1. Hide "إرسال لأخصائي" button in all but the last step
      if (btnAssignSpecialist) {
        btnAssignSpecialist.style.display = 'none';
      }

      // 2. Next Button returns to "التالي" (المرحلة الأولى تعرض "الحفظ و التالي" لأنها بتنشئ الحالة)
      btnNext.disabled = false;
      btnNext.classList.remove('step-float-btn--disabled', 'step-float-btn--save');
      if (nextTitle) nextTitle.textContent = current === 1 ? 'الحفظ و التالي' : 'التالي';
      const nextMeta = STAGES_METADATA.find(s => s.step === current + 1);
      if (nextLabel) nextLabel.textContent = nextMeta ? nextMeta.title : `المرحلة ${current + 1}`;
      if (nextIcon) nextIcon.innerHTML = NEXT_ARROW_ICON;
      btnNext.setAttribute('aria-label', 'المرحلة التالية');
      btnNext.setAttribute('title', 'الانتقال للمرحلة التالية');
    }
  }

  /**
   * Dispatches to the right API save for the step being left. Step 4
   * (agriculture) needs readAgricultureData from agriculture.component.js,
   * so it's wired here rather than through the plain STEP_SAVE_HANDLERS map.
   * @returns {Promise<boolean>} false means "stay on this step" (already toasted).
   */
  async function saveCurrentStepToApi(step) {
    if (step === 4) return saveStep4(readAgricultureData);
    const handler = STEP_SAVE_HANDLERS[step];
    if (!handler) return true;
    return handler();
  }

  function saveFinalStepData() {
    const selectedSupportTypes = Array.from(document.querySelectorAll('.support-type-checkbox:checked'))
      .map(cb => cb.closest('.support-type-tile')?.dataset.supportType)
      .filter(Boolean);
    const selectedSubTypes = Array.from(document.querySelectorAll('.support-type-tile__subs .chip-btn.chip-btn--active'))
      .map(chip => chip.dataset.value);

    const supportRecord = {
      selectedSupportTypes,
      selectedSubTypes,
      savedAt: new Date().toISOString()
    };

    StorageService.set(STORAGE_KEYS.SUPPORT_DECISION_DATA, supportRecord);

    // بيانات المرحلة 4 بتتحفظ لحظيًا في الـ store، بس بنأكد الحفظ هنا برضه
    // علشان الحفظ النهائي يبقى لقطة متسقة من الاستمارة كلها.
    store.setAgriculture(readAgricultureData());

    showToast('تم حفظ رأي الباحث الاجتماعي، والحالة بقت "بانتظار الإسناد" 💾✨', 'success');

    // وضع "تعديل حالة موجودة" (راجع case-edit.loader.js) مختلف عن "إنشاء
    // حالة جديدة": هنا مفيش داعي نمسح الفورم ولا نروح الرئيسية — المستخدم
    // جاي أصلاً من صفحة تفاصيل الحالة وعايز يرجعلها يشوف التعديل اللي عمله.
    const isEditMode = store.currentCase?.isEditMode === true;
    const caseId = store.currentCase?.id;

    setTimeout(() => {
      if (isEditMode && caseId && window.openCaseDetailsPage) {
        window.switchView('case-details');
        window.openCaseDetailsPage(caseId);
      } else {
        switchView('dashboard');
        resetWizardForNewCase();
      }
    }, 1200);
  }

  /**
   * يصفّر الاستمارة كلها استعدادًا لحالة جديدة — نفس الأثر اللي كان بيحصل
   * مع Refresh فعلي، لكن من غير ما نحتاج نعمل reload حقيقي للصفحة. بيتنادى
   * بعد ما المستخدم يخلّص استمارة (مرحلة 7) ويرجع للرئيسية، عشان لو فتح
   * "البيانات الأساسية" تاني يلاقيها فاضية بدل ما تكمّل تحديث نفس الحالة
   * القديمة بالغلط.
   */
  function resetWizardForNewCase() {
    // 1. الحالة الجارية نفسها (id، rowVersion كل قسم) — زي ما بيحصل مع أي
    // refresh فعلي (راجع تعليق currentCase في state/store.js).
    store.clearCurrentCase();

    // 2. أفراد الأسرة والزراعة — in-memory بس زي currentCase بالظبط (نفس
    // إصلاح باگ "أفراد الأسرة بيفضلوا من حالة سابقة" اللي اتعمل قبل كده).
    resetFamilyMembersManager();
    store.setAgriculture(null);

    // 3. الدخل والمصروفات (مرحلة 5) — بنود تلقائية + يدوية كلها closures
    // محلية جوه financial-ledger.component.js، فبترجع لحالتها الافتراضية
    // عن طريق الـ reset callback المسجّل هناك.
    resetFinancialManager();

    // 4. كل حقول الإدخال النصية/الاختيارية في التابات التمنية — بما فيهم
    // الحقول اللي معندهاش تطبيع خاص (عنوان، ملاحظات، راديو، سيلكت...).
    const view = DOM.qs('#view-personal-data');
    if (view) {
      DOM.qsa('input[type="text"], input[type="tel"], input[type="number"], textarea', view).forEach(el => {
        if (el.readOnly) return; // current-age مشتقة من الرقم القومي، مش حقل حر
        el.value = '';
      });
      DOM.qsa('select', view).forEach(el => { el.selectedIndex = 0; });
      // الديانة افتراضيها «مسلم» (الباقي بيرجع للـ placeholder).
      const religionSelect = DOM.qs('#religion', view);
      if (religionSelect && [...religionSelect.options].some(o => o.value === 'مسلم')) religionSelect.value = 'مسلم';
      DOM.qsa('input[type="radio"], input[type="checkbox"]', view).forEach(el => { el.checked = false; });
      DOM.qsa('.chip-btn--active', view).forEach(chip => chip.classList.remove('chip-btn--active'));
      DOM.qsa('.chip-field__other', view).forEach(el => { el.value = ''; el.style.display = 'none'; });
      DOM.qsa('.field-invalid', view).forEach(el => el.classList.remove('field-invalid'));
    }
    // تاب الدعم: الأفراد المعلّمين والأنواع المفتوحة والاسم الحر في «أخرى».
    resetSupportManager();

    // 5. المرفقات المرفوعة (مرحلة 2) — قايمة العرض، وتصنيف المستند ووصفه.
    const attachmentsList = DOM.qs('#attachments-list');
    if (attachmentsList) {
      DOM.qsa('.case-page-att-item[data-att-row], [data-att-load-error]', attachmentsList).forEach(row => row.remove());
    }
    const docTypeSelect = DOM.qs('#case-doc-type');
    if (docTypeSelect) {
      docTypeSelect.selectedIndex = 0;
      docTypeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const attachmentsEmptyState = DOM.qs('#attachments-empty-state');
    if (attachmentsEmptyState) attachmentsEmptyState.style.display = 'flex';

    // 6. حالات التحقق/التحذير المعلّقة من الجلسة القديمة.
    warnedSteps.clear();
    Object.keys(STEP_VALIDATORS).map(Number).forEach(step => hideValidationMsg(step));

    // 7. رجّع نسبة الإكمال لصفر في كل التابات، والتاب النشط لأول مرحلة.
    calculatePercentages();
    activateStep(1, false);
  }

  // Floating Step Navigation Click Handlers
  const btnFloatingPrev = document.querySelector('#btn-floating-prev');
  const btnFloatingNext = document.querySelector('#btn-floating-next');

  if (btnFloatingPrev) {
    btnFloatingPrev.addEventListener('click', (e) => {
      e.preventDefault();
      if (currentActiveStep > 1) {
        // الرجوع للخلف مسموح دايمًا بدون تحقق — بس بنخفي رسالة الخطأ.
        hideValidationMsg(currentActiveStep);
        const targetStep = currentActiveStep - 1;
        activateStep(targetStep, true, 'prev');
      }
    });
  }

  if (btnFloatingNext) {
    btnFloatingNext.addEventListener('click', async (e) => {
      e.preventDefault();

      // تزامن فوري قبل التحقق — علشان أي قيمة اتكتبت لسه تكون داخلة في
      // الحساب، ومانعتمدش على حدث input المفوَّض وحده.
      calculatePercentages();

      // بوابة التحقق: تحذير أول مرة، وسماح لو المستخدم أصرّ.
      if (!canLeaveStep(currentActiveStep)) return;

      // حفظ المرحلة الحالية عبر الـ API قبل الانتقال — الحفظ بيحصل فقط هنا،
      // عند الضغط على "التالي"، مش أثناء الكتابة. لو الحفظ فشل (خطأ شبكة،
      // 409 تعارض، إلخ) بنوقف المستخدم في مكانه بدل ما نعدّي لمرحلة
      // البيانات فيها لسه مش محفوظة على السيرفر.
      btnFloatingNext.disabled = true;
      try {
        const saved = await saveCurrentStepToApi(currentActiveStep);
        if (!saved) return;
      } finally {
        btnFloatingNext.disabled = false;
      }

      if (currentActiveStep < TOTAL_STEPS) {
        const targetStep = currentActiveStep + 1;
        activateStep(targetStep, true, 'next');
      } else {
        // آخر مرحلة = حفظ. هنا بنراجع كل المراحل اللي ليها تحقق، مش المرحلة
        // الحالية بس — علشان مرحلة ناقصة عدّاها المستخدم بالتحذير ماتعدّيش
        // للحفظ النهائي في صمت.
        const incomplete = Object.keys(STEP_VALIDATORS)
          .map(Number)
          .filter(st => STEP_VALIDATORS[st]().length > 0);

        if (incomplete.length > 0) {
          const names = incomplete
            .map(st => STAGES_METADATA.find(m => m.step === st))
            .filter(Boolean)
            .map(m => m.title)
            .join('، ');
          showToast(`قبل ما نقفل الملف، لازم نكمّل المراحل دي الأول: ${names}`, 'warning');
          // بننقل المستخدم لأول مرحلة ناقصة ونبيّنله الحقول المطلوبة.
          const first = incomplete[0];
          activateStep(first, true, 'prev');
          const issues = STEP_VALIDATORS[first]();
          showValidationMsg(first, issues);
          const highlighter = STEP_HIGHLIGHTERS[first];
          if (highlighter) highlighter(issues);
          return;
        }

        saveFinalStepData();
      }
    });
  }

  // Initial sync of floating nav buttons
  updateFloatingNavState(currentActiveStep);

  // Initialize Specialist Assignment Modal
  initSpecialistAssignmentModal();

  // Wire the step-2 attachment upload input to the real presigned-URL flow
  // (POST /attachments/init -> PUT storage -> POST /commit).
  wireAttachmentUpload();

  // "تحميل آخر نسخة" بعد تعارض حفظ (personal-data.api.js) محتاج يصفّر
  // الاستمارة ويرجع لنفس المرحلة — والاتنين closures هنا.
  registerWizardControls({
    reset: resetWizardForNewCase,
    goToStep: (step) => activateStep(step, true)
  });

  // البيانات الشخصية لازم centerId/villageId الحقيقية (GUID) عشان step 1
  // يقدر يبعتها لـ POST /cases — لو محدش جاب /locations قبل كده (المستخدم
  // فتح الشاشة دي أول حاجة، مش من شاشة الجمعيات/الموظفين) بنجيبها هنا.
  // ما بنكررش الجلب لو الماب اتملى بالفعل.
  if (Object.keys(store.locationIds.centers || {}).length === 0) {
    LocationsService.list()
      .then(centers => store.applyLocationsFromServer(centers))
      .catch(err => console.warn('[personal-data] تعذر تحميل المراكز/القرى:', messageFromError(err)));
  }

  // Attach click & keyboard listeners on step nodes
  // ملاحظة: النقر على محطة من خريطة الرحلة = تنقّل حر (زي تبويبات)، مش إرسال
  // للاستمارة — فمابنمنعوش بالتحقق. البوابة بتفضل على زرار "التالي" وعلى
  // "حفظ" في آخر مرحلة، وهما مسار الإكمال الفعلي. كده المستخدم يقدر يتنقل
  // بين 4 و5 و6 بحرية ويرجع يكمّل الناقص بعدين.
  stepNodes.forEach((node) => {
    node.addEventListener('click', () => {
      const step = parseInt(node.getAttribute('data-step'), 10) || 1;
      if (step === currentActiveStep) return;
      const dir = step > currentActiveStep ? 'next' : 'prev';

      // بنحدّث النسب ونخفي رسالة الخطأ الخاصة بالمرحلة اللي بنغادرها، بس
      // من غير ما نوقف الانتقال.
      calculatePercentages();
      hideValidationMsg(currentActiveStep);

      activateStep(step, true, dir);
    });

    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        node.click();
      }
    });
  });

  // Restore active step tab from store / localStorage
  const savedStep = parseInt(store.activeStage, 10);
  if (savedStep >= 1 && savedStep <= TOTAL_STEPS) {
    const ok = activateStep(savedStep, false);
    if (!ok) activateStep(1, false);
  } else {
    activateStep(1, false);
  }

  // Setup ResizeObserver & Window Resize
  setupResizeObserver();

  // Handle font loading and body layout changes
  if (document.fonts) {
    document.fonts.ready.then(() => {
      requestAnimationFrame(renderJourneyTimeline);
    });
  }

  window.addEventListener('resize', () => {
    requestAnimationFrame(renderJourneyTimeline);
  });

  // Initial calculation & event bus listener
  calculatePercentages();
  onWorkflowRecalc(calculatePercentages);
}

function setupResizeObserver() {
  const container = DOM.qs('#workflow-road-wrapper') || DOM.qs('#case-journey-container');
  if (!container || typeof ResizeObserver === 'undefined') return;

  if (journeyResizeObserver) journeyResizeObserver.disconnect();

  journeyResizeObserver = new ResizeObserver(() => {
    requestAnimationFrame(() => {
      renderJourneyTimeline();
    });
  });

  journeyResizeObserver.observe(container);
}

/**
 * DEVX SVG TIMELINE ENGINE
 * Dynamically measures station DOM centers and builds a continuous
 * G1-smooth snake path across 2 rows (3 + 4) or vertical stack on mobile.
 */
export function renderJourneyTimeline() {
  const svgEl = DOM.qs('#case-journey-svg');
  const trackPath = DOM.qs('#journey-track-path');
  const progressPath = DOM.qs('#journey-progress-path');
  if (!svgEl || !trackPath || !progressPath) return;

  const svgRect = svgEl.getBoundingClientRect();
  if (svgRect.width === 0 || svgRect.height === 0) return;

  // Collect centers of all stations
  const centers = {};
  let validCount = 0;
  for (let s = 1; s <= TOTAL_STEPS; s++) {
    const nodeEl = DOM.qs(`#step-pct-${s}`);
    if (nodeEl) {
      const rect = nodeEl.getBoundingClientRect();
      centers[s] = {
        x: rect.left - svgRect.left + rect.width / 2,
        y: rect.top - svgRect.top + rect.height / 2,
      };
      validCount++;
    }
  }

  if (validCount < TOTAL_STEPS) return;

  // Detect layout mode: Mobile Vertical (< 768px or vertical displacement between 1 & 2)
  const isMobile = window.innerWidth <= 768 || Math.abs(centers[2].y - centers[1].y) > 30;

  let pathString = '';
  const stationSubpaths = [];

  if (isMobile) {
    // Mobile: Continuous vertical connector passing through station centers
    pathString = `M ${centers[1].x.toFixed(1)},${centers[1].y.toFixed(1)}`;
    let currentSub = pathString;
    stationSubpaths[1] = currentSub;

    for (let s = 2; s <= TOTAL_STEPS; s++) {
      const seg = ` L ${centers[s].x.toFixed(1)},${centers[s].y.toFixed(1)}`;
      pathString += seg;
      currentSub += seg;
      stationSubpaths[s] = currentSub;
    }
  } else {
    // Desktop / Tablet Snake: Row 1 (3), U-Turn, Row 2 (4)

    // Row 1: 1 -> 2 -> 3 (Visual RTL: 1 is Right, 3 is Left)
    pathString = `M ${centers[1].x.toFixed(1)},${centers[1].y.toFixed(1)}`;
    stationSubpaths[1] = pathString;
    for (let s = 2; s <= 3; s++) {
      pathString += ` L ${centers[s].x.toFixed(1)},${centers[s].y.toFixed(1)}`;
      stationSubpaths[s] = pathString;
    }

    // U-Turn: Between Station 3 (Row 1 Left) and Station 4 (Row 2 Left)
    // Curving smoothly around the left side with horizontal tangents (G1 continuity)
    const rowGap = Math.abs(centers[4].y - centers[3].y);
    const uTurnRadius = Math.min(Math.max(rowGap * 0.72, 45), 90);
    const minLeftX = Math.min(centers[3].x, centers[4].x) - uTurnRadius;
    const c1x = minLeftX.toFixed(1);
    const c1y = centers[3].y.toFixed(1);
    const c2x = minLeftX.toFixed(1);
    const c2y = centers[4].y.toFixed(1);

    const uTurn = ` C ${c1x},${c1y} ${c2x},${c2y} ${centers[4].x.toFixed(1)},${centers[4].y.toFixed(1)}`;
    pathString += uTurn;
    stationSubpaths[4] = pathString;

    // Row 2: 4 -> 5 -> 6 -> 7 (Visual LTR: 4 is Left, 7 is Right)
    for (let s = 5; s <= TOTAL_STEPS; s++) {
      pathString += ` L ${centers[s].x.toFixed(1)},${centers[s].y.toFixed(1)}`;
      stationSubpaths[s] = pathString;
    }
  }

  // Apply to SVG Track & Progress elements
  trackPath.setAttribute('d', pathString);
  progressPath.setAttribute('d', pathString);

  // Compute Total Length and Subpath Distances
  const totalLength = trackPath.getTotalLength();
  if (totalLength <= 0) return;

  // Measure cumulative path lengths for each station
  const stationDistances = [0]; // index 0 unused, index 1 is distance 0
  stationDistances[1] = 0;

  // Use a temporary invisible path to measure each station's exact distance along the curve
  let tempMeasurePath = document.getElementById('journey-measure-temp-path');
  if (!tempMeasurePath) {
    tempMeasurePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tempMeasurePath.setAttribute('id', 'journey-measure-temp-path');
    tempMeasurePath.style.display = 'none';
    svgEl.appendChild(tempMeasurePath);
  }

  for (let s = 2; s <= TOTAL_STEPS; s++) {
    tempMeasurePath.setAttribute('d', stationSubpaths[s] || pathString);
    stationDistances[s] = tempMeasurePath.getTotalLength();
  }

  // Calculate Overall Progress Distance along the path
  // Colored up to the active station the user is currently standing on
  const activeStepNum = Math.min(TOTAL_STEPS, Math.max(1, currentActiveStep));
  let progressDistance = stationDistances[activeStepNum] || 0;

  // Extend *partway into* the next segment while the active stage is still
  // incomplete. عمدًا بنقف عند المحطة نفسها لما تكون 100%: الامتداد الكامل
  // كان بيوصّل الخط للمحطة اللي بعدها ويبان إن المستخدم واقف عليها
  // (الضغط على 5 كان بيلوّن لحد 6، و6 لحد 7).
  const currentStepPct = currentPercentages[activeStepNum - 1] || 0;
  if (activeStepNum < TOTAL_STEPS && currentStepPct > 0 && currentStepPct < 100) {
    const nextDist = stationDistances[activeStepNum + 1] || totalLength;
    // سقف 90% من طول الوصلة علشان الخط يفضل واضح إنه لسه ماوصلش المحطة التالية.
    const segmentRatio = Math.min(currentStepPct / 100, 0.9);
    progressDistance += segmentRatio * (nextDist - progressDistance);
  }

  // Apply continuous progress stroke
  progressPath.style.strokeDasharray = `${totalLength} ${totalLength}`;
  const clampedOffset = Math.max(0, totalLength - progressDistance);
  progressPath.style.strokeDashoffset = `${clampedOffset}`;
}

/**
 * Specialist Assignment Modal Controller
 * Allows assigning a field social worker in the final step with live search.
 */
function initSpecialistAssignmentModal() {
  const modal = document.querySelector('#modal-assign-specialist');
  if (!modal) return;

  const btnFloatingAssign = document.querySelector('#btn-floating-assign-specialist');
  const btnClose = document.querySelector('#btn-close-specialist-modal');
  const btnCancel = document.querySelector('#btn-cancel-specialist-modal');
  const searchInput = document.querySelector('#specialist-modal-search');
  const btnClearSearch = document.querySelector('#btn-clear-specialist-search');
  const listContainer = document.querySelector('#specialist-modal-list');

  // آخر قائمة أخصائيين جاية من السيرفر — الأزرار بتقرأ منها عند الضغط،
  // مافيش داعي لإعادة تخزين الاسم/التليفون في data attributes.
  let lastFetchedSpecialists = [];
  let searchDebounceTimer = null;
  let searchRequestSeq = 0; // يمنع رد بطيء قديم يكتب فوق نتيجة بحث أحدث

  /**
   * يجيب الأخصائيين الاجتماعيين *الفعليين* من GET /employees/social-workers
   * (المصدر اللي حددته رسالة الباك إند) — مش من قائمة الموظفين المحلية،
   * اللي ممكن تكون فاضية أو قديمة أو فيها أدوار تانية. السيرفر بيرجع نشطين
   * بس، ويدعم `search` كـ query param فبنستخدمه بدل الفلترة محليًا.
   */
  async function fetchAndRenderSpecialists(query = '') {
    if (!listContainer) return;
    const seq = ++searchRequestSeq;

    listContainer.innerHTML = `<div class="specialist-empty-state"><div class="specialist-empty-desc">⏳ جاري تحميل الأخصائيين...</div></div>`;

    let specialists = [];
    try {
      specialists = await EmployeesService.listSocialWorkers(query.trim() || undefined);
    } catch (err) {
      if (seq !== searchRequestSeq) return; // رد قديم بعد ما اتبعت بحث جديد
      listContainer.innerHTML = `
        <div class="specialist-empty-state">
          <div class="specialist-empty-icon">⚠️</div>
          <div class="specialist-empty-title">تعذر تحميل قائمة الأخصائيين</div>
          <div class="specialist-empty-desc">${DOM.escapeHTML(messageFromError(err))}</div>
        </div>
      `;
      return;
    }
    if (seq !== searchRequestSeq) return;

    lastFetchedSpecialists = specialists || [];
    renderSpecialistsList(lastFetchedSpecialists);
  }

  function renderSpecialistsList(specialists) {
    if (!listContainer) return;

    if (specialists.length === 0) {
      listContainer.innerHTML = `
        <div class="specialist-empty-state">
          <div class="specialist-empty-icon">🔍</div>
          <div class="specialist-empty-title">لم يتم العثور على أخصائي مطابق</div>
          <div class="specialist-empty-desc">يرجى تجربة البحث باسم أو رقم هاتف آخر</div>
        </div>
      `;
      return;
    }

    // SocialWorkerListItem: {id, fullName, phone, centerId} — شكل مبسّط
    // مقصود من الباك إند (بدون email/role/status)، فمفيش داعي نعرض روابط
    // مركز بالاسم هنا غير لو حبينا لاحقًا نربط centerId باسم من /locations.
    listContainer.innerHTML = specialists.map(s => {
      const avatarLetter = (s.fullName || 'أ').trim().charAt(0);
      return `
        <div class="specialist-card-item" data-specialist-id="${DOM.escapeHTML(s.id)}">
          <div class="specialist-item-profile">
            <div class="specialist-avatar">${DOM.escapeHTML(avatarLetter)}</div>
            <div class="specialist-item-details">
              <div class="specialist-item-name">${DOM.escapeHTML(s.fullName)}</div>
              <div class="specialist-item-meta">
                <span class="specialist-meta-pill specialist-meta-pill--role">أخصائي اجتماعي ميداني</span>
                ${s.phone ? `<span class="specialist-meta-pill specialist-meta-pill--phone">📞 ${DOM.escapeHTML(s.phone)}</span>` : ''}
              </div>
            </div>
          </div>
          <div>
            <button type="button" class="btn-assign-specialist-action" data-specialist-id="${DOM.escapeHTML(s.id)}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" y1="8" x2="19" y2="14"></line><line x1="22" y1="11" x2="16" y2="11"></line></svg>
              <span>إرسال وتكليف</span>
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Attach click events on action buttons
    listContainer.querySelectorAll('.btn-assign-specialist-action').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const specId = btn.getAttribute('data-specialist-id');
        const chosen = lastFetchedSpecialists.find(sp => sp.id === specId);
        if (!chosen) return;

        const caseId = store.currentCase?.id;
        if (!caseId) {
          showToast('كمّل المرحلة الأولى واضغط "التالي" الأول قبل التكليف — الحالة لسه مش محفوظة على السيرفر', 'warning');
          return;
        }

        // POST /cases/{id}/assign هو أحد التسعة endpoints اللي محتاجة
        // Idempotency-Key (UUID جديد لكل محاولة منطقية). ده بيحمي من تكرار
        // التكليف لو ضغط المستخدم مرتين أو حصل إعادة إرسال شبكة.
        const idempotencyKey = crypto.randomUUID();

        btn.disabled = true;
        try {
          // caseRowVersion إجباري لهذا المسار (uint غير nullable عند
          // السيرفر) — نجيب نسخة طازجة دايمًا بدل ما نعتمد على قيمة مخزّنة
          // ممكن تكون قديمة، فنقلل احتمال 409 تعارض.
          const fresh = await CasesService.getById(caseId);
          if (!ASSIGNABLE_STATUSES.has(fresh?.status)) {
            // فتحنا المودال وهو متاح، بس الحالة اتغيرت وإحنا فاتحينه (حد
            // تاني بعتها قبلنا بالظبط). بنوقف هنا بدل ما نضرب 422 من غير
            // داعي، ونحدّث الزرار عشان يفضل معطّل لو المستخدم فتح المودال تاني.
            store.setCurrentCase({ ...store.currentCase, status: fresh?.status });
            syncAssignButtonEligibility(btnFloatingAssign);
            closeModal();
            showToast(`تعذّر الإرسال — الحالة بقت "${CASE_STATUS_LABEL[fresh?.status] || fresh?.status}" بالفعل قبل ما تكمّل`, 'warning');
            return;
          }
          const result = await CasesService.assign(caseId, chosen.id, fresh?.rowVersion, idempotencyKey);
          store.setCurrentCase({ ...store.currentCase, status: result?.status || 'assigned' });
          syncAssignButtonEligibility(btnFloatingAssign);
          closeModal();
          showToast(`تم إرسال الحالة وتكليف الأخصائي (${chosen.fullName}) بنجاح 🚀`, 'success');
        } catch (err) {
          showToast(messageFromError(err), 'error');
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  function openModal() {
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    if (searchInput) {
      searchInput.value = '';
      if (btnClearSearch) btnClearSearch.style.display = 'none';
    }
    fetchAndRenderSpecialists('');
    if (searchInput) {
      setTimeout(() => searchInput.focus(), 80);
    }
  }

  function closeModal() {
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  }

  if (btnFloatingAssign) {
    btnFloatingAssign.addEventListener('click', async (e) => {
      e.preventDefault();
      if (btnFloatingAssign.disabled || !canAssignSpecialist()) return;

      const caseId = store.currentCase?.id;
      if (!caseId) {
        openModal();
        return;
      }

      // فحص طازج قبل فتح المودال — الحالة المخزنة محليًا ممكن تبقى قديمة
      // لو حد تاني (زميل data_entry/manager) بعت نفس الملف قبلنا؛ الرؤية
      // global فأي حد يقدر يبعت أي حالة (راجع "Frontend note" تحت
      // POST /cases/{id}/assign في WEB_API_DOCUMENTATION.md).
      btnFloatingAssign.disabled = true;
      try {
        const fresh = await CasesService.getById(caseId);
        store.setCurrentCase({ ...store.currentCase, status: fresh?.status });
        const isAssignable = syncAssignButtonEligibility(btnFloatingAssign);
        if (!isAssignable) {
          showToast(`تعذّر الإرسال — الحالة بقت "${CASE_STATUS_LABEL[fresh?.status] || fresh?.status}" بالفعل`, 'warning');
          return;
        }
        openModal();
      } catch (err) {
        btnFloatingAssign.disabled = false;
        showToast(messageFromError(err), 'error');
      }
    });
  }

  if (btnClose) btnClose.addEventListener('click', closeModal);
  if (btnCancel) btnCancel.addEventListener('click', closeModal);

  // Click outside modal-card to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  // Escape key listener
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.style.display === 'flex') {
      closeModal();
    }
  });

  // البحث بقى نداء API حقيقي (GET /employees/social-workers?search=...) —
  // بنأخّر الطلب 300ms بعد آخر حرف عشان منقصفش السيرفر بطلب لكل ضغطة.
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const val = searchInput.value;
      if (btnClearSearch) {
        btnClearSearch.style.display = val ? 'block' : 'none';
      }
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => fetchAndRenderSpecialists(val), 300);
    });
  }

  if (btnClearSearch) {
    btnClearSearch.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        btnClearSearch.style.display = 'none';
        clearTimeout(searchDebounceTimer);
        fetchAndRenderSpecialists('');
        searchInput.focus();
      }
    });
  }
}


