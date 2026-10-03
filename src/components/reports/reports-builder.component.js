/* --------------------------------------------------------------------------
   REPORT BUILDER CONTROLLER (AD-HOC EXPLORATION & EXPORT)
   Dynamically driven by GET /api/v1/reports/datasets metadata.
   Complies with FRONTEND_REPORTING_HANDOFF.md §3.4, §6, §7, §12.
   -------------------------------------------------------------------------- */
import { DOM } from '../../utils/dom.js';
import { showToast } from '../../utils/toast.js';
import { can, PERMISSIONS } from '../../core/permissions.js';
import { ReportsService } from '../../services/reports.service.js';
import { allowedOperatorsFor } from '../../utils/report-enums.js';

let datasetsMetadata = [];
let currentDataset = null;
let currentFilters = [];
let lastResult = null;
let viewMode = 'table'; // 'table' | 'chart'

// Arabic translations for dimension & metric keys
const LABELS = {
  // Datasets
  Cases: 'الحالات الاجتماعية',
  Beneficiaries: 'المستفيدون',
  FamilyMembers: 'أفراد الأسرة',
  ApprovedSupport: 'الدعم المعتمد',
  FieldVisits: 'الزيارات الميدانية',

  // Dimensions
  Status: 'حالة الملف',
  Priority: 'درجة الأولوية',
  Center: 'المركز الجغرافي',
  Village: 'القرية',
  Charity: 'الجمعية الشريكة',
  Gender: 'النوع (الجنس)',
  AgeBracket: 'الفئة العمرية',
  SupportType: 'نوع الدعم',
  VisitOutcome: 'نتيجة الزيارة',
  RegistrationMonth: 'شهر التسجيل',
  None: 'بدون تصنيف (إجمالي)',

  // Metrics
  Count: 'العدد (تعداد)',
  TotalAmount: 'إجمالي المبلغ',
  AverageAmount: 'متوسط المبلغ',
  AverageAge: 'متوسط العمر',
  AverageMonthlyIncome: 'متوسط الدخل الشهري',

  // Aggregations
  Sum: 'مجموع (Sum)',
  Average: 'متوسط (Average)',
  Min: 'أدنى قيمة (Min)',
  Max: 'أعلى قيمة (Max)',

  // Operators
  Equals: 'يساوي (=)',
  NotEquals: 'لا يساوي (≠)',
  Contains: 'يحتوي على',
  GreaterThan: 'أكبر من (>)',
  GreaterThanOrEqual: 'أكبر من أو يساوي (≥)',
  LessThan: 'أصغر من (<)',
  LessThanOrEqual: 'أصغر من أو يساوي (≤)',
  Between: 'بين (Between)'
};

function t(key) {
  return LABELS[key] || key;
}

let datasetsLoad = null;

/**
 * Loads the dataset/dimension schema from the server (once) and fills the
 * builder's pickers. Called by reports.component.js on the first visit to
 * the reports screen — not at boot.
 */
export function loadBuilderDatasets() {
  if (!datasetsLoad) datasetsLoad = fetchDatasets().then(populateDatasets);
  return datasetsLoad;
}

async function fetchDatasets() {
  try {
    const res = await ReportsService.getDatasets();
    datasetsMetadata = Array.isArray(res) ? res : (res?.data || []);
  } catch (err) {
    console.warn('[ReportBuilder] Failed to fetch /datasets, using standard schema:', err);
    // Fallback schema matching backend whitelist
    const opsFor = (dims) => dims.filter(d => d !== 'None').map(d => ({ dimension: d, allowedOperators: allowedOperatorsFor(d) }));
    datasetsMetadata = [
      {
        dataset: 'Cases',
        label: 'الحالات',
        allowedDimensions: ['Status', 'Priority', 'Center', 'Village', 'Charity', 'RegistrationMonth', 'None'],
        allowedMetrics: ['Count'],
        dimensionOperators: opsFor(['Status', 'Priority', 'Center', 'Village', 'Charity', 'RegistrationMonth'])
      },
      {
        dataset: 'Beneficiaries',
        label: 'المستفيدون',
        allowedDimensions: ['Gender', 'AgeBracket', 'Center', 'Village', 'None'],
        allowedMetrics: ['Count', 'AverageAge', 'AverageMonthlyIncome'],
        dimensionOperators: opsFor(['Gender', 'AgeBracket', 'Center', 'Village'])
      },
      {
        dataset: 'ApprovedSupport',
        label: 'الدعم المعتمد',
        allowedDimensions: ['SupportType', 'Center', 'Charity', 'None'],
        allowedMetrics: ['Count', 'TotalAmount', 'AverageAmount'],
        dimensionOperators: opsFor(['SupportType', 'Center', 'Charity'])
      },
      {
        dataset: 'FieldVisits',
        label: 'الزيارات الميدانية',
        allowedDimensions: ['VisitOutcome', 'Center', 'None'],
        allowedMetrics: ['Count'],
        dimensionOperators: opsFor(['VisitOutcome', 'Center'])
      }
    ];
  }
}

