/* --------------------------------------------------------------------------
   REPORTING MODULE TYPES & CONTRACTS
   Aligned 1-to-1 with backend DTOs (FRONTEND_REPORTING_HANDOFF.md §4)
   -------------------------------------------------------------------------- */

export interface ApiResponse<T> {
  success: true;
  data: T;
  message: string | null;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, string[]>;
  };
}

export interface NamedCount {
  key: string;
  label: string | null;
  count: number;
}

export interface NamedAmount {
  key: string;
  label: string | null;
  amount: number;
}

export interface TrendPoint {
  periodStart: string;
  periodLabel: string;
  count: number;
  amount: number;
}

export interface DataCoverage {
  totalRecords: number;
  availableRecords: number;
  coveragePercentage: number;
  warning: string | null;
}

export interface ComparisonResult {
  currentValue: number;
  previousValue: number;
  delta: number;
  percentChange: number | null;
}

export interface CasesSummaryDto {
  totalCases: number;
  byStatus: NamedCount[];
  byPriority: NamedCount[];
  averageCompletionPercentage: number;
  registrationTrend: TrendPoint[];
}

export interface CasesByLocationRow {
  centerId: string | null;
  centerName: string | null;
  villageId: string | null;
  villageName: string | null;
  caseCount: number;
}

// Wire value is a number (0..4) -- backend has no JsonStringEnumConverter. Order is display order.
export type AgingBucket = 0 | 1 | 2 | 3 | 4;
export const AGING_BUCKET_LABELS = ['0-7 يوم', '8-30 يوم', '31-90 يوم', '91-180 يوم', '+180 يوم'] as const;

export interface CasesAgingRow {
  bucket: AgingBucket;
  caseCount: number;
}

export interface BeneficiariesSummaryDto {
  totalBeneficiaries: number;
  byGender: NamedCount[];
  byAgeBracket: NamedCount[];
  byEmploymentStatus: NamedCount[];
  averageMonthlyIncome: number | null;
  averageFamilySize: number;
}

export interface SupportSummaryDto {
  totalApprovedSupportRecords: number;
  totalApprovedAmount: number;
  averageApprovedAmount: number;
  coverage: DataCoverage;
}

export interface SupportByTypeRow {
  supportType: string;
  count: number;
  totalAmount: number;
}

export interface FinancialSummaryDto {
  totalIncome: number;
  totalExpenses: number;
  netBalance: number;
  incomeByLabel: NamedAmount[];
  expenseByLabel: NamedAmount[];
  coverage: DataCoverage;
}

export interface VisitsSummaryDto {
  totalVisits: number;
  byOutcome: NamedCount[];
  byStatus: NamedCount[];
  averageVisitsPerCase: number;
}

export interface EmployeeActivityRow {
  userId: string;
  fullName: string;
  role: string;
  casesCreated: number;
  visitsConducted: number;
  auditActionsRecorded: number;
}

export interface DataQualityDto {
  totalCases: number;
  casesMissingBeneficiaryPhone: number;
  casesMissingHousingRecord: number;
  casesMissingFinancialItems: number;
  casesWithZeroFamilyMembers: number;
}

export interface DataCoverageReportDto {
  financialCoverage: DataCoverage;
  housingCoverage: DataCoverage;
  supportCoverage: DataCoverage;
}

export interface ExecutiveDashboardDto {
  totalCases: number;
  approvedCases: number;
  rejectedCases: number;
  pendingCases: number;
  totalApprovedSupportAmount: number;
  totalBeneficiaries: number;
  totalVisitsLast30Days: number;
  casesTrendLast90Days: TrendPoint[];
}

/* ----------------------------------------------------------------------
   Report Builder enums -- WIRE VALUE IS A NUMBER, not a string.
   The backend has no JsonStringEnumConverter, so every enum field on the
   ReportBuilderRequest body (and every enum field in the response) is
   serialized/deserialized as its underlying integer. Keep string keys
   ('Cases', 'Status', ...) for UI state/labels only, and translate through
   these maps right before building the request body / right after reading
   a response. Query-string params (e.g. /comparisons?metric=Count) are the
   one exception -- those stay string-based.
   ---------------------------------------------------------------------- */

