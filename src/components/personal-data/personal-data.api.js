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

/** Resolves a center/village display name to its server GUID via the map store.js builds from GET /locations. */
function resolveLocationIds(centerName, villageName) {
  const ids = store.locationIds;
  const centerId = ids.centers?.[centerName] || null;
  const villageId = ids.villages?.[centerName]?.[villageName] || null;
  return { centerId, villageId };
}

/**
 * حارس قبل الإرسال: المركز والقرية اختياريان فعليًا عند السيرفر (تم تأكيده مع
 * الباك إند — centerId/villageId بقوا nullable في POST /cases وPUT
 * /beneficiary، وإرسالهم null بيمر عادي؛ الإجباري الوحيد فعليًا هو fullName
 * وnationalId، راجع validateStep1).
 *
 * الحارس ده بيغطي حالة مختلفة تمامًا: المستخدم اختار اسم مركز/قرية من
 * القائمة فعلاً لكنهم مش موجودين في خريطة store.locationIds (يعني القرية دي
 * مسجّلة بالاسم في الفورم لكن مش موجودة فعليًا في بيانات المواقع اللي
 * السيرفر رجّعها من GET /locations) — ده خطأ بيانات حقيقي محتاج تدخل يدوي
 * (إضافة القرية من "إدارة المواقع")، مش مجرد حقل فاضي، وبالتالي مفيش داعي
 * نتعب المستخدم برحلة حفظ كاملة عشان يكتشفه.
 *
 * لو المستخدم سايب الحقلين فاضيين تمامًا، الطلب بيعدي زي ما هو (centerId/
 * villageId: null) والسيرفر بيقبله عادي.
 */
function requireLocationIds(centerId, villageId, centerName, villageName) {
  if (!centerName || !villageName) return true;
  if (centerId && villageId) return true;

  showToast(
    `"${villageName}" (${centerName}) لسه مش مسجّلة في بيانات المواقع على النظام — ` +
    'لازم تتضاف الأول من شاشة "إدارة المواقع"، أو اختَر قرية تانية مسجّلة بالفعل، أو سيب الحقلين فاضيين وكمّلهم بعدين.',
    'warning'
  );
  return false;
}

function currentCaseId() {
  return store.currentCase?.id || null;
}

/**
 * يضمن وجود caseRowVersion قبل أي PUT من نوع "قوائم" (utilities/financial/
 * support-recommendations) — الحقل uint غير nullable عند السيرفر، وإرساله
 * null بيرجّع 400 فاضي تمامًا (نفس عائلة باگ centerId/villageId/roomsCount،
 * اتأكد فعليًا على السيرفر الحي). بيحصل عمليًا لو المستخدم قفز لمرحلة
 * "قائمة" (زي step4) مباشرة بعد step1 من غير ما يعدّي على قسم حدّث
 * caseRowVersion قبل كده.
 *
 * خلافًا لحارس المواقع (اللي بيوقف المستخدم لأن الحل يدوي)، هنا الاسترجاع
 * تلقائي بالكامل — مجرد GET /cases/{id} طازة — فمفيش داعي نزعج المستخدم.
 */
async function ensureCaseRowVersion(caseId) {
  if (sectionVersion('caseRowVersion') != null) return;
  const fresh = await CasesService.getById(caseId);
  store.setSectionVersion('caseRowVersion', fresh?.rowVersion);
}

function sectionVersion(key) {
  return store.currentCase?.sectionVersions?.[key] ?? null;
}

/**
 * Runs an API call, shows a toast on failure, and re-throws so the caller
 * (workflow navigation) can keep the user on the current step instead of
 * advancing past an unsaved section.
 * @param {Object} [opts]
 * @param {Function} [opts.onConflict] - called on 409 CONCURRENCY_CONFLICT
 * @param {Function} [opts.onValidationDetails] - called with err.details on
 *   422 VALIDATION_ERROR when the server sends field-level details; must
 *   return a ready-to-show message string (or null/undefined to fall back
 *   to the generic message) — used to turn the specific invalid field red
 *   instead of just showing a generic toast (see applyStep1ServerValidationErrors).
 */
