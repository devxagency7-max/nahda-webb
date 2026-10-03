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
    super(message || FALLBACK_MESSAGES[code] || 'حدث خطأ غير متوقع، حاول مرة أخرى');
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
    super('تعذّر الوصول للخادم، تأكد من اتصالك بالإنترنت وحاول مرة أخرى');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

// The server accepted the connection (or never answered) but did not finish
// responding within the configured budget. Extends NetworkError so every
// existing `instanceof NetworkError` handler keeps working.
export class RequestTimeoutError extends NetworkError {
  constructor(cause) {
    super(cause);
    this.name = 'RequestTimeoutError';
    this.message = 'الخادم تأخر في الرد، حاول مرة أخرى';
  }
}

export const FALLBACK_MESSAGES = {
  UNAUTHORIZED: 'انتهت جلستك حفاظًا على أمان حسابك، سجّل الدخول من جديد للمتابعة',
  FORBIDDEN: 'هذا الإجراء غير متاح لحسابك، تواصل مع مدير النظام إن كنت تحتاجه',
  VALIDATION_ERROR: 'راجع البيانات المُدخلة وحاول مرة أخرى',

  RATE_LIMITED: 'محاولات كثيرة في وقت قصير، انتظر قليلًا ثم حاول مرة أخرى',
  INTERNAL_ERROR: 'حدث خلل من جانبنا، حاول بعد قليل، وإن تكرر أبلغ الدعم الفني',
  INVALID_CREDENTIALS: 'البريد الإلكتروني أو كلمة المرور غير صحيحة، راجعهما وحاول مرة أخرى',
  ACCOUNT_LOCKED: 'أوقفنا الدخول مؤقتًا لحماية حسابك بعد عدة محاولات غير ناجحة، حاول بعد 15 دقيقة 🔒',
  PLATFORM_NOT_ALLOWED: 'لا يمكن لهذا الحساب الدخول من الويب، تواصل مع مدير النظام إن احتجت ذلك',
  SOCIAL_WORKER_WEB_BLOCKED: 'الأخصائي الاجتماعي الميداني يسجّل الدخول من تطبيق الموبايل 📱',
  TOKEN_EXPIRED: 'انتهت جلستك حفاظًا على أمان حسابك، سجّل الدخول من جديد للمتابعة',
  TOKEN_REVOKED: 'أُنهيت هذه الجلسة من جهاز آخر، سجّل الدخول من جديد للمتابعة',
  TOKEN_INVALID: 'تعذّر التأكد من جلستك، سجّل الدخول من جديد للمتابعة',
  DUPLICATE_RESOURCE: 'هذا العنصر مسجّل لدينا بالفعل',
  DELETE_CONFLICT: 'لا يمكن حذف هذا العنصر لأنه مرتبط ببيانات أخرى',
  CASE_NOT_FOUND: 'لم نعثر على هذه الحالة، أو ليس لديك صلاحية الوصول إليها',
  DUPLICATE_NATIONAL_ID: 'توجد حالة مسجّلة بهذا الرقم القومي بالفعل، يمكنك البحث عنها وفتحها',
  CONCURRENCY_CONFLICT: 'تم تعديل هذه البيانات من مكان آخر أثناء عملك، حدّث الصفحة وحاول مرة أخرى',
  INVALID_STATUS_TRANSITION: 'هذا الإجراء غير متاح لأن الحالة في مرحلة أخرى الآن',
  OPINION_SLOT_LOCKED: 'تم اعتماد هذا الرأي مسبقًا، لذلك لا يمكن تعديله',
  MISSING_WORKER_OPINION: 'بانتظار رأي الأخصائي الاجتماعي قبل المتابعة',
  CASE_ALREADY_APPROVED: 'هذه الحالة معتمدة بالفعل، لذلك لا يمكن تغيير حالتها',
  IDEMPOTENCY_KEY_REQUIRED: 'لم تكتمل العملية، حاول مرة أخرى',
  FILE_TOO_LARGE: 'حجم الملف أكبر من 10 ميجابايت، اختر ملفًا أصغر',
  UNSUPPORTED_FILE_TYPE: 'نوع هذا الملف غير مدعوم، جرّب صيغة أخرى',
  STORAGE_UNAVAILABLE: 'خدمة رفع الملفات غير متاحة الآن، حاول بعد قليل'
};

/** Convenience for callers that just want something to hand `showToast`. */
export function messageFromError(err) {
  if (err instanceof ApiError) {
    return FALLBACK_MESSAGES[err.code] || err.message;
  }
  if (err instanceof NetworkError) {
    return err.message;
  }
  return 'حدث خطأ غير متوقع، حاول مرة أخرى';
}