export const ReportDataset = {
  Cases: 0,
  Beneficiaries: 1,
  FamilyMembers: 2,
  ApprovedSupport: 3,
  FieldVisits: 4
} as const;
export type ReportDataset = keyof typeof ReportDataset;

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
} as const;
export type ReportDimension = keyof typeof ReportDimension;

export const ReportMetric = {
  Count: 0,
  TotalAmount: 1,
  AverageAmount: 2,
  AverageAge: 3,
  AverageMonthlyIncome: 4
} as const;
export type ReportMetric = keyof typeof ReportMetric;

export const ReportAggregation = {
  Sum: 0,
  Average: 1,
  Count: 2,
  Min: 3,
  Max: 4
} as const;
export type ReportAggregation = keyof typeof ReportAggregation;

export const ReportFilterOperator = {
  Equals: 0,
  NotEquals: 1,
  GreaterThan: 2,
  GreaterThanOrEqual: 3,
  LessThan: 4,
  LessThanOrEqual: 5,
  Between: 6,
  Contains: 7
} as const;
export type ReportFilterOperator = keyof typeof ReportFilterOperator;

export const ReportSortDirection = {
  Ascending: 0,
  Descending: 1
} as const;
export type ReportSortDirection = keyof typeof ReportSortDirection;

// Only these three operators are honored for any dimension except RegistrationMonth,
// which accepts the full set (its value is a sortable "YYYY-MM" string).
export const DEFAULT_ALLOWED_OPERATORS: ReportFilterOperator[] = ['Equals', 'NotEquals', 'Contains'];
export const REGISTRATION_MONTH_ALLOWED_OPERATORS: ReportFilterOperator[] = [
  'Equals', 'NotEquals', 'Contains', 'GreaterThan', 'GreaterThanOrEqual', 'LessThan', 'LessThanOrEqual', 'Between'
];

export interface ReportFilter {
  field: ReportDimension;
  operator: ReportFilterOperator;
  value: string;
  valueTo?: string | null;
}

export interface ReportBuilderRequest {
  dataset: ReportDataset;
  dimension: ReportDimension;
  metric: ReportMetric;
  aggregation: ReportAggregation;
  filters?: ReportFilter[] | null;
  sortDirection: ReportSortDirection;
  maxRows: number;
}

// The literal wire payload sent to POST /builder/run and /export -- every enum field is a number.
export interface ReportBuilderWireRequest {
  dataset: number;
  dimension: number;
  metric: number;
  aggregation: number;
  filters?: { field: number; operator: number; value: string; valueTo?: string | null }[] | null;
  sortDirection: number;
  maxRows: number;
}

export interface ReportBuilderRow {
  dimensionValue: string;
  metricValue: number;
}

export interface ReportBuilderResult {
  rows: ReportBuilderRow[];
  truncated: boolean;
  maxRows: number;
}

export interface DimensionOperatorsInfo {
  dimension: ReportDimension;
  allowedOperators: ReportFilterOperator[];
}

export interface DatasetMetadata {
  dataset: ReportDataset;
  label: string;
  allowedDimensions: ReportDimension[];
  allowedMetrics: ReportMetric[];
  dimensionOperators: DimensionOperatorsInfo[];
}

export interface ReportCatalogEntry {
  key: string;
  label: string;
  path: string;
  requiresFinancialPermission: boolean;
}

/** Translate a UI request (string enum keys) into the numeric wire payload the backend expects. */
export function toWireRequest(req: ReportBuilderRequest): ReportBuilderWireRequest {
  return {
    dataset: ReportDataset[req.dataset],
    dimension: ReportDimension[req.dimension],
    metric: ReportMetric[req.metric],
    aggregation: ReportAggregation[req.aggregation],
    filters: (req.filters || []).length
      ? req.filters!.map(f => ({
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
