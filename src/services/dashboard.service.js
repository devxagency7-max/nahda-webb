/* --------------------------------------------------------------------------
   DASHBOARD SERVICE
   Wraps GET /dashboard/stats and GET /dashboard/work-queue
   (WEB_API_DOCUMENTATION.md §15 / §25). Both are read-only, role-shaped from
   the JWT alone — no query params on stats, page/limit on work-queue.
   -------------------------------------------------------------------------- */
import { HttpClient } from './http.js';

export const DashboardService = {
  /**
   * Shape varies by the caller's role (§15/§25) — a field absent for the
   * current role is genuinely absent from the JSON, never null/0. Do not
   * assume a fixed field set; read only the keys documented for the known
   * role, or treat the result as a loose string->number map.
   *   reviewer:   { awaitingMyReview, totalCases, reviewedByMe, acceptedCases, rejectedCases, returnedToWorker }
   *   manager:    { awaitingMyApproval, totalCases, acceptedCases, rejectedCases, totalEmployees, totalCharities }
   *   data_entry: { createdByMe, totalCases, missingDocuments, pendingReview, approvedCharities }
   * @returns {Promise<Record<string, number>>}
   */
  async getStats() {
    return HttpClient.get('/dashboard/stats');
  },

  /**
   * "What needs my action right now" — auto-filtered server-side by role,
   * no filter params accepted. Item shape is identical to GET /cases /
   * /search/cases results (WorkQueueItem === CaseSearchResultItem).
   *
   * Note: page/limit validation here is STRICTER than /cases or
   * /search/cases — page<=0 or limit<=0 returns 422 instead of being
   * silently clamped (§25 frontend note). Keep page/limit >= 1 client-side.
   *
   * @param {{page?:number, limit?:number}} [params]
   * @returns {Promise<{items:Array, page,limit,total,totalPages,hasNext,hasPrev}>}
   */
  async getWorkQueue({ page = 1, limit = 20 } = {}) {
    return HttpClient.get('/dashboard/work-queue', { query: { page, limit } });
  }
};
