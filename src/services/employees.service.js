/* --------------------------------------------------------------------------
   EMPLOYEES SERVICE
   Wraps /employees/* (WEB_API_DOCUMENTATION.md §22 "Employees"). Every write
   requires `manage_employees`; the plain list only needs `view_employees`.
   The backend never generates email/password — the caller must send them
   (see CreateEmployeeRequest) and is responsible for generating them
   client-side, same as today.
   -------------------------------------------------------------------------- */
import { HttpClient } from './http.js';
import { fetchAllPages } from './paging.js';

export const EmployeesService = {
  /**
   * @param {Object} [opts]
   * @param {string} [opts.search]
   * @param {string} [opts.role] - 'manager' | 'reviewer' | 'data_entry' | 'social_worker'
   * @param {number} [opts.page]
   * @param {number} [opts.limit]
   * @returns {Promise<PagedResult<EmployeeListItem>>}
   */
  async list(opts = {}) {
    const { search, role, page, limit } = opts;
    return HttpClient.get('/employees', { query: { search, role, page, limit } });
  },

  /**
   * EVERY employee matching the filters, not one page (see paging.js — the
   * server caps a page at 100). The management table draws the first 50 and
   * reveals more client-side.
   * @param {Object} [opts]
   * @param {string} [opts.search]
   * @param {string} [opts.role]
   * @returns {Promise<{items: EmployeeListItem[], total: number}>}
   */
  listAll(opts = {}) {
    const { search, role } = opts;
    return fetchAllPages((page, limit) => EmployeesService.list({ search, role, page, limit }));
  },

  /**
   * @param {Object} [opts]
   * @param {string} [opts.search]
   * @param {string} [opts.role]
   * @returns {Promise<string>} raw CSV text (UTF-8 with BOM) — `FullName,Email,Role,Status,Phone`,
   *   deliberately excludes any credential material.
   */
  async exportCsv(opts = {}) {
    const { search, role } = opts;
    return HttpClient.get('/employees/export', { query: { search, role }, raw: true });
  },

  /**
   * @param {string} [search]
   * @returns {Promise<Array<{id,fullName,phone,centerId}>>}
   */
  async listSocialWorkers(search) {
    return HttpClient.get('/employees/social-workers', { query: { search } });
  },

  /**
   * @param {Object} data
   * @param {string} data.fullName
   * @param {string} data.email
   * @param {string} data.password - min 8 chars, generated client-side
   * @param {string} data.role
   * @param {string|null} [data.centerId]
   * @param {string|null} [data.phone]
   * @param {string|null} [data.gender]
   * @returns {Promise<string>} new employee's user-guid
   * @throws {ApiError} DUPLICATE_RESOURCE | VALIDATION_ERROR
   */
  async create(data) {
    return HttpClient.post('/employees', { body: data });
  },

  /**
   * Cannot change role/status/email/password — structurally excluded server-side.
   * @param {string} id
   * @param {Object} data
   * @param {string} data.fullName
   * @param {string|null} [data.centerId]
   * @param {string|null} [data.phone]
   * @param {string|null} [data.gender]
   * @param {number} data.rowVersion - required concurrency token
   * @throws {ApiError} NOT_FOUND | CONCURRENCY_CONFLICT | VALIDATION_ERROR
   */
  async update(id, data) {
    return HttpClient.put(`/employees/${id}`, { body: data });
  },

  /**
   * @param {string} id
   * @param {string} role
   * @throws {ApiError} NOT_FOUND | VALIDATION_ERROR
   */
  async changeRole(id, role) {
    return HttpClient.post(`/employees/${id}/role`, { body: { role } });
  },

  /** @throws {ApiError} NOT_FOUND */
  async activate(id) {
    return HttpClient.post(`/employees/${id}/activate`);
  },

  /** @throws {ApiError} NOT_FOUND */
  async deactivate(id) {
    return HttpClient.post(`/employees/${id}/deactivate`);
  },

  /** Soft delete. Email stays permanently reserved afterwards. @throws {ApiError} NOT_FOUND */
  async remove(id) {
    return HttpClient.delete(`/employees/${id}`);
  },

  /**
   * Resets the employee's password (manager/admin action, not self-service).
   * Also clears `access_failed_count` and unlocks the account server-side.
   * The new password is never returned/logged — show it to the caller once.
   * @param {string} id
   * @param {string} newPassword - min 8 chars
   * @throws {ApiError} NOT_FOUND | VALIDATION_ERROR
   */
  async resetPassword(id, newPassword) {
    return HttpClient.post(`/employees/${id}/reset-password`, { body: { newPassword } });
  }
};
