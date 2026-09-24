/* --------------------------------------------------------------------------
   EGYPTIAN NATIONAL ID AUTOMATIC EXTRACTION & VALIDATION ENGINE
   Parses Egyptian 14-digit National ID numbers to extract:
   - Century & Birth Date
   - Dynamic Age (calculated from current date)
   - Birth Governorate (Arabic & English)
   - Gender (Male / Female)
   -------------------------------------------------------------------------- */

/**
 * Egyptian Governorate Codes Registry
 */
export const EGYPTIAN_GOVERNORATES = {
  '01': { ar: 'القاهرة', en: 'Cairo' },
  '02': { ar: 'الإسكندرية', en: 'Alexandria' },
  '03': { ar: 'بورسعيد', en: 'Port Said' },
  '04': { ar: 'السويس', en: 'Suez' },
  '11': { ar: 'دمياط', en: 'Damietta' },
  '12': { ar: 'الدقهلية', en: 'Dakahlia' },
  '13': { ar: 'الشرقية', en: 'Sharqia' },
  '14': { ar: 'القليوبية', en: 'Qalyubia' },
  '15': { ar: 'كفر الشيخ', en: 'Kafr El Sheikh' },
  '16': { ar: 'الغربية', en: 'Gharbia' },
  '17': { ar: 'المنوفية', en: 'Monufia' },
  '18': { ar: 'البحيرة', en: 'Beheira' },
  '19': { ar: 'الإسماعيلية', en: 'Ismailia' },
  '21': { ar: 'الجيزة', en: 'Giza' },
  '22': { ar: 'بني سويف', en: 'Beni Suef' },
  '23': { ar: 'الفيوم', en: 'Fayoum' },
  '24': { ar: 'المنيا', en: 'Minya' },
  '25': { ar: 'أسيوط', en: 'Assiut' },
  '26': { ar: 'سوهاج', en: 'Sohag' },
  '27': { ar: 'قنا', en: 'Qena' },
  '28': { ar: 'أسوان', en: 'Aswan' },
  '29': { ar: 'الأقصر', en: 'Luxor' },
  '31': { ar: 'البحر الأحمر', en: 'Red Sea' },
  '32': { ar: 'الوادي الجديد', en: 'New Valley' },
  '33': { ar: 'مطروح', en: 'Matrouh' },
  '34': { ar: 'شمال سيناء', en: 'North Sinai' },
  '35': { ar: 'جنوب سيناء', en: 'South Sinai' },
  '88': { ar: 'خارج الجمهورية', en: 'Born Outside Egypt' }
};

/**
 * Normalizes Eastern Arabic / Persian numerals (٠١٢٣٤٥٦٧٨٩) to standard English digits (0123456789)
 * @param {string|number} input 
 * @returns {string}
 */
export function normalizeNumerals(input) {
  if (input === null || input === undefined) return '';
  const str = String(input);
  const arabicNumerals = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  const persianNumerals = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

  return str
    .replace(/[٠-٩]/g, d => arabicNumerals.indexOf(d))
    .replace(/[۰-۹]/g, d => persianNumerals.indexOf(d))
    .replace(/[^\d]/g, ''); // Strip spaces, hyphens, non-numeric characters
}

/**
 * Same Eastern Arabic / Persian → English digit conversion as normalizeNumerals,
 * but keeps a single decimal point so monetary/amount fields (e.g. ١٢٥٠.٥٠)
 * survive parseFloat() correctly instead of silently becoming NaN → 0.
 * @param {string|number} input
 * @returns {string}
 */
export function normalizeDecimalNumerals(input) {
  if (input === null || input === undefined) return '';
  const str = String(input);
  const arabicNumerals = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  const persianNumerals = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

  return str
    .replace(/[٠-٩]/g, d => arabicNumerals.indexOf(d))
    .replace(/[۰-۹]/g, d => persianNumerals.indexOf(d))
    .replace(/[^\d.]/g, ''); // Strip everything except digits and decimal point
}

/**
 * parseFloat() that first normalizes Eastern Arabic / Persian numerals, so
 * amounts typed in Arabic digits parse the same as English digits.
 * @param {string|number} value
 * @returns {number}
 */
