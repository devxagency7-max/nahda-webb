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

   Allowed MIME types (closed list, backend reply 2026-10-08 §7): images
   (jpeg/png/heic/heif/webp) and PDF only — Word files are rejected.
   Max size: 10 MB per file; max 50 attachments per case. An oversized/
   disallowed file is rejected at /init, before any bucket write access is
   minted — check client-side first to avoid a wasted round trip, but never
   trust the client check alone.
   -------------------------------------------------------------------------- */
import { HttpClient } from './http.js';
import { ApiError } from './errors.js';
import { documentTypeCode } from './document-types.js';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
  'application/pdf'
]);

// Some browsers (Windows especially) give HEIC/HEIF files an empty `type`,
// and .heif is the same container as .heic — fall back to the extension.
const MIME_BY_EXTENSION = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  heif: 'image/heic',
  webp: 'image/webp',
  pdf: 'application/pdf'
};

const MIME_ALIASES = { 'image/jpg': 'image/jpeg', 'image/heif': 'image/heic' };

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_CASE = 50;
export const MAX_FILES_PER_PICK = 5;
export const MAX_DESCRIPTION_LENGTH = 300;

/** The MIME type to declare for a picked file, or '' if it isn't allowed. */
export function resolveMimeType(file) {
  const declared = MIME_ALIASES[file.type] || file.type;
  if (ALLOWED_MIME_TYPES.has(declared)) return declared;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return MIME_BY_EXTENSION[ext] || '';
}

/** Client-side pre-check: an ApiError to show the user, or null if the file is fine. */
export function validateFile(file) {
  if (!file.size) {
    return new ApiError('EMPTY_FILE', `الملف "${file.name}" فاضي، اختار ملف تاني`, undefined, 422);
  }
  if (file.size > MAX_FILE_SIZE_BYTES) return new ApiError('FILE_TOO_LARGE', undefined, undefined, 422);
  if (!resolveMimeType(file)) return new ApiError('UNSUPPORTED_FILE_TYPE', undefined, undefined, 422);
  return null;
}

export const AttachmentsService = {
  /**
   * Full three-step upload. Call this with a File object from an <input type="file">.
   * @param {Object} opts
   * @param {string} opts.caseId
   * @param {string} opts.documentType - closed-list code, e.g. 'national_id'
   * @param {File} opts.file
   * @param {string} [opts.description] - «أخرى» details (max 300)
   * @param {(progress:{stage:string}) => void} [opts.onProgress] - fired at 'init' | 'uploading' | 'commit' | 'done'
   * @returns {Promise<Object>} the commit response: {attachmentId, status:'complete', rowVersion, scanStatus, fileSizeBytes, checksum, ...}
   * @throws {ApiError} FILE_TOO_LARGE | UNSUPPORTED_FILE_TYPE | STORAGE_UNAVAILABLE | VALIDATION_ERROR
   */
  async upload({ caseId, documentType, file, description, onProgress }) {
    const invalid = validateFile(file);
    if (invalid) throw invalid;
    const mimeType = resolveMimeType(file);

    onProgress?.({ stage: 'init' });
    const initRes = await this.init({
      caseId,
      documentType: documentTypeCode(documentType),
      fileName: file.name,
      mimeType,
      fileSize: file.size,
      description: description?.trim() || undefined
    });

    // Without this, commit() would hit /attachments/undefined/commit and the
    // server answers a misleading 404 «المسار المطلوب غير موجود».
    if (!initRes?.attachmentId || !initRes?.uploadUrl) {
      console.error('[attachments] unexpected /attachments/init response shape:', Object.keys(initRes || {}));
      throw new ApiError('INTERNAL_ERROR', 'استجابة بدء الرفع غير مكتملة من الخادم، حاول مرة أخرى');
    }

    onProgress?.({ stage: 'uploading' });
    // The signed URL only accepts the type the server signed; fall back to the
    // one we sent if the reply ever omits it (never send "undefined").
    await this.uploadToStorage(initRes.uploadUrl, file, initRes.mimeType || mimeType);

    onProgress?.({ stage: 'commit' });
    // One key per logical upload: a network-level retry of this same commit
    // must reuse it, a brand-new upload gets a fresh one.
    const commitRes = await this.commit(initRes.attachmentId, undefined, crypto.randomUUID());

    onProgress?.({ stage: 'done' });
    return commitRes;
  },

  /**
   * Step 1 — mint the presigned upload URL. Idempotency-Key is required
   * (backend reply 2026-10-08 §7). A fresh key per upload on purpose: the
   * same key replays the same reply for an hour, including an upload URL that
   * expires after 15 minutes.
   */
  async init({ caseId, documentType, fileName, mimeType, fileSize, description }) {
    return HttpClient.post('/attachments/init', {
      body: { caseId, documentType, fileName, mimeType, fileSize, description },
      idempotencyKey: crypto.randomUUID()
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
   * Step 3 — requires an Idempotency-Key (FRONTEND_COMPLETE_GUIDE.md §13 and
   * §19.8: "Idempotency-Key: مطلوب"). Calling again on an already-complete
   * attachment returns 200 with alreadyComplete:true and no side effect.
   * @param {string} attachmentId
   * @param {string} [checksum]
   * @param {string} [idempotencyKey] - UUID; generated here if the caller has none
   */
  async commit(attachmentId, checksum, idempotencyKey = crypto.randomUUID()) {
    return HttpClient.post(`/attachments/${attachmentId}/commit`, {
      body: checksum ? { checksum } : {},
      idempotencyKey
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
  },

  /**
   * Every attachment of a case in one `{ items }` result. A case holds 50 at
   * most, so one page of 50 covers it under the new contract
   * (total/limit/offset, no hasNext); extra pages serve the current one, and
   * duplicates are dropped in case the server ignores `page`.
   */
  async listAllForCase(caseId) {
    const items = [];
    const seen = new Set();
    for (let page = 1; page <= 10; page++) {
      const res = await this.listForCase(caseId, { page, limit: MAX_ATTACHMENTS_PER_CASE });
      let added = 0;
      for (const item of res?.items || []) {
        if (item?.id && !seen.has(item.id)) {
          seen.add(item.id);
          items.push(item);
          added++;
        }
      }
      if (!res?.hasNext || added === 0) break;
    }
    return { items };
  }
};
