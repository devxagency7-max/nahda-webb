/* --------------------------------------------------------------------------
   REPORTS & ANALYTICS MASTER CONTROLLER
   Orchestrates 11 specialized dashboards, global date filtering, role gates,
   comparisons, and report building.
   Aligned with FRONTEND_REPORTING_HANDOFF.md & REPORTING_ARCHITECTURE.md
   -------------------------------------------------------------------------- */
import { DOM } from '../../utils/dom.js';
import { showToast } from '../../utils/toast.js';
import { EventBus, EVENTS } from '../../core/event-bus.js';
import { can, PERMISSIONS } from '../../core/permissions.js';
import { ReportsService, clearReportsCache } from '../../services/reports.service.js';
import { initReportBuilder, loadBuilderDatasets } from './reports-builder.component.js';
import { onViewEnter } from '../../core/view-lifecycle.js';
import { supportTypeLabel } from '../../utils/support-labels.js';
import { LocationsService } from '../../services/locations.service.js';

let activeTab = 'executive';
let globalDateRange = { from: '', to: '' };

// CasesAgingRow.bucket is a number (0..4) on the wire -- backend has no JsonStringEnumConverter.
// Index order IS the display order: Days0To7, Days8To30, Days31To90, Days91To180, Over180.
const AGING_LABELS = [
  '0 - 7 أيام (حديثة جداً)',
  '8 - 30 يوماً (أقل من شهر)',
  '31 - 90 يوماً (1 - 3 أشهر)',
  '91 - 180 يوماً (3 - 6 أشهر)',
  'أكثر من 180 يوماً (قديمة / معلقة)'
];

const AGING_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#f97316', '#ef4444'];

const STATUS_ARABIC = {
  Approved: 'معتمدة ومقبولة',
  approved: 'معتمدة ومقبولة',
  PendingReview: 'قيد المراجعة',
  pending_review: 'قيد المراجعة',
  PendingApproval: 'بانتظار الاعتماد',
  pending_approval: 'بانتظار الاعتماد',
  ReturnedToWorker: 'مرتجعة للأخصائي',
  returned_to_worker: 'مرتجعة للأخصائي',
  Rejected: 'مرفوضة',
  rejected: 'مرفوضة'
};

/* --------------------------------------------------------------------------
   MAIN INITIALIZATION
   -------------------------------------------------------------------------- */
export function initReportsComponent() {
  bindTabNavigation();
  bindDateFilters();
  bindGlobalActions();
  initComparisonTool();
  initReportBuilder();
  bindSupportRecipientReport();

  // Route & Role gate adjustments
  applyRolePermissionsGates();
  EventBus.on(EVENTS.USER_CHANGED, applyRolePermissionsGates);

  // Trigger load when view is opened (also when it's the view restored on a
  // reload, which the old router-emitted 'reports:opened' event missed).
  onViewEnter('reports', ({ firstEnter }) => {
    if (firstEnter) loadBuilderDatasets();
    loadActiveTabData();
  });
}

/** Check role permissions and show/hide restricted sections (§2) */
function applyRolePermissionsGates() {
  const finTabBtn = DOM.qs('#rep-tab-btn-financial');
  const exportBtn = DOM.qs('#btn-export-reports');

  // Hide financial tab entirely for roles lacking view_financial_reports
  if (finTabBtn) {
    finTabBtn.style.display = can(PERMISSIONS.VIEW_FINANCIAL_REPORTS) ? 'inline-flex' : 'none';
    if (!can(PERMISSIONS.VIEW_FINANCIAL_REPORTS) && activeTab === 'financial') {
      switchTab('executive');
    }
  }

  // Hide CSV export button entirely for roles lacking export_reports
  if (exportBtn) {
    exportBtn.style.display = can(PERMISSIONS.EXPORT_REPORTS) ? 'inline-flex' : 'none';
  }
}

/* --------------------------------------------------------------------------
   TAB NAVIGATION
   -------------------------------------------------------------------------- */
function bindTabNavigation() {
  const tabButtons = DOM.qsa('.rep-tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      if (target) switchTab(target);
    });
  });
}

