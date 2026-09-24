/* --------------------------------------------------------------------------
   FILE UPLOAD & FORM INTERACTIVITY COMPONENT
   Handles dropzone drag & drop events, file selection feedback, and form save button.
   -------------------------------------------------------------------------- */
import { showToast } from '../../utils/toast.js';
import { DOM } from '../../utils/dom.js';

export function initFileUpload() {
  const uploadArea = DOM.qs('.form-upload');
  const fileInput = DOM.qs('#file-input');

  if (!uploadArea) return;

  ['dragenter', 'dragover'].forEach(eventName => {
    uploadArea.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      uploadArea.classList.add('form-upload--dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    uploadArea.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      uploadArea.classList.remove('form-upload--dragover');
    }, false);
  });

  uploadArea.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      handleFileSelected(files[0].name);
    }
  });

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) {
        handleFileSelected(fileInput.files[0].name);
      }
    });
  }
}

function handleFileSelected(fileName) {
  const title = DOM.qs('.form-upload__title');
  if (title) {
    title.textContent = `الملف المحدد: ${fileName}`;
  }
  showToast(`تم إرفاق الملف: ${fileName}`);
}

export function initFormInteractivity() {
  const saveBtn = DOM.qs('.btn--primary');
  if (saveBtn) {
    saveBtn.addEventListener('click', (e) => {
      e.preventDefault();
      showToast('تم حفظ التغييرات بنجاح');
    });
  }
}
