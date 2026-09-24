/* --------------------------------------------------------------------------
   LIFECYCLE MANAGER
   Registers and manages cleanup functions to prevent event listener & observer leaks.
   -------------------------------------------------------------------------- */

const cleanups = new Set();

export const Lifecycle = {
  /**
   * Register a cleanup callback
   * @param {Function} fn
   */
  addCleanup(fn) {
    if (typeof fn === 'function') {
      cleanups.add(fn);
    }
  },

  /**
   * Run all registered cleanup handlers
   */
  destroy() {
    cleanups.forEach(fn => {
      try {
        fn();
      } catch (err) {
        console.error('[Lifecycle] Cleanup error:', err);
      }
    });
    cleanups.clear();
  }
};