function switchTab(tabKey) {
  activeTab = tabKey;
  DOM.qsa('.rep-tab-btn').forEach(btn => {
    btn.classList.toggle('rep-tab-btn--active', btn.dataset.tab === tabKey);
  });

  DOM.qsa('.rep-tab-pane').forEach(pane => {
    pane.classList.add('rep-tab-pane--hidden');
  });

  const activePane = DOM.qs(`#pane-${tabKey}`);
  if (activePane) {
    activePane.classList.remove('rep-tab-pane--hidden');
  }

  loadActiveTabData();
}

/* --------------------------------------------------------------------------
   DATE FILTERS
   -------------------------------------------------------------------------- */
function bindDateFilters() {
  const fromInput = DOM.qs('#rep-filter-from');
  const toInput = DOM.qs('#rep-filter-to');
  const applyBtn = DOM.qs('#btn-apply-date-filter');
  const presetBtns = DOM.qsa('.btn-rep-preset');

  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      globalDateRange.from = fromInput?.value || '';
      globalDateRange.to = toInput?.value || '';
      presetBtns.forEach(b => b.classList.remove('btn-rep-preset--active'));
      clearReportsCache();
      loadActiveTabData();
    });
  }

  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      presetBtns.forEach(b => b.classList.remove('btn-rep-preset--active'));
      btn.classList.add('btn-rep-preset--active');
      const range = btn.dataset.range;
      const today = new Date();

      if (range === 'today') {
        const d = today.toISOString().slice(0, 10);
        globalDateRange = { from: d, to: d };
      } else if (range === 'week') {
        const past = new Date(today);
        past.setDate(today.getDate() - 7);
        globalDateRange = { from: past.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
      } else if (range === 'month') {
        const past = new Date(today);
        past.setMonth(today.getMonth() - 1);
        globalDateRange = { from: past.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
      } else if (range === '90days') {
        const past = new Date(today);
        past.setDate(today.getDate() - 90);
        globalDateRange = { from: past.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
      } else {
        globalDateRange = { from: '', to: '' };
      }

      if (fromInput) fromInput.value = globalDateRange.from;
      if (toInput) toInput.value = globalDateRange.to;

      clearReportsCache();
      loadActiveTabData();
    });
  });
}

/* --------------------------------------------------------------------------
   GLOBAL ACTIONS (REFRESH, PRINT, EXPORT)
   -------------------------------------------------------------------------- */
function bindGlobalActions() {
  const refreshBtn = DOM.qs('#btn-refresh-reports');
  const exportBtn = DOM.qs('#btn-export-reports');
  const printBtn = DOM.qs('#btn-print-reports');

  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      clearReportsCache();
      await loadActiveTabData();
      showToast('تم تحديث بيانات التقارير بنجاح 🔄');
    });
  }

  if (printBtn) {
    printBtn.addEventListener('click', () => {
      window.print();
    });
  }

  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      try {
        await ReportsService.exportCsv({
          dataset: 'Cases',
          dimension: 'Status',
          metric: 'Count',
          aggregation: 'Count',
          filters: null,
          sortDirection: 'Descending',
          maxRows: 5000
        });
        showToast('تم تصدير ملف CSV الشامل بنجاح 📥');
      } catch (err) {
        showToast(`تعذر التصدير: ${err.message || 'خطأ'}`);
      }
    });
  }
}

/* --------------------------------------------------------------------------
   LOAD ACTIVE TAB DATA DISPATCHER
   -------------------------------------------------------------------------- */
async function loadActiveTabData() {
  switch (activeTab) {
    case 'executive':
      await loadExecutiveData();
      break;
    case 'cases':
      await loadCasesData();
      break;
    case 'geographic':
      await loadGeographicData();
      break;
    case 'support':
      await loadSupportData();
      break;
    case 'beneficiaries':
      await loadBeneficiariesData();
      break;
    case 'visits':
      await loadVisitsData();
      break;
    case 'employees':
      await loadEmployeesData();
      break;
    case 'quality':
      await loadQualityData();
      break;
    case 'financial':
      if (can(PERMISSIONS.VIEW_FINANCIAL_REPORTS)) {
        await loadFinancialData();
      }
      break;
    case 'comparison':
      // Handled on form submit
      break;
    case 'builder':
      // Handled in reports-builder.component.js
      break;
  }
}

