/* --------------------------------------------------------------------------
   EMPLOYEES MANAGEMENT COMPONENT CONTROLLER (FOR MANAGERS & ADMINS)
   Real API-backed: list/create/update/role/activate/deactivate/delete/export
   all go through EmployeesService (WEB_API_DOCUMENTATION.md §22 "Employees").
   No mock/local data — the roster is always fetched fresh from the server.

   Email & password are still generated client-side (the backend never
   generates them — CreateEmployeeRequest requires both), then sent as-is to
   POST /employees. After a successful create/reset, the generated password
   is shown once in a copy-ready credentials box, since the server never
   returns or stores it in retrievable form afterwards.
   -------------------------------------------------------------------------- */
import { store } from '../../state/store.js';
import { DOM } from '../../utils/dom.js';
import { showToast } from '../../utils/toast.js';
import { EventBus, EVENTS } from '../../core/event-bus.js';
import { EmployeesService } from '../../services/employees.service.js';
import { LocationsService } from '../../services/locations.service.js';
import { messageFromError } from '../../services/errors.js';
import { errorStateHTML, bindRetry } from '../../utils/error-state.js';
import { can, PERMISSIONS } from '../../core/permissions.js';
import { confirmDialog } from '../../utils/dialog.js';
import { onViewEnter } from '../../core/view-lifecycle.js';

// Common Arabic Names to Clean English Transliteration Dictionary
const COMMON_ARABIC_NAMES = {
  'محمد': 'mohamed', 'أحمد': 'ahmed', 'احمد': 'ahmed', 'محمود': 'mahmoud',
  'حسن': 'hassan', 'حسين': 'hussein', 'علي': 'ali', 'على': 'ali',
  'عمر': 'omar', 'عمرو': 'amr', 'إبراهيم': 'ibrahim', 'ابراهيم': 'ibrahim',
  'مصطفى': 'mostafa', 'مصطفي': 'mostafa', 'طارق': 'tarek', 'خالد': 'khaled',
  'كريم': 'karim', 'يوسف': 'youssef', 'سارة': 'sara', 'ساره': 'sara',
  'منى': 'mona', 'مني': 'mona', 'مريم': 'mariam', 'فاطمة': 'fatma', 'فاطمه': 'fatma',
  'آية': 'aya', 'ايه': 'aya', 'هدى': 'hoda', 'هدي': 'hoda',
  'عبدالله': 'abdullah', 'عبد الله': 'abdullah',
  'عبدالرحمن': 'abdelrahman', 'عبد الرحمن': 'abdelrahman',
  'عبدالعزيز': 'abdelaziz', 'عبد العزيز': 'abdelaziz',
  'عبدالكريم': 'abdelkarim', 'عبد الكريم': 'abdelkarim',
  'محسن': 'mohsen', 'عادل': 'adel', 'سامح': 'sameh', 'ياسر': 'yasser',
  'وليد': 'walid', 'علاء': 'alaa', 'حافظ': 'hafez', 'رمضان': 'ramadan',
  'شعبان': 'shaban', 'سعيد': 'saeed', 'رضا': 'reda', 'أيمن': 'ayman', 'ايمن': 'ayman',
  'أشرف': 'ashraf', 'اشرف': 'ashraf', 'هاني': 'hany', 'هانى': 'hany',
  'سامي': 'samy', 'سامى': 'samy', 'صلاح': 'salah', 'عثمان': 'othman',
  'جمال': 'gamal', 'سليمان': 'soliman', 'شريف': 'sherif', 'نادر': 'nader',
  'ماجد': 'maged', 'ممدوح': 'mamdouh', 'رأفت': 'raafat', 'مدحت': 'medhat',
  'عاطف': 'atef', 'عصام': 'essam', 'حسام': 'hossam', 'نبيل': 'nabil',
  'وسام': 'wesam', 'هشام': 'hesham', 'زياد': 'ziad', 'حمزة': 'hamza',
  'بلال': 'belal', 'إياد': 'eyad', 'اياد': 'eyad', 'آدم': 'adam', 'ادم': 'adam',
  'نور': 'nour', 'رنا': 'rana', 'سلمى': 'salma', 'سلمي': 'salma',
  'أسماء': 'asmaa', 'اسماء': 'asmaa', 'شيماء': 'shaimaa', 'دعاء': 'doaa',
  'إيمان': 'eman', 'ايمان': 'eman', 'دينا': 'dina', 'ندى': 'nada', 'ندي': 'nada',
  'شروق': 'shorouk', 'بسمة': 'basma', 'بسمه': 'basma', 'ياسمين': 'yasmin',
  'نورهان': 'nourhan', 'إسراء': 'esraa', 'اسراء': 'esraa', 'ريهام': 'reham',
  'هبة': 'heba', 'هبه': 'heba', 'نهى': 'noha', 'نهي': 'noha',
  'رانيا': 'rania', 'أميرة': 'amira', 'اميرة': 'amira', 'هند': 'hend',
  'سماح': 'samah', 'سلوى': 'salwa', 'سلوي': 'salwa', 'نجلاء': 'naglaa',
  'ولاء': 'walaa', 'وفاء': 'wafaa', 'سحر': 'sahar', 'أمل': 'amal', 'امل': 'amal',
  'إلهام': 'elham', 'الهام': 'elham'
};

// Fallback letter-by-letter transliteration
const ARABIC_TO_LATIN = {
  'ا': 'a', 'أ': 'a', 'إ': 'e', 'آ': 'a', 'ء': 'a',
  'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'g', 'ح': 'h',
  'خ': 'kh', 'د': 'd', 'ذ': 'z', 'ر': 'r', 'ز': 'z',
  'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'd', 'ط': 't',
  'ظ': 'z', 'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'k',
  'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h',
  'ة': 'a', 'و': 'w', 'ؤ': 'w', 'ي': 'y', 'ى': 'a', 'ئ': 'y'
};

