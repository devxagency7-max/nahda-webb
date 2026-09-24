/* --------------------------------------------------------------------------
   DOM UTILITIES & PERFORMANCE HELPERS
   Prevents layout thrashing, provides cached lookups, safe fragment creation,
   and clean event delegation.
   -------------------------------------------------------------------------- */

const selectorCache = new Map();

export const DOM = {
  /**
   * Cached querySelector to avoid repeated DOM tree traversals
   * @param {string} selector
   * @param {HTMLElement|Document} scope
   */
  qs(selector, scope = document) {
    if (scope === document) {
      if (!selectorCache.has(selector)) {
        selectorCache.set(selector, document.querySelector(selector));
      }
      return selectorCache.get(selector);
    }
    return scope.querySelector(selector);
  },

  /**
   * Query all matching elements
   * @param {string} selector
   * @param {HTMLElement|Document} scope
   */
  qsa(selector, scope = document) {
    return Array.from(scope.querySelectorAll(selector));
  },

  /**
   * Create an element with optional attributes and children
   * @param {string} tag
   * @param {Object} attrs
   * @param {Array|string} children
   */
  createElement(tag, attrs = {}, children = null) {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (key === 'className') {
        el.className = value;
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(el.style, value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.substring(2).toLowerCase(), value);
      } else if (key === 'dataset' && typeof value === 'object') {
        Object.assign(el.dataset, value);
      } else {
        el.setAttribute(key, value);
      }
    });

    if (children) {
      if (Array.isArray(children)) {
        children.forEach(child => {
          if (typeof child === 'string') {
            el.appendChild(document.createTextNode(child));
          } else if (child instanceof Node) {
            el.appendChild(child);
          }
        });
      } else if (typeof children === 'string') {
        el.textContent = children;
      } else if (children instanceof Node) {
        el.appendChild(children);
      }
    }

    return el;
  },

  /**
   * Escape raw strings to prevent HTML injection
   * @param {string} str
   */
  escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  /**
   * Efficiently clear children of an element without innerHTML = ''
   * @param {HTMLElement} element
   */
  clear(element) {
    if (!element) return;
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }
};
