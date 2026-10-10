/* --------------------------------------------------------------------------
   LIVE CASE PREVIEW
   بيقرأ محطات الإدخال الثمانية ويبني منها كائن حالة مؤقت، عشان المستخدم
   يشوف الملف بشكله النهائي قبل ما يرسله — والحقول الفاضية تبان ناقصة بدل
   ما تختفي. لسه مستخدَمة لزرار "معاينة" أثناء الإدخال (المسودة لسه في
   الفورم ومش كل قسم بالضرورة اتحفظ في السيرفر بعد).

   بعد ما الحالة بقت محفوظة فعليًا على السيرفر (فيها case id)، استخدم
   loadCaseFromServer() تحت — بيجيب GET /cases/{id} الحقيقي ويحوّله لنفس
   الـ view-model، بدل قراءة الفورم.
   -------------------------------------------------------------------------- */
import { DOM } from '../../utils/dom.js';
import { store } from '../../state/store.js';
import { CasesService } from '../../services/cases.service.js';
import { AttachmentsService } from '../../services/attachments.service.js';
import { documentTypeLabel } from '../../services/document-types.js';
import { formatLocalDate } from '../../utils/date.js';
import { supportTypeLabel } from '../../utils/support-labels.js';
import { groupSupportRecommendations } from '../../utils/support-catalog.js';
import { collectSupportItems } from '../support/support.component.js';

/** قيمة حقل نصي/منسدل، أو '' لو فاضي أو غير موجود. */
function val(id) {
  const el = DOM.qs(`#${id}`);
  return el && el.value ? el.value.trim() : '';
}

/** رقم من حقل، أو 0. */
function num(id) {
  const n = Number(val(id));
  return Number.isFinite(n) ? n : 0;
}

/** هل الاختيار "نعم"؟ يقبل قيم select و radio. */
function isYes(id) {
  const v = val(id);
  return v === 'نعم' || v === 'yes' || v === 'true';
}

/**
 * قراءة حقل chips واحد: القيم المختارة، زائد نص "أخرى" لو مكتوب.
 * @returns {string} القيم مفصولة بفاصلة، أو '' لو مفيش اختيار
 */
function chips(fieldName) {
  const field = DOM.qs(`.chip-field[data-field="${fieldName}"]`);
  if (!field) return '';

  const picked = [...field.querySelectorAll('.chip-btn--active')]
    .map(b => b.dataset.value)
    .filter(Boolean);

  const otherInput = field.querySelector('.chip-field__other');
  const otherText = otherInput && otherInput.value ? otherInput.value.trim() : '';

  // "أخرى" تُستبدل بنصها حتى لا يظهر الخيار مجردًا بلا تفاصيل
  const out = picked.map(v => (v === 'أخرى' && otherText ? otherText : v));
  return out.join('، ');
}

/** هل الجهاز/المرفق مختار ضمن حقل chips؟ */
function chipHas(fieldName, value) {
  const field = DOM.qs(`.chip-field[data-field="${fieldName}"]`);
  if (!field) return false;
  return [...field.querySelectorAll('.chip-btn--active')].some(b => b.dataset.value === value);
}

/**
 * بنود الدخل والمصروفات كما هي معروضة فعليًا في المحطة 6. مصدرها الحقيقي
 * store.incomeItems/expenseItems — financial-ledger.component.js بيحدّثهم
 * لحظيًا مع كل إضافة/حذف (راجع recalculateBudget -> setFinancialItems).
 * قراءة قديمة كانت بتحاول تدور على عناصر DOM بـ selector مش موجود خالص في
 * الفورم الفعلي (زي '#income-items-list .financial-item')، فكانت دايمًا
 * بترجّع مصفوفة فاضية والمعاينة المحلية بتفضل تعرض صفر حتى لو المستخدم كتب
 * أرقام حقيقية.
 */
function readFinancialRows(items) {
  return (items || []).map(item => ({
    label: item.type || '',
    amount: Number(item.amount) || 0,
    period: item.frequency || ''
  })).filter(r => r.label);
}

