/* --------------------------------------------------------------------------
   CENTRAL EVENT BUS (PUB/SUB ENGINE)
   Allows application modules and components to communicate asynchronously
   without direct coupling.
   -------------------------------------------------------------------------- */

class EventBusEngine {
  constructor() {
    this.listeners = new Map();
  }

  /**
   * Subscribe to an event
   * @param {string} event
   * @param {Function} callback
   * @returns {Function} Unsubscribe handle
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);

    return () => this.off(event, callback);
  }

  /**
   * Unsubscribe from an event
   * @param {string} event
   * @param {Function} callback
   */
  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  /**
   * Emit an event with data
   * @param {string} event
   * @param {*} data
   */
  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`[EventBus] Error in listener for event "${event}":`, error);
        }
      });
    }
  }
}

export const EventBus = new EventBusEngine();

export const EVENTS = {
  VIEW_CHANGE_REQUESTED: 'router:view-change-requested',
  VIEW_CHANGED: 'router:view-changed',
  WORKFLOW_STEP_CHANGED: 'workflow:step-changed',
  WORKFLOW_RECALC_TRIGGERED: 'workflow:recalc-triggered',
  BG_SETTINGS_CHANGED: 'bg:settings-changed',
  FAMILY_MEMBERS_UPDATED: 'family:members-updated',
  FINANCIAL_DATA_UPDATED: 'financial:data-updated',
  ASSESSED_NEEDS_UPDATED: 'needs:data-updated',
  USER_CHANGED: 'user:changed',
  CHARITIES_UPDATED: 'charities:updated',
  LOCATIONS_UPDATED: 'locations:updated',
  EMPLOYEES_UPDATED: 'employees:updated',
  AGRICULTURE_UPDATED: 'agriculture:updated',
  CASE_UPDATED: 'case:updated',
  // Emitted by state-data-management.component.js after a dropdown-config
  // option is added/edited/deactivated, so any open form <select> for that
  // same key (personal-data wizard) can refresh live instead of waiting for
  // a full page reload. Payload: { key: string }.
  DROPDOWN_OPTIONS_UPDATED: 'dropdowns:options-updated',
  SESSION_EXPIRED: 'auth:session-expired'
};
