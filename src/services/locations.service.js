/* --------------------------------------------------------------------------
   LOCATIONS SERVICE
   Wraps GET/POST/PUT/DELETE /locations/{centers,villages} and /locations/reset
   (WEB_API_DOCUMENTATION.md §22 "Locations"). Centers/villages have no
   rowVersion/concurrency token on the wire — writes are last-write-wins by
   backend design, not an oversight here.
   -------------------------------------------------------------------------- */
import { HttpClient } from './http.js';

export const LocationsService = {
  /**
   * @returns {Promise<Array<{id:string,name:string,villages:Array<{id:string,name:string}>}>>}
   *   Centers ordered by name, each with its villages nested (already scoped
   *   per-center — prefer this over GET /dropdowns/district|village, which
   *   returns a flat, center-agnostic list — see §16/§22 frontend notes).
   */
  async list() {
    return HttpClient.get('/locations');
  },

  /** @returns {Promise<string>} new center's id */
  async createCenter(name) {
    return HttpClient.post('/locations/centers', { body: { name } });
  },

  async renameCenter(id, name) {
    return HttpClient.put(`/locations/centers/${id}`, { body: { name } });
  },

  /** @throws {ApiError} DELETE_CONFLICT if the center still has villages attached */
  async deleteCenter(id) {
    return HttpClient.delete(`/locations/centers/${id}`);
  },

  /** @returns {Promise<string>} new village's id */
  async createVillage(centerId, name) {
    return HttpClient.post('/locations/villages', { body: { centerId, name } });
  },

  /** Rename only — a village cannot be moved to another center via this route. */
  async renameVillage(id, name) {
    return HttpClient.put(`/locations/villages/${id}`, { body: { name } });
  },

  async deleteVillage(id) {
    return HttpClient.delete(`/locations/villages/${id}`);
  },

  /** Destructive & irreversible server-side — always confirm in the UI first. */
  async reset() {
    return HttpClient.post('/locations/reset');
  }
};