const ROLE_LABELS = {
  manager: 'مدير',
  reviewer: 'مراجع',
  social_worker: 'أخصائي اجتماعي ميداني',
  data_entry: 'مدخل بيانات'
};

// Hierarchy order: Manager -> Reviewer -> Social Worker -> Data Entry
const ROLE_ORDER = {
  manager: 1,
  reviewer: 2,
  social_worker: 3,
  data_entry: 4
};

const ROLE_BADGE_CLASSES = {
  manager: 'emp-badge--emerald',
  reviewer: 'emp-badge--amber',
  social_worker: 'emp-badge--teal',
  data_entry: 'emp-badge--purple'
};

let currentFilterRole = 'all';
let currentSearchQuery = '';

// Live roster, always fetched from the server — never persisted locally.
// The whole roster is fetched (EmployeesService.listAll) but only the first
// PAGE_SIZE rows are drawn; "تحميل المزيد" reveals another PAGE_SIZE locally.
const PAGE_SIZE = 50;
let employeesList = [];
let visibleCount = PAGE_SIZE;
// Guards against an older, slower response overwriting a newer one (fetching
// every page makes overlapping loads — fast typing, pill clicks — likelier).
let loadSeq = 0;
let isLoading = false;
// آخر خطأ في تحميل القائمة — بيتعرض كحالة خطأ فيها "إعادة المحاولة" بدل "لا يوجد موظفين".
let loadError = null;

/**
 * Smart transliteration of an Arabic name to a clean email (e.g. "محمود علي" -> "mahmoud.ali@nahda.org.eg")
 */
function generateEmailFromName(fullName) {
  if (!fullName || typeof fullName !== 'string') return '';
  const trimmed = fullName.trim();
  if (!trimmed) return '';

  // Check if input is already English
  if (/^[a-zA-Z\s.]+$/.test(trimmed)) {
    const parts = trimmed.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 2);
    return `${parts.join('.')}@nahda.org.eg`;
  }

  // Split words and handle compound names (like عبد الرحمن)
  let words = trimmed.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return '';

  // Merge 'عبد' with following word
  const mergedWords = [];
  for (let i = 0; i < words.length; i++) {
    if (words[i] === 'عبد' && i + 1 < words.length) {
      mergedWords.push(`عبد ${words[i + 1]}`);
      i++;
    } else {
      mergedWords.push(words[i]);
    }
  }

  const transliteratedWords = mergedWords.slice(0, 2).map(w => {
    // 1. Check dictionary first
    if (COMMON_ARABIC_NAMES[w]) {
      return COMMON_ARABIC_NAMES[w];
    }
    // 2. Phonetic fallback
    let latin = '';
    for (let ch of w) {
      if (ARABIC_TO_LATIN[ch] !== undefined) {
        latin += ARABIC_TO_LATIN[ch];
      } else if (/[a-zA-Z0-9]/.test(ch)) {
        latin += ch.toLowerCase();
      }
    }
    return latin.toLowerCase();
  }).filter(Boolean);

  if (transliteratedWords.length === 0) return '';
  const prefix = transliteratedWords.join('.');
  return `${prefix}@nahda.org.eg`;
}

/* --------------------------------------------------------------------------
   EMPLOYEE PASSWORD GENERATOR
   التوليد مسؤولية الـ frontend (الباك إند بيطلب password جاهز في
   CreateEmployeeRequest) — فلازم يكون العشوائية نفسها cryptographically
   secure. النسخة القديمة كانت بادئة ثابتة (11 حرف من 15) + 4 حروف من
   مولّد غير آمن، والبادئة نفسها مكتوبة حرفيًا في الـ bundle المنشور —
   فالمساحة الفعلية كانت 55^4 = ~9.15 مليون احتمال (23.1 بت)، مكسورة
   عمليًا، خصوصًا إن البريد نفسه متوقَّع (firstname.lastname@nahda.org.eg).

   دلوقتي: 16 حرف، مفيش أي حرف ثابت، والمصدر crypto.getRandomValues
   (نفس Web Crypto اللي المشروع بيستخدمه أصلًا في crypto.randomUUID —
   وgetRandomValues متاحة في سياقات أوسع منها، فمفيش أي مخاطرة توافق).

   استبعاد الحروف المتشابهة (i l o I O 0 1) مقصود وبيفضل: كلمة المرور
   بتُقرأ وتُنقل يدويًا للموظف، فالوضوح البصري شرط حقيقي مش رفاهية.
   -------------------------------------------------------------------------- */
const PW_LOWER = 'abcdefghjkmnpqrstuvwxyz';      // من غير i و l و o
const PW_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';     // من غير I و O (L واضحة فبتفضل)
const PW_DIGITS = '23456789';                    // من غير 0 و 1
const PW_SYMBOLS = '!#$%&*+-=?@';                // من غير علامات التنصيص والمسافة والفاصلة
const PW_ALL = PW_LOWER + PW_UPPER + PW_DIGITS + PW_SYMBOLS;
const PW_LENGTH = 16;

/**
 * رقم عشوائي غير متحيّز في [0, max) من الـ CSPRNG.
 * الـ rejection sampling ضروري: byte % max لوحده بيتحيّز لأول حروف
 * المجموعة (قياسًا: انحراف 23.5% مقابل ~1.5% مع الرفض).
 * @param {number} max
 * @returns {number}
 */
function secureIndex(max) {
  const limit = Math.floor(256 / max) * max;
  const buf = new Uint8Array(1);
  let value;
  do {
    crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);
  return value % max;
}

