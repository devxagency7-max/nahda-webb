/* --------------------------------------------------------------------------
   REPORTS API SERVICE CLIENT
   Comprehensive client for the Reporting & Data Analysis module (/api/v1/reports)
   Aligned with FRONTEND_REPORTING_HANDOFF.md, REPORTING_ARCHITECTURE.md
   -------------------------------------------------------------------------- */
import { HttpClient } from './http.js';
import { TokenStore } from './tokens.js';
import { RequestTimeoutError } from './errors.js';
import { API_EXPORT_TIMEOUT_MS } from '../config/env.js';
import { toWireRequest } from '../utils/report-enums.js';

const CACHE_TTL_MS = 45000; // 45 seconds client-side cache
const cache = new Map();

function getCached(key) {
  const item = cache.get(key);
  if (item && Date.now() - item.ts < CACHE_TTL_MS) {
    return item.data;
  }
  cache.delete(key);
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

export function clearReportsCache() {
  cache.clear();
}

/** Wrapper around HttpClient.get with client-side caching */
async function cachedGet(path, query = {}) {
  const cacheKey = `${path}?${new URLSearchParams(query).toString()}`;
  const hit = getCached(cacheKey);
  if (hit) return hit;

  const res = await HttpClient.get(path, { query });
  setCache(cacheKey, res);
  return res;
}

export const ReportsService = {
  /* ------------------------------------------------------------------------
     1. CATALOG & DATASET DISCOVERY
     ------------------------------------------------------------------------ */
  /** GET /api/v1/reports/catalog */
  async getCatalog() {
    return cachedGet('/reports/catalog');
  },

  /** GET /api/v1/reports/datasets */
  async getDatasets() {
    return cachedGet('/reports/datasets');
  },

  /** GET /api/v1/reports/datasets/{dataset} */
  async getDataset(datasetName) {
    return cachedGet(`/reports/datasets/${encodeURIComponent(datasetName)}`);
  },

  /* ------------------------------------------------------------------------
     2. DASHBOARDS
     ------------------------------------------------------------------------ */
  /** GET /api/v1/reports/dashboards/executive */
  async getExecutiveDashboard() {
    return cachedGet('/reports/dashboards/executive');
  },

  /** GET /api/v1/reports/dashboards/cases */
  async getCasesDashboard() {
    return cachedGet('/reports/dashboards/cases');
  },

  /** GET /api/v1/reports/dashboards/beneficiaries */
  async getBeneficiariesDashboard() {
    return cachedGet('/reports/dashboards/beneficiaries');
  },

  /** GET /api/v1/reports/dashboards/geographic */
  async getGeographicDashboard() {
    return cachedGet('/reports/dashboards/geographic');
  },

  /** GET /api/v1/reports/dashboards/support */
  async getSupportDashboard() {
    return cachedGet('/reports/dashboards/support');
  },

  /** GET /api/v1/reports/dashboards/financial (requires view_financial_reports) */
  async getFinancialDashboard() {
    return cachedGet('/reports/dashboards/financial');
  },

  /** GET /api/v1/reports/dashboards/visits */
  async getVisitsDashboard() {
    return cachedGet('/reports/dashboards/visits');
  },

  /** GET /api/v1/reports/dashboards/employees */
  async getEmployeesDashboard() {
    return cachedGet('/reports/dashboards/employees');
  },

  /** GET /api/v1/reports/dashboards/data-quality */
  async getDataQualityDashboard() {
    return cachedGet('/reports/dashboards/data-quality');
  },

  /* ------------------------------------------------------------------------
     3. FIXED REPORTS & AGGREGATIONS
     ------------------------------------------------------------------------ */
  /** GET /api/v1/reports/cases/summary?from=&to= */
  async getCasesSummary({ from, to } = {}) {
    const query = {};
    if (from) query.from = from;
    if (to) query.to = to;
    return cachedGet('/reports/cases/summary', query);
  },

  /** GET /api/v1/reports/cases/by-status */
  async getCasesByStatus() {
    return cachedGet('/reports/cases/by-status');
  },

  /** GET /api/v1/reports/cases/by-location */
  async getCasesByLocation() {
    return cachedGet('/reports/cases/by-location');
  },

  /** GET /api/v1/reports/cases/aging */
  async getCasesAging() {
    return cachedGet('/reports/cases/aging');
  },

  /** GET /api/v1/reports/beneficiaries/summary */
  async getBeneficiariesSummary() {
    return cachedGet('/reports/beneficiaries/summary');
  },

  /** GET /api/v1/reports/support/summary */
  async getSupportSummary() {
    return cachedGet('/reports/support/summary');
  },

  /** GET /api/v1/reports/support/by-type */
  async getSupportByType() {
    return cachedGet('/reports/support/by-type');
  },

  /**
   * GET /api/v1/reports/support/by-recipient (view_reports) — لكل نوع دعم: عدد الأسر،
   * الأسرة كلها، أرباب الأسر، الأفراد، الطلاب، والإجمالي. بيقرا من الدعم المقترح.
   * @param {{approvedOnly?: boolean, centerId?: string, villageId?: string}} [filters]
   *   approvedOnly الافتراضي true (الحالات المعتمدة بس).
   * @returns {Promise<Array<{supportType: string, category: string|null, cases: number,
   *   householdCases: number, heads: number, familyMembers: number, studentMembers: number, individuals: number}>>}
   */
  async getSupportByRecipient({ approvedOnly = true, centerId, villageId } = {}) {
    const query = { approvedOnly: String(approvedOnly) };
    if (centerId) query.centerId = centerId;
    if (villageId) query.villageId = villageId;
    return cachedGet('/reports/support/by-recipient', query);
  },

  /** GET /api/v1/reports/financial/summary (requires view_financial_reports) */
  async getFinancialSummary() {
    return cachedGet('/reports/financial/summary');
  },

  /** GET /api/v1/reports/visits/summary */
  async getVisitsSummary() {
    return cachedGet('/reports/visits/summary');
  },

  /** GET /api/v1/reports/employees/activity?from=&to= */
  async getEmployeesActivity({ from, to } = {}) {
    const query = {};
    if (from) query.from = from;
    if (to) query.to = to;
    return cachedGet('/reports/employees/activity', query);
  },

  /** GET /api/v1/reports/data-quality */
  async getDataQuality() {
    return cachedGet('/reports/data-quality');
  },

  /** GET /api/v1/reports/data-coverage */
  async getDataCoverage() {
    return cachedGet('/reports/data-coverage');
  },

  /**
   * GET /api/v1/reports/comparisons?metric=&currentFrom=&currentTo=&previousFrom=&previousTo=
   * @param {{ metric: 'Count' | 'TotalAmount', currentFrom: string, currentTo: string, previousFrom: string, previousTo: string }} params
   */
  async getComparison({ metric = 'Count', currentFrom, currentTo, previousFrom, previousTo }) {
    return cachedGet('/reports/comparisons', {
      metric,
      currentFrom,
      currentTo,
      previousFrom,
      previousTo
    });
  },

  /* ------------------------------------------------------------------------
     4. REPORT BUILDER
     ------------------------------------------------------------------------ */
  /**
   * POST /api/v1/reports/builder/run
   * @param {import('../types/reports.types').ReportBuilderRequest} requestBody UI-shaped request (string enum keys)
   */
  async runBuilder(requestBody) {
    // Report builder queries are not cached (always fresh per §11).
    // Backend has no JsonStringEnumConverter -- translate enums to their wire integers here.
    return HttpClient.post('/reports/builder/run', { body: toWireRequest(requestBody) });
  },

  /* ------------------------------------------------------------------------
     5. CSV STREAMING EXPORT
     ------------------------------------------------------------------------ */
  /**
   * POST /api/v1/reports/export (requires export_reports)
   * Downloads text/csv directly via browser.
   * @param {import('../types/reports.types').ReportBuilderRequest} requestBody UI-shaped request (string enum keys)
   */
  async exportCsv(requestBody) {
    const baseUrl = import.meta.env?.VITE_API_BASE_URL || '/api/v1';
    const token = TokenStore.getAccessToken();

    // Bypasses HttpClient (binary download), so it needs its own timeout —
    // covering the body download too, with a longer budget than normal calls.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_EXPORT_TIMEOUT_MS);

    let response;
    let blob;
    try {
      response = await fetch(`${baseUrl}/reports/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Type': 'web',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(toWireRequest(requestBody)),
        signal: controller.signal
      });

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch {
          errorData = { error: { message: `HTTP ${response.status}` } };
        }
        const err = new Error(errorData?.error?.message || 'تعذر تصدير ملف CSV');
        err.status = response.status;
        err.data = errorData;
        throw err;
      }

      blob = await response.blob();
    } catch (cause) {
      if (cause?.name === 'AbortError') throw new RequestTimeoutError(cause);
      throw cause;
    } finally {
      clearTimeout(timer);
    }

    const disposition = response.headers.get('content-disposition');
    let filename = 'report.csv';
    if (disposition && disposition.includes('filename=')) {
      const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
      if (match && match[1]) {
        filename = match[1].replace(/['"]/g, '');
      }
    }

    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
  }
};
