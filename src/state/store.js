/* --------------------------------------------------------------------------
   CENTRAL REACTIVE APPLICATION STORE
   Single source of truth for runtime application state.
   -------------------------------------------------------------------------- */
import { StorageService, STORAGE_KEYS } from '../services/storage.js';
import { EventBus, EVENTS } from '../core/event-bus.js';

const defaultBgSettings = {
  type: 'image',
  val: 'assets/background.jpg',
  blur: 20,
  brightness: 89,
  contrast: 98,
  saturate: 140,
  overlay: 22
};

let initialCharities = StorageService.get(STORAGE_KEYS.CHARITIES, []);
if (Array.isArray(initialCharities) && initialCharities.some(c => c.code && c.code.startsWith('CH-10'))) {
  initialCharities = [];
  StorageService.set(STORAGE_KEYS.CHARITIES, []);
}

const ROLE_HIERARCHY = {
  manager: 1,
  reviewer: 2,
  social_worker: 3,
  data_entry: 4
};

// أدوار تسجيل الدخول في الويب. الأخصائي الميداني مستبعد عمدًا: هو موظف في
// الجدول (الويب بيسند له حالات) لكن شغله من تطبيق الموبايل المنفصل.
const WEB_LOGIN_ROLES = ['manager', 'reviewer', 'data_entry'];

// ترحيل الجلسات القديمة: دور admin (مدير النظام) اتشال، وجلسات الأخصائي
// مابقتش تتفتح من الويب — الاتنين بيرجعوا لأقل دور بدل ما يفضلوا شغالين.
function migrateStoredUser(user) {
  if (!user || !WEB_LOGIN_ROLES.includes(user.roleCode)) {
    return {
      name: 'حسن',
      roleLabel: 'مدخل بيانات',
      roleCode: 'data_entry',
      email: 'hassan@gmail.com',
      gender: 'ذكر',
      phone: '01055667788',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80'
    };
  }
  return user;
}

let initialEmployees = StorageService.get(STORAGE_KEYS.EMPLOYEES, []);
if (Array.isArray(initialEmployees)) {
  initialEmployees = initialEmployees.filter(e => e.roleCode !== 'supervisor');
  initialEmployees.sort((a, b) => (ROLE_HIERARCHY[a.roleCode] || 99) - (ROLE_HIERARCHY[b.roleCode] || 99));
  StorageService.set(STORAGE_KEYS.EMPLOYEES, initialEmployees);
}