/**
 * يبني كائن حالة من الحالة الحالية لشاشة الإدخال.
 * الحقول غير المستوفاة تُترك فارغة عمدًا — صفحة التفاصيل هي التي تعلّمها كناقصة.
 */
export function collectCaseFromForm() {
  const members = store.familyMembers || [];
  const agri = store.agriculture || {};

  const incomeItems = readFinancialRows(store.incomeItems);
  const expenseItems = readFinancialRows(store.expenseItems);
  const totalIncome = incomeItems.reduce((s, i) => s + i.amount, 0);
  const totalExpenses = expenseItems.reduce((s, i) => s + i.amount, 0);

  const supportTypes = groupSupportRecommendations(collectSupportItems()).map(g => ({
    title: supportTypeLabel(g.type),
    option: g.category,
    amount: '',
    recipients: g.recipients
  }));

  return {
    id: 'المسودة الحالية',
    isDraft: true,
    name: val('case-name'),
    nid: val('national-id'),
    registrationDate: formatLocalDate(),
    familyMembersCount: members.length + 1,
    phone: val('phone1'),
    charity: DOM.qs('#referral-charity-select')?.selectedOptions?.[0]?.textContent.trim() || '',
    center: val('referral-district-select'),
    village: val('referral-village-select'),
    status: 'pending',
    statusLabel: '📝 مسودة — قيد الإدخال',
    statusClass: 'dash-status-pill--warning',

    demographics: {
      education: val('education-level'),
      age: num('current-age'),
      gender: val('gender'),
      religion: val('religion'),
      phonePrimary: val('phone1'),
      phoneSecondary: val('phone2'),
      job: val('job-title'),
      monthlyIncome: num('head-monthly-income'),
      takafulBeneficiary: isYes('head-takaful-karama'),
      takafulAmount: num('head-takaful-amount'),
      address: val('address'),
      maritalStatus: val('head-relation'),
      healthStatus: '',
      employmentStatus: val('work-type')
    },

    familyMembers: members,

    // الصفوف المرفوعة فعلًا (attachments.component.js): اسم الملف في <strong>
    // والتصنيف بعده — المحدِّد القديم (.attachment-item) ماكانش بيطابق أي صف.
    attachments: [...DOM.qsa('#attachments-list .case-page-att-item[data-att-id]')].map(el => {
      const fileName = (el.querySelector('strong')?.textContent || '').trim();
      return { title: fileName, docType: '', fileName, uploadedAt: '', status: 'مرفوعة' };
    }),

    housing: {
      description: val('housing-description'),
      ownership: chips('housingType'),
      walls: chips('walls'),
      roof: chips('roof'),
      floor: chips('floor'),
      entrance: chips('entrance'),
      bathroomCondition: chips('bathroom'),
      electricity: chips('electricity'),
      water: chips('waterMeter'),
      waterMotor: chipHas('waterMotor', 'يوجد'),
      appliances: {
        fridge: chipHas('appliances', 'ثلاجة'),
        washer: chipHas('appliances', 'غسالة'),
        oven: chipHas('appliances', 'فرن'),
        stove: chipHas('appliances', 'بوتاجاز'),
        computer: chipHas('appliances', 'كمبيوتر'),
        tv: chipHas('appliances', 'تلفاز'),
        freezer: chipHas('appliances', 'ديب فريزر')
      },
      transport: chips('transport'),
      internet: chipHas('internet', 'متوفر'),
      buildingType: chips('walls'),
      roomsCount: chips('roomsCount'),
      sanitation: chips('bathroom')
    },

    utilities: {
      hasElectricity: Boolean(chips('electricity')),
      hasWater: Boolean(chips('waterMeter')),
      hasGas: Boolean(chips('gas')),
      hasSewage: Boolean(chips('sewage')),
      devices: {
        fridge: chipHas('devices', 'ثلاجة'),
        washer: chipHas('devices', 'غسالة'),
        tv: chipHas('devices', 'تلفاز'),
        screen: chipHas('devices', 'شاشة'),
        stove: chipHas('devices', 'بوتاجاز')
      },
      electricity: chips('electricity'),
      water: chips('waterMeter'),
      gas: chips('gas')
    },

    agriculture: {
      hasLand: agri.hasLand || '',
      landType: agri.landType || '',
      landArea: agri.landArea || 0,
      landRentAmount: agri.landRentAmount || 0,
      landAnnualIncome: agri.landAnnualIncome || 0,
      cropType: agri.cropType || '',
      hasLivestock: agri.hasLivestock || '',
      livestockTypes: agri.livestockTypes || [],
      livestockDetails: agri.livestockDetails || '',
      notes: agri.notes || ''
    },

    financial: {
      incomeItems,
      expenseItems,
      totalIncome,
      totalExpenses,
      netBalance: totalIncome - totalExpenses,
      medicalExpense: 0
    },

    support: {
      types: supportTypes,
      notes: val('support-notes'),
      approvedSupport: null
    },

    // الآراء لا تُكتب من شاشة الإدخال
    workerOpinion: null,
    reviewerOpinion: null,
    managerApproval: null,
    assessedNeeds: []
  };
}

