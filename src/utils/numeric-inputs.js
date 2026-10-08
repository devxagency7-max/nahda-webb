/* --------------------------------------------------------------------------
   GLOBAL NUMERIC INPUT NORMALIZATION
   أي حقل بيتعلّم بـ [data-numeric] بيتحول تلقائيًا لأرقام إنجليزية (٠-٩ / ۰-۹
   -> 0-9) أول ما المستخدم يكتب، مع الحفاظ على موضع المؤشر. الأرقام
   الإنجليزية المكتوبة أصلاً بتفضل زي ما هي من غير أي تغيير.

   ليه مش <input type="number">: كل المتصفحات الحديثة (تحديدًا Chrome/Chromium
   وSafari) بترفض إدخال الأرقام العربية/الفارسية في type="number" من الأساس —
   بيوصل .value فاضي قبل ما أي كود JS يشوفه. فبنستخدم type="text" مع
   inputmode="decimal"/"numeric" (نفس لوحة مفاتيح الأرقام على الموبايل) وتطبيع
   يدوي بدل الاعتماد على تحقق المتصفح الأصلي.
   -------------------------------------------------------------------------- */
import { normalizeNumerals, normalizeDecimalNumerals } from './nationalId.js';

/**
 * يطبّع حقل إدخال واحد فوريًا (Arabic/Persian -> English)، مع الحفاظ على
 * موضع المؤشر النسبي حتى لو طول القيمة اتغيّر (زي مسح فاصلة عشرية مكررة).
 * @param {HTMLInputElement} el
 * @param {boolean} allowDecimal - true للمبالغ/المساحات (بيحافظ على نقطة عشرية واحدة)
 */
function normalizeField(el, allowDecimal) {
  const before = el.value;
  const normalize = allowDecimal ? normalizeDecimalNumerals : normalizeNumerals;
  const after = normalize(before);
  if (after === before) return;

  const caret = el.selectionStart;
  const lengthDelta = after.length - before.length;
  el.value = after;

  if (caret != null && typeof el.setSelectionRange === 'function') {
    const newCaret = Math.max(0, caret + lengthDelta);
    try {
      el.setSelectionRange(newCaret, newCaret);
    } catch {
      // بعض أنواع الحقول (زي number) بترفض setSelectionRange — مش متوقع هنا
      // بما إننا بنستهدف text/tel بس، لكن حماية إضافية بسيطة.
    }
  }
}

/**
 * مبلغ بالجنيه (نفس InputFormatters.amount في تطبيق الموبايل): بدون إشارة سالب
 * (normalizeDecimalNumerals بتشيل أي حرف غير الرقم والنقطة أصلًا)، نقطة عشرية
 * واحدة، خانتان بعدها، وحد أقصى 9 خانات صحيحة. [data-money="true"].
 * @param {HTMLInputElement} el
 */
function constrainMoney(el) {
  const before = el.value;
  const firstDot = before.indexOf('.');
  const intPart = (firstDot === -1 ? before : before.slice(0, firstDot)).slice(0, 9);
  const fraction = firstDot === -1 ? null : before.slice(firstDot + 1).replace(/\./g, '').slice(0, 2);
  const after = fraction === null ? intPart : `${intPart}.${fraction}`;
  if (after === before) return;
  const caret = el.selectionStart;
  el.value = after;
  if (caret != null) {
    const pos = Math.min(caret, after.length);
    try { el.setSelectionRange(pos, pos); } catch { /* ignore */ }
  }
}

/**
 * يفعّل التطبيع الفوري على كل حقول الإدخال الرقمية في التطبيق كله عبر
 * event delegation واحد على document — يغطي أي حقل جديد يتضاف لاحقًا من غير
 * ما نحتاج نربط listener يدوي لكل حقل.
 *
 * الحقول المستهدفة:
 * - [data-numeric="integer"]: أرقام صحيحة فقط (السن، عدد النتائج...)
 * - [data-numeric="decimal"]: أرقام بفاصلة عشرية (مبالغ، مساحات...)
 * - input[type="tel"]: أرقام هاتف (أرقام صحيحة دايمًا)
 *
 * الرقم القومي (#national-id) ورقم فرد الأسرة (#new-member-id) مستثنيان
 * عمدًا — عندهم تطبيع خاص فعلاً في workflow.component.js/family-members
 * component.js مربوط باستخراج السن/النوع، وتفعيل التطبيع العام عليهم كمان
 * هيبقى تكرار من غير أي فايدة إضافية.
 */
export function initNumericInputNormalization() {
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement)) return;
    if (el.id === 'national-id' || el.id === 'new-member-id') return;

    // أول تعديل بعد خطأ تحقق (إطار أحمر + رسالة `#<id>-error`) بيمسحهم؛ التحقق
    // الجاي بيرجّعهم لو لسه الحقل غلط.
    if (el.classList.contains('field-invalid')) {
      el.classList.remove('field-invalid');
      const errEl = el.id ? document.getElementById(`${el.id}-error`) : null;
      if (errEl) errEl.style.display = 'none';
    }

    const numericKind = el.dataset.numeric;
    if (numericKind === 'decimal') {
      normalizeField(el, true);
      if (el.dataset.money === 'true') constrainMoney(el);
    } else if (numericKind === 'integer' || el.type === 'tel') {
      normalizeField(el, false);
    }
  });
}
