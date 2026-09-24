/* --------------------------------------------------------------------------
   PROFILE SERVICE
   Wraps /api/v1/profile endpoints:
     - GET    /profile              -> ProfileDto with fresh 15-minute presigned avatarUrl
     - PUT    /profile              -> updates fullName, phone, gender (requires rowVersion)
     - POST   /profile/avatar/init   -> mints presigned PUT uploadUrl
     - Direct PUT <uploadUrl>        -> raw image bytes directly to object storage
     - POST   /profile/avatar/confirm -> verifies magic bytes & completes upload
     - DELETE /profile/avatar        -> removes user's profile avatar
   -------------------------------------------------------------------------- */
import { HttpClient } from './http.js';
import { ApiError } from './errors.js';

export const ALLOWED_AVATAR_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp'
]);

export const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export const ProfileService = {
  /**
   * Fetches full profile for the authenticated user.
   * Note: avatarUrl is a temporary 15-minute presigned GET URL generated on the fly.
   * @returns {Promise<{id:string, fullName:string, email:string, role:string, phone:string|null, gender:string|null, avatarUrl:string|null, rowVersion?:number}>}
   */
  async getProfile() {
    return HttpClient.get('/profile');
  },

  /**
   * Updates basic profile info. Requires rowVersion from latest getProfile().
   * @param {Object} data
   * @param {string} data.fullName
   * @param {string|null} [data.phone]
   * @param {string|null} [data.gender]
   * @param {number} data.rowVersion
   * @returns {Promise<Object>}
   * @throws {ApiError} 409 CONCURRENCY_CONFLICT if data was modified elsewhere
   */
  async updateProfile({ fullName, phone, gender, rowVersion }) {
    return HttpClient.put('/profile', {
      body: {
        fullName,
        phone: phone || null,
        gender: gender || null,
        rowVersion
      }
    });
  },

  /**
   * Step 1 — Inits avatar upload and returns presigned PUT URL.
   * @param {Object} params
   * @param {string} params.fileName
   * @param {string} params.mimeType - closed list: image/jpeg, image/png, image/webp
   * @param {number} params.fileSize - up to 5MB
   * @returns {Promise<{objectKey:string, uploadUrl:string, mimeType:string, uploadUrlExpiresAtUtc:string}>}
   */
  async initAvatar({ fileName, mimeType, fileSize }) {
    return HttpClient.post('/profile/avatar/init', {
      body: { fileName, mimeType, fileSize }
    });
  },

  /**
   * Step 2 — Direct PUT of image bytes to object storage.
   * Deliberately bypasses HttpClient (no Authorization header, no JSON envelope).
   * @param {string} uploadUrl
   * @param {File|Blob} file
   * @param {string} mimeType
   */
  async uploadToStorage(uploadUrl, file, mimeType) {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: file
    });
    if (!response.ok) {
      throw new Error(`فشل رفع الصورة إلى وحدة التخزين (HTTP ${response.status})`);
    }
  },

  /**
   * Step 3 — Confirms avatar upload and verifies magic bytes server-side.
   * @param {string} objectKey
   * @returns {Promise<{avatarUrl:string}>}
   */
  async confirmAvatar(objectKey) {
    return HttpClient.post('/profile/avatar/confirm', {
      body: { objectKey }
    });
  },

  /**
   * Complete three-step avatar upload pipeline.
   * @param {File} file
   * @param {(status:{stage:string, percent?:number}) => void} [onProgress]
   * @returns {Promise<{avatarUrl:string}>}
   */
  async uploadAvatar(file, onProgress) {
    if (!file) throw new Error('يرجى تحديد ملف صورة');

    if (file.size > MAX_AVATAR_SIZE_BYTES) {
      throw new ApiError('FILE_TOO_LARGE', 'حجم الصورة يتجاوز 5 ميجابايت', undefined, 422);
    }

    if (!ALLOWED_AVATAR_MIMES.has(file.type)) {
      throw new ApiError('UNSUPPORTED_FILE_TYPE', 'صيغة الصورة غير مدعومة (JPG, PNG, WEBP فقط)', undefined, 422);
    }

    onProgress?.({ stage: 'init' });
    const initRes = await this.initAvatar({
      fileName: file.name,
      mimeType: file.type,
      fileSize: file.size
    });

    onProgress?.({ stage: 'uploading' });
    await this.uploadToStorage(initRes.uploadUrl, file, initRes.mimeType);

    onProgress?.({ stage: 'confirm' });
    const confirmRes = await this.confirmAvatar(initRes.objectKey);

    onProgress?.({ stage: 'done' });
    return confirmRes;
  },

  /**
   * Deletes user's profile avatar.
   * @returns {Promise<{success:boolean, message?:string}>}
   */
  async deleteAvatar() {
    return HttpClient.delete('/profile/avatar');
  }
};