/* --------------------------------------------------------------------------
   SERVER-BACKED PREVIEW
   -------------------------------------------------------------------------- */

const money = n => Number(n || 0);

/**
 * يحوّل رد GET /cases/{id} (+ GET /cases/{id}/support، GET .../attachments)
 * لنفس شكل الـ view-model اللي case-details.component.js بيرسمه — القيم
 * الفاضية بتتسيب undefined/null بدل ما تتلفّق، وrow()/gone() في العرض هما
 * اللي بيقرروا يبيّنوها "لم يُسجّل" ولا يخفوها حسب DRAFT_MODE.
 */
function mapServerCaseToViewModel(serverCase, { support, attachments } = {}) {
  const b = serverCase.beneficiary || {};
  const h = serverCase.housing || {};
  const u = serverCase.utilities || {};
  const a = serverCase.agriculture || {};
  const f = serverCase.financial || {};

  const serverRecommendations = support?.recommendations || support?.supportRecommendations || [];

  const utilityByName = (name) => (u.utilities || []).find(x => x.name === name);
  const applianceByKey = (key) => (u.appliances || []).find(x => x.applianceKey === key)?.isPresent || false;

  return {
    id: serverCase.caseNumber || serverCase.id,
    isDraft: serverCase.status === 'draft',
    name: b.fullName || '',
    nid: b.nationalId || '',
    registrationDate: serverCase.registrationDate || serverCase.createdAtUtc || '',
    familyMembersCount: (serverCase.familyMembers || []).length + 1,
    phone: b.phonePrimary || '',
    charity: serverCase.charityName || '',
    center: serverCase.centerName || '',
    village: serverCase.villageName || '',
    status: serverCase.status,
    statusLabel: serverCase.statusLabel || serverCase.status,
    statusClass: '',

    demographics: {
      education: b.education || '',
      age: b.age ?? null,
      gender: b.gender || '',
      religion: b.religion || '',
      birthGovernorate: b.birthGovernorate || '',
      phonePrimary: b.phonePrimary || '',
      phoneSecondary: b.phoneSecondary || '',
      job: b.job || '',
      monthlyIncome: money(b.monthlyIncome),
      takafulBeneficiary: Boolean(b.takafulBeneficiary),
      takafulAmount: money(b.takafulAmount),
      address: b.address || '',
      maritalStatus: b.maritalStatus || '',
      healthStatus: b.healthStatus || '',
      employmentStatus: b.employmentStatus || ''
    },

    familyMembers: serverCase.familyMembers || [],

    attachments: (attachments?.items || []).map(att => ({
      id: att.id,
      title: att.description || att.fileName || '',
      docType: documentTypeLabel(att.documentType),
      fileName: att.fileName || '',
      uploadedAt: att.uploadedAtUtc ? att.uploadedAtUtc.slice(0, 10) : '',
      status: att.status === 'complete' ? 'مرفوعة' : 'الرفع ماكملش'
    })),

    housing: {
      description: h.description || '',
      ownership: h.ownership || '',
      walls: h.walls || h.buildingType || '',
      roof: h.roof || '',
      floor: h.floor || '',
      entrance: h.entrance || '',
      bathroomCondition: h.bathroomCondition || h.sanitation || '',
      electricity: h.electricity || '',
      water: h.water || '',
      waterMotor: Boolean(h.waterMotor),
      appliances: {},
      transport: h.transport || '',
      internet: Boolean(h.internet),
      buildingType: h.buildingType || h.walls || '',
      roomsCount: h.roomsCount ?? '',
      sanitation: h.sanitation || h.bathroomCondition || ''
    },

    utilities: {
      hasElectricity: Boolean(utilityByName('electricity')?.isAvailable),
      hasWater: Boolean(utilityByName('waterMeter')?.isAvailable),
      hasGas: Boolean(utilityByName('gas')?.isAvailable),
      hasSewage: Boolean(utilityByName('sewage')?.isAvailable),
      devices: {
        fridge: applianceByKey('fridge'),
        washer: applianceByKey('washer'),
        tv: applianceByKey('tv'),
        screen: applianceByKey('computer'),
        stove: applianceByKey('cookingAppliances')
      },
      electricity: utilityByName('electricity')?.condition || '',
      water: utilityByName('waterMeter')?.condition || '',
      gas: utilityByName('gas')?.condition || ''
    },

    agriculture: {
      hasLand: a.hasLand || 'unanswered',
      landType: a.landType || '',
      landArea: a.landAreaFeddan || 0,
      landRentAmount: a.landRentAmount || 0,
      landAnnualIncome: a.annualLandIncome || 0,
      cropType: a.cropType || '',
      hasLivestock: a.hasLivestock || 'unanswered',
      livestockTypes: a.selectedLivestock || [],
      livestockDetails: a.livestockDetails || '',
      notes: a.notes || ''
    },

    financial: {
      incomeItems: f.incomeItems || [],
      expenseItems: f.expenseItems || [],
      totalIncome: (f.incomeItems || []).reduce((s, i) => s + money(i.amount), 0),
      totalExpenses: (f.expenseItems || []).reduce((s, i) => s + money(i.amount), 0),
      netBalance: (f.incomeItems || []).reduce((s, i) => s + money(i.amount), 0)
        - (f.expenseItems || []).reduce((s, i) => s + money(i.amount), 0),
      medicalExpense: 0
    },

    support: {
      types: groupSupportRecommendations(serverRecommendations).map(g => ({
        title: supportTypeLabel(g.type),
        option: g.category,
        amount: g.amount > 0 ? g.amount : '',
        recipients: g.recipients
      })),
      notes: serverRecommendations[0]?.notes || '',
      approvedSupport: support?.approvedSupport || null
    },

    workerOpinion: serverCase.workerOpinion || null,
    reviewerOpinion: serverCase.reviewerOpinion || null,
    managerApproval: serverCase.managerApproval || null,
    assessedNeeds: (serverCase.assessedNeeds && serverCase.assessedNeeds.needs) || []
  };
}

/**
 * يجيب الحالة الحقيقية من السيرفر (GET /cases/{id} + /support + /attachments
 * على التوازي) ويحوّلها لنفس شكل الـ view-model اللي شاشة تفاصيل الحالة
 * بترسمه — يستخدمها أي مكان عايز يعرض حالة *محفوظة* بدل مسودة الفورم.
 * @param {string} caseId
 * @returns {Promise<Object>} case view-model جاهز لـ openCaseDetailsPage()
 */
export async function loadCaseFromServer(caseId) {
  const [serverCase, support, attachments] = await Promise.all([
    CasesService.getById(caseId),
    CasesService.getSupport(caseId).catch(() => null),
    AttachmentsService.listAllForCase(caseId).catch(() => null)
  ]);
  return mapServerCaseToViewModel(serverCase, { support, attachments });
}