class AppStore {
  constructor() {
    // تنضيف مرة واحدة لأي حالة قديمة كانت متخزنة "للأبد" في localStorage
    // من قبل إلغاء التخزين الدائم لـ currentCase — غير كده كانت هتفضل
    // موجودة في القرص من غير أي استخدام، ومربكة لو حد فتح devtools يدوّر.
    StorageService.remove(STORAGE_KEYS.CURRENT_CASE);
    this.state = {
      currentView: StorageService.get(STORAGE_KEYS.CURRENT_VIEW, 'login'),
      activeStage: StorageService.get(STORAGE_KEYS.ACTIVE_STAGE, '1'),
      currentUser: migrateStoredUser(StorageService.get(STORAGE_KEYS.CURRENT_USER, null)),
      bgSettings: Object.assign({}, defaultBgSettings, StorageService.get(STORAGE_KEYS.BG_SETTINGS, {})),
      familyMembers: StorageService.get(STORAGE_KEYS.FAMILY_MEMBERS, []),
      charities: initialCharities,
      employees: initialEmployees,
      beniSuefLocations: StorageService.get(STORAGE_KEYS.BENI_SUEF_LOCATIONS, {}),
      // Server ids for the same centers/villages, keyed by name (name is
      // unique per the same rules the backend enforces — per-center for
      // villages, global for centers). Populated once /locations loads;
      // never persisted, since ids are only meaningful for the live session
      // talking to a specific backend. Consumers that only render/cascade by
      // name keep using `beniSuefLocations` untouched; write operations
      // (add/rename/delete) resolve through this map to call the real API.
      locationIds: { centers: {}, villages: {} },
      agriculture: StorageService.get(STORAGE_KEYS.AGRICULTURE, null),
      visitedStages: StorageService.get(STORAGE_KEYS.VISITED_STAGES, []),
      // الحالة (Case) الجاري إدخالها عبر معالج البيانات الشخصية. `id` بيتحدد
      // فقط بعد أول POST /cases (من المرحلة 1، عند الضغط على "التالي") —
      // قبل كده null ومفيش أي PUT قسم يقدر ينفّذ. `sectionVersions` بيحمل
      // rowVersion/caseRowVersion آخر رد من كل قسم، لازم تترجع بالظبط في
      // الطلب اللي بعده (تفاؤل التزامن — §5 من التوثيق).
      //
      // مقصود عدم قراءتها من localStorage هنا: كانت بتفضل محفوظة "للأبد"
      // بين الجلسات (تفتح الصفحة تاني بعد يوم تلاقي حالة إنشاء قديمة لسه
      // شغالة)، فلو المستخدم كتب رقم قومي بيتكرر مع حالة قديمة، الفورم كان
      // بيحدّث الحالة القديمة (PUT) بصمت بدل إنشاء حالة جديدة (POST). دلوقتي
      // currentCase in-memory بس، وبيتصفّر تلقائيًا بمجرد تحديث/فتح الصفحة.
      currentCase: null,
      incomeItems: [],
      expenseItems: [],
      assessedNeeds: [],
      searchMode: 'nid'
    };
  }

  // Getters
  get currentView() { return this.state.currentView; }
  get activeStage() { return this.state.activeStage; }
  get currentUser() { return this.state.currentUser; }
  get bgSettings() { return this.state.bgSettings; }
  get familyMembers() { return this.state.familyMembers; }
  get charities() { return this.state.charities || []; }
  get employees() { return this.state.employees || []; }
  get beniSuefLocations() { return this.state.beniSuefLocations || {}; }
  get locationIds() { return this.state.locationIds || { centers: {}, villages: {} }; }
  get agriculture() { return this.state.agriculture; }
  get visitedStages() { return Array.isArray(this.state.visitedStages) ? this.state.visitedStages : []; }
  get incomeItems() { return this.state.incomeItems; }
  get expenseItems() { return this.state.expenseItems; }
  get assessedNeeds() { return this.state.assessedNeeds; }
  get searchMode() { return this.state.searchMode; }
  get currentCase() { return this.state.currentCase; }

  // User Profile Actions
  setCurrentUser(userData, persist = true) {
    this.state.currentUser = Object.assign({}, this.state.currentUser, userData);
    if (persist) {
      StorageService.set(STORAGE_KEYS.CURRENT_USER, this.state.currentUser);
    }
    EventBus.emit(EVENTS.USER_CHANGED, this.state.currentUser);
  }

  /**
   * Full replace (not merge) — used after a real login/`/auth/me` response,
   * where the server payload is authoritative and any leftover mock fields
   * from a previous session must not survive.
   */
  replaceCurrentUser(userData, persist = true) {
    this.state.currentUser = userData ? { ...userData } : null;
    if (persist) {
      StorageService.set(STORAGE_KEYS.CURRENT_USER, this.state.currentUser);
    }
    EventBus.emit(EVENTS.USER_CHANGED, this.state.currentUser);
  }

  /** Clears the session-scoped user on logout. Non-user state (bg settings
   * etc.) is intentionally left alone — it's a device preference, not account data. */
  clearCurrentUser() {
    this.state.currentUser = null;
    StorageService.remove(STORAGE_KEYS.CURRENT_USER);
    EventBus.emit(EVENTS.USER_CHANGED, null);
  }

