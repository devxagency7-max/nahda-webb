/* --------------------------------------------------------------------------
   SHARED TOAST NOTIFICATION HELPER
   قبل كده كانت أيقونة الـ toast صح خضراء ثابتة (علامة صح) في كل الحالات —
   حتى لما الرسالة نفسها خطأ. ده كان بيوهم المستخدم إن العملية نجحت وهي
   فشلت فعليًا. دلوقتي كل نوع رسالة له أيقونة ولون مميز بصريًا.
   -------------------------------------------------------------------------- */
import { DOM } from './dom.js';

let activeToastTimer = null;

const TOAST_VARIANTS = {
  success: {
    color: '#10b981',
    svg: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>'
  },
  error: {
    color: '#ef4444',
    svg: '<circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line>'
  },
  warning: {
    color: '#f59e0b',
    svg: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>'
  },
  info: {
    color: '#3b82f6',
    svg: '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>'
  }
};

/**
 * @param {string} message - رسالة عربية جاهزة للعرض مباشرة.
 * @param {'success'|'error'|'warning'|'info'} [type='success'] - يتحكم في
 *   لون وأيقونة الـ toast. الافتراضي success للحفاظ على سلوك كل الاستدعاءات
 *   الحالية في التطبيق زي ما هو.
 * @param {number} [durationMs] - مدة العرض بالمللي ثانية. اختياري — لو
 *   مفيش قيمة، بيرجع للمدة الافتراضية حسب النوع (راجع duration تحت).
 */
export function showToast(message, type = 'success', durationMs) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = DOM.createElement('div', { className: 'toast' });
    document.body.appendChild(toast);
  }

  const variant = TOAST_VARIANTS[type] || TOAST_VARIANTS.success;
  toast.className = `toast toast--${type in TOAST_VARIANTS ? type : 'success'}`;

  toast.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${variant.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      ${variant.svg}
    </svg>
    <span>${DOM.escapeHTML(message)}</span>
  `;

  toast.classList.add('toast--visible');

  if (activeToastTimer) {
    clearTimeout(activeToastTimer);
  }

  // رسائل الخطأ والتحذير بتفضل ظاهرة أطول شوية — المستخدم محتاج وقت
  // يقرأها ويتصرف بدل ما تختفي بسرعة زي رسالة نجاح عابرة.
  const duration = durationMs ?? (type === 'error' || type === 'warning' ? 4500 : 3200);
  activeToastTimer = setTimeout(() => {
    toast.classList.remove('toast--visible');
    activeToastTimer = null;
  }, duration);
}
