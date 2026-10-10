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
import { AttachmentsService, MAX_ATTACHMENTS_PER_CASE, MAX_FILES_PER_PICK, maxFileSizeLabel, validateFile } from '../../services/attachments.service.js';
import { OTHER_DOCUMENT_TYPE } from '../../services/document-types.js';
import { ApiError, NetworkError, messageFromError } from '../../services/errors.js';
import { parseEgyptianNationalId, parseLocalizedFloat } from '../../utils/nationalId.js';
import { isValidEgyptianPhone, PHONE_ERROR_MESSAGE } from '../../utils/phone.js';
import { choiceDialog } from '../../utils/dialog.js';
import { briefOpinionDecision, fillAgricultureFromServer, loadCaseIntoForm } from './case-edit.loader.js';
import { collectSupportItems, getSupportValidationError } from '../support/support.component.js';
import { addUploadedAttachmentRow, attachmentRowCount, renderAttachmentList, renderAttachmentLoadError } from '../attachments/attachments.component.js';
import { memberClearableValues, memberFilledKeys } from '../family-members/family-members.component.js';

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
 * @param {Function} [opts.messageFor] - (err) => رسالة أدق لأي كود خطأ (مثلًا
 *   أخطاء أفراد الأسرة)، أو undefined. بتتشيّك قبل onValidationDetails.
 */
async function runSave(promiseFactory, opts = {}) {
  const { onConflict, onValidationDetails, messageFor } = opts;
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
    const custom = messageFor ? messageFor(err) : undefined;
    if (custom) {
      message = custom;
    } else if (err instanceof ApiError && err.code === 'VALIDATION_ERROR' && err.details && onValidationDetails) {
      message = onValidationDetails(err.details, err) || message;
    }
    showToast(message, 'error');
    throw err;
  }
}

/* ---------------------------- أفراد الأسرة: حفظ + تنبيه الدعم المحذوف ---------------------------- */

/**
 * الباك بيمسح صفوف الدعم المربوطة بفرد اتشال من القايمة ويرجّعها في
 * `removedSupport: [{ id, supportType, familyMemberId }]` — بنقول للمستخدم
 * عشان ماحدّش يتفاجئ إن الدعم اختفى.
 */
function notifyRemovedSupport(result) {
  const removed = Array.isArray(result?.removedSupport) ? result.removedSupport : [];
  if (!removed.length) return;
  const types = [...new Set(removed.map(r => r.supportType).filter(Boolean))];
  showToast(
    `اتحذف دعم كان مسجّل لأفراد اتشالوا من الأسرة${types.length ? `: ${types.join('، ')}` : ''} — راجع تاب الدعم 📝`,
    'warning',
    7000
  );
}

/** PUT /family-members بقايمة الشاشة (استبدال كامل) + تحديث الإصدار + تنبيه الدعم المحذوف. */
async function pushFamilyMembers(caseId) {
  const result = await CasesService.updateFamilyMembers(
    caseId,
    collectFamilyMembersPayload(),
    sectionVersion('caseRowVersion')
  );
  store.setSectionVersion('caseRowVersion', result?.caseRowVersion ?? sectionVersion('caseRowVersion'));
  notifyRemovedSupport(result);
}

const MEMBER_FIELD_LABELS = {
  name: 'الاسم',
  relation: 'صلة القرابة',
  nationalid: 'الرقم القومي',
  age: 'السن',
  gender: 'النوع',
  religion: 'الديانة',
  phone: 'رقم الهاتف',
  educationstage: 'المرحلة التعليمية',
  grade: 'الصف',
  university: 'الكلية / التخصص',
  education: 'المؤهل الدراسي',
  job: 'الوظيفة',
  monthlyincome: 'الدخل الشهري',
  takafulamount: 'مبلغ تكافل وكرامة',
  diseases: 'الأمراض',
  notes: 'الملاحظات'
};

/**
 * ترتيب الفرد واسم الخانة من تفاصيل خطأ PUT /family-members — الباك (2026-10-08
 * §6) بيبعتها بشكلين: `details.field = "members[2].id"` + `details.reason`، أو
 * مفتاح الخانة نفسه `"members[2].grade": ["..."]`.
 */
