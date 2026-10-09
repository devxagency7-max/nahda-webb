/* --------------------------------------------------------------------------
   CASE EDIT LOADER — تحميل حالة محفوظة سابقًا في معالج البيانات الشخصية
   عشان تتعدّل، بدل ما يبدأ المستخدم حالة جديدة من الصفر.

   الاستخدام: يتنادى من زرار "تعديل بيانات الحالة" في case-details.component.js.
   بيعمل GET /cases/{id} (+ family-members/support/attachments على التوازي)،
   يملى كل التابات التمنية من الرد، ويهيّئ store.currentCase بحيث أي "التالي"
   بعد كده ياخد مسار PUT (تحديث) مش POST (إنشاء).

   قيد مهم من الباك إند (اتأكد منه صراحة): PUT /cases/{id}/beneficiary بيعمل
   استبدال كامل — أي حقل يتبعت null أو مايتبعتش بيتمسح فعليًا. فلازم نملى كل
   حقول تاب 1 (بما فيها اللي المستخدم مش ناوي يلمسها) قبل أي حفظ، وده بالظبط
   اللي الدالة دي بتعمله.
   -------------------------------------------------------------------------- */
import { DOM } from '../../utils/dom.js';
import { store } from '../../state/store.js';
import { showToast } from '../../utils/toast.js';
import { triggerWorkflowRecalc } from '../../core/state.js';
import { CasesService } from '../../services/cases.service.js';
import { AttachmentsService } from '../../services/attachments.service.js';
import { messageFromError } from '../../services/errors.js';
import { renderAttachmentList, renderAttachmentLoadError } from '../attachments/attachments.component.js';
import { restoreAgricultureManager } from '../agriculture/agriculture.component.js';
import { loadFamilyMembersManager } from '../family-members/family-members.component.js';
import { loadFinancialManager } from '../financial-ledger/financial-ledger.component.js';
import { loadSupportSelection } from '../support/support.component.js';
import { whenDropdownsReady } from './dropdown-data.component.js';

function setVal(id, value) {
  const el = DOM.qs(`#${id}`);
  if (el && value != null) el.value = value;
}

function setChecked(id, checked) {
  const el = DOM.qs(`#${id}`);
  if (el) el.checked = Boolean(checked);
}

/**
 * يحط قيمة في <select> — لو القيمة مش من ضمن الـ <option>s الثابتة، بيفعّل
 * سلوك "أخرى" الحر (other-dropdowns.component.js) بدل ما يسيب الـ select فاضي
 * بصمت (السلوك الافتراضي للمتصفح لو select.value اتحط بقيمة مش موجودة).
 */
