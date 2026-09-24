/* --------------------------------------------------------------------------
   IN-FIELD "أخرى" EDITABLE DROPDOWN COMPONENT
   Transforms dropdowns into direct in-field text inputs when "أخرى" is selected,
   eliminating extra separate fields below the dropdown.
   Respects fields flagged with data-no-other="true" (e.g. النوع، الديانة).
   -------------------------------------------------------------------------- */
import { DOM } from '../../utils/dom.js';

export function initOtherOptionDropdowns() {
  const selects = DOM.qsa('select:not([data-no-other="true"])');

  selects.forEach(select => {
    // Skip fixed binary or system selects explicitly marked as no-other
    if (select.dataset.noOther === 'true' || select.id === 'gender' || select.id === 'religion') {
      return;
    }

    const wrapper = select.closest('.form-select-wrapper');
    if (!wrapper) return;

    // Ensure select contains an "أخرى" option if allowed
    let otherOpt = Array.from(select.options).find(opt => opt.dataset.isOther === 'true' || opt.value === 'أخرى');
    if (!otherOpt && !select.querySelector('optgroup')) {
      otherOpt = document.createElement('option');
      otherOpt.value = 'أخرى';
      otherOpt.textContent = 'أخرى (كتابة مخصصة...)';
      otherOpt.dataset.isOther = 'true';
      select.appendChild(otherOpt);
    }

    // Check if in-field input already exists
    let inlineInput = wrapper.querySelector('.in-field-other-input');
    let resetBtn = wrapper.querySelector('.in-field-other-reset');

    if (!inlineInput) {
      inlineInput = document.createElement('input');
      inlineInput.type = 'text';
      inlineInput.className = 'form-input in-field-other-input';
      inlineInput.placeholder = 'اكتب الاختيار المخصص مباشرة هنا...';
      inlineInput.style.display = 'none';
      inlineInput.style.paddingLeft = '40px';

      resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'btn-in-field-reset';
      resetBtn.title = 'الرجوع للقائمة المنسدلة';
      resetBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="23 4 23 10 17 10"></polyline>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
        </svg>
      `;
      resetBtn.style.display = 'none';

      wrapper.appendChild(inlineInput);
      wrapper.appendChild(resetBtn);
    }

    const arrowSvg = wrapper.querySelector('.select-arrow');

    function syncState() {
      const selectedOpt = select.selectedOptions[0];
      const isOther = selectedOpt ? (selectedOpt.dataset.isOther === 'true' || selectedOpt.value === 'أخرى') : false;

      if (isOther) {
        select.style.display = 'none';
        if (arrowSvg) arrowSvg.style.display = 'none';
        inlineInput.style.display = 'block';
        resetBtn.style.display = 'flex';
        inlineInput.value = otherOpt.value !== 'أخرى' ? otherOpt.value : '';
        inlineInput.focus();
      } else {
        select.style.display = 'block';
        if (arrowSvg) arrowSvg.style.display = 'block';
        inlineInput.style.display = 'none';
        resetBtn.style.display = 'none';
      }
    }

    select.addEventListener('change', () => {
      syncState();
    });

    inlineInput.addEventListener('input', () => {
      const typedVal = inlineInput.value.trim();
      if (otherOpt) {
        otherOpt.value = typedVal || 'أخرى';
        otherOpt.textContent = typedVal ? `أخرى: ${typedVal}` : 'أخرى (كتابة مخصصة...)';
        select.value = otherOpt.value;
      }
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    resetBtn.addEventListener('click', () => {
      if (otherOpt) {
        otherOpt.value = 'أخرى';
        otherOpt.textContent = 'أخرى (كتابة مخصصة...)';
      }
      select.selectedIndex = 0;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      syncState();
    });

    // Initial check
    syncState();
  });
}