/* --------------------------------------------------------------------------
   TAB 1: EXECUTIVE DASHBOARD
   -------------------------------------------------------------------------- */
async function loadExecutiveData() {
  try {
    const res = await ReportsService.getExecutiveDashboard();
    const d = res?.data || res || {};

    setElText('#exec-total-cases', d.totalCases ?? 0);
    setElText('#exec-approved-cases', d.approvedCases ?? 0);
    setElText('#exec-pending-cases', d.pendingCases ?? 0);
    setElText('#exec-rejected-cases', d.rejectedCases ?? 0);
    setElText('#exec-support-amount', (d.totalApprovedSupportAmount ?? 0).toLocaleString('ar-EG') + ' ج.م');
    setElText('#exec-visits-count', d.totalVisitsLast30Days ?? 0);

    // Trend points
    renderTrendChart('#exec-trend-chart', d.casesTrendLast90Days || []);
  } catch (err) {
    console.error('[Reports] Error loading executive dashboard:', err);
  }
}

/* --------------------------------------------------------------------------
   TAB 2: CASES & AGING
   -------------------------------------------------------------------------- */
async function loadCasesData() {
  try {
    const [summaryRes, agingRes] = await Promise.all([
      ReportsService.getCasesSummary(globalDateRange),
      ReportsService.getCasesAging()
    ]);

    const summary = summaryRes?.data || summaryRes || {};
    const aging = agingRes?.data || agingRes || [];

    // Status & Priority pipeline list
    const statusContainer = DOM.qs('#cases-status-list');
    if (statusContainer) {
      const items = summary.byStatus || [];
      const total = summary.totalCases || 1;
      statusContainer.innerHTML = items.map(s => {
        const label = STATUS_ARABIC[s.key] || s.label || s.key;
        const pct = Math.round((s.count / total) * 100);
        return `
          <div class="rep-pipeline-item">
            <div class="rep-pipeline-header">
              <span class="rep-pipeline-title">📌 ${DOM.escapeHTML(label)}</span>
              <span class="rep-pipeline-count">${s.count} حالة (${pct}%)</span>
            </div>
            <div class="rep-pipeline-bar-track">
              <div class="rep-pipeline-bar" style="width: ${pct}%; background: #2563eb;"></div>
            </div>
          </div>
        `;
      }).join('') || `<p class="reports-empty">لا توجد بيانات متاحة</p>`;
    }

    // Aging Buckets Table (0-7, 8-30, 31-90, 91-180, 180+)
    const agingTbody = DOM.qs('#cases-aging-tbody');
    if (agingTbody) {
      const totalAging = aging.reduce((acc, row) => acc + (row.caseCount || 0), 0) || 1;
      const sortedAging = [...aging].sort((a, b) => a.bucket - b.bucket);
      agingTbody.innerHTML = sortedAging.map(row => {
        const label = AGING_LABELS[row.bucket] || row.bucket;
        const color = AGING_COLORS[row.bucket] || '#2563eb';
        const pct = Math.round(((row.caseCount || 0) / totalAging) * 100);
        return `
          <tr>
            <td style="font-weight: 700;">${DOM.escapeHTML(label)}</td>
            <td><strong>${row.caseCount || 0}</strong></td>
            <td>${pct}%</td>
            <td style="width: 40%;">
              <div class="rep-progress-wrap">
                <div class="rep-progress-track">
                  <div class="rep-progress-bar" style="width: ${pct}%; background: ${color};"></div>
                </div>
                <span class="rep-progress-pct" style="color: ${color};">${pct}%</span>
              </div>
            </td>
          </tr>
        `;
      }).join('') || `<tr><td colspan="4" class="reports-empty">لا توجد بيانات</td></tr>`;
    }
  } catch (err) {
    console.error('[Reports] Error loading cases dashboard:', err);
  }
}

