/* --------------------------------------------------------------------------
   LOCATIONS SERVICE
   Wraps GET/POST/PUT/DELETE /locations/{centers,villages} and /locations/reset
   (WEB_API_DOCUMENTATION.md §22 "Locations"). Centers/villages have no
   rowVersion/concurrency token on the wire — writes are last-write-wins by
   backend design, not an oversight here.
   -------------------------------------------------------------------------- */
import { HttpClient } from './http.js';
import { ReferenceData } from './reference-data.js';

// Unfiltered and read by several screens (charities, dashboard, workflow,
// state-data-management, employees) — kept in the shared localStorage
// reference cache (services/reference-data.js), which also makes concurrent
// callers share one request. Dropped on any mutation below.
const ENTRY_KEY = 'locations';

export const LocationsService = {
  /**
   * @param {boolean} [forceRefresh]
   * @returns {Promise<Array<{id:string,name:string,villages:Array<{id:string,name:string}>}>>}
   *   Centers ordered by name, each with its villages nested (already scoped
   *   per-center — prefer this over GET /dropdowns/district|village, which
   *   returns a flat, center-agnostic list — see §16/§22 frontend notes).
   */
  list(forceRefresh = false) {
    return ReferenceData.load(ENTRY_KEY, () => HttpClient.get('/locations'), { forceRefresh });
  },

  /** Synchronous read of the cached list (possibly stale), or undefined. */
  peekCached() {
    return ReferenceData.peek(ENTRY_KEY);
  },

  clearCache() {
    ReferenceData.remove(ENTRY_KEY);
  },

  /** @returns {Promise<string>} new center's id */
  async createCenter(name) {
    const id = await HttpClient.post('/locations/centers', { body: { name } });
    LocationsService.clearCache();
    return id;
  },

  async renameCenter(id, name) {
    const result = await HttpClient.put(`/locations/centers/${id}`, { body: { name } });
    LocationsService.clearCache();
    return result;
  },

  /** @throws {ApiError} DELETE_CONFLICT if the center still has villages attached */
  async deleteCenter(id) {
    const result = await HttpClient.delete(`/locations/centers/${id}`);
    LocationsService.clearCache();
    return result;
  },

  /** @returns {Promise<string>} new village's id */
  async createVillage(centerId, name) {
    const id = await HttpClient.post('/locations/villages', { body: { centerId, name } });
    LocationsService.clearCache();
    return id;
  },

  /** Rename only — a village cannot be moved to another center via this route. */
  async renameVillage(id, name) {
    const result = await HttpClient.put(`/locations/villages/${id}`, { body: { name } });
    LocationsService.clearCache();
    return result;
  },

  async deleteVillage(id) {
    const result = await HttpClient.delete(`/locations/villages/${id}`);
    LocationsService.clearCache();
    return result;
  },

  /** Destructive & irreversible server-side — always confirm in the UI first. */
  async reset() {
    const result = await HttpClient.post('/locations/reset');
    LocationsService.clearCache();
    return result;
  }
};
