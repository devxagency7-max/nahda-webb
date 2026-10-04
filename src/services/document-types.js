/* --------------------------------------------------------------------------
   ATTACHMENT DOCUMENT TYPES
   The #case-doc-type <select> shows Arabic labels, but the API's documentType
   is a closed vocabulary of English keys. Only the keys the API documentation
   actually shows (FRONTEND_COMPLETE_GUIDE.md §19.8) are mapped here; any other
   label is sent as-is until the backend publishes the full list — add new
   pairs below once it does, nothing else needs to change.
   -------------------------------------------------------------------------- */
const CODE_BY_LABEL = {
  'بطاقة شخصية': 'national_id',
  'أخرى': 'other'
};

const LABEL_BY_CODE = Object.fromEntries(
  Object.entries(CODE_BY_LABEL).map(([label, code]) => [code, label])
);

/** Arabic select label -> API key (unmapped labels pass through unchanged). */
export function documentTypeCode(label) {
  return CODE_BY_LABEL[label] || label;
}

/** API key (or an old Arabic value) -> Arabic text for display. */
export function documentTypeLabel(value) {
  return LABEL_BY_CODE[value] || value || '';
}