/** Initialize Report Builder Component (DOM wiring only — see loadBuilderDatasets). */
export function initReportBuilder() {
  const datasetSelect = DOM.qs('#builder-dataset-select');
  const addFilterBtn = DOM.qs('#btn-builder-add-filter');
  const runBtn = DOM.qs('#btn-builder-run');
  const exportBtn = DOM.qs('#btn-builder-export');
  const toggleViewBtn = DOM.qs('#btn-builder-toggle-view');

  // Hide Export Button if role does not have export_reports permission (§2)
  if (exportBtn) {
    exportBtn.style.display = can(PERMISSIONS.EXPORT_REPORTS) ? 'inline-flex' : 'none';
  }

  if (datasetSelect) {
    datasetSelect.addEventListener('change', () => {
      onDatasetChange(datasetSelect.value);
    });
  }

  if (addFilterBtn) {
    addFilterBtn.addEventListener('click', addFilterRow);
  }

  if (runBtn) {
    runBtn.addEventListener('click', runBuilderQuery);
  }

  if (exportBtn) {
    exportBtn.addEventListener('click', exportBuilderCsv);
  }

  if (toggleViewBtn) {
    toggleViewBtn.addEventListener('click', () => {
      viewMode = viewMode === 'table' ? 'chart' : 'table';
      toggleViewBtn.textContent = viewMode === 'table' ? '📊 عرض كرسم بياني' : '📋 عرض كجدول';
      renderResults();
    });
  }
}

/** Populate Datasets Select Dropdown */
function populateDatasets() {
  const select = DOM.qs('#builder-dataset-select');
  if (!select) return;

  select.innerHTML = datasetsMetadata
    .map(d => `<option value="${d.dataset}">${t(d.dataset)} (${d.dataset})</option>`)
    .join('');

  if (datasetsMetadata.length > 0) {
    onDatasetChange(datasetsMetadata[0].dataset);
  }
}

/** Handle Dataset Selection Change */
function onDatasetChange(datasetName) {
  currentDataset = datasetsMetadata.find(d => d.dataset === datasetName) || datasetsMetadata[0];
  if (!currentDataset) return;

  // Populate Dimensions
  const dimSelect = DOM.qs('#builder-dimension-select');
  if (dimSelect) {
    dimSelect.innerHTML = (currentDataset.allowedDimensions || [])
      .map(dim => `<option value="${dim}">${t(dim)}</option>`)
      .join('');
  }

  // Populate Metrics
  const metricSelect = DOM.qs('#builder-metric-select');
  if (metricSelect) {
    metricSelect.innerHTML = (currentDataset.allowedMetrics || [])
      .map(m => `<option value="${m}">${t(m)}</option>`)
      .join('');
  }

  // Reset Filters
  currentFilters = [];
  renderFilterRows();
  hideInlineError();
}

/** Add a new filter row */
function addFilterRow() {
  if (!currentDataset) return;
  const defaultField = (currentDataset.allowedDimensions && currentDataset.allowedDimensions[0]) || 'Status';
  currentFilters.push({
    field: defaultField,
    operator: 'Equals',
    value: ''
  });
  renderFilterRows();
}

/** Remove a filter row */
function removeFilterRow(index) {
  currentFilters.splice(index, 1);
  renderFilterRows();
}

/** Build the <option> list of operators allowed for a given dimension (§5 filter rules) */
function operatorOptionsFor(dataset, dimensionKey, selectedOperator) {
  const fromServer = (dataset?.dimensionOperators || []).find(d => d.dimension === dimensionKey);
  const ops = fromServer?.allowedOperators?.length ? fromServer.allowedOperators : allowedOperatorsFor(dimensionKey);
  return ops.map(op => `<option value="${op}" ${op === selectedOperator ? 'selected' : ''}>${t(op)}</option>`).join('');
}

