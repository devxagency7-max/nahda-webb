/* --------------------------------------------------------------------------
   FAMILY MEMBERS COMPONENT (إضافة فرد تابع لرب الأسرة)
   Handles inline modal form, student education cascade, card rendering,
   editing, deleting, and store synchronization.
   -------------------------------------------------------------------------- */
import { showToast } from '../../utils/toast.js';
import { triggerWorkflowRecalc } from '../../core/state.js';
import { store } from '../../state/store.js';
import { DOM } from '../../utils/dom.js';
import { parseEgyptianNationalId, normalizeNumerals } from '../../utils/nationalId.js';
import { isValidEgyptianPhone, PHONE_ERROR_MESSAGE } from '../../utils/phone.js';
import { confirmDialog } from '../../utils/dialog.js';

/**
 * قيم الحقول اللي السيرفر بيفرّق فيها بين null («سيب القديم») و"" («امسح»)،
 * بأسماء الـ API، من شكل الكارت (dataset أو بيانات الفورم). المرحلة/الصف/الكلية
 * للطالب بس، والمؤهل لغير الطالب بس.
 */
export function memberClearableValues(m) {
  const student = m.isStudent === true || m.isStudent === 'true';
  const text = v => (v == null ? '' : String(v).trim());
  return {
    nationalId: text(m.idNum),
    job: m.job === 'غير محدد' ? '' : text(m.job),
    notes: text(m.notes),
    grade: student ? text(m.grade) : '',
    university: student ? text(m.university) : '',
    phone: text(m.phone),
    diseases: text(m.diseases),
    educationStage: student ? text(m.stage) : '',
    education: student ? '' : text(m.qualification)
  };
}

/** الحقول (بأسماء الـ API) اللي كان فيها قيمة في أي وقت — `dataset.filled`. */
export function memberFilledKeys(m) {
  return new Set(String(m.filled || '').split(',').filter(Boolean));
}

/**
 * يحط قيمة في select — لو مش من الخيارات، بيفعّل «أخرى» بالقيمة الحرة
 * (other-dropdowns.component.js) بدل ما المتصفح يسيب الـ select فاضي.
 */