function memberErrorRef(details) {
  if (!details || typeof details !== 'object') return null;
  const pattern = /members\[(\d+)\]\.?(\w*)/i;
  const asList = v => (Array.isArray(v) ? v : v == null ? [] : [v]);
  for (const value of asList(details.field)) {
    const m = pattern.exec(String(value));
    if (m) return { index: Number(m[1]), field: m[2].toLowerCase(), message: null };
  }
  for (const [key, value] of Object.entries(details)) {
    const m = pattern.exec(key);
    if (m) return { index: Number(m[1]), field: m[2].toLowerCase(), message: asList(value)[0] || null };
  }
  return null;
}

/**
 * رسالة واضحة لرفض أفراد الأسرة بتسمّي الفرد والخانة (ترتيب الفرد في الطلب =
 * ترتيب store.familyMembers)، أو undefined لو الخطأ مش خاص بفرد.
 */
function familyMembersErrorMessage(err) {
  if (!(err instanceof ApiError)) return undefined;
  const ref = memberErrorRef(err.details);
  const reasonValue = err.details?.reason;
  const reason = Array.isArray(reasonValue) ? reasonValue[0] : reasonValue;
  const name = ref ? (store.familyMembers?.[ref.index]?.name || '').trim() : '';
  const who = name ? `الفرد «${name}»` : 'أحد الأفراد';

  if (err.code === 'DUPLICATE_NATIONAL_ID_IN_CASE') {
    return `الرقم القومي بتاع ${who} متكرر مع فرد تاني أو مع رب الأسرة — صلّحه وجرّب تاني`;
  }
  if (err.code !== 'VALIDATION_ERROR' || !ref) return undefined;
  if (reason === 'duplicate_in_request') {
    return `${who} متكرر في القايمة — احذف النسخة الزيادة وجرّب تاني`;
  }
  if (reason === 'id_belongs_to_other_case' || ref.field === 'id') {
    return `${who} متسجّل بمعرّف مستخدم في حالة تانية — احذفه من القايمة وضيفه تاني، وبعدين احفظ`;
  }
  const label = MEMBER_FIELD_LABELS[ref.field];
  const detail = ref.message && !/[A-Za-z]{3,}/.test(ref.message)
    ? ref.message
    : 'القيمة مش مقبولة (ممكن تكون أطول من المسموح)';
  return label ? `${who} — ${label}: ${detail}` : `${who}: ${detail}`;
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
 * الجمعية المختارة في الفورم: GUID جمعية حقيقية → الـ id، ومفيش اختيار →
 * undefined = ماتلمسش اللي على السيرفر (الحالة من غير جمعية = حالة خاصة).
 */
function selectedCharityId() {
  const value = val('referral-charity-select');
  return GUID_RE.test(value) ? value : undefined;
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
  return (store.familyMembers || []).map((m, index) => {
    // الباك إند (2026-10-08 §6): null = سيب القيمة القديمة، "" = امسحها. فالخانة
    // الفاضية بتتبعت "" لو كان فيها قيمة قبل كده (من السيرفر أو اتكتبت)، و null
    // لو فاضية من الأول — كده الفرد اللي بطّل يبقى طالب بتتمسح مرحلته وصفه وكليته.
    const values = memberClearableValues(m);
    const filled = memberFilledKeys(m);
    const clearable = key => values[key] || (filled.has(key) ? '' : null);
    return {
      id: m.memberId || undefined,
      name: m.name || '',
      relation: m.relation || '',
      nationalId: clearable('nationalId'),
      age: m.age ? Number(m.age) : null,
      gender: m.gender || null,
      religion: m.religion || null,
      isStudent: m.isStudent === 'true' || m.isStudent === true,
      // المرحلة والمؤهل استبدال كامل على السيرفر: الفاضي null (بيمسح) —
      // رد الباك إند 2026-10-10.
      educationStage: values.educationStage || null,
      grade: clearable('grade'),
      university: clearable('university'),
      education: values.education || null,
      job: clearable('job'),
      monthlyIncome: m.income ? Number(m.income) : null,
      phone: clearable('phone'),
      diseases: clearable('diseases'),
      notes: clearable('notes'),
      takafulBeneficiary: m.takafulKarama === 'true' || m.takafulKarama === true,
      takafulAmount: m.takafulKaramaAmount ? Number(m.takafulKaramaAmount) : null,
      // ترتيب القايمة (الأكبر سنًا فوق) — من 0.
      sortOrder: index
    };
  });
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

  // الهاتف اختياري، لكن لو اتكتب لازم يكون رقم مصري صحيح (موبايل/أرضي) —
  // نفس قاعدة تطبيق الموبايل.
  ['phone1', 'phone2'].forEach(id => {
    if (!isValidEgyptianPhone(val(id))) {
      issues.push({ el: DOM.qs(`#${id}`), errEl: DOM.qs(`#${id}-error`), message: PHONE_ERROR_MESSAGE });
    }
  });

  return issues;
}

export function clearStep1Errors() {
  DOM.qsa('#step-pane-1 .field-invalid').forEach(el => el.classList.remove('field-invalid'));
  ['case-name-error', 'national-id-error', 'phone1-error', 'phone2-error'].forEach(id => {
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
  phoneprimary: { elId: 'phone1', errElId: 'phone1-error', label: 'الهاتف الأول' },
  phonesecondary: { elId: 'phone2', errElId: 'phone2-error', label: 'الهاتف الثاني' },
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
        await pushFamilyMembers(created.id);
      }

      // مدة أطول من التوست العادي (6 ثانية بدل 3.2) — دي لحظة مهمة للمستخدم
      // (رقم الحالة بيظهر لأول مرة) وعايزينها تفضل ظاهرة وقت كافي يقرأها.
      showToast(`تم إنشاء الحالة رقم ${created.caseNumber} وحفظ بيانات رب الأسرة بنجاح 🎉`, 'success', 6000);
      return true;
    }, {
      messageFor: familyMembersErrorMessage,
      onValidationDetails: details => applyStep1ServerValidationErrors(details)
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
      await pushFamilyMembers(currentCaseId());
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
    messageFor: familyMembersErrorMessage,
    onValidationDetails: details => applyStep1ServerValidationErrors(details)
  }).then(() => true, () => false);
}

