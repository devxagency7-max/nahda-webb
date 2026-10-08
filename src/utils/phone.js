/* --------------------------------------------------------------------------
   رقم الهاتف المصري — نفس قاعدة تطبيق الموبايل (core/utils/validators.dart):
   موبايل (010/011/012/015 + 8 أرقام، مع أو بدون +20 / 20 / 0) أو أرضي
   (صفر + كود منطقة + رقم، 9 إلى 11 رقمًا). فاضي = مقبول (الحقل اختياري).
   هي مساعدة للمستخدم لا حارس نهائي: السيرفر هو الحكم.
   -------------------------------------------------------------------------- */

export const PHONE_ERROR_MESSAGE = 'رقم الهاتف مش مكتوب صح (موبايل 11 رقم، مثال: 01012345678)';

const MOBILE = /^(?:\+?20|0)?1[0125]\d{8}$/;
const LANDLINE = /^0\d{8,10}$/;

/**
 * @param {string|null|undefined} value
 * @returns {boolean} true لو فاضي أو رقم مصري صحيح (موبايل/أرضي)
 */
export function isValidEgyptianPhone(value) {
  // أرقام عربية/فارسية ← إنجليزية، مع الإبقاء على + (نفس سلوك الموبايل).
  const raw = String(value ?? '')
    .trim()
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0));
  if (raw === '') return true;
  const digits = raw.replace(/[\s-]/g, '');
  return MOBILE.test(digits) || LANDLINE.test(digits);
}