async function runSave(promiseFactory, { onConflict, onValidationDetails } = {}) {
  try {
    return await promiseFactory();
  } catch (err) {
    if (err instanceof ApiError && err.code === 'CONCURRENCY_CONFLICT' && onConflict) {
      await onConflict();
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

/**
 * حقول قسم المستفيد (PUT /cases/{id}/beneficiary) — flat، موثقة في §12.3
 * ومُتحقّق منها فعليًا على السيرفر الحي. تُستخدم لتحديث حالة موجودة بالفعل.
 */
function collectBeneficiaryPayload() {
  const { centerId, villageId } = resolveLocationIds(val('district'), val('village'));
  return {
    fullName: val('case-name'),
    phonePrimary: val('phone1'),
    phoneSecondary: val('phone2') || null,
    religion: val('religion'),
    education: val('education-level'),
    maritalStatus: val('head-relation'),
    healthStatus: '',
    employmentStatus: val('work-type'),
    job: val('job-title') || null,
    monthlyIncome: num('head-monthly-income'),
    takafulBeneficiary: isChecked('head-takaful-karama'),
    takafulAmount: isChecked('head-takaful-karama') ? num('head-takaful-amount') : null,
    centerId,
    villageId,
    address: val('address'),
    headRelation: val('head-relation')
    // age/gender/birthGovernorate intentionally omitted — server-derived
    // from nationalId (§19 Frontend Must NOT #1).
  };
}

/**
 * جسم POST /cases (إنشاء الحالة) — **متداخل**، شكل مختلف تمامًا عن PUT
 * /beneficiary رغم تشابه أغلب الحقول. اتحقق منه فعليًا على السيرفر الحي:
 * جسم flat كان يرجّع 500 INTERNAL_ERROR بدل 422 — خطأ حقيقي كان هيوقف كل
 * مستخدم عند أول "التالي" في المرحلة الأولى.
 * @see WEB_API_DOCUMENTATION.md §"POST /api/v1/cases" (نموذج beneficiary/charityId/priority)
 */
function collectCreateCasePayload() {
  const { centerId, villageId } = resolveLocationIds(val('district'), val('village'));
  return {
    beneficiary: {
      fullName: val('case-name'),
      nationalId: val('national-id'),
      phonePrimary: val('phone1') || null,
      centerId,
      villageId,
      address: val('address') || null
    },
    charityId: null,
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
  centerid: { elId: 'district', label: 'المركز' },
  villageid: { elId: 'village', label: 'القرية' },
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
  const centerName = val('district');
  const villageName = val('village');
  const { centerId, villageId } = resolveLocationIds(centerName, villageName);
  if (!requireLocationIds(centerId, villageId, centerName, villageName)) return false;

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
      const created = await CasesService.create(collectCreateCasePayload());
      store.setCurrentCase({
        id: created.id,
        caseNumber: created.caseNumber,
        status: created.status,
        // بنخزّن الرقم القومي اللي اتسجّلت بيه الحالة عشان نقدر نكتشف لو
        // المستخدم بدأ يكتب بيانات شخص مختلف تمامًا من غير ما نصفّر الحالة
        // القديمة (راجع التعليق فوق saveStep1).
        nationalId: val('national-id'),
        // POST /cases لا يرجّع rowVersion — أول PUT /beneficiary بعده لازم
        // يمر بمسار null، فنجيب النسخة الحقيقية بقراءة فورية للحالة.
        sectionVersions: {}
      });
      const fresh = await CasesService.getById(created.id);
      store.setSectionVersion('beneficiary', fresh?.beneficiary?.rowVersion);
      // caseRowVersion (نسخة الحالة نفسها، أعلى مستوى في الرد) لازم تتخزن
      // من هنا فورًا — قبل كده كانت بتفضل null لحد أول نجاح في utilities/
      // financial/support، فلو المستخدم راح مباشرة لـ step4 من step1 كان
      // الطلب بيتبعت بـ caseRowVersion: null فيرجّع 400 فاضي بلا أي رسالة
      // (اتأكد فعليًا على السيرفر الحي — نفس عائلة باگ roomsCount/villageId).
      store.setSectionVersion('caseRowVersion', fresh?.rowVersion);

      // إكمال باقي بيانات رب الأسرة فورًا في نفس الحفظة — لو فشلت الخطوة
      // دي (مثلاً تعارض إصدار نادر)، الحالة فعلاً اتسجلت بالفعل، فأي محاولة
      // "التالي" تانية هتاخد مسار التحديث تحت وتعيد المحاولة تلقائيًا.
      const updated = await CasesService.updateBeneficiary(created.id, {
        ...collectBeneficiaryPayload(),
        rowVersion: fresh?.beneficiary?.rowVersion
      });
      store.setSectionVersion('beneficiary', updated?.rowVersion ?? fresh?.beneficiary?.rowVersion);

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
    store.setSectionVersion('beneficiary', updated?.rowVersion ?? sectionVersion('beneficiary'));
    showToast('تم حفظ بيانات رب الأسرة بنجاح ✅', 'success');
    return true;
  }, {
    onConflict: async () => {
      const fresh = await CasesService.getById(currentCaseId());
      store.setSectionVersion('beneficiary', fresh?.beneficiary?.rowVersion);
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
      await AttachmentsService.upload({ caseId, documentType, file });
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
  await ensureCaseRowVersion(caseId);
  return runSave(async () => {
    const updated = await CasesService.updateUtilities(caseId, collectUtilitiesPayload());
    store.setSectionVersion('caseRowVersion', updated?.caseRowVersion ?? sectionVersion('caseRowVersion'));
    return true;
  }, {
    onConflict: async () => {
      const fresh = await CasesService.getById(caseId);
      store.setSectionVersion('caseRowVersion', fresh?.rowVersion);
    }
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
    notes: agri.notes || null,
    rowVersion: sectionVersion('agriculture')
  };

  return runSave(async () => {
    const updated = await CasesService.updateAgriculture(caseId, payload);
    store.setSectionVersion('agriculture', updated?.rowVersion);
    // Server may have nulled dependent fields per §12.4 — re-fetch so the
    // UI doesn't keep showing values the backend just discarded.
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

function readFinancialRows(selector) {
  return [...DOM.qsa(selector)].map(row => ({
    label: (row.querySelector('[data-item-label]')?.textContent || '').trim(),
    amount: Number(row.querySelector('[data-item-amount]')?.textContent.replace(/[^\d.-]/g, '') || 0),
    period: (row.querySelector('[data-item-period]')?.textContent || '').trim() || null
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
  const rawRows = readFinancialRows('#expense-items-list .financial-item');
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
  const hasIncome = DOM.qsa('#income-items-list .financial-item').length > 0;
  const hasExpense = DOM.qsa('#expense-items-list .financial-item').length > 0;
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
  await ensureCaseRowVersion(caseId);
  const payload = {
    incomeItems: readFinancialRows('#income-items-list .financial-item'),
    expenseItems: collectFixedExpenseItems(),
    caseRowVersion: sectionVersion('caseRowVersion')
  };

  return runSave(async () => {
    const updated = await CasesService.updateFinancial(caseId, payload);
    store.setSectionVersion('caseRowVersion', updated?.caseRowVersion ?? sectionVersion('caseRowVersion'));
    return true;
  }, {
    onConflict: async () => {
      const fresh = await CasesService.getById(caseId);
      store.setSectionVersion('caseRowVersion', fresh?.rowVersion);
    }
  }).then(() => true, () => false);
}

/* ---------------------------- Step 7 — Support ---------------------------- */

function collectSupportRecommendations() {
  const checked = [...DOM.qsa('.support-type-checkbox:checked')];
  return checked.map(cb => {
    const tile = cb.closest('.support-type-tile');
    const supportType = tile?.dataset.supportType || 'دعم';
    // بعض أنواع الدعم لها فئات فرعية (chip-btn جوه .support-type-tile__subs)
    // — مثال: "لحوم" -> "نص كيلو"/"كيلو". بناخد أول فئة مفعّلة لو موجودة.
    const subCategory = tile?.querySelector('.support-type-tile__subs .chip-btn--active')?.dataset.value || null;
    // beneficiary/reason/justification كلها NotEmpty عند السيرفر (اتحقق منه
    // فعليًا: justification فاضي رجّع 422) — نضمن قيمة افتراضية دايمًا بدل
    // ما نترك الحفظ يفشل بصمت لمجرد إن حقل الملاحظات فاضي.
    return {
      supportType,
      supportCategory: subCategory,
      beneficiary: val('case-name') || 'الأسرة',
      proposedAmount: 0,
      frequency: null,
      duration: null,
      reason: supportType,
      justification: val('support-notes') || 'بناءً على تقييم الحالة',
      priorityLevel: 'medium',
      notes: val('support-notes') || null
    };
  });
}

/**
 * تحقق تنبيهي (مش إجباري) للمرحلة السابعة — بننبّه لو محدش نوع دعم اتحدد
 * قبل المتابعة، بس بنسمح بالمرور لو المستخدم قرر يحدد الدعم بعدين.
 */
export function validateStep7() {
  const hasSupportType = DOM.qsa('.support-type-checkbox:checked').length > 0;
  if (hasSupportType) return [];
  return [{
    el: null,
    message: 'لسه مفيش نوع دعم متحدد للحالة — اختَر نوع واحد على الأقل يعكس احتياج الأسرة، أو كمّل لو هتحدده بعدين.'
  }];
}

export async function saveStep7() {
  const caseId = currentCaseId();
  if (!caseId) {
    showToast('كمّل بيانات المرحلة الأولى (اسم ورقم قومي رب الأسرة) الأول، وبعدين ارجع هنا 🙏', 'warning');
    return false;
  }
  await ensureCaseRowVersion(caseId);
  return runSave(async () => {
    const updated = await CasesService.updateSupportRecommendations(
      caseId,
      collectSupportRecommendations(),
      sectionVersion('caseRowVersion')
    );
    store.setSectionVersion('caseRowVersion', updated?.caseRowVersion ?? sectionVersion('caseRowVersion'));
    return true;
  }, {
    onConflict: async () => {
      const fresh = await CasesService.getById(caseId);
      store.setSectionVersion('caseRowVersion', fresh?.rowVersion);
    }
  }).then(() => true, () => false);
}

/* ---------------------------- Dispatch table ---------------------------- */

/**
 * Step -> save function map, consumed by workflow.component.js's
 * "التالي" handler. Step 8 is intentionally absent — its backend contract
 * (`POST /opinions/worker` is web-blocked per §2.2) is still an open
 * question with the backend team; wire it once that's resolved.
 */
export const STEP_SAVE_HANDLERS = {
  1: saveStep1,
  2: saveStep2,
  3: saveStep3,
  4: saveStep4,
  // 5 is wired specially in workflow.component.js (needs readAgricultureData)
  6: saveStep6,
  7: saveStep7
};
