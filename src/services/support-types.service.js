/* --------------------------------------------------------------------------
   SUPPORT TYPES SERVICE
   GET /support-types (كل الأدوار، view_cases) — القايمة الموحدة لأنواع الدعم
   + أي نوع اتكتب تحت «أخرى» في أي حالة (isCustom). الرد:
   { items: [{ name, category, scope: 'household'|'members', isCustom }] }
   النسخة الثابتة في utils/support-catalog.js احتياطي لو الطلب فشل.
   -------------------------------------------------------------------------- */
import { HttpClient } from './http.js';

export const SupportTypesService = {
  /** @returns {Promise<Array<{name: string, category: string|null, scope: string, isCustom: boolean}>>} */
  async list() {
    const res = await HttpClient.get('/support-types');
    return Array.isArray(res?.items) ? res.items : [];
  }
};