/* --------------------------------------------------------------------------
   TAB 3: GEOGRAPHIC DASHBOARD
   -------------------------------------------------------------------------- */
async function loadGeographicData() {
  try {
    const res = await ReportsService.getGeographicDashboard();
    const rows = res?.data || res || [];
    const tbody = DOM.qs('#geo-location-tbody');
    const meta = DOM.qs('#geo-centers-meta');

    if (tbody) {
      const total = rows.reduce((acc, r) => acc + (r.caseCount || 0), 0) || 1;
      tbody.innerHTML = rows.map(r => {
        const pct = Math.round(((r.caseCount || 0) / total) * 100);
        return `
          <tr>
            <td style="font-weight: 700;">📍 مركز ${DOM.escapeHTML(r.centerName || 'بني سويف')}</td>
            <td>${DOM.escapeHTML(r.villageName || 'المدينة / عام')}</td>
            <td><strong style="color: #2563eb;">${r.caseCount || 0}</strong> حالة</td>
            <td>
              <div class="rep-progress-wrap">
                <div class="rep-progress-track">
                  <div class="rep-progress-bar" style="width: ${pct}%;"></div>
                </div>
                <span class="rep-progress-pct">${pct}%</span>
              </div>
            </td>
          </tr>
        `;
      }).join('') || `<tr><td colspan="4" class="reports-empty">لا توجد بيانات جغرافية متاحة</td></tr>`;

      if (meta) meta.textContent = `إجمالي الحالات الجغرافية الموزعة: ${total} حالة`;
    }
  } catch (err) {
    console.error('[Reports] Error loading geographic dashboard:', err);
  }
}

/* --------------------------------------------------------------------------
   TAB 4: SUPPORT DASHBOARD
   -------------------------------------------------------------------------- */
async function loadSupportData() {
  try {
    const [summaryRes, byTypeRes] = await Promise.all([
      ReportsService.getSupportDashboard(),
      ReportsService.getSupportByType()
    ]);

    const summary = summaryRes?.data || summaryRes || {};
    const byType = byTypeRes?.data || byTypeRes || [];

    setElText('#sup-stat-records', summary.totalApprovedSupportRecords ?? 0);
    setElText('#sup-stat-amount', (summary.totalApprovedAmount ?? 0).toLocaleString('ar-EG') + ' ج.م');
    setElText('#sup-stat-avg', (summary.averageApprovedAmount ?? 0).toLocaleString('ar-EG') + ' ج.م');

    // Warning Banner if coverage < 100%
    const warnEl = DOM.qs('#support-coverage-warning');
    if (warnEl) {
      if (summary.coverage && summary.coverage.warning) {
        warnEl.textContent = `⚠️ تنبيه تغطية البيانات: ${summary.coverage.warning}`;
        warnEl.style.display = 'block';
      } else {
        warnEl.style.display = 'none';
      }
    }

    loadSupportByRecipient();

    const tbody = DOM.qs('#sup-by-type-tbody');
    if (tbody) {
      tbody.innerHTML = byType.map(r => {
        const avg = r.count > 0 ? Math.round(r.totalAmount / r.count) : 0;
        return `
          <tr>
            <td style="font-weight: 700;">🎁 ${DOM.escapeHTML(supportTypeLabel(r.supportType) || 'عام')}</td>
            <td><strong>${r.count || 0}</strong> حالة</td>
            <td><strong style="color: #059669;">${(r.totalAmount || 0).toLocaleString('ar-EG')} ج.م</strong></td>
            <td>${avg.toLocaleString('ar-EG')} ج.م</td>
          </tr>
        `;
      }).join('') || `<tr><td colspan="4" class="reports-empty">لا توجد بيانات دعم متاحة</td></tr>`;
    }
  } catch (err) {
    console.error('[Reports] Error loading support dashboard:', err);
  }
}

/* ---- تقرير الدعم حسب المستفيد ---- */
let supRecRows = [];
let supRecLocationsReady = false;

