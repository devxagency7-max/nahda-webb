/* --------------------------------------------------------------------------
   CASES SERVICE
   Wraps case creation, read, and the per-section PUT endpoints used by the
   personal-data wizard (WEB_API_DOCUMENTATION.md §10, §12.3).

   Concurrency: every section PUT is guarded by `rowVersion` (single-entity
   1:1 sections) or `caseRowVersion` (list/child-table sections, which guard
   the parent Case row). A stale value throws 409 CONCURRENCY_CONFLICT — the
   caller must re-fetch (`GET /cases/{id}`) and let the user re-apply their
   change; never silently retry with the old value.

   Some 1:1 sections (housing, agriculture, classification) accept a
   *nullable* rowVersion for the very first write, when the section has
   never been saved before.
   -------------------------------------------------------------------------- */
import { HttpClient } from './http.js';

export const CasesService = {
  /**
   * GET /api/v1/search/cases — server-side, cross-worker case search (used by
   * the "all cases" list/search UI, and to prevent duplicate case registration).
   * No `status` param on this endpoint — status filtering stays client-side
   * over the returned `items`. `q`/`name`/`charity`/`region` 422 below 2 chars
   * (message already Arabic and safe to show as-is); `nationalId`/`phone` are
   * exact-match with no minimum length.
   *
   * `charityId` + `supportType` (added for the manager-only "فلترة الحالات
   * حسب الجمعية والدعم" screen) filter on real relational data, not free
   * text: `charityId` is an exact match on `cases.charity_id`, and
   * `supportType` matches `case_support_history` (the actual support a case
   * *received*, not `case_assessed_needs`/approved-support). The two combine
   * with AND; repeated `supportType` values combine with OR (max 10). When
   * `supportType` is sent, each returned item gains a `matchedSupport` array
   * — `[{supportType, totalCount, totalAmount}]` — covering only the
   * requested types, sorted alphabetically. `charityId` must be a real GUID
   * (from `GET /charities`) or the backend 400s before validation runs.
   * @param {Object} [opts]
   * @param {string} [opts.q] - general free-text query
   * @param {string} [opts.name]
   * @param {string} [opts.nationalId] - sent as `national_id` (snake_case, confirmed backend casing)
   * @param {string} [opts.charity]
   * @param {string} [opts.charityId] - exact GUID match (distinct from the free-text `charity`)
   * @param {string[]} [opts.supportType] - up to 10 values, sent as repeated params, combined with OR
   * @param {string} [opts.region]
   * @param {string} [opts.phone]
   * @param {string} [opts.date] - `YYYY-MM-DD`, matches `registrationDate` as one exact calendar day
   * @param {string} [opts.dateFrom] - `YYYY-MM-DD`, inclusive range start on `registrationDate` (either end optional)
   * @param {string} [opts.dateTo] - `YYYY-MM-DD`, inclusive range end on `registrationDate` (either end optional).
   *   `dateFrom`/`dateTo` combine with `date` via AND if both are sent. `dateFrom` after `dateTo` throws 422 VALIDATION_ERROR.
   * @param {number} [opts.page]
   * @param {number} [opts.limit]
   * @returns {Promise<PagedResult<Object>>} item shape: id, caseNumber, displayId, status,
   *   priority, beneficiaryFullName, nationalId, charityId, charityName, centerId, centerName,
   *   villageId, villageName, phonePrimary, registrationDate, completionPercentage, createdAtUtc,
   *   matchedSupport? (only present when `supportType` was sent), ...
   */
  async search(opts = {}) {
    const { q, name, nationalId, charity, charityId, supportType, region, phone, date, dateFrom, dateTo, page, limit } = opts;
    return HttpClient.get('/search/cases', {
      query: { q, name, national_id: nationalId, charity, charityId, supportType, region, phone, date, dateFrom, dateTo, page, limit }
    });
  },

  /**
   * GET /api/v1/cases — plain case list, supports `createdByMe` (data_entry's
   * "الحالات التي سجّلتها بنفسك" filter) which `/search/cases` does not.
   * Combinable with `status`/`bookmarked` per the backend.
   * @param {Object} [opts]
   * @param {boolean} [opts.createdByMe]
   * @param {string} [opts.status]
   * @param {boolean} [opts.bookmarked]
   * @param {number} [opts.page]
   * @param {number} [opts.limit]
   * @returns {Promise<PagedResult<Object>>} same item shape as search().
   */
  async list(opts = {}) {
    const { createdByMe, status, bookmarked, page, limit } = opts;
    return HttpClient.get('/cases', {
      query: { createdByMe, status, bookmarked, page, limit }
    });
  },

  /**
   * §20.2 step 1 — creates the case shell from the beneficiary's core data.
   * **Body is nested, not flat** — confirmed against the live server (a flat
   * body returns 500 INTERNAL_ERROR, not 422): `{ beneficiary: {fullName,
   * nationalId, phonePrimary?, centerId, villageId, address?}, charityId?,
   * priority? }`. Do NOT send age/gender/birthGovernorate/status — derived
   * server-side from the national ID; extra fields are silently ignored.
   * @param {Object} data - { beneficiary: {...}, charityId?, priority? }
   * @returns {Promise<{id:string, caseNumber:string, status:'draft'}>} no rowVersion on this response —
   *   fetch GET /cases/{id} right after to get beneficiary.rowVersion for the next PUT.
   * @throws {ApiError} VALIDATION_ERROR | DUPLICATE_NATIONAL_ID (details.existingCaseNumber/existingCaseStatus)
   */
  async create(data) {
    return HttpClient.post('/cases', { body: data });
  },

  /** @returns {Promise<Object>} full case detail, including per-section rowVersion/caseRowVersion values. */
  async getById(id) {
    return HttpClient.get(`/cases/${id}`);
  },

  /**
   * GET /api/v1/cases/{caseId}/report — single source of truth for the
   * printable case report (PDF export + "البيانات الأصلية" tab). Returns
   * `{ case, legacyRecord }`: `case` is the exact same shape as
   * `getById()`, and `legacyRecord.fields` is the ordered column/value list
   * from the original legacy Excel row (only present when
   * `legacyRecord.available` is true — system-created cases have no sheet
   * row to show).
   * @param {string} id
   * @returns {Promise<{case: Object, legacyRecord: {available: boolean, sourceFileName?: string, sourceRowNumber?: number, fields: Array<{columnIndex:number, header:string, value:string}>}}>}
   */
  async getReport(id) {
    return HttpClient.get(`/cases/${id}/report`);
  },

  /**
   * GET /api/v1/cases/{caseId}/timeline — the case's workflow history
   * ("تاريخ الحالة"): who created/assigned/sent/returned/decided and when.
   * Requires only view_cases (every role). Fetch lazily when the history
   * view is opened, not on every case open. Throws 404 CASE_NOT_FOUND.
   *
   * `summary` answers the 7 fixed milestones directly — each is `null` until
   * it happens: created, assigned (+selfAssigned/acceptedAt/to),
   * firstSentToReviewer, lastReturned (+returnedBy 'reviewer'|'manager',
   * reason), lastSentToReviewer (same as first when sent once), sentToManager,
   * decision (+decision 'approved'|'rejected', isOverride). `events` is the
   * full ordered list — switch on `type`, never on the Arabic `label`.
   * Every person is `{id, name, email, role}`; all times are UTC.
   * `isLegacy` cases (Excel import) have `created` = import time by the
   * system import user and the rest null unless touched since go-live.
   * @param {string} id
   * @returns {Promise<{caseId:string, isLegacy:boolean, summary:Object, events:Array<{id, type, label, occurredAtUtc, actor, target, note, isResubmission}>}>}
   */
  async getTimeline(id) {
    return HttpClient.get(`/cases/${id}/timeline`);
  },

  /** @returns {Promise<{percentage:number, isReady:boolean, sections:Object}>} completion readiness for the wizard progress indicator. */
  async getCompletion(id) {
    return HttpClient.get(`/cases/${id}/completion`);
  },

  /** @returns {Promise<Array>} the case's family members list. */
  async getFamilyMembers(id) {
    return HttpClient.get(`/cases/${id}/family-members`);
  },

  /** @returns {Promise<Object>} both supportRecommendations (list) and approvedSupport (single, or null). */
  async getSupport(id) {
    return HttpClient.get(`/cases/${id}/support`);
  },

  // ---- Section 1: Beneficiary (Step 1 — Demographics) ----
  /**
   * @param {string} caseId
   * @param {Object} data - fullName, phonePrimary, phoneSecondary, religion, education,
   *   maritalStatus, healthStatus, employmentStatus, job, monthlyIncome,
   *   takafulBeneficiary, takafulAmount, centerId, villageId, address, headRelation, rowVersion
   */
  async updateBeneficiary(caseId, data) {
    return HttpClient.put(`/cases/${caseId}/beneficiary`, { body: data });
  },

  // ---- Family members (full replace) ----
  /** @param {Array} members - name, relation, nationalId?, age?, gender?, isStudent, ... sortOrder */
  async updateFamilyMembers(caseId, members, caseRowVersion) {
    return HttpClient.put(`/cases/${caseId}/family-members`, { body: { members, caseRowVersion } });
  },

  // ---- Section 3: Housing (Step 3) — 1:1 upsert, nullable rowVersion on first save ----
  async updateHousing(caseId, data) {
    return HttpClient.put(`/cases/${caseId}/housing`, { body: data });
  },

  // ---- Section 4: Utilities (Step 4) — full replace of two lists, caseRowVersion ----
  /** @param {Object} data - appliances[{applianceKey,isPresent}], utilities[{name,isAvailable,condition?,sourceOrMeter?,notes?}], caseRowVersion */
  async updateUtilities(caseId, data) {
    return HttpClient.put(`/cases/${caseId}/utilities`, { body: data });
  },

  // ---- Section 5: Agriculture (Step 5) — 1:1 upsert, nullable rowVersion on first save ----
  // Server clears stale dependent fields itself (hasLand/hasLivestock rules,
  // §12.4) — re-fetch after saving if the UI needs to reflect the cleared state.
  async updateAgriculture(caseId, data) {
    return HttpClient.put(`/cases/${caseId}/agriculture`, { body: data });
  },

  // ---- Initial needs — full replace (not currently exposed as its own step) ----
  async updateInitialNeeds(caseId, needs, caseRowVersion) {
    return HttpClient.put(`/cases/${caseId}/initial-needs`, { body: { needs, caseRowVersion } });
  },

  // ---- Classification — 1:1 upsert (not currently exposed as its own step) ----
  async updateClassification(caseId, data) {
    return HttpClient.put(`/cases/${caseId}/classification`, { body: data });
  },

  // ---- Assessed needs — full replace (not currently exposed as its own step) ----
  async updateAssessedNeeds(caseId, needs, caseRowVersion) {
    return HttpClient.put(`/cases/${caseId}/assessed-needs`, { body: { needs, caseRowVersion } });
  },

  // ---- Section 6: Financial (Step 6) — full replace of two lists, caseRowVersion ----
  /** @param {Object} data - incomeItems[{label,amount,period?}], expenseItems[{category,amount,period?}], caseRowVersion */
  async updateFinancial(caseId, data) {
    return HttpClient.put(`/cases/${caseId}/financial`, { body: data });
  },

  // ---- Section 7: Support (Step 7) — two independent models (§12.6) ----
  /**
   * Proposed list — edit_case, full replace, caseRowVersion.
   * **Body field is `items`, not `recommendations`** — confirmed against the
   * live server (the wrong key returns 500 INTERNAL_ERROR, even for an
   * empty array, not a helpful validation error).
   */
  async updateSupportRecommendations(caseId, items, caseRowVersion) {
    return HttpClient.put(`/cases/${caseId}/support-recommendations`, { body: { items, caseRowVersion } });
  },

  /**
   * Manager-only final decision — independent of the workflow state machine;
   * writing it never changes the case status.
   * @param {Object} data - approvedSupportType, approvedAmount, beneficiary, frequency?, duration?, approvalNotes?, rowVersion?
   */
  async updateApprovedSupport(caseId, data) {
    return HttpClient.put(`/cases/${caseId}/approved-support`, { body: data });
  },

  /**
   * §12.5 — assign the case to a social worker (data_entry/manager/reviewer).
   * One of the 9 workflow-transition routes: requires a UUID Idempotency-Key.
   * **Body fields are `workerId` + `caseRowVersion`** — confirmed against the
   * live server (the old `{socialWorkerId}`-only shape returns 422
   * VALIDATION_ERROR "'Worker Id' must not be empty", the exact "بيانات غير
   * صحيحة" toast users were hitting; caseRowVersion is required too).
   * @param {string} caseId
   * @param {string} workerId - the social worker's user id (from GET /employees/social-workers)
   * @param {number} caseRowVersion - concurrency anchor, from the case's current rowVersion
   * @param {string} idempotencyKey - a fresh UUID per logical attempt (do not reuse on retry after a real failure)
   */
  async assign(caseId, workerId, caseRowVersion, idempotencyKey) {
    return HttpClient.post(`/cases/${caseId}/assign`, { body: { workerId, caseRowVersion }, idempotencyKey });
  },

  /**
   * §1 — reviewer's opinion: save as draft (isSubmitted:false) or submit to
   * the manager (isSubmitted:true). One of the workflow-transition routes:
   * requires a UUID Idempotency-Key.
   * @param {string} caseId
   * @param {Object} data - { decision, notes?, isSubmitted, caseRowVersion }
   * @param {string} idempotencyKey
   * @returns {Promise<{status, caseRowVersion, opinionId, decision, notes, isSubmitted}>}
   */
  async submitReviewerOpinion(caseId, data, idempotencyKey) {
    return HttpClient.post(`/cases/${caseId}/opinions/reviewer`, { body: data, idempotencyKey });
  },

  /**
   * §2 — return the case to the assigned social worker with a reason.
   * @param {string} caseId
   * @param {Object} data - { reason, caseRowVersion }
   * @param {string} idempotencyKey
   * @returns {Promise<{status, caseRowVersion, opinionId, decision, notes, isSubmitted}>}
   */
  async returnToWorker(caseId, data, idempotencyKey) {
    return HttpClient.post(`/cases/${caseId}/return-to-worker`, { body: data, idempotencyKey });
  },

  /**
   * §3 — manager's final decision. `decision` in the response reflects
   * approve/reject, not a free string the caller chooses.
   * @param {string} caseId
   * @param {Object} data - { approve, notes?, caseRowVersion }
   * @param {string} idempotencyKey
   * @returns {Promise<{status, caseRowVersion, opinionId, decision, notes, isSubmitted}>}
   */
  async submitManagerDecision(caseId, data, idempotencyKey) {
    return HttpClient.post(`/cases/${caseId}/opinions/manager`, { body: data, idempotencyKey });
  },

  /**
   * §4 — manager sends the case back for the worker/reviewer cycle to
   * restart (distinct from the reviewer's own return-to-worker route).
   * @param {string} caseId
   * @param {Object} data - { caseRowVersion, reason? }
   * @param {string} idempotencyKey
   * @returns {Promise<{status, caseRowVersion}>}
   */
  async returnForCompletion(caseId, data, idempotencyKey) {
    return HttpClient.post(`/cases/${caseId}/return-for-completion`, { body: data, idempotencyKey });
  },

  /**
   * Web-only counterpart to the mobile worker opinion (§step 8 of the
   * personal-data wizard) — data_entry/manager/reviewer record the social
   * worker's brief opinion + detailed report *before* the case is assigned.
   * Both fields are optional — an empty body still moves the case to
   * pending_assignment with no opinion recorded — except `detailedReport`
   * without `briefOpinion`, which throws 422 VALIDATION_ERROR. No
   * Idempotency-Key (it's a PUT guarded by caseRowVersion, not one of the 9
   * transition routes). Valid only from `draft`/`pending_assignment`
   * status; anything else throws 422 INVALID_STATUS_TRANSITION.
   * @param {string} caseId
   * @param {Object} data - { briefOpinion?: the dropdown's raw value ('موافق'|'غير موافق' or 'accepted'/'rejected', server accepts either), detailedReport?, caseRowVersion }
   * @returns {Promise<{status, caseRowVersion, opinionId, decision, notes, isSubmitted}>}
   */
  async submitSocialWorkerAssessment(caseId, data) {
    return HttpClient.put(`/cases/${caseId}/opinions/social-worker-assessment`, { body: data });
  }
};
