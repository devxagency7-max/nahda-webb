/* --------------------------------------------------------------------------
   ATTACHMENTS SERVICE
   Presigned-URL upload flow (WEB_API_DOCUMENTATION.md §11). The API process
   never carries file bytes in either direction — there is no multipart
   endpoint anywhere in this system:

     1. POST /attachments/init   -> mint a presigned PUT URL
     2. PUT <uploadUrl>          -> raw file bytes, direct to object storage
                                     (NOT through HttpClient — this is not an
                                     API-server call, no envelope, no auth header)
     3. POST /attachments/{id}/commit -> server verifies real magic bytes,
                                     marks the attachment complete

   Allowed MIME types (closed list): image/jpeg, image/png, image/heic,
   image/webp, application/pdf, application/msword,
   application/vnd.openxmlformats-officedocument.wordprocessingml.document.
   Max size: 10 MB exactly. An oversized/disallowed file is rejected at
   /init, before any bucket write access is minted — check client-side first
   to avoid a wasted round trip, but never trust the client check alone.
   -------------------------------------------------------------------------- */
import { HttpClient } from './http.js';
import { ApiError } from './errors.js';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export const AttachmentsService = {
  /**
   * Full three-step upload. Call this with a File object from an <input type="file">.
   * @param {Object} opts
   * @param {string} opts.caseId
   * @param {string} opts.documentType - closed vocabulary key, e.g. 'national_id_copy'
   * @param {File} opts.file
   * @param {string} [opts.description]
   * @param {(progress:{stage:string}) => void} [opts.onProgress] - fired at 'init' | 'uploading' | 'commit' | 'done'
   * @returns {Promise<Object>} the commit response: {attachmentId, status:'complete', rowVersion, scanStatus, fileSizeBytes, checksum, ...}
   * @throws {ApiError} FILE_TOO_LARGE | UNSUPPORTED_FILE_TYPE | STORAGE_UNAVAILABLE | VALIDATION_ERROR
   */
  async upload({ caseId, documentType, file, description, onProgress }) {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new ApiError('FILE_TOO_LARGE', undefined, undefined, 422);
    }
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      throw new ApiError('UNSUPPORTED_FILE_TYPE', undefined, undefined, 422);
    }

    onProgress?.({ stage: 'init' });
    const initRes = await this.init({
      caseId,
      documentType,
      fileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      description
    });

    onProgress?.({ stage: 'uploading' });
    await this.uploadToStorage(initRes.uploadUrl, file, initRes.mimeType);

    onProgress?.({ stage: 'commit' });
    const commitRes = await this.commit(initRes.attachmentId);

    onProgress?.({ stage: 'done' });
    return commitRes;
  },

  /** Step 1 — mint the presigned upload URL. caseId is authorized via the full case-visibility chain before anything is minted. */
  async init({ caseId, documentType, fileName, mimeType, fileSize, description }) {
    return HttpClient.post('/attachments/init', {
      body: { caseId, documentType, fileName, mimeType, fileSize, description }
    });
  },

  /**
   * Step 2 — raw PUT of file bytes directly to object storage. Deliberately
   * bypasses HttpClient: this is not an /api/v1 call (no Authorization
   * header, no {success,data} envelope to unwrap), and the Content-Type
   * header must exactly match the mimeType returned by /init.
   */
  async uploadToStorage(uploadUrl, file, mimeType) {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: file
    });
    if (!response.ok) {
      throw new Error(`فشل رفع الملف إلى التخزين (HTTP ${response.status})`);
    }
  },

  /**
   * Step 3 — idempotent by attachment id (no Idempotency-Key header needed
   * or accepted here). Calling again on an already-complete attachment
   * returns 200 with alreadyComplete:true and no side effect.
   * @param {string} attachmentId
   * @param {string} [checksum]
   */
  async commit(attachmentId, checksum) {
    return HttpClient.post(`/attachments/${attachmentId}/commit`, {
      body: checksum ? { checksum } : undefined
    });
  },

  /** Mints a fresh presigned GET URL, valid 15 minutes — never cache/construct one client-side. */
  async getDownloadUrl(attachmentId) {
    return HttpClient.get(`/attachments/${attachmentId}/download`);
  },

  async remove(attachmentId) {
    return HttpClient.delete(`/attachments/${attachmentId}`);
  },

  /** @returns {Promise<PagedResult>} paginated metadata list — never embeds download links; call getDownloadUrl per item. */
  async listForCase(caseId, { page, limit } = {}) {
    return HttpClient.get(`/cases/${caseId}/attachments`, { query: { page, limit } });
  }
};
