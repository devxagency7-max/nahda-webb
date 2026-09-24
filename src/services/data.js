/* --------------------------------------------------------------------------
   DATA SERVICE LAYER
   Data provider for Beni Suef centers, villages, and static dropdown items.
   -------------------------------------------------------------------------- */
import { store } from '../state/store.js';

export const DataService = {
  getBeniSuefLocations() {
    return store.beniSuefLocations;
  },

  getCenters() {
    const locs = this.getBeniSuefLocations();
    return Object.keys(locs);
  },

  getVillagesByCenter(center) {
    const locs = this.getBeniSuefLocations();
    return locs[center] || [];
  },

  getAllVillages() {
    const locs = this.getBeniSuefLocations();
    const villages = [];
    Object.values(locs).forEach(list => villages.push(...list));
    return villages.sort();
  }
};