/* ---------------------------- Step 2 — Attachments ---------------------------- */
// Uploads already happen immediately per-file when the user picks one
// (init -> PUT storage -> commit) — see wireAttachmentUpload() below.
// "التالي" on this step has nothing further to PUT; it just re-syncs and
// re-renders the attachments list from the server so it matches reality.

export async function saveStep2() {
  const caseId = currentCaseId();
  if (!caseId) return true; // nothing to sync before the case exists
  // Nothing is saved here, so a failed refresh must not block "التالي" — the
  // list just says it couldn't load, with its own retry.
  const reload = () => AttachmentsService.listAllForCase(caseId);
  try {
    renderAttachmentList((await reload()).items);
  } catch (err) {
    renderAttachmentLoadError(err, reload);
  }
  return true;
}

// Errors that will hit every remaining file the same way — stop the batch
// instead of repeating the same failure up to 5 times.
const BATCH_STOPPING_CODES = new Set([
  'UNAUTHORIZED', 'TOKEN_EXPIRED', 'TOKEN_REVOKED', 'TOKEN_INVALID', 'FORBIDDEN',
  'CASE_NOT_ASSIGNED', 'CASE_NOT_FOUND', 'INVALID_STATUS_TRANSITION',
  'RATE_LIMITED', 'STORAGE_UNAVAILABLE', 'ATTACHMENT_LIMIT_REACHED'
]);

function stopsBatch(err) {
  return err instanceof NetworkError || (err instanceof ApiError && BATCH_STOPPING_CODES.has(err.code));
}

/**
 * Wires the file <input id="case-doc-upload"> to the real upload flow.
 * Call once during initWorkflowTabs(). Uploads fire on file selection, not
 * on "التالي" — attachments are independent records, not part of the case
 * row, so there is no reason to defer them.
 *
 * Up to 5 files per pick, all under the one selected type (product decision),
 * uploaded one after another (/init is rate-limited per user). One failed file
 * doesn't stop the rest. «أخرى» details go in `description`.
 */