  // Location Actions
  setBeniSuefLocations(locations, persist = true) {
    this.state.beniSuefLocations = locations;
    if (persist) {
      StorageService.set(STORAGE_KEYS.BENI_SUEF_LOCATIONS, locations);
    }
    EventBus.emit(EVENTS.LOCATIONS_UPDATED, locations);
  }

  /**
   * Rebuilds both the name-keyed `beniSuefLocations` (unchanged shape, so
   * every existing consumer — cascades, charity forms — keeps working) and
   * the id-keyed `locationIds` lookup, from a fresh `GET /locations`
   * response (`[{id,name,villages:[{id,name}]}]`). Never persisted to
   * localStorage — ids are only valid for the live backend session.
   */
  applyLocationsFromServer(centers) {
    const byName = {};
    const centerIds = {};
    const villageIds = {};

    (centers || []).forEach(center => {
      byName[center.name] = (center.villages || []).map(v => v.name);
      centerIds[center.name] = center.id;
      villageIds[center.name] = {};
      (center.villages || []).forEach(v => {
        villageIds[center.name][v.name] = v.id;
      });
    });

    this.state.locationIds = { centers: centerIds, villages: villageIds };
    this.setBeniSuefLocations(byName, false);
  }

  /** No local seed dataset exists; the real reset goes through LocationsService.reset() + applyLocationsFromServer(). */
  resetBeniSuefLocations() {
    this.setBeniSuefLocations({});
  }

  // Actions
  setCharities(charities, persist = true) {
    this.state.charities = charities;
    if (persist) {
      StorageService.set(STORAGE_KEYS.CHARITIES, charities);
    }
    EventBus.emit(EVENTS.CHARITIES_UPDATED, charities);
  }

  addCharity(charity) {
    const updated = [charity, ...this.state.charities];
    this.setCharities(updated);
  }

  updateCharity(id, updatedData) {
    const updated = this.state.charities.map(c => c.id === id ? { ...c, ...updatedData } : c);
    this.setCharities(updated);
  }

  removeCharity(id) {
    const updated = this.state.charities.filter(c => c.id !== id);
    this.setCharities(updated);
  }

  resetCharities() {
    // No seeded charities dataset exists; reset clears the list.
    this.setCharities([]);
  }

  // Employee Management Actions
  setEmployees(employees, persist = true) {
    this.state.employees = employees;
    if (persist) {
      StorageService.set(STORAGE_KEYS.EMPLOYEES, employees);
    }
    EventBus.emit(EVENTS.EMPLOYEES_UPDATED, employees);
  }

  addEmployee(employee) {
    const updated = [...this.state.employees, employee];
    updated.sort((a, b) => (ROLE_HIERARCHY[a.roleCode] || 99) - (ROLE_HIERARCHY[b.roleCode] || 99));
    this.setEmployees(updated);
  }

  updateEmployee(id, updatedData) {
    const updated = this.state.employees.map(e => e.id === id ? { ...e, ...updatedData } : e);
    updated.sort((a, b) => (ROLE_HIERARCHY[a.roleCode] || 99) - (ROLE_HIERARCHY[b.roleCode] || 99));
    this.setEmployees(updated);
  }

  removeEmployee(id) {
    const updated = this.state.employees.filter(e => e.id !== id);
    this.setEmployees(updated);
  }

  // No seeded employees dataset exists; reset clears the list.
  resetEmployees() {
    this.setEmployees([]);
  }

  // Actions
  setCurrentView(viewName, persist = true) {
    this.state.currentView = viewName;
    if (persist) {
      StorageService.set(STORAGE_KEYS.CURRENT_VIEW, viewName);
    }
    EventBus.emit(EVENTS.VIEW_CHANGED, viewName);
  }

  setActiveStage(stageNumber, persist = true) {
    this.state.activeStage = String(stageNumber);
    if (persist) {
      StorageService.set(STORAGE_KEYS.ACTIVE_STAGE, String(stageNumber));
    }
    this.markStageVisited(stageNumber);
    EventBus.emit(EVENTS.WORKFLOW_STEP_CHANGED, String(stageNumber));
  }

