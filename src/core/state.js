/* --------------------------------------------------------------------------
   WORKFLOW PERCENTAGE RECALCULATION SIGNAL (EVENT BUS INTEGRATED)
   Provides backward compatibility while delegating to central EventBus.
   -------------------------------------------------------------------------- */
import { EventBus, EVENTS } from './event-bus.js';

export function onWorkflowRecalc(fn) {
  return EventBus.on(EVENTS.WORKFLOW_RECALC_TRIGGERED, fn);
}

export function triggerWorkflowRecalc() {
  EventBus.emit(EVENTS.WORKFLOW_RECALC_TRIGGERED);
}
