/* --------------------------------------------------------------------------
   SUPPORT CATALOG (تاب 7 — الدعم)
   القايمة الموحدة لأنواع الدعم + تصنيفها للعرض بس. التصنيف (أساسي/تعليمي/
   صحي/سكني/أخرى) عناوين تجميع في الشاشة ومابيتبعتش للباك.
   scope:
     'household' — الدعم للأسرة كلها (مابيفتحش اختيار أفراد)
     'members'   — بيفتح قايمة (رب الأسرة + الأفراد) يتعلّم منها مين أخد الدعم
   -------------------------------------------------------------------------- */

export const SUPPORT_GROUPS = [
  {
    key: 'basic',
    label: 'أساسي',
    types: [
      { name: 'كرتونة', scope: 'household' },
      { name: 'لحمة', label: 'لحوم', scope: 'household', auto: 'meat' },
      { name: 'مرشح لبنك الطعام', scope: 'household' }
    ]
  },
  {
    key: 'education',
    label: 'تعليمي',
    types: [
      { name: 'مصروفات دراسية', scope: 'members' },
      { name: 'زي مدرسي', scope: 'members' },
      { name: 'منح دراسية', scope: 'members' }
    ]
  },
  {
    key: 'health',
    label: 'صحي',
    types: [
      { name: 'عمليات', scope: 'members' },
      { name: 'سماعات', scope: 'members' },
      { name: 'علاج دوري', scope: 'members' },
      { name: 'علاج سكر', scope: 'members' },
      { name: 'علاج كبد', scope: 'members' },
      { name: 'طرف صناعي', scope: 'members' },
      { name: 'كرسي متحرك', scope: 'members' },
      { name: 'حفاضات طبية', scope: 'members' }
    ]
  },
  {
    key: 'housing',
    label: 'سكني',
    types: [
      { name: 'سقف', scope: 'household' },
      { name: 'وصلة مياه', scope: 'household' },
      { name: 'صرف', scope: 'household' },
      { name: 'مرحاض', scope: 'household' },
      { name: 'كهرباء', scope: 'household' },
      { name: 'بناء غرفة', scope: 'household' },
      { name: 'أثاث', scope: 'household' },
      { name: 'أجهزة', scope: 'household' }
    ]
  },
  {
    key: 'other',
    label: 'أخرى',
    types: [
      { name: 'تجهيز عرائس', scope: 'members' }
      // «أخرى» (اسم حر) بيتضاف في العرض — راجع support.component.js
    ]
  }
];

// أسماء قديمة / أخطاء إملائية كانت في الإكسل أو في نسخ الويب السابقة ← الاسم الموحد.
const ALIASES = {
  'لحوم': 'لحمة',
  'لحمه': 'لحمة',
  'كرتونة مواد غذائية': 'كرتونة',
  'مرشح بنك الطعام': 'مرشح لبنك الطعام',
  'جهاز عرايس': 'تجهيز عرائس',
  'تجهير عرائس': 'تجهيز عرائس',
  'علاج دورى': 'علاج دوري',
  'منحة تعلمية': 'منح دراسية',
  'كرسى متحرك عادى': 'كرسي متحرك',
  'كرسى متحرك كهرباء': 'كرسي متحرك',
  'كرسي متحرك عادي': 'كرسي متحرك',
  'كرسي متحرك كهرباء': 'كرسي متحرك',
  'حفاضات طبيه': 'حفاضات طبية',
  'سماعة': 'سماعات',
  // تفاصيل سماعات (أي ودن) مش أنواع دعم مستقلة
  'الاذنين': 'سماعات',
  'يمين': 'سماعات',
  'يسار': 'سماعات',
  'وصلة مية': 'وصلة مياه',
  'حمام': 'مرحاض',
  'صرف صحي': 'صرف',
  'بناء': 'بناء غرفة',
  'وصلة كهرباء': 'كهرباء',
  'دعم أجهزة منزلية وأثاث منزلي': 'أجهزة'
};

// بيانات تجريبية في الإكسل — بتتشال ومابتتحمّلش.
const DROPPED = new Set(['دعم تجريبى', 'دعم تجريبي']);

/** اللحمة: الكمية من عدد الأسرة (رب الأسرة + الأفراد) — 3 فأكتر كيلو، أقل نص كيلو. */
export function meatCategory(familySize) {
  return familySize >= 3 ? 'كيلو' : 'نص كيلو';
}

const KNOWN = new Set(SUPPORT_GROUPS.flatMap(g => g.types.map(t => t.name)));

/**
 * يوحّد اسم نوع الدعم القادم من السيرفر.
 * @returns {{ name: string, known: boolean, dropped: boolean }}
 */
export function canonicalSupportType(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { name: '', known: false, dropped: true };
  if (DROPPED.has(text)) return { name: text, known: false, dropped: true };
  const name = ALIASES[text] || text;
  return { name, known: KNOWN.has(name), dropped: false };
}
