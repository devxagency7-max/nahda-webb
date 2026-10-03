/* --------------------------------------------------------------------------
   LOAD-ERROR STATE WITH RETRY
   قبل كده لو تحميل قائمة فشل، المستخدم كان بيشوف toast بيختفي بعد ثواني
   والشاشة بترسم "لا توجد نتائج" — يعني السيرفر واقع وشكله زي "مفيش بيانات"،
   والحل الوحيد Ctrl+R. الملف ده بيوفر:
     1) نص واضح حسب نوع العطل (نت / مهلة / سيرفر / صلاحية) — مش رسالة واحدة لكل حاجة.
     2) زر "إعادة المحاولة" ثابت في مكان القائمة نفسه، بيفضل موجود لحد ما ينجح.
     3) مفيش زر إعادة محاولة لو المحاولة مش هتفيد (صلاحية، حالة مش موجودة).
   -------------------------------------------------------------------------- */
import { DOM } from './dom.js';
import { ApiError, NetworkError, RequestTimeoutError } from '../services/errors.js';

const RETRY_LABEL = 'إعادة المحاولة';
const RETRYING_LABEL = 'جاري المحاولة...';

/**
 * يحوّل الخطأ لنص موجّه للمستخدم: عنوان بيقول إيه اللي حصل، وسطر بيقول
 * يعمل إيه دلوقتي. `subject` هو اسم الحاجة اللي بنحمّلها بصيغة "ال" (الحالات،
 * الجمعيات، الموظفين...).
 *
 * @param {unknown} err
 * @param {string} subject
 * @returns {{ icon: string, title: string, hint: string, retryable: boolean }}
 */
export function describeLoadError(err, subject) {
  // RequestTimeoutError extends NetworkError — لازم يتفحص الأول.
  if (err instanceof RequestTimeoutError) {
    return {
      icon: '⏱️',
      title: `${subject} أخذت وقتًا أطول من المعتاد`,
      hint: 'الاتصال بطيء حاليًا. أعد المحاولة، وإن تكرر الأمر فتحقق من جودة الإنترنت.',
      retryable: true
    };
  }
  if (err instanceof NetworkError) {
    return {
      icon: '📡',
      title: 'لا يوجد اتصال بالإنترنت',
      hint: `تحقق من اتصالك ثم أعد المحاولة لتحميل ${subject}.`,
      retryable: true
    };
  }
  if (err instanceof ApiError) {
    if (err.code === 'FORBIDDEN') {
      return {
        icon: '🔒',
        title: `ليس لديك صلاحية لعرض ${subject}`,
        hint: 'إن كنت تحتاج هذا الوصول، تواصل مع مدير النظام.',
        retryable: false
      };
    }
    if (err.code === 'RATE_LIMITED') {
      return {
        icon: '⏳',
        title: 'تم إرسال طلبات كثيرة في وقت قصير',
        hint: 'انتظر لحظات ثم أعد المحاولة.',
        retryable: true
      };
    }
    if (err.code === 'INTERNAL_ERROR' || err.code === 'STORAGE_UNAVAILABLE' || err.httpStatus >= 500) {
      return {
        icon: '🛠️',
        title: 'حدثت مشكلة مؤقتة في الخادم',
        hint: `ليست مشكلة في بياناتك. أعد المحاولة بعد لحظات، وإن استمرت فأبلغ الدعم الفني.`,
        retryable: true
      };
    }
  }
  return {
    icon: '⚠️',
    title: `تعذر تحميل ${subject}`,
    hint: 'حدث خطأ غير متوقع. أعد المحاولة، وإن تكرر فأبلغ الدعم الفني.',
    retryable: true
  };
}

/**
 * HTML جاهز لحالة الخطأ. الزر بيتعلّم بـ `.btn-retry-load` — اربطه بـ bindRetry().
 *
 * @param {unknown} err
 * @param {string} subject - مثل 'الحالات'
 * @param {{ compact?: boolean }} [opts] - compact لصفوف الجداول ولوحات صغيرة
 */
export function errorStateHTML(err, subject, { compact = false } = {}) {
  const { icon, title, hint, retryable } = describeLoadError(err, subject);
  return `
    <div class="load-error${compact ? ' load-error--compact' : ''}" role="alert">
      <span class="load-error__icon" aria-hidden="true">${icon}</span>
      <h3 class="load-error__title">${DOM.escapeHTML(title)}</h3>
      <p class="load-error__hint">${DOM.escapeHTML(hint)}</p>
      ${retryable ? `
        <button type="button" class="btn btn--primary btn-retry-load">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
          <span>${RETRY_LABEL}</span>
        </button>
      ` : ''}
    </div>
  `;
}

/**
 * يربط زر إعادة المحاولة داخل `root`. بيتعطّل فورًا ويكتب "جاري المحاولة..."
 * عشان الضغط المتكرر ما يبعتش طلبات مكررة، وبعدها الشاشة نفسها بتتعاد رسمها.
 *
 * @param {ParentNode|null} root
 * @param {() => unknown} onRetry
 */
export function bindRetry(root, onRetry) {
  const btn = root && root.querySelector('.btn-retry-load');
  if (!btn) return;
  btn.addEventListener('click', () => {
    btn.disabled = true;
    const label = btn.querySelector('span');
    if (label) label.textContent = RETRYING_LABEL;
    onRetry();
  });
}

/** إعدادات جاهزة لـ showToast لما الفشل جزئي (مثلًا "تحميل المزيد") والقائمة لسه ظاهرة. */
export function retryToast(onRetry) {
  return { action: { label: RETRY_LABEL, onClick: onRetry } };
}
