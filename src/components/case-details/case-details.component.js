/* --------------------------------------------------------------------------
   CASE DETAILS PAGE VIEW COMPONENT CONTROLLER
   Renders the full glassmorphic cards flow on the main page canvas, ending in
   the three opinion slots: الأخصائي (read-only, من تطبيق الموبايل) ->
   المراجع -> الاعتماد النهائي للمدير. التسلسل إجباري ومفروض في permissions.js.
   -------------------------------------------------------------------------- */
import { DOM } from '../../utils/dom.js';
import { showToast } from '../../utils/toast.js';
import { store } from '../../state/store.js';
import { canWriteOpinion, isRole, ROLES, ROLE_LABELS, can, PERMISSIONS } from '../../core/permissions.js';
import { loadCaseIntoForm } from '../personal-data/case-edit.loader.js';
import { EventBus, EVENTS } from '../../core/event-bus.js';
import { CasesService } from '../../services/cases.service.js';
import { AttachmentsService } from '../../services/attachments.service.js';
import { DropdownsService } from '../../services/dropdowns.service.js';
import { messageFromError } from '../../services/errors.js';
import { documentTypeLabel } from '../../services/document-types.js';
import { formatLocalDate, formatCairoDateTime } from '../../utils/date.js';
import { StorageService, STORAGE_KEYS } from '../../services/storage.js';
import { supportTypeLabel } from '../../utils/support-labels.js';

let currentActiveCase = null;

// آخر «تاريخ حالة» اتجاب — { caseId, data }. بيتمسح لما حالة تانية تتفتح
// أو بعد أي إجراء سير عمل، عشان النافذة ماتعرضش تاريخ قديم.
let timelineCache = null;

export function initCaseDetailsComponent() {
  // Bind globally for page router / navigation hooks
  window.openCaseDetailsPage = openCaseDetailsPage;
  bindExportPdfButton();
  bindEditButton();
  bindTimelineButton();

  // استعادة نفس صفحة تفاصيل الحالة بعد refresh (لو كانت آخر صفحة مفتوحة)
  // بدل ما تفضل الحقول فاضية أو — قبل التصليح ده — تعرض بيانات placeholder
  // ثابتة (CASE-101 / أحمد محمود...) كانت متسجّلة جوه ملف الـ HTML نفسه من
  // ساعة التصميم، ومحدش كان بيشيلها لأن الصفحة أصلاً معندهاش أي إعادة تحميل
  // تلقائي عند فتح التطبيق. دلوقتي بنجيب نفس الحالة الحقيقية اللي المستخدم
  // كان واقف عندها (GET /cases/{id} طازة، مش أي كاش) لو فيه id محفوظ.
  if (store.currentView === 'case-details') {
    const lastId = StorageService.get(STORAGE_KEYS.LAST_VIEWED_CASE_ID, null);
    if (lastId) {
      openCaseDetailsPage(lastId);
    } else {
      // مفيش حالة محفوظة نرجعلها — مانسيبش الصفحة فاضية بلا معنى.
      store.setCurrentView('dashboard', true);
      if (window.switchView) window.switchView('dashboard', false);
    }
  }
}

/** Merges any in-flight unsaved user edits currently on the screen into the case data */
function captureLiveCaseEdits(baseCase) {
  if (!baseCase) return null;
  const c = JSON.parse(JSON.stringify(baseCase));

  // Merge any live reviewer decision/notes from the form
  const revForm = document.querySelector('#reviewer-decision-form');
  if (revForm) {
    const revRadio = revForm.querySelector('input[name="reviewer_decision"]:checked');
    const revNotes = revForm.querySelector('textarea, #reviewer-notes');
    if (revRadio) {
      c.reviewerOpinion = c.reviewerOpinion || {};
      c.reviewerOpinion.decision = revRadio.value;
    }
    if (revNotes && revNotes.value.trim()) {
      c.reviewerOpinion = c.reviewerOpinion || {};
      c.reviewerOpinion.notes = revNotes.value.trim();
    }
  }

  // Merge any live manager decision/notes from the form
  const mgrForm = document.querySelector('#manager-approval-form');
  if (mgrForm) {
    const mgrRadio = mgrForm.querySelector('input[name="manager_decision"]:checked');
    const mgrNotes = mgrForm.querySelector('textarea, #manager-notes');
    if (mgrRadio) {
      c.managerApproval = c.managerApproval || {};
      c.managerApproval.decision = mgrRadio.value;
    }
    if (mgrNotes && mgrNotes.value.trim()) {
      c.managerApproval = c.managerApproval || {};
      c.managerApproval.notes = mgrNotes.value.trim();
    }
  }

  return c;
}

function bindEditButton() {
  const btn = DOM.qs('#btn-edit-case');
  if (!btn) return;

  if (!can(PERMISSIONS.EDIT_CASE)) {
    btn.style.display = 'none';
    return;
  }

  btn.addEventListener('click', async () => {
    if (!currentActiveCase || !currentActiveCase.rawId) {
      showToast('لا توجد بيانات حالة للتعديل');
      return;
    }
    if (btn.disabled) return;

    btn.disabled = true;
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<span>⏳ جاري تحميل بيانات الحالة...</span>';

    const loaded = await loadCaseIntoForm(currentActiveCase.rawId);

    btn.disabled = false;
    btn.innerHTML = originalHtml;

    if (loaded && window.switchView) {
      window.switchView('personal-data');
    }
  });
}

function bindExportPdfButton() {
  const btn = DOM.qs('#btn-export-case-pdf');
  const label = DOM.qs('#btn-export-case-pdf-text');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    if (!currentActiveCase) {
      showToast('لا توجد بيانات حالة لتحميلها');
      return;
    }

    if (btn.disabled) return;

    btn.disabled = true;
    const originalText = label ? label.textContent : 'تحميل الحالة PDF';
    if (label) label.textContent = 'جاري تجهيز ملف الحالة...';

    try {
      const liveCase = captureLiveCaseEdits(currentActiveCase);
      // تحميل كسول: jsPDF + html2canvas تقيلين ومش لازمين إلا عند الضغط على تصدير.
      const { exportCaseToPdf } = await import('../../services/case-pdf.service.js');
      await exportCaseToPdf(liveCase);
      showToast('تم تحميل وتجهيز ملف الحالة PDF بنجاح 📄', 'success');
    } catch (err) {
      console.error('PDF generation error:', err);
      showToast('تعذر إنشاء ملف الـ PDF. يرجى المحاولة مرة أخرى', 'error');
    } finally {
      btn.disabled = false;
      if (label) label.textContent = originalText;
    }
  });
}

const STATUS_META = {
  draft: { label: '📝 مسودة', cls: 'dash-status-pill--warning' },
  pending_assignment: { label: '🟡 بانتظار الإسناد', cls: 'dash-status-pill--warning' },
  assigned: { label: '🔵 مسندة لأخصائي', cls: 'dash-status-pill--info' },
  in_research: { label: '🔵 قيد البحث الميداني', cls: 'dash-status-pill--info' },
  pending_review: { label: '🟡 قيد المراجعة', cls: 'dash-status-pill--warning' },
  returned_to_worker: { label: '🟡 معادة للأخصائي', cls: 'dash-status-pill--warning' },
  pending_approval: { label: '🔵 قيد الاعتماد', cls: 'dash-status-pill--info' },
  approved: { label: '🟢 معتمدة', cls: 'dash-status-pill--success' },
  rejected: { label: '🔴 مرفوضة', cls: 'dash-status-pill--danger' }
};

/** Reverse-resolves a center/village GUID pair into their display names via store.locationIds (populated from GET /locations). */
function resolveLocationNames(centerId, villageId) {
  const ids = store.locationIds || { centers: {}, villages: {} };
  const centerName = Object.keys(ids.centers || {}).find(name => ids.centers[name] === centerId);
  const villagesInCenter = (centerName && ids.villages[centerName]) || {};
  const villageName = Object.keys(villagesInCenter).find(name => villagesInCenter[name] === villageId);
  return { centerName, villageName };
}

/** Arabic label for a financial line item's auto-computed source (§FinancialItemView). */
function financialSourceLabel(source) {
  if (source === 'beneficiary') return 'من بيانات رب الأسرة';
  if (source === 'beneficiary+family') return 'من بيانات الأسرة';
  if (source === 'agriculture') return 'من الحيازة الزراعية';
  return undefined;
}

/**
 * Worker/reviewer/manager opinion -> the {decision,notes,author,date,submitted}
 * shape the opinion cards expect, or null if not yet recorded.
 * `displayDate` (backend-confirmed) is the date to *show*: the original
 * search/registration date for legacy-imported opinions, the real opinion
 * date for opinions recorded on the system. Falls back to
 * updatedAtUtc/createdAtUtc only for older responses that don't send it yet.
 */
function mapOpinion(o) {
  if (!o) return null;
  return {
    decision: o.decision,
    notes: o.notes || o.detailedReport || o.returnReason || '',
    author: o.authorName,
    date: (o.displayDate || o.updatedAtUtc || o.createdAtUtc || '').slice(0, 10),
    submitted: o.isSubmitted,
    isLegacyImport: o.isLegacyImport
  };
}

/**
 * Maps the real API's case detail + family-members + support + attachments
 * responses into the render shape this component's cards expect. As of the
 * latest backend update, `GET /cases/{id}` (and `GET /cases/{id}/report`'s
 * `data.case`, which is the exact same shape) embeds housing, utilities,
 * agriculture, financial and the three workflow opinions directly — no
 * separate calls needed for those.
 * @param {Map<string,string>} applianceLabels applianceKey -> Arabic label,
 *   from `GET /dropdowns?step=4&fieldType=chip` (backend-confirmed: this is
 *   a convention of ~9 known keys, not a server-enforced enum, and is the
 *   single source for appliances shown on both the housing and utilities
 *   cards — there is no separate housing-appliances list).
 * @param {Object} [legacyRecord] `data.legacyRecord` from `GET /cases/{id}/report`
 *   — the original Excel row's column/value pairs, only when `available` is true.
 */