async function ensureSupRecLocations() {
  if (supRecLocationsReady) return;
  supRecLocationsReady = true;
  const centerSelect = DOM.qs('#sup-rec-center');
  const villageSelect = DOM.qs('#sup-rec-village');
  if (!centerSelect || !villageSelect) return;
  let centers = [];
  try {
    centers = await LocationsService.list();
  } catch {
    supRecLocationsReady = false;
    return; // الفلتر الجغرافي اختياري — التقرير شغال من غيره.
  }
  centerSelect.innerHTML = '<option value="">-- كل المراكز --</option>' +
    centers.map(c => `<option value="${DOM.escapeHTML(c.id)}">${DOM.escapeHTML(c.name)}</option>`).join('');
  centerSelect.addEventListener('change', () => {
    const center = centers.find(c => c.id === centerSelect.value);
    const villages = center?.villages || [];
    villageSelect.innerHTML = center
      ? '<option value="">-- كل القرى --</option>' + villages.map(v => `<option value="${DOM.escapeHTML(v.id)}">${DOM.escapeHTML(v.name)}</option>`).join('')
      : '<option value="">-- اختر المركز أولاً --</option>';
    villageSelect.disabled = !center;
  });
}

async function loadSupportByRecipient() {
  const tbody = DOM.qs('#sup-rec-tbody');
  if (!tbody) return;
  ensureSupRecLocations();
  const exportBtn = DOM.qs('#sup-rec-export');
  try {
    const res = await ReportsService.getSupportByRecipient({
      approvedOnly: DOM.qs('#sup-rec-approved-only')?.checked !== false,
      centerId: DOM.qs('#sup-rec-center')?.value || undefined,
      villageId: DOM.qs('#sup-rec-village')?.value || undefined
    });
    supRecRows = Array.isArray(res) ? res : (res?.data || []);
  } catch (err) {
    console.error('[Reports] Error loading support-by-recipient:', err);
    supRecRows = [];
    tbody.innerHTML = '<tr><td colspan="8" class="reports-empty">تعذّر تحميل التقرير</td></tr>';
    if (exportBtn) exportBtn.disabled = true;
    return;
  }
  tbody.innerHTML = supRecRows.map(r => `
    <tr>
      <td style="font-weight: 700;">${DOM.escapeHTML(supportTypeLabel(r.supportType) || 'عام')}</td>
      <td>${DOM.escapeHTML(r.category || '—')}</td>
      <td><strong>${r.cases ?? 0}</strong></td>
      <td>${r.householdCases ?? 0}</td>
      <td>${r.heads ?? 0}</td>
      <td>${r.familyMembers ?? 0}</td>
      <td>${r.studentMembers ?? 0}</td>
      <td><strong style="color: #059669;">${r.individuals ?? 0}</strong></td>
    </tr>
  `).join('') || '<tr><td colspan="8" class="reports-empty">لا توجد بيانات دعم مقترح لهذه الفلاتر</td></tr>';
  if (exportBtn) exportBtn.disabled = supRecRows.length === 0;
}

