/* --------------------------------------------------------------------------
   SYSTEM BACKUPS SERVICE (المدير بس — صلاحية download_system_backup)
   النسخة الاحتياطية الشهرية الإجبارية: zip فيه بيانات الحالات (xlsx) +
   المرفقات. أي دور تاني بيرجعله 403.
   - GET  /system-backups/status        -> { downloadRequired, latest }
   - GET  /system-backups               -> سجل آخر 24 شهر
   - POST /system-backups/{id}/download -> { downloadUrl (ساعتين), fileName, sizeBytes }
   - POST /system-backups/rebuild       -> يعيد بناء نسخة الشهر الحالي (دقايق)
   - GET  /reports/cases/export-xlsx    -> تصدير Excel فوري (export_reports)
   -------------------------------------------------------------------------- */
import { HttpClient } from './http.js';
import { TokenStore } from './tokens.js';
import { RequestTimeoutError } from './errors.js';
import { API_EXPORT_TIMEOUT_MS } from '../config/env.js';

// إعادة البناء ممكن تاخد كذا دقيقة — الباك إند طلب timeout لحد 10 دقايق.
const REBUILD_TIMEOUT_MS = 10 * 60 * 1000;

export const SystemBackupsService = {
  /** @returns {Promise<{downloadRequired: boolean, latest: Object|null}>} */
  status() {
    return HttpClient.get('/system-backups/status');
  },

  /** @returns {Promise<Array>} */
  async list() {
    const res = await HttpClient.get('/system-backups');
    return Array.isArray(res) ? res : (res?.items || []);
  },

  /**
   * بيطلب رابط تحميل جديد (صالح ساعتين، ماتخزنوش) — ومجرد النداء بيعلّم
   * النسخة «اتحملت» لكل المديرين.
   * @returns {Promise<{id: string, downloadUrl: string, fileName: string, sizeBytes: number, expiresAtUtc: string}>}
   */
  download(id) {
    return HttpClient.post(`/system-backups/${encodeURIComponent(id)}/download`);
  },

  rebuild() {
    return HttpClient.post('/system-backups/rebuild', { timeoutMs: REBUILD_TIMEOUT_MS });
  },

  /** تصدير Excel فوري — ملف binary فبيعدّي من fetch مباشر (مش HttpClient). */
  async exportCasesXlsx() {
    const baseUrl = import.meta.env?.VITE_API_BASE_URL || '/api/v1';
    const token = TokenStore.getAccessToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_EXPORT_TIMEOUT_MS);

    let response;
    let blob;
    try {
      response = await fetch(`${baseUrl}/reports/cases/export-xlsx`, {
        headers: {
          'X-Client-Type': 'web',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        signal: controller.signal
      });
      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
          message = (await response.json())?.error?.message || message;
        } catch {
          // رد مش JSON — نكتفي برقم الحالة.
        }
        const err = new Error(message);
        err.status = response.status;
        throw err;
      }
      blob = await response.blob();
    } catch (cause) {
      if (cause?.name === 'AbortError') throw new RequestTimeoutError(cause);
      throw cause;
    } finally {
      clearTimeout(timer);
    }

    const disposition = response.headers.get('content-disposition') || '';
    const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^;"'\n]+)/i);
    const filename = match ? decodeURIComponent(match[1]) : 'nahda_cases.xlsx';
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }
};
