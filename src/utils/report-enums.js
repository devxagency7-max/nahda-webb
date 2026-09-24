/* --------------------------------------------------------------------------
   REPORT BUILDER ENUM MAPS
   The reporting backend has no JsonStringEnumConverter -- every enum field
   in a report-builder request body (and in response bodies that carry one,
   e.g. CasesAgingRow.bucket) travels on the wire as an integer, not a
   string. Query-string params (e.g. /comparisons?metric=Count) are the one
   exception and stay string-based.

   Keep string keys in the UI (dropdown values, component state) and
   translate through these maps only when building a request body or
   reading a response field that is a number on the wire.
   -------------------------------------------------------------------------- */

export const ReportDataset = {
  Cases: 0,
  Beneficiaries: 1,
  FamilyMembers: 2,
  ApprovedSupport: 3,
  FieldVisits: 4
};

export const ReportDimension = {
  Status: 0,
  Priority: 1,
  Center: 2,
  Village: 3,
  Charity: 4,
  Gender: 5,
  AgeBracket: 6,
  SupportType: 7,
  VisitOutcome: 8,
  RegistrationMonth: 9,
  None: 10
};

export const ReportMetric = {
  Count: 0,
  TotalAmount: 1,
  AverageAmount: 2,
  AverageAge: 3,
  AverageMonthlyIncome: 4
};

export const ReportAggregation = {
  Sum: 0,
  Average: 1,
  Count: 2,
  Min: 3,
  Max: 4
};

export const ReportFilterOperator = {
  Equals: 0,
  NotEquals: 1,
  GreaterThan: 2,
  GreaterThanOrEqual: 3,
  LessThan: 4,
  LessThanOrEqual: 5,
  Between: 6,
  Contains: 7
};

export const ReportSortDirection = {
  Ascending: 0,
  Descending: 1
};

// Only these three operators are honored for any dimension except RegistrationMonth
// (fallback used only if /datasets/{dataset} did not provide dimensionOperators).
export const DEFAULT_ALLOWED_OPERATORS = ['Equals', 'NotEquals', 'Contains'];
export const REGISTRATION_MONTH_ALLOWED_OPERATORS = [
  'Equals', 'NotEquals', 'Contains', 'GreaterThan', 'GreaterThanOrEqual', 'LessThan', 'LessThanOrEqual', 'Between'
];

export const AGING_BUCKET_LABELS = ['0-7 يوم', '8-30 يوم', '31-90 يوم', '91-180 يوم', '+180 يوم'];
export const AGING_BUCKET_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#f97316', '#ef4444'];

/**
 * Translate a UI-shaped builder request (string enum keys) into the numeric
 * wire payload the backend expects. Unknown/missing keys fall through to
 * undefined rather than throwing, so a caller can validate before sending.
 */
export function toWireRequest(req) {
  return {
    dataset: ReportDataset[req.dataset],
    dimension: ReportDimension[req.dimension],
    metric: ReportMetric[req.metric],
    aggregation: ReportAggregation[req.aggregation],
    filters: (req.filters || []).length
      ? req.filters.map(f => ({
          field: ReportDimension[f.field],
          operator: ReportFilterOperator[f.operator],
          value: f.value,
          valueTo: f.valueTo ?? null
        }))
      : null,
    sortDirection: ReportSortDirection[req.sortDirection],
    maxRows: req.maxRows
  };
}

/** Allowed operators (string keys) for a given dimension, per §5 filter rules. */
export function allowedOperatorsFor(dimensionKey) {
  return dimensionKey === 'RegistrationMonth' ? REGISTRATION_MONTH_ALLOWED_OPERATORS : DEFAULT_ALLOWED_OPERATORS;
}