/** Render Dynamic Filter Rows */
function renderFilterRows() {
  const container = DOM.qs('#builder-filters-list');
  if (!container) return;

  if (currentFilters.length === 0) {
    container.innerHTML = `<p class="reports-filter-empty-hint">لا توجد فلاتر مخصصة مضافة (سيتم تضمين كامل السجلات).</p>`;
    return;
  }

  const dimOptions = (currentDataset?.allowedDimensions || [])
    .filter(d => d !== 'None')
    .map(d => `<option value="${d}">${t(d)}</option>`)
    .join('');

  container.innerHTML = currentFilters.map((f, i) => `
    <div class="builder-filter-row" data-index="${i}">
      <select class="reports-select filter-field-select" data-index="${i}" aria-label="حقل الفلتر ${i + 1}">
        ${dimOptions}
      </select>
      <select class="reports-select filter-op-select" data-index="${i}" aria-label="معامل الفلتر ${i + 1}">
        ${operatorOptionsFor(currentDataset, f.field, f.operator)}
      </select>
      <input type="text" class="reports-search-input filter-val-input" aria-label="${f.operator === 'Between' ? 'بداية القيمة' : 'قيمة الفلتر'} ${i + 1}" placeholder="${f.operator === 'Between' ? 'من (YYYY-MM)...' : 'القيمة...'}" value="${DOM.escapeHTML(f.value)}" data-index="${i}" dir="rtl">
      ${f.operator === 'Between' ? `<input type="text" class="reports-search-input filter-valto-input" aria-label="نهاية القيمة ${i + 1}" placeholder="إلى (YYYY-MM)..." value="${DOM.escapeHTML(f.valueTo || '')}" data-index="${i}" dir="rtl">` : ''}
      <button type="button" class="btn btn--danger-outline btn-remove-filter" data-index="${i}" title="حذف الفلتر" aria-label="حذف الفلتر ${i + 1}">
        ✕
      </button>
    </div>
  `).join('');

  // Bind change events
  container.querySelectorAll('.filter-field-select').forEach(el => {
    el.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      currentFilters[idx].field = e.target.value;
      // Operator set depends on the dimension (RegistrationMonth allows more) -- reset to Equals and re-render.
      currentFilters[idx].operator = 'Equals';
      renderFilterRows();
    });
  });

  container.querySelectorAll('.filter-op-select').forEach(el => {
    el.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      currentFilters[idx].operator = e.target.value;
      renderFilterRows(); // re-render to show/hide the "valueTo" input for Between
    });
  });

  container.querySelectorAll('.filter-val-input').forEach(el => {
    el.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      currentFilters[idx].value = e.target.value;
    });
  });

  container.querySelectorAll('.filter-valto-input').forEach(el => {
    el.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      currentFilters[idx].valueTo = e.target.value;
    });
  });

  container.querySelectorAll('.btn-remove-filter').forEach(el => {
    el.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      removeFilterRow(idx);
    });
  });
}

/** Build request payload */
function buildPayload() {
  const dataset = DOM.qs('#builder-dataset-select')?.value || 'Cases';
  const dimension = DOM.qs('#builder-dimension-select')?.value || 'Status';
  const metric = DOM.qs('#builder-metric-select')?.value || 'Count';
  const aggregation = DOM.qs('#builder-aggregation-select')?.value || 'Count';
  const sortDirection = DOM.qs('#builder-sort-select')?.value || 'Descending';
  const maxRows = Math.min(5000, Math.max(1, parseInt(DOM.qs('#builder-max-rows')?.value || '100', 10)));

  const validFilters = currentFilters
    .filter(f => f.value && f.value.trim() !== '')
    .map(f => ({
      field: f.field,
      operator: f.operator,
      value: f.value.trim(),
      valueTo: f.operator === 'Between' && f.valueTo ? f.valueTo.trim() : null
    }));

  return {
    dataset,
    dimension,
    metric,
    aggregation,
    filters: validFilters.length > 0 ? validFilters : null,
    sortDirection,
    maxRows
  };
}

/** Show inline error message near builder */
function showInlineError(message) {
  const errBox = DOM.qs('#builder-error-box');
  if (errBox) {
    errBox.textContent = message;
    errBox.style.display = 'block';
  }
}

/** Hide inline error message */
function hideInlineError() {
  const errBox = DOM.qs('#builder-error-box');
  if (errBox) {
    errBox.style.display = 'none';
    errBox.textContent = '';
  }
}

/** Execute Report Builder Query */
async function runBuilderQuery() {
  hideInlineError();
  // Clicked before the schema finished loading — wait for it rather than
  // sending a payload with no dataset.
  if (!currentDataset) await loadBuilderDatasets();
  const runBtn = DOM.qs('#btn-builder-run');
  if (runBtn) {
    runBtn.disabled = true;
    runBtn.classList.add('btn--loading');
  }

  const payload = buildPayload();

  try {
    const res = await ReportsService.runBuilder(payload);
    lastResult = res?.data || res;
    renderResults();
    showToast('تم استخراج نتائج التقرير المخصص بنجاح ✅');
  } catch (err) {
    console.error('[ReportBuilder] Query error:', err);
    const msg = err.data?.error?.message || err.message || 'حدث خطأ أثناء تنفيذ استعلام التقرير';
    showInlineError(`خطأ في الاستعلام: ${msg}`);
    showToast('تعذر استخراج التقرير — يرجى مراجعة المعايير ⚠️');
  } finally {
    if (runBtn) {
      runBtn.disabled = false;
      runBtn.classList.remove('btn--loading');
    }
  }
}

