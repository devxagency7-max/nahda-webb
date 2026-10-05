/* --------------------------------------------------------------------------
   PERSONAL-DATA WIZARD — API BINDING LAYER
   Reads each step's DOM into the exact request shape its endpoint expects
   (WEB_API_DOCUMENTATION.md §12.3) and drives the save call. Kept separate
   from workflow.component.js (navigation/UI orchestration) and from
   case-preview.js (read-only local preview) so each file stays single-purpose.

   Save timing (per product decision): a section is only PUT when the user
   presses "التالي" and leaves that step forward — never on blur/debounce.
   Step 1's "التالي" is special: if there is no case yet, it first POSTs
   /cases to create the shell, then every subsequent step's "التالي" PUTs
   its section against that case id.
   -------------------------------------------------------------------------- */
import { DOM } from '../../utils/dom.js';
import { store } from '../../state/store.js';
import { showToast } from '../../utils/toast.js';
import { CasesService } from '../../services/cases.service.js';
import { AttachmentsService } from '../../services/attachments.service.js';
import { ApiError, messageFromError } from '../../services/errors.js';
import { parseEgyptianNationalId } from '../../utils/nationalId.js';
import { choiceDialog } from '../../utils/dialog.js';
import { loadCaseIntoForm } from './case-edit.loader.js';
import { addUploadedAttachmentRow } from '../attachments/attachments.component.js';

function val(id) {
  const el = DOM.qs(`#${id}`);
  return el && el.value ? el.value.trim() : '';
}

function num(id) {
  const n = Number(val(id));
  return Number.isFinite(n) && val(id) !== '' ? n : null;
}

function isChecked(id) {
  const el = DOM.qs(`#${id}`);
  return Boolean(el && el.checked);
}

function currentCaseId() {
  return store.currentCase?.id || null;
}

/*
 * أرقام النسخ (optimistic concurrency) — مؤكَّدة من الباك إند (2026-09-30):
 *   - caseRowVersion = xmin صف الحالة. بيزيد بس مع writes أقسام القوائم
 *     (family-members/utilities/financial/initial-needs/assessed-needs/
 *     support-*) وعمليات الـ workflow (assign, opinions, return-*, submit —
 *     وكمان رأي الأخصائي من تطبيق الموبايل).
 *   - beneficiary/housing/agriculture ليهم xmin مستقل تمامًا (الـ rowVersion
 *     في ردهم مش رقم الحالة)، والمرفقات مابتلمسش صف الحالة خالص.
 *
 * القاعدة: caseRowVersion بييجي من لحظة فتح الحالة (GET أو POST /cases)،
 * وبيتحدّث بس من ردود writes إحنا اللي عملناها. ممنوع نجيبه من السيرفر قبل
 * الحفظ أو ناخده من رد قسم singleton — ده بيخفي تعديلات مستخدم تاني ويخلي
 * الحفظ يكتب فوقها في صمت بدل ما السيرفر يرجّع 409.
 */
function sectionVersion(key) {
  return store.currentCase?.sectionVersions?.[key] ?? null;
}

const CONFLICT_SECTION_LABELS = {
  'family-members': 'أفراد الأسرة',
  utilities: 'المرافق والأجهزة',
  financial: 'الدخل والمصروفات',
  'initial-needs': 'الاحتياجات المبدئية',
  'assessed-needs': 'الاحتياجات',
  'support-recommendations': 'الدعم المقترح',
  'social-worker-assessment': 'رأي الباحث الاجتماعي',
  beneficiary: 'بيانات رب الأسرة',
  housing: 'السكن',
  agriculture: 'الحيازة الزراعية'
};