export function wireAttachmentUpload() {
  const input = DOM.qs('#case-doc-upload');
  const docTypeSelect = DOM.qs('#case-doc-type');
  const descGroup = DOM.qs('#case-doc-description-group');
  const descInput = DOM.qs('#case-doc-description');
  if (!input) return;

  const syncDescription = () => {
    const isOther = docTypeSelect?.value === OTHER_DOCUMENT_TYPE;
    if (descGroup) descGroup.style.display = isOther ? '' : 'none';
    if (!isOther && descInput) descInput.value = '';
  };
  docTypeSelect?.addEventListener('change', syncDescription);
  syncDescription();

  let uploading = false;

  input.addEventListener('change', async () => {
    const picked = [...(input.files || [])];
    input.value = '';
    if (!picked.length) return;
    if (uploading) {
      showToast('استنى لما الرفع اللي شغال يخلص، وبعدين ارفع ملفات تانية', 'warning');
      return;
    }
    const caseId = currentCaseId();
    if (!caseId) {
      showToast('كمّل بيانات المرحلة الأولى واضغط "التالي" الأول، وبعدين ارفع المرفقات 📎', 'warning');
      return;
    }
    const documentType = docTypeSelect?.value || '';
    if (!documentType) {
      showToast('اختَر تصنيف المستند من القائمة فوق الأول، وبعدين ارفع الملف', 'warning');
      return;
    }
    const description = documentType === OTHER_DOCUMENT_TYPE ? (descInput?.value || '').trim() : '';

    const left = MAX_ATTACHMENTS_PER_CASE - attachmentRowCount();
    if (left <= 0) {
      showToast(`الحالة وصلت للحد الأقصى (${MAX_ATTACHMENTS_PER_CASE} مرفق). احذف مرفق مش محتاجه الأول.`, 'error');
      return;
    }
    const limit = Math.min(MAX_FILES_PER_PICK, left);
    const files = picked.slice(0, limit);
    if (picked.length > limit) {
      showToast(`اخترت ${picked.length} ملفات، وهنرفع أول ${limit} بس (ده الحد المسموح دلوقتي).`, 'warning');
    }

    // Reject bad files up front so the user hears about them right away.
    const errors = [];
    const valid = files.filter(file => {
      const invalid = validateFile(file);
      if (invalid) errors.push(`${file.name}: ${messageFromError(invalid)}`);
      return !invalid;
    });

    uploading = true;
    let uploaded = 0;
    let stoppedAt = -1;
    try {
      for (const [i, file] of valid.entries()) {
        showToast(valid.length > 1 ? `جاري رفع ${i + 1} من ${valid.length}... ⏳` : 'جاري رفع الملف... ⏳', 'info');
        try {
          const committed = await AttachmentsService.upload({ caseId, documentType, file, description });
          addUploadedAttachmentRow({
            id: committed.attachmentId,
            fileName: committed.fileName || file.name,
            documentType,
            description: description || undefined,
            mimeType: committed.mimeType || file.type,
            status: 'complete',
            scanStatus: committed.scanStatus,
            uploadedAtUtc: committed.uploadedAtUtc,
            size: committed.fileSizeBytes ?? file.size
          });
          uploaded++;
        } catch (err) {
          errors.push(`${file.name}: ${messageFromError(err)}`);
          if (stopsBatch(err)) {
            stoppedAt = i;
            break;
          }
        }
      }
    } finally {
      uploading = false;
      // الحد بيتحدّث من رد السيرفر — النص اللي تحت خانة الرفع يفضل مطابق.
      const sizeLimitEl = DOM.qs('#case-doc-size-limit');
      if (sizeLimitEl) sizeLimitEl.textContent = maxFileSizeLabel();
    }
    const skipped = stoppedAt >= 0 ? valid.length - stoppedAt - 1 : 0;
    if (skipped > 0) errors.push(`ووقفنا الرفع، فـ${skipped} ملف تاني ما اترفعش — جرّب ترفعهم تاني`);

    if (uploaded > 0) {
      // جاهز لاختيار تصنيف جديد للملفات اللي بعدها — بعد نجاح الرفع بس.
      if (docTypeSelect) {
        docTypeSelect.selectedIndex = 0;
        docTypeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    const total = files.length;
    if (!errors.length) {
      showToast(total > 1 ? `تم رفع ${total} مرفقات بنجاح ✅` : 'تم رفع المرفق بنجاح ✅', 'success');
    } else if (total === 1) {
      showToast(errors[0].slice(errors[0].indexOf(': ') + 2), 'error');
    } else if (uploaded === 0) {
      showToast(`ما اترفعش ولا ملف. ${errors.join(' — ')}`, 'error');
    } else {
      showToast(`اترفع ${uploaded} من ${total}. ${errors.join(' — ')}`, 'error');
    }
  });
}

/* ---------------------------- Step 3 — Housing ---------------------------- */

function chipValues(fieldName) {
  const field = DOM.qs(`.chip-field[data-field="${fieldName}"]`);
  if (!field) return [];
  return [...field.querySelectorAll('.chip-btn--active')].map(b => b.dataset.value).filter(Boolean);
}

/**
 * القيمة الواحدة اللي بتتبعت للخانة: الاختيار، أو النص المكتوب لو «أخرى»
 * (كانت بتبعت كلمة «أخرى» نفسها والنص بيضيع).
 */
function chipSingle(fieldName) {
  const value = chipValues(fieldName)[0];
  if (!value) return null;
  if (value !== 'أخرى') return value;
  const other = DOM.qs(`.chip-field[data-field="${fieldName}"] .chip-field__other`);
  return other?.value.trim() || null;
}

function chipHasValue(fieldName, value) {
  return chipValues(fieldName).includes(value);
}

/*
 * خطوة السكن فيها خانات السكن والمرافق والأجهزة مع بعض، والحفظ بيبعت طلبين
 * بالترتيب: PUT /housing وبعده PUT /utilities (رد الباك إند 2026-10-08 §8).
 * الكهرباء/المياه/الموتور/المواصلات/الإنترنت بتتبعت كمان في السكن (مكانها
 * القديم) — PUT /housing استبدال كامل، فلو بطّلنا نبعتها هناك القديم يتمسح.
 * الغاز في السكن `gas` (رد الباك إند 2026-10-10): null = سيب القيمة القديمة.
 *
 * لازم يفضل مطابق للموبايل: lib/features/case_details/data/mappers/housing_mapper.dart
 */
/*
 * «طبيعة دورات المياه» و«موتور المياه» اتشالوا من الشاشة (قرار المنتج: مكررين
 * مع «حالة دورات المياه» و«عداد المياه») — بنبعت قيمتهم اللي على السيرفر زي
 * ما هي، عشان الاستبدال الكامل مايمسحهاش.
 */
function serverHousing() {
  return store.currentCase?.housing || {};
}

function serverUtility(name) {
  return (store.currentCase?.utilities?.utilities || []).find(u => u?.name === name) || null;
}

function collectHousingPayload() {
  return {
    description: val('housing-description') || null,
    ownership: chipSingle('housingType'),
    buildingType: chipSingle('buildingType'),
    walls: chipSingle('walls'),
    roof: chipSingle('roof'),
    floor: chipSingle('floor'),
    entrance: chipSingle('entrance'),
    // ملحوظة API حقيقية (اتأكدت باختبار حي على السيرفر): roomsCount محتاج
    // يتبعت كنص، مش رقم — إرساله كـ number بيرجّع 400 فاضي بلا أي تفاصيل
    // validation (السيرفر بيرمي استثناء تحويل نوع قبل ما يوصل للـ validator).
    roomsCount: chipSingle('roomsCount'),
    bathroomType: serverHousing().bathroomType ?? null,
    bathroomCondition: chipSingle('bathroomCondition'),
    sanitation: chipSingle('sanitation'),
    electricity: chipSingle('electricity'),
    water: chipSingle('waterMeter'),
    gas: chipSingle('gas'),
    waterMotor: Boolean(serverHousing().waterMotor),
    transport: chipSingle('transportation'),
    internet: chipHasValue('internet', 'يوجد'),
    rowVersion: sectionVersion('housing')
  };
}

async function saveHousing() {
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

/* ------------------ Step 3 (تكملة) — Utilities & appliances ------------------ */

// الأجهزة: data-field ← applianceKey (نفس الاسم). المرافق: data-field ← name.
const APPLIANCE_CHIP_FIELDS = ['fridge', 'washer', 'oven', 'cookingAppliances', 'computer', 'tv', 'freezer'];
const UTILITY_CHIP_FIELDS = {
  electricity: 'electricity',
  waterMeter: 'water',
  transportation: 'transportation',
  internet: 'internet'
};
const NONE_VALUE = 'لا يوجد';
const YES_VALUE = 'يوجد';

/**
 * الخانة اللي محدش اختار فيها حاجة ما بتتبعتش (رد الباك إند §8.1).
 * - جهاز: «لا يوجد» ← isPresent:false. «يوجد» ← true. أي نوع تاني (عادية،
 *   شاشة...) أو نص «أخرى» ← true + details.
 * - مرفق: «لا يوجد» ← isAvailable:false. «يوجد» ← true. أي قيمة تانية (عداد،
 *   ممارسة، سيارة...) ← true + sourceOrMeter (زي أمثلة الباك إند).
 */
function collectUtilitiesPayload() {
  const appliances = [];
  APPLIANCE_CHIP_FIELDS.forEach(fieldName => {
    const value = chipSingle(fieldName);
    if (!value) return;
    appliances.push({
      applianceKey: fieldName,
      isPresent: value !== NONE_VALUE,
      details: value === NONE_VALUE || value === YES_VALUE ? null : value
    });
  });

  const utilities = [];
  Object.entries(UTILITY_CHIP_FIELDS).forEach(([fieldName, name]) => {
    const value = chipSingle(fieldName);
    if (!value) return;
    utilities.push({
      name,
      isAvailable: value !== NONE_VALUE,
      condition: null,
      sourceOrMeter: value === NONE_VALUE || value === YES_VALUE ? null : value,
      notes: null
    });
  });

  // موتور المياه مش معروض — بيتبعت زي ما هو على السيرفر لو موجود.
  const waterMotor = serverUtility('waterMotor');
  if (waterMotor) {
    const { name, isAvailable, condition, sourceOrMeter, notes } = waterMotor;
    utilities.push({ name, isAvailable, condition, sourceOrMeter, notes });
  }

  return {
    appliances,
    utilities,
    caseRowVersion: sectionVersion('caseRowVersion')
  };
}

async function saveUtilities() {
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

/**
 * مرحلة السكن فيها خانات السكن والمرافق والأجهزة مع بعض — نفس الطلبين زي
 * الأول (PUT /housing ثم PUT /utilities)، بالترتيب ده زي ما الباك إند طلب
 * (رد 2026-10-08 §8.8). فشل السكن بيوقف المرافق.
 */
export async function saveStep3() {
  if (!(await saveHousing())) return false;
  return saveUtilities();
}

/* ---------------------------- Step 4 — Agriculture ---------------------------- */
// readAgricultureData() already lives in agriculture.component.js and is the
// single source of truth the validator also uses — reuse it rather than
// re-reading the DOM here.

export async function saveStep4(readAgricultureData) {
  const caseId = currentCaseId();
  if (!caseId) {
    showToast('كمّل بيانات المرحلة الأولى (اسم ورقم قومي رب الأسرة) الأول، وبعدين ارجع هنا 🙏', 'warning');
    return false;
  }
  const agri = readAgricultureData();
  // readAgricultureData بيرجّع الأرقام نصوص بمفاتيح area/rentAmount/annualIncome
  // — السيرفر عايزها number أو null (الفاضي/غير الصالح = null، والصفر صفر).
  const num = (v) => {
    const n = parseLocalizedFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  const payload = {
    hasLand: agri.hasLand || 'unanswered',
    landType: agri.landType || null,
    landAreaFeddan: num(agri.area),
    landRentAmount: num(agri.rentAmount),
    annualLandIncome: num(agri.annualIncome),
    hasLivestock: agri.hasLivestock || 'unanswered',
    selectedLivestock: agri.livestockTypes || [],
    // الحقول النصية الفاضية بتتبعت "" (زي الموبايل) — مش null.
    livestockOther: agri.livestockOther || '',
    livestockDetails: agri.livestockDetails || '',
    notes: agri.notes || ''
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
    // نفس شكل/مفاتيح readAgricultureData (area/rentAmount/annualIncome...)
    // عشان الاستعادة ومرحلة الدخل والمصروفات يقروها صح.
    const fresh = await CasesService.getById(caseId);
    if (fresh?.agriculture) fillAgricultureFromServer(fresh.agriculture);
    return true;
  }, {
    onConflict: async () => {
      const fresh = await CasesService.getById(caseId);
      store.setSectionVersion('agriculture', fresh?.agriculture?.rowVersion);
    }
  }).then(() => true, () => false);
}

/* ---------------------------- Step 5 — Financial ---------------------------- */

/**
 * بيانات مرحلة 5 مصدرها الحقيقي store.incomeItems/expenseItems — بيتحدّثوا
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
// بنود الأرض الآلية (دخل الأرض الشهري ومصروف إيجار الأرض) — السيرفر بيحسبها
// بنفسه من PUT /agriculture (API ref §8.10: «do NOT send these»)، فمابنبعتهاش
// زي الموبايل. من غير الفلتر ده الدخل كان بيتبعت بند يدوي زيادة، والإيجار
// كان بيتجمّع على فئة «القسط».
const LAND_AUTO_SOURCE_IDS = new Set(['agri-annual-income', 'agri-rent-amount']);
const isLandAutoItem = item => LAND_AUTO_SOURCE_IDS.has(item.sourceId);

function readIncomeRows() {
  return (store.incomeItems || []).filter(item => !isLandAutoItem(item)).map(item => ({
    label: item.type || '',
    amount: Number(item.amount) || 0,
    period: item.frequency || null
  })).filter(r => r.label);
}

function readExpenseRows() {
  return (store.expenseItems || []).filter(item => !isLandAutoItem(item)).map(item => ({
    label: item.type || '',
    amount: Number(item.amount) || 0,
    period: item.frequency || null
  })).filter(r => r.label);
}

// السيرفر بيقبل بالظبط الخمس فئات دي، بنصها الحرفي، لا أكتر ولا أقل —
// اتحقق منه فعليًا على السيرفر الحي (422 "يجب إدخال جميع بنود المصروفات
// الثابتة الخمسة، ولا يمكن إضافة تصنيفات أخرى"). الفورم (step5-financial.html
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
 * تحقق تنبيهي (مش إجباري) للمرحلة الخامسة — الأسرة ممكن فعلاً معندهاش دخل
 * أو مصروفات متسجلة، فمابنمنعش المتابعة، بس بننبّه المستخدم لو نسي يسجّل
 * أي بند قبل ما يعدّي، بنفس فلسفة "تحذير مرة واحدة" المستخدمة في المرحلة 4.
 */
export function validateStep5() {
  const hasIncome = readIncomeRows().length > 0;
  const hasExpense = readExpenseRows().length > 0;
  if (hasIncome || hasExpense) return [];
  return [{
    el: null,
    message: 'لسه مفيش أي مصدر دخل أو مصروف متسجل للأسرة — لو الأسرة فعلاً معندهاش دخل سجّل ده، وإلا ضيف البنود الأول.'
  }];
}

export async function saveStep5() {
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

/* ---------------------------- Step 6 — Support ---------------------------- */

// تاب "الدعم" بيتحفظ في support-recommendations (assessed-needs اتقفل 410):
// صف لكل (نوع دعم × مستلم) — المستلم رب الأسرة/فرد/الأسرة كلها.
const SUPPORT_MEMBERS_FIRST_MESSAGE =
  'فيه فرد مختار في الدعم لسه مش محفوظ — احفظ تاب الأفراد الأول (اضغط «التالي» من المرحلة الأولى) وبعدين ارجع احفظ الدعم 🙏';

/** 422 «الفرد المحدد غير موجود في هذه الحالة» من PUT /support-recommendations. */
function isMissingMemberError(err) {
  if (!(err instanceof ApiError) || err.code !== 'VALIDATION_ERROR') return false;
  const keys = err.details ? Object.keys(err.details) : [];
  return keys.some(k => /familyMemberId/i.test(k)) || /الفرد المحدد غير موجود/.test(err.message || '');
}

export async function saveStep6() {
  const caseId = currentCaseId();
  if (!caseId) {
    showToast('كمّل بيانات المرحلة الأولى (اسم ورقم قومي رب الأسرة) الأول، وبعدين ارجع هنا 🙏', 'warning');
    return false;
  }
  const invalid = getSupportValidationError();
  if (invalid) {
    showToast(invalid, 'warning');
    return false;
  }

  // مفيش ولا نوع مختار: مابنبعتش حاجة، فالدعم المحفوظ قبل كده بيفضل زي ما هو
  // (نفس الموبايل) — قايمة فاضية في PUT كانت بتمسحه كله.
  if (collectSupportItems().length === 0) {
    showToast('مفيش نوع دعم مختار — الدعم المحفوظ قبل كده (لو موجود) هيفضل زي ما هو', 'info');
    return true;
  }

  // caseRowVersion بيتقرا جوه كل محاولة عشان إعادة المحاولة (بعد حفظ الأفراد
  // أو بعد "حفظ بياناتي فوقها") تبعت الرقم الجديد مش القديم.
  const putSupport = async () => {
    const updated = await CasesService.updateSupportRecommendations(
      caseId,
      collectSupportItems(),
      sectionVersion('caseRowVersion')
    );
    store.setSectionVersion('caseRowVersion', updated?.caseRowVersion ?? sectionVersion('caseRowVersion'));
    return true;
  };

  return runSave(async () => {
    try {
      return await putSupport();
    } catch (err) {
      if (!isMissingMemberError(err)) throw err;
      // فرد جديد اتضاف واتختار في الدعم من غير ما تاب الأفراد يتحفظ. نحفظ
      // الأفراد ونعيد المرة دي بس — وبس لو قايمتهم اتجابت فعلًا من السيرفر
      // (PUT family-members استبدال كامل، فقايمة ناقصة كانت هتمسح أفراد حقيقيين).
      const cc = store.currentCase;
      if (cc?.isEditMode && cc.familyLoaded !== true) throw err;
      try {
        await pushFamilyMembers(caseId);
      } catch (memberErr) {
        // رفض خاص بفرد (رقم قومي متكرر، خانة طويلة...) أوضح من «احفظ الأفراد الأول».
        throw familyMembersErrorMessage(memberErr) ? memberErr : err;
      }
      return putSupport();
    }
  }, {
    onConflict: (err) => refreshCaseRowVersion(caseId, err),
    messageFor: familyMembersErrorMessage,
    onValidationDetails: (details, err) => (isMissingMemberError(err) ? SUPPORT_MEMBERS_FIRST_MESSAGE : undefined)
  }).then(() => true, () => false);
}

/* ---------------------------- Step 7 — Assessment ---------------------------- */

/**
 * §8: يحفظ رأي الباحث الاجتماعي (المرحلة 7) عبر PUT
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
export async function saveStep7() {
  const caseId = currentCaseId();
  if (!caseId) {
    showToast('كمّل بيانات المرحلة الأولى (اسم ورقم قومي رب الأسرة) الأول، وبعدين ارجع هنا 🙏', 'warning');
    return false;
  }
  let briefOpinion = val('researcher-brief-opinion') || null;
  let detailedReport = val('researcher-opinion') || null;
  if (detailedReport && !briefOpinion) {
    showToast('اختار الرأي المختصر للباحث الاجتماعي الأول قبل كتابة التقرير التفصيلي 🙏', 'warning');
    return false;
  }
  // الرأي المحمّل في التعديل (case-edit.loader.js) ماتغيّرش ← نبعت الحقلين فاضيين:
  // السيرفر بيسيب الرأي القديم زي ما هو، بدل نسخة مكررة في workerHistory.
  const loaded = store.currentCase?.workerOpinion;
  if (loaded && briefOpinionDecision(briefOpinion) === loaded.decision &&
      (detailedReport || null) === (loaded.notes || null)) {
    briefOpinion = null;
    detailedReport = null;
  }
  return runSave(async () => {
    const updated = await CasesService.submitSocialWorkerAssessment(caseId, {
      briefOpinion,
      detailedReport,
      caseRowVersion: sectionVersion('caseRowVersion')
    });
    store.setSectionVersion('caseRowVersion', updated?.caseRowVersion ?? sectionVersion('caseRowVersion'));
    const workerOpinion = briefOpinion
      ? { decision: briefOpinionDecision(briefOpinion), notes: detailedReport }
      : store.currentCase?.workerOpinion ?? null;
    store.setCurrentCase({ ...store.currentCase, workerOpinion, ...(updated?.status ? { status: updated.status } : {}) });
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
  // 4 is wired specially in workflow.component.js (needs readAgricultureData)
  5: saveStep5,
  6: saveStep6,
  7: saveStep7
};
