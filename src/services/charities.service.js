/* --------------------------------------------------------------------------
   CHARITIES SERVICE
   Wraps GET/POST/PUT/DELETE /charities and GET /charities/export
   (WEB_API_DOCUMENTATION.md §22 "Charities"). Reads only require
   authentication; every write requires `manage_charities`. Writes take
   real `centerId`/`villageId` GUIDs (not names) and `PUT` requires the
   current `rowVersion` (uint, backed by Postgres xmin) — a stale value
   throws 409 CONCURRENCY_CONFLICT.
   -------------------------------------------------------------------------- */
import { HttpClient } from './http.js';

export const CharitiesService = {
  /**
   * @param {Object} [opts]
   * @param {string} [opts.search]
   * @param {string} [opts.centerId]
   * @param {number} [opts.page]
   * @param {number} [opts.limit]
   * @returns {Promise<PagedResult<CharityListItem>>}
   *   CharityListItem: {id, name, governorate, centerId, villageId, phone, dateAdded, rowVersion}
   *   Note: no `address` on the list item — only on the single-entity create/update bodies.
   */
  async list(opts = {}) {
    const { search, centerId, page, limit } = opts;
    return HttpClient.get('/charities', { query: { search, centerId, page, limit } });
  },

  /**
   * @returns {Promise<string>} raw CSV text (UTF-8 with BOM), unfiltered — always ALL active charities.
   * @throws {ApiError} FORBIDDEN if the caller lacks manage_charities (stricter than list()).
   */
  async exportCsv() {
    return HttpClient.get('/charities/export', { raw: true });
  },

  /**
   * @param {Object} data
   * @param {string} data.name
   * @param {string} data.centerId - GUID, must exist
   * @param {string} data.villageId - GUID, must belong to centerId
   * @param {string|null} [data.address]
   * @param {string|null} [data.phone]
   * @returns {Promise<string>} new charity's id
   * @throws {ApiError} VALIDATION_ERROR (bad centerId/villageId pair -> 422, not 404)
   */
  async create(data) {
    return HttpClient.post('/charities', { body: data });
  },

  /**
   * @param {string} id
   * @param {Object} data
   * @param {string} data.name
   * @param {string} data.centerId
   * @param {string} data.villageId
   * @param {string|null} [data.address]
   * @param {string|null} [data.phone]
   * @param {number} data.rowVersion - required concurrency token, from the last list/read
   * @throws {ApiError} NOT_FOUND | CONCURRENCY_CONFLICT | VALIDATION_ERROR
   */
  async update(id, data) {
    return HttpClient.put(`/charities/${id}`, { body: data });
  },

  /** Soft delete — no dependent-data guard on this endpoint. @throws {ApiError} NOT_FOUND */
  async remove(id) {
    return HttpClient.delete(`/charities/${id}`);
  }
};