/** حرف واحد عشوائي من مجموعة محددة. */
function securePick(set) {
  return set.charAt(secureIndex(set.length));
}

/**
 * Generates a cryptographically secure employee password: 16 characters,
 * no fixed prefix, guaranteed to contain lowercase + uppercase + digit +
 * symbol (~96 bits of entropy).
 * @returns {string}
 */
function generateSecurePassword() {
  // حرف مضمون من كل فئة، عشان نضمن تحقيق أي سياسة تعقيد في الباك إند.
  const out = [
    securePick(PW_LOWER),
    securePick(PW_UPPER),
    securePick(PW_DIGITS),
    securePick(PW_SYMBOLS)
  ];
  for (let i = out.length; i < PW_LENGTH; i++) {
    out.push(securePick(PW_ALL));
  }
  // Fisher-Yates بمصدر عشوائي آمن — عشان الحروف المضمونة ماتفضلش في
  // أول 4 خانات (ده كان بيبقى pattern متوقَّع في حد ذاته).
  for (let i = out.length - 1; i > 0; i--) {
    const j = secureIndex(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

/**
 * Safely copies text to clipboard with Toast confirmation
 */
async function copyToClipboard(text, successMsg = 'تم النسخ بنجاح 📋') {
  if (!text) {
    showToast('لا يوجد نص للنسخ ⚠️');
    return false;
  }

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      showToast(successMsg);
      return true;
    }
  } catch (err) {
    // Fallback for older contexts
  }

  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    if (successful) {
      showToast(successMsg);
      return true;
    }
  } catch (err) { }

  showToast('تعذر النسخ التلقائي، يمكنك تحديد النص ونسخه يدوياً ⚠️');
  return false;
}

/** Field-level validation details -> one readable Arabic line. */
function detailsToMessage(details) {
  if (!details || typeof details !== 'object') return '';
  const lines = [];
  Object.values(details).forEach(fieldErrors => {
    if (Array.isArray(fieldErrors)) lines.push(...fieldErrors);
  });
  return lines.join(' — ');
}

function reportError(err, fallbackPrefix = '') {
  const detail = err && err.details ? detailsToMessage(err.details) : '';
  const msg = messageFromError(err);
  showToast(`${fallbackPrefix}${detail || msg} ⚠️`);
}

