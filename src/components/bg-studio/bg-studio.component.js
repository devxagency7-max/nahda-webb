/* --------------------------------------------------------------------------
   IN-PAGE BACKGROUND CUSTOMIZER STUDIO COMPONENT (#bg-customizer-card)
   Handles live visual effects, CSS filters, overlay opacity, and custom background presets.
   -------------------------------------------------------------------------- */
import { showToast } from '../../utils/toast.js';
import { store } from '../../state/store.js';
import { DOM } from '../../utils/dom.js';

export function initInPageBackgroundStudio() {
  const bgLayer = DOM.qs('#bg-layer');
  const fileInput = DOM.qs('#inpage-bg-file');

  const sliderBlur = DOM.qs('#inpage-slider-blur');
  const sliderBrightness = DOM.qs('#inpage-slider-brightness');
  const sliderContrast = DOM.qs('#inpage-slider-contrast');
  const sliderSaturate = DOM.qs('#inpage-slider-saturate');
  const sliderOverlay = DOM.qs('#inpage-slider-overlay');

  const valBlur = DOM.qs('#inpage-val-blur');
  const valBrightness = DOM.qs('#inpage-val-brightness');
  const valContrast = DOM.qs('#inpage-val-contrast');
  const valSaturate = DOM.qs('#inpage-val-saturate');
  const valOverlay = DOM.qs('#inpage-val-overlay');

  const resetBtn = DOM.qs('#inpage-reset-bg-settings');

  const colorSwatches = DOM.qsa('.color-swatch:not(.color-swatch--custom)');
  const customColorInput = DOM.qs('#inpage-bg-custom-color');
  const customColorPreview = DOM.qs('#custom-color-preview');

  function applySettings() {
    if (!bgLayer) return;

    const currentSettings = store.bgSettings;

    // Apply Background Type & Value
    if (currentSettings.type === 'image') {
      bgLayer.style.background = '';
      bgLayer.style.backgroundImage = `url(${currentSettings.val})`;
      bgLayer.style.backgroundColor = 'transparent';
    } else if (currentSettings.type === 'color') {
      bgLayer.style.backgroundImage = 'none';
      bgLayer.style.backgroundColor = currentSettings.val;
    } else if (currentSettings.type === 'gradient') {
      bgLayer.style.backgroundColor = 'transparent';
      bgLayer.style.backgroundImage = currentSettings.val;
    }

    // Apply CSS Filters & Overlay
    bgLayer.style.filter = `blur(${currentSettings.blur}px) brightness(${currentSettings.brightness}%) contrast(${currentSettings.contrast}%) saturate(${currentSettings.saturate}%)`;
    document.documentElement.style.setProperty('--bg-overlay', `rgba(248, 250, 252, ${currentSettings.overlay / 100})`);

    // Update Slider Inputs & Display Labels
    if (sliderBlur) sliderBlur.value = currentSettings.blur;
    if (sliderBrightness) sliderBrightness.value = currentSettings.brightness;
    if (sliderContrast) sliderContrast.value = currentSettings.contrast;
    if (sliderSaturate) sliderSaturate.value = currentSettings.saturate;
    if (sliderOverlay) sliderOverlay.value = currentSettings.overlay;

    if (valBlur) valBlur.textContent = `${currentSettings.blur}px`;
    if (valBrightness) valBrightness.textContent = `${currentSettings.brightness}%`;
    if (valContrast) valContrast.textContent = `${currentSettings.contrast}%`;
    if (valSaturate) valSaturate.textContent = `${currentSettings.saturate}%`;
    if (valOverlay) valOverlay.textContent = `${currentSettings.overlay}%`;
  }

  function updateFiltersFromSliders() {
    const updated = {
      blur: sliderBlur ? parseInt(sliderBlur.value, 10) : 20,
      brightness: sliderBrightness ? parseInt(sliderBrightness.value, 10) : 89,
      contrast: sliderContrast ? parseInt(sliderContrast.value, 10) : 98,
      saturate: sliderSaturate ? parseInt(sliderSaturate.value, 10) : 140,
      overlay: sliderOverlay ? parseInt(sliderOverlay.value, 10) : 22
    };

    store.updateBgSettings(updated);
    applySettings();
  }

  [sliderBlur, sliderBrightness, sliderContrast, sliderSaturate, sliderOverlay].forEach(slider => {
    if (slider) {
      slider.addEventListener('input', updateFiltersFromSliders);
      slider.addEventListener('change', updateFiltersFromSliders);
    }
  });

  colorSwatches.forEach(swatch => {
    swatch.addEventListener('click', () => {
      DOM.qsa('.color-swatch').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');

      const bgType = swatch.getAttribute('data-bg-type') || 'color';
      const bgVal = swatch.getAttribute('data-bg-val') || '#ffffff';

      store.updateBgSettings({ type: bgType, val: bgVal });
      applySettings();

      const name = swatch.querySelector('.color-swatch__name')?.textContent || 'الخلفية';
      showToast(`تم حفظ وتطبيق خلفية "${name}" 🎨`);
    });
  });

  if (customColorInput) {
    customColorInput.addEventListener('input', (e) => {
      const colorVal = e.target.value;
      DOM.qsa('.color-swatch').forEach(s => s.classList.remove('active'));
      const parentLabel = customColorInput.closest('.color-swatch');
      if (parentLabel) parentLabel.classList.add('active');
      if (customColorPreview) customColorPreview.style.background = colorVal;

      store.updateBgSettings({ type: 'color', val: colorVal });
      applySettings();
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = function(event) {
          DOM.qsa('.color-swatch').forEach(s => s.classList.remove('active'));
          store.updateBgSettings({ type: 'image', val: event.target.result });
          applySettings();
          showToast('تم حفظ وتطبيق صورة الخلفية بنجاح 🖼️');
        };
        reader.readAsDataURL(file);
      }
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      store.resetBgSettings();

      DOM.qsa('.color-swatch').forEach(s => s.classList.remove('active'));
      const defaultImgSwatch = DOM.qs('.color-swatch[data-bg-type="image"]');
      if (defaultImgSwatch) defaultImgSwatch.classList.add('active');

      applySettings();
      showToast('تم إعادة ضبط إعدادات الخلفية للمصنع 🔄');
    });
  }

  applySettings();
}
