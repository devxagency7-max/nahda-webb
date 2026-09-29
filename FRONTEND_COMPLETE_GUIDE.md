# دليل الفرونت إند الشامل — نظام إدارة الحالات (مؤسسة النهضة ببني سويف)

**Nahda Case Management — Complete Frontend Guide (Web + Flutter mobile)** · generated 2026-09-25 from the running code, the OpenAPI document and real recorded calls. Backend commit on branch `hardening/production-2026-09`.

> **الملف ده هو المرجع الوحيد.** فيه كل حاجة الفرونت إند محتاجها: الويب والموبايل، كل الـ endpoints بأمثلة request و response حقيقية، الصلاحيات، الأخطاء، سير العمل، بيانات الإكسيل القديمة، والتغييرات المطلوبة منكم. لو فيه أي تعارض بين الملف ده وملف قديم (`WEB_API_DOCUMENTATION.md`, `FLUTTER_API_DOCUMENTATION.md`, `docs/FRONTEND_REPORTING_HANDOFF.md`) — **الملف ده هو الصح.**

> **Postman:** `postman/Nahda_API.postman_collection.json` + `postman/Nahda_Production.postman_environment.json` (§21).

## المحتويات
- 1. البيئات والروابط
- 2. البداية السريعة
- 3. قواعد عامة (الشكل الموحد للردود، التواريخ، null، الترقيم)
- 4. تسجيل الدخول والتوكن (ويب + موبايل)
- 5. الأدوار والصلاحيات
- 6. الأخطاء — كل الأكواد
- 7. حدود عدد الطلبات (Rate limits)
- 8. التعارض (rowVersion) ومنع التكرار (Idempotency-Key)
- 9. دورة حياة الحالة وسير العمل
- 10. أقسام الحالة (Case sections)
- 11. الحسابات المالية
- 12. بيانات الإكسيل القديمة (215 عمود)
- 13. رفع الملفات (المرفقات والصورة الشخصية)
- 14. الموبايل (الأخصائي الاجتماعي)
- 15. البحث، لوحة المتابعة، الإشعارات، الملف الشخصي
- 16. التقارير ولوحات التقارير
- 17. الإدارة (الموظفين، الجمعيات، المواقع، القوائم)
- 18. القوائم المنسدلة (القيم المسموحة)
- 19. مرجع كل الـ Endpoints (بالأمثلة)
- 20. المطلوب من الفرونت إند (Checklist)
- 21. استخدام Postman
- 22. سجل التغييرات الأخيرة

## 1. البيئات والروابط