export function initEmployeesManager() {
  const viewContainer = DOM.qs('#view-employees');
  if (!viewContainer) return;

  const form = DOM.qs('#employee-form');
  const editIdInput = DOM.qs('#employee-edit-id');
  const nameInput = DOM.qs('#employee-name-input');
  const roleSelect = DOM.qs('#employee-role-select');
  const emailInput = DOM.qs('#employee-email-input');
  const passwordInput = DOM.qs('#employee-password-input');
  const centerSelect = DOM.qs('#employee-center-select');
  const phoneInput = DOM.qs('#employee-phone-input');
  const submitText = DOM.qs('#employee-submit-text');
  const cancelBtn = DOM.qs('#btn-cancel-edit-employee');
  const formTitle = DOM.qs('#employee-form-title');

  const btnRegenPassword = DOM.qs('#btn-regen-password');
  const btnCopyEmail = DOM.qs('#btn-copy-email-field');
  const btnCopyPassword = DOM.qs('#btn-copy-password-field');
  const btnTogglePw = DOM.qs('#btn-toggle-emp-pw');
  const btnExport = DOM.qs('#btn-export-employees');

  const searchInput = DOM.qs('#employee-search-input');
  const rolePills = DOM.qsa('.employee-role-pill');
  const statCards = DOM.qsa('.employee-stat-card');

  const canManage = () => can(PERMISSIONS.MANAGE_EMPLOYEES);

  // 0. Populate center dropdown from server locations (loads /locations if
  // it hasn't been fetched yet by another page this session).
  function populateCenterOptions() {
    if (!centerSelect) return;
    const currentVal = centerSelect.value;
    const centers = Object.keys(store.beniSuefLocations || {});
    centerSelect.innerHTML = '<option value="">بدون مركز محدد</option>' +
      centers.map(c => `<option value="${DOM.escapeHTML(c)}">مركز ${DOM.escapeHTML(c)}</option>`).join('');
    if (currentVal && centers.includes(currentVal)) {
      centerSelect.value = currentVal;
    }
  }

  async function ensureLocationsLoaded() {
    const centerIds = store.locationIds && store.locationIds.centers;
    if (centerIds && Object.keys(centerIds).length > 0) {
      populateCenterOptions();
      return;
    }
    try {
      const centers = await LocationsService.list();
      store.applyLocationsFromServer(centers);
    } catch (err) {
      // Non-fatal — center assignment is optional; the form still works without it.
    }
  }

  EventBus.on(EVENTS.LOCATIONS_UPDATED, populateCenterOptions);

  // 1. Initial State: Auto-generate an initial password for a new employee
  if (passwordInput && !passwordInput.value) {
    passwordInput.value = generateSecurePassword();
  }

  // 2. Realtime Automatic Email Generation on Name Typing (Strictly Read-Only)
  if (nameInput && emailInput) {
    nameInput.addEventListener('input', () => {
      const isEditing = editIdInput && editIdInput.value;
      if (!isEditing) {
        const val = nameInput.value.trim();
        emailInput.value = generateEmailFromName(val);
        if (!passwordInput.value) {
          passwordInput.value = generateSecurePassword();
        }
      }
    });
  }

  // 3. Regenerate Password Button
  if (btnRegenPassword && passwordInput) {
    btnRegenPassword.addEventListener('click', (e) => {
      e.preventDefault();
      passwordInput.value = generateSecurePassword();
      // بتفضل مخفية افتراضيًا — زرار الإظهار جنبها لو المستخدم محتاج يقراها.
      passwordInput.type = 'password';
      if (btnTogglePw) btnTogglePw.textContent = '🔒';
      showToast('تم توليد كلمة مرور عشوائية جديدة 🔒');
    });
  }

  // 4. Copy Email & Copy Password Buttons in Form
  if (btnCopyEmail && emailInput) {
    btnCopyEmail.addEventListener('click', (e) => {
      e.preventDefault();
      copyToClipboard(emailInput.value, `تم نسخ البريد: ${emailInput.value} 📧`);
    });
  }

  if (btnCopyPassword && passwordInput) {
    btnCopyPassword.addEventListener('click', (e) => {
      e.preventDefault();
      // الـ toast مابيعرضش كلمة المرور نفسها — كانت بتظهر على الشاشة لكل
      // من حوله بلا داعٍ، والنسخ نفسه كافي كتأكيد.
      copyToClipboard(passwordInput.value, 'تم نسخ كلمة المرور 🔑');
    });
  }

  // 5. Password Visibility Toggle
  if (btnTogglePw && passwordInput) {
    btnTogglePw.addEventListener('click', (e) => {
      e.preventDefault();
      const isText = passwordInput.type === 'text';
      passwordInput.type = isText ? 'password' : 'text';
      btnTogglePw.textContent = isText ? '🔒' : '👁️';
      btnTogglePw.setAttribute('aria-pressed', isText ? 'false' : 'true');
      btnTogglePw.setAttribute('aria-label', isText ? 'إظهار كلمة المرور' : 'إخفاء كلمة المرور');
    });
  }

  /** Builds the "share with the employee" message text used by both copy and WhatsApp. */
  function buildCredentialsMessage({ name, roleLabel, email, password }) {
    const origin = window.location.origin + window.location.pathname;
    return `مرحباً بك يا ${name} 👋
تم إنشاء/تحديث بيانات الدخول لحسابك في منظومة مؤسسة النهضة ببني سويف:
------------------------------------------
• الدور الوظيفي: ${roleLabel}
• البريد الإلكتروني: ${email}
• كلمة المرور السرية: ${password}
• رابط الدخول للمنظومة: ${origin}
------------------------------------------
يرجى الاحتفاظ ببيانات الدخول وعدم مشاركتها مع أطراف غير مصرح لها.`;
  }

  /** Normalizes a local Egyptian number (01xxxxxxxxx) to E.164 for wa.me links. */
  function toWhatsAppNumber(phone) {
    if (!phone) return '';
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('20')) return digits;
    if (digits.startsWith('0')) return `2${digits}`;
    return digits;
  }

  // 6. Credentials Modal — shown once after create/reset, since the server
  // never returns the plaintext password again afterwards.
  function showCredentialsBox({ name, roleLabel, roleCode, email, password, phone }) {
    const overlay = DOM.createElement('div', { className: 'modal-overlay' });
    overlay.innerHTML = `
      <div class="modal-card" style="max-width: 480px;" role="dialog" aria-modal="true" aria-labelledby="cred-modal-title">
        <div class="modal-card__header">
          <div>
            <div class="modal-card__title" id="cred-modal-title">✓ بيانات الدخول جاهزة للمشاركة</div>
            <div class="modal-card__subtitle" id="cred-showcase-time">الآن</div>
          </div>
          <button type="button" class="modal-card__close" id="cred-modal-close" title="إغلاق" aria-label="إغلاق النافذة">✕</button>
        </div>
        <div class="modal-card__body">
          <div class="credentials-showcase-body">
            <div class="credentials-row">
              <span class="cred-label">👤 الموظف:</span>
              <strong class="cred-val" id="cred-showcase-name">${DOM.escapeHTML(name)}</strong>
            </div>
            <div class="credentials-row">
              <span class="cred-label">🏷️ الدور الوظيفي:</span>
              <span class="emp-role-text ${ROLE_BADGE_CLASSES[roleCode] || ''}" id="cred-showcase-role">${DOM.escapeHTML(roleLabel)}</span>
            </div>
            <div class="credentials-row">
              <span class="cred-label">📧 البريد الإلكتروني:</span>
              <code class="cred-code" id="cred-showcase-email">${DOM.escapeHTML(email)}</code>
            </div>
            <div class="credentials-row">
              <span class="cred-label">🔑 كلمة المرور:</span>
              <code class="cred-code" id="cred-showcase-password">${DOM.escapeHTML(password)}</code>
            </div>
          </div>

          <div class="form-group" style="margin-top: 16px;">
            <label for="cred-whatsapp-phone" class="form-label">📱 رقم واتساب لإرسال البيانات إليه</label>
            <input type="tel" id="cred-whatsapp-phone" class="form-input" placeholder="01xxxxxxxxx" dir="ltr" value="${DOM.escapeHTML(phone || '')}">
          </div>
        </div>
        <div class="modal-card__footer" style="flex-wrap: wrap;">
          <button type="button" class="btn btn--secondary" id="btn-copy-full-credentials">
            📋 نسخ بيانات الدخول كاملة
          </button>
          <button type="button" class="btn" id="btn-send-whatsapp-credentials" style="background:#25D366; color:#fff;">
            🟢 إرسال عبر واتساب
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const timeEl = overlay.querySelector('#cred-showcase-time');
    if (timeEl) timeEl.textContent = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

    const closeDialog = () => overlay.remove();
    overlay.querySelector('#cred-modal-close').addEventListener('click', closeDialog);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeDialog();
    });

    overlay.querySelector('#btn-copy-full-credentials').addEventListener('click', () => {
      const fullText = buildCredentialsMessage({ name, roleLabel, email, password });
      copyToClipboard(fullText, 'تم نسخ بيانات الدخول بالكامل وهي جاهزة للإرسال للموظف 📋✨');
    });

    overlay.querySelector('#btn-send-whatsapp-credentials').addEventListener('click', () => {
      const phoneInputEl = overlay.querySelector('#cred-whatsapp-phone');
      const waNumber = toWhatsAppNumber(phoneInputEl ? phoneInputEl.value.trim() : '');
      if (!waNumber) {
        showToast('الرجاء إدخال رقم واتساب صحيح للموظف ⚠️');
        if (phoneInputEl) phoneInputEl.focus();
        return;
      }
      const fullText = buildCredentialsMessage({ name, roleLabel, email, password });
      const waUrl = `https://wa.me/${waNumber}?text=${encodeURIComponent(fullText)}`;
      window.open(waUrl, '_blank', 'noopener,noreferrer');
    });
  }

  // 7. Form Submission (Create / Update Employee)
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      if (!canManage()) {
        showToast('ليس لديك صلاحية لإدارة الموظفين ⚠️');
        return;
      }

      const name = nameInput ? nameInput.value.trim() : '';
      const roleCode = roleSelect ? roleSelect.value : '';
      const email = emailInput ? emailInput.value.trim() : '';
      const password = passwordInput ? passwordInput.value.trim() : '';
      const centerName = centerSelect ? centerSelect.value : '';
      const phone = phoneInput ? phoneInput.value.trim() : '';
      const editId = editIdInput ? editIdInput.value : '';

      if (!name) {
        showToast('الرجاء إدخال اسم الموظف ⚠️');
        if (nameInput) nameInput.focus();
        return;
      }

      if (!roleCode) {
        showToast('الرجاء اختيار الدور الوظيفي للموظف ⚠️');
        if (roleSelect) roleSelect.focus();
        return;
      }

      if (!editId && !email) {
        showToast('الرجاء توليد البريد الإلكتروني بكتابة الاسم ⚠️');
        return;
      }

      if (!editId && !password) {
        showToast('الرجاء توليد كلمة المرور السرية ⚠️');
        return;
      }

      const roleLabel = ROLE_LABELS[roleCode] || 'موظف';
      const centerId = centerName ? (store.locationIds.centers || {})[centerName] || null : null;
      const submitBtn = DOM.qs('#btn-save-employee');
      if (submitBtn) submitBtn.disabled = true;

      try {
        if (editId) {
          const existing = employeesList.find(x => x.id === editId);
          await EmployeesService.update(editId, {
            fullName: name,
            centerId,
            phone: phone || null,
            gender: existing ? existing.gender || null : null,
            rowVersion: existing ? existing.rowVersion : undefined
          });

          if (existing && existing.roleCode !== roleCode) {
            await EmployeesService.changeRole(editId, roleCode);
          }

          showToast(`تم تحديث بيانات الموظف (${name}) بنجاح ✨`);
        } else {
          await EmployeesService.create({
            fullName: name,
            email,
            password,
            role: roleCode,
            centerId,
            phone: phone || null,
            gender: null
          });

          showToast(`تم إنشاء حساب الموظف (${name}) بدور [${roleLabel}] بنجاح 🚀`);

          // Show the generated credentials once, ready to copy/share.
          showCredentialsBox({ name, roleLabel, roleCode, email, password, phone });
        }

        resetForm();
        await loadEmployees({ keepPaging: true });
      } catch (err) {
        reportError(err, editId ? 'تعذر تحديث بيانات الموظف: ' : 'تعذر إنشاء حساب الموظف: ');
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  // 8. Cancel Edit Handler
  if (cancelBtn) {
    cancelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      resetForm();
    });
  }

  function resetForm() {
    if (form) form.reset();
    if (editIdInput) editIdInput.value = '';
    if (submitText) submitText.textContent = 'إنشاء حساب الموظف 🚀';
    if (formTitle) formTitle.textContent = 'إضافة موظف جديد';
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (passwordInput) {
      passwordInput.value = generateSecurePassword();
      passwordInput.type = 'password';
    }
    if (btnTogglePw) btnTogglePw.textContent = '🔒';
    if (emailInput) {
      emailInput.value = '';
      emailInput.readOnly = true;
    }
  }

  // 9. Search Input Filtering — server-side param, so debounce the reload.
  let searchDebounce = null;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      currentSearchQuery = searchInput.value.trim().toLowerCase();
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => loadEmployees(), 350);
    });
  }

  // 10. Role Pills Filtering — server-side param too.
  rolePills.forEach(pill => {
    pill.addEventListener('click', () => {
      rolePills.forEach(p => p.classList.remove('employee-role-pill--active'));
      pill.classList.add('employee-role-pill--active');
      currentFilterRole = pill.getAttribute('data-role-filter') || 'all';
      loadEmployees();
    });
  });

  // Also bind clicking on stats cards to filter by that role
  statCards.forEach(card => {
    card.addEventListener('click', () => {
      const targetRole = card.getAttribute('data-role-filter');
      if (targetRole) {
        currentFilterRole = targetRole;
        rolePills.forEach(p => {
          p.classList.toggle('employee-role-pill--active', p.getAttribute('data-role-filter') === targetRole);
        });
        loadEmployees();
      }
    });
  });

  // 11. Render Employees Table (Strictly Ordered by Hierarchy: Manager -> Reviewer -> Social Worker -> Data Entry)
  function renderEmployeesTable() {
    const tbody = DOM.qs('#employees-table-body');
    const emptyState = DOM.qs('#employees-empty-state');
    const tableEl = DOM.qs('#employees-table');
    if (!tbody) return;

    if (isLoading) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 32px; color:#64748b;">⏳ جاري تحميل بيانات الموظفين...</td></tr>`;
      if (emptyState) emptyState.style.display = 'none';
      if (tableEl) tableEl.style.display = 'table';
      return;
    }

    if (loadError) {
      tbody.innerHTML = `<tr><td colspan="7">${errorStateHTML(loadError, 'الموظفين', { compact: true })}</td></tr>`;
      bindRetry(tbody, loadEmployees);
      if (emptyState) emptyState.style.display = 'none';
      if (tableEl) tableEl.style.display = 'table';
      return;
    }

    // Filter Employees
    const filtered = employeesList.filter(emp => {
      const matchesRole = currentFilterRole === 'all' || emp.roleCode === currentFilterRole;

      const matchesSearch = !currentSearchQuery ||
        emp.name.toLowerCase().includes(currentSearchQuery) ||
        (emp.email && emp.email.toLowerCase().includes(currentSearchQuery)) ||
        (emp.roleLabel && emp.roleLabel.toLowerCase().includes(currentSearchQuery)) ||
        (emp.center && emp.center.toLowerCase().includes(currentSearchQuery)) ||
        (emp.phone && emp.phone.includes(currentSearchQuery));

      return matchesRole && matchesSearch;
    });

    // Sort strictly by hierarchy: Manager -> Reviewer -> Social Worker -> Data Entry
    filtered.sort((a, b) => {
      const rankA = ROLE_ORDER[a.roleCode] || 99;
      const rankB = ROLE_ORDER[b.roleCode] || 99;
      return rankA - rankB;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = '';
      if (emptyState) emptyState.style.display = 'block';
      if (tableEl) tableEl.style.display = 'none';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if (tableEl) tableEl.style.display = 'table';

    const manage = canManage();

    const visible = filtered.slice(0, visibleCount);
    const remaining = filtered.length - visible.length;

    const rowsHtml = visible.map((emp, idx) => {
      const badgeClass = ROLE_BADGE_CLASSES[emp.roleCode] || 'emp-badge--emerald';
      const isActive = emp.status === 'active';
      const statusBadge = isActive
        ? '<span style="color:#059669; font-weight:800; font-size:12px;">🟢 نشط</span>'
        : '<span style="color:#dc2626; font-weight:800; font-size:12px;">🔴 موقوف</span>';

      const toggleBtn = manage
        ? `<button type="button" class="btn-action-icon btn-toggle-status-emp" data-emp-id="${emp.id}" data-active="${isActive}" title="${isActive ? 'تعطيل الحساب' : 'تفعيل الحساب'}">${isActive ? '⏸️' : '▶️'}</button>`
        : '';
      const resetPwBtn = manage
        ? `<button type="button" class="btn-action-icon btn-reset-pw-emp" data-emp-id="${emp.id}" title="إعادة تعيين كلمة المرور">🔑</button>`
        : '';
      const editBtn = manage
        ? `<button type="button" class="btn-action-icon btn-edit-emp" data-emp-id="${emp.id}" title="تعديل الموظف">✏️</button>`
        : '';
      const deleteBtn = manage
        ? `<button type="button" class="btn-action-icon btn-action-icon--danger btn-delete-emp" data-emp-id="${emp.id}" title="حذف حساب الموظف">🗑️</button>`
        : '';

      return `
        <tr class="employee-row" data-emp-id="${emp.id}">
          <td style="text-align: center; font-weight: 700; color: #64748b;">${idx + 1}</td>
          <td>
            <strong class="emp-name">${DOM.escapeHTML(emp.name)}</strong>
          </td>
          <td>
            <span class="emp-role-text ${badgeClass}">${DOM.escapeHTML(emp.roleLabel || emp.roleCode)}</span>
          </td>
          <td>
            <div class="emp-code-copy-wrapper">
              <code class="emp-inline-code">${DOM.escapeHTML(emp.email)}</code>
              <button type="button" class="btn-copy-mini btn-copy-row-email" data-email="${DOM.escapeHTML(emp.email)}" title="نسخ البريد الإلكتروني">
                📋
              </button>
            </div>
          </td>
          <td>
            <span class="emp-center-badge">📍 ${DOM.escapeHTML(emp.center || 'بدون مركز')}</span>
          </td>
          <td style="text-align: center;">${statusBadge}</td>
          <td style="text-align: center;">
            <div class="emp-row-actions">
              ${toggleBtn}
              ${resetPwBtn}
              ${editBtn}
              ${deleteBtn}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    const loadMoreHtml = remaining > 0 ? `
      <tr class="employees-load-more-row">
        <td colspan="7" style="text-align: center; padding: 20px;">
          <button type="button" class="btn btn--secondary btn-load-more-employees" style="font-weight: 800;">
            تحميل المزيد (عرض ${visible.length} من ${filtered.length}) ⬇️
          </button>
        </td>
      </tr>
    ` : '';

    tbody.innerHTML = rowsHtml + loadMoreHtml;

    const loadMoreBtn = tbody.querySelector('.btn-load-more-employees');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => {
        visibleCount += PAGE_SIZE;
        renderEmployeesTable();
      });
    }

    // Attach Action Listeners in Table Rows
    bindTableActions(tbody);
  }

  function bindTableActions(container) {
    // 1. Copy Row Email
    container.querySelectorAll('.btn-copy-row-email').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const em = btn.getAttribute('data-email');
        copyToClipboard(em, `تم نسخ البريد: ${em} 📧`);
      });
    });

    // 2. Toggle Activate/Deactivate
    container.querySelectorAll('.btn-toggle-status-emp').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!canManage()) {
          showToast('ليس لديك صلاحية لإدارة الموظفين ⚠️');
          return;
        }
        const empId = btn.getAttribute('data-emp-id');
        const isActive = btn.getAttribute('data-active') === 'true';
        const emp = employeesList.find(x => x.id === empId);
        if (!emp) return;

        const confirmMsg = isActive
          ? `هل أنت متأكد من تعطيل حساب الموظف (${emp.name})؟ لن يتمكن من تسجيل الدخول بعدها.`
          : `هل تريد إعادة تفعيل حساب الموظف (${emp.name})؟`;
        const confirmed = await confirmDialog({
          title: isActive ? 'تعطيل حساب موظف' : 'تفعيل حساب موظف',
          message: confirmMsg,
          confirmLabel: isActive ? 'تعطيل' : 'تفعيل',
          danger: isActive
        });
        if (!confirmed) return;

        btn.disabled = true;
        try {
          if (isActive) {
            await EmployeesService.deactivate(empId);
            showToast(`تم تعطيل حساب الموظف (${emp.name}) 🔴`);
          } else {
            await EmployeesService.activate(empId);
            showToast(`تم تفعيل حساب الموظف (${emp.name}) 🟢`);
          }
          await loadEmployees({ keepPaging: true });
        } catch (err) {
          reportError(err, 'تعذر تنفيذ العملية: ');
        } finally {
          btn.disabled = false;
        }
      });
    });

    // 3. Reset Password
    container.querySelectorAll('.btn-reset-pw-emp').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!canManage()) {
          showToast('ليس لديك صلاحية لإدارة الموظفين ⚠️');
          return;
        }
        const empId = btn.getAttribute('data-emp-id');
        const emp = employeesList.find(x => x.id === empId);
        if (emp) openResetPasswordDialog(emp);
      });
    });

    // 4. Edit Employee
    container.querySelectorAll('.btn-edit-emp').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const empId = btn.getAttribute('data-emp-id');
        const emp = employeesList.find(x => x.id === empId);
        if (emp) {
          if (editIdInput) editIdInput.value = emp.id;
          if (nameInput) nameInput.value = emp.name;
          if (roleSelect) roleSelect.value = emp.roleCode;
          if (emailInput) emailInput.value = emp.email;
          if (passwordInput) passwordInput.value = '';
          if (centerSelect) centerSelect.value = emp.center || '';
          if (phoneInput) phoneInput.value = emp.phone || '';
          if (submitText) submitText.textContent = 'حفظ تعديلات الموظف ✨';
          if (formTitle) formTitle.textContent = `تعديل بيانات الموظف (${emp.name})`;
          if (cancelBtn) cancelBtn.style.display = 'inline-flex';
          form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          showToast(`جاري تعديل بيانات الموظف: ${emp.name} ✏️`);
        }
      });
    });

    // 5. Delete Employee
    container.querySelectorAll('.btn-delete-emp').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!canManage()) {
          showToast('ليس لديك صلاحية لإدارة الموظفين ⚠️');
          return;
        }
        const empId = btn.getAttribute('data-emp-id');
        const emp = employeesList.find(x => x.id === empId);
        if (!emp) return;

        const confirmed = await confirmDialog({
          title: 'حذف حساب موظف',
          message: `هل أنت متأكد من حذف حساب الموظف (${emp.name})؟ لن يتمكن من تسجيل الدخول للنظام بعدها، والبريد الإلكتروني لن يكون قابلاً لإعادة الاستخدام مستقبلاً.`,
          confirmLabel: 'حذف الحساب',
          danger: true
        });
        if (!confirmed) return;

        btn.disabled = true;
        try {
          await EmployeesService.remove(empId);
          showToast(`تم حذف حساب الموظف (${emp.name}) بنجاح 🗑️`);
          await loadEmployees({ keepPaging: true });
        } catch (err) {
          reportError(err, 'تعذر حذف الموظف: ');
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  // 12. Reset Password Dialog — generates a strong password client-side,
  // lets the admin regenerate/copy it, then confirms via the real endpoint.
  function openResetPasswordDialog(emp) {
    let pending = generateSecurePassword();

    const overlay = DOM.createElement('div', { className: 'modal-overlay' });
    overlay.innerHTML = `
      <div class="modal-card" style="max-width: 460px;" role="dialog" aria-modal="true" aria-labelledby="reset-pw-title">
        <div class="modal-card__header">
          <div>
            <div class="modal-card__title" id="reset-pw-title">إعادة تعيين كلمة مرور</div>
            <div class="modal-card__subtitle">${DOM.escapeHTML(emp.name)}</div>
          </div>
          <button type="button" class="modal-card__close" id="reset-pw-close" title="إغلاق" aria-label="إغلاق النافذة">✕</button>
        </div>
        <div class="modal-card__body">
          <p style="font-size:13px; color:#64748b; margin: 0 0 14px;">سيتم توليد كلمة مرور جديدة وقوية للموظف. هذه هي الفرصة الوحيدة لرؤيتها ونسخها — لن تظهر مرة أخرى بعد الإغلاق.</p>
          <div class="input-with-action">
            <input type="text" id="reset-pw-value" aria-label="كلمة المرور الجديدة" class="form-input form-input--generated" readonly dir="ltr" style="letter-spacing:1px; font-weight:800; font-family:'Consolas','Courier New',monospace;" value="${DOM.escapeHTML(pending)}">
          </div>
          <div style="display:flex; gap:8px; margin-top:12px;">
            <button type="button" class="btn btn--secondary btn--sm" id="reset-pw-regen">🔄 توليد جديدة</button>
            <button type="button" class="btn btn--secondary btn--sm" id="reset-pw-copy">📋 نسخ</button>
          </div>
        </div>
        <div class="modal-card__footer">
          <button type="button" class="btn btn--secondary" id="reset-pw-cancel">إلغاء</button>
          <button type="button" class="btn btn--primary" id="reset-pw-confirm">تأكيد إعادة التعيين</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const valueInput = overlay.querySelector('#reset-pw-value');
    const closeDialog = () => overlay.remove();

    overlay.querySelector('#reset-pw-regen').addEventListener('click', () => {
      pending = generateSecurePassword();
      valueInput.value = pending;
    });

    overlay.querySelector('#reset-pw-copy').addEventListener('click', () => {
      copyToClipboard(pending, 'تم نسخ كلمة المرور 🔑');
    });

    overlay.querySelector('#reset-pw-cancel').addEventListener('click', closeDialog);
    overlay.querySelector('#reset-pw-close').addEventListener('click', closeDialog);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeDialog();
    });

    overlay.querySelector('#reset-pw-confirm').addEventListener('click', async () => {
      const confirmBtn = overlay.querySelector('#reset-pw-confirm');
      confirmBtn.disabled = true;
      try {
        await EmployeesService.resetPassword(emp.id, pending);
        showToast(`تم إعادة تعيين كلمة مرور (${emp.name}) بنجاح 🔑`);
        closeDialog();
        showCredentialsBox({
          name: emp.name,
          roleLabel: emp.roleLabel,
          roleCode: emp.roleCode,
          email: emp.email,
          password: pending,
          phone: emp.phone
        });
      } catch (err) {
        reportError(err, 'تعذر إعادة تعيين كلمة المرور: ');
        confirmBtn.disabled = false;
      }
    });
  }

  // 13. Update Employees Stats Counters
  function updateEmployeesStats() {
    const list = employeesList;

    const totalEl = DOM.qs('#stat-total-employees');
    const managersEl = DOM.qs('#stat-managers');
    const reviewersEl = DOM.qs('#stat-reviewers');
    const socialWorkerEl = DOM.qs('#stat-social-workers');
    const dataEntryEl = DOM.qs('#stat-data-entry');

    if (totalEl) totalEl.textContent = list.length;
    if (managersEl) managersEl.textContent = list.filter(e => e.roleCode === 'manager').length;
    if (reviewersEl) reviewersEl.textContent = list.filter(e => e.roleCode === 'reviewer').length;
    if (socialWorkerEl) socialWorkerEl.textContent = list.filter(e => e.roleCode === 'social_worker').length;
    if (dataEntryEl) dataEntryEl.textContent = list.filter(e => e.roleCode === 'data_entry').length;
  }

  // 14. Export Employees to CSV — real server export (no passwords, ever).
  async function exportEmployeesToCSV() {
    if (!canManage()) {
      showToast('تصدير الموظفين يتطلب صلاحية إدارة الموظفين ⚠️');
      return;
    }
    if (btnExport) btnExport.disabled = true;
    try {
      const csvContent = await EmployeesService.exportCsv({
        search: currentSearchQuery || undefined,
        role: currentFilterRole !== 'all' ? currentFilterRole : undefined
      });
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `employees_nahda_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showToast('تم تصدير سجل الموظفين بنجاح (بدون كلمات مرور) 📥');
    } catch (err) {
      reportError(err, 'تعذر تصدير الموظفين: ');
    } finally {
      if (btnExport) btnExport.disabled = false;
    }
  }

  if (btnExport) {
    btnExport.addEventListener('click', exportEmployeesToCSV);
  }

  // 15. Load every matching employee from the real API — replaces the whole
  // in-memory list. The visible window resets to the first PAGE_SIZE rows
  // unless `keepPaging` (reload after a write, where the user is mid-list).
  async function loadEmployees({ keepPaging = false } = {}) {
    const seq = ++loadSeq;
    if (!keepPaging) visibleCount = PAGE_SIZE;
    isLoading = true;
    loadError = null;
    renderEmployeesTable();
    try {
      const result = await EmployeesService.listAll({
        search: currentSearchQuery || undefined,
        role: currentFilterRole !== 'all' ? currentFilterRole : undefined
      });
      if (seq !== loadSeq) return;
      const items = (result && result.items) || [];
      employeesList = items.map(item => ({
        id: item.id,
        name: item.fullName,
        email: item.email,
        roleCode: item.role,
        roleLabel: ROLE_LABELS[item.role] || item.role,
        status: item.status,
        center: findCenterNameById(item.centerId),
        centerId: item.centerId,
        phone: item.phone,
        rowVersion: item.rowVersion
      }));
    } catch (err) {
      if (seq !== loadSeq) return;
      employeesList = [];
      loadError = err;
    } finally {
      if (seq === loadSeq) {
        isLoading = false;
        renderEmployeesTable();
        updateEmployeesStats();
      }
    }
  }

  function findCenterNameById(centerId) {
    if (!centerId) return '';
    const centerIds = store.locationIds.centers || {};
    const match = Object.entries(centerIds).find(([, id]) => id === centerId);
    return match ? match[0] : '';
  }

  // Hide write-actions the current user cannot use.
  if (!canManage()) {
    if (form) {
      const submitBtn = DOM.qs('#btn-save-employee');
      if (submitBtn) submitBtn.disabled = true;
    }
    if (btnExport) btnExport.disabled = true;
  }

  // التحميل بيحصل لما الشاشة تتفتح فعلًا (وبيتعاد مع كل فتحة عشان تبان
  // تعديلات باقي المديرين)، مش وقت فتح التطبيق — وبس لو المستخدم عنده
  // صلاحية manage_employees، غير كده السيرفر بيرجّع 403 من غير داعي.
  onViewEnter('employees', ({ firstEnter }) => {
    if (!canManage()) return;
    if (firstEnter) ensureLocationsLoaded().then(populateCenterOptions);
    loadEmployees();
  });
}