function exportSupportByRecipientCsv() {
  if (!supRecRows.length) return;
  const header = ['نوع الدعم', 'التصنيف', 'الأسر', 'للأسرة كلها', 'أرباب الأسر', 'الأفراد', 'منهم الطلاب', 'إجمالي المستفيدين'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [header, ...supRecRows.map(r => [
    supportTypeLabel(r.supportType), r.category || '', r.cases, r.householdCases, r.heads, r.familyMembers, r.studentMembers, r.individuals
  ])].map(row => row.map(esc).join(','));
  // BOM عشان Excel يقرا العربي صح.
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'support-by-recipient.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

function bindSupportRecipientReport() {
  DOM.qs('#sup-rec-apply')?.addEventListener('click', () => {
    clearReportsCache();
    loadSupportByRecipient();
  });
  DOM.qs('#sup-rec-export')?.addEventListener('click', exportSupportByRecipientCsv);
}

/* --------------------------------------------------------------------------
   TAB 5: BENEFICIARIES & DEMOGRAPHICS
   -------------------------------------------------------------------------- */
async function loadBeneficiariesData() {
  try {
    const res = await ReportsService.getBeneficiariesDashboard();
    const d = res?.data || res || {};

    setElText('#ben-stat-total', d.totalBeneficiaries ?? 0);
    setElText('#ben-stat-family-size', d.averageFamilySize ? `${d.averageFamilySize} أفراد` : '—');
    setElText('#ben-stat-income', d.averageMonthlyIncome ? `${d.averageMonthlyIncome.toLocaleString('ar-EG')} ج.م` : '—');

    renderNamedCounts('#ben-gender-list', d.byGender || [], d.totalBeneficiaries || 1, '#6366f1');
    renderNamedCounts('#ben-age-list', d.byAgeBracket || [], d.totalBeneficiaries || 1, '#3b82f6');
    renderNamedCounts('#ben-employment-list', d.byEmploymentStatus || [], d.totalBeneficiaries || 1, '#10b981');
  } catch (err) {
    console.error('[Reports] Error loading beneficiaries dashboard:', err);
  }
}

/* --------------------------------------------------------------------------
   TAB 6: VISITS DASHBOARD
   -------------------------------------------------------------------------- */
async function loadVisitsData() {
  try {
    const res = await ReportsService.getVisitsDashboard();
    const d = res?.data || res || {};

    setElText('#vis-stat-total', d.totalVisits ?? 0);
    setElText('#vis-stat-avg', d.averageVisitsPerCase ? `${d.averageVisitsPerCase} زيارة/ملف` : '—');

    renderNamedCounts('#vis-outcome-list', d.byOutcome || [], d.totalVisits || 1, '#10b981');
    renderNamedCounts('#vis-status-list', d.byStatus || [], d.totalVisits || 1, '#f59e0b');
  } catch (err) {
    console.error('[Reports] Error loading visits dashboard:', err);
  }
}

/* --------------------------------------------------------------------------
   TAB 7: EMPLOYEES ACTIVITY
   -------------------------------------------------------------------------- */
async function loadEmployeesData() {
  try {
    const res = await ReportsService.getEmployeesActivity(globalDateRange);
    const rows = res?.data || res || [];
    const tbody = DOM.qs('#emp-activity-tbody');

    if (tbody) {
      tbody.innerHTML = rows.map(r => `
        <tr>
          <td style="font-weight: 700;">${DOM.escapeHTML(r.fullName || '—')}</td>
          <td><span class="rep-badge rep-badge--info">${DOM.escapeHTML(r.role || 'موظف')}</span></td>
          <td><strong>${r.casesCreated || 0}</strong></td>
          <td><strong>${r.visitsConducted || 0}</strong></td>
          <td><strong>${r.auditActionsRecorded || 0}</strong></td>
        </tr>
      `).join('') || `<tr><td colspan="5" class="reports-empty">لا يوجد نشاط مسجل في هذه الفترة</td></tr>`;
    }
  } catch (err) {
    console.error('[Reports] Error loading employees activity:', err);
  }
}

/* --------------------------------------------------------------------------
   TAB 8: DATA QUALITY & COVERAGE
   -------------------------------------------------------------------------- */
async function loadQualityData() {
  try {
    const [qualityRes, coverageRes] = await Promise.all([
      ReportsService.getDataQualityDashboard(),
      ReportsService.getDataCoverage()
    ]);

    const q = qualityRes?.data || qualityRes || {};
    const c = coverageRes?.data || coverageRes || {};

    setElText('#dq-missing-phone', q.casesMissingBeneficiaryPhone ?? 0);
    setElText('#dq-missing-housing', q.casesMissingHousingRecord ?? 0);
    setElText('#dq-missing-financial', q.casesMissingFinancialItems ?? 0);
    setElText('#dq-zero-family', q.casesWithZeroFamilyMembers ?? 0);

    const covList = DOM.qs('#dq-coverage-list');
    if (covList) {
      const items = [
        { label: 'تغطية البنود المالية والتفصيلية', cov: c.financialCoverage },
        { label: 'تغطية بيانات المسكن والمرافق', cov: c.housingCoverage },
        { label: 'تغطية قرارات الدعم المعتمد', cov: c.supportCoverage }
      ];

      covList.innerHTML = items.map(item => {
        const pct = item.cov ? Math.round(item.cov.coveragePercentage || 0) : 100;
        const color = pct >= 90 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444';
        return `
          <div class="rep-pipeline-item">
            <div class="rep-pipeline-header">
              <span class="rep-pipeline-title">${item.label}</span>
              <span class="rep-pipeline-count">${pct}%</span>
            </div>
            <div class="rep-pipeline-bar-track">
              <div class="rep-pipeline-bar" style="width: ${pct}%; background: ${color};"></div>
            </div>
            ${item.cov?.warning ? `<span style="font-size: 11px; color: #b45309; margin-top: 4px;">⚠️ ${DOM.escapeHTML(item.cov.warning)}</span>` : ''}
          </div>
        `;
      }).join('');
    }
  } catch (err) {
    console.error('[Reports] Error loading quality dashboard:', err);
  }
}

/* --------------------------------------------------------------------------
   TAB 9: FINANCIAL SUMMARY (GATED)
   -------------------------------------------------------------------------- */
async function loadFinancialData() {
  try {
    const res = await ReportsService.getFinancialDashboard();
    const d = res?.data || res || {};

    setElText('#fin-stat-income', (d.totalIncome ?? 0).toLocaleString('ar-EG') + ' ج.م');
    setElText('#fin-stat-expenses', (d.totalExpenses ?? 0).toLocaleString('ar-EG') + ' ج.م');
    setElText('#fin-stat-balance', (d.netBalance ?? 0).toLocaleString('ar-EG') + ' ج.م');

    // Warning
    const warnEl = DOM.qs('#fin-coverage-warning');
    if (warnEl) {
      if (d.coverage && d.coverage.warning) {
        warnEl.textContent = `⚠️ تنبيه: ${d.coverage.warning}`;
        warnEl.style.display = 'block';
      } else {
        warnEl.style.display = 'none';
      }
    }

    const incomeTbody = DOM.qs('#fin-income-tbody');
    if (incomeTbody) {
      incomeTbody.innerHTML = (d.incomeByLabel || []).map(r => `
        <tr>
          <td style="font-weight: 700;">${DOM.escapeHTML(r.label || r.key)}</td>
          <td><strong style="color: #059669;">${(r.amount || 0).toLocaleString('ar-EG')} ج.م</strong></td>
        </tr>
      `).join('') || `<tr><td colspan="2" class="reports-empty">لا توجد بيانات دخل</td></tr>`;
    }

    const expenseTbody = DOM.qs('#fin-expense-tbody');
    if (expenseTbody) {
      expenseTbody.innerHTML = (d.expenseByLabel || []).map(r => `
        <tr>
          <td style="font-weight: 700;">${DOM.escapeHTML(r.label || r.key)}</td>
          <td><strong style="color: #dc2626;">${(r.amount || 0).toLocaleString('ar-EG')} ج.م</strong></td>
        </tr>
      `).join('') || `<tr><td colspan="2" class="reports-empty">لا توجد بيانات مصروفات</td></tr>`;
    }
  } catch (err) {
    console.error('[Reports] Error loading financial dashboard:', err);
  }
}

/* --------------------------------------------------------------------------
   TAB 10: COMPARISON ENGINE
   -------------------------------------------------------------------------- */
function initComparisonTool() {
  const runBtn = DOM.qs('#btn-run-comparison');
  if (!runBtn) return;

  // Set sane default dates
  const today = new Date();
  const startCurrent = new Date(today.getFullYear(), today.getMonth(), 1);
  const startPrev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const endPrev = new Date(today.getFullYear(), today.getMonth(), 0);

  const fmt = (d) => d.toISOString().slice(0, 10);

  const cFrom = DOM.qs('#cmp-curr-from');
  const cTo = DOM.qs('#cmp-curr-to');
  const pFrom = DOM.qs('#cmp-prev-from');
  const pTo = DOM.qs('#cmp-prev-to');

  if (cFrom) cFrom.value = fmt(startCurrent);
  if (cTo) cTo.value = fmt(today);
  if (pFrom) pFrom.value = fmt(startPrev);
  if (pTo) pTo.value = fmt(endPrev);

  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    runBtn.classList.add('btn--loading');

    const metric = DOM.qs('#cmp-metric-select')?.value || 'Count';
    const currentFrom = cFrom?.value || fmt(startCurrent);
    const currentTo = cTo?.value || fmt(today);
    const previousFrom = pFrom?.value || fmt(startPrev);
    const previousTo = pTo?.value || fmt(endPrev);

    try {
      const res = await ReportsService.getComparison({
        metric,
        currentFrom,
        currentTo,
        previousFrom,
        previousTo
      });

      const d = res?.data || res || {};
      const resultsBox = DOM.qs('#cmp-results-box');
      if (resultsBox) resultsBox.style.display = 'grid';

      setElText('#cmp-val-current', (d.currentValue ?? 0).toLocaleString('ar-EG'));
      setElText('#cmp-val-previous', (d.previousValue ?? 0).toLocaleString('ar-EG'));

      // Delta (+/-)
      const delta = d.delta ?? 0;
      const deltaEl = DOM.qs('#cmp-val-delta');
      if (deltaEl) {
        deltaEl.textContent = `${delta >= 0 ? '+' : ''}${delta.toLocaleString('ar-EG')}`;
        deltaEl.style.color = delta >= 0 ? '#059669' : '#dc2626';
      }

      // Percent Change: N/A when null per §3.2 & §14
      const pctEl = DOM.qs('#cmp-val-pct');
      if (pctEl) {
        if (d.percentChange === null || d.percentChange === undefined) {
          pctEl.textContent = 'N/A';
          pctEl.style.color = '#64748b';
        } else {
          const pct = d.percentChange;
          pctEl.textContent = `${pct >= 0 ? '+' : ''}${pct}%`;
          pctEl.style.color = pct >= 0 ? '#059669' : '#dc2626';
        }
      }

      showToast('تمت المقارنة بنجاح ⚖️');
    } catch (err) {
      console.error('[Reports] Error running comparison:', err);
      showToast('تعذر تنفيذ المقارنة — يرجى التأكد من التواريخ ⚠️');
    } finally {
      runBtn.disabled = false;
      runBtn.classList.remove('btn--loading');
    }
  });
}