| البيئة | الرابط | ملاحظات |
|---|---|---|
| **Production** | `https://srv1990155.hstgr.cloud` | HTTPS (Let's Encrypt, تجديد تلقائي) + HSTS. **استخدموا ده بس.** |
| القديم (HTTP) | `http://187.77.70.246` | لسه شغال مؤقتاً لحد ما كل العملاء يتحولوا، وبعدها هيتحوّل تلقائياً لـ HTTPS. **ماتستخدموهوش.** |

- كل الـ endpoints تحت `/api/v1` (فيما عدا `/health/live` و `/health/ready`).
- **CORS:** حالياً الـ origin المسموح بس `http://187.77.70.246`. **ابعتوا لفريق الباك إند الـ origin بتاع الويب (scheme + host + port)** عشان يتضاف، وإلا المتصفح هيمنع الطلبات.
- الـ Swagger UI مش متاح على الإنتاج (Development بس) — الملف ده والـ Postman بيغطوه بالكامل.
- الـ responses بتتضغط gzip لو بعتوا `Accept-Encoding: gzip` (المتصفح والـ Dart http بيعملوا ده تلقائياً).

## 2. البداية السريعة

```http
POST https://srv1990155.hstgr.cloud/api/v1/auth/login
Content-Type: application/json
X-Client-Type: web            # موبايل: mobile

{ "email": "user@example.com", "password": "••••••" }
```

1. خدوا `data.accessToken` و `data.refreshToken` من الرد.
2. ابعتوا في كل طلب: `Authorization: Bearer <accessToken>` و `X-Client-Type: web|mobile`.
3. لما الـ access token يخلص (15 دقيقة) → `POST /api/v1/auth/refresh` **مرة واحدة بس** (§4).
4. صلاحيات المستخدم في `data.user.permissions` — اخفوا أي شاشة/زرار مش في الصلاحيات.
5. في صفحة الحالة: `GET /api/v1/cases/{id}` بيرجع **كل الأقسام في طلب واحد** + `workflow.availableActions` (الأزرار اللي تظهر).

## 3. قواعد عامة

**الشكل الموحد لكل رد (envelope):**
```json
{ "success": true,  "data": { … }, "message": null }
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "رسالة عربية جاهزة للعرض", "details": { "fieldName": ["سبب"] } } }
```
- `error.message` عربي وجاهز للعرض للمستخدم. `error.details` موجود في أخطاء الـ validation بس (اسم الحقل → الأسباب).
- **الترقيم (pagination):** `?page=1&limit=20` (limit أقصاه 100). الرد: `{ items, page, limit, total, totalPages, hasNext, hasPrev }`.
- **التواريخ:** التاريخ بس `yyyy-MM-dd` (مثلاً `registrationDate`, `birthDate`, `visitDate`). التاريخ والوقت ISO 8601 بـ UTC (`createdAtUtc: "2026-09-25T02:06:29.123+00:00"`) — اعرضوه بتوقيت مصر.
- **null:** الحقل الفاضي بيرجع `null` (عمره ما بيرجع `""`). في الـ **requests** للحقول الجديدة (§10): `null` أو عدم الإرسال = **سيب القيمة القديمة**، `""` = **امسحها**.
- **الـ IDs:** كلها UUID (string). الأرقام العشرية (المبالغ) بترجع number.
- **النصوص العربية الطويلة** (التقارير، الملاحظات، وصف السكن): **مفيش حد أقصى** — اتحفظت واترجعت كاملة. اعرضوها multi-line وماتقصوهاش عند الحفظ.
- **الجنس:** المستفيد `male`/`female` (محسوب من الرقم القومي، للقراءة بس). أفراد الأسرة `ذكر`/`أنثى` (قيم القائمة المنسدلة).

## 4. تسجيل الدخول والتوكن

| البند | القيمة |
|---|---|
| Access token | JWT (RS256)، مدته **15 دقيقة** |
| Refresh token | مدته **7 أيام**، **بيتغير مع كل refresh** (rotation) |
| `X-Client-Type` | مطلوب في login/refresh/logout: `web` أو `mobile` (غير كده → 422) |
| قفل الحساب بعد محاولات خاطئة | **مفيش** (اتشال 2026-09-25). كلمة السر الغلط بترجع دايماً `401 INVALID_CREDENTIALS`، والصح بيشتغل دايماً |
| حد لعدد محاولات الدخول | **مفيش** على `/auth/login`. (`/auth/refresh` و `/auth/logout`: 20/دقيقة/IP) |

**قفل المنصة (Platform lock) — بيتفحص في السيرفر:**

| الدور | يدخل من |
|---|---|
| `social_worker` (أخصائي اجتماعي) | **الموبايل بس** (`X-Client-Type: mobile`). من الويب → `403 SOCIAL_WORKER_WEB_BLOCKED` |
| `manager`, `reviewer`, `data_entry` | **الويب بس**. من الموبايل → `403 PLATFORM_NOT_ALLOWED` |

### ⚠️ Refresh مرة واحدة بس (single-flight) — مهم جداً
حماية إعادة الاستخدام شغالة: لو نفس الـ refresh token اتبعت مرتين (مثلاً طلبين فشلوا بـ 401 في نفس الوقت وكل واحد عمل refresh) **السيرفر بيلغي الجلسة كلها** والمستخدم بيخرج. لازم يبقى فيه refresh واحد في نفس الوقت، والطلبات التانية تستناه:

```ts
// Web (TypeScript) — single-flight refresh
let refreshing: Promise<string> | null = null;
async function getFreshAccessToken(): Promise<string> {
  if (!refreshing) {
    refreshing = fetch(`${BASE}/api/v1/auth/refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'web' },
      body: JSON.stringify({ refreshToken: store.refreshToken }),
    }).then(async r => {
      if (!r.ok) { store.logout(); throw new Error('session ended'); }   // TOKEN_REVOKED / TOKEN_EXPIRED / TOKEN_INVALID
      const { data } = await r.json();
      store.save(data.accessToken, data.refreshToken);                  // the refresh token CHANGES every time
      return data.accessToken;
    }).finally(() => { refreshing = null; });
  }
  return refreshing;
}
// On any 401 from a normal request: token = await getFreshAccessToken(); retry that request ONCE.
```

```dart
// Flutter (Dart) — same idea
Completer<String>? _refreshing;
Future<String> freshToken() async {
  if (_refreshing != null) return _refreshing!.future;
  _refreshing = Completer<String>();
  try {
    final r = await http.post(Uri.parse('$base/api/v1/auth/refresh'),
        headers: {'Content-Type': 'application/json', 'X-Client-Type': 'mobile'},
        body: jsonEncode({'refreshToken': await storage.read(key: 'refresh')}));
    if (r.statusCode != 200) { await logout(); throw Exception('session ended'); }
    final d = jsonDecode(r.body)['data'];
    await storage.write(key: 'access', value: d['accessToken']);
    await storage.write(key: 'refresh', value: d['refreshToken']);
    _refreshing!.complete(d['accessToken']);
    return d['accessToken'];
  } catch (e) { _refreshing!.completeError(e); rethrow; } finally { _refreshing = null; }
}
```

- خزنوا التوكنات في مكان آمن (موبايل: `flutter_secure_storage`؛ ويب: memory + refresh token في storage آمن).
- Logout: `POST /auth/logout` بالـ refresh token، وبعدين امسحوا التوكنات محلياً.
- `GET /auth/me` بيرجع المستخدم الحالي وصلاحياته (استخدموه بعد فتح التطبيق).

## 5. الأدوار والصلاحيات

| الصلاحية | manager (مدير التنمية) | reviewer (مراجع) | data_entry (مدخل بيانات) | social_worker (أخصائي) |
|---|---|---|---|---|
| `create_case` | ✅ | ✅ | ✅ | ✅ |
| `view_cases` | ✅ | ✅ | ✅ | ✅ |
| `edit_case` | ✅ | — | ✅ | ✅ |
| `manage_charities` | ✅ | ✅ | ✅ | — |
| `manage_locations` | — | — | ✅ | — |
| `view_opinions` | ✅ | ✅ | ✅ | ✅ |
| `write_reviewer_opinion` | — | ✅ | — | — |
| `write_manager_approval` | ✅ | — | — | — |
| `view_employees` | ✅ | — | — | — |
| `manage_employees` | ✅ | — | — | — |
| `write_worker_opinion` | — | — | — | ✅ |
| `accept_reject_assignment` | — | — | — | ✅ |
| `manage_configurations` | — | — | ✅ | — |
| `view_reports` | ✅ | ✅ | ✅ | ✅ |
| `view_financial_reports` | ✅ | ✅ | — | — |
| `export_reports` | ✅ | ✅ | — | — |

- القائمة دي بترجع في `user.permissions` من login و `/auth/me` — **اعتمدوا عليها** في إظهار/إخفاء الشاشات والأزرار (مش على اسم الدور).
- أزرار سير العمل: اعتمدوا على `workflow.availableActions` في تفاصيل الحالة (§9) — السيرفر بيحسبها حسب الدور والحالة والمسند إليه.
- كل المستخدمين بيشوفوا كل الحالات (قرار منتج). حالة مش موجودة أو مش مسموحة → `404 CASE_NOT_FOUND` (مش 403).
- الـ `403` معناه الدور مش مسموح له — **ماتعملوش retry ولا refresh**.

## 6. الأخطاء — كل الأكواد

| HTTP | `error.code` | المعنى | تعملوا إيه |
|---|---|---|---|
| 400/422 | VALIDATION_ERROR | بيانات غلط؛ `details` فيها الحقول | اعرضوا الرسالة جنب كل حقل من `details` |
| 401 | UNAUTHORIZED | مفيش توكن أو توكن غلط | refresh مرة واحدة، ولو فشل → شاشة الدخول |
| 401 | INVALID_CREDENTIALS | إيميل/كلمة سر غلط (رسالة واحدة للحالتين) | اعرضوا الرسالة؛ مفيش قفل |
| 401 | TOKEN_EXPIRED / TOKEN_INVALID / TOKEN_REVOKED | الـ refresh token انتهى/غلط/اتلغى (إعادة استخدام) | خروج → شاشة الدخول |
| 403 | FORBIDDEN | الدور مش مسموح له | اخفوا الزرار؛ ماتعيدوش |
| 403 | PLATFORM_NOT_ALLOWED | دور ويب بيحاول من الموبايل | رسالة: استخدم الويب |
| 403 | SOCIAL_WORKER_WEB_BLOCKED | أخصائي بيحاول من الويب | رسالة: استخدم تطبيق الموبايل |
| 404 | NOT_FOUND / CASE_NOT_FOUND | مش موجود أو مش مسموح تشوفه | رجوع للقائمة |
| 409 | CONCURRENCY_CONFLICT | حد تاني عدّل نفس البيانات (rowVersion قديم) | اعملوا GET تاني واعرضوا البيانات الجديدة للمستخدم |
| 409 | DUPLICATE_NATIONAL_ID | الرقم القومي مسجل في حالة تانية | اعرضوا الرسالة |
| 409 | DUPLICATE_RESOURCE | اسم مكرر (مركز/قرية/جمعية/إيميل) | اعرضوا الرسالة |
| 409 | DELETE_CONFLICT | مينفعش يتحذف لأن عليه بيانات | اعرضوا الرسالة |
| 409 | IDEMPOTENCY_KEY_REUSE | نفس Idempotency-Key مع طلب مختلف أو لسه شغال | مفتاح جديد لكل ضغطة |
| 400/422 | IDEMPOTENCY_KEY_REQUIRED | طلب سير عمل من غير Idempotency-Key | ابعتوا الهيدر (§8) |
| 422 | INVALID_STATUS_TRANSITION | الإجراء مش مسموح في الحالة دي | حدّثوا الحالة وأزرار availableActions |
| 422 | OPINION_SLOT_LOCKED | الرأي اتقدم خلاص | حدّثوا الصفحة |
| 422 | MISSING_WORKER_OPINION | مفيش رأي أخصائي | — |
| 422 | CASE_ALREADY_APPROVED | الحالة معتمدة | — |
| 413/422 | FILE_TOO_LARGE | الملف كبير | اعرضوا الحد المسموح |
| 422 | UNSUPPORTED_FILE_TYPE | نوع ملف مش مسموح | اعرضوا الأنواع المسموحة |
| 503 | STORAGE_UNAVAILABLE | خدمة الملفات مش متاحة | حاولوا بعدين |
| 429 | RATE_LIMITED | طلبات كتير | استنوا 60 ثانية مع backoff |
| 500 | INTERNAL_ERROR | خطأ في السيرفر | رسالة عامة + ابعتوا `X-Correlation-Id` للباك إند |
| 423 | ACCOUNT_LOCKED | **مش بيحصل تاني** (القفل اتشال) | شيلوا أي كود بيتعامل معاه |

- كل رد فيه هيدر `X-Correlation-Id` — ابعتوه مع أي بلاغ عن مشكلة.

## 7. حدود عدد الطلبات

| النطاق | الحد | على |
|---|---|---|
| أي طلب بمستخدم مسجل | 600 / دقيقة / مستخدم | كل حاجة |
| البحث | 180 / دقيقة / مستخدم | `/search/**` |
| لوحة المتابعة والتقارير | 240 / دقيقة / مستخدم | `/dashboard/**`, `/reports/**` |
| رفع الملفات | 30 / دقيقة / مستخدم | `POST /attachments/init`, `POST /profile/avatar/init` |
| Auth | 20 / دقيقة / IP | `/auth/refresh`, `/auth/logout` |
| **Login** | **مفيش حد** | `/auth/login` |
| بدون تسجيل | 100 / دقيقة / IP | health وغيرها |

- اعملوا debounce للبحث 400ms وأقل حاجة حرفين. ماتعملوش polling للوحة المتابعة أكتر من مرة كل 60 ثانية وبس لو الصفحة ظاهرة.

## 8. التعارض (rowVersion) ومنع التكرار (Idempotency-Key)

**rowVersion:** أي تعديل بيتبعت بآخر `rowVersion` أو `caseRowVersion` قريتوه. لو حد تاني عدّل قبلكم → `409 CONCURRENCY_CONFLICT`: اعملوا GET تاني واعرضوا للمستخدم البيانات الجديدة. **ماتعيدوش الطلب أوتوماتيك.**

| القسم | الحقل اللي بيتبعت | منين تجيبوه |
|---|---|---|
| الأقسام اللي هي قوائم (الأسرة، الأجهزة، الاحتياجات، المالي، الدعم المقترح، سجل الدعم، التحقق الميداني) وكل إجراءات سير العمل | `caseRowVersion` | `rowVersion` بتاع الحالة في `GET /cases/{id}` (أو `caseRowVersion` في رد آخر تعديل) |
| المستفيد | `rowVersion` | `beneficiary.rowVersion` |
| السكن، الزراعة، التصنيف، الدعم المعتمد | `rowVersion` (null لأول حفظ بس) | `housing.rowVersion` … إلخ |
| الجمعية، الموظف، الملف الشخصي، زيارة ميدانية | `rowVersion` | من الـ GET بتاعهم |

بعد كل حفظ ناجح استخدموا الـ `rowVersion`/`caseRowVersion` الجديد اللي في الرد للحفظ اللي بعده.

**Idempotency-Key** (UUID جديد لكل ضغطة من المستخدم) **مطلوب** في: `POST /attachments/{id}/commit`, `POST /cases/{caseId}/accept`, `POST /cases/{caseId}/assign`, `POST /cases/{caseId}/field-visits`, `POST /cases/{caseId}/opinions/manager`, `POST /cases/{caseId}/opinions/reviewer`, `POST /cases/{caseId}/opinions/worker`, `POST /cases/{caseId}/reject-assignment`, `POST /cases/{caseId}/return-for-completion`, `POST /cases/{caseId}/return-to-worker`, `PUT /field-visits/{id}`.
لو الطلب اتعاد بنفس المفتاح بعد ما خلص → السيرفر بيرجع نفس الرد المحفوظ (مفيش تكرار). لو اتبعت مرتين في نفس اللحظة → التاني `409`. في الـ retry بعد انقطاع النت استخدموا **نفس** المفتاح.

## 9. دورة حياة الحالة وسير العمل

**الحالات (`status`):** `draft` (مسودة) · `pending_assignment` (قيد الانتظار) · `assigned` (مسندة) · `in_research` (قيد البحث) · `pending_review` (بانتظار المراجعة) · `returned_to_worker` (معادة للأخصائي) · `pending_approval` (بانتظار الاعتماد) · `approved` (معتمدة) · `rejected` (مرفوضة).

```
draft / pending_assignment ──assign──▶ assigned ──accept──▶ in_research ──worker opinion──▶ pending_review
pending_assignment ──accept (self)──▶ in_research          assigned ──reject-assignment──▶ pending_assignment
pending_review ──reviewer opinion (isSubmitted=true)──▶ pending_approval      pending_review ──return-to-worker──▶ returned_to_worker
pending_approval ──return-for-completion──▶ returned_to_worker               returned_to_worker ──worker opinion──▶ pending_review
any (not final) ──manager approve / reject──▶ approved / rejected
```

| الإجراء (`availableActions`) | Endpoint | الدور | من | إلى |
|---|---|---|---|---|
| assign | POST /cases/{id}/assign | data_entry, manager, reviewer | draft, pending_assignment, returned_to_worker (بدون مسند إليه) | assigned |
| accept_assignment | POST /cases/{id}/accept | social_worker (المسند إليه) · موبايل | assigned، أو pending_assignment (قبول ذاتي) | in_research |
| reject_assignment | POST /cases/{id}/reject-assignment | social_worker (المسند إليه) · موبايل | assigned | pending_assignment |
| submit_worker_opinion | POST /cases/{id}/opinions/worker | social_worker (المسند إليه) · موبايل | in_research, returned_to_worker — **لازم اكتمال 100%** | pending_review |
| save_reviewer_draft | POST /cases/{id}/opinions/reviewer (`isSubmitted:false`) | reviewer | pending_review | (نفس الحالة) |
| submit_reviewer_opinion | POST /cases/{id}/opinions/reviewer (`isSubmitted:true`) | reviewer | pending_review | pending_approval |
| return_to_worker | POST /cases/{id}/return-to-worker | reviewer | pending_review | returned_to_worker |
| approve / reject | POST /cases/{id}/opinions/manager (`approve:true/false`) | manager | أي حالة مش نهائية | approved / rejected |
| return_for_completion | POST /cases/{id}/return-for-completion | manager | pending_approval | returned_to_worker |

- **اعتمدوا على `workflow.availableActions`** في `GET /cases/{id}` لإظهار الأزرار — هو hint، والسيرفر بيتأكد تاني (ممكن `409`/`422` لو حد سبقكم).
- **اكتمال الحالة:** `completion.percentage` و `completion.isReady` (أو `GET /cases/{id}/completion`). رأي الأخصائي مش بيتقبل غير لما تبقى 100%.
- **الإرجاع:** `returnInfo` في التفاصيل فيه مين رجّع وليه — اعرضوه للأخصائي.
- **الآراء:** `opinions.worker/reviewer/manager` — القيم: worker/reviewer `accepted`/`rejected` (الإرجاع `returned_to_worker`)؛ manager `approved`/`rejected`. الخانة اللي مفيهاش قرار = `null`.
- حالة `returned_to_worker` من غير مسند إليه (حالات قديمة) بتظهر فيها `assign`.

## 10. أقسام الحالة

`GET /api/v1/cases/{id}` بيرجع كل ده في طلب واحد: `beneficiary, completion, workflow, returnInfo, familyMembers, housing, utilities, agriculture, financial, initialNeeds, classification, assessedNeeds, opinions`. **ماتعملوش طلبات منفصلة لنفس الحاجات.** `/support` و `/attachments` و `/legacy-record` و `/field-visits` اطلبوهم لما التاب بتاعهم يتفتح بس.

| القسم | القراءة | الحفظ (الصلاحية) | نوعه | ملاحظات |
|---|---|---|---|---|
| المستفيد | `beneficiary` | `PUT /cases/{id}/beneficiary` (edit_case) | تعديل | `rowVersion` المستفيد. الرقم القومي والجنس للقراءة بس |
| أفراد الأسرة | `familyMembers.members[]` | `PUT /cases/{id}/family-members` | استبدال كامل | ابعتوا القائمة كلها. `birthDate`, `phone` جداد (null = سيب القديم، "" = امسح) |
| السكن | `housing` | `PUT /cases/{id}/housing` | upsert | `bathroomType` جديد؛ `description` نص طويل بلا حد |
| المرافق والأجهزة | `utilities.appliances[]`, `utilities.utilities[]` | `PUT /cases/{id}/utilities` | استبدال كامل | `appliances[].details` جديد (نوع الجهاز: هاف، شاشة…). مفاتيح الأجهزة: `fridge, washer, oven, cookingAppliances, computer, tv, freezer` |
| الزراعة والماشية | `agriculture` | `PUT /cases/{id}/agriculture` | upsert | `hasLand`/`hasLivestock`: `yes`/`no`/`unanswered`؛ `landType`: `تمليك` (دخل ÷12) أو `إيجار` (مصروف) |
| الاحتياجات المبدئية | `initialNeeds.needs[]` | `PUT /cases/{id}/initial-needs` | استبدال كامل |  |
| التصنيف الاجتماعي | `classification` | `PUT /cases/{id}/classification` | upsert | `mainClassifications` array |
| الاحتياجات المقيّمة | `assessedNeeds.needs[]` | `PUT /cases/{id}/assessed-needs` | استبدال كامل | القديمة من الإكسيل: priority `غير محدد`, source `البحث الميداني (السجل القديم)`, status `مسجل` |
| المالي | `financial` | `PUT /cases/{id}/financial` | استبدال كامل | §11 |
| الدعم المقترح | `GET /cases/{id}/support` → `recommendations` | `PUT /cases/{id}/support-recommendations` | استبدال كامل |  |
| **سجل الدعم المصروف (جديد)** | `GET /cases/{id}/support` → `history` | `PUT /cases/{id}/support-history` | استبدال كامل | `recipientType`: `head`/`family_member`؛ `quantity ≥ 1`؛ `amount` اختياري؛ `source`: `legacy_import`/`manual`. ابعتوا `id` للعنصر الموجود عشان يحتفظ بمصدره |
| الدعم المعتمد | `GET /cases/{id}/support` → `approved` | `PUT /cases/{id}/approved-support` (write_manager_approval) | upsert | المدير بس |
| **السجل الأصلي (جديد)** | `GET /cases/{id}/legacy-record` | — (قراءة بس) | — | كل خانات صف الإكسيل الأصلي كما هي. `available:false` للحالات الجديدة |
| المرفقات | `GET /cases/{id}/attachments` | §13 |  |  |
| الزيارات والتحقق الميداني | `GET /cases/{id}/field-visits`, `/field-verification` | §14 (موبايل) |  |  |

**استبدال كامل** = ابعتوا القائمة كلها بعد التعديل؛ أي عنصر مش في القائمة بيتمسح. **upsert** = أول حفظ `rowVersion: null`، وبعد كده لازم الـ rowVersion.

## 11. الحسابات المالية

السيرفر هو اللي بيحسب كل الإجماليات — **ماتحسبوش في الفرونت**، اعرضوا اللي راجع.

- **بنود تلقائية (`isAuto: true`، للقراءة بس):** دخل رب الأسرة (= `beneficiary.monthlyIncome`)، تكافل وكرامة (= المستفيد + الأفراد المستفيدين)، دخل الأرض الزراعية (تمليك: الدخل السنوي ÷ 12)، إيجار الأراضي الزراعية (إيجار: مصروف).
- **بنود الدخل اليدوية:** أي `label` (مثلاً `معاش`, `دخل الزوج/الزوجة`, `مساعدات`).
- **المصروفات:** الـ 5 الثابتة **لازم** تتبعت كلها (حتى لو 0): `الأكل والشرب`, `المصروفات الدراسية`, `الكهرباء، المياه، الغاز`, `الإيجار`, `القسط`.
- **مصروفات اختيارية (جديد):** `العلاج الشهري`, `مصروفات أخرى`. لو ماتبعتتش → **القيمة المحفوظة بتفضل زي ما هي**. عشان تمسحوها ابعتوها بـ `amount: 0`. أي category تانية → 422.
- الرد: `totalIncome, totalExpenses, netBalance, incomePerMember, classification` (`severe_deficit` / `critical_subsistence` / `relatively_stable`).

## 12. بيانات الإكسيل القديمة (215 عمود)

الـ 15,251 حالة القديمة اتنقلت من `الحالات_كاملة.xlsx`. **192 عمود من 215 في حقول حقيقية، و23 جزئي، و0 ضايع.** أي خانة من الملف الأصلي موجودة حرفياً في `GET /cases/{id}/legacy-record` (اعرضوها في تاب "السجل الأصلي" قابل للطي). اتعملت مطابقة لـ 20 حالة عشوائية (الإكسيل ⇄ قاعدة البيانات ⇄ الـ API) على الإنتاج: **20/20 بدون أي اختلاف**.

### 12.1 كل الـ 215 عمود — فين في النظام

| # | Excel column | Non-empty rows | Status | Where it is in the system |
|---|---|---|---|---|
| 0 | رقم الحالة | 15,251 | FULLY_AVAILABLE_IN_SYSTEM | cases.legacy_import_data_json (read-only reference) + legacy record |
| 1 | كود الحالة | 15,251 | FULLY_AVAILABLE_IN_SYSTEM | cases.legacy_import_data_json (read-only reference) + legacy record |
| 2 | اسم رب الأسرة | 15,251 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 3 | الرقم القومي | 15,249 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED (transformed)) |
| 4 | النوع | 15,236 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED (transformed)) |
| 5 | تاريخ الميلاد | 15,236 | PARTIALLY_AVAILABLE | cases.legacy_import_data_json + legacy record (read-only; no structured field) |
| 6 | السن | 15,236 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 7 | الديانة | 15,039 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 8 | الهاتف | 14,794 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 9 | هاتف 2 | 51 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 10 | المهنة | 11,025 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 11 | الراتب | 15,251 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 12 | صافي الدخل | 15,251 | PARTIALLY_AVAILABLE | cases.legacy_import_data_json + legacy record (read-only; no structured field) |
| 13 | المركز | 15,227 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED (transformed)) |
| 14 | القرية | 15,157 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED (transformed)) |
| 15 | العنوان | 519 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 16 | الجمعية | 15,216 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED (transformed)) |
| 17 | الباحث | 11,920 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED (transformed)) |
| 18 | تاريخ البحث | 15,250 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED (transformed)) |
| 19 | مرحلة الحالة | 15,251 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED (transformed)) |
| 20 | مغلقة | 15,251 | PARTIALLY_AVAILABLE | cases.legacy_import_data_json + legacy record (read-only; no structured field) |
| 21 | التصنيف | 2,862 | PARTIALLY_AVAILABLE | cases.legacy_import_data_json + legacy record (read-only; no structured field) |
| 22 | رأي الأخصائي | 15,227 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED (transformed)) |
| 23 | إفادة الأخصائي | 11,126 | PARTIALLY_AVAILABLE | case_opinions.notes when the slot has a decision; else legacy record (67/6/8 rows) |
| 24 | رأي المراجع | 14,812 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED (transformed)) |
| 25 | إفادة المراجع | 7,792 | PARTIALLY_AVAILABLE | case_opinions.notes when the slot has a decision; else legacy record (67/6/8 rows) |
| 26 | رأي مدير التنمية | 14,783 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED (transformed)) |
| 27 | ملاحظات مدير التنمية | 3,135 | PARTIALLY_AVAILABLE | case_opinions.notes when the slot has a decision; else legacy record (67/6/8 rows) |
| 28 | الزوج/الزوجة - الاسم | 10,763 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 29 | الزوج/الزوجة - الرقم القومي | 8,918 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 30 | الزوج/الزوجة - الصفة | 10,763 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED (transformed)) |
| 31 | الزوج/الزوجة - النوع | 8,912 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 32 | الزوج/الزوجة - تاريخ الميلاد | 8,912 | FULLY_AVAILABLE_IN_SYSTEM | family_members.birth_date (spouse row, sort_order 0) |
| 33 | الزوج/الزوجة - السن | 8,912 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 34 | الزوج/الزوجة - المهنة | 3,492 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 35 | الزوج/الزوجة - الدخل الشهري | 10,762 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 36 | الزوج/الزوجة - التعليم | 6,805 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 37 | الزوج/الزوجة - الهاتف | 1,142 | FULLY_AVAILABLE_IN_SYSTEM | family_members.phone (spouse row) |
| 38 | عدد الأبناء (ذكور) | 15,251 | FULLY_AVAILABLE_IN_SYSTEM | derived from family_members (verified equal in 15,251/15,251 rows) |
| 39 | عدد البنات | 15,251 | FULLY_AVAILABLE_IN_SYSTEM | derived from family_members (verified equal in 15,251/15,251 rows) |
| 40 | عدد الأحفاد | 15,251 | FULLY_AVAILABLE_IN_SYSTEM | derived from family_members (verified equal in 15,251/15,251 rows) |
| 41 | عدد الأقارب الآخرين | 15,251 | FULLY_AVAILABLE_IN_SYSTEM | derived from family_members (verified equal in 15,251/15,251 rows) |
| 42 | عدد الطلاب | 15,251 | FULLY_AVAILABLE_IN_SYSTEM | derived from family_members (verified equal in 15,251/15,251 rows) |
| 43 | إجمالي أفراد الأسرة | 15,251 | FULLY_AVAILABLE_IN_SYSTEM | derived from family_members (verified equal in 15,251/15,251 rows) |
| 44 | فرد 1 - الاسم | 11,794 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 45 | فرد 1 - الرقم القومي | 11,793 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 46 | فرد 1 - الصفة | 11,785 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 47 | فرد 1 - النوع | 11,788 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 48 | فرد 1 - تاريخ الميلاد | 11,788 | FULLY_AVAILABLE_IN_SYSTEM | family_members.birth_date (member row, sort_order 1) |
| 49 | فرد 1 - السن | 11,788 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 50 | فرد 1 - طالب | 11,794 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED (transformed)) |
| 51 | فرد 1 - التعليم | 8,806 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 52 | فرد 1 - نوع التعليم | 9,147 | PARTIALLY_AVAILABLE | family_members.notes for students; legacy record otherwise |
| 53 | فرد 1 - المرحلة الدراسية | 8,506 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 54 | فرد 1 - الصف الدراسي | 8,503 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 55 | فرد 1 - الدخل الشهري | 11,794 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 56 | فرد 1 - الدعم المصروف له | 3,080 | FULLY_AVAILABLE_IN_SYSTEM | case_support_history (recipient = the member) |
| 57 | فرد 2 - الاسم | 10,568 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 58 | فرد 2 - الرقم القومي | 10,567 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 59 | فرد 2 - الصفة | 10,553 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 60 | فرد 2 - النوع | 10,565 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 61 | فرد 2 - تاريخ الميلاد | 10,565 | FULLY_AVAILABLE_IN_SYSTEM | family_members.birth_date (member row, sort_order 2) |
| 62 | فرد 2 - السن | 10,565 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 63 | فرد 2 - طالب | 10,568 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED (transformed)) |
| 64 | فرد 2 - التعليم | 9,133 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 65 | فرد 2 - نوع التعليم | 9,254 | PARTIALLY_AVAILABLE | family_members.notes for students; legacy record otherwise |
| 66 | فرد 2 - المرحلة الدراسية | 8,868 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 67 | فرد 2 - الصف الدراسي | 8,867 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 68 | فرد 2 - الدخل الشهري | 10,568 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 69 | فرد 2 - الدعم المصروف له | 3,251 | FULLY_AVAILABLE_IN_SYSTEM | case_support_history (recipient = the member) |
| 70 | فرد 3 - الاسم | 7,510 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 71 | فرد 3 - الرقم القومي | 7,506 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 72 | فرد 3 - الصفة | 7,492 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 73 | فرد 3 - النوع | 7,506 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 74 | فرد 3 - تاريخ الميلاد | 7,506 | FULLY_AVAILABLE_IN_SYSTEM | family_members.birth_date (member row, sort_order 3) |
| 75 | فرد 3 - السن | 7,506 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 76 | فرد 3 - طالب | 7,510 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED (transformed)) |
| 77 | فرد 3 - التعليم | 6,524 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 78 | فرد 3 - نوع التعليم | 6,617 | PARTIALLY_AVAILABLE | family_members.notes for students; legacy record otherwise |
| 79 | فرد 3 - المرحلة الدراسية | 6,360 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 80 | فرد 3 - الصف الدراسي | 6,356 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 81 | فرد 3 - الدخل الشهري | 7,510 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 82 | فرد 3 - الدعم المصروف له | 2,844 | FULLY_AVAILABLE_IN_SYSTEM | case_support_history (recipient = the member) |
| 83 | فرد 4 - الاسم | 3,499 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 84 | فرد 4 - الرقم القومي | 3,497 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 85 | فرد 4 - الصفة | 3,492 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 86 | فرد 4 - النوع | 3,496 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 87 | فرد 4 - تاريخ الميلاد | 3,496 | FULLY_AVAILABLE_IN_SYSTEM | family_members.birth_date (member row, sort_order 4) |
| 88 | فرد 4 - السن | 3,496 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 89 | فرد 4 - طالب | 3,499 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED (transformed)) |
| 90 | فرد 4 - التعليم | 2,948 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 91 | فرد 4 - نوع التعليم | 3,011 | PARTIALLY_AVAILABLE | family_members.notes for students; legacy record otherwise |
| 92 | فرد 4 - المرحلة الدراسية | 2,885 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 93 | فرد 4 - الصف الدراسي | 2,885 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 94 | فرد 4 - الدخل الشهري | 3,499 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 95 | فرد 4 - الدعم المصروف له | 1,262 | FULLY_AVAILABLE_IN_SYSTEM | case_support_history (recipient = the member) |
| 96 | فرد 5 - الاسم | 1,074 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 97 | فرد 5 - الرقم القومي | 1,073 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 98 | فرد 5 - الصفة | 1,072 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 99 | فرد 5 - النوع | 1,072 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 100 | فرد 5 - تاريخ الميلاد | 1,072 | FULLY_AVAILABLE_IN_SYSTEM | family_members.birth_date (member row, sort_order 5) |
| 101 | فرد 5 - السن | 1,072 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 102 | فرد 5 - طالب | 1,074 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED (transformed)) |
| 103 | فرد 5 - التعليم | 860 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 104 | فرد 5 - نوع التعليم | 892 | PARTIALLY_AVAILABLE | family_members.notes for students; legacy record otherwise |
| 105 | فرد 5 - المرحلة الدراسية | 835 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 106 | فرد 5 - الصف الدراسي | 835 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 107 | فرد 5 - الدخل الشهري | 1,074 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 108 | فرد 5 - الدعم المصروف له | 369 | FULLY_AVAILABLE_IN_SYSTEM | case_support_history (recipient = the member) |
| 109 | فرد 6 - الاسم | 254 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 110 | فرد 6 - الرقم القومي | 253 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 111 | فرد 6 - الصفة | 254 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 112 | فرد 6 - النوع | 253 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 113 | فرد 6 - تاريخ الميلاد | 253 | FULLY_AVAILABLE_IN_SYSTEM | family_members.birth_date (member row, sort_order 6) |
| 114 | فرد 6 - السن | 253 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 115 | فرد 6 - طالب | 254 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED (transformed)) |
| 116 | فرد 6 - التعليم | 185 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 117 | فرد 6 - نوع التعليم | 189 | PARTIALLY_AVAILABLE | family_members.notes for students; legacy record otherwise |
| 118 | فرد 6 - المرحلة الدراسية | 177 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 119 | فرد 6 - الصف الدراسي | 177 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 120 | فرد 6 - الدخل الشهري | 254 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 121 | فرد 6 - الدعم المصروف له | 63 | FULLY_AVAILABLE_IN_SYSTEM | case_support_history (recipient = the member) |
| 122 | فرد 7 - الاسم | 39 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 123 | فرد 7 - الرقم القومي | 39 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 124 | فرد 7 - الصفة | 39 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 125 | فرد 7 - النوع | 39 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 126 | فرد 7 - تاريخ الميلاد | 39 | FULLY_AVAILABLE_IN_SYSTEM | family_members.birth_date (member row, sort_order 7) |
| 127 | فرد 7 - السن | 39 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 128 | فرد 7 - طالب | 39 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED (transformed)) |
| 129 | فرد 7 - التعليم | 24 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 130 | فرد 7 - نوع التعليم | 29 | PARTIALLY_AVAILABLE | family_members.notes for students; legacy record otherwise |
| 131 | فرد 7 - المرحلة الدراسية | 23 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 132 | فرد 7 - الصف الدراسي | 23 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 133 | فرد 7 - الدخل الشهري | 39 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 134 | فرد 7 - الدعم المصروف له | 7 | FULLY_AVAILABLE_IN_SYSTEM | case_support_history (recipient = the member) |
| 135 | فرد 8 - الاسم | 10 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 136 | فرد 8 - الرقم القومي | 10 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 137 | فرد 8 - الصفة | 10 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 138 | فرد 8 - النوع | 10 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 139 | فرد 8 - تاريخ الميلاد | 10 | FULLY_AVAILABLE_IN_SYSTEM | family_members.birth_date (member row, sort_order 8) |
| 140 | فرد 8 - السن | 10 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 141 | فرد 8 - طالب | 10 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED (transformed)) |
| 142 | فرد 8 - التعليم | 6 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 143 | فرد 8 - نوع التعليم | 8 | PARTIALLY_AVAILABLE | family_members.notes for students; legacy record otherwise |
| 144 | فرد 8 - المرحلة الدراسية | 6 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 145 | فرد 8 - الصف الدراسي | 6 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 146 | فرد 8 - الدخل الشهري | 10 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 147 | فرد 8 - الدعم المصروف له | 1 | FULLY_AVAILABLE_IN_SYSTEM | case_support_history (recipient = the member) |
| 148 | فرد 9 - الاسم | 1 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 149 | فرد 9 - الرقم القومي | 1 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 150 | فرد 9 - الصفة | 1 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 151 | فرد 9 - النوع | 1 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 152 | فرد 9 - تاريخ الميلاد | 1 | FULLY_AVAILABLE_IN_SYSTEM | family_members.birth_date (member row, sort_order 9) |
| 153 | فرد 9 - السن | 1 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 154 | فرد 9 - طالب | 1 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED (transformed)) |
| 155 | فرد 9 - التعليم | 0 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 156 | فرد 9 - نوع التعليم | 1 | PARTIALLY_AVAILABLE | family_members.notes for students; legacy record otherwise |
| 157 | فرد 9 - المرحلة الدراسية | 0 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 158 | فرد 9 - الصف الدراسي | 0 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 159 | فرد 9 - الدخل الشهري | 1 | FULLY_AVAILABLE_IN_SYSTEM | see EXCEL_DATA_MAPPING.md (IMPORTED) |
| 160 | فرد 9 - الدعم المصروف له | 0 | FULLY_AVAILABLE_IN_SYSTEM | case_support_history (recipient = the member) |
| 161 | دخل: دخل رب الأسرة | 1,291 | FULLY_AVAILABLE_IN_SYSTEM | auto income line «دخل رب الأسرة» = beneficiaries.monthly_income (col 11) |
| 162 | دخل: دخل الزوج/الزوجة | 296 | FULLY_AVAILABLE_IN_SYSTEM | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — income «دخل الزوج/الزوجة» |
| 163 | دخل: دخل أفراد الأسرة | 195 | FULLY_AVAILABLE_IN_SYSTEM | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — income «دخل أفراد الأسرة» |
| 164 | دخل: تكافل وكرامة | 278 | FULLY_AVAILABLE_IN_SYSTEM | beneficiaries.takaful_beneficiary/takaful_amount → auto line «تكافل وكرامة» |
| 165 | دخل: معاش | 171 | FULLY_AVAILABLE_IN_SYSTEM | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — income «معاش» |
| 166 | دخل: مساعدات | 136 | FULLY_AVAILABLE_IN_SYSTEM | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — income «مساعدات» |
| 167 | دخل: أخرى | 93 | FULLY_AVAILABLE_IN_SYSTEM | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — other income line(s) |
| 168 | تفاصيل الدخل الآخر | 93 | FULLY_AVAILABLE_IN_SYSTEM | the labels of the other-income lines |
| 169 | إجمالي الدخل | 1,473 | FULLY_AVAILABLE_IN_SYSTEM | case_financial_summary.total_income (engine) |
| 170 | مصروف: أكل وشرب | 569 | FULLY_AVAILABLE_IN_SYSTEM | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — fixed «الأكل والشرب» |
| 171 | مصروف: غاز | 554 | PARTIALLY_AVAILABLE | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — fixed «الكهرباء، المياه، الغاز» (gas part) |
| 172 | مصروف: كهرباء | 552 | PARTIALLY_AVAILABLE | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — fixed «الكهرباء، المياه، الغاز» (electricity part) |
| 173 | مصروف: مياه | 522 | PARTIALLY_AVAILABLE | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — fixed «الكهرباء، المياه، الغاز» (water part) |
| 174 | مصروف: تعليم | 405 | FULLY_AVAILABLE_IN_SYSTEM | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — fixed «المصروفات الدراسية» |
| 175 | مصروف: علاج شهرى | 188 | FULLY_AVAILABLE_IN_SYSTEM | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — OPTIONAL «العلاج الشهري» (new) |
| 176 | مصروف: إيجار | 159 | FULLY_AVAILABLE_IN_SYSTEM | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — fixed «الإيجار» |
| 177 | مصروف: أقساط | 42 | PARTIALLY_AVAILABLE | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — fixed «القسط» (installments part) |
| 178 | مصروف: قروض | 39 | PARTIALLY_AVAILABLE | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — fixed «القسط» (loans part) |
| 179 | مصروف: إيجار الأرض الزراعية | 16 | FULLY_AVAILABLE_IN_SYSTEM | case_agriculture (has_land=yes, land_type=إيجار, land_rent_amount) → auto expense «إيجار الأراضي الزراعية» |
| 180 | مصروف: أخرى | 5 | FULLY_AVAILABLE_IN_SYSTEM | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — OPTIONAL «مصروفات أخرى» (new) |
| 181 | تفاصيل المصروفات الأخرى | 5 | PARTIALLY_AVAILABLE | legacy record (read-only) |
| 182 | إجمالي المصروفات | 1,473 | FULLY_AVAILABLE_IN_SYSTEM | case_financial_summary.total_expenses (engine) |
| 183 | ملخص الدخل (من البرنامج) | 1,468 | FULLY_AVAILABLE_IN_SYSTEM | derived from the income lines; verbatim in legacy record |
| 184 | سكن: طبيعة السكن | 577 | FULLY_AVAILABLE_IN_SYSTEM | case_housing.ownership |
| 185 | سكن: السقف | 580 | FULLY_AVAILABLE_IN_SYSTEM | case_housing.roof |
| 186 | سكن: الأرضية | 580 | FULLY_AVAILABLE_IN_SYSTEM | case_housing.floor |
| 187 | سكن: المدخل | 581 | FULLY_AVAILABLE_IN_SYSTEM | case_housing.entrance |
| 188 | سكن: الحوائط | 580 | FULLY_AVAILABLE_IN_SYSTEM | case_housing.walls |
| 189 | سكن: طبيعة دورات المياه | 572 | FULLY_AVAILABLE_IN_SYSTEM | case_housing.bathroom_type (new) |
| 190 | سكن: حالة دورات المياه | 578 | FULLY_AVAILABLE_IN_SYSTEM | case_housing.bathroom_condition |
| 191 | سكن: الكهرباء | 577 | FULLY_AVAILABLE_IN_SYSTEM | case_housing.electricity |
| 192 | سكن: عداد المياه | 573 | FULLY_AVAILABLE_IN_SYSTEM | case_housing.water |
| 193 | سكن: موتور مياه | 547 | FULLY_AVAILABLE_IN_SYSTEM | case_housing.water_motor |
| 194 | سكن: أجهزة الطبخ | 578 | FULLY_AVAILABLE_IN_SYSTEM | case_appliances[cookingAppliances] (is_present, details) |
| 195 | سكن: التلفاز | 568 | FULLY_AVAILABLE_IN_SYSTEM | case_appliances[tv] |
| 196 | سكن: الثلاجة | 574 | FULLY_AVAILABLE_IN_SYSTEM | case_appliances[fridge] |
| 197 | سكن: الغسالة | 573 | FULLY_AVAILABLE_IN_SYSTEM | case_appliances[washer] |
| 198 | سكن: فرن خبيز | 557 | FULLY_AVAILABLE_IN_SYSTEM | case_appliances[oven] |
| 199 | سكن: حاسب آلى | 552 | FULLY_AVAILABLE_IN_SYSTEM | case_appliances[computer] |
| 200 | سكن: إنترنت | 559 | FULLY_AVAILABLE_IN_SYSTEM | case_housing.internet |
| 201 | سكن: وسيلة مواصلات | 67 | FULLY_AVAILABLE_IN_SYSTEM | case_housing.transport |
| 202 | سكن: ديب فريزر | 515 | FULLY_AVAILABLE_IN_SYSTEM | case_appliances[freezer] |
| 203 | وصف السكن | 11,436 | FULLY_AVAILABLE_IN_SYSTEM | case_housing.description (TEXT) |
| 204 | الاحتياجات | 10,166 | FULLY_AVAILABLE_IN_SYSTEM | case_assessed_needs (one row per item; priority «غير محدد», source «البحث الميداني (السجل القديم)», status «مسجل») |
| 205 | عدد الاحتياجات | 10,166 | FULLY_AVAILABLE_IN_SYSTEM | count of the col-204 needs |
| 206 | دعم: مصروفات دراسية | 6,306 | FULLY_AVAILABLE_IN_SYSTEM | Σ support-history quantity «مصروفات دراسية» |
| 207 | دعم: زي مدرسي | 6,275 | FULLY_AVAILABLE_IN_SYSTEM | Σ quantity «زي مدرسي» |
| 208 | دعم: كرتونة | 6,855 | FULLY_AVAILABLE_IN_SYSTEM | Σ quantity «كرتونة» |
| 209 | دعم: لحمة | 6,851 | FULLY_AVAILABLE_IN_SYSTEM | Σ quantity «لحمة» |
| 210 | بنود دعم أخرى | 684 | FULLY_AVAILABLE_IN_SYSTEM | the non-standard types in the head's support history |
| 211 | الدعم المصروف لرب الأسرة | 7,207 | FULLY_AVAILABLE_IN_SYSTEM | case_support_history (recipient_type=head, quantity=N, source=legacy_import) — NEW table |
| 212 | إجمالي مرات الدعم | 7,305 | FULLY_AVAILABLE_IN_SYSTEM | Σ support-history quantities |
| 213 | إجمالي تكلفة الدعم | 7,305 | FULLY_AVAILABLE_IN_SYSTEM | Σ support-history amounts (the one non-zero row → that row's single entry) |
| 214 | ملاحظات مراجعة البيانات | 484 | PARTIALLY_AVAILABLE | legacy record (read-only data-review flag) |

### 12.2 تفاصيل الـ 65 عمود اللي اتضافوا 2026-09-25

| # | Excel column | Rows | Sample values | Type | Staging | Target entity.field | Meaning | Transformation | Validation | Editable | Searchable | Reportable | Case Details | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 32 | الزوج/الزوجة - تاريخ الميلاد | 8,912 | ISO dates, e.g. 1985-07-10 | date (max 10) | raw_data[32] | family_members.birth_date (spouse row, sort_order 0) | Spouse's date of birth | ISO date → date | valid date | Yes (PUT /family-members, birthDate) | No | No | Yes (familyMembers[].birthDate) | FULLY_AVAILABLE_IN_SYSTEM |
| 37 | الزوج/الزوجة - الهاتف | 1,142 | 11-digit mobile numbers (e.g. 010…, 011…, 012…) — PII, not reproduced | text (phone) (max 11) | raw_data[37] | family_members.phone (spouse row) | Spouse's phone | verbatim, leading 0 kept | max 20 | Yes (PUT /family-members, phone) | No | No | Yes (familyMembers[].phone) | FULLY_AVAILABLE_IN_SYSTEM |
| 48 | فرد 1 - تاريخ الميلاد | 11,788 | ISO dates, e.g. 1985-07-10 | date (max 10) | raw_data[48] | family_members.birth_date (member row, sort_order 1) | Member 1 date of birth | ISO date → date | valid date | Yes (PUT /family-members) | No | No | Yes (familyMembers[].birthDate) | FULLY_AVAILABLE_IN_SYSTEM |
| 61 | فرد 2 - تاريخ الميلاد | 10,565 | ISO dates, e.g. 1985-07-10 | date (max 10) | raw_data[61] | family_members.birth_date (member row, sort_order 2) | Member 2 date of birth | ISO date → date | valid date | Yes (PUT /family-members) | No | No | Yes (familyMembers[].birthDate) | FULLY_AVAILABLE_IN_SYSTEM |
| 74 | فرد 3 - تاريخ الميلاد | 7,506 | ISO dates, e.g. 1985-07-10 | date (max 10) | raw_data[74] | family_members.birth_date (member row, sort_order 3) | Member 3 date of birth | ISO date → date | valid date | Yes (PUT /family-members) | No | No | Yes (familyMembers[].birthDate) | FULLY_AVAILABLE_IN_SYSTEM |
| 87 | فرد 4 - تاريخ الميلاد | 3,496 | ISO dates, e.g. 1985-07-10 | date (max 10) | raw_data[87] | family_members.birth_date (member row, sort_order 4) | Member 4 date of birth | ISO date → date | valid date | Yes (PUT /family-members) | No | No | Yes (familyMembers[].birthDate) | FULLY_AVAILABLE_IN_SYSTEM |
| 100 | فرد 5 - تاريخ الميلاد | 1,072 | ISO dates, e.g. 1985-07-10 | date (max 10) | raw_data[100] | family_members.birth_date (member row, sort_order 5) | Member 5 date of birth | ISO date → date | valid date | Yes (PUT /family-members) | No | No | Yes (familyMembers[].birthDate) | FULLY_AVAILABLE_IN_SYSTEM |
| 113 | فرد 6 - تاريخ الميلاد | 253 | ISO dates, e.g. 1985-07-10 | date (max 10) | raw_data[113] | family_members.birth_date (member row, sort_order 6) | Member 6 date of birth | ISO date → date | valid date | Yes (PUT /family-members) | No | No | Yes (familyMembers[].birthDate) | FULLY_AVAILABLE_IN_SYSTEM |
| 126 | فرد 7 - تاريخ الميلاد | 39 | ISO dates, e.g. 1985-07-10 | date (max 10) | raw_data[126] | family_members.birth_date (member row, sort_order 7) | Member 7 date of birth | ISO date → date | valid date | Yes (PUT /family-members) | No | No | Yes (familyMembers[].birthDate) | FULLY_AVAILABLE_IN_SYSTEM |
| 139 | فرد 8 - تاريخ الميلاد | 10 | ISO dates, e.g. 1985-07-10 | date (max 10) | raw_data[139] | family_members.birth_date (member row, sort_order 8) | Member 8 date of birth | ISO date → date | valid date | Yes (PUT /family-members) | No | No | Yes (familyMembers[].birthDate) | FULLY_AVAILABLE_IN_SYSTEM |
| 152 | فرد 9 - تاريخ الميلاد | 1 | ISO dates, e.g. 1985-07-10 | date (max 10) | raw_data[152] | family_members.birth_date (member row, sort_order 9) | Member 9 date of birth | ISO date → date | valid date | Yes (PUT /family-members) | No | No | Yes (familyMembers[].birthDate) | FULLY_AVAILABLE_IN_SYSTEM |
| 161 | دخل: دخل رب الأسرة | 1,291 | «4500» · «4000» · «2000» · «5000» | money (max 5) | raw_data[161] | auto income line «دخل رب الأسرة» = beneficiaries.monthly_income (col 11) | Head-of-household income | none — verified 161 = col 11 in all 1,291 rows | ≥ 0 | Yes (via beneficiary monthlyIncome) | No | Yes (financial totals) | Yes (financial.incomeItems) | FULLY_AVAILABLE_IN_SYSTEM |
| 162 | دخل: دخل الزوج/الزوجة | 296 | «1000» · «1500» · «2000» · «500» | money (max 4) | raw_data[162] | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — income «دخل الزوج/الزوجة» | Spouse income (= col 35 in 295/296 rows) | manual monthly line | ≥ 0 | Yes (PUT /financial) | No | Yes (financial totals) | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 163 | دخل: دخل أفراد الأسرة | 195 | «1000» · «2000» · «3000» · «1500» | money (max 5) | raw_data[163] | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — income «دخل أفراد الأسرة» | Other members' income (= sum of member incomes in all 195 rows) | manual monthly line | ≥ 0 | Yes (PUT /financial) | No | Yes | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 164 | دخل: تكافل وكرامة | 278 | «880» · «800» · «700» · «770» | money (max 4) | raw_data[164] | beneficiaries.takaful_beneficiary/takaful_amount → auto line «تكافل وكرامة» | Takaful wa Karama cash support | set when unset | ≥ 0 | Yes (PUT /beneficiary takaful fields) | No | Yes | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 165 | دخل: معاش | 171 | «2500» · «2598» · «2800» · «2550» | money (max 4) | raw_data[165] | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — income «معاش» | Pension | manual monthly line | ≥ 0 | Yes | No | Yes | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 166 | دخل: مساعدات | 136 | «1000» · «500» · «1500» · «2000» | money (max 4) | raw_data[166] | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — income «مساعدات» | Aid received | manual monthly line | ≥ 0 | Yes | No | Yes | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 167 | دخل: أخرى | 93 | «1000» · «1500» · «500» · «2000» | money (max 4) | raw_data[167] | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — other income line(s) | Other income | labelled parts of col 168 when they add up (all 93 rows), else one «أخرى» line | ≥ 0 | Yes | No | Yes | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 168 | تفاصيل الدخل الآخر | 93 | «اخرى (1500)» · «اخرى (500)» · «اخرى (1000)» · «اخرى (2000)» | text «label (amount) | …» (max 61) | raw_data[168] | the labels of the other-income lines | What the other income is | «ايجار شقه (2000) | معاش الام (3800)» → two lines | label ≤ 100 | Yes | No | No | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 169 | إجمالي الدخل | 1,473 | «4500» · «2000» · «3000» · «4000» | money (derived) (max 5) | raw_data[169] | case_financial_summary.total_income (engine) | Total income | derived — verified = sum of 161–167 in all 1,473 rows | — | No (computed) | No | Yes (financial_total_income) | Yes (financial.totalIncome) | FULLY_AVAILABLE_IN_SYSTEM |
| 170 | مصروف: أكل وشرب | 569 | «4000» · «4500» · «5000» · «3000» | money (max 4) | raw_data[170] | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — fixed «الأكل والشرب» | Food | direct | ≥ 0 | Yes | No | Yes | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 171 | مصروف: غاز | 554 | «150» · «250» · «100» · «500» | money (max 4) | raw_data[171] | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — fixed «الكهرباء، المياه، الغاز» (gas part) | Gas | summed with 172+173 into the combined fixed category | ≥ 0 | Yes (combined) | No | Yes | Yes (combined); per-utility amount in legacy record | PARTIALLY_AVAILABLE |
| 172 | مصروف: كهرباء | 552 | «250» · «200» · «150» · «300» | money (max 4) | raw_data[172] | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — fixed «الكهرباء، المياه، الغاز» (electricity part) | Electricity | summed (171+172+173) | ≥ 0 | Yes (combined) | No | Yes | Yes (combined) | PARTIALLY_AVAILABLE |
| 173 | مصروف: مياه | 522 | «50» · «100» · «150» · «30» | money (max 4) | raw_data[173] | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — fixed «الكهرباء، المياه، الغاز» (water part) | Water | summed (171+172+173) | ≥ 0 | Yes (combined) | No | Yes | Yes (combined) | PARTIALLY_AVAILABLE |
| 174 | مصروف: تعليم | 405 | «600» · «500» · «300» · «1000» | money (max 4) | raw_data[174] | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — fixed «المصروفات الدراسية» | Education | direct | ≥ 0 | Yes | No | Yes | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 175 | مصروف: علاج شهرى | 188 | «500» · «300» · «200» · «1000» | money (max 5) | raw_data[175] | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — OPTIONAL «العلاج الشهري» (new) | Monthly medical cost | direct | ≥ 0 | Yes (optional; omitted = kept) | No | Yes | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 176 | مصروف: إيجار | 159 | «1500» · «2000» · «1000» · «1200» | money (max 4) | raw_data[176] | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — fixed «الإيجار» | Rent | direct | ≥ 0 | Yes | No | Yes | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 177 | مصروف: أقساط | 42 | «500» · «1000» · «2000» · «1500» | money (max 4) | raw_data[177] | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — fixed «القسط» (installments part) | Installments | summed with 178 | ≥ 0 | Yes (combined) | No | Yes | Yes (combined) | PARTIALLY_AVAILABLE |
| 178 | مصروف: قروض | 39 | «1050» · «2850» · «9009» · «6570» | money (max 4) | raw_data[178] | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — fixed «القسط» (loans part) | Loan repayments | summed (177+178) | ≥ 0 | Yes (combined) | No | Yes | Yes (combined) | PARTIALLY_AVAILABLE |
| 179 | مصروف: إيجار الأرض الزراعية | 16 | «1000» · «500» · «2000» · «250» | money (max 5) | raw_data[179] | case_agriculture (has_land=yes, land_type=إيجار, land_rent_amount) → auto expense «إيجار الأراضي الزراعية» | Rent of agricultural land | agriculture row created only when absent | ≥ 0 | Yes (PUT /agriculture) | No | Yes | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 180 | مصروف: أخرى | 5 | «250» · «12» · «4800» · «640» | money (max 4) | raw_data[180] | case_financial_items (+ case_financial_summary via FinancialCalculationEngine) — OPTIONAL «مصروفات أخرى» (new) | Other expenses | direct | ≥ 0 | Yes (optional; omitted = kept) | No | Yes | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 181 | تفاصيل المصروفات الأخرى | 5 | «مصروفات نثريه (12)» · «مصروف سجائر (250)» · «مصروف صيانه المنزل (250)» · «تكافل وكرامة (800) | معاش (4000)» | text «label (amount)» (max 35) | raw_data[181] | legacy record (read-only) | What the other expense is (5 rows) | none — the optional category label is fixed | — | No | No | No | Yes (GET /legacy-record) | PARTIALLY_AVAILABLE |
| 182 | إجمالي المصروفات | 1,473 | «0» · «6150» · «7100» · «5000» | money (derived) (max 5) | raw_data[182] | case_financial_summary.total_expenses (engine) | Total expenses | derived — verified = sum of 170–180 in all 1,473 rows | — | No (computed) | No | Yes | Yes (financial.totalExpenses) | FULLY_AVAILABLE_IN_SYSTEM |
| 183 | ملخص الدخل (من البرنامج) | 1,468 | «دخل: دخل رب الأسرة (4500)» · «دخل: دخل رب الأسرة (2000)» · «دخل: دخل رب الأسرة (4000)» · «دخل: دخل رب الأسرة (3000)» | text (derived) (max 403) | raw_data[183] | derived from the income lines; verbatim in legacy record | Income summary text | the old program's printout of the income lines | — | No | No | No | Yes (legacy record) | FULLY_AVAILABLE_IN_SYSTEM |
| 184 | سكن: طبيعة السكن | 577 | «خاص» · «منزل عائلة» · «ايجار» · «خاص | منزل عائلة» | text (vocabulary) (max 16) | raw_data[184] | case_housing.ownership | Housing tenure | verbatim («خاص | منزل عائلة» kept) | max 50 | Yes (PUT /housing) | No | No | Yes (housing.ownership) | FULLY_AVAILABLE_IN_SYSTEM |
| 185 | سكن: السقف | 580 | «مسلح» · «خشب» · «مسلح | خشب» · «خشب | جريد» | text (vocabulary) (max 17) | raw_data[185] | case_housing.roof | Roof | verbatim | max 50 | Yes | No | No | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 186 | سكن: الأرضية | 580 | «سيراميك» · «أسمنت» · «بلاط» · «تراب» | text (vocabulary) (max 22) | raw_data[186] | case_housing.floor | Floor | verbatim | max 50 | Yes | No | No | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 187 | سكن: المدخل | 581 | «سيراميك» · «أسمنت» · «بلاط» · «تراب» | text (vocabulary) (max 15) | raw_data[187] | case_housing.entrance | Entrance | verbatim | max 50 | Yes | No | No | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 188 | سكن: الحوائط | 580 | «دهان» · «محارة» · «بلوك» · «محارة | دهان» | text (vocabulary) (max 23) | raw_data[188] | case_housing.walls | Walls | verbatim | max 50 | Yes | No | No | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 189 | سكن: طبيعة دورات المياه | 572 | «خاص» · «مشترك» | text (vocabulary) (max 5) | raw_data[189] | case_housing.bathroom_type (new) | Private or shared bathroom | verbatim (خاص/مشترك) | max 50 | Yes (bathroomType; null keeps) | No | No | Yes (housing.bathroomType) | FULLY_AVAILABLE_IN_SYSTEM |
| 190 | سكن: حالة دورات المياه | 578 | «ادمي» · «غير ادمي» · «ادمي | غير ادمي» | text (vocabulary) (max 15) | raw_data[190] | case_housing.bathroom_condition | Bathroom condition | verbatim (ادمي/غير ادمي) | — | Yes | No | No | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 191 | سكن: الكهرباء | 577 | «عداد» · «ممارسة» · «لا يوجد» | text (vocabulary) (max 7) | raw_data[191] | case_housing.electricity | Electricity supply | verbatim (عداد/ممارسة/لا يوجد) | max 50 | Yes | No | No | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 192 | سكن: عداد المياه | 573 | «عداد» · «لا يوجد» · «ممارسة» | text (vocabulary) (max 7) | raw_data[192] | case_housing.water | Water meter | verbatim (عداد/ممارسة/لا يوجد) | max 50 | Yes | No | No | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 193 | سكن: موتور مياه | 547 | «لا يوجد» · «يوجد» | yes/no (max 7) | raw_data[193] | case_housing.water_motor | Water pump | يوجد → true, else false | — | Yes | No | No | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 194 | سكن: أجهزة الطبخ | 578 | «بوتوجاز» · «شعلة» · «شعلة | بوتوجاز» · «لا يوجد» | text (vocabulary) (max 17) | raw_data[194] | case_appliances[cookingAppliances] (is_present, details) | Cooking appliances | present unless «لا يوجد»; kind → details | details ≤ 100 | Yes (PUT /utilities) | No | No | Yes (utilities.appliances) | FULLY_AVAILABLE_IN_SYSTEM |
| 195 | سكن: التلفاز | 568 | «تلفاز» · «شاشة» · «لا يوجد» · «تلفاز | شاشة» | text (vocabulary) (max 15) | raw_data[195] | case_appliances[tv] | TV | same | ≤ 100 | Yes | No | No | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 196 | سكن: الثلاجة | 574 | «يوجد» · «لا يوجد» | yes/no (max 7) | raw_data[196] | case_appliances[fridge] | Fridge | same | — | Yes | No | No | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 197 | سكن: الغسالة | 573 | «هاف» · «عادية» · «اوتوماتيك» · «عادية | هاف» | text (vocabulary) (max 17) | raw_data[197] | case_appliances[washer] | Washing machine | same («هاف»/«عادية»/«اوتوماتيك» → details) | ≤ 100 | Yes | No | No | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 198 | سكن: فرن خبيز | 557 | «لا يوجد» · «يوجد» | yes/no (max 7) | raw_data[198] | case_appliances[oven] | Baking oven | same | — | Yes | No | No | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 199 | سكن: حاسب آلى | 552 | «لا يوجد» · «للتعليم» · «للتسلية» | text (vocabulary) (max 7) | raw_data[199] | case_appliances[computer] | Computer | same («للتعليم»/«للتسلية» → details) | ≤ 100 | Yes | No | No | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 200 | سكن: إنترنت | 559 | «لا يوجد» · «يوجد» | yes/no (max 7) | raw_data[200] | case_housing.internet | Internet | يوجد → true | — | Yes | No | No | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 201 | سكن: وسيلة مواصلات | 67 | «أخري» · «موتوسيكل» · «توك توك» · «سيارة» | text (vocabulary) (max 16) | raw_data[201] | case_housing.transport | Means of transport | verbatim | max 50 | Yes | No | No | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 202 | سكن: ديب فريزر | 515 | «لا يوجد» · «يوجد» · «يوجد | لا يوجد» | yes/no (max 14) | raw_data[202] | case_appliances[freezer] | Deep freezer | same | — | Yes | No | No | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 203 | وصف السكن | 11,436 | free text up to 999 chars, e.g. «لم يتم زيارة الحالة», «لا يوجد اثبات للدخل» | long text (max 999) | raw_data[203] | case_housing.description (TEXT) | The researcher's housing/situation description | verbatim, full length | none (TEXT) | Yes | No | No | Yes (housing.description) | FULLY_AVAILABLE_IN_SYSTEM |
| 204 | الاحتياجات | 10,166 | «كرتونة | لحمة | مصروفات دراسية» · «كرتونة | لحمة» · «كرتونة | لحمة | مصروفات دراسية | زي مدرس» · «لحمة | كرتونة | مصروفات دراسية» | list «a | b» (max 184) | raw_data[204] | case_assessed_needs (one row per item; priority «غير محدد», source «البحث الميداني (السجل القديم)», status «مسجل») | Needs recorded at research | split on «|» | need ≤ 50 (max found 17) | Yes (PUT /assessed-needs) | No | Yes (needs reports) | Yes (assessedNeeds) | FULLY_AVAILABLE_IN_SYSTEM |
| 205 | عدد الاحتياجات | 10,166 | «3» · «2» · «4» · «5» | int (derived) (max 2) | raw_data[205] | count of the col-204 needs | Number of needs | derived — verified in all 10,166 rows | — | No | No | No | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 206 | دعم: مصروفات دراسية | 6,306 | «2» · «1» · «3» · «4» | int (derived) (max 1) | raw_data[206] | Σ support-history quantity «مصروفات دراسية» | School-fee grants (total) | derived — verified (head + members) in all rows | — | No | No | Yes | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 207 | دعم: زي مدرسي | 6,275 | «2» · «1» · «3» · «4» | int (derived) (max 1) | raw_data[207] | Σ quantity «زي مدرسي» | Uniform grants (total) | derived | — | No | No | Yes | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 208 | دعم: كرتونة | 6,855 | «1» · «2» · «3» · «4» | int (derived) (max 1) | raw_data[208] | Σ quantity «كرتونة» | Food boxes (total) | derived | — | No | No | Yes | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 209 | دعم: لحمة | 6,851 | «1» · «2» · «3» · «4» | int (derived) (max 1) | raw_data[209] | Σ quantity «لحمة» | Meat (total) | derived | — | No | No | Yes | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 210 | بنود دعم أخرى | 684 | «وصلة مياه» · «سقف» · «مرشح لبنك الطعام» · «عمليات ×2» | list (derived) (max 49) | raw_data[210] | the non-standard types in the head's support history | Other support items | derived — every item is in col 211 (684/684 rows) | — | No | No | No | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 211 | الدعم المصروف لرب الأسرة | 7,207 | «كرتونة | لحمة» · «كرتونة | لحمة | مصروفات دراسية ×2 | زي م» · «كرتونة | لحمة | مصروفات دراسية | زي مدرس» · «زي مدرسي ×2 | مصروفات دراسية ×2» | list «type ×N | …» (max 99) | raw_data[211] | case_support_history (recipient_type=head, quantity=N, source=legacy_import) — NEW table | Support given to the head | «type ×N» → entry with quantity N | type ≤ 100, qty ≥ 1 | Yes (PUT /support-history) | No | Yes (support history) | Yes (GET /support → history) | FULLY_AVAILABLE_IN_SYSTEM |
| 212 | إجمالي مرات الدعم | 7,305 | «6» · «4» · «8» · «2» | int (derived) (max 2) | raw_data[212] | Σ support-history quantities | Total support count | derived — verified = head quantities + member items in all 7,305 rows | — | No | No | Yes | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 213 | إجمالي تكلفة الدعم | 7,305 | «0» · «600» | money (derived) (max 3) | raw_data[213] | Σ support-history amounts (the one non-zero row → that row's single entry) | Total support cost | 0 in 7,304 rows = cost not recorded | ≥ 0 | Yes (amount per entry) | No | Yes | Yes | FULLY_AVAILABLE_IN_SYSTEM |
| 214 | ملاحظات مراجعة البيانات | 484 | «بدون هاتف» · «رقم قومي غير صحيح» · «رقم قومي غير صحيح للزوج/الزوجة» · «رقم قومي غير صحيح لفرد 1» | text (max 44) | raw_data[214] | legacy record (read-only data-review flag) | Data-review note of the old export («بدون هاتف», «رقم قومي غير صحيح») | none | — | No | No | No | Yes (GET /legacy-record) | PARTIALLY_AVAILABLE |

## 13. رفع الملفات

الملفات مش بتعدي على السيرفر — بتترفع مباشرة لـ Cloudflare R2 بـ presigned URL:

1. `POST /api/v1/attachments/init` بـ `{caseId, documentType, fileName, mimeType, fileSize, description}` → بيرجع `attachmentId`, `uploadUrl`, `expiresAt`.
2. `PUT <uploadUrl>` بمحتوى الملف (binary)، و `Content-Type` = نفس الـ `mimeType`. **من غير هيدر Authorization.** اللينك بينتهي (شوفوا `expiresAt`).
3. `POST /api/v1/attachments/{attachmentId}/commit` (مع `Idempotency-Key`) — السيرفر بيتأكد من الحجم ونوع الملف الحقيقي (magic bytes).
4. التحميل: `GET /api/v1/attachments/{id}/download` → `downloadUrl` مؤقت (ماتخزنوهوش؛ اطلبوا جديد كل مرة).
5. الحذف: `DELETE /api/v1/attachments/{id}`. القائمة: `GET /api/v1/cases/{caseId}/attachments`.

الصورة الشخصية نفس الفكرة: `POST /profile/avatar/init` → `PUT uploadUrl` → `POST /profile/avatar/confirm {objectKey}`؛ الحذف `DELETE /profile/avatar`.

- الأنواع المسموحة للمرفقات: صور (`image/jpeg`, `image/png`, …) و PDF وغيرها حسب السياسة — نوع مش مسموح → `422 UNSUPPORTED_FILE_TYPE`. حجم أكبر من المسموح → `FILE_TOO_LARGE`.
- ملف اتعمله init ومااتعملوش commit بيتمسح تلقائياً بعد فترة.

## 14. الموبايل (الأخصائي الاجتماعي)

- الدخول بـ `X-Client-Type: mobile` (الأخصائي بس).
- الشاشة الرئيسية: `GET /api/v1/dashboard/work-queue` (حالاته) + `GET /api/v1/notifications`.
- قبول/رفض الإسناد: `POST /cases/{id}/accept` / `reject-assignment` (بـ Idempotency-Key). قبول حالة `pending_assignment` مباشرة = قبول ذاتي.
- يقدر يعدّل أقسام الحالة المسندة ليه (نفس endpoints الويب).
- **الزيارات الميدانية:** `POST /cases/{id}/field-visits` (Idempotency-Key)، `GET /cases/{id}/field-visits`، `PUT /field-visits/{id}` (بـ rowVersion + Idempotency-Key). فيها `latitude/longitude`، `outcome`، `status`، `notes`، و`photoAttachmentIds` (IDs مرفقات اترفعت وعملها commit).
- **التحقق الميداني:** `PUT /cases/{id}/field-verification` بـ `fields[] {fieldLabel, verifiedValue, differenceReason}`. القيم المسموحة لـ `fieldLabel`: `beneficiary_full_name, beneficiary_national_id, beneficiary_phone_primary, beneficiary_address, beneficiary_marital_status, beneficiary_job, beneficiary_monthly_income, housing_ownership, housing_building_type, housing_rooms_count, financial_total_income, family_members_count`. `GET` بيرجع القيمة المسجلة جنب القيمة الميدانية.
- **رأي الأخصائي:** `POST /cases/{id}/opinions/worker` `{decision: accepted|rejected, notes, caseRowVersion, detailedReport}` — بعد اكتمال 100%.
- **الإشعارات:** سجّلوا توكن FCM بـ `POST /notifications/device-tokens {token, platform: android|ios}`. ⚠️ **الـ push حالياً متوقف في الإنتاج** (مفيش حساب Firebase متعرف) — الإشعارات جوه التطبيق شغالة؛ اعملوا refresh للقائمة عند فتح التطبيق/الشاشة.
- **أوفلاين:** السيرفر مفيهوش sync. خزنوا التعديلات محلياً مع `Idempotency-Key` و `rowVersion`، وابعتوها بالترتيب لما النت يرجع. `409` = الحالة اتغيرت → حدّثوا واسألوا المستخدم.

## 15. البحث، لوحة المتابعة، الإشعارات، الملف الشخصي

- **البحث:** `GET /api/v1/search/cases` بـ `q` (عام)، `name`, `national_id`, `phone`, `charity`, `region` (مركز/قرية)، `date`, `dateFrom`, `dateTo`, `page`, `limit`.
- **القائمة:** `GET /api/v1/cases?status=&bookmarked=true&page=&limit=`. المفضلة: `POST/DELETE /cases/{id}/bookmark`.
- **لوحة المتابعة:** `GET /dashboard/stats` (كاش 30 ثانية)، `GET /dashboard/work-queue`.
- **الإشعارات:** `GET /notifications?page&limit` → `{page:{items…}, unreadCount}`؛ `PUT /notifications/{id}/read`؛ `PUT /notifications/mark-all-read`.
- **الملف الشخصي:** `GET/PUT /profile` (بـ rowVersion) + الصورة (§13).

## 16. التقارير ولوحات التقارير

- التقارير الثابتة (كاش 60 ثانية — اعرضوا "آخر تحديث"): `/cases/summary`, `/cases/by-status`, `/cases/by-location`, `/cases/aging`, `/beneficiaries/summary`, `/support/summary`, `/support/by-type`, `/financial/summary`, `/visits/summary`, `/employees/activity`, `/data-quality`, `/data-coverage`, `/comparisons`.
- لوحات التقارير الجاهزة: `/dashboards/executive`, `/dashboards/cases`, `/dashboards/beneficiaries`, `/dashboards/geographic`, `/dashboards/support`, `/dashboards/financial`, `/dashboards/visits`, `/dashboards/employees`, `/dashboards/data-quality`. المالي منها محتاج `view_financial_reports`.
- `GET /reports/catalog` بيرجع قائمة التقارير المتاحة ومين يحتاج صلاحية مالية.

### ⚠️ منشئ التقارير (Report builder) — الـ enums أرقام مش نصوص
`POST /reports/builder/run` و `POST /reports/export` (CSV) بياخدوا **أرقام** للـ enums (زي ما `GET /reports/datasets` بيرجعها). لو بعتوا الأسماء كنص (`"Cases"`) → `400`. (الملف القديم `FRONTEND_REPORTING_HANDOFF.md` كان كاتب نصوص — ده غلط، استخدموا الجدول ده.)

| Enum | القيم (رقم = اسم) |
|---|---|
| `dataset` | 0 = Cases · 1 = Beneficiaries · 2 = FamilyMembers · 3 = ApprovedSupport · 4 = FieldVisits |
| `dimension` / `filters[].field` | 0 = Status · 1 = Priority · 2 = Center · 3 = Village · 4 = Charity · 5 = Gender · 6 = AgeBracket · 7 = SupportType · 8 = VisitOutcome · 9 = RegistrationMonth · 10 = None |
| `metric` | 0 = Count · 1 = TotalAmount · 2 = AverageAmount · 3 = AverageAge · 4 = AverageMonthlyIncome |
| `aggregation` | 0 = Sum · 1 = Average · 2 = Count · 3 = Min · 4 = Max |
| `filters[].operator` | 0 = Equals · 1 = NotEquals · 2 = GreaterThan · 3 = GreaterThanOrEqual · 4 = LessThan · 5 = LessThanOrEqual · 6 = Between · 7 = Contains |
| `sortDirection` | 0 = Ascending · 1 = Descending |

- التركيبات المسموحة لكل dataset في `GET /reports/datasets` (`allowedDimensions`, `allowedMetrics`, `dimensionOperators`). تركيبة غلط → 422 برسالة واضحة.
- `GET /reports/comparisons?metric=Count|TotalAmount&currentFrom&currentTo&previousFrom&previousTo` (هنا الـ metric **اسم** في الـ query).
- `POST /reports/export` بيرجع `text/csv` (UTF-8 BOM) — نزّلوه كملف، ماتعملوش له parse كـ JSON.

## 17. الإدارة

- **الموظفين** (manager): قائمة/إضافة/تعديل/تغيير الدور/إعادة تعيين كلمة السر/تفعيل/إيقاف/حذف/تصدير CSV. `GET /employees/social-workers` (لقائمة الإسناد — لأي حد عنده create_case).
- **الجمعيات** (manage_charities): قائمة (لأي مستخدم) / إضافة / تعديل (rowVersion) / حذف / تصدير.
- **المواقع** (data_entry): `GET /locations` (مراكز بقراها) + إضافة/تعديل/حذف مركز وقرية. ⚠️ `POST /locations/reset` بيمسح **كل القرى** — للتركيب الجديد بس، **ماتحطوهوش في الواجهة**.
- **القوائم المنسدلة** (manage_configurations): `GET /dropdown-configs`، إضافة خيار، تعديل خيار (`PATCH`)، **الحذف النهائي ممنوع** (403) → عطّلوا الخيار بـ `isActive: false`.
- **سجل المراجعة:** `GET /audit-logs?actorId&entityType&entityId&from&to&page&limit`.

## 18. القوائم المنسدلة (القيم المسموحة)

الفورمز تاخد خياراتها من `GET /api/v1/dropdowns` (كلها) أو `GET /api/v1/dropdowns/{key}` (كاش ساعة، لأي مستخدم) — **مش** من `/dropdown-configs` (دي للأدمن). خزنوها للجلسة. `GET /dropdowns/village` بيرجع كل القرى؛ للربط مركز → قرية استخدموا `GET /locations`.

| key | الاسم | النوع | الخيارات: `value` (label) |
|---|---|---|---|
| `gender` | النوع | select | `ذكر` · `أنثى` |
| `religion` | الديانة | select | `مسلم` · `مسيحي` |
| `head-relation` | صلة القرابة (رب الأسرة) | select | `الأب` · `الأم` · `الأخ` · `الأخت` · `الجد` · `الجدة` · `الزوج` · `الزوجة` · `الابن` · `الابنة` |
| `education-level` | المرحلة التعليمية | select | `جامعي` · `فوق متوسط` · `متوسط` · `إعدادي` · `ابتدائي` · `أمي` |
| `work-type` | طبيعة العمل | select | `عمالة منتظمة` · `عمالة غير منتظمة` · `المعاش` · `غير قادر على العمل` · `موظف حكومي` · `موظف خاص` · `لا يعمل` |
| `social-insurance` | التأمين الاجتماعي | select | `مؤمن عليه` · `غير مؤمن عليه` · `صاحب معاش تأميني` · `معاش تكافل وكرامة` |
| `referral-district-select` | المركز (جهة التحويل) | select | (live list: centers / villages / charities from the database) |
| `referral-village-select` | القرية (جهة التحويل) | select | (live list: centers / villages / charities from the database) |
| `referral-charity-select` | الجمعية | select | (live list: centers / villages / charities from the database) |
| `governorate` | المحافظة | select | `القاهرة` · `الإسكندرية` · `بورسعيد` · `السويس` · `دمياط` · `الدقهلية` · `الشرقية` · `القليوبية` · `كفر الشيخ` · `الغربية` · `المنوفية` · `البحيرة` · `الإسماعيلية` · `الجيزة` · `بني سويف` · `الفيوم` · `المنيا` · `أسيوط` · `سوهاج` · `قنا` · `أسوان` · `الأقصر` · `البحر الأحمر` · `الوادي الجديد` · `مطروح` · `شمال سيناء` · `جنوب سيناء` · `خارج الجمهورية` |
| `district` | المركز (السكن) | select | (live list: centers / villages / charities from the database) |
| `village` | القرية (السكن) | select | (live list: centers / villages / charities from the database) |
| `new-member-relation` | صلة القرابة (فرد تابع) | select | `الزوج` · `الزوجة` · `الابن` · `الابنة` · `الأخ` · `الأخت` · `الحفيد` · `الحفيدة` · `الجد` · `الجدة` |
| `new-member-gender` | النوع (فرد تابع) | select | `ذكر` · `أنثى` |
| `new-member-religion` | الديانة (فرد تابع) | select | `مسلم` · `مسيحي` |
| `new-member-education-stage` | المرحلة التعليمية للفرد | select | `حضانة` · `ابتدائي` · `إعدادي` · `ثانوي` · `جامعي / كلية` · `ماجستير / دراسات عليا` |
| `new-member-grade` | الصف / السنة | select | — (قائمة فاضية حالياً، الأدمن بيضيف) |
| `new-member-qualification` | المؤهل الدراسي (غير طالب) | select | `مؤهل عالي / كلية (جامعي)` · `معهد عالي (4 سنوات)` · `معهد متوسط / فوق متوسط (سنتين)` · `دبلوم فني / مؤهل متوسط` · `ثانوية عامة / أزهرية` · `إعدادية` · `ابتدائية` · `يجيد القراءة والكتابة` · `أمي (بدون مؤهل)` |
| `case-doc-type` | تصنيف نوع المستند | select | — (قائمة فاضية حالياً، الأدمن بيضيف) |
| `agri-land-type` | طبيعة حيازة الأرض | select | `تمليك` · `إيجار` |
| `income-type` | نوع مصدر الدخل | select | `راتب` · `عمل حر / يومية` · `معاش تأميني` · `معاش تكافل وكرامة` · `زراعة` · `تجارة` · `إيجار عقار/أرض` |
| `income-frequency` | دورية الدخل | select | `يومي` · `أسبوعي` · `شهري` · `موسمي` · `سنوي` |
| `expense-type` | نوع المصروف | select | `إيجار سكن` · `فواتير مياه وكهرباء وغاز` · `أكل وشرب وطعام` · `تعليم ومصروفات دراسية` · `علاج وأدوية` · `أقساط وقروض` · `مواصلات` |
| `expense-frequency` | دورية المصروف | select | `يومي` · `أسبوعي` · `شهري` · `موسمي` · `سنوي` |
| `researcher-brief-opinion` | الرأي المختصر | select | `موافق على تقديم الدعم` · `غير موافق / التوصية بالرفض` |
| `housingType` | طبيعة السكن | chip | — (قائمة فاضية حالياً، الأدمن بيضيف) |
| `walls` | الحوائط | chip | — (قائمة فاضية حالياً، الأدمن بيضيف) |
| `roof` | السقف | chip | — (قائمة فاضية حالياً، الأدمن بيضيف) |
| `floor` | الأرضية | chip | — (قائمة فاضية حالياً، الأدمن بيضيف) |
| `entrance` | المدخل | chip | — (قائمة فاضية حالياً، الأدمن بيضيف) |
| `bathroomCondition` | حالة دورات المياه | chip | — (قائمة فاضية حالياً، الأدمن بيضيف) |
| `electricity` | الكهرباء | chip | — (قائمة فاضية حالياً، الأدمن بيضيف) |
| `waterMeter` | عداد المياه | chip | — (قائمة فاضية حالياً، الأدمن بيضيف) |
| `waterMotor` | موتور مياه | chip | — (قائمة فاضية حالياً، الأدمن بيضيف) |
| `fridge` | الثلاجة | chip | — (قائمة فاضية حالياً، الأدمن بيضيف) |
| `washer` | الغسالة | chip | — (قائمة فاضية حالياً، الأدمن بيضيف) |
| `oven` | فرن خبيز | chip | — (قائمة فاضية حالياً، الأدمن بيضيف) |
| `cookingAppliances` | أجهزة الطبخ | chip | — (قائمة فاضية حالياً، الأدمن بيضيف) |
| `computer` | حاسب آلي | chip | — (قائمة فاضية حالياً، الأدمن بيضيف) |
| `tv` | التلفاز | chip | — (قائمة فاضية حالياً، الأدمن بيضيف) |
| `freezer` | ديب فريزر | chip | — (قائمة فاضية حالياً، الأدمن بيضيف) |
| `transportation` | وسيلة مواصلات | chip | — (قائمة فاضية حالياً، الأدمن بيضيف) |
| `internet` | إنترنت | chip | — (قائمة فاضية حالياً، الأدمن بيضيف) |
| `livestock` | أنواع المواشي | chip | — (قائمة فاضية حالياً، الأدمن بيضيف) |
| `لحوم` | لحوم | support | `لحوم` · `نص كيلو` · `كيلو` |
| `كرتونة مواد غذائية` | كرتونة مواد غذائية | support | `كرتونة مواد غذائية` |
| `زي مدرسي ومصروفات دراسية` | زي مدرسي ومصروفات دراسية | support | `زي مدرسي ومصروفات دراسية` |
| `دعم طبي` | دعم طبي | support | `دعم طبي` · `علاج` · `عمليات` · `طرف صناعي` · `كرسي متحرك` · `سماعة` · `منح` |
| `جهاز عرايس` | جهاز عرايس | support | `جهاز عرايس` |
| `منح دراسية` | منح دراسية | support | `منح دراسية` |
| `دعم المرافق` | دعم المرافق | support | `دعم المرافق` · `وصلة مية` · `وصلة كهرباء` · `حمام` · `سقف` · `صرف صحي` · `بناء` |
| `دعم أجهزة منزلية وأثاث منزلي` | دعم أجهزة منزلية وأثاث منزلي | support | `دعم أجهزة منزلية وأثاث منزلي` |
| `مرشح بنك الطعام` | مرشح بنك الطعام | support | `مرشح بنك الطعام` |


**قوائم السكن والأجهزة (chips) فاضية** في الإعداد الأولي وعلى الإنتاج — الأدمن يضيف خياراتها من شاشة القوائم. القيم الموجودة فعلاً في بيانات الإكسيل القديمة (ودي اللي هتظهر في الحالات القديمة):

| الحقل | القيم في البيانات القديمة |
|---|---|
| `housing.ownership (طبيعة السكن)` | خاص · منزل عائلة · ايجار |
| `housing.roof (السقف)` | مسلح · خشب · جريد · سعف · بدون |
| `housing.floor (الأرضية)` | سيراميك · أسمنت · بلاط · تراب |
| `housing.entrance (المدخل)` | سيراميك · أسمنت · بلاط · تراب · رخام |
| `housing.walls (الحوائط)` | دهان · محارة · بلوك · طوب احمر · طوب لبن |
| `housing.bathroomType (طبيعة دورات المياه)` | خاص · مشترك |
| `housing.bathroomCondition (حالة دورات المياه)` | ادمي · غير ادمي |
| `housing.electricity / housing.water` | عداد · ممارسة · لا يوجد |
| `housing.transport (وسيلة مواصلات)` | أخري · موتوسيكل · توك توك · سيارة |
| `appliances[cookingAppliances].details` | بوتوجاز · شعلة |
| `appliances[tv].details` | تلفاز · شاشة |
| `appliances[washer].details` | هاف · عادية · اوتوماتيك |
| `appliances[computer].details` | للتعليم · للتسلية |

الخانة اللي فيها أكتر من اختيار في البيانات القديمة محفوظة بالشكل `«أ | ب»` (مثلاً `مسلح | خشب`) — اعرضوها زي ما هي.

> الجدول ده من قاعدة بيانات تجريبية جديدة (القيم الأساسية). على الإنتاج الأدمن ممكن يكون ضاف خيارات — **اقروا من الـ API دايماً، ماتكتبوش القيم في الكود.**

## 19. مرجع كل الـ Endpoints

> **الحقول المطلوبة وحدودها** (الطول، القيم المسموحة) بيتفحصوا في السيرفر: أي حقل ناقص أو غلط بيرجع `422` وفي `error.details` اسم الحقل بالظبط ورسالة عربية. الأمثلة الناجحة تحت بتوضح القيم الصح. جدول الحقول بيوضح الاسم والنوع.

لكل endpoint: الصلاحية، الأدوار المسموحة، حد الطلبات، Idempotency، الـ parameters، حقول الـ body، وأمثلة **حقيقية** (request + response) من تشغيل فعلي على بيانات تجريبية (الـ IDs مكتوبة كـ `{{variable}}` زي الـ Postman). الأمثلة الطويلة متقصّرة (`… N more`).

### 19.1 System

#### `GET /api/v1/system/version`

- **الصلاحية:** بدون توكن · **الأدوار:** anyone (no token) · **حد الطلبات:** global 600/min/user

**مثال — API version** (`no token`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "service": "Nahda.Api",
    "version": "1.0.0.0",
    "environment": "Development",
    "apiVersion": "v1"
  },
  "message": null
}
```

#### `GET /health/live`
_Liveness_

- **الصلاحية:** بدون توكن · **الأدوار:** anyone (no token) · **حد الطلبات:** global

**مثال — Liveness** (`no token`, `X-Client-Type: web`) → **200**

```
Healthy
```

#### `GET /health/ready`
_Readiness (database + cache)_

- **الصلاحية:** بدون توكن · **الأدوار:** anyone (no token) · **حد الطلبات:** global

**مثال — Readiness** (`no token`, `X-Client-Type: web`) → **200**

```
Healthy
```

### 19.2 Auth

#### `POST /api/v1/auth/login`

- **الصلاحية:** بدون توكن · **الأدوار:** anyone (no token) · **حد الطلبات:** no limit

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `email` | string |
| `password` | string |

</details>

**مثال — Login (manager, web)** (`no token`, `X-Client-Type: web`) → **200**

```json
{
  "email": "manager@demo.nahda",
  "password": "{{password}}"
}
```
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJSUzI1NiIsImtp…(JWT)",
    "refreshToken": "wpVoECVTjah1…",
    "expiresIn": 899,
    "user": {
      "id": "fc08da9e-d5ff-429d-8a7c-f35d68037179",
      "fullName": "مستخدم تجريبي manager",
      "email": "manager@demo.nahda",
      "role": "manager",
      "permissions": [
        "create_case",
        "view_cases",
        "… 9 more"
      ]
    }
  },
  "message": null
}
```

**مثال — Login (reviewer, web)** (`no token`, `X-Client-Type: web`) → **200**

```json
{
  "email": "reviewer@demo.nahda",
  "password": "{{password}}"
}
```
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJSUzI1NiIsImtp…(JWT)",
    "refreshToken": "rQClo42ADc7U…",
    "expiresIn": 899,
    "user": {
      "id": "0b284898-da8e-4eac-b685-833b553d6097",
      "fullName": "مستخدم تجريبي reviewer",
      "email": "reviewer@demo.nahda",
      "role": "reviewer",
      "permissions": [
        "create_case",
        "view_cases",
        "… 6 more"
      ]
    }
  },
  "message": null
}
```

**مثال — Login (data_entry, web)** (`no token`, `X-Client-Type: web`) → **200**

```json
{
  "email": "data_entry@demo.nahda",
  "password": "{{password}}"
}
```
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJSUzI1NiIsImtp…(JWT)",
    "refreshToken": "PdYvdJpLUy7a…",
    "expiresIn": 899,
    "user": {
      "id": "2439b401-9753-4a17-b2d8-d44edc07b8f2",
      "fullName": "مستخدم تجريبي data_entry",
      "email": "data_entry@demo.nahda",
      "role": "data_entry",
      "permissions": [
        "create_case",
        "view_cases",
        "… 6 more"
      ]
    }
  },
  "message": null
}
```

#### `POST /api/v1/auth/logout`

- **الصلاحية:** بدون توكن · **الأدوار:** anyone (no token) · **حد الطلبات:** auth 20/min/IP

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `refreshToken` | string |

</details>

**مثال — Logout (revokes the refresh token)** (`no token`, `X-Client-Type: web`) → **200**

```json
{
  "refreshToken": "{{refreshTok…"
}
```
```json
{
  "success": true,
  "message": null
}
```

#### `GET /api/v1/auth/me`

- **الصلاحية:** `(any signed-in user)` · **الأدوار:** all roles · **حد الطلبات:** global 600/min/user

**مثال — Current user (me)** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "id": "fc08da9e-d5ff-429d-8a7c-f35d68037179",
    "fullName": "مستخدم تجريبي manager",
    "email": "manager@demo.nahda",
    "role": "manager",
    "permissions": [
      "create_case",
      "view_cases",
      "… 9 more"
    ]
  },
  "message": null
}
```

#### `POST /api/v1/auth/refresh`

- **الصلاحية:** بدون توكن · **الأدوار:** anyone (no token) · **حد الطلبات:** auth 20/min/IP

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `refreshToken` | string |

</details>

**مثال — Refresh (rotates the refresh token)** (`no token`, `X-Client-Type: web`) → **200**

```json
{
  "refreshToken": "{{refreshTok…"
}
```
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJSUzI1NiIsImtp…(JWT)",
    "refreshToken": "tdpDqTqmYfTo…",
    "expiresIn": 899
  },
  "message": null
}
```

**مثال — Reusing a rotated refresh token → 401 TOKEN_REVOKED (whole session revoked)** (`no token`, `X-Client-Type: web`) → **401**

```json
{
  "refreshToken": "{{oldRefresh…"
}
```
```json
{
  "success": false,
  "error": {
    "code": "TOKEN_REVOKED",
    "message": "تم اكتشاف إعادة استخدام رمز التجديد — تم إلغاء الجلسة، برجاء تسجيل الدخول مجددًا"
  }
}
```

### 19.3 Cases

#### `GET /api/v1/cases`

- **الصلاحية:** `view_cases` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** global 600/min/user
- **Parameters:** `status` (query, string), `bookmarked` (query, boolean), `page` (query, integer), `limit` (query, integer)

**مثال — No token → 401** (`no token`, `X-Client-Type: web`) → **401**

```
(empty body)
```

**مثال — List cases (paged)** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "{{caseIdTmp}}",
        "caseNumber": "CASE-2",
        "displayId": "#2",
        "status": "draft",
        "priority": "medium",
        "beneficiaryFullName": "سعاد إبراهيم حسن",
        "nationalId": "29002202201238",
        "charityId": null,
        "registrationDate": "2026-09-25",
        "completionPercentage": 0.0,
        "createdAtUtc": "2026-09-25T02:23:28.448331+00:00",
        "nextVisitDate": null,
        "nextVisitStartTimeUtc": null,
        "nextVisitLocation": null,
        "isBookmarked": false,
        "returnedBy": null,
        "phonePrimary": null,
        "centerId": "{{centerId}}",
        "villageId": "{{villageId}}",
        "centerName": "إهناسيا",
        "villageName": "قرية النهضة التجريبية",
        "charityName": null
      },
      {
        "id": "{{caseId}}",
        "caseNumber": "CASE-1",
        "displayId": "#1",
        "status": "draft",
        "priority": "high",
        "beneficiaryFullName": "محمود عبد الرحمن سالم",
        "nationalId": "28501152201234",
        "charityId": "{{charityId}}",
        "registrationDate": "2026-09-25",
        "completionPercentage": 0.0,
        "createdAtUtc": "2026-09-25T02:23:28.151283+00:00",
        "nextVisitDate": null,
        "nextVisitStartTimeUtc": null,
        "nextVisitLocation": null,
        "isBookmarked": false,
        "returnedBy": null,
        "phonePrimary": "01011112222",
        "centerId": "{{centerId}}",
        "villageId": "{{villageId}}",
        "centerName": "إهناسيا",
        "villageName": "قرية النهضة التجريبية",
        "charityName": "جمعية تجريبية لتنمية المجتمع (معدلة)"
      }
    ],
    "page": 1,
    "limit": 20,
    "total": 2,
    "totalPages": 1,
    "hasNext": false,
    "hasPrev": false
  },
  "message": null
}
```

**مثال — List cases by status** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "{{caseIdTmp}}",
        "caseNumber": "CASE-2",
        "displayId": "#2",
        "status": "draft",
        "priority": "medium",
        "beneficiaryFullName": "سعاد إبراهيم حسن",
        "nationalId": "29002202201238",
        "charityId": null,
        "registrationDate": "2026-09-25",
        "completionPercentage": 0.0,
        "createdAtUtc": "2026-09-25T02:23:28.448331+00:00",
        "nextVisitDate": null,
        "nextVisitStartTimeUtc": null,
        "nextVisitLocation": null,
        "isBookmarked": false,
        "returnedBy": null,
        "phonePrimary": null,
        "centerId": "{{centerId}}",
        "villageId": "{{villageId}}",
        "centerName": "إهناسيا",
        "villageName": "قرية النهضة التجريبية",
        "charityName": null
      },
      {
        "id": "{{caseId}}",
        "caseNumber": "CASE-1",
        "displayId": "#1",
        "status": "draft",
        "priority": "high",
        "beneficiaryFullName": "محمود عبد الرحمن سالم",
        "nationalId": "28501152201234",
        "charityId": "{{charityId}}",
        "registrationDate": "2026-09-25",
        "completionPercentage": 0.0,
        "createdAtUtc": "2026-09-25T02:23:28.151283+00:00",
        "nextVisitDate": null,
        "nextVisitStartTimeUtc": null,
        "nextVisitLocation": null,
        "isBookmarked": false,
        "returnedBy": null,
        "phonePrimary": "01011112222",
        "centerId": "{{centerId}}",
        "villageId": "{{villageId}}",
        "centerName": "إهناسيا",
        "villageName": "قرية النهضة التجريبية",
        "charityName": "جمعية تجريبية لتنمية المجتمع (معدلة)"
      }
    ],
    "page": 1,
    "limit": 20,
    "total": 2,
    "totalPages": 1,
    "hasNext": false,
    "hasPrev": false
  },
  "message": null
}
```

#### `POST /api/v1/cases`

- **الصلاحية:** `create_case` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** global 600/min/user

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `beneficiary` | CreateCaseBeneficiaryRequest |
| `beneficiary.fullName` | string |
| `beneficiary.nationalId` | string |
| `beneficiary.phonePrimary` | string |
| `beneficiary.centerId` | uuid |
| `beneficiary.villageId` | uuid |
| `beneficiary.address` | string |
| `charityId` | uuid |
| `priority` | string |
| `familyMembers` | CreateCaseFamilyMembersRequest |
| `familyMembers.members` | FamilyMemberInput[] |
| `familyMembers.members[].name` | string |
| `familyMembers.members[].relation` | string |
| `familyMembers.members[].nationalId` | string |
| `familyMembers.members[].age` | integer |
| `familyMembers.members[].gender` | string |
| `familyMembers.members[].isStudent` | boolean |
| `familyMembers.members[].educationStage` | string |
| `familyMembers.members[].grade` | string |
| `familyMembers.members[].university` | string |
| `familyMembers.members[].education` | string |
| `familyMembers.members[].job` | string |
| `familyMembers.members[].monthlyIncome` | number |
| `familyMembers.members[].takafulBeneficiary` | boolean |
| `familyMembers.members[].takafulAmount` | number |
| `familyMembers.members[].notes` | string |
| `familyMembers.members[].sortOrder` | integer |
| `familyMembers.members[].birthDate` | date (yyyy-MM-dd) |
| `familyMembers.members[].phone` | string |
| `housing` | CreateCaseHousingInput |
| `housing.description` | string |
| `housing.ownership` | string |
| `housing.buildingType` | string |
| `housing.walls` | string |
| `housing.roof` | string |
| `housing.floor` | string |
| `housing.entrance` | string |
| `housing.roomsCount` | string |
| `housing.bathroomCondition` | string |
| `housing.sanitation` | string |
| `housing.electricity` | string |
| `housing.water` | string |
| `housing.waterMotor` | boolean |
| `housing.transport` | string |
| `housing.internet` | boolean |
| `housing.bathroomType` | string |
| `utilities` | CreateCaseUtilitiesRequest |
| `utilities.appliances` | ApplianceInput[] |
| `utilities.appliances[].applianceKey` | string |
| `utilities.appliances[].isPresent` | boolean |
| `utilities.appliances[].details` | string |
| `utilities.utilities` | UtilityInput[] |
| `utilities.utilities[].name` | string |
| `utilities.utilities[].isAvailable` | boolean |
| `utilities.utilities[].condition` | string |
| `utilities.utilities[].sourceOrMeter` | string |
| `utilities.utilities[].notes` | string |
| `agriculture` | CreateCaseAgricultureInput |
| `agriculture.hasLand` | string |
| `agriculture.landAreaFeddan` | number |
| `agriculture.landType` | string |
| `agriculture.landRentAmount` | number |
| `agriculture.annualLandIncome` | number |
| `agriculture.cropType` | string |
| `agriculture.hasLivestock` | string |
| `agriculture.selectedLivestock` | string[] |
| `agriculture.livestockOther` | string |
| `agriculture.livestockDetails` | string |
| `agriculture.notes` | string |
| `agriculture.visited` | boolean |
| `classification` | CreateCaseClassificationInput |
| `classification.mainClassifications` | string[] |
| `classification.subClassification` | string |
| `classification.needLevel` | string |
| `classification.priorityLevel` | string |
| `classification.vulnerabilityLevel` | string |
| `classification.notes` | string |
| `assessedNeeds` | CreateCaseAssessedNeedsRequest |
| `assessedNeeds.needs` | AssessedNeedInput[] |
| `assessedNeeds.needs[].needType` | string |
| `assessedNeeds.needs[].category` | string |
| `assessedNeeds.needs[].description` | string |
| `assessedNeeds.needs[].priorityLevel` | string |
| `assessedNeeds.needs[].reason` | string |
| `assessedNeeds.needs[].source` | string |
| `assessedNeeds.needs[].status` | string |
| `assessedNeeds.needs[].notes` | string |
| `financial` | CreateCaseFinancialRequest |
| `financial.incomeItems` | IncomeItemInput[] |
| `financial.incomeItems[].label` | string |
| `financial.incomeItems[].amount` | number |
| `financial.incomeItems[].period` | string |
| `financial.expenseItems` | ExpenseItemInput[] |
| `financial.expenseItems[].category` | string |
| `financial.expenseItems[].amount` | number |
| `financial.expenseItems[].period` | string |

</details>

**مثال — Create case (full body, every section optional except beneficiary)** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "beneficiary": {
    "fullName": "محمود عبد الرحمن سالم",
    "nationalId": "28501152201234",
    "phonePrimary": "01011112222",
    "centerId": "{{centerId}}",
    "villageId": "{{villageId}}",
    "address": "شارع المدرسة"
  },
  "charityId": "{{charityId}}",
  "priority": "high",
  "familyMembers": {
    "members": [
      {
        "name": "فاطمة أحمد علي",
        "relation": "زوجة",
        "nationalId": "28803012201111",
        "age": 38,
        "gender": "أنثى",
        "isStudent": false,
        "educationStage": null,
        "grade": null,
        "university": null,
        "education": "دبلوم",
        "job": "ربة منزل",
        "monthlyIncome": 0,
        "takafulBeneficiary": false,
        "takafulAmount": null,
        "notes": null,
        "sortOrder": 0,
        "birthDate": "1988-03-01",
        "phone": "01022223333"
      },
      {
        "name": "أحمد محمود عبد الرحمن",
        "relation": "ابن",
        "nationalId": null,
        "age": 12,
        "gender": "ذكر",
        "isStudent": true,
        "educationStage": "ابتدائي",
        "grade": "السادس",
        "university": null,
        "education": "ابتدائي",
        "job": null,
        "monthlyIncome": null,
        "takafulBeneficiary": false,
        "takafulAmount": null,
        "notes": null,
        "sortOrder": 1,
        "birthDate": "2014-02-10",
        "phone": null
      }
    ]
  },
  "housing": {
    "description": "الأسرة تقيم في منزل عائلة من طابقين، الأب يعمل باليومية في الزراعة ودخله غير ثابت، والأم ربة منزل. الأبناء في مراحل التعليم المختلفة ويحتاجون إلى دعم في المصروفات الدراسية والزي المدرسي. الأسرة تقيم في منزل عائلة من طابقين، الأب يعمل باليومية في الزراعة ودخله غير ثابت، والأم ربة …",
    "ownership": "منزل عائلة",
    "buildingType": null,
    "walls": "دهان",
    "roof": "خشب",
    "floor": "أسمنت",
    "entrance": "أسمنت",
    "roomsCount": "3",
    "bathroomCondition": "ادمي",
    "sanitation": null,
    "electricity": "عداد",
    "water": "عداد",
    "waterMotor": false,
    "transport": null,
    "internet": false,
    "bathroomType": "خاص"
  },
  "utilities": {
    "appliances": [
      {
        "applianceKey": "fridge",
        "isPresent": true,
        "details": null
      },
      {
        "applianceKey": "washer",
        "isPresent": true,
        "details": "هاف"
      },
      {
        "applianceKey": "tv",
        "isPresent": true,
        "details": "شاشة"
      }
    ],
    "utilities": []
  },
  "agriculture": {
    "hasLand": "no",
    "landAreaFeddan": null,
    "landType": null,
    "landRentAmount": null,
    "annualLandIncome": null,
    "cropType": null,
    "hasLivestock": "no",
    "selectedLivestock": null,
    "livestockOther": null,
    "livestockDetails": null,
    "notes": null,
    "visited": true
  },
  "classification": {
    "mainClassifications": [
      "فقر"
    ],
    "subClassification": null,
    "needLevel": "high",
    "priorityLevel": "high",
    "vulnerabilityLevel": null,
    "notes": null
  },
  "assessedNeeds": {
    "needs": [
      {
        "needType": "مصروفات دراسية",
        "category": null,
        "description": null,
        "priorityLevel": "high",
        "reason": "طالب في المرحلة الابتدائية",
        "source": "البحث الميداني",
        "status": "مؤكد",
        "notes": null
      }
    ]
  },
  "financial": {
    "incomeItems": [
      {
        "label": "معاش",
        "amount": 900,
        "period": "شهري"
      }
    ],
    "expenseItems": [
      {
        "category": "الأكل والشرب",
        "amount": 2500,
        "period": "شهري"
      },
      {
        "category": "المصروفات الدراسية",
        "amount": 300,
        "period": "شهري"
      },
      "… 4 more"
    ]
  }
}
```
```json
{
  "success": true,
  "data": {
    "id": "{{caseId}}",
    "caseNumber": "CASE-1",
    "status": "draft"
  },
  "message": null
}
```

**مثال — Create case (minimal: beneficiary only)** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "beneficiary": {
    "fullName": "سعاد إبراهيم حسن",
    "nationalId": "29002202201238",
    "phonePrimary": null,
    "centerId": "{{centerId}}",
    "villageId": "{{villageId}}",
    "address": null
  },
  "charityId": null,
  "priority": null
}
```
```json
{
  "success": true,
  "data": {
    "id": "{{caseIdTmp}}",
    "caseNumber": "CASE-2",
    "status": "draft"
  },
  "message": null
}
```

**مثال — Duplicate national ID → 409 DUPLICATE_NATIONAL_ID** (`data_entry`, `X-Client-Type: web`) → **409**

```json
{
  "beneficiary": {
    "fullName": "اسم آخر",
    "nationalId": "28501152201234",
    "phonePrimary": null,
    "centerId": "{{centerId}}",
    "villageId": "{{villageId}}",
    "address": null
  },
  "charityId": null,
  "priority": null
}
```
```json
{
  "success": false,
  "error": {
    "code": "DUPLICATE_NATIONAL_ID",
    "message": "يوجد حالة مسجلة بالفعل بهذا الرقم القومي",
    "details": {
      "existingCaseNumber": [
        "CASE-1"
      ],
      "existingCaseStatus": [
        "draft"
      ]
    }
  }
}
```

#### `GET /api/v1/cases/{id}`

- **الصلاحية:** `view_cases` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** global 600/min/user
- **Parameters:** `id` (path, required, uuid)

**مثال — Case details (everything in one call)** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "id": "{{caseId}}",
    "caseNumber": "CASE-1",
    "displayId": "#1",
    "status": "draft",
    "priority": "high",
    "charityId": "{{charityId}}",
    "registrationDate": "2026-09-25",
    "createdAtUtc": "2026-09-25T02:23:28.151283+00:00",
    "updatedAtUtc": null,
    "rowVersion": 2276,
    "beneficiary": {
      "fullName": "محمود عبد الرحمن سالم",
      "nationalId": "28501152201234",
      "age": 41,
      "gender": "male",
      "birthGovernorate": "بني سويف",
      "phonePrimary": "01011112222",
      "phoneSecondary": null,
      "address": "شارع المدرسة",
      "centerId": "{{centerId}}",
      "villageId": "{{villageId}}",
      "rowVersion": 2276,
      "email": null,
      "street": null,
      "buildingNumber": null,
      "floor": null,
      "apartmentNumber": null,
      "landmark": null,
      "area": null,
      "employer": null
    },
    "completion": {
      "percentage": 88.89,
      "isReady": false
    },
    "workflow": {
      "currentStage": "draft",
      "availableActions": [
        "assign"
      ]
    },
    "returnInfo": null,
    "workerOpinionDetailedReport": null,
    "familyMembers": {
      "members": [
        {
          "id": "78aa3cc1-5f81-4c25-af5b-8092df49aa57",
          "name": "فاطمة أحمد علي",
          "relation": "زوجة",
          "nationalId": "28803012201111",
          "age": 38,
          "gender": "أنثى",
          "isStudent": false,
          "educationStage": null,
          "grade": null,
          "university": null,
          "education": "دبلوم",
          "job": "ربة منزل",
          "monthlyIncome": 0.0,
          "takafulBeneficiary": false,
          "takafulAmount": null,
          "notes": null,
          "sortOrder": 0,
          "computedCurrentAge": 38,
          "computedCurrentEducationStage": null,
          "birthDate": "1988-03-01",
          "phone": "01022223333"
        },
        {
          "id": "01b166a4-493c-4612-916d-7f501fe0f10b",
          "name": "أحمد محمود عبد الرحمن",
          "relation": "ابن",
          "nationalId": null,
          "age": 12,
          "gender": "ذكر",
          "isStudent": true,
          "educationStage": "ابتدائي",
          "grade": "السادس",
          "university": null,
          "education": "ابتدائي",
          "job": null,
          "monthlyIncome": null,
          "takafulBeneficiary": false,
          "takafulAmount": null,
          "notes": null,
          "sortOrder": 1,
          "computedCurrentAge": null,
          "computedCurrentEducationStage": null,
          "birthDate": "2014-02-10",
          "phone": null
        }
      ],
      "caseRowVersion": 2276
    },
    "housing": {
      "description": "الأسرة تقيم في منزل عائلة من طابقين، الأب يعمل باليومية في الزراعة ودخله غير ثابت، والأم ربة منزل. الأبناء في مراحل التعليم المختلفة ويحتاجون إلى دعم في المصروفات الدراسية والزي المدرسي. الأسرة تقيم في منزل عائلة من طابقين، الأب يعمل باليومية في الزراعة ودخله غير ثابت، والأم ربة …",
      "ownership": "منزل عائلة",
      "buildingType": null,
      "walls": "دهان",
      "roof": "خشب",
      "floor": "أسمنت",
      "entrance": "أسمنت",
      "roomsCount": "3",
      "bathroomCondition": "ادمي",
      "sanitation": null,
      "electricity": "عداد",
      "water": "عداد",
      "waterMotor": false,
      "transport": null,
      "internet": false,
      "rowVersion": 2276,
      "bathroomType": "خاص"
    },
    "utilities": {
      "appliances": [
        {
          "applianceKey": "fridge",
          "isPresent": true,
          "details": null
        },
        {
          "applianceKey": "tv",
          "isPresent": true,
          "details": "شاشة"
        },
        {
          "applianceKey": "washer",
          "isPresent": true,
          "details": "هاف"
        }
      ],
      "utilities": [],
      "caseRowVersion": 2276
    },
    "agriculture": {
      "hasLand": "no",
      "landAreaFeddan": null,
      "landType": null,
      "landRentAmount": null,
      "annualLandIncome": null,
      "cropType": null,
      "hasLivestock": "no",
      "selectedLivestockJson": null,
      "livestockOther": null,
      "livestockDetails": null,
      "notes": null,
      "visited": true,
      "rowVersion": 2276,
      "selectedLivestock": []
    },
    "financial": {
      "incomeItems": [
        {
          "label": "دخل رب الأسرة",
          "amount": 0,
          "period": "شهري",
          "isAuto": true,
          "source": "beneficiary",
          "isFixed": false
        },
        {
          "label": "تكافل وكرامة",
          "amount": 0,
          "period": "شهري",
          "isAuto": true,
          "source": "beneficiary+family",
          "isFixed": false
        },
        "… 2 more"
      ],
      "expenseItems": [
        {
          "label": "إيجار الأراضي الزراعية",
          "amount": 0,
          "period": "شهري",
          "isAuto": true,
          "source": "agriculture",
          "isFixed": false
        },
        {
          "label": "الأكل والشرب",
          "amount": 2500.0,
          "period": "شهري",
          "isAuto": false,
          "source": null,
          "isFixed": true
        },
        "… 5 more"
      ],
      "totalIncome": 900.0,
      "totalExpenses": 3350.0,
      "netBalance": -2450.0,
      "incomePerMember": -816.67,
      "classification": "severe_deficit",
      "caseRowVersion": 2276
    },
    "initialNeeds": {
      "needs": [],
      "caseRowVersion": 2276
    },
    "classification": {
      "mainClassificationsJson": "[\"فقر\"]",
      "subClassification": null,
      "needLevel": "high",
      "priorityLevel": "high",
      "vulnerabilityLevel": null,
      "notes": null,
      "rowVersion": 2276,
      "mainClassifications": [
        "فقر"
      ]
    },
    "assessedNeeds": {
      "needs": [
        {
          "id": "59c52522-931f-4a24-8c89-32fcb65f4714",
          "needType": "مصروفات دراسية",
          "category": null,
          "description": null,
          "priorityLevel": "high",
          "reason": "طالب في المرحلة الابتدائية",
          "source": "البحث الميداني",
          "status": "مؤكد",
          "notes": null
        }
      ],
      "caseRowVersion": 2276
    },
    "opinions": {
      "worker": null,
      "reviewer": null,
      "manager": null,
      "workerHistory": []
    }
  },
  "message": null
}
```

**مثال — Case 2 details after return (returnInfo, availableActions)** (`social_worker`, `X-Client-Type: mobile`) → **200**

```json
{
  "success": true,
  "data": {
    "id": "{{caseIdTmp}}",
    "caseNumber": "CASE-2",
    "displayId": "#2",
    "status": "returned_to_worker",
    "priority": "medium",
    "charityId": null,
    "registrationDate": "2026-09-25",
    "createdAtUtc": "2026-09-25T02:23:28.448331+00:00",
    "updatedAtUtc": "2026-09-25T02:23:31.828244+00:00",
    "rowVersion": 2395,
    "beneficiary": {
      "fullName": "سعاد إبراهيم حسن",
      "nationalId": "29002202201238",
      "age": 36,
      "gender": "male",
      "birthGovernorate": "بني سويف",
      "phonePrimary": null,
      "phoneSecondary": null,
      "address": null,
      "centerId": "{{centerId}}",
      "villageId": "{{villageId}}",
      "rowVersion": 2278,
      "email": null,
      "street": null,
      "buildingNumber": null,
      "floor": null,
      "apartmentNumber": null,
      "landmark": null,
      "area": null,
      "employer": null
    },
    "completion": {
      "percentage": 100,
      "isReady": true
    },
    "workflow": {
      "currentStage": "returned_to_worker",
      "availableActions": [
        "submit_worker_opinion"
      ]
    },
    "returnInfo": {
      "returnedBy": "manager",
      "returnedByName": "مستخدم تجريبي manager",
      "reason": "مطلوب صورة البطاقة",
      "returnedAtUtc": "2026-09-25T02:23:31.829407+00:00"
    },
    "workerOpinionDetailedReport": null,
    "familyMembers": {
      "members": [
        {
          "id": "070d8354-e5e9-4c7f-8878-87b6a61b32e2",
          "name": "أحمد محمود عبد الرحمن",
          "relation": "ابن",
          "nationalId": null,
          "age": 12,
          "gender": "ذكر",
          "isStudent": true,
          "educationStage": "ابتدائي",
          "grade": "السادس",
          "university": null,
          "education": "ابتدائي",
          "job": null,
          "monthlyIncome": null,
          "takafulBeneficiary": false,
          "takafulAmount": null,
          "notes": null,
          "sortOrder": 1,
          "computedCurrentAge": null,
          "computedCurrentEducationStage": null,
          "birthDate": "2014-02-10",
          "phone": null
        }
      ],
      "caseRowVersion": 2395
    },
    "housing": {
      "description": "الأسرة تقيم في منزل عائلة من طابقين، الأب يعمل باليومية في الزراعة ودخله غير ثابت، والأم ربة منزل. الأبناء في مراحل التعليم المختلفة ويحتاجون إلى دعم في المصروفات الدراسية والزي المدرسي. الأسرة تقيم في منزل عائلة من طابقين، الأب يعمل باليومية في الزراعة ودخله غير ثابت، والأم ربة …",
      "ownership": "منزل عائلة",
      "buildingType": null,
      "walls": "دهان",
      "roof": "خشب",
      "floor": "أسمنت",
      "entrance": "أسمنت",
      "roomsCount": "3",
      "bathroomCondition": "ادمي",
      "sanitation": null,
      "electricity": "عداد",
      "water": "عداد",
      "waterMotor": false,
      "transport": null,
      "internet": false,
      "rowVersion": 2379,
      "bathroomType": "خاص"
    },
    "utilities": {
      "appliances": [
        {
          "applianceKey": "fridge",
          "isPresent": true,
          "details": null
        }
      ],
      "utilities": [],
      "caseRowVersion": 2395
    },
    "agriculture": {
      "hasLand": "no",
      "landAreaFeddan": null,
      "landType": null,
      "landRentAmount": null,
      "annualLandIncome": null,
      "cropType": null,
      "hasLivestock": "no",
      "selectedLivestockJson": null,
      "livestockOther": null,
      "livestockDetails": null,
      "notes": null,
      "visited": true,
      "rowVersion": 2380,
      "selectedLivestock": []
    },
    "financial": {
      "incomeItems": [
        {
          "label": "دخل رب الأسرة",
          "amount": 0,
          "period": "شهري",
          "isAuto": true,
          "source": "beneficiary",
          "isFixed": false
        },
        {
          "label": "تكافل وكرامة",
          "amount": 0,
          "period": "شهري",
          "isAuto": true,
          "source": "beneficiary+family",
          "isFixed": false
        },
        {
          "label": "دخل الأرض الزراعية",
          "amount": 0,
          "period": "شهري",
          "isAuto": true,
          "source": "agriculture",
          "isFixed": false
        }
      ],
      "expenseItems": [
        {
          "label": "إيجار الأراضي الزراعية",
          "amount": 0,
          "period": "شهري",
          "isAuto": true,
          "source": "agriculture",
          "isFixed": false
        },
        {
          "label": "الإيجار",
          "amount": 0.0,
          "period": null,
          "isAuto": false,
          "source": null,
          "isFixed": true
        },
        "… 4 more"
      ],
      "totalIncome": 0,
      "totalExpenses": 0.0,
      "netBalance": 0.0,
      "incomePerMember": 0.0,
      "classification": "critical_subsistence",
      "caseRowVersion": 2395
    },
    "initialNeeds": {
      "needs": [
        {
          "id": "aa03c4e0-c6ff-4bc9-b42d-ef208efe80a5",
          "needType": "غذاء",
          "needCategory": null,
          "description": null,
          "priorityLevel": "high",
          "details": null,
          "notes": null
        }
      ],
      "caseRowVersion": 2395
    },
    "classification": {
      "mainClassificationsJson": "[\"فقر\"]",
      "subClassification": null,
      "needLevel": "high",
      "priorityLevel": "high",
      "vulnerabilityLevel": null,
      "notes": null,
      "rowVersion": 2381,
      "mainClassifications": [
        "فقر"
      ]
    },
    "assessedNeeds": {
      "needs": [
        {
          "id": "a755a63d-bbc7-4d45-b1a3-acb727544023",
          "needType": "غذاء",
          "category": null,
          "description": null,
          "priorityLevel": "high",
          "reason": null,
          "source": "تأكيد",
          "status": "مؤكد",
          "notes": null
        }
      ],
      "caseRowVersion": 2395
    },
    "opinions": {
      "worker": {
        "id": "92732a70-0546-4380-93c0-59ed2385692b",
        "decision": "accepted",
        "notes": "تم الاستكمال",
        "authorId": "{{workerId}}",
        "authorName": "مستخدم تجريبي social_worker",
        "isSubmitted": true,
        "returnReason": null,
        "detailedReport": null,
        "createdAtUtc": "2026-09-25T02:23:31.669479+00:00",
        "updatedAtUtc": null
      },
      "reviewer": null,
      "manager": null,
      "workerHistory": [
        {
          "id": "5b9c03e1-0aca-4ef7-83fc-c34a60be0f2e",
          "decision": "accepted",
          "notes": "مستحقة",
          "authorId": "{{workerId}}",
          "authorName": "مستخدم تجريبي social_worker",
          "isSubmitted": true,
          "returnReason": null,
          "detailedReport": null,
          "createdAtUtc": "2026-09-25T02:23:31.522872+00:00",
          "updatedAtUtc": null
        },
        {
          "id": "92732a70-0546-4380-93c0-59ed2385692b",
          "decision": "accepted",
          "notes": "تم الاستكمال",
          "authorId": "{{workerId}}",
          "authorName": "مستخدم تجريبي social_worker",
          "isSubmitted": true,
          "returnReason": null,
          "detailedReport": null,
          "createdAtUtc": "2026-09-25T02:23:31.669479+00:00",
          "updatedAtUtc": null
        }
      ]
    }
  },
  "message": null
}
```

#### `DELETE /api/v1/cases/{id}/bookmark`

- **الصلاحية:** `view_cases` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** global 600/min/user
- **Parameters:** `id` (path, required, uuid)

**مثال — Remove bookmark** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "bookmarked": false
  },
  "message": null
}
```

#### `POST /api/v1/cases/{id}/bookmark`

- **الصلاحية:** `view_cases` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** global 600/min/user
- **Parameters:** `id` (path, required, uuid)

**مثال — Bookmark** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "bookmarked": true
  },
  "message": null
}
```

#### `GET /api/v1/cases/{id}/completion`

- **الصلاحية:** `view_cases` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** global 600/min/user
- **Parameters:** `id` (path, required, uuid)

**مثال — Completion** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "sections": [
      {
        "key": "beneficiary",
        "percentage": 100
      },
      {
        "key": "family_members",
        "percentage": 100
      },
      "… 7 more"
    ],
    "overallPercentage": 88.89,
    "isReady": false
  },
  "message": null
}
```

#### `GET /api/v1/cases/{id}/family-members`

- **الصلاحية:** `view_cases` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** global 600/min/user
- **Parameters:** `id` (path, required, uuid)

**مثال — Family members** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "members": [
      {
        "id": "78aa3cc1-5f81-4c25-af5b-8092df49aa57",
        "name": "فاطمة أحمد علي",
        "relation": "زوجة",
        "nationalId": "28803012201111",
        "age": 38,
        "gender": "أنثى",
        "isStudent": false,
        "educationStage": null,
        "grade": null,
        "university": null,
        "education": "دبلوم",
        "job": "ربة منزل",
        "monthlyIncome": 0.0,
        "takafulBeneficiary": false,
        "takafulAmount": null,
        "notes": null,
        "sortOrder": 0,
        "computedCurrentAge": 38,
        "computedCurrentEducationStage": null,
        "birthDate": "1988-03-01",
        "phone": "01022223333"
      },
      {
        "id": "01b166a4-493c-4612-916d-7f501fe0f10b",
        "name": "أحمد محمود عبد الرحمن",
        "relation": "ابن",
        "nationalId": null,
        "age": 12,
        "gender": "ذكر",
        "isStudent": true,
        "educationStage": "ابتدائي",
        "grade": "السادس",
        "university": null,
        "education": "ابتدائي",
        "job": null,
        "monthlyIncome": null,
        "takafulBeneficiary": false,
        "takafulAmount": null,
        "notes": null,
        "sortOrder": 1,
        "computedCurrentAge": null,
        "computedCurrentEducationStage": null,
        "birthDate": "2014-02-10",
        "phone": null
      }
    ],
    "caseRowVersion": 2276
  },
  "message": null
}
```

#### `GET /api/v1/cases/{id}/legacy-record`
_السجل الأصلي للحالة من ملف البيانات القديمة (للعرض فقط)_

- **الصلاحية:** `view_cases` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** global 600/min/user
- **Parameters:** `id` (path, required, uuid)

**مثال — Legacy record (cases created in the system → available:false)** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "available": false,
    "sourceFileName": null,
    "sourceRowNumber": null,
    "stagedAtUtc": null,
    "fields": []
  },
  "message": null
}
```

### 19.4 Case Sections

#### `PUT /api/v1/cases/{caseId}/agriculture`

- **الصلاحية:** `edit_case` · **الأدوار:** manager, data_entry, social_worker · **حد الطلبات:** global 600/min/user
- **Parameters:** `caseId` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `hasLand` | string |
| `landAreaFeddan` | number |
| `landType` | string |
| `landRentAmount` | number |
| `annualLandIncome` | number |
| `cropType` | string |
| `hasLivestock` | string |
| `selectedLivestock` | string[] |
| `livestockOther` | string |
| `livestockDetails` | string |
| `notes` | string |
| `visited` | boolean |
| `rowVersion` | integer |

</details>

**مثال — Agriculture (rented land → auto expense)** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "hasLand": "yes",
  "landAreaFeddan": 0.5,
  "landType": "إيجار",
  "landRentAmount": 400,
  "annualLandIncome": null,
  "cropType": "قمح",
  "hasLivestock": "yes",
  "selectedLivestock": [
    "أبقار"
  ],
  "livestockOther": null,
  "livestockDetails": "بقرة واحدة",
  "notes": null,
  "visited": true,
  "rowVersion": 2276
}
```
```json
{
  "success": true,
  "data": {
    "hasLand": "yes",
    "landAreaFeddan": 0.5,
    "landType": "إيجار",
    "landRentAmount": 400,
    "annualLandIncome": null,
    "cropType": "قمح",
    "hasLivestock": "yes",
    "selectedLivestockJson": "[\"\\u0623\\u0628\\u0642\\u0627\\u0631\"]",
    "livestockOther": null,
    "livestockDetails": "بقرة واحدة",
    "notes": null,
    "visited": true,
    "rowVersion": 2290,
    "selectedLivestock": [
      "أبقار"
    ]
  },
  "message": null
}
```

#### `PUT /api/v1/cases/{caseId}/assessed-needs`

- **الصلاحية:** `edit_case` · **الأدوار:** manager, data_entry, social_worker · **حد الطلبات:** global 600/min/user
- **Parameters:** `caseId` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `needs` | AssessedNeedInput[] |
| `needs[].needType` | string |
| `needs[].category` | string |
| `needs[].description` | string |
| `needs[].priorityLevel` | string |
| `needs[].reason` | string |
| `needs[].source` | string |
| `needs[].status` | string |
| `needs[].notes` | string |
| `caseRowVersion` | integer |

</details>

**مثال — Assessed needs (full replace)** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "needs": [
    {
      "needType": "مصروفات دراسية",
      "category": null,
      "description": null,
      "priorityLevel": "high",
      "reason": "طالب في المرحلة الابتدائية",
      "source": "البحث الميداني",
      "status": "مؤكد",
      "notes": null
    },
    {
      "needType": "زي مدرسي",
      "category": null,
      "description": null,
      "priorityLevel": "medium",
      "reason": null,
      "source": "البحث الميداني",
      "status": "مؤكد",
      "notes": null
    }
  ],
  "caseRowVersion": 2292
}
```
```json
{
  "success": true,
  "data": {
    "needs": [
      {
        "id": "19c583c8-13e4-48e0-8f3e-39409435fa0b",
        "needType": "مصروفات دراسية",
        "category": null,
        "description": null,
        "priorityLevel": "high",
        "reason": "طالب في المرحلة الابتدائية",
        "source": "البحث الميداني",
        "status": "مؤكد",
        "notes": null
      },
      {
        "id": "a77f2c0d-153d-4a8f-88aa-1b9baf11d0f1",
        "needType": "زي مدرسي",
        "category": null,
        "description": null,
        "priorityLevel": "medium",
        "reason": null,
        "source": "البحث الميداني",
        "status": "مؤكد",
        "notes": null
      }
    ],
    "caseRowVersion": 2298
  },
  "message": null
}
```

#### `PUT /api/v1/cases/{caseId}/beneficiary`

- **الصلاحية:** `edit_case` · **الأدوار:** manager, data_entry, social_worker · **حد الطلبات:** global 600/min/user
- **Parameters:** `caseId` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `fullName` | string |
| `phonePrimary` | string |
| `phoneSecondary` | string |
| `religion` | string |
| `education` | string |
| `maritalStatus` | string |
| `healthStatus` | string |
| `employmentStatus` | string |
| `job` | string |
| `monthlyIncome` | number |
| `takafulBeneficiary` | boolean |
| `takafulAmount` | number |
| `centerId` | uuid |
| `villageId` | uuid |
| `address` | string |
| `headRelation` | string |
| `rowVersion` | integer |
| `email` | string |
| `street` | string |
| `buildingNumber` | string |
| `floor` | string |
| `apartmentNumber` | string |
| `landmark` | string |
| `area` | string |
| `employer` | string |

</details>

**مثال — Beneficiary** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "fullName": "محمود عبد الرحمن سالم",
  "phonePrimary": "01011112222",
  "phoneSecondary": null,
  "religion": "مسلم",
  "education": "إعدادي",
  "maritalStatus": "متزوج",
  "healthStatus": "سليم",
  "employmentStatus": "عامل باليومية",
  "job": "مزارع",
  "monthlyIncome": 2500,
  "takafulBeneficiary": true,
  "takafulAmount": 750,
  "centerId": "{{centerId}}",
  "villageId": "{{villageId}}",
  "address": "شارع المدرسة",
  "headRelation": null,
  "rowVersion": 2276,
  "email": null,
  "street": "شارع المدرسة",
  "buildingNumber": "12",
  "floor": "الأرضي",
  "apartmentNumber": null,
  "landmark": "بجوار المسجد",
  "area": null,
  "employer": null
}
```
```json
{
  "success": true,
  "data": {
    "fullName": "محمود عبد الرحمن سالم",
    "phonePrimary": "01011112222",
    "phoneSecondary": null,
    "religion": "مسلم",
    "education": "إعدادي",
    "maritalStatus": "متزوج",
    "healthStatus": "سليم",
    "employmentStatus": "عامل باليومية",
    "job": "مزارع",
    "monthlyIncome": 2500,
    "takafulBeneficiary": true,
    "takafulAmount": 750,
    "centerId": "{{centerId}}",
    "villageId": "{{villageId}}",
    "address": "شارع المدرسة",
    "headRelation": null,
    "rowVersion": 2283,
    "email": null,
    "street": "شارع المدرسة",
    "buildingNumber": "12",
    "floor": "الأرضي",
    "apartmentNumber": null,
    "landmark": "بجوار المسجد",
    "area": null,
    "employer": null
  },
  "message": null
}
```

#### `PUT /api/v1/cases/{caseId}/classification`

- **الصلاحية:** `edit_case` · **الأدوار:** manager, data_entry, social_worker · **حد الطلبات:** global 600/min/user
- **Parameters:** `caseId` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `mainClassifications` | string[] |
| `subClassification` | string |
| `needLevel` | string |
| `priorityLevel` | string |
| `vulnerabilityLevel` | string |
| `notes` | string |
| `rowVersion` | integer |

</details>

**مثال — Social classification** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "mainClassifications": [
    "فقر"
  ],
  "subClassification": null,
  "needLevel": "high",
  "priorityLevel": "high",
  "vulnerabilityLevel": null,
  "notes": null,
  "rowVersion": 2276
}
```
```json
{
  "success": true,
  "data": {
    "mainClassificationsJson": "[\"\\u0641\\u0642\\u0631\"]",
    "subClassification": null,
    "needLevel": "high",
    "priorityLevel": "high",
    "vulnerabilityLevel": null,
    "notes": null,
    "rowVersion": 2293,
    "mainClassifications": [
      "فقر"
    ]
  },
  "message": null
}
```

#### `PUT /api/v1/cases/{caseId}/family-members`

- **الصلاحية:** `edit_case` · **الأدوار:** manager, data_entry, social_worker · **حد الطلبات:** global 600/min/user
- **Parameters:** `caseId` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `members` | FamilyMemberInput[] |
| `members[].name` | string |
| `members[].relation` | string |
| `members[].nationalId` | string |
| `members[].age` | integer |
| `members[].gender` | string |
| `members[].isStudent` | boolean |
| `members[].educationStage` | string |
| `members[].grade` | string |
| `members[].university` | string |
| `members[].education` | string |
| `members[].job` | string |
| `members[].monthlyIncome` | number |
| `members[].takafulBeneficiary` | boolean |
| `members[].takafulAmount` | number |
| `members[].notes` | string |
| `members[].sortOrder` | integer |
| `members[].birthDate` | date (yyyy-MM-dd) |
| `members[].phone` | string |
| `caseRowVersion` | integer |

</details>

**مثال — Family members (full replace)** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "members": [
    {
      "name": "فاطمة أحمد علي",
      "relation": "زوجة",
      "nationalId": "28803012201111",
      "age": 38,
      "gender": "أنثى",
      "isStudent": false,
      "educationStage": null,
      "grade": null,
      "university": null,
      "education": "دبلوم",
      "job": "ربة منزل",
      "monthlyIncome": 0,
      "takafulBeneficiary": false,
      "takafulAmount": null,
      "notes": null,
      "sortOrder": 0,
      "birthDate": "1988-03-01",
      "phone": "01022223333"
    },
    {
      "name": "أحمد محمود عبد الرحمن",
      "relation": "ابن",
      "nationalId": null,
      "age": 12,
      "gender": "ذكر",
      "isStudent": true,
      "educationStage": "ابتدائي",
      "grade": "السادس",
      "university": null,
      "education": "ابتدائي",
      "job": null,
      "monthlyIncome": null,
      "takafulBeneficiary": false,
      "takafulAmount": null,
      "notes": null,
      "sortOrder": 1,
      "birthDate": "2014-02-10",
      "phone": null
    },
    {
      "name": "مريم محمود عبد الرحمن",
      "relation": "ابنة",
      "nationalId": null,
      "age": 9,
      "gender": "أنثى",
      "isStudent": true,
      "educationStage": "ابتدائي",
      "grade": "الثالث",
      "university": null,
      "education": "ابتدائي",
      "job": null,
      "monthlyIncome": null,
      "takafulBeneficiary": false,
      "takafulAmount": null,
      "notes": null,
      "sortOrder": 2,
      "birthDate": "2017-05-20",
      "phone": null
    }
  ],
  "caseRowVersion": 2283
}
```
```json
{
  "success": true,
  "data": {
    "members": [
      {
        "id": "1a31fb00-f7cb-4581-85c5-777ec47d0da6",
        "name": "فاطمة أحمد علي",
        "relation": "زوجة",
        "nationalId": "28803012201111",
        "age": 38,
        "gender": "أنثى",
        "isStudent": false,
        "educationStage": null,
        "grade": null,
        "university": null,
        "education": "دبلوم",
        "job": "ربة منزل",
        "monthlyIncome": 0,
        "takafulBeneficiary": false,
        "takafulAmount": null,
        "notes": null,
        "sortOrder": 0,
        "computedCurrentAge": 38,
        "computedCurrentEducationStage": null,
        "birthDate": "1988-03-01",
        "phone": "01022223333"
      },
      {
        "id": "074ecfac-0737-4d53-b53e-626d2db780f1",
        "name": "أحمد محمود عبد الرحمن",
        "relation": "ابن",
        "nationalId": null,
        "age": 12,
        "gender": "ذكر",
        "isStudent": true,
        "educationStage": "ابتدائي",
        "grade": "السادس",
        "university": null,
        "education": "ابتدائي",
        "job": null,
        "monthlyIncome": null,
        "takafulBeneficiary": false,
        "takafulAmount": null,
        "notes": null,
        "sortOrder": 1,
        "computedCurrentAge": null,
        "computedCurrentEducationStage": null,
        "birthDate": "2014-02-10",
        "phone": null
      },
      {
        "id": "8ccbc8aa-a0fa-48ed-867a-a66c8876355a",
        "name": "مريم محمود عبد الرحمن",
        "relation": "ابنة",
        "nationalId": null,
        "age": 9,
        "gender": "أنثى",
        "isStudent": true,
        "educationStage": "ابتدائي",
        "grade": "الثالث",
        "university": null,
        "education": "ابتدائي",
        "job": null,
        "monthlyIncome": null,
        "takafulBeneficiary": false,
        "takafulAmount": null,
        "notes": null,
        "sortOrder": 2,
        "computedCurrentAge": null,
        "computedCurrentEducationStage": null,
        "birthDate": "2017-05-20",
        "phone": null
      }
    ],
    "caseRowVersion": 2285
  },
  "message": null
}
```

**مثال — Stale row version → 409 CONCURRENCY_CONFLICT** (`data_entry`, `X-Client-Type: web`) → **409**

```json
{
  "members": [
    {
      "name": "فاطمة أحمد علي",
      "relation": "زوجة",
      "nationalId": "28803012201111",
      "age": 38,
      "gender": "أنثى",
      "isStudent": false,
      "educationStage": null,
      "grade": null,
      "university": null,
      "education": "دبلوم",
      "job": "ربة منزل",
      "monthlyIncome": 0,
      "takafulBeneficiary": false,
      "takafulAmount": null,
      "notes": null,
      "sortOrder": 0,
      "birthDate": "1988-03-01",
      "phone": "01022223333"
    },
    {
      "name": "أحمد محمود عبد الرحمن",
      "relation": "ابن",
      "nationalId": null,
      "age": 12,
      "gender": "ذكر",
      "isStudent": true,
      "educationStage": "ابتدائي",
      "grade": "السادس",
      "university": null,
      "education": "ابتدائي",
      "job": null,
      "monthlyIncome": null,
      "takafulBeneficiary": false,
      "takafulAmount": null,
      "notes": null,
      "sortOrder": 1,
      "birthDate": "2014-02-10",
      "phone": null
    },
    {
      "name": "مريم محمود عبد الرحمن",
      "relation": "ابنة",
      "nationalId": null,
      "age": 9,
      "gender": "أنثى",
      "isStudent": true,
      "educationStage": "ابتدائي",
      "grade": "الثالث",
      "university": null,
      "education": "ابتدائي",
      "job": null,
      "monthlyIncome": null,
      "takafulBeneficiary": false,
      "takafulAmount": null,
      "notes": null,
      "sortOrder": 2,
      "birthDate": "2017-05-20",
      "phone": null
    }
  ],
  "caseRowVersion": 1
}
```
```json
{
  "success": false,
  "error": {
    "code": "CONCURRENCY_CONFLICT",
    "message": "تم تعديل هذه البيانات بواسطة مستخدم آخر، برجاء إعادة التحميل والمحاولة مرة أخرى"
  }
}
```

#### `PUT /api/v1/cases/{caseId}/financial`

- **الصلاحية:** `edit_case` · **الأدوار:** manager, data_entry, social_worker · **حد الطلبات:** global 600/min/user
- **Parameters:** `caseId` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `incomeItems` | IncomeItemInput[] |
| `incomeItems[].label` | string |
| `incomeItems[].amount` | number |
| `incomeItems[].period` | string |
| `expenseItems` | ExpenseItemInput[] |
| `expenseItems[].category` | string |
| `expenseItems[].amount` | number |
| `expenseItems[].period` | string |
| `caseRowVersion` | integer |

</details>

**مثال — Financial (5 fixed categories required + optional ones)** (`data_entry`, `X-Client-Type: web`) → **200** — «العلاج الشهري» is omitted here on purpose: an optional category that is not sent KEEPS its stored amount (200).

```json
{
  "incomeItems": [
    {
      "label": "معاش",
      "amount": 900,
      "period": "شهري"
    },
    {
      "label": "دخل الزوج/الزوجة",
      "amount": 0,
      "period": "شهري"
    }
  ],
  "expenseItems": [
    {
      "category": "الأكل والشرب",
      "amount": 2500,
      "period": "شهري"
    },
    {
      "category": "المصروفات الدراسية",
      "amount": 300,
      "period": "شهري"
    },
    "… 4 more"
  ],
  "caseRowVersion": 2298
}
```
```json
{
  "success": true,
  "data": {
    "incomeItems": [
      {
        "label": "دخل رب الأسرة",
        "amount": 2500.0,
        "period": "شهري",
        "isAuto": true,
        "source": "beneficiary",
        "isFixed": false
      },
      {
        "label": "تكافل وكرامة",
        "amount": 750.0,
        "period": "شهري",
        "isAuto": true,
        "source": "beneficiary+family",
        "isFixed": false
      },
      "… 3 more"
    ],
    "expenseItems": [
      {
        "label": "إيجار الأراضي الزراعية",
        "amount": 400.0,
        "period": "شهري",
        "isAuto": true,
        "source": "agriculture",
        "isFixed": false
      },
      {
        "label": "الأكل والشرب",
        "amount": 2500,
        "period": "شهري",
        "isAuto": false,
        "source": null,
        "isFixed": true
      },
      "… 6 more"
    ],
    "totalIncome": 4150.0,
    "totalExpenses": 3850.0,
    "netBalance": 300.0,
    "incomePerMember": 75.0,
    "classification": "critical_subsistence",
    "caseRowVersion": 2311
  },
  "message": null
}
```

**مثال — Financial with a missing fixed category → 422** (`data_entry`, `X-Client-Type: web`) → **422**

```json
{
  "incomeItems": [],
  "expenseItems": [
    {
      "category": "الأكل والشرب",
      "amount": 1,
      "period": "شهري"
    }
  ],
  "caseRowVersion": 2311
}
```
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "بيانات غير صحيحة",
    "details": {
      "ExpenseItems": [
        "يجب إدخال جميع بنود المصروفات الثابتة الخمسة"
      ]
    }
  }
}
```

#### `PUT /api/v1/cases/{caseId}/housing`

- **الصلاحية:** `edit_case` · **الأدوار:** manager, data_entry, social_worker · **حد الطلبات:** global 600/min/user
- **Parameters:** `caseId` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `description` | string |
| `ownership` | string |
| `buildingType` | string |
| `walls` | string |
| `roof` | string |
| `floor` | string |
| `entrance` | string |
| `roomsCount` | string |
| `bathroomCondition` | string |
| `sanitation` | string |
| `electricity` | string |
| `water` | string |
| `waterMotor` | boolean |
| `transport` | string |
| `internet` | boolean |
| `rowVersion` | integer |
| `bathroomType` | string |

</details>

**مثال — Housing (upsert; rowVersion required once it exists)** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "description": "الأسرة تقيم في منزل عائلة من طابقين، الأب يعمل باليومية في الزراعة ودخله غير ثابت، والأم ربة منزل. الأبناء في مراحل التعليم المختلفة ويحتاجون إلى دعم في المصروفات الدراسية والزي المدرسي. الأسرة تقيم في منزل عائلة من طابقين، الأب يعمل باليومية في الزراعة ودخله غير ثابت، والأم ربة …",
  "ownership": "منزل عائلة",
  "buildingType": null,
  "walls": "دهان",
  "roof": "خشب",
  "floor": "أسمنت",
  "entrance": "أسمنت",
  "roomsCount": "3",
  "bathroomCondition": "ادمي",
  "sanitation": null,
  "electricity": "عداد",
  "water": "عداد",
  "waterMotor": false,
  "transport": null,
  "internet": false,
  "bathroomType": "خاص",
  "rowVersion": 2276
}
```
```json
{
  "success": true,
  "data": {
    "description": "الأسرة تقيم في منزل عائلة من طابقين، الأب يعمل باليومية في الزراعة ودخله غير ثابت، والأم ربة منزل. الأبناء في مراحل التعليم المختلفة ويحتاجون إلى دعم في المصروفات الدراسية والزي المدرسي. الأسرة تقيم في منزل عائلة من طابقين، الأب يعمل باليومية في الزراعة ودخله غير ثابت، والأم ربة …",
    "ownership": "منزل عائلة",
    "buildingType": null,
    "walls": "دهان",
    "roof": "خشب",
    "floor": "أسمنت",
    "entrance": "أسمنت",
    "roomsCount": "3",
    "bathroomCondition": "ادمي",
    "sanitation": null,
    "electricity": "عداد",
    "water": "عداد",
    "waterMotor": false,
    "transport": null,
    "internet": false,
    "rowVersion": 2276,
    "bathroomType": "خاص"
  },
  "message": null
}
```

#### `PUT /api/v1/cases/{caseId}/initial-needs`

- **الصلاحية:** `edit_case` · **الأدوار:** manager, data_entry, social_worker · **حد الطلبات:** global 600/min/user
- **Parameters:** `caseId` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `needs` | InitialNeedInput[] |
| `needs[].needType` | string |
| `needs[].needCategory` | string |
| `needs[].description` | string |
| `needs[].priorityLevel` | string |
| `needs[].details` | string |
| `needs[].notes` | string |
| `caseRowVersion` | integer |

</details>

**مثال — Initial needs (full replace)** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "needs": [
    {
      "needType": "غذاء",
      "needCategory": null,
      "description": "كرتونة مواد غذائية شهرية",
      "priorityLevel": "high",
      "details": null,
      "notes": null
    }
  ],
  "caseRowVersion": 2290
}
```
```json
{
  "success": true,
  "data": {
    "needs": [
      {
        "id": "20ac44d6-24ad-4251-a8ec-28bd7b42e6d6",
        "needType": "غذاء",
        "needCategory": null,
        "description": "كرتونة مواد غذائية شهرية",
        "priorityLevel": "high",
        "details": null,
        "notes": null
      }
    ],
    "caseRowVersion": 2292
  },
  "message": null
}
```

**مثال — Reviewer cannot edit a section → 403** (`reviewer`, `X-Client-Type: web`) → **403**

```json
{
  "needs": [],
  "caseRowVersion": 2316
}
```
```
(empty body)
```

#### `PUT /api/v1/cases/{caseId}/utilities`

- **الصلاحية:** `edit_case` · **الأدوار:** manager, data_entry, social_worker · **حد الطلبات:** global 600/min/user
- **Parameters:** `caseId` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `appliances` | ApplianceInput[] |
| `appliances[].applianceKey` | string |
| `appliances[].isPresent` | boolean |
| `appliances[].details` | string |
| `utilities` | UtilityInput[] |
| `utilities[].name` | string |
| `utilities[].isAvailable` | boolean |
| `utilities[].condition` | string |
| `utilities[].sourceOrMeter` | string |
| `utilities[].notes` | string |
| `caseRowVersion` | integer |

</details>

**مثال — Utilities & appliances (full replace)** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "appliances": [
    {
      "applianceKey": "fridge",
      "isPresent": true,
      "details": null
    },
    {
      "applianceKey": "washer",
      "isPresent": true,
      "details": "هاف"
    },
    "… 2 more"
  ],
  "utilities": [
    {
      "name": "كهرباء",
      "isAvailable": true,
      "condition": "جيدة",
      "sourceOrMeter": "عداد",
      "notes": null
    }
  ],
  "caseRowVersion": 2285
}
```
```json
{
  "success": true,
  "data": {
    "appliances": [
      {
        "applianceKey": "fridge",
        "isPresent": true,
        "details": null
      },
      {
        "applianceKey": "washer",
        "isPresent": true,
        "details": "هاف"
      },
      "… 2 more"
    ],
    "utilities": [
      {
        "name": "كهرباء",
        "isAvailable": true,
        "condition": "جيدة",
        "sourceOrMeter": "عداد",
        "notes": null
      }
    ],
    "caseRowVersion": 2289
  },
  "message": null
}
```

### 19.5 Case Support

#### `PUT /api/v1/cases/{caseId}/approved-support`

- **الصلاحية:** `write_manager_approval` · **الأدوار:** manager · **حد الطلبات:** global 600/min/user
- **Parameters:** `caseId` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `approvedSupportType` | string |
| `approvedAmount` | number |
| `beneficiary` | string |
| `frequency` | string |
| `duration` | string |
| `approvalNotes` | string |
| `rowVersion` | integer |

</details>

**مثال — Approved support (manager decision)** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "approvedSupportType": "كرتونة مواد غذائية",
  "approvedAmount": 500,
  "beneficiary": "الأسرة",
  "frequency": "شهري",
  "duration": "6 أشهر",
  "approvalNotes": "يصرف أول كل شهر",
  "rowVersion": null
}
```
```json
{
  "success": true,
  "data": {
    "approvedSupportType": "كرتونة مواد غذائية",
    "approvedAmount": 500,
    "beneficiary": "الأسرة",
    "frequency": "شهري",
    "duration": "6 أشهر",
    "approvedAtUtc": "2026-09-25T02:23:30.8241892+00:00",
    "approvalNotes": "يصرف أول كل شهر",
    "approvedByUserId": "fc08da9e-d5ff-429d-8a7c-f35d68037179",
    "rowVersion": 2355
  },
  "message": null
}
```

#### `GET /api/v1/cases/{caseId}/support`

- **الصلاحية:** `view_cases` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** global 600/min/user
- **Parameters:** `caseId` (path, required, uuid)

**مثال — Support (proposed + approved + history)** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "recommendations": [
      {
        "id": "d047fb43-6aad-456b-ac88-eb67400857b4",
        "supportType": "كرتونة مواد غذائية",
        "supportCategory": "غذائي",
        "beneficiary": "الأسرة",
        "proposedAmount": 500.0,
        "frequency": "شهري",
        "duration": "6 أشهر",
        "reason": "دخل غير كاف",
        "justification": "تقرير البحث",
        "priorityLevel": "high",
        "notes": null
      }
    ],
    "approved": null,
    "history": [
      {
        "id": "d2f66986-0cd8-4179-ab5f-6f9f54180209",
        "recipientName": "أحمد محمود عبد الرحمن",
        "recipientType": "family_member",
        "supportType": "زي مدرسي",
        "quantity": 1,
        "amount": 350.0,
        "notes": null,
        "source": "manual",
        "createdAtUtc": "2026-09-25T02:23:29.864935+00:00"
      },
      {
        "id": "138fb27b-69ea-4e7f-a69a-63f7d48d30ab",
        "recipientName": "محمود عبد الرحمن سالم",
        "recipientType": "head",
        "supportType": "كرتونة",
        "quantity": 2,
        "amount": null,
        "notes": "تم الصرف في رمضان",
        "source": "manual",
        "createdAtUtc": "2026-09-25T02:23:29.864935+00:00"
      }
    ]
  },
  "message": null
}
```

#### `PUT /api/v1/cases/{caseId}/support-history`
_استبدال سجل الدعم المصروف للحالة_

- **الصلاحية:** `edit_case` · **الأدوار:** manager, data_entry, social_worker · **حد الطلبات:** global 600/min/user
- **Parameters:** `caseId` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `items` | SupportHistoryInput[] |
| `items[].id` | uuid |
| `items[].recipientName` | string |
| `items[].recipientType` | string |
| `items[].supportType` | string |
| `items[].quantity` | integer |
| `items[].amount` | number |
| `items[].notes` | string |
| `caseRowVersion` | integer |

</details>

**مثال — Support history (support already received; full replace)** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "items": [
    {
      "id": null,
      "recipientName": "محمود عبد الرحمن سالم",
      "recipientType": "head",
      "supportType": "كرتونة",
      "quantity": 2,
      "amount": null,
      "notes": "تم الصرف في رمضان"
    },
    {
      "id": null,
      "recipientName": "أحمد محمود عبد الرحمن",
      "recipientType": "family_member",
      "supportType": "زي مدرسي",
      "quantity": 1,
      "amount": 350,
      "notes": null
    }
  ],
  "caseRowVersion": 2314
}
```
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "138fb27b-69ea-4e7f-a69a-63f7d48d30ab",
        "recipientName": "محمود عبد الرحمن سالم",
        "recipientType": "head",
        "supportType": "كرتونة",
        "quantity": 2,
        "amount": null,
        "notes": "تم الصرف في رمضان",
        "source": "manual",
        "createdAtUtc": "2026-09-25T02:23:29.8649354+00:00"
      },
      {
        "id": "d2f66986-0cd8-4179-ab5f-6f9f54180209",
        "recipientName": "أحمد محمود عبد الرحمن",
        "recipientType": "family_member",
        "supportType": "زي مدرسي",
        "quantity": 1,
        "amount": 350,
        "notes": null,
        "source": "manual",
        "createdAtUtc": "2026-09-25T02:23:29.8649354+00:00"
      }
    ],
    "caseRowVersion": 2316
  },
  "message": null
}
```

#### `PUT /api/v1/cases/{caseId}/support-recommendations`

- **الصلاحية:** `edit_case` · **الأدوار:** manager, data_entry, social_worker · **حد الطلبات:** global 600/min/user
- **Parameters:** `caseId` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `items` | SupportRecommendationInput[] |
| `items[].supportType` | string |
| `items[].supportCategory` | string |
| `items[].beneficiary` | string |
| `items[].proposedAmount` | number |
| `items[].frequency` | string |
| `items[].duration` | string |
| `items[].reason` | string |
| `items[].justification` | string |
| `items[].priorityLevel` | string |
| `items[].notes` | string |
| `caseRowVersion` | integer |

</details>

**مثال — Proposed support (full replace)** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "items": [
    {
      "supportType": "كرتونة مواد غذائية",
      "supportCategory": "غذائي",
      "beneficiary": "الأسرة",
      "proposedAmount": 500,
      "frequency": "شهري",
      "duration": "6 أشهر",
      "reason": "دخل غير كاف",
      "justification": "تقرير البحث",
      "priorityLevel": "high",
      "notes": null
    }
  ],
  "caseRowVersion": 2311
}
```
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "d047fb43-6aad-456b-ac88-eb67400857b4",
        "supportType": "كرتونة مواد غذائية",
        "supportCategory": "غذائي",
        "beneficiary": "الأسرة",
        "proposedAmount": 500,
        "frequency": "شهري",
        "duration": "6 أشهر",
        "reason": "دخل غير كاف",
        "justification": "تقرير البحث",
        "priorityLevel": "high",
        "notes": null
      }
    ],
    "caseRowVersion": 2314
  },
  "message": null
}
```

### 19.6 Case Workflow

#### `POST /api/v1/cases/{caseId}/accept`

- **الصلاحية:** `accept_reject_assignment` · **الأدوار:** social_worker · **حد الطلبات:** global 600/min/user · **Idempotency-Key: مطلوب**
- **Parameters:** `caseId` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `caseRowVersion` | integer |

</details>

**مثال — Workflow POST without Idempotency-Key → 400/422** (`social_worker`, `X-Client-Type: mobile`) → **400**

```json
{
  "caseRowVersion": 2319
}
```
```json
{
  "success": false,
  "error": {
    "code": "IDEMPOTENCY_KEY_REQUIRED",
    "message": "يجب إرسال رأس Idempotency-Key بقيمة UUID صحيحة"
  }
}
```

**مثال — Accept assignment (mobile)** (`social_worker`, `X-Client-Type: mobile`) → **200**

```json
{
  "caseRowVersion": 2319
}
```
```json
{
  "success": true,
  "data": {
    "status": "in_research",
    "caseRowVersion": 2324
  },
  "message": null
}
```

**مثال — Self-accept a pending_assignment case (mobile)** (`social_worker`, `X-Client-Type: mobile`) → **200**

```json
{
  "caseRowVersion": 2363
}
```
```json
{
  "success": true,
  "data": {
    "status": "in_research",
    "caseRowVersion": 2367
  },
  "message": null
}
```

#### `POST /api/v1/cases/{caseId}/assign`

- **الصلاحية:** `create_case` · **الأدوار:** manager, reviewer, data_entry · **حد الطلبات:** global 600/min/user · **Idempotency-Key: مطلوب**
- **Parameters:** `caseId` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `workerId` | uuid |
| `caseRowVersion` | integer |

</details>

**مثال — Assign to a social worker** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "workerId": "{{workerId}}",
  "caseRowVersion": 2316
}
```
```json
{
  "success": true,
  "data": {
    "status": "assigned",
    "caseRowVersion": 2319
  },
  "message": null
}
```

**مثال — Assign (case 2)** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "workerId": "{{workerId}}",
  "caseRowVersion": 2278
}
```
```json
{
  "success": true,
  "data": {
    "status": "assigned",
    "caseRowVersion": 2360
  },
  "message": null
}
```

#### `POST /api/v1/cases/{caseId}/opinions/manager`

- **الصلاحية:** `write_manager_approval` · **الأدوار:** manager · **حد الطلبات:** global 600/min/user · **Idempotency-Key: مطلوب**
- **Parameters:** `caseId` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `approve` | boolean |
| `notes` | string |
| `caseRowVersion` | integer |

</details>

**مثال — Manager approve** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "approve": true,
  "notes": "تمت الموافقة",
  "caseRowVersion": 2349
}
```
```json
{
  "success": true,
  "data": {
    "status": "approved",
    "caseRowVersion": 2353,
    "opinionId": "bf0a12f6-51b1-4250-8d66-14e2c0540c59",
    "decision": "approved",
    "notes": "تمت الموافقة",
    "isSubmitted": true
  },
  "message": null
}
```

**مثال — Approving an approved case → 422** (`manager`, `X-Client-Type: web`) → **422**

```json
{
  "approve": true,
  "notes": null,
  "caseRowVersion": 2353
}
```
```json
{
  "success": false,
  "error": {
    "code": "CASE_ALREADY_APPROVED",
    "message": "الحالة معتمدة بالفعل ولا يمكن تعديل القرار"
  }
}
```

**مثال — Manager reject (approve=false)** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "approve": false,
  "notes": "غير مستحق وفق معايير المؤسسة",
  "caseRowVersion": 2398
}
```
```json
{
  "success": true,
  "data": {
    "status": "rejected",
    "caseRowVersion": 2402,
    "opinionId": "4330ad75-20b2-4dae-9260-ed7704bf6d52",
    "decision": "rejected",
    "notes": "غير مستحق وفق معايير المؤسسة",
    "isSubmitted": true
  },
  "message": null
}
```

#### `POST /api/v1/cases/{caseId}/opinions/reviewer`

- **الصلاحية:** `write_reviewer_opinion` · **الأدوار:** reviewer · **حد الطلبات:** global 600/min/user · **Idempotency-Key: مطلوب**
- **Parameters:** `caseId` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `decision` | string |
| `notes` | string |
| `isSubmitted` | boolean |
| `caseRowVersion` | integer |

</details>

**مثال — Reviewer draft (isSubmitted=false keeps the status)** (`reviewer`, `X-Client-Type: web`) → **200**

```json
{
  "decision": "accepted",
  "notes": "مسودة",
  "isSubmitted": false,
  "caseRowVersion": 2343
}
```
```json
{
  "success": true,
  "data": {
    "status": "pending_review",
    "caseRowVersion": 2346,
    "opinionId": "c12e15fb-a2b2-4cc8-9f59-7658c767be8e",
    "decision": "accepted",
    "notes": "مسودة",
    "isSubmitted": false
  },
  "message": null
}
```

**مثال — Reviewer submit → pending_approval** (`reviewer`, `X-Client-Type: web`) → **200**

```json
{
  "decision": "accepted",
  "notes": "تمت المراجعة والتوصية بالموافقة",
  "isSubmitted": true,
  "caseRowVersion": 2346
}
```
```json
{
  "success": true,
  "data": {
    "status": "pending_approval",
    "caseRowVersion": 2349,
    "opinionId": "c12e15fb-a2b2-4cc8-9f59-7658c767be8e",
    "decision": "accepted",
    "notes": "تمت المراجعة والتوصية بالموافقة",
    "isSubmitted": true
  },
  "message": null
}
```

**مثال — Reviewer submit (case 2)** (`reviewer`, `X-Client-Type: web`) → **200**

```json
{
  "decision": "accepted",
  "notes": null,
  "isSubmitted": true,
  "caseRowVersion": 2389
}
```
```json
{
  "success": true,
  "data": {
    "status": "pending_approval",
    "caseRowVersion": 2392,
    "opinionId": "90a9fa4e-2823-444e-8d80-f60608b862ab",
    "decision": "accepted",
    "notes": null,
    "isSubmitted": true
  },
  "message": null
}
```

#### `POST /api/v1/cases/{caseId}/opinions/worker`

- **الصلاحية:** `write_worker_opinion` · **الأدوار:** social_worker · **حد الطلبات:** global 600/min/user · **Idempotency-Key: مطلوب**
- **Parameters:** `caseId` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `decision` | string |
| `notes` | string |
| `caseRowVersion` | integer |
| `detailedReport` | object |

</details>

**مثال — Submit worker opinion (mobile; needs 100% completion)** (`social_worker`, `X-Client-Type: mobile`) → **200**

```json
{
  "decision": "accepted",
  "notes": "الأسرة مستحقة للدعم. الأسرة تقيم في منزل عائلة من طابقين، الأب يعمل باليومية في الزراعة ودخله غير ثابت، والأم ربة منزل. الأبناء في مراحل التعليم المختلفة ويحتاجون إلى دعم في المصروفات الدراسية والزي المدرسي. الأسرة تقيم ف",
  "caseRowVersion": 2334,
  "detailedReport": null
}
```
```json
{
  "success": true,
  "data": {
    "status": "pending_review",
    "caseRowVersion": 2343,
    "opinionId": "043ec7eb-decf-46d4-a618-b5587a33ec5a",
    "decision": "accepted",
    "notes": "الأسرة مستحقة للدعم. الأسرة تقيم في منزل عائلة من طابقين، الأب يعمل باليومية في الزراعة ودخله غير ثابت، والأم ربة منزل. الأبناء في مراحل التعليم المختلفة ويحتاجون إلى دعم في المصروفات الدراسية والزي المدرسي. الأسرة تقيم ف",
    "isSubmitted": true
  },
  "message": null
}
```

**مثال — Submit worker opinion (case 2)** (`social_worker`, `X-Client-Type: mobile`) → **200**

```json
{
  "decision": "accepted",
  "notes": "مستحقة",
  "caseRowVersion": 2380,
  "detailedReport": null
}
```
```json
{
  "success": true,
  "data": {
    "status": "pending_review",
    "caseRowVersion": 2383,
    "opinionId": "5b9c03e1-0aca-4ef7-83fc-c34a60be0f2e",
    "decision": "accepted",
    "notes": "مستحقة",
    "isSubmitted": true
  },
  "message": null
}
```

**مثال — Worker re-submits after return** (`social_worker`, `X-Client-Type: mobile`) → **200**

```json
{
  "decision": "accepted",
  "notes": "تم الاستكمال",
  "caseRowVersion": 2386,
  "detailedReport": null
}
```
```json
{
  "success": true,
  "data": {
    "status": "pending_review",
    "caseRowVersion": 2389,
    "opinionId": "92732a70-0546-4380-93c0-59ed2385692b",
    "decision": "accepted",
    "notes": "تم الاستكمال",
    "isSubmitted": true
  },
  "message": null
}
```

#### `POST /api/v1/cases/{caseId}/reject-assignment`

- **الصلاحية:** `accept_reject_assignment` · **الأدوار:** social_worker · **حد الطلبات:** global 600/min/user · **Idempotency-Key: مطلوب**
- **Parameters:** `caseId` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `reason` | string |
| `caseRowVersion` | integer |

</details>

**مثال — Reject assignment (mobile)** (`social_worker`, `X-Client-Type: mobile`) → **200**

```json
{
  "reason": "خارج نطاق منطقتي",
  "caseRowVersion": 2360
}
```
```json
{
  "success": true,
  "data": {
    "status": "pending_assignment",
    "caseRowVersion": 2363
  },
  "message": null
}
```

#### `POST /api/v1/cases/{caseId}/return-for-completion`

- **الصلاحية:** `write_manager_approval` · **الأدوار:** manager · **حد الطلبات:** global 600/min/user · **Idempotency-Key: مطلوب**
- **Parameters:** `caseId` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `caseRowVersion` | integer |
| `reason` | string |

</details>

**مثال — Manager returns for completion** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "caseRowVersion": 2392,
  "reason": "مطلوب صورة البطاقة"
}
```
```json
{
  "success": true,
  "data": {
    "status": "returned_to_worker",
    "caseRowVersion": 2395
  },
  "message": null
}
```

#### `POST /api/v1/cases/{caseId}/return-to-worker`

- **الصلاحية:** `write_reviewer_opinion` · **الأدوار:** reviewer · **حد الطلبات:** global 600/min/user · **Idempotency-Key: مطلوب**
- **Parameters:** `caseId` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `reason` | string |
| `caseRowVersion` | integer |

</details>

**مثال — Reviewer returns to worker** (`reviewer`, `X-Client-Type: web`) → **200**

```json
{
  "reason": "برجاء استكمال بيانات الدخل",
  "caseRowVersion": 2383
}
```
```json
{
  "success": true,
  "data": {
    "status": "returned_to_worker",
    "caseRowVersion": 2386,
    "opinionId": "d7866fe7-0b93-4134-821b-9526d3d58b09",
    "decision": "returned_to_worker",
    "notes": "برجاء استكمال بيانات الدخل",
    "isSubmitted": true
  },
  "message": null
}
```

### 19.7 Field Visits

#### `GET /api/v1/cases/{caseId}/field-verification`
_عرض نتائج التحقق الميداني الحالية للحالة_

- **الصلاحية:** `view_cases` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** global 600/min/user
- **Parameters:** `caseId` (path, required, uuid)

**مثال — Field verification (read)** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "fields": [
      {
        "fieldLabel": "housing_rooms_count",
        "originalValue": "3",
        "verifiedValue": "3",
        "isDifferent": false,
        "differenceReason": null
      },
      {
        "fieldLabel": "beneficiary_monthly_income",
        "originalValue": "2500",
        "verifiedValue": "2800",
        "isDifferent": true,
        "differenceReason": "يعمل أيضاً في الحصاد الموسمي"
      }
    ],
    "caseRowVersion": 2334
  },
  "message": null
}
```

#### `PUT /api/v1/cases/{caseId}/field-verification`
_حفظ نتائج التحقق الميداني (مقارنة القيم الأصلية بالقيم المتحققة)_

- **الصلاحية:** `write_worker_opinion` · **الأدوار:** social_worker · **حد الطلبات:** global 600/min/user
- **Parameters:** `caseId` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `fields` | VerifiedFieldInput[] |
| `fields[].fieldLabel` | string |
| `fields[].verifiedValue` | string |
| `fields[].differenceReason` | string |
| `caseRowVersion` | integer |

</details>

**مثال — Field verification (save)** (`social_worker`, `X-Client-Type: mobile`) → **200**

```json
{
  "fields": [
    {
      "fieldLabel": "beneficiary_monthly_income",
      "verifiedValue": "2800",
      "differenceReason": "يعمل أيضاً في الحصاد الموسمي"
    },
    {
      "fieldLabel": "housing_rooms_count",
      "verifiedValue": "3",
      "differenceReason": null
    }
  ],
  "caseRowVersion": 2324
}
```
```json
{
  "success": true,
  "data": {
    "fields": [
      {
        "fieldLabel": "beneficiary_monthly_income",
        "originalValue": "2500",
        "verifiedValue": "2800",
        "isDifferent": true,
        "differenceReason": "يعمل أيضاً في الحصاد الموسمي"
      },
      {
        "fieldLabel": "housing_rooms_count",
        "originalValue": "3",
        "verifiedValue": "3",
        "isDifferent": false,
        "differenceReason": null
      }
    ],
    "caseRowVersion": 2334
  },
  "message": null
}
```

#### `GET /api/v1/cases/{caseId}/field-visits`
_قائمة كل الزيارات الميدانية للحالة (مقسّمة إلى صفحات)_

- **الصلاحية:** `view_cases` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** global 600/min/user
- **Parameters:** `caseId` (path, required, uuid), `page` (query, integer), `limit` (query, integer)

**مثال — List field visits** (`social_worker`, `X-Client-Type: mobile`) → **200**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "{{visitId}}",
        "caseId": "{{caseId}}",
        "visitDate": "2026-09-25",
        "startTimeUtc": null,
        "endTimeUtc": null,
        "location": {
          "latitude": 29.0661,
          "longitude": 31.0994,
          "description": "منزل الأسرة",
          "isEmpty": false
        },
        "outcome": "تمت الزيارة",
        "status": "completed",
        "notes": "الأسرة تقيم في منزل عائلة من طابقين، الأب يعمل باليومية في الزراعة ودخله غير ثابت، والأم ربة منزل. الأبناء في مراحل التعليم المختلفة ويحتاجون إلى دعم في المصروفات الدراسية والزي المدرسي. الأسرة تقيم في منزل عائلة من طابقين، الأب يعمل باليومية في الزراعة ودخله غير ثابت، والأم ربة …",
        "description": null,
        "photoAttachmentIds": [],
        "socialWorkerId": "{{workerId}}",
        "rowVersion": 2327
      }
    ],
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1,
    "hasNext": false,
    "hasPrev": false
  },
  "message": null
}
```

#### `POST /api/v1/cases/{caseId}/field-visits`
_تسجيل زيارة ميدانية للحالة_

- **الصلاحية:** `write_worker_opinion` · **الأدوار:** social_worker · **حد الطلبات:** global 600/min/user · **Idempotency-Key: مطلوب**
- **Parameters:** `caseId` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `visitDate` | date (yyyy-MM-dd) |
| `startTimeUtc` | date-time (ISO 8601, UTC) |
| `endTimeUtc` | date-time (ISO 8601, UTC) |
| `latitude` | number |
| `longitude` | number |
| `locationDescription` | string |
| `outcome` | string |
| `status` | string |
| `notes` | string |
| `description` | string |
| `photoAttachmentIds` | uuid[] |

</details>

**مثال — Create field visit** (`social_worker`, `X-Client-Type: mobile`) → **200**

```json
{
  "visitDate": "2026-09-25",
  "startTimeUtc": null,
  "endTimeUtc": null,
  "latitude": 29.0661,
  "longitude": 31.0994,
  "locationDescription": "منزل الأسرة",
  "outcome": "تمت الزيارة",
  "status": "completed",
  "notes": "الأسرة تقيم في منزل عائلة من طابقين، الأب يعمل باليومية في الزراعة ودخله غير ثابت، والأم ربة منزل. الأبناء في مراحل التعليم المختلفة ويحتاجون إلى دعم في المصروفات الدراسية والزي المدرسي. الأسرة تقيم في منزل عائلة من طابقين، الأب يعمل باليومية في الزراعة ودخله غير ثابت، والأم ربة …",
  "description": null,
  "photoAttachmentIds": []
}
```
```json
{
  "success": true,
  "data": {
    "id": "{{visitId}}",
    "caseId": "{{caseId}}",
    "visitDate": "2026-09-25",
    "startTimeUtc": null,
    "endTimeUtc": null,
    "location": {
      "latitude": 29.0661,
      "longitude": 31.0994,
      "description": "منزل الأسرة",
      "isEmpty": false
    },
    "outcome": "تمت الزيارة",
    "status": "completed",
    "notes": "الأسرة تقيم في منزل عائلة من طابقين، الأب يعمل باليومية في الزراعة ودخله غير ثابت، والأم ربة منزل. الأبناء في مراحل التعليم المختلفة ويحتاجون إلى دعم في المصروفات الدراسية والزي المدرسي. الأسرة تقيم في منزل عائلة من طابقين، الأب يعمل باليومية في الزراعة ودخله غير ثابت، والأم ربة …",
    "description": null,
    "photoAttachmentIds": [],
    "socialWorkerId": "{{workerId}}",
    "rowVersion": 2327
  },
  "message": null
}
```

#### `PUT /api/v1/field-visits/{id}`
_تحديث زيارة ميدانية_

- **الصلاحية:** `write_worker_opinion` · **الأدوار:** social_worker · **حد الطلبات:** global 600/min/user · **Idempotency-Key: مطلوب**
- **Parameters:** `id` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `visitDate` | date (yyyy-MM-dd) |
| `startTimeUtc` | date-time (ISO 8601, UTC) |
| `endTimeUtc` | date-time (ISO 8601, UTC) |
| `latitude` | number |
| `longitude` | number |
| `locationDescription` | string |
| `outcome` | string |
| `status` | string |
| `notes` | string |
| `description` | string |
| `photoAttachmentIds` | uuid[] |
| `rowVersion` | integer |

</details>

**مثال — Update field visit** (`social_worker`, `X-Client-Type: mobile`) → **200**

```json
{
  "visitDate": "2026-09-25",
  "startTimeUtc": null,
  "endTimeUtc": null,
  "latitude": 29.0661,
  "longitude": 31.0994,
  "locationDescription": "منزل الأسرة",
  "outcome": "تمت الزيارة",
  "status": "completed",
  "notes": "تم التحقق من البيانات",
  "description": null,
  "photoAttachmentIds": [],
  "rowVersion": 2327
}
```
```json
{
  "success": true,
  "data": {
    "id": "{{visitId}}",
    "caseId": "{{caseId}}",
    "visitDate": "2026-09-25",
    "startTimeUtc": null,
    "endTimeUtc": null,
    "location": {
      "latitude": 29.0661,
      "longitude": 31.0994,
      "description": "منزل الأسرة",
      "isEmpty": false
    },
    "outcome": "تمت الزيارة",
    "status": "completed",
    "notes": "تم التحقق من البيانات",
    "description": null,
    "photoAttachmentIds": [],
    "socialWorkerId": "{{workerId}}",
    "rowVersion": 2329
  },
  "message": null
}
```

### 19.8 Attachments

#### `POST /api/v1/attachments/init`
_بدء رفع مرفق — يعيد رابط رفع مؤقّت موقّع_

- **الصلاحية:** `edit_case` · **الأدوار:** manager, data_entry, social_worker · **حد الطلبات:** moderate 30/min/user

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `caseId` | uuid |
| `documentType` | string |
| `fileName` | string |
| `mimeType` | string |
| `fileSize` | integer |
| `description` | string |

</details>

**مثال — Upload 1/3: init (returns attachmentId + presigned PUT URL)** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "caseId": "{{caseId}}",
  "documentType": "national_id",
  "fileName": "id-card.jpg",
  "mimeType": "image/jpeg",
  "fileSize": 222,
  "description": "صورة البطاقة الشخصية (وجه وظهر)"
}
```
```json
{
  "success": true,
  "data": {
    "attachmentId": "{{attachmentId}}",
    "caseId": "{{caseId}}",
    "uploadUrl": "https://<account>.r2.cloudflarestorage.com/<bucket>/<key>?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=…&X-Amz-Signature=…",
    "httpMethod": "PUT",
    "objectKey": "{{caseId}}/{{attachmentId}}.jpg",
    "mimeType": "image/jpeg",
    "fileName": "id-card.jpg",
    "maxFileSizeBytes": 10485760,
    "uploadUrlExpiresAtUtc": "2026-09-25T02:53:41.5481018+00:00",
    "status": "pending"
  },
  "message": null
}
```

**مثال — Unsupported file type → 422 UNSUPPORTED_FILE_TYPE** (`data_entry`, `X-Client-Type: web`) → **422**

```json
{
  "caseId": "{{caseId}}",
  "documentType": "other",
  "fileName": "tool.exe",
  "mimeType": "application/x-msdownload",
  "fileSize": 1000,
  "description": null
}
```
```json
{
  "success": false,
  "error": {
    "code": "UNSUPPORTED_FILE_TYPE",
    "message": "نوع الملف غير مدعوم. الأنواع المسموح بها: jpg, jpeg, png, heic, webp, pdf, doc, docx"
  }
}
```

#### `DELETE /api/v1/attachments/{id}`
_حذف مرفق_

- **الصلاحية:** `edit_case` · **الأدوار:** manager, data_entry, social_worker · **حد الطلبات:** global 600/min/user
- **Parameters:** `id` (path, required, uuid)

**مثال — Delete attachment** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "attachmentId": "{{attachmentId}}",
    "caseId": "{{caseId}}",
    "deleted": true
  },
  "message": null
}
```

#### `POST /api/v1/attachments/{id}/commit`
_تأكيد اكتمال رفع المرفق — عملية قابلة لإعادة المحاولة بأمان_

- **الصلاحية:** `edit_case` · **الأدوار:** manager, data_entry, social_worker · **حد الطلبات:** global 600/min/user · **Idempotency-Key: مطلوب**
- **Parameters:** `id` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `checksum` | string |

</details>

**مثال — Upload 3/3: commit (checks size + file signature)** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "checksum": null
}
```
```json
{
  "success": true,
  "data": {
    "attachmentId": "{{attachmentId}}",
    "caseId": "{{caseId}}",
    "status": "complete",
    "scanStatus": "not_scanned",
    "mimeType": "image/jpeg",
    "fileSizeBytes": 222,
    "checksum": "c49b3ff078399a9cf04856b18d1c3d22",
    "fileName": "id-card.jpg",
    "uploadedAtUtc": "2026-09-25T02:23:41.606042+00:00",
    "rowVersion": 2460,
    "alreadyComplete": false
  },
  "message": null
}
```

#### `GET /api/v1/attachments/{id}/download`
_إصدار رابط تحميل موقّت موقّع (15 دقيقة)_

- **الصلاحية:** `view_cases` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** global 600/min/user
- **Parameters:** `id` (path, required, uuid)

**مثال — Download (presigned GET URL)** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "attachmentId": "{{attachmentId}}",
    "caseId": "{{caseId}}",
    "downloadUrl": "https://<account>.r2.cloudflarestorage.com/<bucket>/<key>?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=…&X-Amz-Signature=…",
    "fileName": "id-card.jpg",
    "mimeType": "image/jpeg",
    "fileSizeBytes": 222,
    "expiresAtUtc": "2026-09-25T02:38:41.6434769+00:00",
    "expiresInSeconds": 900
  },
  "message": null
}
```

#### `GET /api/v1/cases/{caseId}/attachments`
_قائمة مرفقات الحالة (مقسّمة إلى صفحات)_

- **الصلاحية:** `view_cases` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** global 600/min/user
- **Parameters:** `caseId` (path, required, uuid), `page` (query, integer), `limit` (query, integer)

**مثال — Case attachments** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "{{attachmentId}}",
        "caseId": "{{caseId}}",
        "documentType": "national_id",
        "fileName": "id-card.jpg",
        "description": "صورة البطاقة الشخصية (وجه وظهر)",
        "status": "complete",
        "scanStatus": "not_scanned",
        "fileSizeBytes": 222,
        "mimeType": "image/jpeg",
        "uploadedByUserId": "2439b401-9753-4a17-b2d8-d44edc07b8f2",
        "uploadedByName": "مستخدم تجريبي data_entry",
        "uploadedAtUtc": "2026-09-25T02:23:41.606042+00:00",
        "rowVersion": 2460
      }
    ],
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1,
    "hasNext": false,
    "hasPrev": false
  },
  "message": null
}
```

### 19.9 Search

#### `GET /api/v1/search/cases`
_البحث في الحالات بمعايير متعددة_

- **الصلاحية:** `view_cases` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** search 180/min/user
- **Parameters:** `q` (query, string), `name` (query, string), `national_id` (query, string), `charity` (query, string), `region` (query, string), `phone` (query, string), `date` (query, date (yyyy-MM-dd)), `dateFrom` (query, date (yyyy-MM-dd)), `dateTo` (query, date (yyyy-MM-dd)), `page` (query, integer), `limit` (query, integer)

**مثال — Search by name** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "{{caseId}}",
        "caseNumber": "CASE-1",
        "displayId": "#1",
        "status": "approved",
        "priority": "high",
        "beneficiaryFullName": "محمود عبد الرحمن سالم",
        "nationalId": "28501152201234",
        "charityId": "{{charityId}}",
        "registrationDate": "2026-09-25",
        "completionPercentage": 0.0,
        "createdAtUtc": "2026-09-25T02:23:28.151283+00:00",
        "nextVisitDate": null,
        "nextVisitStartTimeUtc": null,
        "nextVisitLocation": null,
        "isBookmarked": false,
        "returnedBy": null,
        "phonePrimary": "01011112222",
        "centerId": "{{centerId}}",
        "villageId": "{{villageId}}",
        "centerName": "إهناسيا",
        "villageName": "قرية النهضة التجريبية",
        "charityName": "جمعية تجريبية لتنمية المجتمع (معدلة)"
      }
    ],
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1,
    "hasNext": false,
    "hasPrev": false
  },
  "message": null
}
```

**مثال — Search by national ID** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "{{caseId}}",
        "caseNumber": "CASE-1",
        "displayId": "#1",
        "status": "approved",
        "priority": "high",
        "beneficiaryFullName": "محمود عبد الرحمن سالم",
        "nationalId": "28501152201234",
        "charityId": "{{charityId}}",
        "registrationDate": "2026-09-25",
        "completionPercentage": 0.0,
        "createdAtUtc": "2026-09-25T02:23:28.151283+00:00",
        "nextVisitDate": null,
        "nextVisitStartTimeUtc": null,
        "nextVisitLocation": null,
        "isBookmarked": false,
        "returnedBy": null,
        "phonePrimary": "01011112222",
        "centerId": "{{centerId}}",
        "villageId": "{{villageId}}",
        "centerName": "إهناسيا",
        "villageName": "قرية النهضة التجريبية",
        "charityName": "جمعية تجريبية لتنمية المجتمع (معدلة)"
      }
    ],
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1,
    "hasNext": false,
    "hasPrev": false
  },
  "message": null
}
```

**مثال — Search by phone** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "{{caseId}}",
        "caseNumber": "CASE-1",
        "displayId": "#1",
        "status": "approved",
        "priority": "high",
        "beneficiaryFullName": "محمود عبد الرحمن سالم",
        "nationalId": "28501152201234",
        "charityId": "{{charityId}}",
        "registrationDate": "2026-09-25",
        "completionPercentage": 0.0,
        "createdAtUtc": "2026-09-25T02:23:28.151283+00:00",
        "nextVisitDate": null,
        "nextVisitStartTimeUtc": null,
        "nextVisitLocation": null,
        "isBookmarked": false,
        "returnedBy": null,
        "phonePrimary": "01011112222",
        "centerId": "{{centerId}}",
        "villageId": "{{villageId}}",
        "centerName": "إهناسيا",
        "villageName": "قرية النهضة التجريبية",
        "charityName": "جمعية تجريبية لتنمية المجتمع (معدلة)"
      }
    ],
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1,
    "hasNext": false,
    "hasPrev": false
  },
  "message": null
}
```

### 19.10 Dashboard

#### `GET /api/v1/dashboard/stats`
_إحصائيات لوحة التحكم حسب دور المستخدم_

- **الصلاحية:** `view_cases` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** read 240/min/user

**مثال — Stat cards** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "awaitingMyApproval": 0,
    "totalCases": 3,
    "acceptedCases": 1,
    "rejectedCases": 1,
    "totalEmployees": 6,
    "totalCharities": 1
  },
  "message": null
}
```

#### `GET /api/v1/dashboard/work-queue`
_قائمة الشغل: الحالات التي تنتظر إجراءً من المستخدم الحالي_

- **الصلاحية:** `view_cases` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** read 240/min/user
- **Parameters:** `page` (query, integer), `limit` (query, integer)

**مثال — Work queue** (`social_worker`, `X-Client-Type: mobile`) → **200**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "{{caseIdTmp}}",
        "caseNumber": "CASE-2",
        "displayId": "#2",
        "status": "returned_to_worker",
        "priority": "medium",
        "beneficiaryFullName": "سعاد إبراهيم حسن",
        "nationalId": "29002202201238",
        "charityId": null,
        "registrationDate": "2026-09-25",
        "completionPercentage": 0.0,
        "createdAtUtc": "2026-09-25T02:23:28.448331+00:00",
        "nextVisitDate": null,
        "nextVisitStartTimeUtc": null,
        "nextVisitLocation": null,
        "isBookmarked": false,
        "returnedBy": "manager",
        "phonePrimary": null,
        "centerId": "{{centerId}}",
        "villageId": "{{villageId}}",
        "centerName": "إهناسيا",
        "villageName": "قرية النهضة التجريبية",
        "charityName": null
      }
    ],
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1,
    "hasNext": false,
    "hasPrev": false
  },
  "message": null
}
```

### 19.11 Notifications

#### `GET /api/v1/notifications`
_قائمة إشعارات المستخدم الحالي_

- **الصلاحية:** `(any signed-in user)` · **الأدوار:** all roles · **حد الطلبات:** global 600/min/user
- **Parameters:** `page` (query, integer), `limit` (query, integer)

**مثال — List notifications** (`social_worker`, `X-Client-Type: mobile`) → **200**

```json
{
  "success": true,
  "data": {
    "page": {
      "items": [
        {
          "id": "{{notificationId}}",
          "title": "تم إرجاع الحالة إليك",
          "subtitle": "أعاد المراجع الحالة CASE-2 لاستكمال البحث الميداني",
          "icon": "returned",
          "isRead": false,
          "caseId": "{{caseIdTmp}}",
          "createdAtUtc": "2026-09-25T02:23:34.743723+00:00"
        },
        {
          "id": "ced6568c-eeac-40ba-8894-6461dc24ccf9",
          "title": "إسناد حالة جديدة",
          "subtitle": "تم إسناد الحالة CASE-2 إليك للبحث الميداني",
          "icon": "assignment",
          "isRead": false,
          "caseId": "{{caseIdTmp}}",
          "createdAtUtc": "2026-09-25T02:23:34.696098+00:00"
        },
        "… 2 more"
      ],
      "page": 1,
      "limit": 20,
      "total": 4,
      "totalPages": 1,
      "hasNext": false,
      "hasPrev": false
    },
    "unreadCount": 4
  },
  "message": null
}
```

#### `POST /api/v1/notifications/device-tokens`
_تسجيل رمز الجهاز لاستقبال الإشعارات الفورية (FCM)_

- **الصلاحية:** `(any signed-in user)` · **الأدوار:** all roles · **حد الطلبات:** global 600/min/user

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `token` | string |
| `platform` | string |

</details>

**مثال — Register device token (FCM)** (`social_worker`, `X-Client-Type: mobile`) → **200**

```json
{
  "token": "demo-fcm-token-123",
  "platform": "android"
}
```
```json
{
  "success": true,
  "data": null,
  "message": null
}
```

#### `PUT /api/v1/notifications/mark-all-read`
_تعليم كل إشعارات المستخدم الحالي كمقروءة_

- **الصلاحية:** `(any signed-in user)` · **الأدوار:** all roles · **حد الطلبات:** global 600/min/user

**مثال — Mark all as read** (`social_worker`, `X-Client-Type: mobile`) → **200**

```json
{
  "success": true,
  "data": {
    "markedCount": 3
  },
  "message": null
}
```

#### `PUT /api/v1/notifications/{id}/read`
_تعليم إشعار واحد كمقروء_

- **الصلاحية:** `(any signed-in user)` · **الأدوار:** all roles · **حد الطلبات:** global 600/min/user
- **Parameters:** `id` (path, required, uuid)

**مثال — Mark one as read** (`social_worker`, `X-Client-Type: mobile`) → **200**

```json
{
  "success": true,
  "data": null,
  "message": null
}
```

### 19.12 Profile

#### `GET /api/v1/profile`

- **الصلاحية:** `(any signed-in user)` · **الأدوار:** all roles · **حد الطلبات:** global 600/min/user

**مثال — My profile** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "id": "2439b401-9753-4a17-b2d8-d44edc07b8f2",
    "fullName": "مستخدم تجريبي data_entry",
    "email": "data_entry@demo.nahda",
    "role": "data_entry",
    "phone": null,
    "gender": null,
    "avatarUrl": null,
    "rowVersion": 2228
  },
  "message": null
}
```

**مثال — My profile (with avatarUrl)** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "id": "2439b401-9753-4a17-b2d8-d44edc07b8f2",
    "fullName": "مستخدم تجريبي data_entry",
    "email": "data_entry@demo.nahda",
    "role": "data_entry",
    "phone": "01000000009",
    "gender": "female",
    "avatarUrl": "https://<account>.r2.cloudflarestorage.com/<bucket>/<key>?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=…&X-Amz-Signature=…",
    "rowVersion": 2455
  },
  "message": null
}
```

#### `PUT /api/v1/profile`

- **الصلاحية:** `(any signed-in user)` · **الأدوار:** all roles · **حد الطلبات:** global 600/min/user

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `fullName` | string |
| `phone` | string |
| `gender` | string |
| `rowVersion` | integer |

</details>

**مثال — Update my profile** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "fullName": "مستخدم تجريبي data_entry",
  "phone": "01000000009",
  "gender": "female",
  "rowVersion": 2228
}
```
```json
{
  "success": true,
  "message": null
}
```

#### `DELETE /api/v1/profile/avatar`

- **الصلاحية:** `(any signed-in user)` · **الأدوار:** all roles · **حد الطلبات:** global 600/min/user

**مثال — Remove avatar** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "message": null
}
```

#### `POST /api/v1/profile/avatar/confirm`
_تأكيد اكتمال رفع الصورة_

- **الصلاحية:** `(any signed-in user)` · **الأدوار:** all roles · **حد الطلبات:** global 600/min/user

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `objectKey` | string |

</details>

**مثال — Avatar upload 3/3: confirm** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "objectKey": "{{avatarObjectKey}}"
}
```
```json
{
  "success": true,
  "data": {
    "avatarUrl": "https://<account>.r2.cloudflarestorage.com/<bucket>/<key>?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=…&X-Amz-Signature=…"
  },
  "message": null
}
```

#### `POST /api/v1/profile/avatar/init`
_بدء رفع صورة الملف الشخصي — يعيد رابط رفع مؤقّت موقّع_

- **الصلاحية:** `(any signed-in user)` · **الأدوار:** all roles · **حد الطلبات:** moderate 30/min/user

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `fileName` | string |
| `mimeType` | string |
| `fileSize` | integer |

</details>

**مثال — Avatar upload 1/3: init (returns a presigned PUT URL)** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "fileName": "me.jpg",
  "mimeType": "image/jpeg",
  "fileSize": 222
}
```
```json
{
  "success": true,
  "data": {
    "objectKey": "avatars/2439b401-9753-4a17-b2d8-d44edc07b8f2/471ce507-3a33-46f0-98dd-b9e67549aadb.jpg",
    "uploadUrl": "https://<account>.r2.cloudflarestorage.com/<bucket>/<key>?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=…&X-Amz-Signature=…",
    "mimeType": "image/jpeg",
    "uploadUrlExpiresAtUtc": "2026-09-25T02:38:41.4225055+00:00"
  },
  "message": null
}
```

### 19.13 Reporting

#### `GET /api/v1/reports/beneficiaries/summary`

- **الصلاحية:** `view_reports` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** read 240/min/user

**مثال — Report /beneficiaries/summary** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "totalBeneficiaries": 3,
    "byGender": [
      {
        "key": "male",
        "label": "male",
        "count": 3
      }
    ],
    "byAgeBracket": [
      {
        "key": "31-45",
        "label": "31-45",
        "count": 3
      }
    ],
    "byEmploymentStatus": [
      {
        "key": "unspecified",
        "label": "unspecified",
        "count": 2
      },
      {
        "key": "عامل باليومية",
        "label": "عامل باليومية",
        "count": 1
      }
    ],
    "averageMonthlyIncome": 2500.0,
    "averageFamilySize": 2
  },
  "message": null
}
```

#### `POST /api/v1/reports/builder/run`
_تشغيل تقرير مخصص (مصدر بيانات + بُعد + مقياس + تجميع + فلاتر) — كل القيم من قائمة مسموح بها فقط_

- **الصلاحية:** `view_reports` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** read 240/min/user

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `dataset` | ReportDataset |
| `dimension` | ReportDimension |
| `metric` | ReportMetric |
| `aggregation` | ReportAggregation |
| `filters` | ReportFilter[] |
| `filters[].field` | ReportDimension |
| `filters[].operator` | ReportFilterOperator |
| `filters[].value` | string |
| `filters[].valueTo` | string |
| `sortDirection` | ReportSortDirection |
| `maxRows` | integer |

</details>

**مثال — Report builder with enum NAMES → 400 (numbers are required)** (`manager`, `X-Client-Type: web`) → **400**

```json
{
  "dataset": "Cases",
  "dimension": "Status",
  "metric": "Count",
  "aggregation": "Count",
  "filters": null,
  "sortDirection": "Descending",
  "maxRows": 50
}
```
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "الطلب غير صالح"
  }
}
```

**مثال — Report builder with a filter (RegistrationMonth, Between)** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "dataset": 0,
  "dimension": 9,
  "metric": 0,
  "aggregation": 2,
  "filters": [
    {
      "field": 9,
      "operator": 6,
      "value": "2026-01",
      "valueTo": "2026-12"
    }
  ],
  "sortDirection": 0,
  "maxRows": 100
}
```
```json
{
  "success": true,
  "data": {
    "rows": [
      {
        "dimensionValue": "2026-09",
        "metricValue": 3
      }
    ],
    "truncated": false,
    "maxRows": 100
  },
  "message": null
}
```

**مثال — Report builder: run** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "dataset": 0,
  "dimension": 0,
  "metric": 0,
  "aggregation": 2,
  "filters": null,
  "sortDirection": 1,
  "maxRows": 50
}
```
```json
{
  "success": true,
  "data": {
    "rows": [
      {
        "dimensionValue": "Approved",
        "metricValue": 1
      },
      {
        "dimensionValue": "ReturnedToWorker",
        "metricValue": 1
      },
      {
        "dimensionValue": "Rejected",
        "metricValue": 1
      }
    ],
    "truncated": false,
    "maxRows": 50
  },
  "message": null
}
```

#### `GET /api/v1/reports/cases/aging`

- **الصلاحية:** `view_reports` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** read 240/min/user

**مثال — Report /cases/aging** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": [
    {
      "bucket": 0,
      "caseCount": 3
    },
    {
      "bucket": 1,
      "caseCount": 0
    },
    "… 3 more"
  ],
  "message": null
}
```

#### `GET /api/v1/reports/cases/by-location`

- **الصلاحية:** `view_reports` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** read 240/min/user

**مثال — Report /cases/by-location** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": [
    {
      "centerId": "{{centerId}}",
      "centerName": "إهناسيا",
      "villageId": "{{villageId}}",
      "villageName": "قرية النهضة التجريبية",
      "caseCount": 3
    }
  ],
  "message": null
}
```

#### `GET /api/v1/reports/cases/by-status`

- **الصلاحية:** `view_reports` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** read 240/min/user

**مثال — Report /cases/by-status** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": [
    {
      "key": "ReturnedToWorker",
      "label": "returned_to_worker",
      "count": 1
    },
    {
      "key": "Approved",
      "label": "approved",
      "count": 1
    },
    {
      "key": "Rejected",
      "label": "rejected",
      "count": 1
    }
  ],
  "message": null
}
```

#### `GET /api/v1/reports/cases/summary`

- **الصلاحية:** `view_reports` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** read 240/min/user
- **Parameters:** `from` (query, date (yyyy-MM-dd)), `to` (query, date (yyyy-MM-dd))

**مثال — Report /cases/summary** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "totalCases": 3,
    "byStatus": [
      {
        "key": "Approved",
        "label": "approved",
        "count": 1
      },
      {
        "key": "Rejected",
        "label": "rejected",
        "count": 1
      },
      {
        "key": "ReturnedToWorker",
        "label": "returned_to_worker",
        "count": 1
      }
    ],
    "byPriority": [
      {
        "key": "High",
        "label": "high",
        "count": 1
      },
      {
        "key": "Low",
        "label": "low",
        "count": 1
      },
      {
        "key": "Medium",
        "label": "medium",
        "count": 1
      }
    ],
    "averageCompletionPercentage": 0.0,
    "registrationTrend": [
      {
        "periodStart": "2026-06-28",
        "periodLabel": "2026-06-28",
        "count": 0,
        "amount": 0
      },
      {
        "periodStart": "2026-06-29",
        "periodLabel": "2026-06-29",
        "count": 0,
        "amount": 0
      },
      "… 88 more"
    ]
  },
  "message": null
}
```

#### `GET /api/v1/reports/catalog`
_قائمة التقارير الجاهزة المتاحة_

- **الصلاحية:** `view_reports` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** read 240/min/user

**مثال — Report /catalog** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": [
    {
      "key": "cases-summary",
      "label": "ملخص الحالات",
      "path": "/api/v1/reports/cases/summary",
      "requiresFinancialPermission": false
    },
    {
      "key": "cases-by-status",
      "label": "الحالات حسب الحالة",
      "path": "/api/v1/reports/cases/by-status",
      "requiresFinancialPermission": false
    },
    "… 11 more"
  ],
  "message": null
}
```

#### `GET /api/v1/reports/comparisons`
_مقارنة فترتين لمقياس واحد (عدد الحالات المسجلة أو إجمالي الدعم المعتمد)_

- **الصلاحية:** `view_reports` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** read 240/min/user
- **Parameters:** `metric` (query, required, ReportMetric), `currentFrom` (query, required, date (yyyy-MM-dd)), `currentTo` (query, required, date (yyyy-MM-dd)), `previousFrom` (query, required, date (yyyy-MM-dd)), `previousTo` (query, required, date (yyyy-MM-dd))

**مثال — Report /comparisons** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "currentValue": 3,
    "previousValue": 0,
    "delta": 3,
    "percentChange": null
  },
  "message": null
}
```

#### `GET /api/v1/reports/dashboards/beneficiaries`

- **الصلاحية:** `view_reports` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** read 240/min/user

**مثال — Dashboard beneficiaries** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "totalBeneficiaries": 3,
    "byGender": [
      {
        "key": "male",
        "label": "male",
        "count": 3
      }
    ],
    "byAgeBracket": [
      {
        "key": "31-45",
        "label": "31-45",
        "count": 3
      }
    ],
    "byEmploymentStatus": [
      {
        "key": "unspecified",
        "label": "unspecified",
        "count": 2
      },
      {
        "key": "عامل باليومية",
        "label": "عامل باليومية",
        "count": 1
      }
    ],
    "averageMonthlyIncome": 2500.0,
    "averageFamilySize": 2
  },
  "message": null
}
```

#### `GET /api/v1/reports/dashboards/cases`

- **الصلاحية:** `view_reports` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** read 240/min/user

**مثال — Dashboard cases** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "totalCases": 3,
    "byStatus": [
      {
        "key": "ReturnedToWorker",
        "label": "returned_to_worker",
        "count": 1
      },
      {
        "key": "Approved",
        "label": "approved",
        "count": 1
      },
      {
        "key": "Rejected",
        "label": "rejected",
        "count": 1
      }
    ],
    "byPriority": [
      {
        "key": "Medium",
        "label": "medium",
        "count": 1
      },
      {
        "key": "High",
        "label": "high",
        "count": 1
      },
      {
        "key": "Low",
        "label": "low",
        "count": 1
      }
    ],
    "averageCompletionPercentage": 0.0,
    "registrationTrend": [
      {
        "periodStart": "2026-06-28",
        "periodLabel": "2026-06-28",
        "count": 0,
        "amount": 0
      },
      {
        "periodStart": "2026-06-29",
        "periodLabel": "2026-06-29",
        "count": 0,
        "amount": 0
      },
      "… 88 more"
    ]
  },
  "message": null
}
```

#### `GET /api/v1/reports/dashboards/data-quality`

- **الصلاحية:** `view_reports` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** read 240/min/user

**مثال — Dashboard data-quality** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "totalCases": 3,
    "casesMissingBeneficiaryPhone": 2,
    "casesMissingHousingRecord": 1,
    "casesMissingFinancialItems": 1,
    "casesWithZeroFamilyMembers": 1
  },
  "message": null
}
```

#### `GET /api/v1/reports/dashboards/employees`

- **الصلاحية:** `view_reports` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** read 240/min/user

**مثال — Dashboard employees** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": [
    {
      "userId": "00000000-0000-0000-0002-000000000001",
      "fullName": "مدير النظام (حساب أولي)",
      "role": "Manager",
      "casesCreated": 0,
      "visitsConducted": 0,
      "auditActionsRecorded": 0
    },
    {
      "userId": "fc08da9e-d5ff-429d-8a7c-f35d68037179",
      "fullName": "مستخدم تجريبي manager",
      "role": "Manager",
      "casesCreated": 0,
      "visitsConducted": 0,
      "auditActionsRecorded": 12
    },
    "… 4 more"
  ],
  "message": null
}
```

#### `GET /api/v1/reports/dashboards/executive`

- **الصلاحية:** `view_reports` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** read 240/min/user

**مثال — Dashboard executive** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "totalCases": 3,
    "approvedCases": 1,
    "rejectedCases": 1,
    "pendingCases": 1,
    "totalApprovedSupportAmount": 500.0,
    "totalBeneficiaries": 3,
    "totalVisitsLast30Days": 1,
    "casesTrendLast90Days": [
      {
        "periodStart": "2026-06-28",
        "periodLabel": "2026-06-28",
        "count": 0,
        "amount": 0
      },
      {
        "periodStart": "2026-06-29",
        "periodLabel": "2026-06-29",
        "count": 0,
        "amount": 0
      },
      "… 88 more"
    ]
  },
  "message": null
}
```

#### `GET /api/v1/reports/dashboards/financial`

- **الصلاحية:** `view_financial_reports`, `view_reports` · **الأدوار:** manager, reviewer · **حد الطلبات:** read 240/min/user

**مثال — Dashboard financial** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "totalIncome": 4150.0,
    "totalExpenses": 3850.0,
    "netBalance": 300.0,
    "incomeByLabel": [
      {
        "key": "تكافل وكرامة",
        "label": "تكافل وكرامة",
        "amount": 750.0
      },
      {
        "key": "دخل الأرض الزراعية",
        "label": "دخل الأرض الزراعية",
        "amount": 0.0
      },
      "… 3 more"
    ],
    "expenseByLabel": [
      {
        "key": "العلاج الشهري",
        "label": "العلاج الشهري",
        "amount": 200.0
      },
      {
        "key": "إيجار الأراضي الزراعية",
        "label": "إيجار الأراضي الزراعية",
        "amount": 400.0
      },
      "… 6 more"
    ],
    "coverage": {
      "totalRecords": 3,
      "availableRecords": 2,
      "coveragePercentage": 66.67,
      "warning": "detailed income/expense line items: 2/3 records (66.67%) have this data. The remainder are legacy-imported cases whose detailed detailed income/expense line items was not captured during import — see LEGACY_IMPORT_FIELD_MAPPING.md."
    }
  },
  "message": null
}
```

#### `GET /api/v1/reports/dashboards/geographic`

- **الصلاحية:** `view_reports` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** read 240/min/user

**مثال — Dashboard geographic** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": [
    {
      "centerId": "{{centerId}}",
      "centerName": "إهناسيا",
      "villageId": "{{villageId}}",
      "villageName": "قرية النهضة التجريبية",
      "caseCount": 3
    }
  ],
  "message": null
}
```

#### `GET /api/v1/reports/dashboards/support`

- **الصلاحية:** `view_reports` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** read 240/min/user

**مثال — Dashboard support** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "totalApprovedSupportRecords": 1,
    "totalApprovedAmount": 500.0,
    "averageApprovedAmount": 500.0,
    "coverage": {
      "totalRecords": 3,
      "availableRecords": 1,
      "coveragePercentage": 33.33,
      "warning": "approved support: 1/3 records (33.33%) have this data. The remainder are legacy-imported cases whose detailed approved support was not captured during import — see LEGACY_IMPORT_FIELD_MAPPING.md."
    }
  },
  "message": null
}
```

#### `GET /api/v1/reports/dashboards/visits`

- **الصلاحية:** `view_reports` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** read 240/min/user

**مثال — Dashboard visits** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "totalVisits": 1,
    "byOutcome": [
      {
        "key": "تمت الزيارة",
        "label": "تمت الزيارة",
        "count": 1
      }
    ],
    "byStatus": [
      {
        "key": "completed",
        "label": "completed",
        "count": 1
      }
    ],
    "averageVisitsPerCase": 1
  },
  "message": null
}
```

#### `GET /api/v1/reports/data-coverage`

- **الصلاحية:** `view_reports` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** read 240/min/user

**مثال — Report /data-coverage** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "financialCoverage": {
      "totalRecords": 3,
      "availableRecords": 2,
      "coveragePercentage": 66.67,
      "warning": "detailed income/expense line items: 2/3 records (66.67%) have this data. The remainder are legacy-imported cases whose detailed detailed income/expense line items was not captured during import — see LEGACY_IMPORT_FIELD_MAPPING.md."
    },
    "housingCoverage": {
      "totalRecords": 3,
      "availableRecords": 2,
      "coveragePercentage": 66.67,
      "warning": "detailed housing data: 2/3 records (66.67%) have this data. The remainder are legacy-imported cases whose detailed detailed housing data was not captured during import — see LEGACY_IMPORT_FIELD_MAPPING.md."
    },
    "supportCoverage": {
      "totalRecords": 3,
      "availableRecords": 1,
      "coveragePercentage": 33.33,
      "warning": "detailed support-given data: 1/3 records (33.33%) have this data. The remainder are legacy-imported cases whose detailed detailed support-given data was not captured during import — see LEGACY_IMPORT_FIELD_MAPPING.md."
    }
  },
  "message": null
}
```

#### `GET /api/v1/reports/data-quality`

- **الصلاحية:** `view_reports` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** read 240/min/user

**مثال — Report /data-quality** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "totalCases": 3,
    "casesMissingBeneficiaryPhone": 2,
    "casesMissingHousingRecord": 1,
    "casesMissingFinancialItems": 1,
    "casesWithZeroFamilyMembers": 1
  },
  "message": null
}
```

#### `GET /api/v1/reports/datasets`
_قائمة مصادر البيانات المتاحة لمنشئ التقارير مع الأبعاد والمقاييس المسموح بها لكل مصدر_

- **الصلاحية:** `view_reports` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** read 240/min/user

**مثال — Report /datasets** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": [
    {
      "dataset": 0,
      "label": "الحالات",
      "allowedDimensions": [
        0,
        1,
        "… 5 more"
      ],
      "allowedMetrics": [
        0
      ],
      "dimensionOperators": [
        {
          "dimension": 0,
          "allowedOperators": [
            0,
            1,
            7
          ]
        },
        {
          "dimension": 1,
          "allowedOperators": [
            0,
            1,
            7
          ]
        },
        "… 9 more"
      ]
    },
    {
      "dataset": 1,
      "label": "المستفيدون",
      "allowedDimensions": [
        5,
        6,
        "… 3 more"
      ],
      "allowedMetrics": [
        0,
        3,
        4
      ],
      "dimensionOperators": [
        {
          "dimension": 0,
          "allowedOperators": [
            0,
            1,
            7
          ]
        },
        {
          "dimension": 1,
          "allowedOperators": [
            0,
            1,
            7
          ]
        },
        "… 9 more"
      ]
    },
    "… 3 more"
  ],
  "message": null
}
```

#### `GET /api/v1/reports/datasets/{dataset}`
_تفاصيل مصدر بيانات واحد (الأبعاد والمقاييس المسموح بها)_

- **الصلاحية:** `view_reports` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** read 240/min/user
- **Parameters:** `dataset` (path, required, ReportDataset)

**مثال — Report /datasets/Cases** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "dataset": 0,
    "label": "الحالات",
    "allowedDimensions": [
      0,
      1,
      "… 5 more"
    ],
    "allowedMetrics": [
      0
    ],
    "dimensionOperators": [
      {
        "dimension": 0,
        "allowedOperators": [
          0,
          1,
          7
        ]
      },
      {
        "dimension": 1,
        "allowedOperators": [
          0,
          1,
          7
        ]
      },
      "… 9 more"
    ]
  },
  "message": null
}
```

#### `GET /api/v1/reports/employees/activity`

- **الصلاحية:** `view_reports` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** read 240/min/user
- **Parameters:** `from` (query, date (yyyy-MM-dd)), `to` (query, date (yyyy-MM-dd))

**مثال — Report /employees/activity** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": [
    {
      "userId": "00000000-0000-0000-0002-000000000001",
      "fullName": "مدير النظام (حساب أولي)",
      "role": "Manager",
      "casesCreated": 0,
      "visitsConducted": 0,
      "auditActionsRecorded": 0
    },
    {
      "userId": "fc08da9e-d5ff-429d-8a7c-f35d68037179",
      "fullName": "مستخدم تجريبي manager",
      "role": "Manager",
      "casesCreated": 0,
      "visitsConducted": 0,
      "auditActionsRecorded": 12
    },
    "… 4 more"
  ],
  "message": null
}
```

#### `POST /api/v1/reports/export`
_تصدير نتيجة منشئ التقارير بصيغة CSV_

- **الصلاحية:** `export_reports`, `view_reports` · **الأدوار:** manager, reviewer · **حد الطلبات:** read 240/min/user

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `dataset` | ReportDataset |
| `dimension` | ReportDimension |
| `metric` | ReportMetric |
| `aggregation` | ReportAggregation |
| `filters` | ReportFilter[] |
| `filters[].field` | ReportDimension |
| `filters[].operator` | ReportFilterOperator |
| `filters[].value` | string |
| `filters[].valueTo` | string |
| `sortDirection` | ReportSortDirection |
| `maxRows` | integer |

</details>

**مثال — Report builder: export CSV** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "dataset": 0,
  "dimension": 0,
  "metric": 0,
  "aggregation": 2,
  "filters": null,
  "sortDirection": 1,
  "maxRows": 50
}
```
```
﻿Dimension,MetricValue
Approved,1
ReturnedToWorker,1
Rejected,1

```

#### `GET /api/v1/reports/financial/summary`

- **الصلاحية:** `view_financial_reports`, `view_reports` · **الأدوار:** manager, reviewer · **حد الطلبات:** read 240/min/user

**مثال — Report /financial/summary** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "totalIncome": 4150.0,
    "totalExpenses": 3850.0,
    "netBalance": 300.0,
    "incomeByLabel": [
      {
        "key": "تكافل وكرامة",
        "label": "تكافل وكرامة",
        "amount": 750.0
      },
      {
        "key": "دخل الأرض الزراعية",
        "label": "دخل الأرض الزراعية",
        "amount": 0.0
      },
      "… 3 more"
    ],
    "expenseByLabel": [
      {
        "key": "العلاج الشهري",
        "label": "العلاج الشهري",
        "amount": 200.0
      },
      {
        "key": "إيجار الأراضي الزراعية",
        "label": "إيجار الأراضي الزراعية",
        "amount": 400.0
      },
      "… 6 more"
    ],
    "coverage": {
      "totalRecords": 3,
      "availableRecords": 2,
      "coveragePercentage": 66.67,
      "warning": "detailed income/expense line items: 2/3 records (66.67%) have this data. The remainder are legacy-imported cases whose detailed detailed income/expense line items was not captured during import — see LEGACY_IMPORT_FIELD_MAPPING.md."
    }
  },
  "message": null
}
```

**مثال — Financial report without permission → 403** (`data_entry`, `X-Client-Type: web`) → **403**

```
(empty body)
```

#### `GET /api/v1/reports/support/by-type`

- **الصلاحية:** `view_reports` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** read 240/min/user

**مثال — Report /support/by-type** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": [
    {
      "supportType": "كرتونة مواد غذائية",
      "count": 1,
      "totalAmount": 500.0
    }
  ],
  "message": null
}
```

#### `GET /api/v1/reports/support/summary`

- **الصلاحية:** `view_reports` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** read 240/min/user

**مثال — Report /support/summary** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "totalApprovedSupportRecords": 1,
    "totalApprovedAmount": 500.0,
    "averageApprovedAmount": 500.0,
    "coverage": {
      "totalRecords": 3,
      "availableRecords": 1,
      "coveragePercentage": 33.33,
      "warning": "approved support: 1/3 records (33.33%) have this data. The remainder are legacy-imported cases whose detailed approved support was not captured during import — see LEGACY_IMPORT_FIELD_MAPPING.md."
    }
  },
  "message": null
}
```

#### `GET /api/v1/reports/visits/summary`

- **الصلاحية:** `view_reports` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** read 240/min/user

**مثال — Report /visits/summary** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "totalVisits": 1,
    "byOutcome": [
      {
        "key": "تمت الزيارة",
        "label": "تمت الزيارة",
        "count": 1
      }
    ],
    "byStatus": [
      {
        "key": "completed",
        "label": "completed",
        "count": 1
      }
    ],
    "averageVisitsPerCase": 1
  },
  "message": null
}
```

### 19.14 Employees

#### `GET /api/v1/employees`

- **الصلاحية:** `view_employees` · **الأدوار:** manager · **حد الطلبات:** global 600/min/user
- **Parameters:** `search` (query, string), `role` (query, string), `page` (query, integer), `limit` (query, integer)

**مثال — List employees** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "00000000-0000-0000-0002-000000000001",
        "fullName": "مدير النظام (حساب أولي)",
        "email": "seed.admin@demo.nahda",
        "role": "manager",
        "status": "active",
        "centerId": null,
        "phone": null,
        "rowVersion": 2164
      },
      {
        "id": "2439b401-9753-4a17-b2d8-d44edc07b8f2",
        "fullName": "مستخدم تجريبي data_entry",
        "email": "data_entry@demo.nahda",
        "role": "data_entry",
        "status": "active",
        "centerId": "00000000-0000-0000-0001-000000000001",
        "phone": null,
        "rowVersion": 2228
      },
      "… 3 more"
    ],
    "page": 1,
    "limit": 20,
    "total": 5,
    "totalPages": 1,
    "hasNext": false,
    "hasPrev": false
  },
  "message": null
}
```

**مثال — data_entry cannot list employees → 403** (`data_entry`, `X-Client-Type: web`) → **403**

```
(empty body)
```

#### `POST /api/v1/employees`

- **الصلاحية:** `manage_employees` · **الأدوار:** manager · **حد الطلبات:** global 600/min/user

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `fullName` | string |
| `email` | string |
| `password` | string |
| `role` | string |
| `centerId` | uuid |
| `phone` | string |
| `gender` | string |

</details>

**مثال — Create employee** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "fullName": "أخصائي تجريبي جديد",
  "email": "new.worker@demo.nahda",
  "password": "Temp#Pass2026",
  "role": "social_worker",
  "centerId": "{{centerId}}",
  "phone": "01000000001",
  "gender": "male"
}
```
```json
{
  "success": true,
  "data": "{{employeeId}}",
  "message": null
}
```

#### `GET /api/v1/employees/export`

- **الصلاحية:** `manage_employees` · **الأدوار:** manager · **حد الطلبات:** global 600/min/user
- **Parameters:** `search` (query, string), `role` (query, string)

**مثال — Export employees (CSV)** (`manager`, `X-Client-Type: web`) → **200**

```
﻿FullName,Email,Role,Status,Phone
أخصائي تجريبي (معدل),new.worker@demo.nahda,data_entry,active,01000000002
مدير النظام (حساب أولي),seed.admin@demo.nahda,manager,active,
مستخدم تجريبي data_entry,data_entry@demo.nahda,data_entry,active,
مستخدم تجريبي manager,manager@demo.nahda,manager,active,
مستخدم تجريبي reviewer,reviewer@demo.nahda,reviewer,active,
مستخدم تجريبي social_worker,social_worker@demo.nahda,social_worker,active,

```

#### `GET /api/v1/employees/social-workers`

- **الصلاحية:** `create_case` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** global 600/min/user
- **Parameters:** `search` (query, string)

**مثال — Social workers (for the assign picker)** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": [
    {
      "id": "{{workerId}}",
      "fullName": "مستخدم تجريبي social_worker",
      "phone": null,
      "centerId": "00000000-0000-0000-0001-000000000001"
    }
  ],
  "message": null
}
```

#### `DELETE /api/v1/employees/{id}`

- **الصلاحية:** `manage_employees` · **الأدوار:** manager · **حد الطلبات:** global 600/min/user
- **Parameters:** `id` (path, required, uuid)

**مثال — Delete employee** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "message": null
}
```

#### `PUT /api/v1/employees/{id}`

- **الصلاحية:** `manage_employees` · **الأدوار:** manager · **حد الطلبات:** global 600/min/user
- **Parameters:** `id` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `fullName` | string |
| `centerId` | uuid |
| `phone` | string |
| `gender` | string |
| `rowVersion` | integer |

</details>

**مثال — Update employee** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "fullName": "أخصائي تجريبي (معدل)",
  "centerId": "{{centerId}}",
  "phone": "01000000002",
  "gender": "male",
  "rowVersion": 2256
}
```
```json
{
  "success": true,
  "message": null
}
```

#### `POST /api/v1/employees/{id}/activate`

- **الصلاحية:** `manage_employees` · **الأدوار:** manager · **حد الطلبات:** global 600/min/user
- **Parameters:** `id` (path, required, uuid)

**مثال — Activate** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "message": null
}
```

#### `POST /api/v1/employees/{id}/deactivate`

- **الصلاحية:** `manage_employees` · **الأدوار:** manager · **حد الطلبات:** global 600/min/user
- **Parameters:** `id` (path, required, uuid)

**مثال — Deactivate** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "message": null
}
```

#### `POST /api/v1/employees/{id}/reset-password`

- **الصلاحية:** `manage_employees` · **الأدوار:** manager · **حد الطلبات:** global 600/min/user
- **Parameters:** `id` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `newPassword` | string |

</details>

**مثال — Reset password** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "newPassword": "Reset#Pass2026"
}
```
```json
{
  "success": true,
  "message": null
}
```

#### `POST /api/v1/employees/{id}/role`

- **الصلاحية:** `manage_employees` · **الأدوار:** manager · **حد الطلبات:** global 600/min/user
- **Parameters:** `id` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `role` | string |

</details>

**مثال — Change role** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "role": "data_entry"
}
```
```json
{
  "success": true,
  "message": null
}
```

### 19.15 Charities

#### `GET /api/v1/charities`

- **الصلاحية:** `(any signed-in user)` · **الأدوار:** all roles · **حد الطلبات:** global 600/min/user
- **Parameters:** `search` (query, string), `centerId` (query, uuid), `page` (query, integer), `limit` (query, integer)

**مثال — List charities** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "{{charityId}}",
        "name": "جمعية تجريبية لتنمية المجتمع",
        "governorate": "بني سويف",
        "centerId": "{{centerId}}",
        "villageId": "{{villageId}}",
        "phone": "0822000000",
        "dateAdded": "2026-09-25",
        "rowVersion": 2254
      }
    ],
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1,
    "hasNext": false,
    "hasPrev": false
  },
  "message": null
}
```

#### `POST /api/v1/charities`

- **الصلاحية:** `manage_charities` · **الأدوار:** manager, reviewer, data_entry · **حد الطلبات:** global 600/min/user

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `name` | string |
| `centerId` | uuid |
| `villageId` | uuid |
| `address` | string |
| `phone` | string |

</details>

**مثال — Create charity** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "name": "جمعية تجريبية لتنمية المجتمع",
  "centerId": "{{centerId}}",
  "villageId": "{{villageId}}",
  "address": "شارع تجريبي",
  "phone": "0822000000"
}
```
```json
{
  "success": true,
  "data": "{{charityId}}",
  "message": null
}
```

#### `GET /api/v1/charities/export`

- **الصلاحية:** `manage_charities` · **الأدوار:** manager, reviewer, data_entry · **حد الطلبات:** global 600/min/user

**مثال — Export charities (CSV)** (`manager`, `X-Client-Type: web`) → **200**

```
﻿Name,Governorate,Phone,DateAdded
جمعية تجريبية لتنمية المجتمع (معدلة),بني سويف,0822000000,2026-09-25

```

#### `DELETE /api/v1/charities/{id}`

- **الصلاحية:** `manage_charities` · **الأدوار:** manager, reviewer, data_entry · **حد الطلبات:** global 600/min/user
- **Parameters:** `id` (path, required, uuid)

**مثال — Delete charity in use → 409 DELETE_CONFLICT** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "message": null
}
```

#### `PUT /api/v1/charities/{id}`

- **الصلاحية:** `manage_charities` · **الأدوار:** manager, reviewer, data_entry · **حد الطلبات:** global 600/min/user
- **Parameters:** `id` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `name` | string |
| `centerId` | uuid |
| `villageId` | uuid |
| `address` | string |
| `phone` | string |
| `rowVersion` | integer |

</details>

**مثال — Update charity** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "name": "جمعية تجريبية لتنمية المجتمع (معدلة)",
  "centerId": "{{centerId}}",
  "villageId": "{{villageId}}",
  "address": "شارع تجريبي",
  "phone": "0822000000",
  "rowVersion": 2254
}
```
```json
{
  "success": true,
  "message": null
}
```

### 19.16 Locations

#### `GET /api/v1/locations`

- **الصلاحية:** `(any signed-in user)` · **الأدوار:** all roles · **حد الطلبات:** global 600/min/user

**مثال — Centers with villages** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": [
    {
      "id": "{{centerId}}",
      "name": "إهناسيا",
      "villages": []
    },
    {
      "id": "00000000-0000-0000-0001-000000000004",
      "name": "الفشن",
      "villages": []
    },
    "… 5 more"
  ],
  "message": null
}
```

#### `POST /api/v1/locations/centers`

- **الصلاحية:** `manage_locations` · **الأدوار:** data_entry · **حد الطلبات:** global 600/min/user

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `name` | string |

</details>

**مثال — Create center** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "name": "مركز تجريبي"
}
```
```json
{
  "success": true,
  "data": "{{newCenterId}}",
  "message": null
}
```

#### `DELETE /api/v1/locations/centers/{id}`

- **الصلاحية:** `manage_locations` · **الأدوار:** data_entry · **حد الطلبات:** global 600/min/user
- **Parameters:** `id` (path, required, uuid)

**مثال — Delete center** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "message": null
}
```

#### `PUT /api/v1/locations/centers/{id}`

- **الصلاحية:** `manage_locations` · **الأدوار:** data_entry · **حد الطلبات:** global 600/min/user
- **Parameters:** `id` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `name` | string |

</details>

**مثال — Rename center** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "name": "مركز تجريبي معدل"
}
```
```json
{
  "success": true,
  "message": null
}
```

#### `POST /api/v1/locations/reset`

- **الصلاحية:** `manage_locations` · **الأدوار:** data_entry · **حد الطلبات:** global 600/min/user

**مثال — Reset locations (soft-deletes ALL villages and every non-seeded center)** (`data_entry`, `X-Client-Type: web`) → **200** — DANGER: run only on a new, empty installation. On a live system it detaches every beneficiary and charity from its village.

```json
{
  "success": true,
  "message": null
}
```

#### `POST /api/v1/locations/villages`

- **الصلاحية:** `manage_locations` · **الأدوار:** data_entry · **حد الطلبات:** global 600/min/user

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `centerId` | uuid |
| `name` | string |

</details>

**مثال — Create village** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "centerId": "{{newCenterId}}",
  "name": "قرية تجريبية"
}
```
```json
{
  "success": true,
  "data": "{{newVillageId}}",
  "message": null
}
```

**مثال — Village in the seeded center (for the demo case)** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "centerId": "{{centerId}}",
  "name": "قرية النهضة التجريبية"
}
```
```json
{
  "success": true,
  "data": "{{villageId}}",
  "message": null
}
```

#### `DELETE /api/v1/locations/villages/{id}`

- **الصلاحية:** `manage_locations` · **الأدوار:** data_entry · **حد الطلبات:** global 600/min/user
- **Parameters:** `id` (path, required, uuid)

**مثال — Delete village** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "message": null
}
```

#### `PUT /api/v1/locations/villages/{id}`

- **الصلاحية:** `manage_locations` · **الأدوار:** data_entry · **حد الطلبات:** global 600/min/user
- **Parameters:** `id` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `name` | string |

</details>

**مثال — Rename village** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "name": "قرية تجريبية معدلة"
}
```
```json
{
  "success": true,
  "message": null
}
```

### 19.17 State Data Configuration

#### `GET /api/v1/dropdown-configs`
_جلب كل قوائم ضبط بيانات الحالة_

- **الصلاحية:** `manage_configurations` · **الأدوار:** data_entry · **حد الطلبات:** global 600/min/user
- **Parameters:** `step` (query, integer), `fieldType` (query, string), `isActive` (query, boolean)

**مثال — List dropdown configs** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "00000000-0000-0000-0003-000000000001",
        "key": "gender",
        "label": "النوع",
        "fieldType": "select",
        "step": 1,
        "isFixed": true,
        "allowOther": false,
        "dependencyKey": null,
        "sortOrder": 1,
        "isActive": true,
        "optionsCount": 2
      },
      {
        "id": "00000000-0000-0000-0003-000000000002",
        "key": "religion",
        "label": "الديانة",
        "fieldType": "select",
        "step": 1,
        "isFixed": true,
        "allowOther": false,
        "dependencyKey": null,
        "sortOrder": 2,
        "isActive": true,
        "optionsCount": 2
      },
      "… 51 more"
    ],
    "meta": {
      "total": 53,
      "byType": {
        "select": 25,
        "chip": 19,
        "support": 9
      }
    }
  },
  "message": null
}
```

#### `GET /api/v1/dropdown-configs/{id}`
_جلب قائمة ضبط محدَّدة بالمعرِّف_

- **الصلاحية:** `manage_configurations` · **الأدوار:** data_entry · **حد الطلبات:** global 600/min/user
- **Parameters:** `id` (path, required, uuid)

**مثال — One config** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "id": "{{configId}}",
    "key": "housingType",
    "label": "طبيعة السكن",
    "fieldType": "chip",
    "step": 3,
    "isFixed": false,
    "allowOther": true,
    "dependencyKey": null,
    "sortOrder": 26,
    "isActive": true,
    "optionsCount": 0
  },
  "message": null
}
```

#### `POST /api/v1/dropdown-configs/{id}/options`
_إضافة خيار جديد إلى قائمة ضبط_

- **الصلاحية:** `manage_configurations` · **الأدوار:** data_entry · **حد الطلبات:** global 600/min/user
- **Parameters:** `id` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `value` | string |
| `label` | string |
| `sortOrder` | integer |
| `isOther` | boolean |
| `parentOptionId` | uuid |

</details>

**مثال — Add option** (`data_entry`, `X-Client-Type: web`) → **201**

```json
{
  "value": "demo_option",
  "label": "خيار تجريبي",
  "sortOrder": 99,
  "isOther": false,
  "parentOptionId": null
}
```
```json
{
  "success": true,
  "data": {
    "id": "{{optionId}}",
    "configId": "{{configId}}",
    "value": "demo_option",
    "label": "خيار تجريبي",
    "isOther": false,
    "isActive": true,
    "sortOrder": 99,
    "parentOptionId": null
  },
  "message": null
}
```

#### `GET /api/v1/dropdown-configs/{key}/options`
_جلب خيارات قائمة ضبط (بالمفتاح)_

- **الصلاحية:** `manage_configurations` · **الأدوار:** data_entry · **حد الطلبات:** global 600/min/user
- **Parameters:** `key` (path, required, string)

**مثال — Config options (admin view)** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": [],
  "message": null
}
```

#### `DELETE /api/v1/dropdown-options/{id}`
_[معطَّل نهائيًا] حذف خيار — استُبدل بالتعطيل فقط_

- **الصلاحية:** `manage_configurations` · **الأدوار:** data_entry · **حد الطلبات:** global 600/min/user
- **Parameters:** `id` (path, required, uuid)

**مثال — Hard delete is refused → 403 (use isActive=false)** (`data_entry`, `X-Client-Type: web`) → **403**

```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "الحذف النهائي غير مسموح به نهائيًا؛ استخدم تعطيل الخيار (PATCH isActive=false) بدلًا من ذلك"
  }
}
```

#### `PATCH /api/v1/dropdown-options/{id}`
_تعديل خيار (تعديل جزئي / تعطيل)_

- **الصلاحية:** `manage_configurations` · **الأدوار:** data_entry · **حد الطلبات:** global 600/min/user
- **Parameters:** `id` (path, required, uuid)

<details><summary>Body fields</summary>

| field | type |
|---|---|
| `label` | string |
| `sortOrder` | integer |
| `isActive` | boolean |
| `isOther` | boolean |

</details>

**مثال — Edit option** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "label": "خيار تجريبي معدل",
  "sortOrder": 98,
  "isActive": true,
  "isOther": false
}
```
```json
{
  "success": true,
  "data": {
    "id": "{{optionId}}",
    "configId": "{{configId}}",
    "value": "demo_option",
    "label": "خيار تجريبي معدل",
    "isOther": false,
    "isActive": true,
    "sortOrder": 98,
    "parentOptionId": null
  },
  "message": null
}
```

**مثال — Deactivate option (the way to remove one)** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "label": null,
  "sortOrder": null,
  "isActive": false,
  "isOther": null
}
```
```json
{
  "success": true,
  "data": {
    "id": "{{optionId}}",
    "configId": "{{configId}}",
    "value": "demo_option",
    "label": "خيار تجريبي معدل",
    "isOther": false,
    "isActive": false,
    "sortOrder": 98,
    "parentOptionId": null
  },
  "message": null
}
```

#### `GET /api/v1/dropdowns`
_جلب مجموعة من قوائم الضبط (بالمفتاح والتسمية) للاستخدام في النماذج_

- **الصلاحية:** `(any signed-in user)` · **الأدوار:** all roles · **حد الطلبات:** global 600/min/user
- **Parameters:** `step` (query, integer), `fieldType` (query, string)

**مثال — All dropdowns (form options)** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": [
    {
      "key": "gender",
      "label": "النوع",
      "fieldType": "select",
      "step": 1
    },
    {
      "key": "religion",
      "label": "الديانة",
      "fieldType": "select",
      "step": 1
    },
    "… 51 more"
  ],
  "message": null
}
```

#### `GET /api/v1/dropdowns/{key}`
_جلب خيارات قائمة للاستخدام في النماذج (مع تخزين مؤقت)_

- **الصلاحية:** `(any signed-in user)` · **الأدوار:** all roles · **حد الطلبات:** global 600/min/user
- **Parameters:** `key` (path, required, string)

**مثال — One dropdown by key** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "key": "housingType",
    "options": []
  },
  "message": null
}
```

**مثال — Villages dropdown (live)** (`data_entry`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "key": "village",
    "options": []
  },
  "message": null
}
```

### 19.18 Audit

#### `GET /api/v1/audit-logs`
_سجل التدقيق: استعراض العمليات الحساسة المسجَّلة في النظام_

- **الصلاحية:** `view_cases` · **الأدوار:** manager, reviewer, data_entry, social_worker · **حد الطلبات:** global 600/min/user
- **Parameters:** `actorId` (query, uuid), `entityType` (query, string), `entityId` (query, uuid), `from` (query, date-time (ISO 8601, UTC)), `to` (query, date-time (ISO 8601, UTC)), `page` (query, integer), `limit` (query, integer)

**مثال — Audit log** (`manager`, `X-Client-Type: web`) → **200**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "817b7f32-1f00-4a4a-8ede-7ef09589f515",
        "actorId": "fc08da9e-d5ff-429d-8a7c-f35d68037179",
        "actorName": "مستخدم تجريبي manager",
        "action": "CASE_FORCE_REJECTED",
        "entityType": "case",
        "entityId": "{{caseId3}}",
        "oldValue": null,
        "newValue": "{\"status\": \"rejected\"}",
        "ipAddress": "203.0.113.10",
        "userAgent": "python-requests/2.32.5",
        "requestId": "83d3adf6-f0e9-44cb-bdaa-5da0777f48f0",
        "createdAtUtc": "2026-09-25T02:23:31.944759+00:00"
      },
      {
        "id": "9a20c18a-0a4b-426c-a050-8e10e1a15c8a",
        "actorId": "2439b401-9753-4a17-b2d8-d44edc07b8f2",
        "actorName": "مستخدم تجريبي data_entry",
        "action": "CASE_VIEWED",
        "entityType": "case",
        "entityId": "{{caseId3}}",
        "oldValue": null,
        "newValue": null,
        "ipAddress": "203.0.113.10",
        "userAgent": "python-requests/2.32.5",
        "requestId": "31a6272b-4464-450e-8c98-8cb1ffa06d7b",
        "createdAtUtc": "2026-09-25T02:23:31.896513+00:00"
      },
      "… 18 more"
    ],
    "page": 1,
    "limit": 20,
    "total": 72,
    "totalPages": 4,
    "hasNext": true,
    "hasPrev": false
  },
  "message": null
}
```


## 20. المطلوب من الفرونت إند (Checklist)

1. [ ] غيّروا الـ base URL لـ `https://srv1990155.hstgr.cloud` وابعتوا origin الويب للباك إند عشان يتضاف في CORS.
2. [ ] Refresh token مرة واحدة في نفس الوقت (single-flight) — §4. من غيرها المستخدم هيخرج.
3. [ ] شيلوا أي تعامل مع `423 ACCOUNT_LOCKED` ورسالة "الحساب اتقفل" — مفيش قفل خلاص.
4. [ ] صفحة الحالة: طلب واحد `GET /cases/{id}`؛ `/support`, `/attachments`, `/legacy-record`, `/field-visits` لما التاب يتفتح بس.
5. [ ] ماتبعتوش IDs مؤقتة (`new_…`) — استنوا `POST /cases` يرجع الـ `id`.
6. [ ] الفورمز: `GET /dropdowns/{key}` (مش `/dropdown-configs`) وخزنوها للجلسة.
7. [ ] اخفوا الشاشات والأزرار حسب `user.permissions` و `workflow.availableActions`.
8. [ ] Debounce للبحث 400ms وحرفين على الأقل.
9. [ ] `Idempotency-Key` (UUID) في كل طلبات سير العمل والزيارات والـ commit.
10. [ ] `rowVersion`/`caseRowVersion` في كل تعديل؛ عند `409` اعملوا refresh واعرضوا الجديد.
11. [ ] الأقسام الجديدة: سجل الدعم (عرض + تعديل)، السجل الأصلي (قراءة)، `birthDate`/`phone` للأسرة، `bathroomType`، `details` للأجهزة، المصروفات الاختيارية.
12. [ ] النصوص الطويلة (وصف السكن، الملاحظات، التقارير) — textarea بدون حد، وعرض multi-line.
13. [ ] منشئ التقارير: الـ enums **أرقام** (§16).
14. [ ] الموبايل: سجّلوا FCM token؛ الـ push متوقف حالياً فاعملوا refresh للإشعارات عند فتح الشاشة.
15. [ ] ارفعوا الملفات بالـ 3 خطوات (init → PUT → commit)، ولينك التحميل مؤقت.

## 21. استخدام Postman

1. Import الملفين: `postman/Nahda_API.postman_collection.json` و `postman/Nahda_Production.postman_environment.json`، واختاروا environment **Nahda — Production**.
2. في الـ environment املوا `email` و `password` بحساب حقيقي ليكم (كل دور بحسابه). `clientType` = `web` (أو `mobile` للأخصائي).
3. شغّلوا **01 Auth → Login**: بيحفظ `accessToken` و `refreshToken` تلقائياً، وكل الطلبات بعدها بتستخدمهم.
4. `GET Case details` بيحفظ `caseRowVersion` و `beneficiaryRowVersion` و `housingRowVersion` … تلقائياً، و `Create case` بيحفظ `caseId`.
5. طلبات سير العمل فيها `Idempotency-Key: {{$guid}}` تلقائي.
6. كل طلب فيه **Example** بالرد الحقيقي (من التشغيل التجريبي) ووصف بالصلاحية والملاحظات.
7. **اسم كل طلب فيه الدور المطلوب بين قوسين** (مثلاً `[manager]`, `[social_worker]`). الـ collection بتستخدم حساب واحد في المرة: عشان تجربوا طلب بدور معين، غيّروا `email`/`password` (و`clientType` = `mobile` للأخصائي) واعملوا Login تاني. طلبات الأخطاء المقصودة (403، 409…) بتدي الخطأ ده بس لو اتبعتت بالدور المكتوب.
8. تم اختبار الـ collection بـ newman على السيرفر التجريبي: كل طلبات القراءة رجعت نفس الـ status المسجل.

> ⚠️ **الـ collection متوجهة للإنتاج.** أي POST/PUT/PATCH/DELETE هيغيّر بيانات حقيقية. جربوا القراءة براحتكم، والكتابة على حالة تجريبية بس، ومتقربوش من فولدر **99 ⚠️ Dangerous**.

## 22. سجل التغييرات الأخيرة

| التاريخ | التغيير |
|---|---|
| 2026-09-25 | إلغاء قفل الحساب وحد محاولات الدخول. سجل الدعم المصروف (`/support-history`) والسجل الأصلي (`/legacy-record`). حقول جديدة: `familyMembers[].birthDate/phone`، `housing.bathroomType`، `appliances[].details`. مصروفات اختيارية (العلاج الشهري، مصروفات أخرى). النصوص الطويلة بلا حد. بيانات الإكسيل القديمة كلها في الأقسام. |
| 2026-09-24 | HTTPS + HSTS على `srv1990155.hstgr.cloud`. حماية إعادة استخدام الـ refresh token. حدود طلبات لكل مستخدم (البحث 180/دقيقة). حالات `returned_to_worker` بدون مسند إليه بقت قابلة للإسناد. الآراء «لم يتم البت» اتشالت (null). |

_Endpoints documented: 117. Recorded calls: 160._