function normalizeApiCase(detail, familyRes, supportRes, attachmentsRes, applianceLabels, legacyRecord) {
  const b = detail.beneficiary || {};
  const { centerName, villageName } = resolveLocationNames(b.centerId, b.villageId);
  const statusMeta = STATUS_META[detail.status] || { label: detail.status || '—', cls: 'dash-status-pill--warning' };
  const members = (familyRes && familyRes.members) || [];
  const recommendations = (supportRes && (supportRes.recommendations || supportRes.supportRecommendations)) || [];
  const approved = (supportRes && (supportRes.approved || supportRes.approvedSupport)) || null;
  const supportHistory = (supportRes && supportRes.history) || detail.support?.history || [];
  const attachments = (attachmentsRes && attachmentsRes.items) || [];
  const needs = (detail.assessedNeeds && detail.assessedNeeds.needs) || [];
  const legacy = detail.legacyImportData || null;

  const h = detail.housing || {};
  const ut = detail.utilities || {};
  const ag = detail.agriculture || {};
  const fin = detail.financial || {};
  const opinions = detail.opinions || {};

  let livestockTypes = [];
  try {
    livestockTypes = ag.selectedLivestockJson ? JSON.parse(ag.selectedLivestockJson) : [];
  } catch {
    livestockTypes = [];
  }
  // "other" is a placeholder key in the raw list — swap it for the free-text detail the caller actually gave.
  if (ag.livestockOther) {
    livestockTypes = livestockTypes.map(t => (String(t).toLowerCase() === 'other' ? ag.livestockOther : t));
  }

  // Single shared appliances source for both the housing and utilities cards.
  const appliances = (ut.appliances || []).map(a => ({
    key: a.applianceKey,
    label: (applianceLabels && applianceLabels.get(a.applianceKey)) || a.applianceKey,
    isPresent: a.isPresent,
    details: a.details
  }));

  return {
    id: detail.caseNumber || detail.displayId || detail.id,
    rawId: detail.id,
    apiBacked: true,
    caseRowVersion: detail.rowVersion,
    status: detail.status,
    statusLabel: statusMeta.label,
    statusClass: statusMeta.cls,
    name: b.fullName,
    nid: b.nationalId,
    phone: b.phonePrimary,
    charity: detail.charityName,
    center: centerName,
    village: villageName,
    registrationDate: detail.registrationDate,
    isLegacyImport: Boolean(detail.isLegacyImport),
    legacyImportData: legacy ? {
      caseNumberLegacy: legacy.caseNumberLegacy,
      caseCodeLegacy: legacy.caseCodeLegacy,
      classification: legacy.classification,
      researcherName: legacy.researcherName,
      birthDate: legacy.birthDate,
      netIncome: legacy.netIncome,
      closed: legacy.closed,
      rawStatus: legacy.rawStatus,
      sourceRowNumber: legacy.sourceRowNumber
    } : null,
    legacyRecord: legacyRecord || null,
    demographics: {
      age: b.age,
      gender: b.gender,
      religion: b.religion,
      birthGovernorate: b.birthGovernorate,
      phonePrimary: b.phonePrimary,
      phoneSecondary: b.phoneSecondary,
      address: b.address,
      education: b.education,
      maritalStatus: b.maritalStatus,
      headRelation: b.headRelation || b.maritalStatus,
      healthStatus: b.healthStatus,
      employmentStatus: b.employmentStatus,
      job: b.job,
      monthlyIncome: b.monthlyIncome,
      takafulBeneficiary: b.takafulBeneficiary,
      takafulAmount: b.takafulAmount
    },
    familyMembers: members.map(m => ({
      name: m.name,
      relation: m.relation,
      nid: m.nationalId,
      age: m.computedCurrentAge ?? m.age,
      gender: m.gender,
      religion: m.religion,
      isStudent: m.isStudent,
      stage: m.educationStage,
      grade: m.grade,
      university: m.university,
      education: m.education,
      job: m.job,
      monthlyIncome: m.monthlyIncome,
      takafulBeneficiary: m.takafulBeneficiary,
      takafulAmount: m.takafulAmount,
      notes: m.notes
    })),
    attachments: attachments.map(a => ({
      title: a.fileName,
      docType: documentTypeLabel(a.documentType),
      fileName: a.fileName,
      uploadedAt: a.uploadedAtUtc ? a.uploadedAtUtc.slice(0, 10) : '',
      status: a.status === 'complete' ? 'مستوفاة ✅' : (a.status || '')
    })),
    housing: {
      description: h.description,
      ownership: h.ownership,
      buildingType: h.buildingType,
      walls: h.walls,
      roof: h.roof,
      floor: h.floor,
      entrance: h.entrance,
      roomsCount: h.roomsCount,
      bathroomType: h.bathroomType,
      bathroomCondition: h.bathroomCondition,
      sanitation: h.sanitation,
      electricity: h.electricity,
      water: h.water,
      waterMotor: h.waterMotor,
      transport: h.transport,
      internet: h.internet
    },
    // Backend-confirmed: `utilities[].name` is free text, no fixed enum —
    // rendered as a generic name/available/condition list rather than fixed
    // كهرباء/مياه/غاز/صرف صحي badges. `appliances` lives at the top level
    // (shared with the housing card), not nested here.
    utilities: {
      services: (ut.utilities || []).map(s => ({
        name: s.name, isAvailable: s.isAvailable, condition: s.condition, sourceOrMeter: s.sourceOrMeter, notes: s.notes
      }))
    },
    appliances,
    agriculture: {
      hasLand: ag.hasLand,
      landType: ag.landType,
      landArea: ag.landAreaFeddan,
      landRentAmount: ag.landRentAmount,
      landAnnualIncome: ag.annualLandIncome,
      cropType: ag.cropType,
      hasLivestock: ag.hasLivestock,
      livestockTypes,
      livestockDetails: ag.livestockDetails,
      notes: ag.notes
    },
    financial: {
      incomeItems: (fin.incomeItems || []).map(i => ({
        label: i.label, amount: i.amount, period: i.period, auto: i.isAuto, source: financialSourceLabel(i.source)
      })),
      expenseItems: (fin.expenseItems || []).map(i => ({
        label: i.label, amount: i.amount, period: i.period, auto: i.isAuto, source: financialSourceLabel(i.source)
      })),
      totalIncome: fin.totalIncome,
      totalExpenses: fin.totalExpenses,
      netBalance: fin.netBalance
    },
    assessedNeeds: needs.map(n => ({
      needType: n.needType,
      notes: n.notes
    })),
    support: {
      types: recommendations.map(r => ({
        title: supportTypeLabel(r.supportType),
        option: r.supportCategory,
        amount: r.proposedAmount,
        urgency: r.priorityLevel
      })),
      approvedSupport: approved ? {
        type: supportTypeLabel(approved.approvedSupportType),
        amount: approved.approvedAmount,
        beneficiary: approved.beneficiary,
        approvedAt: approved.approvedAtUtc ? approved.approvedAtUtc.slice(0, 10) : '',
        notes: approved.approvalNotes
      } : null,
      // Actually-disbursed support (distinct from `types`/proposed and
      // `approvedSupport`/the one final decision) — every historical
      // support-type × quantity handed to the recipient, e.g. legacy imports
      // that logged several disbursements over time.
      history: supportHistory.map(hst => ({
        supportType: supportTypeLabel(hst.supportType),
        quantity: hst.quantity,
        recipientName: hst.recipientName,
        date: hst.date || hst.disbursedAtUtc
      }))
    },
    // اسم الباحث الأصلي للحالات المستوردة — يُعرض في بانر «تاريخ الحالة».
    workerAuthorName: (opinions.worker && opinions.worker.authorName) || '',
    workerOpinion: mapOpinion(opinions.worker),
    reviewerOpinion: mapOpinion(opinions.reviewer),
    managerApproval: mapOpinion(opinions.manager)
  };
}

// Cached in-memory for the session — this is a small, rarely-changing chip
// config list (§16: server already caches it in Redis for an hour too).
let applianceLabelsPromise = null;

/** applianceKey -> Arabic label, from GET /dropdowns?step=4&fieldType=chip. */
function loadApplianceLabels() {
  if (!applianceLabelsPromise) {
    applianceLabelsPromise = DropdownsService.listChipOptions({ step: 4, fieldType: 'chip' })
      .then(items => new Map((items || []).map(i => [i.key, i.label])))
      .catch(() => new Map());
  }
  return applianceLabelsPromise;
}

/**
 * Fetches and normalizes a real case by id. Returns null (and toasts) on
 * failure. Uses `GET /cases/{id}/report` rather than plain `GET /cases/{id}`
 * — `data.case` is the identical shape, and this is the one call that also
 * carries `data.legacyRecord` (the original Excel row), needed for both the
 * PDF export and the "البيانات الأصلية" card.
 */
async function loadCaseFromApi(id) {
  try {
    const [reportRes, familyRes, supportRes, attachmentsRes, applianceLabels] = await Promise.all([
      CasesService.getReport(id),
      CasesService.getFamilyMembers(id).catch(() => ({ members: [] })),
      CasesService.getSupport(id).catch(() => ({})),
      AttachmentsService.listForCase(id).catch(() => ({ items: [] })),
      loadApplianceLabels()
    ]);
    const detail = reportRes.case;
    const legacyRecord = reportRes.legacyRecord;
    return normalizeApiCase(detail, familyRes, supportRes, attachmentsRes, applianceLabels, legacyRecord);
  } catch (err) {
    showToast(messageFromError(err));
    return null;
  }
}

/**
 * @param {string|object} caseRef معرّف حالة حقيقية (GUID) تُجلب من الـ API، أو
 *        كائن حالة جاهز (تستخدمه معاينة المسودة القادمة من شاشة الإدخال).
 */