/* --------------------------------------------------------------------------
   SHARED UI HELPERS
   -------------------------------------------------------------------------- */
function setElText(selector, text) {
  const el = DOM.qs(selector);
  if (el) el.textContent = text;
}

function renderNamedCounts(selector, list, total, color = '#2563eb') {
  const container = DOM.qs(selector);
  if (!container) return;
  const t = total || 1;

  container.innerHTML = list.map(item => {
    const label = item.label || item.key;
    const pct = Math.round((item.count / t) * 100);
    return `
      <div class="rep-pipeline-item">
        <div class="rep-pipeline-header">
          <span class="rep-pipeline-title">📌 ${DOM.escapeHTML(label)}</span>
          <span class="rep-pipeline-count">${item.count} (${pct}%)</span>
        </div>
        <div class="rep-pipeline-bar-track">
          <div class="rep-pipeline-bar" style="width: ${pct}%; background: ${color};"></div>
        </div>
      </div>
    `;
  }).join('') || `<p class="reports-empty">لا توجد بيانات متاحة</p>`;
}

function renderTrendChart(selector, points) {
  const container = DOM.qs(selector);
  if (!container) return;

  if (points.length === 0) {
    container.innerHTML = `<div class="reports-empty">لا توجد بيانات اتجاه متاحة</div>`;
    return;
  }

  const maxVal = Math.max(...points.map(p => p.count || 0)) || 1;
  container.innerHTML = points.map(p => {
    const pct = Math.round(((p.count || 0) / maxVal) * 100);
    return `
      <div class="builder-chart-bar-row">
        <div class="builder-chart-label" style="min-width: 100px;">${DOM.escapeHTML(p.periodLabel || p.periodStart)}</div>
        <div class="builder-chart-track">
          <div class="builder-chart-fill" style="width: ${pct}%; background: linear-gradient(90deg, #2563eb, #3b82f6);">
            <span class="builder-chart-val">${p.count || 0} حالة</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}
