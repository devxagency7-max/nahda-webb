/* --------------------------------------------------------------------------
   STORAGE SERVICE LAYER
   Provides a safe, unified abstraction over localStorage with error handling,
   fallback defaults, and strict key management.
   -------------------------------------------------------------------------- */

export const STORAGE_KEYS = {
  CURRENT_VIEW: 'nahda_current_view',
  ACTIVE_STAGE: 'nahda_active_stage',
  BG_SETTINGS: 'nahda_bg_settings',
  FAMILY_MEMBERS: 'nahda_family_members',
  CURRENT_USER: 'nahda_current_user',
  CHARITIES: 'nahda_charities',
  BENI_SUEF_LOCATIONS: 'nahda_beni_suef_locations',
  EMPLOYEES: 'nahda_employees',
  AGRICULTURE: 'nahda_agriculture_data',
  VISITED_STAGES: 'nahda_visited_stages',
  CURRENT_CASE: 'nahda_current_case',
  ACCESS_TOKEN: 'nahda_access_token',
  REFRESH_TOKEN: 'nahda_refresh_token',
  TOKEN_EXPIRES_AT: 'nahda_token_expires_at'
};

export const StorageService = {
  get(key, defaultValue = null) {
    try {
      const item = localStorage.getItem(key);
      if (item === null) return defaultValue;
      try {
        return JSON.parse(item);
      } catch (parseError) {
        return item; // Fallback for plain string values
      }
    } catch (e) {
      console.warn(`[StorageService] Failed to read key "${key}":`, e);
      return defaultValue;
    }
  },

  set(key, value) {
    try {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      localStorage.setItem(key, serialized);
      return true;
    } catch (e) {
      console.warn(`[StorageService] Failed to write key "${key}":`, e);
      return false;
    }
  },

  remove(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (e) {
      console.warn(`[StorageService] Failed to remove key "${key}":`, e);
      return false;
    }
  }
};
