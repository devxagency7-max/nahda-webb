/* --------------------------------------------------------------------------
   API ERROR TYPE + CODE CATALOGUE
   Mirrors WEB_API_DOCUMENTATION.md §8 (ErrorCodes) exactly — closed set,
   never repurposed. Anything not in this map still surfaces via `code`.
   -------------------------------------------------------------------------- */

export class ApiError extends Error {
  /**
   * @param {string} code - one of ERROR_CODES, or an unrecognised string the
   *   backend might add later (we never throw on an unknown code).
   * @param {string} message - server-provided Arabic message (may be blank
   *   for transport-level failures we synthesize client-side).
   * @param {Object} [details] - field -> [reasons], only for VALIDATION_ERROR
   *   and a few others; absent (not `{}`) when the server has nothing field-specific.
   * @param {number} [httpStatus]
   */
  constructor(code, message, details, httpStatus) {
    super(message || FALLBACK_MESSAGES[code] || 'حدث خطأ غير متوقع');
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
    this.httpStatus = httpStatus;
  }
}

// Thrown for genuine network/transport failures (server unreachable, CORS
// block, timeout) — distinct from ApiError because there is no envelope to
// read a `code` from.
export class NetworkError extends Error {
  constructor(cause) {
    super('تعذر الاتصال بالخادم — تحقق من الاتصال بالإنترنت');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

export const FALLBACK_MESSAGES = {
  UNAUTHORIZED: 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مرة أخرى',
  FORBIDDEN: 'ليس لديك صلاحية للقيام بهذا الإجراء',
  VALIDATION_ERROR: 'بيانات غير صحيحة',
  NOT_FOUND: 'العنصر المطلوب غير موجود',
  RATE_LIMITED: 'عدد كبير من المحاولات، حاول لاحقًا',
  INTERNAL_ERROR: 'حدث خطأ في الخادم، حاول لاحقًا',
  INVALID_CREDENTIALS: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
  ACCOUNT_LOCKED: 'تم قفل الحساب مؤقتًا بعد محاولات دخول فاشلة متكررة — حاول بعد 15 دقيقة',
  PLATFORM_NOT_ALLOWED: 'هذا الحساب غير مسموح له بالدخول من الويب',
  SOCIAL_WORKER_WEB_BLOCKED: 'الأخصائي الاجتماعي الميداني يسجّل الدخول من تطبيق الموبايل فقط',
  TOKEN_EXPIRED: 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مرة أخرى',
  TOKEN_REVOKED: 'تم إنهاء الجلسة من مكان آخر، يرجى تسجيل الدخول مرة أخرى',
  TOKEN_INVALID: 'جلسة غير صالحة، يرجى تسجيل الدخول مرة أخرى',
  DUPLICATE_RESOURCE: 'هذا العنصر موجود بالفعل',
  DELETE_CONFLICT: 'لا يمكن الحذف لوجود بيانات مرتبطة',
  CASE_NOT_FOUND: 'الحالة غير موجودة أو لا يمكنك الوصول إليها',
  DUPLICATE_NATIONAL_ID: 'يوجد حالة مسجّلة بهذا الرقم القومي بالفعل',
  CONCURRENCY_CONFLICT: 'تم تعديل هذه البيانات من مستخدم آخر — يرجى إعادة التحميل والمحاولة مجددًا',
  INVALID_STATUS_TRANSITION: 'هذا الإجراء غير متاح في الحالة الحالية للملف',
  OPINION_SLOT_LOCKED: 'تم اعتماد هذا الرأي بالفعل ولا يمكن تعديله',
  MISSING_WORKER_OPINION: 'لم يقم الأخصائي الاجتماعي بكتابة رأيه بعد',
  CASE_ALREADY_APPROVED: 'هذه الحالة معتمدة بالفعل ولا يمكن تعديل حالتها',
  IDEMPOTENCY_KEY_REQUIRED: 'خطأ تقني: مفتاح العملية مفقود، أعد المحاولة',
  FILE_TOO_LARGE: 'حجم الملف يتجاوز 10 ميجابايت',
  UNSUPPORTED_FILE_TYPE: 'نوع الملف غير مدعوم',
  STORAGE_UNAVAILABLE: 'خدمة تخزين الملفات غير متاحة حاليًا، حاول لاحقًا'
};

/** Convenience for callers that just want something to hand `showToast`. */
export function messageFromError(err) {
  if (err instanceof ApiError) {
    return FALLBACK_MESSAGES[err.code] || err.message;
  }
  if (err instanceof NetworkError) {
    return err.message;
  }
  return 'حدث خطأ غير متوقع';
}