function setSelectWithOther(select, value) {
  if (!select) return;
  resetOtherOption(select);
  if (!value) return;
  if ([...select.options].some(o => o.value === value)) {
    select.value = value;
  } else {
    const otherOpt = [...select.options].find(o => o.dataset.isOther === 'true' || o.value === 'أخرى');
    if (!otherOpt) return;
    otherOpt.value = value;
    otherOpt.textContent = `أخرى: ${value}`;
    select.value = value;
  }
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

/** يرجّع خيار «أخرى» لأصله ويفضّي الـ select (ويقفل خانة الكتابة الحرة). */
function resetOtherOption(select) {
  if (!select) return;
  const otherOpt = [...select.options].find(o => o.dataset.isOther === 'true');
  if (otherOpt) {
    otherOpt.value = 'أخرى';
    otherOpt.textContent = 'أخرى (كتابة مخصصة...)';
  }
  select.value = '';
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

// initFamilyMembersManager() بيتنادى مرة واحدة بس عند فتح التطبيق — قائمة
// الأفراد وuseCount بتاعتها closures محلية، فمفيش طريقة توصلهم من برّه غير
// callback بيتسجّل هنا، يستخدمه resetFamilyMembersManager تحت.
let _resetCallback = null;

/** يمسح كل الأفراد التابعين المعروضين — بيتنادى لما المستخدم يبدأ حالة جديدة. */
export function resetFamilyMembersManager() {
  if (_resetCallback) _resetCallback();
}

let _loadCallback = null;

/**
 * يعرض أفراد أسرة حالة محفوظة سابقًا — بيتنادى لما المستخدم يفتح حالة
 * موجودة للتعديل. `members` بنفس شكل بيانات الكارت (dataset): name, relation,
 * idNum, age, gender, religion, phone, job, income, notes, diseases, isStudent,
 * stage, grade, university, qualification, takafulKarama, takafulKaramaAmount.
 */
export function loadFamilyMembersManager(members) {
  if (_loadCallback) _loadCallback(members || []);
}

export function initFamilyMembersManager() {
  const btnOpenModal = DOM.qs('#btn-open-add-member');
  const btnCloseModal = DOM.qs('#btn-close-member-modal');
  const btnCancelModal = DOM.qs('#btn-cancel-add-member');
  const btnSaveMember = DOM.qs('#btn-save-member');
  const inlineForm = DOM.qs('#add-member-inline-form');
  const formTitle = inlineForm ? inlineForm.querySelector('.modal-card__title') : null;
  const saveBtnLabel = btnSaveMember ? btnSaveMember.querySelector('span') : null;
  const membersList = DOM.qs('#members-list');
  const countBadge = DOM.qs('#members-count-badge');

  // National ID & Age fields for family member
  const memberIdInput = DOM.qs('#new-member-id');
  const memberAgeInput = DOM.qs('#new-member-age');
  const memberGenderSelect = DOM.qs('#new-member-gender');
  const memberReligionSelect = DOM.qs('#new-member-religion');

  if (memberIdInput) {
    memberIdInput.addEventListener('input', () => {
      const cleanVal = normalizeNumerals(memberIdInput.value);
      if (memberIdInput.value !== cleanVal) {
        memberIdInput.value = cleanVal;
      }
      if (cleanVal.length === 14) {
        const result = parseEgyptianNationalId(cleanVal);
        if (result.valid) {
          if (memberAgeInput) memberAgeInput.value = result.age;
          if (memberGenderSelect) memberGenderSelect.value = result.genderAr;
          memberIdInput.style.borderColor = '#0d9488';
        } else {
          memberIdInput.style.borderColor = '#ef4444';
        }
      } else {
        memberIdInput.style.borderColor = '';
      }
    });
  }

  // Student/Education fields
  const isStudentCheckbox = DOM.qs('#new-member-is-student');
  const studentStageGroup = DOM.qs('#student-stage-group');
  const stageSelect       = DOM.qs('#new-member-education-stage') || DOM.qs('#new-member-stage');
  const gradeGroup        = DOM.qs('#student-grade-group');
  const gradeSelect       = DOM.qs('#new-member-grade');
  const universityGroup   = DOM.qs('#student-uni-group');
  const universityInput   = DOM.qs('#new-member-university');
  const studentFieldsWrapper = studentStageGroup;
  const qualificationGroup = DOM.qs('#non-student-qualification-group');
  const qualificationSelect = DOM.qs('#new-member-qualification');

  // تكافل وكرامة للفرد التابع
  const takafulCheckbox = DOM.qs('#new-member-takaful-karama');
  const takafulAmountGroup = DOM.qs('#new-member-takaful-amount-group');
  const takafulAmountInput = DOM.qs('#new-member-takaful-amount');

  // الأمراض (نص حر) للفرد التابع
  const diseasesInput = DOM.qs('#new-member-diseases');

  // هاتف الفرد — أرقام عربية ← إنجليزية أثناء الكتابة (مع الإبقاء على + و -).
  const phoneInput = DOM.qs('#new-member-phone');
  if (phoneInput) {
    phoneInput.addEventListener('input', () => {
      const clean = phoneInput.value
        .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
        .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
        .replace(/[^\d+\-\s]/g, '');
      if (clean !== phoneInput.value) phoneInput.value = clean;
    });
  }

  let editingCard = null;
  // مكان أصلي فاضي (placeholder) بيحجز موضع الفورم في الـ DOM لما يتقفل —
  // عشان نقدر نرجّعه لمكانه الطبيعي فوق القائمة بعد الإلغاء/الحفظ.
  const formPlaceholder = document.createComment('member-form-placeholder');
  if (inlineForm && inlineForm.parentNode) {
    inlineForm.parentNode.insertBefore(formPlaceholder, inlineForm);
  }

  function updateMembersCount() {
    if (!membersList || !countBadge) return;
    const total = membersList.querySelectorAll('.member-card').length;
    countBadge.textContent = `عدد الأفراد: ${total}`;
    const emptyState = DOM.qs('#members-empty-state');
    if (emptyState) {
      emptyState.style.display = total === 0 ? 'block' : 'none';
    }
    triggerWorkflowRecalc();
  }

  // Grade options mapping per educational stage
  const gradeOptionsMap = {
    'حضانة': ['KG1', 'KG2'],
    'ابتدائي': ['الصف الأول الابتدائي', 'الصف الثاني الابتدائي', 'الصف الثالث الابتدائي', 'الصف الرابع الابتدائي', 'الصف الخامس الابتدائي', 'الصف السادس الابتدائي'],
    'إعدادي': ['الصف الأول الإعدادي', 'الصف الثاني الإعدادي', 'الصف الثالث الإعدادي'],
    'إعدادية': ['الصف الأول الإعدادي', 'الصف الثاني الإعدادي', 'الصف الثالث الإعدادي'],
    'ثانوي': ['الصف الأول الثانوي', 'الصف الثاني الثانوي', 'الصف الثالث الثانوي'],
    'ثانوية': ['الصف الأول الثانوي', 'الصف الثاني الثانوي', 'الصف الثالث الثانوي']
  };

  function handleStageChange(selectedStage, savedGrade = '', savedUni = '') {
    const uniLabel = DOM.qs('#student-uni-label');

    if (gradeOptionsMap[selectedStage]) {
      if (gradeGroup) gradeGroup.style.display = 'block';
      if (universityGroup) universityGroup.style.display = 'none';
      if (universityInput) universityInput.value = '';

      if (gradeSelect) {
        gradeSelect.innerHTML = '<option value="" selected disabled>اختر الصف / المستوى...</option>';
        gradeOptionsMap[selectedStage].forEach(g => {
          const opt = document.createElement('option');
          opt.value = g;
          opt.textContent = g;
          if (savedGrade && g === savedGrade) opt.selected = true;
          gradeSelect.appendChild(opt);
        });
      }
    } else if (selectedStage === 'جامعي / كلية' || selectedStage === 'كلية / جامعة') {
      if (gradeGroup) gradeGroup.style.display = 'none';
      if (gradeSelect) gradeSelect.value = '';
      if (universityGroup) universityGroup.style.display = 'block';
      if (uniLabel) uniLabel.textContent = 'اسم الكلية / التخصص والجامعة';
      if (universityInput) {
        universityInput.placeholder = 'أدخل اسم الكلية والتخصص (مثال: كلية التجارة - جامعة بني سويف)...';
        if (savedUni) universityInput.value = savedUni;
      }
    } else if (selectedStage === 'ماجستير / دراسات عليا') {
      if (gradeGroup) gradeGroup.style.display = 'none';
      if (gradeSelect) gradeSelect.value = '';
      if (universityGroup) universityGroup.style.display = 'block';
      if (uniLabel) uniLabel.textContent = 'التخصص / مجال الدراسات العليا والجامعة';
      if (universityInput) {
        universityInput.placeholder = 'أدخل اسم التخصص أو الماجستير والجامعة...';
        if (savedUni) universityInput.value = savedUni;
      }
    } else if (selectedStage === 'أخرى') {
      if (gradeGroup) gradeGroup.style.display = 'none';
      if (gradeSelect) gradeSelect.value = '';
      if (universityGroup) universityGroup.style.display = 'block';
      if (uniLabel) uniLabel.textContent = 'تفاصيل المرحلة التعليمية / التخصص';
      if (universityInput) {
        universityInput.placeholder = 'أدخل تفاصيل المرحلة التعليمية...';
        if (savedUni) universityInput.value = savedUni;
      }
    } else {
      if (gradeGroup) gradeGroup.style.display = 'block';
      if (gradeSelect) gradeSelect.innerHTML = '<option value="" selected disabled>-- اختر المرحلة التعليمية أولاً لتحديد الصف --</option>';
      if (universityGroup) universityGroup.style.display = 'none';
    }
  }

  function resetForm() {
    const nameInput = DOM.qs('#new-member-name');
    const relationInput = DOM.qs('#new-member-relation');
    const idInput = DOM.qs('#new-member-id');
    const ageInput = DOM.qs('#new-member-age');
    const jobInput = DOM.qs('#new-member-job');
    const incomeInput = DOM.qs('#new-member-income');
    const notesInput = DOM.qs('#new-member-notes');

    // الأول: قيم «أخرى» الحرة من الفرد اللي قبله ترجع لأصلها، وخانة الكتابة
    // تتقفل (تغيير القيمة من غير حدث change كان بيسيبها مفتوحة).
    resetOtherOption(relationInput);
    resetOtherOption(stageSelect);
    resetOtherOption(qualificationSelect);

    if (nameInput) nameInput.value = '';
    if (phoneInput) phoneInput.value = '';
    if (idInput) idInput.value = '';
    if (ageInput) ageInput.value = '';
    if (jobInput) jobInput.value = '';
    if (incomeInput) incomeInput.value = '';
    if (notesInput) notesInput.value = '';
    if (diseasesInput) diseasesInput.value = '';
    if (memberGenderSelect) memberGenderSelect.value = '';
    if (memberReligionSelect) memberReligionSelect.value = '';
    if (isStudentCheckbox) isStudentCheckbox.checked = false;
    if (studentFieldsWrapper) studentFieldsWrapper.style.display = 'none';
    if (stageSelect) stageSelect.value = '';
    if (gradeGroup) gradeGroup.style.display = 'none';
    if (gradeSelect) gradeSelect.innerHTML = '<option value="" selected disabled>-- اختر المرحلة التعليمية أولاً لتحديد الصف --</option>';
    if (universityGroup) universityGroup.style.display = 'none';
    if (universityInput) universityInput.value = '';
    if (qualificationGroup) qualificationGroup.style.display = 'block';
    if (qualificationSelect) qualificationSelect.value = '';
    if (takafulCheckbox) takafulCheckbox.checked = false;
    if (takafulAmountGroup) takafulAmountGroup.style.display = 'none';
    if (takafulAmountInput) takafulAmountInput.value = '';
  }

  function fillFormFromCard(card) {
    const d = card.dataset;
    const nameInput = DOM.qs('#new-member-name');
    const relationInput = DOM.qs('#new-member-relation');
    const idInput = DOM.qs('#new-member-id');
    const ageInput = DOM.qs('#new-member-age');
    const jobInput = DOM.qs('#new-member-job');
    const incomeInput = DOM.qs('#new-member-income');
    const notesInput = DOM.qs('#new-member-notes');

    if (nameInput) nameInput.value = d.name || '';
    // قيمة مكتوبة في «أخرى» (أو مش في القايمة) تظهر في خانة الكتابة بدل ما تتمسح.
    setSelectWithOther(relationInput, d.relation || '');
    if (idInput) idInput.value = d.idNum || '';
    if (phoneInput) phoneInput.value = d.phone || '';
    if (ageInput) ageInput.value = d.age || '';
    if (jobInput) jobInput.value = d.job === 'غير محدد' ? '' : (d.job || '');
    if (incomeInput) incomeInput.value = d.income || '';
    if (notesInput) notesInput.value = d.notes || '';
    if (diseasesInput) diseasesInput.value = d.diseases || '';
    if (memberGenderSelect) memberGenderSelect.value = d.gender || '';
    if (memberReligionSelect) memberReligionSelect.value = d.religion || '';

    const isStudent = d.isStudent === 'true';
    if (isStudentCheckbox) isStudentCheckbox.checked = isStudent;
    if (studentFieldsWrapper) studentFieldsWrapper.style.display = isStudent ? 'block' : 'none';
    if (gradeGroup) gradeGroup.style.display = isStudent ? 'block' : 'none';
    if (qualificationGroup) qualificationGroup.style.display = isStudent ? 'none' : 'block';

    if (isStudent) {
      const stage = d.stage || '';
      setSelectWithOther(stageSelect, stage);
      handleStageChange(stage, d.grade || '', d.university || '');
    } else {
      setSelectWithOther(qualificationSelect, d.qualification || '');
    }

    const isTakaful = d.takafulKarama === 'true';
    if (takafulCheckbox) takafulCheckbox.checked = isTakaful;
    if (takafulAmountGroup) takafulAmountGroup.style.display = isTakaful ? 'block' : 'none';
    if (takafulAmountInput) takafulAmountInput.value = isTakaful ? (d.takafulKaramaAmount || '') : '';
  }

  function openModal(card) {
    editingCard = card || null;

    if (formTitle) {
      formTitle.textContent = editingCard ? 'تعديل بيانات الفرد التابع' : 'إضافة فرد تابع جديد لرب الأسرة';
    }
    if (saveBtnLabel) {
      saveBtnLabel.textContent = editingCard ? 'حفظ التعديلات' : 'تأكيد إضافة الفرد التابع';
    }

    resetForm();
    if (editingCard) {
      fillFormFromCard(editingCard);
    }

    if (inlineForm) {
      // نقل الفورم نفسه لمكان الكارت المطلوب تعديله بالظبط — الكارت الصغير
      // بيتخبى مؤقتًا ومكانه يفتح الفورم الكامل (Accordion)، من غير scroll
      // ومن غير ظهور فورم في مكان تاني منفصل. لو "إضافة" (مفيش كارت)، الفورم
      // بيفضل في مكانه الأصلي فوق القائمة.
      if (editingCard && editingCard.parentNode) {
        editingCard.style.display = 'none';
        editingCard.parentNode.insertBefore(inlineForm, editingCard);
      } else if (formPlaceholder.parentNode) {
        formPlaceholder.parentNode.insertBefore(inlineForm, formPlaceholder);
      }

      inlineForm.style.display = 'block';
      inlineForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      const firstInput = DOM.qs('#new-member-name');
      if (firstInput) firstInput.focus();
    }
  }

  function closeModal() {
    if (inlineForm) {
      inlineForm.style.display = 'none';
      // رجّع الفورم لمكانه الأصلي فوق القائمة، ورجّع الكارت الصغير يبان تاني
      // (لو كان مخبّى بسبب التعديل).
      if (formPlaceholder.parentNode) {
        formPlaceholder.parentNode.insertBefore(inlineForm, formPlaceholder);
      }
      if (editingCard) {
        editingCard.style.display = '';
      }
    }
    editingCard = null;
  }

  if (btnOpenModal) {
    btnOpenModal.addEventListener('click', () => openModal(null));
  }

  if (membersList) {
    membersList.addEventListener('click', (e) => {
      if (e.target.closest('.btn-delete-member')) return;
      const card = e.target.closest('.member-card');
      if (card) openModal(card);
    });
  }

  if (btnCloseModal) btnCloseModal.addEventListener('click', closeModal);
  if (btnCancelModal) btnCancelModal.addEventListener('click', closeModal);

  if (isStudentCheckbox) {
    isStudentCheckbox.addEventListener('change', () => {
      const isChecked = isStudentCheckbox.checked;
      if (studentStageGroup) studentStageGroup.style.display = isChecked ? 'block' : 'none';
      if (gradeGroup) gradeGroup.style.display = isChecked ? 'block' : 'none';

      if (qualificationGroup) qualificationGroup.style.display = isChecked ? 'none' : 'block';

      if (isChecked) {
        if (qualificationSelect) qualificationSelect.value = '';
        handleStageChange(stageSelect ? stageSelect.value : '');
      } else {
        if (stageSelect) stageSelect.value = '';
        if (gradeGroup) gradeGroup.style.display = 'none';
        if (universityGroup) universityGroup.style.display = 'none';
        if (universityInput) universityInput.value = '';
      }
    });
  }

  if (stageSelect) {
    stageSelect.addEventListener('change', () => {
      handleStageChange(stageSelect.value);
    });
  }

  if (takafulCheckbox) {
    takafulCheckbox.addEventListener('change', () => {
      const isChecked = takafulCheckbox.checked;
      if (takafulAmountGroup) takafulAmountGroup.style.display = isChecked ? 'block' : 'none';
      if (!isChecked && takafulAmountInput) takafulAmountInput.value = '';
    });
  }

  function computeEduDisplay(isStudent, stage, grade, university, qualification) {
    const studentFlag = isStudent === true || isStudent === 'true';
    if (studentFlag) {
      if (stage === 'جامعي / كلية' || stage === 'كلية / جامعة') {
        return university ? `🎓 طالب جامعي (${university})` : '🎓 طالب جامعي / كلية';
      } else if (stage === 'ماجستير / دراسات عليا') {
        return university ? `🎓 ماجستير / دراسات عليا (${university})` : '🎓 ماجستير / دراسات عليا';
      } else if (stage) {
        return grade ? `🎓 طالب بمرحلة ${stage} (${grade})` : `🎓 طالب بمرحلة ${stage}`;
      } else {
        return '🎓 طالب ملتحق بالتعليم';
      }
    }
    return qualification ? `غير طالب — ${qualification}` : 'غير طالب';
  }

  function applyMemberDataToCard(card, data) {
    const { name, relation, idNum, age, gender, religion, phone, job, income, notes, diseases, isStudent, stage, grade, university, qualification, takafulKarama, takafulKaramaAmount, eduDisplay } = data;
    // id ثابت لكل فرد بيتبعت للباك (client-generated UUID) عشان الدعم يتربط بيه.
    card.dataset.memberId = data.memberId || card.dataset.memberId || crypto.randomUUID();
    const finalEduDisplay = eduDisplay || computeEduDisplay(isStudent, stage, grade, university, qualification);

    // الحقول اللي كان فيها قيمة في أي وقت (من السيرفر أو اتكتبت هنا): لو
    // اتفضّت بعدين بتتبعت "" (امسح)، والفاضية من الأول بتتبعت null (سيب).
    const filled = memberFilledKeys({ filled: data.filled ?? card.dataset.filled });
    Object.entries(memberClearableValues(data)).forEach(([key, value]) => {
      if (value) filled.add(key);
    });
    card.dataset.filled = [...filled].join(',');

    card.dataset.name = name;
    card.dataset.relation = relation;
    card.dataset.idNum = idNum || '';
    card.dataset.age = age || '';
    card.dataset.gender = gender || '';
    card.dataset.religion = religion || '';
    card.dataset.phone = phone || '';
    card.dataset.job = job || 'غير محدد';
    card.dataset.income = income || '';
    card.dataset.notes = notes || '';
    card.dataset.diseases = diseases || '';
    card.dataset.isStudent = String(isStudent);
    card.dataset.stage = stage || '';
    card.dataset.grade = grade || '';
    card.dataset.university = university || '';
    card.dataset.qualification = qualification || '';
    card.dataset.takafulKarama = String(takafulKarama);
    card.dataset.takafulKaramaAmount = takafulKaramaAmount || '';
    card.dataset.eduDisplay = finalEduDisplay;

    const nameParts = name.split(' ');
    const initials = nameParts.length >= 2
      ? nameParts[0].charAt(0) + nameParts[1].charAt(0)
      : name.charAt(0);

    card.innerHTML = `
      <div class="member-card__info" style="display: flex; align-items: flex-start; gap: 14px; width: 100%;">
        <div class="member-card__avatar" style="background: rgba(37, 99, 235, 0.15); color: #2563eb; width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 16px; flex-shrink: 0;">${DOM.escapeHTML(initials)}</div>
        <div style="flex: 1;">
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            <h4 class="member-card__name" style="font-size: 15px; font-weight: 800; color: #000; margin: 0;">${DOM.escapeHTML(name)}</h4>
            <span class="badge badge--primary" style="font-size: 11px;">${DOM.escapeHTML(relation)}</span>
            ${age ? `<span class="badge badge--secondary" style="font-size: 11px;">السن: ${DOM.escapeHTML(age)} سنة</span>` : ''}
            ${gender ? `<span class="badge badge--secondary" style="font-size: 11px;">${DOM.escapeHTML(gender)}</span>` : ''}
            ${religion ? `<span class="badge badge--secondary" style="font-size: 11px;">${DOM.escapeHTML(religion)}</span>` : ''}
          </div>

          <div style="margin-top: 6px; display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: var(--text-secondary);">
            ${idNum ? `<div>🪪 <strong>الرقم القومي:</strong> <span style="font-family: monospace; font-weight: 700;">${DOM.escapeHTML(idNum)}</span></div>` : ''}
            ${phone ? `<div>📞 <strong>الهاتف:</strong> <span style="font-family: monospace; font-weight: 700;" dir="ltr">${DOM.escapeHTML(phone)}</span></div>` : ''}
            <div>🏫 <strong>التعليم:</strong> ${DOM.escapeHTML(finalEduDisplay)}</div>
            <div>💼 <strong>الوظيفة / العمل:</strong> ${DOM.escapeHTML(job || 'غير محدد')} ${income ? ` • 💵 <strong>الدخل:</strong> <span style="color: #059669; font-weight: 800;">${DOM.escapeHTML(income)} جنيه/شهرياً</span>` : ''}</div>
            ${takafulKarama === true || takafulKarama === 'true' ? `<div>🤝 <strong>تكافل وكرامة:</strong> <span style="color: #7c3aed; font-weight: 800;">مستفيد${takafulKaramaAmount ? ` — ${DOM.escapeHTML(takafulKaramaAmount)} جنيه` : ''}</span></div>` : ''}
            ${diseases ? `<div>🩺 <strong>الأمراض:</strong> ${DOM.escapeHTML(diseases)}</div>` : ''}
            ${notes ? `<div style="color: #2563eb; font-weight: 700; margin-top: 2px;">📝 <strong>ملاحظات:</strong> ${DOM.escapeHTML(notes)}</div>` : ''}
          </div>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 2px; flex-shrink: 0;">
        <button class="btn btn--ghost btn--sm btn-edit-member" title="تعديل بيانات الفرد" aria-label="تعديل بيانات الفرد" type="button" style="padding: 6px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
        </button>
        <button class="btn btn--ghost btn--sm btn-delete-member" title="حذف الفرد" aria-label="حذف الفرد" type="button" style="padding: 6px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `;
  }

  if (btnSaveMember && membersList) {
    btnSaveMember.addEventListener('click', () => {
      const nameInput = DOM.qs('#new-member-name');
      const relationInput = DOM.qs('#new-member-relation');
      const idInput = DOM.qs('#new-member-id');
      const ageInput = DOM.qs('#new-member-age');
      const jobInput = DOM.qs('#new-member-job');
      const incomeInput = DOM.qs('#new-member-income');
      const notesInput = DOM.qs('#new-member-notes');

      const name = nameInput ? nameInput.value.trim() : '';
      const relation = relationInput ? relationInput.value : 'فرد أسرة';
      const idNum = idInput ? idInput.value.trim() : '';
      const age = ageInput ? ageInput.value.trim() : '';
      const gender = memberGenderSelect ? memberGenderSelect.value : '';
      const religion = memberReligionSelect ? memberReligionSelect.value : '';
      const phone = phoneInput ? phoneInput.value.trim() : '';
      const job = jobInput ? jobInput.value.trim() : 'غير محدد';
      const income = incomeInput ? incomeInput.value.trim() : '';
      const notes = notesInput ? notesInput.value.trim() : '';
      const diseases = diseasesInput ? diseasesInput.value.trim() : '';

      const isStudent = isStudentCheckbox ? isStudentCheckbox.checked : false;
      const stage = isStudent && stageSelect ? stageSelect.value : '';
      const grade = isStudent && gradeSelect ? gradeSelect.value : '';
      const university = isStudent && universityInput ? universityInput.value.trim() : '';
      const qualification = !isStudent && qualificationSelect ? qualificationSelect.value : '';
      let eduDisplay = computeEduDisplay(isStudent, stage, grade, university, qualification);

      const takafulKarama = takafulCheckbox ? takafulCheckbox.checked : false;
      const takafulKaramaAmount = takafulKarama && takafulAmountInput ? takafulAmountInput.value.trim() : '';

      if (!name) {
        showToast('يرجى إدخال اسم الفرد الرباعي');
        if (nameInput) nameInput.focus();
        return;
      }

      if (!relation) {
        showToast('يرجى اختيار صلة القرابة برب الأسرة');
        if (relationInput) relationInput.focus();
        return;
      }

      // «أخرى» من غير ما تتكتب الصلة الفعلية.
      if (relation === 'أخرى') {
        showToast('اكتب صلة القرابة في خانة «أخرى»');
        const otherInput = relationInput?.closest('.form-select-wrapper')?.querySelector('.in-field-other-input');
        if (otherInput) otherInput.focus();
        return;
      }

      // النوع إلزامي على السيرفر، والسن من 0 لـ 120 (غير كده 422).
      if (!gender) {
        showToast('يرجى اختيار نوع الفرد');
        if (memberGenderSelect) memberGenderSelect.focus();
        return;
      }

      if (age && Number(age) > 120) {
        showToast('السن لازم يكون من 0 لـ 120');
        if (ageInput) ageInput.focus();
        return;
      }

      if (idNum && idNum.length !== 14) {
        showToast('الرقم القومي يتكون من 14 رقم بالكامل');
        if (idInput) idInput.focus();
        return;
      }

      if (!isValidEgyptianPhone(phone)) {
        showToast(PHONE_ERROR_MESSAGE);
        if (phoneInput) phoneInput.focus();
        return;
      }

      const memberData = { name, relation, idNum, age, gender, religion, phone, job, income, notes, diseases, isStudent, stage, grade, university, qualification, takafulKarama, takafulKaramaAmount, eduDisplay };

      if (editingCard) {
        applyMemberDataToCard(editingCard, memberData);
        bindDeleteButton(editingCard);
        closeModal();
        sortCardsByAge();
        saveMembersToStore();
        showToast(`تم تحديث بيانات الفرد "${name}" بنجاح ✏️`);
      } else {
        const memberCardHtml = document.createElement('div');
        memberCardHtml.className = 'member-card';
        memberCardHtml.style.animation = 'fadeInView 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
        applyMemberDataToCard(memberCardHtml, memberData);
        bindDeleteButton(memberCardHtml);
        membersList.appendChild(memberCardHtml);
        closeModal();
        sortCardsByAge();
        saveMembersToStore();
        showToast(`تمت إضافة الفرد التابع "${name}" بنجاح 👤`);
      }

      updateMembersCount();
    });
  }

  /**
   * يرتّب الكروت بالسن: الأكبر فوق والأصغر تحت، واللي سنه مش معروف في الآخر
   * (نفس السن يفضل بترتيب الإضافة). ترتيب الكروت هو ترتيب القايمة المبعوتة.
   */
  function sortCardsByAge() {
    if (!membersList) return;
    const ageOf = card => {
      const n = parseInt(card.dataset.age, 10);
      return Number.isFinite(n) ? n : null;
    };
    [...membersList.querySelectorAll('.member-card')]
      .map((card, index) => ({ card, index, age: ageOf(card) }))
      .sort((a, b) => {
        if (a.age !== b.age) {
          if (a.age === null) return 1;
          if (b.age === null) return -1;
          return b.age - a.age;
        }
        return a.index - b.index;
      })
      .forEach(({ card }) => membersList.appendChild(card));
  }

  function saveMembersToStore() {
    if (!membersList) return;
    const cards = membersList.querySelectorAll('.member-card');
    const membersData = [];
    cards.forEach(card => {
      membersData.push(Object.assign({}, card.dataset));
    });
    store.setFamilyMembers(membersData);
  }

  function loadMembersFromStore() {
    if (!membersList) return;
    DOM.qsa('.member-card', membersList).forEach(c => c.remove());
    const list = store.familyMembers;
    if (Array.isArray(list)) {
      list.forEach(m => {
        const card = document.createElement('div');
        card.className = 'member-card';
        applyMemberDataToCard(card, m);
        bindDeleteButton(card);
        membersList.appendChild(card);
      });
    }
    sortCardsByAge();
    saveMembersToStore();
  }

  function bindDeleteButton(card) {
    const delBtn = card.querySelector('.btn-delete-member');
    if (!delBtn) return;
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = card.dataset.name || card.querySelector('.member-card__name')?.textContent || 'الفرد';
      const confirmed = await confirmDialog({
        title: 'حذف فرد من الأسرة',
        message: `"${name}" هيتشال من أفراد الأسرة. متأكد؟`,
        confirmLabel: 'حذف',
        danger: true
      });
      if (!confirmed || !card.isConnected) return;
      card.remove();
      saveMembersToStore();
      updateMembersCount();
      showToast(`تم حذف الفرد "${name}" من قائمة التابعين`);
    });
  }

  loadMembersFromStore();
  updateMembersCount();

  _resetCallback = () => {
    if (membersList) {
      DOM.qsa('.member-card', membersList).forEach(c => c.remove());
    }
    store.setFamilyMembers([]);
    updateMembersCount();
  };

  _loadCallback = (members) => {
    store.setFamilyMembers(members);
    loadMembersFromStore();
    updateMembersCount();
  };
}
