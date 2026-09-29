/* --------------------------------------------------------------------------
   DROPDOWNS / DROPDOWN-CONFIGS SERVICE
   Wraps the "ضبط بيانات الحالة" config-admin routes and the plain-consumption
   route every wizard form field ultimately needs (WEB_API_DOCUMENTATION.md
   §22 "State Data Configuration"). Wired into:
   - state-data-management.component.js (admin CRUD — listConfigs/
     getConfigOptions/createOption/updateOption/deactivateOption).
   - dropdown-data.component.js (consumption — getOptions() populates the
     personal-data wizard's <select> elements at bootstrap).
   Admin routes require `manage_configurations`, which is data_entry-only
   on the server (confirmed 2026-09-22) — never manager-only, despite what
   older comments in this codebase may say.
   -------------------------------------------------------------------------- */
import { HttpClient } from './http.js';

// Options for a key rarely change mid-session, and the server already
// caches this same data in Redis for an hour. Backed by sessionStorage (not
// just an in-memory Map) so a page refresh — which used to re-fire all ~18
// dropdown requests at once on every reload — reuses what was already
// fetched this tab session instead. Tab-scoped and cleared on close, unlike
// localStorage, since this is fetched data, not account state.
const CACHE_KEY = 'nahda_dropdown_cache';

function readCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? new Map(Object.entries(JSON.parse(raw))) : new Map();
  } catch {
    return new Map();
  }
}

function writeCache(map) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(map)));
  } catch {
    // Best-effort — a full/unavailable sessionStorage just means no cache.
  }
}

const consumptionCache = readCache();

// Admin routes ("ضبط بيانات الحالة") hit their own sessionStorage cache, kept
// separate from consumptionCache since it holds inactive options too and is
// invalidated on every admin mutation (createOption/updateOption).
const ADMIN_CACHE_KEY = 'nahda_dropdown_admin_cache';
const adminOptionsCache = (() => {
  try {
    const raw = sessionStorage.getItem(ADMIN_CACHE_KEY);
    return raw ? new Map(Object.entries(JSON.parse(raw))) : new Map();
  } catch {
    return new Map();
  }
})();

function writeAdminCache() {
  try {
    sessionStorage.setItem(ADMIN_CACHE_KEY, JSON.stringify(Object.fromEntries(adminOptionsCache)));
  } catch {
    // Best-effort — a full/unavailable sessionStorage just means no cache.
  }
}

export const DropdownsService = {
  /**
   * Consumption route — every role, auth only. Used to populate an actual
   * form <select>. Dynamic keys (district/village/referral-*-select)
   * resolve to real Center/Village/Charity rows — `value` on those options
   * is a row UUID, not a label (§16/§22 — and village-type keys are NOT
   * center-scoped; prefer LocationsService.list() for a cascading picker).
   * @param {string} key
   * @param {boolean} [forceRefresh]
   * @returns {Promise<{key:string, options:Array<{id,value,label,isOther,sortOrder,parentOptionId}>}>}
   */
  async getOptions(key, forceRefresh = false) {
    if (!forceRefresh && consumptionCache.has(key)) {
      return consumptionCache.get(key);
    }
    const data = await HttpClient.get(`/dropdowns/${encodeURIComponent(key)}`);
    consumptionCache.set(key, data);
    writeCache(consumptionCache);
    return data;
  },

  clearCache(key) {
    if (key) consumptionCache.delete(key);
    else consumptionCache.clear();
    writeCache(consumptionCache);
  },

  /**
   * GET /dropdowns?step=&fieldType= — flat, auth-only consumption listing
   * across a whole wizard step (unlike getOptions(), which is per-key).
   * Used e.g. to resolve the appliance/utility chip keys for step 4
   * (housing/utilities) without hardcoding them client-side.
   * @param {{step?:number, fieldType?:'select'|'chip'|'support'}} [filters]
   * @returns {Promise<Array<{key:string, label:string, fieldType:string, step:number}>>}
   */
  async listChipOptions(filters = {}) {
    return HttpClient.get('/dropdowns', { query: filters });
  },

  // ------------------------------------------------------------------------
  // Admin routes — manage_configurations (data_entry only). "ضبط بيانات الحالة".
  // ------------------------------------------------------------------------

  /**
   * @param {{step?:number, fieldType?:'select'|'chip'|'support', isActive?:boolean}} [filters]
   * @returns {Promise<{items:Array, meta:{total:number, byType:Object}}>}
   */
  async listConfigs(filters = {}) {
    return HttpClient.get('/dropdown-configs', { query: filters });
  },

  async getConfig(id) {
    return HttpClient.get(`/dropdown-configs/${id}`);
  },

  /**
   * Admin listing for one config BY KEY (not id) — includes inactive options,
   * unlike getOptions(). Cached per tab session; cleared by any admin
   * mutation below since options can change from this same screen.
   */
  async getConfigOptions(key, forceRefresh = false) {
    if (!forceRefresh && adminOptionsCache.has(key)) {
      return adminOptionsCache.get(key);
    }
    const data = await HttpClient.get(`/dropdown-configs/${encodeURIComponent(key)}/options`);
    adminOptionsCache.set(key, data);
    writeAdminCache();
    return data;
  },

  clearAdminCache(key) {
    if (key) adminOptionsCache.delete(key);
    else adminOptionsCache.clear();
    writeAdminCache();
  },

  /**
   * @param {string} configId
   * @param {{value:string, label:string, sortOrder?:number, isOther?:boolean, parentOptionId?:string}} option
   * @throws {ApiError} FORBIDDEN if the config isFixed=true (even for a manager)
   * @throws {ApiError} DUPLICATE_RESOURCE if `value` already exists in this config
   */
  async createOption(configId, option) {
    const created = await HttpClient.post(`/dropdown-configs/${configId}/options`, { body: option });
    DropdownsService.clearCache(); // we don't know the config's key here — safest to drop the whole cache
    DropdownsService.clearAdminCache();
    return created;
  },

  /**
   * Partial update — only send fields you want changed; omitted fields are
   * left untouched (never treated as "set to null"). `{isActive:false}` is
   * the ONLY supported "delete" — see deleteOption() below.
   * @param {string} optionId
   * @param {{label?:string, sortOrder?:number, isActive?:boolean, isOther?:boolean}} patch
   */
  async updateOption(optionId, patch) {
    const updated = await HttpClient.patch(`/dropdown-options/${optionId}`, { body: patch });
    DropdownsService.clearCache();
    DropdownsService.clearAdminCache();
    return updated;
  },

  /**
   * There is no real delete — DELETE /dropdown-options/{id} always returns
   * 403 for an existing option (§22, a confirmed permanent business
   * decision). This helper exists so no component ever calls the raw DELETE
   * route by mistake; deactivation is the only supported retirement path.
   */
  async deactivateOption(optionId) {
    return DropdownsService.updateOption(optionId, { isActive: false });
  }
};
