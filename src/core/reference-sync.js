/* --------------------------------------------------------------------------
   REFERENCE DATA SYNC (bootstrap)
   Runs once at boot, before the screens initialise:
   1. Hydrates store.beniSuefLocations / store.locationIds from the cached
      GET /locations (services/reference-data.js), synchronously — so every
      screen that needs centers/villages finds them already there and skips
      its own fetch.
   2. Starts one background GET /reference-data/versions check.
   3. When that check reports changed lists, re-reads the ones held in shared
      state here (locations -> store) and signals CHARITIES_UPDATED for the
      charity pickers. Dropdown <select>s refresh themselves
      (personal-data/dropdown-data.component.js).
   -------------------------------------------------------------------------- */
import { store } from '../state/store.js';
import { EventBus, EVENTS } from './event-bus.js';
import { ReferenceData } from '../services/reference-data.js';
import { LocationsService } from '../services/locations.service.js';

export function initReferenceDataSync() {
  const cachedLocations = LocationsService.peekCached();
  if (cachedLocations) {
    store.applyLocationsFromServer(cachedLocations);
  }

  EventBus.on(EVENTS.REFERENCE_DATA_CHANGED, ({ keys = [] } = {}) => {
    if (keys.includes('locations')) {
      LocationsService.list()
        .then(centers => store.applyLocationsFromServer(centers))
        .catch(err => console.warn('[reference-sync] locations refresh failed:', err));
    }
    if (keys.includes('charities')) {
      EventBus.emit(EVENTS.CHARITIES_UPDATED);
    }
  });

  ReferenceData.revalidate();
}
