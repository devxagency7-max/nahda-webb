/* --------------------------------------------------------------------------
   ATTACHMENT DOCUMENT TYPES
   The API's documentType is a closed list of 8 English codes (backend reply
   2026-10-08 §7) — same names and order as the mobile app. "أخرى" is sent as
   `other`, and its free-text details go in `description`, never in the type.
   Old values (Arabic text saved before the codes) are still shown in Arabic.
   -------------------------------------------------------------------------- */

/** code -> Arabic label, in the order shown to the user. */
export const DOCUMENT_TYPES = [
  ['national_id', 'بطاقة شخصية'],
  ['family_docs', 'مستندات الأسرة'],
  ['income_docs', 'مستندات دخل'],
  ['medical_docs', 'مستندات علاج'],
  ['education_docs', 'مستندات تعليم'],
  ['housing_photos', 'صور السكن'],
  ['field_photos', 'صور ميدانية'],
  ['other', 'أخرى']
];

export const OTHER_DOCUMENT_TYPE = 'other';

const LABEL_BY_CODE = Object.fromEntries(DOCUMENT_TYPES);
const CODE_BY_LABEL = Object.fromEntries(DOCUMENT_TYPES.map(([code, label]) => [label, code]));

/** Arabic label (or an already-valid code) -> API code. Unknown text -> `other`. */
export function documentTypeCode(value) {
  const v = (value || '').trim();
  if (LABEL_BY_CODE[v]) return v;
  return CODE_BY_LABEL[v] || OTHER_DOCUMENT_TYPE;
}

/** API code (or an old Arabic value) -> Arabic text for display. */
export function documentTypeLabel(value) {
  const v = (value || '').trim();
  if (!v) return '';
  if (LABEL_BY_CODE[v]) return LABEL_BY_CODE[v];
  // An unknown English code is never shown raw to the user.
  return /[A-Za-z]/.test(v) ? LABEL_BY_CODE[OTHER_DOCUMENT_TYPE] : v;
}
