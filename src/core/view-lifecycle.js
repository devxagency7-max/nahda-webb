/* --------------------------------------------------------------------------
   VIEW ENTER HOOK
   All views are mounted and initialised at boot, but a screen's data should
   only be fetched when the user actually opens it — not for every screen at
   once on page load.

   onViewEnter(view, loader) runs `loader` each time `view` becomes the
   current view. It also covers the one case a plain VIEW_CHANGED listener
   misses: on a reload the router restores the saved view BEFORE components
   initialise, so that first VIEW_CHANGED has already fired — if `view` is
   the current view at registration time, `loader` runs right away.

   Never runs without a session (nothing to fetch on the login screen).
   -------------------------------------------------------------------------- */
import { store } from '../state/store.js';
import { TokenStore } from '../services/tokens.js';
import { EventBus, EVENTS } from './event-bus.js';

/**
 * @param {string} viewName
 * @param {(ctx: {firstEnter: boolean}) => void} loader
 * @param {{once?: boolean}} [opts] - once: run only on the first entry
 * @returns {Function} unsubscribe
 */
export function onViewEnter(viewName, loader, { once = false } = {}) {
  let entered = false;

  const run = () => {
    if (!TokenStore.hasSession()) return;
    if (once && entered) return;
    const firstEnter = !entered;
    entered = true;
    try {
      const result = loader({ firstEnter });
      if (result && typeof result.catch === 'function') {
        result.catch(err => console.error(`[view:${viewName}] load failed:`, err));
      }
    } catch (err) {
      console.error(`[view:${viewName}] load failed:`, err);
    }
  };

  const unsubscribe = EventBus.on(EVENTS.VIEW_CHANGED, (view) => {
    if (view === viewName) run();
  });

  if (store.currentView === viewName) run();

  return unsubscribe;
}