/** قيم details في الـ API دايمًا string[] — بنقبل كمان قيمة مفردة احتياطيًا. */
function firstDetail(err, key) {
  const v = err?.details?.[key];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * بعد 409 واختيار المستخدم الحفظ فوق التعديل التاني: ياخد الرقم الحالي من
 * details.currentVersion لو موجود (أقسام القوائم والـ workflow)، وإلا GET.
 */
async function refreshCaseRowVersion(caseId, err) {
  const fromDetails = parseInt(firstDetail(err, 'currentVersion'), 10);
  if (Number.isFinite(fromDetails)) {
    store.setSectionVersion('caseRowVersion', fromDetails);
    return;
  }
  const fresh = await CasesService.getById(caseId);
  store.setSectionVersion('caseRowVersion', fresh?.rowVersion);
}

// workflow.component.js بيسجّل هنا طريقة تصفير الاستمارة والرجوع لمرحلة —
// الاتنين closures جواه، وهو اللي بيستورد الملف ده (فمينفعش العكس).
let wizardControls = null;
export function registerWizardControls(controls) {
  wizardControls = controls;
}

/**
 * "تحميل آخر نسخة" بعد تعارض: تصفير الاستمارة ثم إعادة تحميل الحالة من
 * السيرفر، والرجوع لنفس المرحلة. بيحافظ على وضع إنشاء/تعديل زي ما كان.
 */
async function reloadCaseAfterConflict() {
  const caseId = currentCaseId();
  const wasEditMode = store.currentCase?.isEditMode === true;
  const step = parseInt(store.activeStage, 10) || 1;
  if (!caseId) return;

  wizardControls?.reset();
  const loaded = await loadCaseIntoForm(caseId);
  if (!loaded) return; // loadCaseIntoForm عرض رسالة الخطأ بنفسه
  if (!wasEditMode) store.setCurrentCase({ ...store.currentCase, isEditMode: false });
  wizardControls?.goToStep(step);
  showToast('تم تحميل آخر نسخة من الحالة — راجع البيانات وعدّل من جديد لو محتاج', 'info', 6000);
}

/** @returns {Promise<'reload'|'overwrite'|null>} */
async function askConflictResolution(err) {
  const section = CONFLICT_SECTION_LABELS[firstDetail(err, 'section')];
  const where = section ? ` (قسم: ${section})` : '';
  const choice = await choiceDialog({
    title: 'الحالة اتعدّلت من مستخدم تاني',
    message: `في حد تاني حفظ تعديلات على الحالة دي وأنت شغال${where}. `
      + 'لو حفظت بياناتك دلوقتي هتكتب فوق تعديلاته. '
      + 'الأأمن إنك تحمّل آخر نسخة وتراجعها، وبعدين تعدّل اللي محتاجه.',
    confirmLabel: 'تحميل آخر نسخة',
    secondaryLabel: 'حفظ بياناتي فوقها',
    cancelLabel: 'إلغاء'
  });
  if (choice === 'confirm') return 'reload';
  if (choice === 'secondary') return 'overwrite';
  return null;
}

/**
 * Runs an API call, shows a toast on failure, and re-throws so the caller
 * (workflow navigation) can keep the user on the current step instead of
 * advancing past an unsaved section.
 *
 * 409 CONCURRENCY_CONFLICT: بيسأل المستخدم — "تحميل آخر نسخة" (الافتراضي
 * الآمن)، أو "حفظ بياناتي فوقها" (قرار واعي: onConflict يحدّث أرقام النسخ
 * وبنعيد نفس الحفظ)، أو إلغاء (يفضل في مكانه من غير أي تغيير).
 * @param {Object} [opts]
 * @param {Function} [opts.onConflict] - (err) => refreshes the version tokens
 *   the save sends, before an explicit overwrite retry
 * @param {Function} [opts.onValidationDetails] - called with err.details on
 *   422 VALIDATION_ERROR when the server sends field-level details; must
 *   return a ready-to-show message string (or null/undefined to fall back
 *   to the generic message) — used to turn the specific invalid field red
 *   instead of just showing a generic toast (see applyStep1ServerValidationErrors).
 */
async function runSave(promiseFactory, opts = {}) {
  const { onConflict, onValidationDetails } = opts;
  try {
    return await promiseFactory();
  } catch (err) {
    if (err instanceof ApiError && err.code === 'CONCURRENCY_CONFLICT') {
      const decision = await askConflictResolution(err);
      if (decision === 'overwrite' && onConflict) {
        await onConflict(err);
        return runSave(promiseFactory, opts);
      }
      // مسار الإنشاء مالوش onConflict: إعادة تشغيله كانت هتبعت POST /cases
      // تاني وتعمل حالة مكررة — فالحفظ فوقها هنا بيتعامل زي تحميل آخر نسخة.
      if (decision === 'reload' || decision === 'overwrite') await reloadCaseAfterConflict();
      throw err;
    }
    let message = messageFromError(err);
    if (err instanceof ApiError && err.code === 'VALIDATION_ERROR' && err.details && onValidationDetails) {
      message = onValidationDetails(err.details) || message;
    }
    showToast(message, 'error');
    throw err;
  }
}

/* ---------------------------- Step 1 — Demographics ---------------------------- */

// كل حقول جسم PUT /cases/{id}/beneficiary (غير rowVersion).
const BENEFICIARY_PUT_FIELDS = [
  'fullName', 'phonePrimary', 'phoneSecondary', 'religion', 'education',
  'maritalStatus', 'healthStatus', 'employmentStatus', 'job', 'monthlyIncome',
  'takafulBeneficiary', 'takafulAmount', 'centerId', 'villageId', 'address',
  'headRelation', 'email', 'street', 'buildingNumber', 'floor',
  'apartmentNumber', 'landmark', 'area', 'employer'
];

/** يحفظ نسخة السيرفر من المستفيد (من GET /cases/{id} أو رد PUT /beneficiary). */
function rememberServerBeneficiary(beneficiary) {
  if (!beneficiary || !store.currentCase) return;
  store.setCurrentCase({ ...store.currentCase, beneficiary });
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * الجمعية المختارة في الفورم:
 *   - GUID جمعية حقيقية → الـ id.
 *   - «أخرى» → null (من غير جمعية مسجلة).
 *   - مفيش اختيار (القايمة لسه بتتحمّل أو فشلت) → undefined = ماتلمسش اللي على السيرفر.
 */
function selectedCharityId() {
  const value = val('referral-charity-select');
  if (GUID_RE.test(value)) return value;
  if (value === 'أخرى') return null;
  return undefined;
}

/**
 * PUT /cases/{id}/charity لو الجمعية المختارة غير اللي على السيرفر. بيتنادى
 * بعد باقي أقسام المرحلة الأولى عشان ياخد أحدث caseRowVersion.
 */
async function syncCaseCharity(caseId) {
  const chosen = selectedCharityId();
  if (chosen === undefined || chosen === (store.currentCase?.charityId ?? null)) return;
  const result = await CasesService.updateCharity(caseId, chosen, sectionVersion('caseRowVersion'));
  store.setCurrentCase({ ...store.currentCase, charityId: chosen });
  if (result?.caseRowVersion != null) {
    store.setSectionVersion('caseRowVersion', result.caseRowVersion);
  } else {
    // شكل الرد مش موثّق بالكامل — نقرا الرقم من السيرفر عشان أول PUT بعده مايرجّعش 409 وهمي.
    const fresh = await CasesService.getById(caseId);
    if (fresh?.rowVersion != null) store.setSectionVersion('caseRowVersion', fresh.rowVersion);
  }
}

/** المركز/القرية المختارين في الفورم (بالاسم) → الـ ids الحقيقية، أو null. */
function selectedLocationIds() {
  const centerName = val('referral-district-select');
  if (!centerName) return null;
  const ids = store.locationIds || { centers: {}, villages: {} };
  const centerId = (ids.centers || {})[centerName];
  if (!centerId) return null;
  const villageName = val('referral-village-select');
  const villageId = villageName ? ((ids.villages || {})[centerName] || {})[villageName] || null : null;
  return { centerId, villageId };
}

/**
 * جسم PUT /cases/{id}/beneficiary.
 *
 * الـ PUT استبدال كامل على السيرفر (مؤكَّد من الباك إند): أي خانة مابتتبعتش
 * أو بتتبعت فاضية بتتمسح. فالجسم بيبدأ من نسخة السيرفر الحالية
 * (store.currentCase.beneficiary — من GET /cases/{id} أو آخر رد PUT)، وفوقها
 * قيم الفورم **المليانة** بس:
 *   - خانات الفورم مابيعرضهاش (الحالة الصحية، الإيميل، تفاصيل العنوان...)
 *     بترجع زي ما هي بدل ما تتمسح.
 *   - خانة فاضية في الفورم ماتمسحش قيمة موجودة.
 *   - المركز/القرية: المختارين في الفورم لو فيه، وإلا اللي على السيرفر.
 */
function collectBeneficiaryPayload() {
  const server = store.currentCase?.beneficiary || {};
  const payload = {};
  BENEFICIARY_PUT_FIELDS.forEach(field => {
    payload[field] = server[field] ?? null;
  });

  const overlay = (field, value) => {
    if (value === null || value === undefined) return;
    if (typeof value === 'string' && value.trim() === '') return;
    payload[field] = value;
  };

  overlay('fullName', val('case-name'));
  overlay('phonePrimary', val('phone1'));
  overlay('phoneSecondary', val('phone2'));
  overlay('religion', val('religion'));
  overlay('education', val('education-level'));
  overlay('employmentStatus', val('work-type'));
  overlay('job', val('job-title'));
  overlay('monthlyIncome', num('head-monthly-income'));
  overlay('address', val('address'));
  overlay('headRelation', val('head-relation'));
  // الفورم مافيهوش حالة اجتماعية منفصلة — زمان كانت بتتملى من صلة القرابة.
  // بنسيب قيمة السيرفر لو موجودة، وبنحافظ على السلوك القديم للحالة الجديدة بس.
  if (!payload.maritalStatus) overlay('maritalStatus', val('head-relation'));

  const takaful = isChecked('head-takaful-karama');
  payload.takafulBeneficiary = takaful;
  payload.takafulAmount = takaful ? (num('head-takaful-amount') ?? server.takafulAmount ?? null) : null;

  const location = selectedLocationIds();
  if (location) {
    payload.centerId = location.centerId;
    payload.villageId = location.villageId;
  }

  // age/gender/birthGovernorate/nationalId intentionally omitted — server-derived
  // from nationalId (§19 Frontend Must NOT #1).
  return payload;
}

/**
 * يحوّل أفراد الأسرة من شكل الكارت المحلي (store.familyMembers، نفس بنية
 * card.dataset) إلى شكل PUT /cases/{id}/family-members — عكس تمامًا
 * mapMembersFromApi في case-edit.loader.js.
 */
function collectFamilyMembersPayload() {
  return (store.familyMembers || []).map(m => ({
    name: m.name || '',
    relation: m.relation || '',
    nationalId: m.idNum || null,
    age: m.age ? Number(m.age) : null,
    gender: m.gender || null,
    isStudent: m.isStudent === 'true' || m.isStudent === true,
    educationStage: m.stage || null,
    grade: m.grade || null,
    university: m.university || null,
    education: m.qualification || null,
    job: m.job && m.job !== 'غير محدد' ? m.job : null,
    monthlyIncome: m.income ? Number(m.income) : null,
    notes: m.notes || null,
    // فاضي لازم يتبعت "" (مش null) — الباك-إند بيفرّق بينهم فعليًا لـ diseases:
    // null/محذوف = سيبها زي ما هي، "" = امسحها فعليًا (راجع رد الباك-إند).
    diseases: m.diseases ?? '',
    takafulBeneficiary: m.takafulKarama === 'true' || m.takafulKarama === true,
    takafulAmount: m.takafulKaramaAmount ? Number(m.takafulKaramaAmount) : null
  }));
}

/**
 * جسم POST /cases (إنشاء الحالة) — **متداخل**، شكل مختلف تمامًا عن PUT
 * /beneficiary رغم تشابه أغلب الحقول. اتحقق منه فعليًا على السيرفر الحي:
 * جسم flat كان يرجّع 500 INTERNAL_ERROR بدل 422 — خطأ حقيقي كان هيوقف كل
 * مستخدم عند أول "التالي" في المرحلة الأولى.
 * @see WEB_API_DOCUMENTATION.md §"POST /api/v1/cases" (نموذج beneficiary/charityId/priority)
 */
function collectCreateCasePayload() {
  return {
    beneficiary: {
      fullName: val('case-name'),
      nationalId: val('national-id'),
      phonePrimary: val('phone1') || null,
      address: val('address') || null
    },
    charityId: selectedCharityId() ?? null,
    priority: 'medium'
    // لا age/gender/birthGovernorate/status — محسوبة سيرفر-سايد بالكامل.
  };
}

/**
 * تحقق اكتمال المرحلة الأولى قبل محاولة الحفظ — بنفس فلسفة
 * agriculture.component.js (تحذير أول مرة، وسماح بالمرور تاني مرة لو
 * المستخدم أصرّ). الاسم والرقم القومي هما الحقلان المعلّمان بـ * في الفورم،
 * وهما فعليًا NotEmpty عند السيرفر لإنشاء الحالة (POST /cases) — التحقق هنا
 * بيوفّر على المستخدم رحلة حفظ كاملة عشان يكتشف حقل ناقص كان يقدر يعرفه فورًا.
 * كل issue بيرجّع errEl (عنصر الرسالة المخصص تحت الحقل نفسه) عشان الخطأ
 * يبان "فين" بالظبط، مش بس رسالة عامة أعلى الكارت.
 * @returns {Array<{el: Element|null, errEl: Element|null, message: string}>}
 */
export function validateStep1() {
  const issues = [];

  if (val('case-name') === '') {
    issues.push({ el: DOM.qs('#case-name'), errEl: DOM.qs('#case-name-error'), message: 'من فضلك أدخل اسم رب الأسرة بالكامل.' });
  }

  const nationalId = val('national-id');
  if (nationalId === '') {
    issues.push({ el: DOM.qs('#national-id'), errEl: DOM.qs('#national-id-error'), message: 'من فضلك أدخل الرقم القومي لرب الأسرة.' });
  } else if (!parseEgyptianNationalId(nationalId).valid) {
    issues.push({ el: DOM.qs('#national-id'), errEl: DOM.qs('#national-id-error'), message: 'تأكد من الرقم القومي — لازم يكون 14 رقم صحيح.' });
  }

  return issues;
}

export function clearStep1Errors() {
  DOM.qsa('#step-pane-1 .field-invalid').forEach(el => el.classList.remove('field-invalid'));
  ['case-name-error', 'national-id-error'].forEach(id => {
    const el = DOM.qs(`#${id}`);
    if (el) el.style.display = 'none';
  });
}

export function highlightStep1Issues(issues) {
  clearStep1Errors();
  issues.forEach(issue => {
    if (issue.el) issue.el.classList.add('field-invalid');
    if (issue.errEl) {
      issue.errEl.textContent = issue.message;
      issue.errEl.style.display = 'block';
    }
  });
  const first = issues.find(i => i.el);
  if (first && first.el) {
    if (typeof first.el.focus === 'function') first.el.focus({ preventScroll: true });
    first.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// خريطة اسم الحقل عند السيرفر (details الراجعة مع 422 VALIDATION_ERROR) ->
// عنصر الفورم المقابل له + اسمه بالعربي. حالة الحروف عند السيرفر (camelCase
// أو PascalCase) مش موثقة بشكل قاطع، فبنطبّع المقارنة (نشيل غير الحروف
// ونخليها صغيرة) عشان نغطي الاحتمالين من غير ما نخمّن غلط.
const STEP1_SERVER_FIELD_MAP = {
  fullname: { elId: 'case-name', errElId: 'case-name-error', label: 'الاسم' },
  nationalid: { elId: 'national-id', errElId: 'national-id-error', label: 'الرقم القومي' },
  phoneprimary: { elId: 'phone1', label: 'الهاتف الأول' },
  phonesecondary: { elId: 'phone2', label: 'الهاتف الثاني' },
  address: { elId: 'address', label: 'العنوان' },
  religion: { elId: 'religion', label: 'الديانة' },
  education: { elId: 'education-level', label: 'المرحلة التعليمية' },
  maritalstatus: { elId: 'head-relation', label: 'صلة القرابة' },
  headrelation: { elId: 'head-relation', label: 'صلة القرابة' },
  employmentstatus: { elId: 'work-type', label: 'طبيعة العمل' },
  job: { elId: 'job-title', label: 'المسمى الوظيفي' },
  monthlyincome: { elId: 'head-monthly-income', label: 'الدخل الشهري' },
  takafulbeneficiary: { elId: 'head-takaful-karama', label: 'تكافل وكرامة' },
  takafulamount: { elId: 'head-takaful-amount', label: 'مبلغ تكافل وكرامة' }
};

function normalizeFieldKey(key) {
  return String(key || '').toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * لما السيرفر يرفض الحفظ بـ 422 VALIDATION_ERROR وفيه تفاصيل لكل حقل، بنلوّن
 * الحقل المسؤول فعليًا بالأحمر (مش بس toast عام)، وبنرجّع رسالة موحدة
 * لكل حقل باسمه عشان "فين الخطأ" يبقى واضح حتى لو مفيش عنصر رسالة مخصص له.
 * @param {Object} details - err.details من ApiError
 * @returns {string|null} رسالة جاهزة للـ toast تضم اسم كل حقل، أو null لو مفيش details صالحة
 */
export function applyStep1ServerValidationErrors(details) {
  if (!details || typeof details !== 'object') return null;

  const issues = [];
  const messageLines = [];

  Object.entries(details).forEach(([key, reasons]) => {
    if (!Array.isArray(reasons) || reasons.length === 0) return;
    const mapping = STEP1_SERVER_FIELD_MAP[normalizeFieldKey(key)];
    const text = reasons.join(' / ');
    messageLines.push(mapping ? `${mapping.label}: ${text}` : text);
    if (mapping) {
      issues.push({
        el: DOM.qs(`#${mapping.elId}`),
        errEl: mapping.errElId ? DOM.qs(`#${mapping.errElId}`) : null,
        message: text
      });
    }
  });

  if (issues.length > 0) highlightStep1Issues(issues);
  return messageLines.length > 0 ? messageLines.join(' — ') : null;
}

/**
 * Step 1's "التالي": create the case on first save, update the beneficiary
 * section on every save after that.
 *
 * أول حفظ فيه خطوتان دايمًا: POST /cases (بيقبل بس جزء ضيق من حقول
 * المرحلة الأولى — راجع collectCreateCasePayload)، وبعده فورًا PUT
 * /beneficiary بكل الحقول (الديانة، التعليم، صلة القرابة، طبيعة العمل،
 * المهنة، الدخل، تكافل وكرامة، الهاتف الثاني...). قبل كده كانت الخطوة
 * التانية دي بتتأجل لحد ما المستخدم يرجع يحفظ المرحلة الأولى تاني — يعني
 * لو حد كمّل الفورم كله من أول مرة وعدّى للمرحلة التانية على طول، كل
 * الحقول دي كانت بتضيع من غير ما حد يحس. دلوقتي بيتبعتوا مع بعض في نفس
 * ضغطة "التالي".
 * @returns {Promise<boolean>} true if saved successfully, false if the
 *   caller should stay on step 1 (validation/conflict already toasted).
 */
export async function saveStep1() {
  // store.currentCase بقى in-memory بس (مش متخزن في localStorage) — بيتصفّر
  // لوحده مع أي تحديث/فتح جديد للصفحة. الحارس ده لسه لازم داخل نفس الجلسة:
  // لو المستخدم سجّل حالة، وبعدين من غير ريفرش بدأ يكتب بيانات شخص تاني
  // تمامًا في المرحلة 1 (رقم قومي مختلف)، كنا هننده PUT /beneficiary على
  // الحالة الأولى (لحد لو بقت assigned بالفعل — السيرفر بيقبلها من غير تحقق
  // حالة) بدل ما ننشئ حالة جديدة، وده بيمسح بيانات الشخص الأول بصمت. فبنقارن
  // الرقم القومي المكتوب دلوقتي بالرقم اللي اتسجّلت بيه الحالة الحالية، ولو
  // مختلفين بنعتبرها حالة جديدة تمامًا.
  const typedNationalId = val('national-id');
  if (currentCaseId() && store.currentCase?.nationalId && store.currentCase.nationalId !== typedNationalId) {
    store.clearCurrentCase();
  }

  if (!currentCaseId()) {
    return runSave(async () => {
      const createPayload = collectCreateCasePayload();
      const created = await CasesService.create(createPayload);
      store.setCurrentCase({
        id: created.id,
        caseNumber: created.caseNumber,
        status: created.status,
        charityId: createPayload.charityId,
        // بنخزّن الرقم القومي اللي اتسجّلت بيه الحالة عشان نقدر نكتشف لو
        // المستخدم بدأ يكتب بيانات شخص مختلف تمامًا من غير ما نصفّر الحالة
        // القديمة (راجع التعليق فوق saveStep1).
        nationalId: val('national-id'),
        // POST /cases بيرجّع caseRowVersion (xmin الحالة فور الكتابة) — ده
        // مرجع التزامن لكل أقسام القوائم من هنا ورايح. caseRowVersion null
        // كان بيرجّع 400 فاضي من السيرفر، فلازم يتخزن فورًا.
        sectionVersions: { caseRowVersion: created.caseRowVersion ?? null }
      });
      // rowVersion بتاع beneficiary (عدّاد مستقل) مش في رد POST، فبنقراه
      // فورًا عشان أول PUT /beneficiary.
      const fresh = await CasesService.getById(created.id);
      store.setSectionVersion('beneficiary', fresh?.beneficiary?.rowVersion);
      rememberServerBeneficiary(fresh?.beneficiary);
      // الحالة لسه متعملة من لحظات ومفيش حد غيرنا يعرف رقمها، فرقمها الحالي من
      // GET هو الأصح: السيرفر ممكن يكتب على صف الحالة بعد ما يحسب
      // caseRowVersion الراجع من POST (مثلاً تسجيل المنشئ كمالك للحالة)، وساعتها
      // رقم POST كان بيخلي PUT family-members ترجّع 409 وهمي على حالة جديدة.
      // ده مختلف عن "ممنوع نجيبه قبل الحفظ" فوق — ده للحالات المفتوحة، اللي
      // ممكن مستخدم تاني يكون عدّل فيها فعلاً.
      if (fresh?.rowVersion != null) {
        store.setSectionVersion('caseRowVersion', fresh.rowVersion);
      }

      // إكمال باقي بيانات رب الأسرة فورًا في نفس الحفظة — لو فشلت الخطوة
      // دي (مثلاً تعارض إصدار نادر)، الحالة فعلاً اتسجلت بالفعل، فأي محاولة
      // "التالي" تانية هتاخد مسار التحديث تحت وتعيد المحاولة تلقائيًا.
      const updated = await CasesService.updateBeneficiary(created.id, {
        ...collectBeneficiaryPayload(),
        rowVersion: fresh?.beneficiary?.rowVersion
      });
      // عدّاد beneficiary بس — مابيلمسش caseRowVersion.
      store.setSectionVersion('beneficiary', updated?.rowVersion ?? fresh?.beneficiary?.rowVersion);
      rememberServerBeneficiary(updated);

      // الحالة لسه متعملة في نفس الضغطة ومفيش حد غيرنا يعرفها، فنقرا رقمها
      // تاني بعد PUT /beneficiary — دايمًا، حتى من غير أفراد أسرة: السيرفر بيزوّد
      // caseRowVersion مع كل حفظ قسم، والرقم القديم كان هيطلّع "حد تاني عدّل"
      // على أول قسم قوائم (المرافق) في حالة إحنا اللي لسه عاملينها.
      if (updated?.caseRowVersion != null) {
        store.setSectionVersion('caseRowVersion', updated.caseRowVersion);
      }
      const afterBeneficiary = await CasesService.getById(created.id);
      if (afterBeneficiary?.rowVersion != null) {
        store.setSectionVersion('caseRowVersion', afterBeneficiary.rowVersion);
      }

      if (store.familyMembers && store.familyMembers.length > 0) {
        const familyResult = await CasesService.updateFamilyMembers(
          created.id,
          collectFamilyMembersPayload(),
          sectionVersion('caseRowVersion')
        );
        store.setSectionVersion('caseRowVersion', familyResult?.caseRowVersion ?? sectionVersion('caseRowVersion'));
      }

      // مدة أطول من التوست العادي (6 ثانية بدل 3.2) — دي لحظة مهمة للمستخدم
      // (رقم الحالة بيظهر لأول مرة) وعايزينها تفضل ظاهرة وقت كافي يقرأها.
      showToast(`تم إنشاء الحالة رقم ${created.caseNumber} وحفظ بيانات رب الأسرة بنجاح 🎉`, 'success', 6000);
      return true;
    }, {
      onValidationDetails: applyStep1ServerValidationErrors
    }).then(() => true, () => false);
  }

  return runSave(async () => {
    const updated = await CasesService.updateBeneficiary(currentCaseId(), {
      ...collectBeneficiaryPayload(),
      rowVersion: sectionVersion('beneficiary')
    });
    // عدّاد beneficiary مستقل عن caseRowVersion (مؤكَّد من الباك إند) —
    // كتابة رقمه في caseRowVersion كانت سبب الـ 409 الوهمي زمان.
    store.setSectionVersion('beneficiary', updated?.rowVersion ?? sectionVersion('beneficiary'));
    // رد الـ PUT فيه المستفيد كامل — أساس الحفظ اللي بعده.
    rememberServerBeneficiary(updated);
    // الباك إند (2026-10-05) بيأكد إن PUT /beneficiary ممكن يزوّد caseRowVersion
    // ويرجّعه في الرد. لو رجع، هو رقمنا الجديد (من write إحنا عملناه، فمش بيخفي
    // تعديل حد تاني) — من غيره PUT family-members اللي بعده كان بيرجّع 409 وهمي.
    if (updated?.caseRowVersion != null) {
      store.setSectionVersion('caseRowVersion', updated.caseRowVersion);
    }

    // PUT family-members بيستبدل القائمة كلها على السيرفر، فلو الحالة مفتوحة
    // للتعديل من غير ما قائمتها الحقيقية تتجاب (case-edit.loader.js بيعلّم
    // familyLoaded)، إرسال store.familyMembers كان هيمسح أفراد الأسرة المسجلين.
    const cc = store.currentCase;
    if (!cc?.isEditMode || cc.familyLoaded === true) {
      const familyResult = await CasesService.updateFamilyMembers(
        currentCaseId(),
        collectFamilyMembersPayload(),
        sectionVersion('caseRowVersion')
      );
      store.setSectionVersion('caseRowVersion', familyResult?.caseRowVersion ?? sectionVersion('caseRowVersion'));
    }

    await syncCaseCharity(currentCaseId());

    showToast('تم حفظ بيانات رب الأسرة بنجاح ✅', 'success');
    return true;
  }, {
    onConflict: async () => {
      const fresh = await CasesService.getById(currentCaseId());
      store.setSectionVersion('beneficiary', fresh?.beneficiary?.rowVersion);
      store.setSectionVersion('caseRowVersion', fresh?.rowVersion);
      // "احفظ بياناتي فوقها": الخانات اللي الفورم مابيعرضهاش تاخد أحدث قيمة
      // على السيرفر، مش النسخة القديمة اللي اتفتحت بيها الحالة.
      rememberServerBeneficiary(fresh?.beneficiary);
      store.setCurrentCase({ ...store.currentCase, charityId: fresh?.charityId || null });
    },
    onValidationDetails: applyStep1ServerValidationErrors
  }).then(() => true, () => false);
}

/* ---------------------------- Step 2 — Attachments ---------------------------- */
// Uploads already happen immediately per-file when the user picks one
// (init -> PUT storage -> commit) — see wireAttachmentUpload() below.
// "التالي" on this step has nothing further to PUT; it just re-syncs the
// attachments list from the server so the preview matches reality.

export async function saveStep2() {
  const caseId = currentCaseId();
  if (!caseId) return true; // nothing to sync before the case exists
  return runSave(async () => {
    await AttachmentsService.listForCase(caseId);
    return true;
  }).then(() => true, () => false);
}

/**
 * Wires the file <input id="case-doc-upload"> to the real upload flow.
 * Call once during initWorkflowTabs(). Uploads fire on file selection, not
 * on "التالي" — attachments are independent records, not part of the case
 * row, so there is no reason to defer them.
 */
export function wireAttachmentUpload() {
  const input = DOM.qs('#case-doc-upload');
  const docTypeSelect = DOM.qs('#case-doc-type');
  if (!input) return;

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const caseId = currentCaseId();
    if (!caseId) {
      showToast('كمّل بيانات المرحلة الأولى واضغط "التالي" الأول، وبعدين ارفع المرفقات 📎', 'warning');
      input.value = '';
      return;
    }
    const documentType = docTypeSelect?.value || '';
    if (!documentType) {
      showToast('اختَر تصنيف المستند من القائمة فوق الأول، وبعدين ارفع الملف', 'warning');
      input.value = '';
      return;
    }

    try {
      showToast('جاري رفع الملف... ⏳', 'info');
      const committed = await AttachmentsService.upload({ caseId, documentType, file });
      addUploadedAttachmentRow({
        id: committed.attachmentId,
        fileName: committed.fileName || file.name,
        documentType,
        size: committed.fileSizeBytes ?? file.size
      });
      // جاهز لاختيار تصنيف جديد للملف اللي بعده — بعد نجاح الرفع بس.
      if (docTypeSelect) docTypeSelect.selectedIndex = 0;
      showToast('تم رفع المرفق بنجاح ✅', 'success');
      EventBusRefreshAttachments();
    } catch (err) {
      showToast(messageFromError(err), 'error');
    } finally {
      input.value = '';
    }
  });
}

// Kept as a small indirection point in case the attachments list UI needs a
// dedicated re-render hook wired in later — avoids a circular import with
// workflow.component.js for now.
function EventBusRefreshAttachments() {
  AttachmentsService.listForCase(currentCaseId()).catch(() => {});
}

/* ---------------------------- Step 3 — Housing ---------------------------- */

function chipValues(fieldName) {
  const field = DOM.qs(`.chip-field[data-field="${fieldName}"]`);
  if (!field) return [];
  return [...field.querySelectorAll('.chip-btn--active')].map(b => b.dataset.value).filter(Boolean);
}

function chipSingle(fieldName) {
  return chipValues(fieldName)[0] || null;
}

function chipHasValue(fieldName, value) {
  return chipValues(fieldName).includes(value);
}

function collectHousingPayload() {
  return {
    description: val('housing-description') || null,
    ownership: chipSingle('housingType'),
    buildingType: chipSingle('walls'),
    walls: chipSingle('walls'),
    roof: chipSingle('roof'),
    floor: chipSingle('floor'),
    entrance: chipSingle('entrance'),
    // ملحوظة API حقيقية (اتأكدت باختبار حي على السيرفر): roomsCount محتاج
    // يتبعت كنص، مش رقم — إرساله كـ number بيرجّع 400 فاضي بلا أي تفاصيل
    // validation (السيرفر بيرمي استثناء تحويل نوع قبل ما يوصل للـ validator).
    roomsCount: val('rooms-count') || null,
    bathroomCondition: chipSingle('bathroomCondition'),
    sanitation: chipSingle('bathroomCondition'),
    electricity: chipSingle('electricity'),
    water: chipSingle('waterMeter'),
    waterMotor: chipHasValue('waterMotor', 'يوجد'),
    transport: chipSingle('transportation'),
    internet: chipHasValue('internet', 'متوفر'),
    rowVersion: sectionVersion('housing')
  };
}

export async function saveStep3() {
  const caseId = currentCaseId();
  if (!caseId) {
    showToast('كمّل بيانات المرحلة الأولى (اسم ورقم قومي رب الأسرة) الأول، وبعدين ارجع هنا 🙏', 'warning');
    return false;
  }
  return runSave(async () => {
    const updated = await CasesService.updateHousing(caseId, collectHousingPayload());
    // xmin صف السكن بس — مابيلمسش caseRowVersion (مؤكَّد من الباك إند).
    store.setSectionVersion('housing', updated?.rowVersion);
    return true;
  }, {
    onConflict: async () => {
      const fresh = await CasesService.getById(caseId);
      store.setSectionVersion('housing', fresh?.housing?.rowVersion);
    }
  }).then(() => true, () => false);
}

/* ---------------------------- Step 4 — Utilities ---------------------------- */

// step4-utilities.html: each utility/appliance is its own chip-field (a
// single yes/no or condition chip), not one shared multi-select — unlike
// case-preview.js's older shared-'devices'/'appliances' field reading.
const UTILITY_CHIP_FIELDS = ['electricity', 'waterMeter', 'waterMotor'];
const APPLIANCE_CHIP_FIELDS = ['fridge', 'washer', 'oven', 'cookingAppliances', 'computer', 'tv', 'freezer'];

function collectUtilitiesPayload() {
  const appliances = APPLIANCE_CHIP_FIELDS.map(fieldName => ({
    applianceKey: fieldName,
    isPresent: chipValues(fieldName).length > 0
  }));

  const utilities = UTILITY_CHIP_FIELDS
    .map(fieldName => ({
      name: fieldName,
      isAvailable: chipValues(fieldName).length > 0,
      condition: chipSingle(fieldName)
    }))
    .filter(u => u.isAvailable || u.condition);

  // transportation/internet aren't appliances or metered utilities in the
  // API's two-list shape — surfaced as notes on the utilities list instead
  // of being dropped silently.
  const transport = chipSingle('transportation');
  if (transport) utilities.push({ name: 'transportation', isAvailable: true, condition: transport });
  if (chipHasValue('internet', 'متوفر')) utilities.push({ name: 'internet', isAvailable: true });

  return {
    appliances,
    utilities,
    caseRowVersion: sectionVersion('caseRowVersion')
  };
}

export async function saveStep4() {
  const caseId = currentCaseId();
  if (!caseId) {
    showToast('كمّل بيانات المرحلة الأولى (اسم ورقم قومي رب الأسرة) الأول، وبعدين ارجع هنا 🙏', 'warning');
    return false;
  }
  return runSave(async () => {
    const updated = await CasesService.updateUtilities(caseId, collectUtilitiesPayload());
    store.setSectionVersion('caseRowVersion', updated?.caseRowVersion ?? sectionVersion('caseRowVersion'));
    return true;
  }, {
    onConflict: (err) => refreshCaseRowVersion(caseId, err)
  }).then(() => true, () => false);
}

/* ---------------------------- Step 5 — Agriculture ---------------------------- */
// readAgricultureData() already lives in agriculture.component.js and is the
// single source of truth the validator also uses — reuse it rather than
// re-reading the DOM here.

export async function saveStep5(readAgricultureData) {
  const caseId = currentCaseId();
  if (!caseId) {
    showToast('كمّل بيانات المرحلة الأولى (اسم ورقم قومي رب الأسرة) الأول، وبعدين ارجع هنا 🙏', 'warning');
    return false;
  }
  const agri = readAgricultureData();
  const payload = {
    hasLand: agri.hasLand || 'unanswered',
    landType: agri.landType || null,
    landAreaFeddan: agri.landArea || null,
    landRentAmount: agri.landRentAmount || null,
    annualLandIncome: agri.landAnnualIncome || null,
    cropType: agri.cropType || null,
    hasLivestock: agri.hasLivestock || 'unanswered',
    selectedLivestock: agri.livestockTypes || [],
    livestockOther: agri.livestockOther || null,
    livestockDetails: agri.livestockDetails || null,
    notes: agri.notes || null
  };

  return runSave(async () => {
    // rowVersion جوه الـ factory — إعادة المحاولة بعد تعارض لازم تبعت الرقم الجديد.
    const updated = await CasesService.updateAgriculture(caseId, {
      ...payload,
      rowVersion: sectionVersion('agriculture')
    });
    store.setSectionVersion('agriculture', updated?.rowVersion);
    // Server may have nulled dependent fields per §12.4 — re-fetch so the
    // UI doesn't keep showing values the backend just discarded.
    // ممنوع ناخد fresh.rowVersion هنا: الزراعة مابتزوّدش caseRowVersion، فلو
    // الرقم اختلف يبقى مستخدم تاني عدّل قسم قوائم — أخده كان هيخفي تعديله.
    const fresh = await CasesService.getById(caseId);
    if (fresh?.agriculture) {
      store.setAgriculture({
        hasLand: fresh.agriculture.hasLand,
        landType: fresh.agriculture.landType,
        landArea: fresh.agriculture.landAreaFeddan,
        landRentAmount: fresh.agriculture.landRentAmount,
        landAnnualIncome: fresh.agriculture.annualLandIncome,
        cropType: fresh.agriculture.cropType,
        hasLivestock: fresh.agriculture.hasLivestock,
        livestockTypes: fresh.agriculture.selectedLivestock,
        livestockDetails: fresh.agriculture.livestockDetails,
        notes: fresh.agriculture.notes
      });
    }
    return true;
  }, {
    onConflict: async () => {
      const fresh = await CasesService.getById(caseId);
      store.setSectionVersion('agriculture', fresh?.agriculture?.rowVersion);
    }
  }).then(() => true, () => false);
}

/* ---------------------------- Step 6 — Financial ---------------------------- */

/**
 * بيانات مرحلة 6 مصدرها الحقيقي store.incomeItems/expenseItems — بيتحدّثوا
 * لحظيًا من financial-ledger.component.js (recalculateBudget ->
 * store.setFinancialItems) مع كل إضافة/حذف/تعديل. الكود القديم هنا كان
 * بيحاول يقرأ العناصر من selectors زي '#income-items-list .financial-item'
 * — دول مش موجودين خالص في الفورم الفعلي (الفورم الحقيقي بيستخدم
 * '#income-list-container'/'#expense-list-container' مع class member-card،
 * راجع financial-ledger.component.js) فكان دايمًا بيرجّع مصفوفة فاضية،
 * يعني الحفظ الفعلي للسيرفر كان بيبعت دخل/مصروفات صفر حتى لو المستخدم كتب
 * أرقام حقيقية على الشاشة. بنقرأ من الـ store مباشرة بدل ما نحاول نعيد قراءة
 * DOM بايت.
 */
function readIncomeRows() {
  return (store.incomeItems || []).map(item => ({
    label: item.type || '',
    amount: Number(item.amount) || 0,
    period: item.frequency || null
  })).filter(r => r.label);
}

function readExpenseRows() {
  return (store.expenseItems || []).map(item => ({
    label: item.type || '',
    amount: Number(item.amount) || 0,
    period: item.frequency || null
  })).filter(r => r.label);
}

// السيرفر بيقبل بالظبط الخمس فئات دي، بنصها الحرفي، لا أكتر ولا أقل —
// اتحقق منه فعليًا على السيرفر الحي (422 "يجب إدخال جميع بنود المصروفات
// الثابتة الخمسة، ولا يمكن إضافة تصنيفات أخرى"). الفورم (step6-financial.html
// #new-expense-type) بتسمح بـ 8 أنواع حرة + "أخرى" — فبنجمّع كل بند مُدخَل
// على أقرب فئة من الخمسة، وأي فئة متسجلتش بتتبعت بمبلغ صفر (السيرفر بيرفض
// أي مجموعة غير كاملة).
const FIXED_EXPENSE_CATEGORIES = [
  'الأكل والشرب',
  'المصروفات الدراسية',
  'الكهرباء، المياه، الغاز',
  'الإيجار',
  'القسط'
];

// نص الفورم (كما في new-expense-type) -> الفئة الثابتة المطابقة.
const EXPENSE_LABEL_TO_FIXED_CATEGORY = {
  'إيجار سكن': 'الإيجار',
  'فواتير مياه وكهرباء وغاز': 'الكهرباء، المياه، الغاز',
  'أكل وشرب وطعام': 'الأكل والشرب',
  'تعليم ومصروفات دراسية': 'المصروفات الدراسية',
  'علاج وأدوية': 'الأكل والشرب', // لا فئة طبية مستقلة عند السيرفر — أقرب تصنيف متاح
  'أقساط وقروض': 'القسط',
  'مواصلات': 'الإيجار', // لا فئة مواصلات مستقلة — تُجمَّع هنا مؤقتًا (راجع محتوى الفئات مع المنتج لو الظهور غير مقبول)
  'أخرى': 'القسط'
};

/**
 * يجمّع بنود المصروفات الحرة من الفورم إلى الخمس فئات الثابتة اللي السيرفر
 * بيفرضها بالضبط — كل بند بيتحول لأقرب فئة وقيمته تُجمع معها، وأي فئة
 * متسجلتش بتتبعت بصفر (السيرفر بيرفض مجموعة غير مكتملة).
 */
function collectFixedExpenseItems() {
  const rawRows = readExpenseRows();
  const totals = Object.fromEntries(FIXED_EXPENSE_CATEGORIES.map(c => [c, 0]));
  let period = 'شهري';

  rawRows.forEach(row => {
    const category = EXPENSE_LABEL_TO_FIXED_CATEGORY[row.label] || 'القسط';
    totals[category] += row.amount;
    if (row.period) period = row.period;
  });

  return FIXED_EXPENSE_CATEGORIES.map(category => ({
    category,
    amount: totals[category],
    period
  }));
}

/**
 * تحقق تنبيهي (مش إجباري) للمرحلة السادسة — الأسرة ممكن فعلاً معندهاش دخل
 * أو مصروفات متسجلة، فمابنمنعش المتابعة، بس بننبّه المستخدم لو نسي يسجّل
 * أي بند قبل ما يعدّي، بنفس فلسفة "تحذير مرة واحدة" المستخدمة في المرحلة 5.
 */
export function validateStep6() {
  const hasIncome = readIncomeRows().length > 0;
  const hasExpense = readExpenseRows().length > 0;
  if (hasIncome || hasExpense) return [];
  return [{
    el: null,
    message: 'لسه مفيش أي مصدر دخل أو مصروف متسجل للأسرة — لو الأسرة فعلاً معندهاش دخل سجّل ده، وإلا ضيف البنود الأول.'
  }];
}

export async function saveStep6() {
  const caseId = currentCaseId();
  if (!caseId) {
    showToast('كمّل بيانات المرحلة الأولى (اسم ورقم قومي رب الأسرة) الأول، وبعدين ارجع هنا 🙏', 'warning');
    return false;
  }
  const items = {
    incomeItems: readIncomeRows(),
    expenseItems: collectFixedExpenseItems()
  };

  return runSave(async () => {
    // caseRowVersion بيتقرا جوه الـ factory عشان إعادة المحاولة بعد "حفظ
    // بياناتي فوقها" تبعت الرقم الجديد مش القديم.
    const updated = await CasesService.updateFinancial(caseId, {
      ...items,
      caseRowVersion: sectionVersion('caseRowVersion')
    });
    store.setSectionVersion('caseRowVersion', updated?.caseRowVersion ?? sectionVersion('caseRowVersion'));
    return true;
  }, {
    onConflict: (err) => refreshCaseRowVersion(caseId, err)
  }).then(() => true, () => false);
}

/* ---------------------------- Step 7 — Support ---------------------------- */

// كل checkbox متعلّم عليه في تاب "الدعم" بيتحوّل لاحتياج مُقيَّم (assessed
// need) — القسم ده أصلاً بيمثّل احتياجات الأسرة، مش دعمًا منفصلاً، فبنبعته
// لـ PUT /cases/{id}/assessed-needs بدل support-recommendations (source/status
// اتشالوا من العقد، priorityLevel بقى optional — راجع رسالة الباك-إند).
function collectAssessedNeeds() {
  const checked = [...DOM.qsa('.support-type-checkbox:checked')];
  return checked.map(cb => {
    const tile = cb.closest('.support-type-tile');
    const needType = tile?.dataset.supportType || 'دعم';
    // بعض الاحتياجات ليها فئات فرعية (chip-btn جوه .support-type-tile__subs)
    // — مثال: "لحوم" -> "نص كيلو"/"كيلو". بناخد أول فئة مفعّلة لو موجودة.
    const category = tile?.querySelector('.support-type-tile__subs .chip-btn--active')?.dataset.value || null;
    return {
      needType,
      category,
      description: null,
      priorityLevel: 'متوسط',
      reason: null,
      notes: val('support-notes') || null
    };
  });
}

export async function saveStep7() {
  const caseId = currentCaseId();
  if (!caseId) {
    showToast('كمّل بيانات المرحلة الأولى (اسم ورقم قومي رب الأسرة) الأول، وبعدين ارجع هنا 🙏', 'warning');
    return false;
  }
  return runSave(async () => {
    const updated = await CasesService.updateAssessedNeeds(
      caseId,
      collectAssessedNeeds(),
      sectionVersion('caseRowVersion')
    );
    store.setSectionVersion('caseRowVersion', updated?.caseRowVersion ?? sectionVersion('caseRowVersion'));
    return true;
  }, {
    onConflict: (err) => refreshCaseRowVersion(caseId, err)
  }).then(() => true, () => false);
}

/* ---------------------------- Step 8 — Assessment ---------------------------- */

/**
 * §8: يحفظ رأي الباحث الاجتماعي (المرحلة 8) عبر PUT
 * /cases/{id}/opinions/social-worker-assessment — الرد بيرجّع الحالة الجديدة
 * (draft/pending_assignment -> pending_assignment) فبنحدّث store.currentCase
 * هنا زي ما بتعمل شاشة "إرسال لأخصائي" بعد assign، عشان أي UI تانية معتمدة
 * على status (زرار الإسناد، تسمية الحالة، ...) تتزامن فورًا من غير حاجة
 * لـ refresh يدوي.
 *
 * الرأي بالكامل اختياري (لو الحقلين فاضيين، الحالة برضه بتتحول لـ
 * pending_assignment من غير رأي مسجّل) — الاستثناء الوحيد اللي السيرفر
 * بيرفضه 422 هو detailedReport من غير briefOpinion، فبنمنعه هنا قبل الطلب.
 */
export async function saveStep8() {
  const caseId = currentCaseId();
  if (!caseId) {
    showToast('كمّل بيانات المرحلة الأولى (اسم ورقم قومي رب الأسرة) الأول، وبعدين ارجع هنا 🙏', 'warning');
    return false;
  }
  const briefOpinion = val('researcher-brief-opinion') || null;
  const detailedReport = val('researcher-opinion') || null;
  if (detailedReport && !briefOpinion) {
    showToast('اختار الرأي المختصر للباحث الاجتماعي الأول قبل كتابة التقرير التفصيلي 🙏', 'warning');
    return false;
  }
  return runSave(async () => {
    const updated = await CasesService.submitSocialWorkerAssessment(caseId, {
      briefOpinion,
      detailedReport,
      caseRowVersion: sectionVersion('caseRowVersion')
    });
    store.setSectionVersion('caseRowVersion', updated?.caseRowVersion ?? sectionVersion('caseRowVersion'));
    if (updated?.status) {
      store.setCurrentCase({ ...store.currentCase, status: updated.status });
    }
    return true;
  }, {
    onConflict: (err) => refreshCaseRowVersion(caseId, err)
  }).then(() => true, () => false);
}

/* ---------------------------- Dispatch table ---------------------------- */

/**
 * Step -> save function map, consumed by workflow.component.js's
 * "التالي" handler.
 */
export const STEP_SAVE_HANDLERS = {
  1: saveStep1,
  2: saveStep2,
  3: saveStep3,
  4: saveStep4,
  // 5 is wired specially in workflow.component.js (needs readAgricultureData)
  6: saveStep6,
  7: saveStep7,
  8: saveStep8
};