export async function openCaseDetailsPage(caseRef) {
  const isRealId = typeof caseRef === 'string' && caseRef;
  const targetCase = (caseRef && typeof caseRef === 'object')
    ? caseRef
    : await loadCaseFromApi(caseRef);
  if (!targetCase) return;
  currentActiveCase = targetCase;
  timelineCache = null;

  // معاينة المسودة (كائن محلي بلا rawId) مالهاش تاريخ على السيرفر.
  const timelineBtn = DOM.qs('#btn-case-timeline');
  if (timelineBtn) timelineBtn.style.display = targetCase.rawId ? '' : 'none';

  // بنخزّن id الحالة الحقيقية بس (مش مسودة محلية) — عشان لو المستخدم عمل
  // refresh وهو واقف على الصفحة دي، نقدر نجيبها تاني ونعرض نفس الحالة، بدل
  // ما تفضل الصفحة فاضية أو تعرض بيانات placeholder قديمة.
  if (isRealId) {
    StorageService.set(STORAGE_KEYS.LAST_VIEWED_CASE_ID, caseRef);
  }

  const codeEl = DOM.qs('#case-detail-code');
  const pillEl = DOM.qs('#case-detail-status-pill');
  const nameEl = DOM.qs('#case-detail-name');
  const subinfoEl = DOM.qs('#case-detail-subinfo');
  const researcherEl = DOM.qs('#case-detail-researcher');
  const researcherNameEl = DOM.qs('#case-detail-researcher-name');
  const stackEl = DOM.qs('#case-details-stack');

  if (codeEl) codeEl.textContent = targetCase.id;
  if (pillEl) {
    pillEl.className = `dash-status-pill ${targetCase.statusClass}`;
    pillEl.textContent = targetCase.statusLabel;
  }
  if (nameEl) nameEl.textContent = targetCase.name || 'حالة بدون اسم';
  if (subinfoEl) {
    const parts = [
      targetCase.nid ? `الرقم القومي: ${targetCase.nid}` : 'الرقم القومي: لم يُسجّل',
      targetCase.charity,
      [targetCase.center, targetCase.village].filter(Boolean).join(' — ')
    ].filter(Boolean);
    subinfoEl.textContent = parts.join(' — ');
  }
  const researcherName = targetCase.legacyImportData && targetCase.legacyImportData.researcherName;
  if (researcherEl && researcherNameEl) {
    if (researcherName) {
      researcherNameEl.textContent = `الباحث الأصلي لهذه الحالة: ${researcherName}`;
      researcherEl.style.display = 'flex';
    } else {
      researcherEl.style.display = 'none';
    }
  }

  if (stackEl) {
    renderCaseDetailsCards(stackEl, targetCase);
  }

  if (window.switchView) {
    window.switchView('case-details');
  }
}

/* --------------------------------------------------------------------------
   CARD RENDERERS — الأقسام الثمانية بترتيب NEHDA_CASE_MA.md
   -------------------------------------------------------------------------- */

const money = n => `${Number(n || 0).toLocaleString('en-US')} ج.م`;
const yesNo = v => (v ? 'نعم' : 'لا');

/**
 * صف بيانات داخل شبكة القسم.
 * في المسودة الحقل الفارغ يظهر «لم يُسجّل» بدل ما يختفي — عشان الناقص يبان.
 * في الحالة المحفوظة يُخفى كالمعتاد.
 */
function row(label, value) {
  const empty = value === undefined || value === null || value === '' || value === 0;
  if (empty) {
    return DRAFT_MODE
      ? `<div><strong>${label}:</strong> <span class="case-missing">لم يُسجّل</span></div>`
      : '';
  }
  return `<div><strong>${label}:</strong> ${DOM.escapeHTML(String(value))}</div>`;
}

/**
 * وضع المسودة: الملف معروض من شاشة الإدخال وبياناته ناقصة بطبيعتها.
 * يُضبط في بداية كل رسم ويقرأه row() وشارات الأقسام.
 */
let DRAFT_MODE = false;

/** الأقسام الناقصة في المسودة — تُحسب من الحقول الجوهرية لكل قسم. */
function missingSections(c) {
  const d = c.demographics || {};
  const h = c.housing || {};
  const a = c.agriculture || {};
  const f = c.financial || {};
  const out = [];

  if (!c.name || !c.nid || !d.age || !d.address) out.push('البيانات الأساسية');
  if (!(c.familyMembers || []).length) out.push('الأفراد التابعين');
  if (!(c.attachments || []).length) out.push('المرفقات');
  if (!h.ownership && !h.walls && !h.description) out.push('السكن');
  if (!((c.utilities && (c.utilities.services || []).some(s => s.isAvailable)) || (c.appliances || []).length)) out.push('المرافق');
  if (!a.hasLand && !a.hasLivestock) out.push('الحيازة الزراعية');
  if (!(f.incomeItems || []).length && !(f.expenseItems || []).length) out.push('الدخل والمصروفات');
  if (!(c.support && (c.support.types || []).length)) out.push('الدعم');

  return out;
}

/** شارة «ناقص» بجوار عنوان القسم في وضع المسودة. */
function sectionFlag(isMissing) {
  if (!DRAFT_MODE || !isMissing) return '';
  return '<span class="badge case-missing-flag">ناقص</span>';
}

/** قائمة أجهزة على هيئة شارات — يظهر المتوفر فقط، من data.utilities.appliances، بأسماء GET /dropdowns?step=4&fieldType=chip. */
function applianceChips(appliances) {
  const present = (appliances || []).filter(a => a.isPresent);
  if (!present.length) return '<p class="case-page-empty">لا توجد أجهزة متوفرة مسجّلة.</p>';
  return `<div>${present.map(a => `
    <span class="badge case-availability-chip case-availability-chip--on">✓ ${DOM.escapeHTML(a.label)}${a.details ? ` (${DOM.escapeHTML(a.details)})` : ''}</span>
  `).join('')}</div>`;
}

/** شريط تنبيه أعلى الصفحة يلخّص ما ينقص المسودة. */
function draftBanner(c) {
  if (!DRAFT_MODE) return '';
  const missing = missingSections(c);
  if (!missing.length) {
    return `
      <div class="case-draft-banner case-draft-banner--ok">
        <strong>معاينة المسودة</strong>
        <span>كل الأقسام مستوفاة.</span>
      </div>
    `;
  }
  return `
    <div class="case-draft-banner">
      <strong>معاينة المسودة — ${missing.length} أقسام ناقصة</strong>
      <span>${missing.map(m => DOM.escapeHTML(m)).join(' · ')}</span>
    </div>
  `;
}

