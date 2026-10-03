/* --------------------------------------------------------------------------
   EDIT PROFILE COMPONENT CONTROLLER
   Full backend integration with Profile API (/api/v1/profile):
     - GET /profile: Loads full profile with fresh 15-minute presigned avatarUrl
     - PUT /profile: Updates fullName, phone, gender with rowVersion concurrency check
     - POST /profile/avatar/init -> direct PUT storage -> POST /profile/avatar/confirm
     - DELETE /profile/avatar: Deletes avatar and resets to default placeholder
     - Synchronizes store.currentUser and broadcasts EVENTS.USER_CHANGED app-wide
   -------------------------------------------------------------------------- */
import { store } from '../../state/store.js';
import { DOM } from '../../utils/dom.js';
import { showToast } from '../../utils/toast.js';
import { EventBus, EVENTS } from '../../core/event-bus.js';
import { roleLabel, currentRole } from '../../core/permissions.js';
import { ProfileService, ALLOWED_AVATAR_MIMES, MAX_AVATAR_SIZE_BYTES } from '../../services/profile.service.js';
import { ApiError, messageFromError } from '../../services/errors.js';
import { confirmDialog } from '../../utils/dialog.js';
import { onViewEnter } from '../../core/view-lifecycle.js';

export const DEFAULT_AVATAR = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80';

let currentProfileRowVersion = 1;

/**
 * Loads current user profile from the server, updates local state, and populates the form.
 * Ensures the presigned avatarUrl (which expires in 15 minutes) is always freshly retrieved.
 */
export async function loadUserProfile() {
  const form = DOM.qs('#profile-form');
  if (!form) return;

  try {
    const profile = await ProfileService.getProfile();
    if (profile) {
      if (profile.rowVersion !== undefined) {
        currentProfileRowVersion = profile.rowVersion;
      }

      // Sync fresh values to global store
      store.setCurrentUser({
        id: profile.id || store.currentUser?.id,
        name: profile.fullName || store.currentUser?.name,
        email: profile.email || store.currentUser?.email,
        phone: profile.phone || '',
        gender: profile.gender || 'male',
        avatar: profile.avatarUrl || null,
        roleCode: profile.role || store.currentUser?.roleCode
      });

      populateForm(profile);
      return profile;
    }
  } catch (err) {
    console.warn('[ProfileComponent] Failed to fetch server profile, falling back to local store:', err);
    populateForm();
  }
}

/**
 * Populates the profile form elements from given data or store.currentUser fallback.
 */
function populateForm(data) {
  const user = store.currentUser || {};
  const form = DOM.qs('#profile-form');
  if (!form) return;

  const avatarPreview = DOM.qs('#profile-avatar-preview');
  const nameInput = DOM.qs('#profile-name-input');
  const emailInput = DOM.qs('#profile-email-input');
  const genderSelect = DOM.qs('#profile-gender-select');
  const phoneInput = DOM.qs('#profile-phone-input');
  const roleInput = DOM.qs('#profile-role-input');
  const rowVersionInput = DOM.qs('#profile-row-version');
  const btnDeleteAvatar = DOM.qs('#btn-delete-avatar');

  const avatarUrl = (data && data.avatarUrl) || user.avatar || DEFAULT_AVATAR;
  const hasCustomAvatar = Boolean((data && data.avatarUrl) || (user.avatar && user.avatar !== DEFAULT_AVATAR));

  if (avatarPreview) avatarPreview.src = avatarUrl;
  if (nameInput) nameInput.value = (data && data.fullName) || user.name || '';
  if (emailInput) emailInput.value = (data && data.email) || user.email || '';

  // Match gender code: 'male' | 'female'
  const rawGender = (data && data.gender) || user.gender || 'male';
  const normalizedGender = rawGender === 'أنثى' || rawGender === 'female' ? 'female' : 'male';
  if (genderSelect) genderSelect.value = normalizedGender;

  if (phoneInput) phoneInput.value = (data && data.phone) || user.phone || '';
  if (roleInput) roleInput.value = roleLabel((data && data.role) || currentRole());

  if (rowVersionInput) {
    const rv = (data && data.rowVersion !== undefined) ? data.rowVersion : currentProfileRowVersion;
    rowVersionInput.value = String(rv);
    currentProfileRowVersion = rv;
  }

  if (btnDeleteAvatar) {
    btnDeleteAvatar.style.display = hasCustomAvatar ? 'inline-flex' : 'none';
  }
}