export function parseLocalizedFloat(value) {
  if (value === null || value === undefined || value === '') return NaN;
  return parseFloat(normalizeDecimalNumerals(value));
}

/**
 * Dynamically calculates completed age in years from a birth date relative to current date
 * @param {Date} birthDate 
 * @param {Date} [currentDate=new Date()] 
 * @returns {number}
 */
export function calculateAge(birthDate, currentDate = new Date()) {
  let age = currentDate.getFullYear() - birthDate.getFullYear();
  const monthDiff = currentDate.getMonth() - birthDate.getMonth();
  const dayDiff = currentDate.getDate() - birthDate.getDate();

  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age--;
  }
  return Math.max(0, age);
}

/**
 * Reusable Egyptian National ID Parser
 * @param {string|number} nationalId 
 * @returns {Object} Extraction payload or validation error
 */
export function parseEgyptianNationalId(nationalId) {
  const cleanId = normalizeNumerals(nationalId);

  // 1. Length check: Exactly 14 digits required
  if (cleanId.length !== 14) {
    return {
      valid: false,
      code: 'INVALID_LENGTH',
      error: 'الرقم القومي يجب أن يتكون من 14 رقم'
    };
  }

  // 2. Century Digit check (C): 2 = 1900s, 3 = 2000s
  const centuryDigit = cleanId.charAt(0);
  if (centuryDigit !== '2' && centuryDigit !== '3') {
    return {
      valid: false,
      code: 'INVALID_CENTURY',
      error: 'الرقم القومي غير صحيح'
    };
  }

  const centuryYear = centuryDigit === '2' ? 1900 : 2000;
  const yearTwoDigits = parseInt(cleanId.substr(1, 2), 10);
  const month = parseInt(cleanId.substr(3, 2), 10);
  const day = parseInt(cleanId.substr(5, 2), 10);
  const fullYear = centuryYear + yearTwoDigits;

  // 3. Month & Day Boundary Checks
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return {
      valid: false,
      code: 'INVALID_DATE_BOUNDS',
      error: 'الرقم القومي غير صحيح'
    };
  }

  // 4. Calendar Date Validity Check (e.g. Feb 30 or Feb 29 on non-leap year)
  const birthDate = new Date(fullYear, month - 1, day);
  if (
    birthDate.getFullYear() !== fullYear ||
    birthDate.getMonth() !== month - 1 ||
    birthDate.getDate() !== day
  ) {
    return {
      valid: false,
      code: 'INVALID_CALENDAR_DATE',
      error: 'الرقم القومي غير صحيح'
    };
  }

  // 5. Future Birth Date Check
  const now = new Date();
  if (birthDate > now) {
    return {
      valid: false,
      code: 'FUTURE_BIRTH_DATE',
      error: 'الرقم القومي غير صحيح'
    };
  }

  // 6. Governorate Code Check (Digits 8 & 9)
  const governorateCode = cleanId.substr(7, 2);
  const governorateObj = EGYPTIAN_GOVERNORATES[governorateCode];
  if (!governorateObj) {
    return {
      valid: false,
      code: 'INVALID_GOVERNORATE_CODE',
      error: 'الرقم القومي غير صحيح'
    };
  }

  // 7. Gender Extraction (Digit 13)
  const genderDigit = parseInt(cleanId.charAt(12), 10);
  const isMale = genderDigit % 2 !== 0;

  // 8. Calculate Dynamic Age
  const age = calculateAge(birthDate, now);

  // Format Birth Date YYYY-MM-DD
  const formattedMonth = String(month).padStart(2, '0');
  const formattedDay = String(day).padStart(2, '0');
  const birthDateString = `${fullYear}-${formattedMonth}-${formattedDay}`;

  return {
    valid: true,
    cleanId,
    birthDate: birthDateString,
    age,
    governorateCode,
    governorateAr: governorateObj.ar,
    governorateEn: governorateObj.en,
    genderCode: isMale ? 'male' : 'female',
    genderAr: isMale ? 'ذكر' : 'أنثى',
    genderEn: isMale ? 'Male' : 'Female'
  };
}