/* ---------------- 1. البيانات الأساسية + الأفراد التابعين ---------------- */
function renderBasicDataCard(c, gone = () => false) {
  const d = c.demographics || {};
  const members = Array.isArray(c.familyMembers) ? c.familyMembers : [];

  return `
    <div class="glass-card case-page-card">
      <div class="case-page-card__title"><span>👤 1. البيانات الأساسية</span>${sectionFlag(gone('البيانات الأساسية'))}</div>

      <div class="case-page-subtitle">بيانات شخصية</div>
      <div class="case-page-grid">
        ${row('اسم الحالة', c.name)}
        <div><strong>الرقم القومي:</strong> <span class="case-nid">${DOM.escapeHTML(c.nid || '')}</span></div>
        ${row('المؤهل الدراسي', d.education)}
        ${row('العمر', d.age ? `${d.age} سنة` : '')}
        ${row('النوع', d.gender)}
        ${row('الديانة', d.religion)}
        ${row('محافظة الميلاد', d.birthGovernorate)}
        ${row('التليفون الأساسي', d.phonePrimary || c.phone)}
        ${row('التليفون الاحتياطي', d.phoneSecondary || '—')}
        ${row('صلة القرابة', d.headRelation || d.maritalStatus)}
        ${row('الوضع الصحي', d.healthStatus)}
      </div>

      <div class="case-page-subtitle">بيانات وظيفية ومالية</div>
      <div class="case-page-grid">
        ${row('المسمى الوظيفي / المهنة', d.job)}
        ${row('طبيعة العمل', d.employmentStatus)}
        ${row('الدخل الشهري', d.monthlyIncome !== undefined ? money(d.monthlyIncome) : '')}
        <div><strong>مستفيد من تكافل وكرامة:</strong> ${yesNo(d.takafulBeneficiary)}</div>
        ${d.takafulBeneficiary ? row('مبلغ تكافل الشهري', money(d.takafulAmount)) : ''}
      </div>

      <div class="case-page-subtitle">العنوان والجمعية</div>
      <div class="case-page-grid">
        ${row('الجمعية', c.charity)}
        ${row('المركز', c.center)}
        ${row('القرية', c.village)}
        <div style="grid-column: 1 / -1;"><strong>العنوان بالتفصيل:</strong> ${DOM.escapeHTML(d.address || '')}</div>
      </div>

      <div class="case-page-subtitle">
        الأفراد التابعين
        <span class="badge case-page-count">${members.length} فرد</span>
        ${sectionFlag(gone('الأفراد التابعين'))}
      </div>
      ${members.length ? `
        <div class="case-members-list">
          ${members.map(m => `
            <div class="case-member-card">
              <div class="case-member-card__head">
                <strong>${DOM.escapeHTML(m.name || '')}</strong>
                <span class="badge case-member-relation">${DOM.escapeHTML(m.relation || '')}</span>
              </div>
              <div class="case-page-grid case-member-card__body">
                ${row('الرقم القومي', m.nid)}
                ${row('العمر', m.age ? `${m.age} سنة` : '')}
                ${row('النوع', m.gender)}
                ${row('الديانة', m.religion)}
                <div><strong>طالب:</strong> ${yesNo(m.isStudent)}</div>
                ${m.isStudent ? row('المرحلة الدراسية', m.stage) : row('المؤهل الدراسي', m.education)}
                ${m.isStudent ? row('الصف', m.grade) : ''}
                ${m.isStudent && m.university ? row('الجامعة', m.university) : ''}
                ${!m.isStudent ? row('الوظيفة', m.job) : ''}
                ${!m.isStudent ? row('الدخل الشهري', money(m.monthlyIncome)) : ''}
                <div><strong>تكافل وكرامة:</strong> ${yesNo(m.takafulBeneficiary)}</div>
                ${m.takafulBeneficiary ? row('مبلغ تكافل', money(m.takafulAmount)) : ''}
                ${m.notes ? `<div style="grid-column: 1 / -1;"><strong>ملاحظات:</strong> ${DOM.escapeHTML(m.notes)}</div>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      ` : `<p class="case-page-empty">لم يُسجَّل أفراد تابعون لهذه الأسرة.</p>`}
    </div>
  `;
}

/* ------------------------------ 2. المرفقات ------------------------------ */
function renderAttachmentsCard(c, gone = () => false) {
  const items = Array.isArray(c.attachments) ? c.attachments : [];
  return `
    <div class="glass-card case-page-card">
      <div class="case-page-card__title">
        <span>📄 2. المرفقات والوثائق</span>${sectionFlag(gone('المرفقات'))}
        <span class="badge case-page-count">${items.length} مستند</span>
      </div>
      ${items.length ? `
        <div class="case-page-attachments">
          ${items.map(att => `
            <div class="case-page-att-item">
              <div class="case-att-main">
                <span>📎 ${DOM.escapeHTML(att.title || '')}</span>
                <span class="case-att-meta">
                  ${att.docType ? `<span class="badge case-att-type">${DOM.escapeHTML(att.docType)}</span>` : ''}
                  ${att.fileName ? `<span>${DOM.escapeHTML(att.fileName)}</span>` : ''}
                  ${att.uploadedAt ? `<span>· ${DOM.escapeHTML(att.uploadedAt)}</span>` : ''}
                </span>
              </div>
              <span class="badge case-att-status">${DOM.escapeHTML(att.status || '')}</span>
            </div>
          `).join('')}
        </div>
      ` : `<p class="case-page-empty">لا توجد مرفقات مرفوعة.</p>`}
    </div>
  `;
}

/* -------------------------------- 3. السكن -------------------------------- */
function renderHousingCard(c, gone = () => false) {
  const h = c.housing || {};
  return `
    <div class="glass-card case-page-card">
      <div class="case-page-card__title"><span>🏠 3. بيانات السكن</span>${sectionFlag(gone('السكن'))}</div>
      ${h.description ? `<p class="case-page-note">${DOM.escapeHTML(h.description)}</p>` : ''}
      <div class="case-page-grid">
        ${row('طبيعة السكن', h.ownership)}
        ${row('نوع المبنى', h.buildingType)}
        ${row('نوع الحوائط', h.walls)}
        ${row('السقف', h.roof)}
        ${row('الأرضية', h.floor)}
        ${row('المدخل', h.entrance)}
        ${row('عدد الغرف', h.roomsCount)}
        ${row('طبيعة دورات المياه', h.bathroomType)}
        ${row('حالة دورات المياه', h.bathroomCondition)}
        ${row('الصرف الصحي', h.sanitation)}
        ${row('الكهرباء', h.electricity)}
        ${row('المياه', h.water)}
        <div><strong>موتور المياه:</strong> ${yesNo(h.waterMotor)}</div>
        ${row('وسيلة المواصلات', h.transport)}
        <div><strong>الإنترنت:</strong> ${yesNo(h.internet)}</div>
      </div>
      <div class="case-page-subtitle">الأجهزة المنزلية</div>
      ${applianceChips(c.appliances)}
    </div>
  `;
}

/* ------------------------ 4. المرافق والتجهيزات ------------------------ */
function renderUtilitiesCard(c, gone = () => false) {
  const u = c.utilities || {};
  const services = Array.isArray(u.services) ? u.services : [];

  const serviceRow = s => `
    <div class="case-page-att-item">
      <div class="case-att-main">
        <span>${s.isAvailable ? '✓' : '—'} ${DOM.escapeHTML(s.name)}</span>
        <span class="case-att-meta">
          ${s.condition ? `<span class="badge case-att-type">${DOM.escapeHTML(s.condition)}</span>` : ''}
          ${s.sourceOrMeter ? `<span>${DOM.escapeHTML(s.sourceOrMeter)}</span>` : ''}
          ${s.notes ? `<span>· ${DOM.escapeHTML(s.notes)}</span>` : ''}
        </span>
      </div>
    </div>
  `;

  return `
    <div class="glass-card case-page-card">
      <div class="case-page-card__title"><span>⚡ 4. المرافق والتجهيزات</span>${sectionFlag(gone('المرافق'))}</div>
      <div class="case-page-subtitle">المرافق الأساسية</div>
      ${services.length ? `<div class="case-page-attachments">${services.map(serviceRow).join('')}</div>` : `<p class="case-page-empty">لا توجد بيانات مرافق مسجّلة.</p>`}
      <div class="case-page-subtitle" style="margin-top: 12px;">الأجهزة والممتلكات المنزلية</div>
      ${applianceChips(c.appliances)}
    </div>
  `;
}

/* --------------------- 5. الحيازة والأصول الزراعية --------------------- */
function renderAgricultureCard(c, gone = () => false) {
  const a = c.agriculture || {};
  const hasLand = a.hasLand === 'yes';
  const hasLivestock = a.hasLivestock === 'yes';

  return `
    <div class="glass-card case-page-card">
      <div class="case-page-card__title"><span>🌾 5. الحيازة والأصول الزراعية</span>${sectionFlag(gone('الحيازة الزراعية'))}</div>

      <div class="case-page-subtitle">الأرض الزراعية</div>
      <div class="case-page-grid">
        <div><strong>تملك أو تستأجر أرض زراعية:</strong> ${hasLand ? 'نعم' : 'لا'}</div>
        ${hasLand ? row('نوع الحيازة', a.landType) : ''}
        ${hasLand ? row('مساحة الأرض', a.landArea ? `${a.landArea} فدان` : '') : ''}
        ${hasLand && a.landType === 'إيجار' ? row('قيمة الإيجار', money(a.landRentAmount)) : ''}
        ${hasLand && a.landType === 'تمليك' ? row('الدخل السنوي من الأرض', money(a.landAnnualIncome)) : ''}
        ${hasLand ? row('نوع الزراعة', a.cropType) : ''}
      </div>

      <div class="case-page-subtitle">المواشي والأصول الحيوانية</div>
      <div class="case-page-grid">
        <div><strong>تمتلك مواشي:</strong> ${hasLivestock ? 'نعم' : 'لا'}</div>
        ${hasLivestock && (a.livestockTypes || []).length
          ? `<div style="grid-column: 1 / -1;"><strong>نوع المواشي:</strong> ${a.livestockTypes.map(t => `<span class="badge case-livestock-chip">${DOM.escapeHTML(t)}</span>`).join('')}</div>`
          : ''}
        ${hasLivestock && a.livestockDetails
          ? `<div style="grid-column: 1 / -1;"><strong>تفاصيل إضافية:</strong> ${DOM.escapeHTML(a.livestockDetails)}</div>`
          : ''}
      </div>

      ${a.notes ? `<p class="case-page-note" style="margin-top: 14px;"><strong>ملاحظات عامة:</strong> ${DOM.escapeHTML(a.notes)}</p>` : ''}
    </div>
  `;
}

/* ------------------------ 6. الدخل والمصروفات ------------------------ */
function renderFinancialCard(c, gone = () => false) {
  const f = c.financial || {};
  const income = Array.isArray(f.incomeItems) ? f.incomeItems : [];
  const expenses = Array.isArray(f.expenseItems) ? f.expenseItems : [];

  const line = (item, isIncome) => `
    <div class="case-fin-row">
      <div class="case-fin-row__label">
        ${item.auto ? '<span title="بند تلقائي من قسم آخر">🔒</span> ' : ''}${DOM.escapeHTML(item.label)}
        ${item.source ? `<span class="case-fin-source">${DOM.escapeHTML(item.source)}</span>` : ''}
      </div>
      <div class="case-fin-row__amount" style="color: ${isIncome ? '#047857' : '#be123c'};">
        ${money(item.amount)}${item.period ? ` <span class="case-fin-period">/ ${DOM.escapeHTML(item.period)}</span>` : ''}
      </div>
    </div>
  `;

  const net = Number(f.netBalance || 0);

  return `
    <div class="glass-card case-page-card">
      <div class="case-page-card__title"><span>💰 6. الدخل والمصروفات</span>${sectionFlag(gone('الدخل والمصروفات'))}</div>

      <div class="case-page-subtitle">مصادر الدخل</div>
      <div class="case-fin-list">${income.map(i => line(i, true)).join('')}</div>

      <div class="case-page-subtitle">بنود المصروفات</div>
      <div class="case-fin-list">${expenses.map(i => line(i, false)).join('')}</div>

      <div class="case-page-subtitle">الملخص المالي</div>
      <div class="case-fin-summary">
        <div class="case-fin-stat">
          <span class="case-fin-stat__label">إجمالي الدخل الشهري</span>
          <span class="case-fin-stat__val" style="color: #047857;">${money(f.totalIncome)}</span>
        </div>
        <div class="case-fin-stat">
          <span class="case-fin-stat__label">إجمالي المصروفات الشهرية</span>
          <span class="case-fin-stat__val" style="color: #be123c;">${money(f.totalExpenses)}</span>
        </div>
        <div class="case-fin-stat">
          <span class="case-fin-stat__label">صافي الدخل</span>
          <span class="case-fin-stat__val" style="color: ${net < 0 ? '#be123c' : '#047857'};">${money(net)}</span>
        </div>
      </div>
    </div>
  `;
}

/* -------------------------------- 7. الدعم -------------------------------- */
function renderAssessedNeedsCard(c, gone = () => false) {
  const needs = Array.isArray(c.assessedNeeds) ? c.assessedNeeds : [];
  if (!needs.length) return '';

  return `
    <div class="glass-card case-page-card">
      <div class="case-page-card__title"><span>📌 الاحتياجات المقيَّمة</span>${sectionFlag(gone('الاحتياجات'))}</div>
      <div class="case-support-list">
        ${needs.map(n => `
          <div class="case-support-item">
            <div>
              <strong class="case-support-item__title">${DOM.escapeHTML(n.needType || '')}</strong>
            </div>
            ${n.notes ? `<span class="case-support-option">${DOM.escapeHTML(n.notes)}</span>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderSupportCard(c, gone = () => false) {
  const s = c.support || {};
  const types = Array.isArray(s.types) ? s.types : [];
  const approved = s.approvedSupport;
  const history = Array.isArray(s.history) ? s.history : [];

  return `
    <div class="glass-card case-page-card">
      <div class="case-page-card__title"><span>🤝 7. الدعم</span>${sectionFlag(gone('الدعم'))}</div>

      <div class="case-page-subtitle">أنواع الدعم المقترحة من الأخصائي</div>
      ${types.length ? `
        <div class="case-support-list">
          ${types.map(t => `
            <div class="case-support-item">
              <div>
                <strong class="case-support-item__title">${DOM.escapeHTML(t.title || '')}</strong>
                ${t.option ? `<span class="case-support-option">${DOM.escapeHTML(t.option)}</span>` : ''}
                ${t.amount ? `<span class="case-support-amount">${DOM.escapeHTML(t.amount)}</span>` : ''}
              </div>
              ${t.urgency ? `<span class="badge case-support-urgency">${DOM.escapeHTML(t.urgency)}</span>` : ''}
            </div>
          `).join('')}
        </div>
      ` : `<p class="case-page-empty">لم يُقترح أي نوع دعم (الحالة غير مستحقة).</p>`}

      ${s.notes ? `<p class="case-page-note" style="margin-top: 12px;"><strong>ملاحظات:</strong> ${DOM.escapeHTML(s.notes)}</p>` : ''}

      ${approved ? `
        <div class="case-approved-support">
          <div class="case-approved-support__title">✅ الدعم المعتمد <span class="badge case-readonly-badge">للعرض فقط</span></div>
          <div class="case-page-grid">
            ${row('نوع الدعم المعتمد', approved.type)}
            ${row('المبلغ', approved.amount)}
            ${row('المستفيد', approved.beneficiary)}
            ${row('تاريخ الاعتماد', approved.approvedAt)}
            ${approved.notes ? `<div style="grid-column: 1 / -1;"><strong>ملاحظات:</strong> ${DOM.escapeHTML(approved.notes)}</div>` : ''}
          </div>
        </div>
      ` : ''}

      ${history.length ? `
        <div class="case-page-subtitle" style="margin-top: 12px;">الدعم المصروف فعليًا</div>
        <div class="case-support-list">
          ${history.map(hst => `
            <div class="case-support-item">
              <div>
                <strong class="case-support-item__title">${DOM.escapeHTML(hst.supportType || '')}</strong>
                ${hst.quantity !== undefined && hst.quantity !== null ? `<span class="case-support-amount">${DOM.escapeHTML(String(hst.quantity))}</span>` : ''}
              </div>
              ${hst.recipientName ? `<span class="badge">${DOM.escapeHTML(hst.recipientName)}</span>` : ''}
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function renderCaseDetailsCards(container, c) {
  DRAFT_MODE = Boolean(c.isDraft);
  const missing = DRAFT_MODE ? missingSections(c) : [];
  const gone = name => missing.includes(name);

  container.innerHTML = `
    ${draftBanner(c)}
    ${renderBasicDataCard(c, gone)}
    ${renderAttachmentsCard(c, gone)}
    ${renderHousingCard(c, gone)}
    ${renderUtilitiesCard(c, gone)}
    ${renderAgricultureCard(c, gone)}
    ${renderFinancialCard(c, gone)}
    ${renderAssessedNeedsCard(c, gone)}
    ${renderSupportCard(c, gone)}

    <!-- 8. الرأي — قسم واحد بثلاث خانات: الأخصائي (عرض) / المراجع / المدير -->
    ${renderWorkerOpinionCard(c)}
    ${renderReviewerOpinionCard(c)}
    ${renderManagerApprovalCard(c)}
  `;

  bindOpinionForms(container, c);
}

/* --------------------------------------------------------------------------
   OPINION PANELS
   ثلاث خانات منفصلة، كل دور يكتب في خانته وحده:
     رأي الأخصائي  -> يُسجَّل من تطبيق الأخصائي الميداني (عرض فقط في الويب)
     رأي المراجع   -> يكتبه المراجع بعد رأي الأخصائي
     اعتماد المدير -> يكتبه المدير بعد رأي المراجع، وبيقفل الآراء كلها
   -------------------------------------------------------------------------- */

const DECISION_META = {
  accepted: { label: '🟢 مقبولة', color: '#047857', bg: 'rgba(16, 185, 129, 0.15)' },
  rejected: { label: '🔴 مرفوضة', color: '#be123c', bg: 'rgba(225, 29, 72, 0.15)' },
  returned_to_worker: { label: '🟡 معادة للأخصائي', color: '#b45309', bg: 'rgba(217, 119, 6, 0.15)' },
  approved: { label: '🟢 معتمدة نهائياً', color: '#047857', bg: 'rgba(16, 185, 129, 0.15)' }
};

/** Badge showing a recorded decision, or a muted "not recorded yet" note. */
function decisionBadge(decision) {
  const meta = DECISION_META[decision];
  if (!meta) {
    return `<span class="badge" style="background: rgba(100, 116, 139, 0.15); color: #475569; font-weight: 800; font-size: 13px;">لم يُسجَّل بعد</span>`;
  }
  return `<span class="badge" style="background: ${meta.bg}; color: ${meta.color}; font-weight: 800; font-size: 13px;">${meta.label}</span>`;
}

/** Author + date line under a recorded opinion — hidden for legacy-imported opinions (no real author name). */
function opinionMeta(opinion) {
  if (!opinion || !opinion.author || opinion.isLegacyImport) return '';
  return `
    <div style="margin-top: 10px; font-size: 12px; color: #64748b; font-weight: 700;">
      ✍️ ${DOM.escapeHTML(opinion.author)}${opinion.date ? ` — ${DOM.escapeHTML(opinion.date)}` : ''}
    </div>
  `;
}

/** A locked panel explaining why the current user cannot write here. */
function lockedNotice(reason) {
  return `
    <div style="display: flex; align-items: center; gap: 10px; padding: 14px 16px; background: rgba(241, 245, 249, 0.9); border: 1px dashed rgba(100, 116, 139, 0.45); border-radius: 12px; color: #475569; font-size: 14px; font-weight: 700;">
      <span style="font-size: 18px;">🔒</span>
      <span>${DOM.escapeHTML(reason)}</span>
    </div>
  `;
}

/* -------------------------- Card 8: رأي الأخصائي -------------------------- */
function renderWorkerOpinionCard(c) {
  const op = c.workerOpinion;
  const recorded = Boolean(op && op.decision);

  return `
    <div class="glass-card case-page-card" style="border: 1.5px solid rgba(13, 148, 136, 0.4); background: rgba(240, 253, 250, 0.95);">
      <div class="case-page-card__title" style="color: #0f766e; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
        <span>🏠 8. الرأي — رأي الأخصائي الاجتماعي الميداني</span>
        ${decisionBadge(op && op.decision)}
      </div>
      ${recorded ? `
        <p style="font-size: 15px; line-height: 1.8; color: #134e4a; margin: 0; font-weight: 600; padding: 12px; background: rgba(255,255,255,0.75); border-radius: 12px;">
          "${DOM.escapeHTML(op.notes)}"
        </p>
        ${opinionMeta(op)}
      ` : lockedNotice('لم يسجّل الأخصائي الميداني رأيه بعد — يُسجَّل من تطبيق الأخصائي')}
      <div style="margin-top: 12px; font-size: 12px; color: #0f766e; font-weight: 700;">
        📱 هذه الخانة تُملأ من تطبيق الأخصائي الميداني وتظهر هنا للاطّلاع فقط
      </div>
    </div>
  `;
}

/* -------------------------- Card 10: رأي المراجع -------------------------- */
function renderReviewerOpinionCard(c) {
  const op = c.reviewerOpinion;
  const recorded = Boolean(op && op.decision);
  const gate = canWriteOpinion('reviewer', c);

  return `
    <div class="glass-card case-page-card reviewer-decision-panel" style="border: 2px solid rgba(37, 99, 235, 0.5); background: linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(239, 246, 255, 0.95) 100%);">
      <div class="case-page-card__title" style="color: #1d4ed8; font-size: 17px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
        <span>⚖️ 8. الرأي — رأي المراجع وإحالة المعاملة</span>
        ${decisionBadge(op && op.decision)}
      </div>

      ${recorded ? `
        <p style="font-size: 15px; line-height: 1.8; color: #1e3a8a; margin: 0 0 14px; font-weight: 600; padding: 12px; background: rgba(255,255,255,0.8); border-radius: 12px;">
          "${DOM.escapeHTML(op.notes)}"
        </p>
        ${opinionMeta(op)}
      ` : ''}

      ${gate.allowed ? `
        <form id="reviewer-decision-form" style="display: flex; flex-direction: column; gap: 16px; ${recorded ? 'margin-top: 16px; padding-top: 16px; border-top: 1px dashed rgba(37, 99, 235, 0.3);' : ''}">
          <div>
            <label style="display: block; font-size: 14px; font-weight: 800; color: #0f172a; margin-bottom: 10px;">
              ${recorded ? 'تعديل القرار المسجَّل:' : 'حدد القرار والتوجيه للملف المعروض:'}
            </label>
            <div class="reviewer-options-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;">
              <label class="reviewer-option-card reviewer-option-card--accept">
                <input type="radio" name="reviewer_decision" value="accepted" ${op && op.decision === 'accepted' ? 'checked' : ''} required>
                <div class="option-content">
                  <span class="option-title">🟢 توصية بالقبول</span>
                  <span class="option-desc">أؤيد استحقاق الحالة وأرفعها للمدير للاعتماد</span>
                </div>
              </label>

              <label class="reviewer-option-card reviewer-option-card--reject">
                <input type="radio" name="reviewer_decision" value="rejected" ${op && op.decision === 'rejected' ? 'checked' : ''}>
                <div class="option-content">
                  <span class="option-title">🔴 توصية بالرفض</span>
                  <span class="option-desc">الحالة غير مستحقة — يُرفع الرأي للمدير</span>
                </div>
              </label>

              <label class="reviewer-option-card reviewer-option-card--return">
                <input type="radio" name="reviewer_decision" value="returned_to_worker" ${op && op.decision === 'returned_to_worker' ? 'checked' : ''}>
                <div class="option-content">
                  <span class="option-title">🟡 إعادة للأخصائي استيفاء</span>
                  <span class="option-desc">إعادة الملف للأخصائي لمزيد من البحث بالميدان</span>
                </div>
              </label>
            </div>
          </div>

          <div>
            <label for="reviewer-notes" style="display: block; font-size: 14px; font-weight: 800; color: #0f172a; margin-bottom: 6px;">رأي وملاحظات المراجع والتوصية النصية:</label>
            <textarea id="reviewer-notes" class="dash-search-input" rows="3" placeholder="أدخل رأيك وتوصياتك كمراجع هنا تفصيلياً..." dir="rtl" style="height: auto; padding: 12px; font-size: 14px; font-family: inherit; width: 100%; box-sizing: border-box;">${op && op.notes ? DOM.escapeHTML(op.notes) : ''}</textarea>
          </div>

          <!-- أزرار الحفظ والإرسال عائمة أسفل الشاشة -->
        </form>
      ` : (recorded ? '' : lockedNotice(gate.reason))}
    </div>
  `;
}

/* ---------------------- Card 11: الاعتماد النهائي للمدير ---------------------- */
function renderManagerApprovalCard(c) {
  const op = c.managerApproval;
  const recorded = Boolean(op && op.decision);
  const gate = canWriteOpinion('manager', c);

  return `
    <div class="glass-card case-page-card reviewer-decision-panel" style="border: 2px solid rgba(16, 185, 129, 0.55); background: linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(236, 253, 245, 0.95) 100%);">
      <div class="case-page-card__title" style="color: #047857; font-size: 17px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
        <span>👑 8. الرأي — الاعتماد النهائي لمدير التنمية</span>
        ${decisionBadge(op && op.decision)}
      </div>

      ${recorded ? `
        <p style="font-size: 15px; line-height: 1.8; color: #065f46; margin: 0 0 14px; font-weight: 600; padding: 12px; background: rgba(255,255,255,0.8); border-radius: 12px;">
          "${DOM.escapeHTML(op.notes)}"
        </p>
        ${opinionMeta(op)}
        <div style="margin-top: 12px; font-size: 12px; color: #047857; font-weight: 700;">
          🔒 تم الاعتماد النهائي — خانات الآراء مقفولة، وبيانات الحالة تظل قابلة للتصحيح
        </div>
      ` : (gate.allowed ? `
        <form id="manager-approval-form" style="display: flex; flex-direction: column; gap: 16px;">
          <div>
            <label style="display: block; font-size: 14px; font-weight: 800; color: #0f172a; margin-bottom: 10px;">القرار النهائي في الحالة:</label>
            <div class="reviewer-options-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;">
              <label class="reviewer-option-card reviewer-option-card--accept">
                <input type="radio" name="manager_decision" value="approved" required>
                <div class="option-content">
                  <span class="option-title">🟢 اعتماد وصرف الدعم</span>
                  <span class="option-desc">قبول نهائي وتوجيه الدعم المالي والعيني</span>
                </div>
              </label>

              <label class="reviewer-option-card reviewer-option-card--reject">
                <input type="radio" name="manager_decision" value="rejected">
                <div class="option-content">
                  <span class="option-title">🔴 رفض نهائي</span>
                  <span class="option-desc">إغلاق الملف وتصنيف الحالة غير مستحقة</span>
                </div>
              </label>

              <label class="reviewer-option-card reviewer-option-card--return">
                <input type="radio" name="manager_decision" value="returned_to_worker">
                <div class="option-content">
                  <span class="option-title">🟡 إعادة لاستيفاء</span>
                  <span class="option-desc">إرجاع الملف لدورة مراجعة جديدة</span>
                </div>
              </label>
            </div>
          </div>

          <div>
            <label for="manager-notes" style="display: block; font-size: 14px; font-weight: 800; color: #0f172a; margin-bottom: 6px;">حيثيات القرار وملاحظات المدير:</label>
            <textarea id="manager-notes" class="dash-search-input" rows="3" placeholder="أدخل حيثيات القرار النهائي..." dir="rtl" style="height: auto; padding: 12px; font-size: 14px; font-family: inherit; width: 100%; box-sizing: border-box;"></textarea>
          </div>

          <!-- أزرار الموافقة والرفض عائمة أسفل الشاشة -->
        </form>
      ` : lockedNotice(gate.reason))}
    </div>
  `;
}

/* --------------------------------------------------------------------------
   FLOATING ACTIONS + FORM BINDING
   المراجع: «حفظ كمسودة» و«إرسال للمدير» — الحفظ يخزّن الرأي وهو تحت يده،
   والإرسال يقفله ويحوّل الحالة لقائمة المدير.
   المدير: «موافقة» و«رفض» — قرار نهائي يقفل كل خانات الرأي.
   -------------------------------------------------------------------------- */

/** Reflect a case's status onto the page header pill. */
function syncStatusPill(c) {
  const pillEl = DOM.qs('#case-detail-status-pill');
  if (pillEl) {
    pillEl.className = `dash-status-pill ${c.statusClass}`;
    pillEl.textContent = c.statusLabel;
  }
}

/** قراءة ما كتبه المراجع في اللوحة. */
function readReviewerInput(container) {
  const form = container.querySelector('#reviewer-decision-form');
  if (!form) return null;
  return {
    decision: form.querySelector('input[name="reviewer_decision"]:checked')?.value || '',
    notes: (container.querySelector('#reviewer-notes')?.value || '').trim()
  };
}

/** قراءة ما كتبه المدير في اللوحة. */
function readManagerInput(container) {
  const form = container.querySelector('#manager-approval-form');
  if (!form) return null;
  return {
    decision: form.querySelector('input[name="manager_decision"]:checked')?.value || '',
    notes: (container.querySelector('#manager-notes')?.value || '').trim()
  };
}

/** يطبّق نتيجة API (status/caseRowVersion) على الحالة المحلية ويعيد الرسم. */
function applyOpinionResult(container, c, result, opinionField) {
  c.caseRowVersion = result.caseRowVersion;
  c[opinionField] = {
    decision: result.decision,
    notes: result.notes || '',
    author: (store.currentUser || {}).name || '',
    date: formatLocalDate(),
    submitted: result.isSubmitted
  };
  const statusMeta = STATUS_META[result.status];
  if (statusMeta) {
    c.status = result.status;
    c.statusLabel = statusMeta.label;
    c.statusClass = statusMeta.cls;
  }
  timelineCache = null;
  syncStatusPill(c);
  renderCaseDetailsCards(container, c);
  EventBus.emit(EVENTS.CASE_UPDATED, c);
}

/** رأي عارض عام لو فشل الطلب بتعارض rowVersion — يعيد الجلب ويحدّث اللوحة. */
async function refreshAfterConflict(container, c) {
  try {
    const fresh = await CasesService.getById(c.rawId);
    c.caseRowVersion = fresh.rowVersion;
    const opinions = fresh.opinions || {};
    if (opinions.reviewer) c.reviewerOpinion = mapOpinion(opinions.reviewer);
    if (opinions.manager) c.managerApproval = mapOpinion(opinions.manager);
    const statusMeta = STATUS_META[fresh.status];
    if (statusMeta) {
      c.status = fresh.status;
      c.statusLabel = statusMeta.label;
      c.statusClass = statusMeta.cls;
    }
    timelineCache = null;
    syncStatusPill(c);
    renderCaseDetailsCards(container, c);
  } catch {
    // فشل إعادة الجلب نفسها — يترك المستخدم يعيد تحميل الصفحة يدويًا.
  }
}

/** كتابة رأي المراجع — مسودة أو مُرسَل. */
async function commitReviewerOpinion(container, c, { submit }) {
  const input = readReviewerInput(container);
  if (!input) return false;

  if (!input.decision) {
    showToast('الرجاء تحديد قرار المراجع أولاً ⚠️');
    return false;
  }
  if (!input.notes) {
    showToast('الرجاء كتابة رأي المراجع وملاحظاته ⚠️');
    return false;
  }

  const idempotencyKey = crypto.randomUUID();
  try {
    const result = await CasesService.submitReviewerOpinion(c.rawId, {
      decision: input.decision,
      notes: input.notes,
      isSubmitted: Boolean(submit),
      caseRowVersion: c.caseRowVersion
    }, idempotencyKey);

    applyOpinionResult(container, c, result, 'reviewerOpinion');
    showToast(submit
      ? 'تم إرسال رأي المراجع للمدير للاعتماد ⚖️'
      : 'تم حفظ رأي المراجع كمسودة — لم يُرسل للمدير بعد 📝');
    return true;
  } catch (err) {
    showToast(messageFromError(err), 'error');
    if (err && err.code === 'CONCURRENCY_CONFLICT') {
      await refreshAfterConflict(container, c);
    }
    return false;
  }
}

/** كتابة قرار المدير النهائي — اعتماد/رفض (opinions/manager) أو إرجاع لاستكمال البيانات (return-for-completion). */
async function commitManagerDecision(container, c, decision) {
  const input = readManagerInput(container);
  if (!input) return false;

  if (!input.notes) {
    showToast('الرجاء كتابة حيثيات القرار قبل الاعتماد ⚠️');
    return false;
  }

  const idempotencyKey = crypto.randomUUID();

  if (decision === 'returned_to_worker') {
    try {
      const result = await CasesService.returnForCompletion(c.rawId, {
        caseRowVersion: c.caseRowVersion,
        reason: input.notes
      }, idempotencyKey);

      c.caseRowVersion = result.caseRowVersion;
      c.managerApproval = null;
      c.reviewerOpinion = null;
      timelineCache = null;
      const statusMeta = STATUS_META[result.status];
      if (statusMeta) {
        c.status = result.status;
        c.statusLabel = statusMeta.label;
        c.statusClass = statusMeta.cls;
      }
      syncStatusPill(c);
      renderCaseDetailsCards(container, c);
      EventBus.emit(EVENTS.CASE_UPDATED, c);
      showToast('تم إرجاع الحالة لدورة مراجعة جديدة 🟡');
      return true;
    } catch (err) {
      showToast(messageFromError(err), 'error');
      if (err && err.code === 'CONCURRENCY_CONFLICT') {
        await refreshAfterConflict(container, c);
      }
      return false;
    }
  }

  try {
    const result = await CasesService.submitManagerDecision(c.rawId, {
      approve: decision === 'approved',
      notes: input.notes,
      caseRowVersion: c.caseRowVersion
    }, idempotencyKey);

    applyOpinionResult(container, c, result, 'managerApproval');
    showToast(`تم اعتماد القرار النهائي: ${decision === 'approved' ? 'قبول الحالة 🟢' : 'رفض الحالة 🔴'}`);
    return true;
  } catch (err) {
    showToast(messageFromError(err), 'error');
    if (err && err.code === 'CONCURRENCY_CONFLICT') {
      await refreshAfterConflict(container, c);
    }
    return false;
  }
}

/* --------------------------------------------------------------------------
   CASE TIMELINE — «تاريخ الحالة»
   مراحل سير العمل الإدارية للحالة (مين عمل إيه وإمتى) من
   GET /cases/{id}/timeline. بيتجاب لما الزرار يتضغط بس، مش مع فتح الحالة.
   الملخص (7 مراحل ثابتة) جاهز من السيرفر، والأحداث الكاملة تحته بالترتيب.
   -------------------------------------------------------------------------- */

/** أيقونة ولون كل نوع حدث — الاعتماد على `type` الثابت، مش على `label`. */
const TIMELINE_EVENT_META = {
  created: { icon: '🆕', tone: 'neutral' },
  created_self_assigned: { icon: '📱', tone: 'info' },
  assigned: { icon: '👤', tone: 'info' },
  assignment_accepted: { icon: '✅', tone: 'info' },
  self_assigned: { icon: '🙋', tone: 'info' },
  assignment_rejected: { icon: '⛔', tone: 'warning' },
  submitted_to_reviewer: { icon: '📤', tone: 'info' },
  reviewer_draft_saved: { icon: '📝', tone: 'neutral' },
  returned_to_worker: { icon: '↩️', tone: 'warning' },
  sent_to_manager: { icon: '⚖️', tone: 'info' },
  returned_for_completion: { icon: '↩️', tone: 'warning' },
  approved: { icon: '🟢', tone: 'success' },
  rejected: { icon: '🔴', tone: 'danger' },
  approved_override: { icon: '🟢', tone: 'success' },
  rejected_override: { icon: '🔴', tone: 'danger' },
  worker_opinion_edited: { icon: '✏️', tone: 'neutral' }
};

// مسودات المراجع مالهاش معنى في المسار الإداري — بتستخبى من القائمة.
const HIDDEN_TIMELINE_EVENTS = new Set(['reviewer_draft_saved']);
const OVERRIDE_TIMELINE_EVENTS = new Set(['approved_override', 'rejected_override']);

function bindTimelineButton() {
  const btn = DOM.qs('#btn-case-timeline');
  const label = DOM.qs('#btn-case-timeline-text');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const c = currentActiveCase;
    if (!c || !c.rawId) {
      showToast('لا توجد حالة محفوظة لعرض تاريخها');
      return;
    }
    if (btn.disabled) return;

    if (timelineCache && timelineCache.caseId === c.rawId) {
      openTimelineModal(timelineCache.data, c);
      return;
    }

    btn.disabled = true;
    const originalText = label ? label.textContent : 'تاريخ الحالة';
    if (label) label.textContent = 'جاري التحميل...';

    try {
      const data = await CasesService.getTimeline(c.rawId);
      // لو المستخدم فتح حالة تانية أثناء الطلب، مانعرضش تاريخ حالة قديمة.
      if (currentActiveCase !== c) return;
      timelineCache = { caseId: c.rawId, data };
      openTimelineModal(data, c);
    } catch (err) {
      showToast(messageFromError(err), 'error');
    } finally {
      btn.disabled = false;
      if (label) label.textContent = originalText;
    }
  });
}

/** اسم الشخص ودوره بالعربي — `{id, name, email, role}` من السيرفر. */
function timelinePerson(p) {
  if (!p || !p.name) return '<span class="case-tl-muted">غير معروف</span>';
  const role = ROLE_LABELS[p.role];
  return `<strong>${DOM.escapeHTML(p.name)}</strong>${role ? ` <span class="case-tl-role">(${DOM.escapeHTML(role)})</span>` : ''}`;
}

function timelineBadge(text, tone) {
  return `<span class="badge case-tl-badge case-tl-badge--${tone}">${DOM.escapeHTML(text)}</span>`;
}

function timelineNote(note) {
  if (!note) return '';
  return `<p class="case-tl-note">${DOM.escapeHTML(note)}</p>`;
}

/**
 * مراحل الملخص السبعة بالترتيب. `step` = عنصر الملخص (null لو لسه ماحصلش)،
 * و`lines` بتُبنى بس لو المرحلة حصلت.
 */
function timelineSummarySteps(s) {
  const assigned = s.assigned;
  const returned = s.lastReturned;
  const first = s.firstSentToReviewer;
  const last = s.lastSentToReviewer;
  const decision = s.decision;
  // لو اتبعتت للمراجع مرة واحدة، lastSentToReviewer = firstSentToReviewer.
  const resent = Boolean(last && (!first || last.at !== first.at));

  return [
    {
      icon: '🆕',
      title: 'إنشاء الحالة',
      step: s.created,
      lines: () => [`بواسطة ${timelinePerson(s.created.by)}`]
    },
    {
      icon: '👤',
      title: 'الإسناد للأخصائي',
      step: assigned,
      badges: () => (assigned.selfAssigned ? [timelineBadge('كلّف نفسه', 'info')] : []),
      lines: () => (assigned.selfAssigned
        ? [`الأخصائي ${timelinePerson(assigned.to)}`]
        : [
          `أسندها ${timelinePerson(assigned.by)} إلى ${timelinePerson(assigned.to)}`,
          assigned.acceptedAt
            ? `قبل الأخصائي الإسناد: ${DOM.escapeHTML(formatCairoDateTime(assigned.acceptedAt))}`
            : '<span class="case-tl-warn">لم يقبل الأخصائي الإسناد بعد</span>'
        ])
    },
    {
      icon: '📤',
      title: 'الإرسال للمراجع',
      step: first,
      lines: () => [`أرسلها ${timelinePerson(first.by)}`]
    },
    {
      icon: '↩️',
      title: 'آخر إرجاع للأخصائي',
      step: returned,
      pendingText: 'لم تُرجع للأخصائي',
      badges: () => [timelineBadge(returned.returnedBy === 'manager' ? 'من المدير' : 'من المراجع', 'warning')],
      lines: () => [`أعادها ${timelinePerson(returned.by)}`],
      note: () => returned.reason
    },
    // إعادة الإرسال بتظهر بس لو حصل فعلاً إرسال تاني بعد إرجاع.
    ...(resent ? [{
      icon: '🔁',
      title: 'إعادة الإرسال للمراجع',
      step: last,
      lines: () => [`أرسلها ${timelinePerson(last.by)}`]
    }] : []),
    {
      icon: '⚖️',
      title: 'الإرسال للمدير',
      step: s.sentToManager,
      lines: () => [`أرسلها ${timelinePerson(s.sentToManager.by)}`]
    },
    {
      icon: decision && decision.decision === 'rejected' ? '🔴' : '🟢',
      title: 'قرار المدير',
      step: decision,
      badges: () => [
        decision.decision === 'rejected' ? timelineBadge('مرفوضة', 'danger') : timelineBadge('معتمدة', 'success'),
        ...(decision.isOverride ? [timelineBadge('قرار استثنائي', 'warning')] : [])
      ],
      lines: () => [`${decision.decision === 'rejected' ? 'رفضها' : 'اعتمدها'} ${timelinePerson(decision.by)}`]
    }
  ];
}

function renderTimelineSummary(summary) {
  const steps = timelineSummarySteps(summary || {});
  return `
    <ol class="case-tl-steps">
      ${steps.map(st => {
        if (!st.step) {
          return `
            <li class="case-tl-step case-tl-step--pending">
              <span class="case-tl-step__icon">${st.icon}</span>
              <div class="case-tl-step__body">
                <div class="case-tl-step__head"><span class="case-tl-step__title">${st.title}</span></div>
                <div class="case-tl-muted">${st.pendingText || 'لم تتم بعد'}</div>
              </div>
            </li>
          `;
        }
        const badges = st.badges ? st.badges().join('') : '';
        return `
          <li class="case-tl-step">
            <span class="case-tl-step__icon">${st.icon}</span>
            <div class="case-tl-step__body">
              <div class="case-tl-step__head"><span class="case-tl-step__title">${st.title}</span>${badges}</div>
              <div class="case-tl-time">🕒 ${DOM.escapeHTML(formatCairoDateTime(st.step.at))}</div>
              ${st.lines().map(l => `<div class="case-tl-line">${l}</div>`).join('')}
              ${st.note ? timelineNote(st.note()) : ''}
            </div>
          </li>
        `;
      }).join('')}
    </ol>
  `;
}

function renderTimelineEvents(events) {
  const visible = (events || []).filter(e => !HIDDEN_TIMELINE_EVENTS.has(e.type));
  if (!visible.length) return '<p class="case-page-empty">لا توجد أحداث مسجّلة على الحالة بعد.</p>';

  return `
    <ol class="case-tl-events">
      ${visible.map(e => {
        const meta = TIMELINE_EVENT_META[e.type] || { icon: '•', tone: 'neutral' };
        const badges = [
          e.isResubmission ? timelineBadge('إعادة إرسال', 'info') : '',
          OVERRIDE_TIMELINE_EVENTS.has(e.type) ? timelineBadge('قرار استثنائي', 'warning') : ''
        ].join('');
        return `
          <li class="case-tl-event case-tl-event--${meta.tone}">
            <span class="case-tl-event__dot">${meta.icon}</span>
            <div class="case-tl-event__body">
              <div class="case-tl-step__head"><span class="case-tl-event__label">${DOM.escapeHTML(e.label || e.type)}</span>${badges}</div>
              <div class="case-tl-time">🕒 ${DOM.escapeHTML(formatCairoDateTime(e.occurredAtUtc))}</div>
              <div class="case-tl-line">
                ${e.actor ? timelinePerson(e.actor) : ''}${e.target ? ` ← ${timelinePerson(e.target)}` : ''}
              </div>
              ${timelineNote(e.note)}
            </div>
          </li>
        `;
      }).join('')}
    </ol>
  `;
}

/** بانر الحالات المستوردة من الإكسيل — خطواتها القديمة ماكانتش متسجلة. */
function renderLegacyTimelineBanner(c) {
  const researcher = c.workerAuthorName || (c.legacyImportData && c.legacyImportData.researcherName) || '';
  const regDate = c.registrationDate ? String(c.registrationDate).slice(0, 10) : '';
  return `
    <div class="case-draft-banner case-tl-legacy">
      <strong>حالة مستوردة من النظام القديم${regDate ? ` — تاريخ البحث: ${DOM.escapeHTML(regDate)}` : ''}</strong>
      ${researcher ? `<span>الباحث الأصلي: ${DOM.escapeHTML(researcher)}</span>` : ''}
      <span>خطوات هذه الحالة في البرنامج القديم لم تكن مسجّلة — يظهر هنا فقط ما حدث منذ تشغيل النظام الجديد.</span>
    </div>
  `;
}

function openTimelineModal(data, c) {
  const overlay = document.createElement('div');
  overlay.className = 'case-modal-overlay';
  overlay.innerHTML = `
    <div class="case-modal case-modal--wide" role="dialog" aria-modal="true" aria-labelledby="timeline-modal-title">
      <div class="case-tl-header">
        <div>
          <h3 class="case-modal__title" id="timeline-modal-title">📜 تاريخ الحالة</h3>
          <p class="case-modal__desc">${DOM.escapeHTML(c.id || '')}${c.name ? ` — ${DOM.escapeHTML(c.name)}` : ''} · التوقيت بتوقيت مصر</p>
        </div>
        <button type="button" class="case-tl-close" id="btn-timeline-close" aria-label="إغلاق">✕</button>
      </div>
      <div class="case-tl-scroll">
        ${data && data.isLegacy ? renderLegacyTimelineBanner(c) : ''}
        <div class="case-page-subtitle">ملخص المراحل</div>
        ${renderTimelineSummary(data && data.summary)}
        <div class="case-page-subtitle">كل الأحداث</div>
        ${renderTimelineEvents(data && data.events)}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', e => {
    if (e.target === overlay) close();
  });
  const closeBtn = overlay.querySelector('#btn-timeline-close');
  closeBtn.addEventListener('click', close);
  closeBtn.focus();
}

/* --------------------------------------------------------------------------
   RETURN-TO-WORKER DIALOG
   سبب الإعادة إجباري — من غيره الأخصائي مايعرفش المطلوب منه.
   -------------------------------------------------------------------------- */

/**
 * يعرض نافذة سبب الإعادة ويُرجع السبب، أو null لو أُلغيت.
 * @returns {Promise<string|null>}
 */
function askReturnReason() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'case-modal-overlay';
    overlay.innerHTML = `
      <div class="case-modal" role="dialog" aria-modal="true" aria-labelledby="return-modal-title">
        <h3 class="case-modal__title" id="return-modal-title">🟡 إعادة الحالة للأخصائي</h3>
        <p class="case-modal__desc">اكتب سبب الإعادة — سيظهر للأخصائي في تطبيقه ليستكمل المطلوب.</p>
        <textarea id="return-reason-input" aria-label="سبب إعادة الحالة للأخصائي" aria-describedby="return-reason-error" class="case-modal__input" rows="4" dir="rtl"
                  placeholder="مثال: صور السكن غير واضحة، ومطلوب إثبات دخل محدَّث..."></textarea>
        <p class="case-modal__error" id="return-reason-error" hidden>السبب مطلوب قبل الإعادة.</p>
        <div class="case-modal__actions">
          <button type="button" class="btn btn--secondary" id="btn-return-cancel">إلغاء</button>
          <button type="button" class="case-float-btn case-float-btn--return" id="btn-return-confirm">
            <span>تأكيد الإعادة</span><span class="case-float-btn__icon">🟡</span>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#return-reason-input');
    const error = overlay.querySelector('#return-reason-error');
    input.focus();

    const close = value => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    function onKey(e) {
      if (e.key === 'Escape') close(null);
    }
    document.addEventListener('keydown', onKey);

    overlay.addEventListener('click', e => {
      if (e.target === overlay) close(null);
    });
    overlay.querySelector('#btn-return-cancel').addEventListener('click', () => close(null));
    overlay.querySelector('#btn-return-confirm').addEventListener('click', () => {
      const reason = input.value.trim();
      if (!reason) {
        error.hidden = false;
        input.focus();
        return;
      }
      close(reason);
    });
  });
}

/** إعادة الحالة للأخصائي بسبب مكتوب — تُسجَّل كقرار مراجع. */
async function returnCaseToWorker(container, c) {
  const reason = await askReturnReason();
  if (!reason) return;

  const idempotencyKey = crypto.randomUUID();
  try {
    const result = await CasesService.returnToWorker(c.rawId, {
      reason,
      caseRowVersion: c.caseRowVersion
    }, idempotencyKey);

    applyOpinionResult(container, c, result, 'reviewerOpinion');
    showToast('تم إرجاع الحالة للأخصائي مع بيان السبب 🟡');
  } catch (err) {
    showToast(messageFromError(err), 'error');
    if (err && err.code === 'CONCURRENCY_CONFLICT') {
      await refreshAfterConflict(container, c);
    }
  }
}

/** زر عائم واحد. */
function floatBtn({ id, variant, label, icon, disabled, title }) {
  return `
    <button type="button" id="${id}" class="case-float-btn case-float-btn--${variant}${disabled ? ' case-float-btn--disabled' : ''}"
            ${disabled ? 'disabled' : ''} ${title ? `title="${DOM.escapeHTML(title)}"` : ''}>
      <span>${DOM.escapeHTML(label)}</span>
      <span class="case-float-btn__icon">${icon}</span>
    </button>
  `;
}

/**
 * Build the floating action bar for the current role.
 * المراجع يشوف زرّيه دائمًا (معطّلين مع سبب لو الملف مقفول)، والمدير يشوف
 * زرّي الاعتماد النهائي.
 */
function renderFloatActions(c) {
  const bar = DOM.qs('#case-float-actions');
  if (!bar) return;

  const reviewerGate = canWriteOpinion('reviewer', c);
  const managerGate = canWriteOpinion('manager', c);
  let html = '';

  if (isRole(ROLES.REVIEWER)) {
    const off = !reviewerGate.allowed;
    html = `
      ${off && reviewerGate.reason ? `<span class="case-float-hint">🔒 ${DOM.escapeHTML(reviewerGate.reason)}</span>` : ''}
      ${floatBtn({ id: 'btn-reviewer-return', variant: 'return', label: 'إعادة للأخصائي', icon: '🟡',
                   disabled: off, title: off ? reviewerGate.reason : 'إرجاع الملف للأخصائي مع بيان السبب' })}
      ${floatBtn({ id: 'btn-reviewer-save', variant: 'save', label: 'حفظ كمسودة', icon: '📝',
                   disabled: off, title: off ? reviewerGate.reason : 'حفظ الرأي دون إرساله للمدير' })}
      ${floatBtn({ id: 'btn-reviewer-submit', variant: 'send', label: 'إرسال للمدير', icon: '⚖️',
                   disabled: off, title: off ? reviewerGate.reason : 'إرسال الرأي للمدير للاعتماد النهائي' })}
    `;
  } else if (isRole(ROLES.MANAGER)) {
    // المدير فوق التسلسل — زراره مفتوحة دائمًا ما لم يكن الملف محسومًا
    const off = !managerGate.allowed;
    html = `
      ${off && managerGate.reason ? `<span class="case-float-hint">🔒 ${DOM.escapeHTML(managerGate.reason)}</span>` : ''}
      ${floatBtn({ id: 'btn-manager-reject', variant: 'reject', label: 'رفض نهائي', icon: '🔴',
                   disabled: off, title: off ? managerGate.reason : 'رفض الحالة نهائياً' })}
      ${floatBtn({ id: 'btn-manager-approve', variant: 'approve', label: 'اعتماد وصرف الدعم', icon: '🟢',
                   disabled: off, title: off ? managerGate.reason : 'اعتماد الحالة نهائياً' })}
    `;
  }

  bar.innerHTML = html;
  bar.style.display = html ? '' : 'none';
}

function bindFloatActions(container, c) {
  renderFloatActions(c);
  const bar = DOM.qs('#case-float-actions');
  if (!bar) return;

  // بتعطّل الزرار طول مدة الطلب — النجاح بيعيد رسم الشريط بأزرار جديدة
  // أصلاً (renderCaseDetailsCards)، فالتفعيل هنا يلزم غالبًا حالة الفشل فقط.
  const onAsync = (id, fn) => {
    const btn = bar.querySelector(`#${id}`);
    if (!btn || btn.disabled) return;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await fn();
      } finally {
        btn.disabled = false;
      }
    });
  };

  // رأي المراجع وقرار المدير مربوطين بالـ API الحقيقي (POST
  // /opinions/reviewer، /return-to-worker، /opinions/manager،
  // /return-for-completion) دايمًا، بغض النظر عن apiBacked.
  onAsync('btn-reviewer-return', () => returnCaseToWorker(container, c));
  onAsync('btn-reviewer-save', () => commitReviewerOpinion(container, c, { submit: false }));
  onAsync('btn-reviewer-submit', () => commitReviewerOpinion(container, c, { submit: true }));

  onAsync('btn-manager-approve', () => {
    const input = readManagerInput(container);
    return commitManagerDecision(container, c, input && input.decision === 'returned_to_worker' ? 'returned_to_worker' : 'approved');
  });
  onAsync('btn-manager-reject', () => commitManagerDecision(container, c, 'rejected'));
}

function bindOpinionForms(container, c) {
  // النماذج نفسها لم تعد تُرسَل بزر داخلي — الإجراء من الأزرار العائمة.
  const reviewerForm = container.querySelector('#reviewer-decision-form');
  if (reviewerForm) reviewerForm.addEventListener('submit', e => e.preventDefault());

  const managerForm = container.querySelector('#manager-approval-form');
  if (managerForm) managerForm.addEventListener('submit', e => e.preventDefault());

  bindFloatActions(container, c);
}
