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
import { ReferenceData } from './reference-data.js';
import { fetchAllPages } from './paging.js';

// In-flight GET /charities requests, keyed by their query (the management
// screen's searchable, paged list — never cached, it carries rowVersions for
// editing). Entries live only while the request is pending, and are dropped
// on any local write so a reload right after a save can't join a pre-write request.
const listInFlight = new Map();

// The full roster used by pickers (dashboard search, referral cascade,
// support filter) — kept in the shared localStorage reference cache and
// re-fetched only when GET /reference-data/versions reports a change.
const REFERENCE_ENTRY_KEY = 'charities';

async function invalidatingWrite(request) {
  try {
    return await request;
  } finally {
    listInFlight.clear();
    ReferenceData.remove(REFERENCE_ENTRY_KEY);
  }
}

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
  list(opts = {}) {
    const { search, centerId, page, limit } = opts;
    const key = JSON.stringify([search, centerId, page, limit]);
    const pending = listInFlight.get(key);
    if (pending) return pending;

    const promise = HttpClient.get('/charities', { query: { search, centerId, page, limit } })
      .finally(() => {
        if (listInFlight.get(key) === promise) listInFlight.delete(key);
      });
    listInFlight.set(key, promise);
    return promise;
  },

  /**
   * EVERY charity matching the filters, not one page (see paging.js — the
   * server caps a page at 100). Screens that only show part of it (the
   * management table: 50 + "load more") slice client-side. Each page goes
   * through list(), so concurrent identical calls still share their requests.
   * @param {Object} [opts]
   * @param {string} [opts.search]
   * @param {string} [opts.centerId]
   * @returns {Promise<{items: CharityListItem[], total: number}>}
   */
  listAll(opts = {}) {
    const { search, centerId } = opts;
    return fetchAllPages((page, limit) => CharitiesService.list({ search, centerId, page, limit }));
  },

  /**
   * Full roster for pickers, served from the reference cache when fresh.
   * @returns {Promise<{items: CharityListItem[], total: number}>}
   */
  listReference() {
    return ReferenceData.load(
      REFERENCE_ENTRY_KEY,
      () => CharitiesService.listAll()
    );
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
    return invalidatingWrite(HttpClient.post('/charities', { body: data }));
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
    return invalidatingWrite(HttpClient.put(`/charities/${id}`, { body: data }));
  },

  /** Soft delete — no dependent-data guard on this endpoint. @throws {ApiError} NOT_FOUND */
  async remove(id) {
    return invalidatingWrite(HttpClient.delete(`/charities/${id}`));
  }
};
