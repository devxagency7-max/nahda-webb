/* --------------------------------------------------------------------------
   STATE SELECTORS (DERIVED STATE COMPUTATIONS)
   -------------------------------------------------------------------------- */
import { store } from './store.js';

export const Selectors = {
  /**
   * Calculate budget totals
   */
  getBudgetTotals() {
    const totalIncome = store.incomeItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    const totalExpenses = store.expenseItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    const netIncome = totalIncome - totalExpenses;

    return {
      totalIncome,
      totalExpenses,
      netIncome
    };
  },

  /**
   * Get family member count badge text
   */
  getFamilyMembersCount() {
    return store.familyMembers.length;
  }
};