export function initProfileComponent() {
  const form = DOM.qs('#profile-form');
  if (!form) return;

  const avatarPreview = DOM.qs('#profile-avatar-preview');
  const avatarFileInput = DOM.qs('#profile-avatar-file-input');
  const avatarLoading = DOM.qs('#profile-avatar-loading');
  const avatarStageText = DOM.qs('#profile-avatar-stage');
  const btnDeleteAvatar = DOM.qs('#btn-delete-avatar');
  const nameInput = DOM.qs('#profile-name-input');
  const phoneInput = DOM.qs('#profile-phone-input');
  const genderSelect = DOM.qs('#profile-gender-select');
  const saveBtn = DOM.qs('#btn-save-profile');
  const saveSpinner = DOM.qs('#profile-save-spinner');

  // Initial population from store
  populateForm();

  // Fresh profile (and presigned avatar URL) each time the screen is opened.
  // Not at boot: the router already fetches /profile after /auth/me.
  onViewEnter('profile', () => loadUserProfile());

  // 1. Avatar File Upload Handler (Three-step presigned flow)
  if (avatarFileInput) {
    avatarFileInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      if (!ALLOWED_AVATAR_MIMES.has(file.type)) {
        showToast('الصيغ المدعومة للصورة هي JPG و PNG و WEBP فقط ⚠️', 'warning');
        avatarFileInput.value = '';
        return;
      }

      if (file.size > MAX_AVATAR_SIZE_BYTES) {
        showToast('حجم الصورة كبير جداً (الحد الأقصى 5 ميجابايت) ⚠️', 'warning');
        avatarFileInput.value = '';
        return;
      }

      // Show upload overlay
      if (avatarLoading) avatarLoading.style.display = 'flex';
      if (avatarStageText) avatarStageText.textContent = 'جاري التجهيز...';

      try {
        const result = await ProfileService.uploadAvatar(file, (progress) => {
          if (!avatarStageText) return;
          if (progress.stage === 'init') {
            avatarStageText.textContent = 'تجهيز الرابط...';
          } else if (progress.stage === 'uploading') {
            avatarStageText.textContent = 'جاري الرفع...';
          } else if (progress.stage === 'confirm') {
            avatarStageText.textContent = 'التحقق والحفظ...';
          }
        });

        const newAvatarUrl = result.avatarUrl;
        if (avatarPreview && newAvatarUrl) {
          avatarPreview.src = newAvatarUrl;
        }

        // Update local user in store so sidebar and hero reflect immediately
        store.setCurrentUser({ avatar: newAvatarUrl });

        if (btnDeleteAvatar) {
          btnDeleteAvatar.style.display = 'inline-flex';
        }

        showToast('تم رفع الصورة الشخصية بنجاح 📷✨');

        // Avatar upload bumps rowVersion server-side; refresh it before any future PUT
        await loadUserProfile();
      } catch (err) {
        console.error('Avatar upload failed:', err);
        showToast(messageFromError(err) || 'تعذر رفع الصورة الشخصية، حاول ثانية', 'error');
      } finally {
        if (avatarLoading) avatarLoading.style.display = 'none';
        avatarFileInput.value = '';
      }
    });
  }

  // 2. Avatar Delete Handler
  if (btnDeleteAvatar) {
    btnDeleteAvatar.addEventListener('click', async () => {
      const confirmed = await confirmDialog({
        title: 'حذف الصورة الشخصية',
        message: 'هل أنت متأكد من رغبتك في حذف صورتك الشخصية؟',
        confirmLabel: 'حذف الصورة',
        danger: true
      });
      if (!confirmed) return;

      btnDeleteAvatar.disabled = true;
      try {
        await ProfileService.deleteAvatar();

        if (avatarPreview) {
          avatarPreview.src = DEFAULT_AVATAR;
        }

        // Update local user in store so sidebar and hero reflect immediately
        store.setCurrentUser({ avatar: null });

        btnDeleteAvatar.style.display = 'none';
        showToast('تم حذف الصورة الشخصية بنجاح 🗑️');

        // Avatar delete bumps rowVersion server-side; refresh it before any future PUT
        await loadUserProfile();
      } catch (err) {
        console.error('Failed to delete avatar:', err);
        showToast(messageFromError(err) || 'تعذر حذف الصورة الشخصية', 'error');
      } finally {
        btnDeleteAvatar.disabled = false;
      }
    });
  }

  // 3. Form Submit Handler (Save Profile Changes via PUT /profile)
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const fullName = nameInput ? nameInput.value.trim() : '';
    const phone = phoneInput ? phoneInput.value.trim() : '';
    const gender = genderSelect ? genderSelect.value : 'male';

    if (!fullName) {
      showToast('الرجاء إدخال الاسم الكامل ⚠️', 'warning');
      if (nameInput) nameInput.focus();
      return;
    }

    if (phone && !/^01[0125][0-9]{8}$/.test(phone)) {
      showToast('يرجى إدخال رقم هاتف مصري صحيح مكون من 11 رقم ⚠️', 'warning');
      if (phoneInput) phoneInput.focus();
      return;
    }

    if (saveBtn) saveBtn.disabled = true;
    if (saveSpinner) saveSpinner.style.display = 'inline';

    try {
      await ProfileService.updateProfile({
        fullName,
        phone: phone || null,
        gender: gender || null,
        rowVersion: currentProfileRowVersion
      });

      // Update store state
      store.setCurrentUser({
        name: fullName,
        phone,
        gender
      });

      showToast('تم تحديث بيانات الملف الشخصي بنجاح ✨');

      // Reload profile to get next rowVersion
      await loadUserProfile();
    } catch (err) {
      console.error('Failed to update profile:', err);

      if (err instanceof ApiError && (err.httpStatus === 409 || err.code === 'CONCURRENCY_CONFLICT')) {
        showToast('تم تعديل البيانات من مكان آخر — جاري تحديث البيانات تلقائياً ⚠️', 'warning');
        await loadUserProfile();
      } else {
        showToast(messageFromError(err) || 'تعذر تحديث بيانات الملف الشخصي', 'error');
      }
    } finally {
      if (saveBtn) saveBtn.disabled = false;
      if (saveSpinner) saveSpinner.style.display = 'none';
    }
  });

  // 4. Re-sync form when user state changes
  EventBus.on(EVENTS.USER_CHANGED, () => {
    populateForm();
  });
}