  // تتبّع المراحل اللي المستخدم فتحها فعلًا — علشان نفرّق بين "مرحلة مُجاب
  // عنها بـ (لا)" و "مرحلة لسه محدش شافها" في حساب نسب الإكمال.
  markStageVisited(stageNumber) {
    const key = String(stageNumber);
    const visited = this.visitedStages;
    if (visited.includes(key)) return;
    this.state.visitedStages = [...visited, key];
    StorageService.set(STORAGE_KEYS.VISITED_STAGES, this.state.visitedStages);
  }

  isStageVisited(stageNumber) {
    return this.visitedStages.includes(String(stageNumber));
  }

  setAgriculture(data) {
    this.state.agriculture = data;
    StorageService.set(STORAGE_KEYS.AGRICULTURE, data);
    EventBus.emit(EVENTS.AGRICULTURE_UPDATED, data);
  }

  updateBgSettings(newSettings) {
    this.state.bgSettings = Object.assign({}, this.state.bgSettings, newSettings);
    StorageService.set(STORAGE_KEYS.BG_SETTINGS, this.state.bgSettings);
    EventBus.emit(EVENTS.BG_SETTINGS_CHANGED, this.state.bgSettings);
  }

  resetBgSettings() {
    this.state.bgSettings = Object.assign({}, defaultBgSettings);
    StorageService.set(STORAGE_KEYS.BG_SETTINGS, this.state.bgSettings);
    EventBus.emit(EVENTS.BG_SETTINGS_CHANGED, this.state.bgSettings);
  }

  setFamilyMembers(members) {
    this.state.familyMembers = members;
    StorageService.set(STORAGE_KEYS.FAMILY_MEMBERS, members);
    EventBus.emit(EVENTS.FAMILY_MEMBERS_UPDATED, members);
    EventBus.emit(EVENTS.WORKFLOW_RECALC_TRIGGERED);
  }

  addFamilyMember(member) {
    const updated = [...this.state.familyMembers, member];
    this.setFamilyMembers(updated);
  }

  removeFamilyMember(index) {
    const updated = [...this.state.familyMembers];
    updated.splice(index, 1);
    this.setFamilyMembers(updated);
  }

  setFinancialItems(incomeItems, expenseItems) {
    this.state.incomeItems = incomeItems;
    this.state.expenseItems = expenseItems;
    EventBus.emit(EVENTS.FINANCIAL_DATA_UPDATED, { incomeItems, expenseItems });
  }

  setAssessedNeeds(needs) {
    this.state.assessedNeeds = needs;
    EventBus.emit(EVENTS.ASSESSED_NEEDS_UPDATED, needs);
    EventBus.emit(EVENTS.WORKFLOW_RECALC_TRIGGERED);
  }

  setSearchMode(mode) {
    this.state.searchMode = mode;
  }

  // Case-in-progress Actions
  /**
   * Full replace of the in-progress case reference. Called once right after
   * `POST /cases` succeeds (step 1's "التالي"), then again after every
   * successful section PUT to record its returned rowVersion/caseRowVersion.
   * @param {Object|null} caseData - {id, caseNumber, status, sectionVersions:{beneficiary,housing,utilities,agriculture,financial,support,...}}
   */
  setCurrentCase(caseData) {
    this.state.currentCase = caseData;
    EventBus.emit(EVENTS.CASE_UPDATED, caseData);
  }

  /** Merges a single section's fresh version token after a successful save — never overwrites sibling sections. */
  setSectionVersion(sectionKey, version) {
    if (!this.state.currentCase) return;
    const sectionVersions = { ...(this.state.currentCase.sectionVersions || {}), [sectionKey]: version };
    this.setCurrentCase({ ...this.state.currentCase, sectionVersions });
  }

  /** Clears the in-progress case — used when starting a brand-new case entry from scratch. */
  clearCurrentCase() {
    this.setCurrentCase(null);
  }
}

export const store = new AppStore();