function setSelectValue(id, value) {
  const el = DOM.qs(`#${id}`);
  if (!el || value == null || value === '') return;

  const matchingOption = [...el.options].find(o => o.value === value);
  if (matchingOption) {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  // مفيش خيار مطابق — فعّل "أخرى" بالقيمة الحرة دي (لو الحقل بيدعمها).
  const otherOpt = [...el.options].find(o => o.dataset.isOther === 'true' || o.value === 'أخرى');
  if (otherOpt) {
    otherOpt.value = value;
    otherOpt.textContent = `أخرى: ${value}`;
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

/** يفعّل شيب واحد (زي ما لو المستخدم داس عليه) — بيعيد استخدام منطق chip-field.component.js كامل (العدّاد، "أخرى"، إلخ) بدل ما نكرره هنا. */
function activateChip(fieldSelector, value) {
  if (!value) return;
  const field = DOM.qs(fieldSelector);
  if (!field) return;
  const chip = [...DOM.qsa('.chip-btn', field)].find(c => c.dataset.value === value);
  if (chip && !chip.classList.contains('chip-btn--active')) {
    chip.click();
  } else if (!chip) {
    // قيمة مش من ضمن الخيارات الثابتة — فعّل "أخرى" وحط القيمة فيه.
    const otherChip = [...DOM.qsa('.chip-btn', field)].find(c => c.dataset.value === 'أخرى');
    if (otherChip) {
      if (!otherChip.classList.contains('chip-btn--active')) otherChip.click();
      const otherInput = field.querySelector('.chip-field__other');
      if (otherInput) {
        otherInput.value = value;
        otherInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  }
}

/** id -> اسم (المركز/القرية) عن طريق store.locationIds، نفس اللي case-details.component.js بيستخدمها. */
function resolveLocationNames(centerId, villageId) {
  const ids = store.locationIds || { centers: {}, villages: {} };
  const centerName = Object.keys(ids.centers || {}).find(name => ids.centers[name] === centerId);
  const villagesInCenter = (centerName && ids.villages[centerName]) || {};
  const villageName = Object.keys(villagesInCenter).find(name => villagesInCenter[name] === villageId);
  return { centerName, villageName };
}

/* ---------------------------- تاب 1 — البيانات الأساسية ---------------------------- */

function fillStep1(detail) {
  const b = detail.beneficiary || {};

  setVal('case-name', b.fullName);
  setVal('national-id', b.nationalId);
  // current-age/gender حقول للقراءة بس ومشتقة من الرقم القومي — دوس على
  // الرقم القومي هيولّد استخراجها تلقائيًا (نفس مسار الكتابة اليدوية) عن
  // طريق حدث input اللي بيسمعه workflow.component.js.
  const nidInput = DOM.qs('#national-id');
  if (nidInput) nidInput.dispatchEvent(new Event('input', { bubbles: true }));

  setSelectValue('religion', b.religion);
  // maritalStatus وheadRelation بيتقروا من نفس حقل #head-relation عند الحفظ
  // (collectBeneficiaryPayload) — أيهما موجود بيملي نفس الحقل.
  setSelectValue('head-relation', b.headRelation || b.maritalStatus);
  setSelectValue('education-level', b.education);
  setVal('phone1', b.phonePrimary);
  setVal('phone2', b.phoneSecondary);
  setVal('address', b.address);
  setVal('job-title', b.job);
  setVal('head-monthly-income', b.monthlyIncome);
  setChecked('head-takaful-karama', b.takafulBeneficiary);
  const takafulGroup = DOM.qs('#head-takaful-amount-group');
  if (takafulGroup) takafulGroup.style.display = b.takafulBeneficiary ? 'block' : 'none';
  setVal('head-takaful-amount', b.takafulAmount);
  setSelectValue('work-type', b.employmentStatus);

  // المركز/القرية: الـ <select>s دي بتتعامل بالاسم مش بالـ id (location-
  // cascade.component.js)، فلازم نحوّل id -> name الأول.
  const { centerName, villageName } = resolveLocationNames(b.centerId, b.villageId);
  if (centerName) {
    setSelectValue('referral-district-select', centerName);
    // تفعيل الـ cascade يدويًا عشان قايمة القرى تتحدّث قبل ما نحط قيمتها.
    const districtSelect = DOM.qs('#referral-district-select');
    if (districtSelect) districtSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (villageName) {
    setSelectValue('referral-village-select', villageName);
  }

  // الجمعية بتتعامل بالـ id، وقايمتها ممكن تكون لسه بتتحمّل — فبنسيب القيمة
  // معلّقة والـ cascade (location-cascade.component.js) يختارها أول ما تبقى موجودة.
  const charitySelect = DOM.qs('#referral-charity-select');
  if (charitySelect) {
    if (detail.charityId) charitySelect.dataset.pendingValue = detail.charityId;
    else {
      delete charitySelect.dataset.pendingValue;
      charitySelect.value = '';
    }
    charitySelect.dispatchEvent(new Event('charity:sync'));
  }

  triggerWorkflowRecalc();
}

/* ---------------------------- تاب 2 — المرفقات ---------------------------- */

/** الصفوف نفسها (فتح/معاينة، حذف بتأكيد، حالة الرفع) في attachments.component.js. */
function fillStep2(attachments, caseId) {
  if (attachments?.loadError) {
    renderAttachmentLoadError(attachments.loadError, () => AttachmentsService.listAllForCase(caseId));
    return;
  }
  renderAttachmentList((attachments && attachments.items) || []);
}

/* ---------------------------- تاب 3 — السكن ---------------------------- */

function fillStep3(housing) {
  const h = housing || {};
  setVal('housing-description', h.description);
  activateChip('.chip-field[data-field="housingType"]', h.ownership);
  activateChip('.chip-field[data-field="walls"]', h.walls);
  activateChip('.chip-field[data-field="roof"]', h.roof);
  activateChip('.chip-field[data-field="floor"]', h.floor);
  activateChip('.chip-field[data-field="entrance"]', h.entrance);
  activateChip('.chip-field[data-field="bathroomCondition"]', h.bathroomCondition);
  setVal('rooms-count', h.roomsCount);
  triggerWorkflowRecalc();
}

/* ---------------------- تاب 3 (تكملة) — المرافق والتجهيزات ---------------------- */

function fillUtilities(utilities) {
  const ut = utilities || {};
  activateChip('.chip-field[data-field="electricity"]', ut.electricity);
  activateChip('.chip-field[data-field="waterMeter"]', ut.water);
  activateChip('.chip-field[data-field="waterMotor"]', ut.waterMotor ? 'يوجد' : 'لا يوجد');
  activateChip('.chip-field[data-field="transportation"]', ut.transport);
  if (ut.internet) activateChip('.chip-field[data-field="internet"]', 'يوجد');

  (ut.appliances || []).forEach(a => {
    const value = a.isPresent ? (a.details || 'يوجد') : 'لا يوجد';
    activateChip(`.chip-field[data-field="${a.applianceKey}"]`, value);
  });

  triggerWorkflowRecalc();
}

/* ---------------------------- تاب 4 — الزراعة ---------------------------- */

function fillStep4(agriculture) {
  const ag = agriculture || {};
  let livestockTypes = [];
  try {
    livestockTypes = ag.selectedLivestock || (ag.selectedLivestockJson ? JSON.parse(ag.selectedLivestockJson) : []);
  } catch {
    livestockTypes = [];
  }

  store.setAgriculture({
    hasLand: ag.hasLand || 'unanswered',
    landType: ag.landType || '',
    area: ag.landAreaFeddan != null ? String(ag.landAreaFeddan) : '',
    rentAmount: ag.landRentAmount != null ? String(ag.landRentAmount) : '',
    annualIncome: ag.annualLandIncome != null ? String(ag.annualLandIncome) : '',
    hasLivestock: ag.hasLivestock || 'unanswered',
    livestockTypes,
    livestockOther: ag.livestockOther || '',
    livestockDetails: ag.livestockDetails || '',
    notes: ag.notes || ''
  });
  // agriculture.component.js بيقرا store.agriculture بس وقت init — لازم
  // نستدعي الاستعادة يدويًا هنا عشان الفورم يعرض القيم دي فعليًا.
  restoreAgricultureManager();
}

/* ---------------------------- تاب 5 — الدخل والمصروفات ---------------------------- */

const FIXED_EXPENSE_LABELS = new Set([
  'الأكل والشرب', 'المصروفات الدراسية', 'الكهرباء', 'المياه', 'الغاز', 'الإيجار', 'القسط'
]);

function fillStep5(financial) {
  const fin = financial || {};
  const incomeItems = fin.incomeItems || [];
  const expenseItems = fin.expenseItems || [];

  // البنود التلقائية (isAuto) بتتحسب من جديد لوحدها من تاب 1/5 — هنا بنحتفظ
  // بس بالبنود اليدوية اللي المستخدم ضافها بنفسه.
  const manualIncomeItems = incomeItems
    .filter(i => !i.isAuto)
    .map(i => ({ type: i.label, person: '', amount: Number(i.amount) || 0, frequency: i.period || 'شهري', notes: '' }));

  const fixedExpenseAmounts = {};
  const manualExpenseItems = [];
  expenseItems.forEach(i => {
    if (FIXED_EXPENSE_LABELS.has(i.label) && !i.isAuto) {
      fixedExpenseAmounts[i.label] = Number(i.amount) || 0;
    } else if (!i.isAuto) {
      manualExpenseItems.push({ type: i.label, amount: Number(i.amount) || 0, frequency: i.period || 'شهري', notes: '' });
    }
  });

  loadFinancialManager(manualIncomeItems, fixedExpenseAmounts, manualExpenseItems);
}

/* ---------------------------- تاب 6 — الدعم ---------------------------- */

function fillStep6(recommendations) {
  return loadSupportSelection(recommendations);
}

/* ---------------------------- أفراد الأسرة ---------------------------- */

function mapMembersFromApi(members) {
  return (members || []).map(m => ({
    memberId: m.id || '',
    name: m.name || '',
    relation: m.relation || '',
    idNum: m.nationalId || '',
    age: m.computedCurrentAge != null ? String(m.computedCurrentAge) : (m.age != null ? String(m.age) : ''),
    gender: m.gender || '',
    religion: m.religion || '',
    phone: m.phone || '',
    job: m.job || 'غير محدد',
    income: m.monthlyIncome != null ? String(m.monthlyIncome) : '',
    notes: m.notes || '',
    diseases: m.diseases || '',
    isStudent: String(Boolean(m.isStudent)),
    stage: m.educationStage || '',
    grade: m.grade || '',
    university: m.university || '',
    qualification: m.isStudent ? '' : (m.education || ''),
    takafulKarama: String(Boolean(m.takafulBeneficiary)),
    takafulKaramaAmount: m.takafulAmount != null ? String(m.takafulAmount) : ''
  }));
}

/* ---------------------------- نقطة الدخول ---------------------------- */

/**
 * يحمّل حالة موجودة كاملة في معالج البيانات الشخصية للتعديل.
 * @param {string} caseId
 * @returns {Promise<boolean>} true لو نجح التحميل
 */
export async function loadCaseIntoForm(caseId) {
  try {
    // family-members وassessed-needs بيتحفظوا بـ PUT "استبدال القائمة كلها".
    // لو فشل جلب واحد منهم اتحوّل لقائمة فاضية، أول "التالي" كان بيبعت
    // القائمة الفاضية ويمسح بيانات الحالة الحقيقية على السيرفر في صمت —
    // فالفشل هنا لازم يوقف التحميل كله. المرفقات بس هي اللي ممكن تفضل فاضية:
    // مابتتبعتش في أي PUT (الرفع بيحصل فوريًا لكل ملف لوحده).
    // whenDropdownsReady: الـ selects لازم تكون فيها خياراتها الحقيقية قبل ما
    // نحط فيها قيم الحالة، وإلا أي قيمة مش في الـ HTML المبدئي هتتحط كـ "أخرى"
    // حرة (setSelectValue). فوري لو الخيارات متخزنة؛ بيستنى بس في أول تحميل.
    const [detail, familyRes, supportRes, attachmentsRes] = await Promise.all([
      CasesService.getById(caseId),
      CasesService.getFamilyMembers(caseId),
      CasesService.getSupport(caseId).catch(err => ({ loadError: err })),
      AttachmentsService.listAllForCase(caseId).catch(err => ({ items: [], loadError: err })),
      whenDropdownsReady()
    ]);

    // support-recommendations بيتحفظ بـ PUT "استبدال القائمة كلها" (والـ
    // assessed-needs اتقفل) — فلو فشل جلبه ماينفعش نكمّل، وإلا أول "التالي"
    // كان هيبعت قائمة فاضية ويمسح الدعم المسجّل.
    if (supportRes?.loadError) throw supportRes.loadError;

    // caseRowVersion = rowVersion الحالة لحظة الفتح — مرجع التزامن لكل أقسام
    // القوائم لحد ما حفظ من عندنا يرجّع رقم أحدث. beneficiary/housing/
    // agriculture ليهم عدّاد مستقل كل واحد (راجع الملحوظة في personal-data.api.js).
    store.setCurrentCase({
      id: detail.id,
      caseNumber: detail.caseNumber,
      status: detail.status,
      nationalId: detail.beneficiary?.nationalId,
      // بيميّز وضع "تعديل حالة موجودة" عن "إنشاء حالة جديدة" — workflow.component.js
      // بيستخدمها في نهاية الاستمارة عشان يقرر يرجع لصفحة تفاصيل الحالة
      // (تعديل) بدل الرئيسية مع مسح الفورم (إنشاء).
      isEditMode: true,
      // saveStep1 مابيبعتش PUT family-members في وضع التعديل غير لو القائمة
      // دي اتجابت فعلًا من السيرفر — حماية إضافية ضد إرسال قائمة فاضية بالغلط.
      familyLoaded: true,
      // المستفيد كما هو على السيرفر — أساس جسم PUT /beneficiary (استبدال
      // كامل) حتى لا يمسح الحفظ خانات الفورم مابيعرضهاش (راجع
      // collectBeneficiaryPayload في personal-data.api.js).
      beneficiary: detail.beneficiary || null,
      // الجمعية المربوطة على السيرفر — saveStep1 بيبعت PUT /charity بس لو اتغيرت.
      charityId: detail.charityId || null,
      sectionVersions: {
        beneficiary: detail.beneficiary?.rowVersion,
        housing: detail.housing?.rowVersion,
        agriculture: detail.agriculture?.rowVersion,
        caseRowVersion: detail.rowVersion
      }
    });

    fillStep1(detail);
    fillStep2(attachmentsRes, caseId);
    fillStep3(detail.housing);
    fillUtilities(detail.utilities);
    fillStep4(detail.agriculture);
    loadFamilyMembersManager(mapMembersFromApi(familyRes?.members));
    fillStep5(detail.financial);
    await fillStep6(supportRes?.recommendations || supportRes?.supportRecommendations || []);

    triggerWorkflowRecalc();
    return true;
  } catch (err) {
    showToast(`تعذّر تحميل بيانات الحالة للتعديل — ${messageFromError(err)}`, 'error');
    return false;
  }
}