/** Export Query Result as CSV */
async function exportBuilderCsv() {
  const exportBtn = DOM.qs('#btn-builder-export');
  if (exportBtn) {
    exportBtn.disabled = true;
    exportBtn.classList.add('btn--loading');
  }

  const payload = buildPayload();

  try {
    await ReportsService.exportCsv(payload);
    showToast('تم تصدير ملف CSV للتقرير بنجاح 📥');
  } catch (err) {
    console.error('[ReportBuilder] CSV Export error:', err);
    showToast(`تعذر تصدير الملف: ${err.message || 'خطأ في التصدير'}`);
  } finally {
    if (exportBtn) {
      exportBtn.disabled = false;
      exportBtn.classList.remove('btn--loading');
    }
  }
}

/** Render Output Table / Chart */
function renderResults() {
  const outputWrap = DOM.qs('#builder-results-output');
  const truncBanner = DOM.qs('#builder-truncated-banner');
  if (!outputWrap) return;

  if (!lastResult || !Array.isArray(lastResult.rows)) {
    outputWrap.innerHTML = `
      <div class="reports-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 8px; color: #94a3b8;">
          <rect x="3" y="3" width="18" height="18" rx="2"></rect>
          <line x1="3" y1="9" x2="21" y2="9"></line>
          <line x1="9" y1="21" x2="9" y2="9"></line>
        </svg>
        <p>قم بتحديد المعايير والضغط على "تشغيل التقرير" لاستعراض النتائج والتحليلات المخصصة.</p>
      </div>
    `;
    if (truncBanner) truncBanner.style.display = 'none';
    return;
  }

  const { rows, truncated, maxRows } = lastResult;

  // Truncation banner (§3.4 & §7)
  if (truncBanner) {
    if (truncated) {
      truncBanner.innerHTML = `
        <div class="rep-warning-banner">
          ⚠️ تنبيه: تم الوصول للحد الأقصى للعرض (عرض أعلى ${maxRows} نتيجة من إجمالي أكبر). يمكنك تضييق نطاق الفلاتر أو زيادة الحد الأقصى للصفوف.
        </div>
      `;
      truncBanner.style.display = 'block';
    } else {
      truncBanner.style.display = 'none';
    }
  }

  if (rows.length === 0) {
    outputWrap.innerHTML = `<div class="reports-empty">لم يتم العثور على أي نتائج تطابق محددات الاستعلام.</div>`;
    return;
  }

  const dimTitle = t(DOM.qs('#builder-dimension-select')?.value || 'البُعد');
  const metricTitle = t(DOM.qs('#builder-metric-select')?.value || 'المقياس');

  if (viewMode === 'table') {
    const totalMetric = rows.reduce((acc, r) => acc + (typeof r.metricValue === 'number' ? r.metricValue : 0), 0);
    const tableHtml = `
      <div class="reports-table-responsive">
        <table class="reports-table">
          <thead>
            <tr>
              <th>#</th>
              <th>${dimTitle}</th>
              <th>${metricTitle}</th>
              <th>النسبة من الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row, idx) => {
              const val = row.metricValue;
              const formattedVal = typeof val === 'number' ? Number(val.toFixed(2)).toLocaleString('ar-EG') : val;
              const pct = totalMetric > 0 && typeof val === 'number' ? Math.round((val / totalMetric) * 100) : 0;
              return `
                <tr>
                  <td>${idx + 1}</td>
                  <td style="font-weight: 700;">${DOM.escapeHTML(row.dimensionValue || 'غير محدد')}</td>
                  <td><strong style="color: #2563eb;">${formattedVal}</strong></td>
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
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
    outputWrap.innerHTML = tableHtml;
  } else {
    // Chart View: CSS horizontal bar visualization
    const maxVal = Math.max(...rows.map(r => (typeof r.metricValue === 'number' ? r.metricValue : 0))) || 1;
    const chartHtml = `
      <div class="builder-chart-container">
        ${rows.map(r => {
          const val = r.metricValue;
          const pct = Math.round(((val || 0) / maxVal) * 100);
          const formattedVal = typeof val === 'number' ? Number(val.toFixed(2)).toLocaleString('ar-EG') : val;
          return `
            <div class="builder-chart-bar-row">
              <div class="builder-chart-label" title="${DOM.escapeHTML(r.dimensionValue || 'غير محدد')}">
                ${DOM.escapeHTML(r.dimensionValue || 'غير محدد')}
              </div>
              <div class="builder-chart-track">
                <div class="builder-chart-fill" style="width: ${pct}%;">
                  <span class="builder-chart-val">${formattedVal}</span>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
    outputWrap.innerHTML = chartHtml;
  }
}
