# Frontend Reporting Handoff

Backend module: Reporting & Data Analysis (src/Modules/Nahda.Modules.Reporting, src/Nahda.Api/Endpoints/ReportingEndpoints.cs).
Base path: `/api/v1/reports`. Every route requires a Bearer JWT and the `view_reports` permission unless
noted otherwise. Response envelope for every success response is the system-wide standard:
`{ "success": true, "data": <payload>, "message": null }`. Errors use the system-wide error envelope
`{ "success": false, "error": { "code": "...", "message": "...", "details": {...}? } }` with the usual
401/403/422/404 status codes.

## 1. System overview

The module has three layers of endpoints:

1. **Fixed reports** -- one URL per report, no query parameters beyond an optional date range. Cheap to
   consume: call the URL, render the DTO.
2. **Dashboards** -- one URL per dashboard screen, each returning a single aggregated DTO built for that
   screen (no client-side stitching of multiple calls needed for the primary view).
3. **Report builder** -- one POST endpoint that accepts a whitelisted dataset/dimension/metric/filter
   combination and returns a generic grouped-and-aggregated result, for ad-hoc exploration beyond the fixed
   reports. Discoverable via `/catalog` and `/datasets`.

## 2. Permissions table

| Role | view_reports | view_financial_reports | export_reports |
|---|---|---|---|
| manager | yes | yes | yes |
| reviewer | yes | yes | yes |
| data_entry | yes | no | no |
| social_worker | yes | no | no |

Frontend implication: hide the "Financial" dashboard/report tile and the "Export" button entirely for
data_entry/social_worker rather than showing a disabled control -- the backend will 403 on the underlying
call, but the UX should not offer an action the role cannot take.

## 3. API catalog

### 3.1 Catalog / discovery

**GET /api/v1/reports/catalog** -- permission: view_reports.
Lists every fixed report with its path, for building a reports menu without hard-coding it.
Response `data`: array of
```json
{ "key": "financial-summary", "label": "الملخص المالي", "path": "/api/v1/reports/financial/summary", "requiresFinancialPermission": true }
```

**GET /api/v1/reports/datasets** -- permission: view_reports.
Lists every report-builder dataset with its allowed dimensions/metrics (drives the builder's dropdowns).
Response `data`: array of
```json
{ "dataset": "Cases", "label": "الحالات", "allowedDimensions": ["Status","Priority","Center","Village","Charity","RegistrationMonth","None"], "allowedMetrics": ["Count"] }
```

**GET /api/v1/reports/datasets/{dataset}** -- permission: view_reports. Path param is the enum name (e.g.
`Cases`, `Beneficiaries`, `FamilyMembers`, `ApprovedSupport`, `FieldVisits`). 404 if not a real dataset.

### 3.2 Fixed reports

All GET, all permission `view_reports` unless noted.

| Method | Path | Response DTO |
|---|---|---|
| GET | /cases/summary?from=&to= | CasesSummaryDto |
| GET | /cases/by-status | NamedCount[] |
| GET | /cases/by-location | CasesByLocationRow[] |
| GET | /cases/aging | CasesAgingRow[] |
| GET | /beneficiaries/summary | BeneficiariesSummaryDto |
| GET | /support/summary | SupportSummaryDto |
| GET | /support/by-type | SupportByTypeRow[] |
| GET | /financial/summary | FinancialSummaryDto (also needs view_financial_reports) |
| GET | /visits/summary | VisitsSummaryDto |
| GET | /employees/activity?from=&to= | EmployeeActivityRow[] |
| GET | /data-quality | DataQualityDto |
| GET | /data-coverage | DataCoverageReportDto |
| GET | /comparisons?metric=&currentFrom=&currentTo=&previousFrom=&previousTo= | ComparisonResult |

`from`/`to`/`currentFrom`/etc. are `yyyy-MM-dd` date strings. `metric` for /comparisons is `Count` or
`TotalAmount` (any other value returns a 500 today -- validate client-side against those two).

Example, `GET /cases/summary`:
```json
{
  "success": true,
  "data": {
    "totalCases": 1240,
    "byStatus": [{ "key": "Approved", "label": "approved", "count": 640 }, { "key": "PendingReview", "label": "pending_review", "count": 90 }],
    "byPriority": [{ "key": "High", "label": "high", "count": 120 }],
    "averageCompletionPercentage": 78.4,
    "registrationTrend": [{ "periodStart": "2026-06-26", "periodLabel": "2026-06-26", "count": 3, "amount": 0 }]
  },
  "message": null
}
```

Example, `GET /financial/summary`:
```json
{
  "success": true,
  "data": {
    "totalIncome": 452000.00,
    "totalExpenses": 198500.00,
    "netBalance": 253500.00,
    "incomeByLabel": [{ "key": "salary", "label": "salary", "amount": 300000 }],
    "expenseByLabel": [{ "key": "rent", "label": "rent", "amount": 90000 }],
    "coverage": { "totalRecords": 1240, "availableRecords": 810, "coveragePercentage": 65.32, "warning": "detailed income/expense line items: 810/1240 records (65.32%) have this data. The remainder are legacy-imported cases whose detailed detailed income/expense line items was not captured during import -- see LEGACY_IMPORT_FIELD_MAPPING.md." }
  },
  "message": null
}
```

Example, `GET /comparisons?metric=Count&currentFrom=2026-09-01&currentTo=2026-09-23&previousFrom=2026-08-01&previousTo=2026-08-23`:
```json
{ "success": true, "data": { "currentValue": 84, "previousValue": 61, "delta": 23, "percentChange": 37.70 }, "message": null }
```
`percentChange` is `null` (not `0`, not `Infinity`) when `previousValue` is 0 -- always check for null before
formatting a "+X%" badge.

### 3.3 Dashboards

All GET, under `/api/v1/reports/dashboards`, permission `view_reports` unless noted.

| Path | Response DTO |
|---|---|
| /executive | ExecutiveDashboardDto |
| /cases | CasesSummaryDto |
| /beneficiaries | BeneficiariesSummaryDto |
| /geographic | CasesByLocationRow[] |
| /support | SupportSummaryDto |
| /financial | FinancialSummaryDto (also needs view_financial_reports) |
| /visits | VisitsSummaryDto |
| /employees | EmployeeActivityRow[] |
| /data-quality | DataQualityDto |

Example, `GET /dashboards/executive`:
```json
{
  "success": true,
  "data": {
    "totalCases": 1240, "approvedCases": 640, "rejectedCases": 85, "pendingCases": 515,
    "totalApprovedSupportAmount": 812500.00, "totalBeneficiaries": 1240, "totalVisitsLast30Days": 96,
    "casesTrendLast90Days": [{ "periodStart": "2026-06-26", "periodLabel": "2026-06-26", "count": 4, "amount": 0 }]
  },
  "message": null
}
```

### 3.4 Report builder

**POST /api/v1/reports/builder/run** -- permission: view_reports.

Request body (`ReportBuilderRequest`):
```json
{
  "dataset": "ApprovedSupport",
  "dimension": "SupportType",
  "metric": "TotalAmount",
  "aggregation": "Sum",
  "filters": [{ "field": "SupportType", "operator": "Contains", "value": "food" }],
  "sortDirection": "Descending",
  "maxRows": 50
}
```
All enum fields are strings matching the C# enum names exactly (`Cases`, `Beneficiaries`, `FamilyMembers`,
`ApprovedSupport`, `FieldVisits` for dataset; see `/datasets` for the allowed dimension/metric per dataset).
`filters` is optional/nullable. `maxRows` is clamped server-side to 1-5000 (default 100).

Response (`ReportBuilderResult`):
```json
{
  "success": true,
  "data": {
    "rows": [{ "dimensionValue": "cash", "metricValue": 452000.00 }, { "dimensionValue": "food", "metricValue": 198000.00 }],
    "truncated": false,
    "maxRows": 50
  },
  "message": null
}
```
`truncated: true` means more rows exist beyond `maxRows` -- show a "showing top N of more" notice, and
suggest narrowing filters or raising `maxRows` (up to 5000) rather than implying the data itself is limited.

A request with an invalid dataset/dimension/metric combination returns **422 VALIDATION_ERROR** with a
message naming the rejected combination -- surface it directly, it is already human-readable.

### 3.5 Export

**POST /api/v1/reports/export** -- permission: view_reports AND export_reports.
Same request body as `/builder/run`. Response is `text/csv; charset=utf-8` with a `Content-Disposition`
implied filename `report.csv` (UTF-8 BOM prefixed, RFC 4180 quoted) -- trigger a browser download, do not try
to parse it as JSON.

Excel (.xlsx) export is not available yet (`format=xlsx` is not wired up) -- do not build a format switch in
the UI for it until the backend ships it; CSV opens fine in Excel/Sheets already.

## 4. TypeScript interfaces

```ts
export interface ApiResponse<T> { success: true; data: T; message: string | null; }
export interface ApiErrorResponse { success: false; error: { code: string; message: string; details?: Record<string, string[]> }; }

export interface NamedCount { key: string; label: string | null; count: number; }
export interface NamedAmount { key: string; label: string | null; amount: number; }
export interface TrendPoint { periodStart: string; periodLabel: string; count: number; amount: number; }

export interface DataCoverage { totalRecords: number; availableRecords: number; coveragePercentage: number; warning: string | null; }
export interface ComparisonResult { currentValue: number; previousValue: number; delta: number; percentChange: number | null; }

export interface CasesSummaryDto {
  totalCases: number; byStatus: NamedCount[]; byPriority: NamedCount[];
  averageCompletionPercentage: number; registrationTrend: TrendPoint[];
}
export interface CasesByLocationRow { centerId: string | null; centerName: string | null; villageId: string | null; villageName: string | null; caseCount: number; }
export type AgingBucket = "Days0To7" | "Days8To30" | "Days31To90" | "Days91To180" | "Over180";
export interface CasesAgingRow { bucket: AgingBucket; caseCount: number; }

export interface BeneficiariesSummaryDto {
  totalBeneficiaries: number; byGender: NamedCount[]; byAgeBracket: NamedCount[]; byEmploymentStatus: NamedCount[];
  averageMonthlyIncome: number | null; averageFamilySize: number;
}

export interface SupportSummaryDto { totalApprovedSupportRecords: number; totalApprovedAmount: number; averageApprovedAmount: number; coverage: DataCoverage; }
export interface SupportByTypeRow { supportType: string; count: number; totalAmount: number; }

export interface FinancialSummaryDto {
  totalIncome: number; totalExpenses: number; netBalance: number;
  incomeByLabel: NamedAmount[]; expenseByLabel: NamedAmount[]; coverage: DataCoverage;
}

export interface VisitsSummaryDto { totalVisits: number; byOutcome: NamedCount[]; byStatus: NamedCount[]; averageVisitsPerCase: number; }

export interface EmployeeActivityRow { userId: string; fullName: string; role: string; casesCreated: number; visitsConducted: number; auditActionsRecorded: number; }

export interface DataQualityDto { totalCases: number; casesMissingBeneficiaryPhone: number; casesMissingHousingRecord: number; casesMissingFinancialItems: number; casesWithZeroFamilyMembers: number; }
export interface DataCoverageReportDto { financialCoverage: DataCoverage; housingCoverage: DataCoverage; supportCoverage: DataCoverage; }

export interface ExecutiveDashboardDto {
  totalCases: number; approvedCases: number; rejectedCases: number; pendingCases: number;
  totalApprovedSupportAmount: number; totalBeneficiaries: number; totalVisitsLast30Days: number;
  casesTrendLast90Days: TrendPoint[];
}

export type ReportDataset = "Cases" | "Beneficiaries" | "FamilyMembers" | "ApprovedSupport" | "FieldVisits";
export type ReportDimension = "Status" | "Priority" | "Center" | "Village" | "Charity" | "Gender" | "AgeBracket" | "SupportType" | "VisitOutcome" | "RegistrationMonth" | "None";
export type ReportMetric = "Count" | "TotalAmount" | "AverageAmount" | "AverageAge" | "AverageMonthlyIncome";
export type ReportAggregation = "Sum" | "Average" | "Count" | "Min" | "Max";
export type ReportFilterOperator = "Equals" | "NotEquals" | "GreaterThan" | "GreaterThanOrEqual" | "LessThan" | "LessThanOrEqual" | "Between" | "Contains";

export interface ReportFilter { field: ReportDimension; operator: ReportFilterOperator; value: string; valueTo?: string | null; }
export interface ReportBuilderRequest {
  dataset: ReportDataset; dimension: ReportDimension; metric: ReportMetric; aggregation: ReportAggregation;
  filters?: ReportFilter[] | null; sortDirection: "Ascending" | "Descending"; maxRows: number;
}
export interface ReportBuilderRow { dimensionValue: string; metricValue: number; }
export interface ReportBuilderResult { rows: ReportBuilderRow[]; truncated: boolean; maxRows: number; }

export interface DatasetMetadata { dataset: ReportDataset; label: string; allowedDimensions: ReportDimension[]; allowedMetrics: ReportMetric[]; }
export interface ReportCatalogEntry { key: string; label: string; path: string; requiresFinancialPermission: boolean; }
```

## 5. Chart-type suggestions per response shape

- `NamedCount[]` / `NamedAmount[]` (byStatus, byPriority, byGender, byEmploymentStatus, supportByType, ...) --
  donut/pie for <= 6 categories, horizontal bar for more.
- `TrendPoint[]` (registrationTrend, casesTrendLast90Days) -- line or area chart, x = periodStart.
- `CasesAgingRow[]` -- horizontal bar, ordered by the fixed bucket sequence (do not re-sort by count).
- `CasesByLocationRow[]` -- table by default; a map view is a nice-to-have but not required.
- `ComparisonResult` -- two stat tiles (current vs previous) plus a delta badge; color the badge green/red
  by the sign of `delta`, but render "N/A" (not "0%") when `percentChange` is null.
- `DataCoverage` -- a slim progress bar + percentage label; render the `warning` string as a dismissible
  banner only when it is non-null.
- `EmployeeActivityRow[]` -- a sortable table, NOT a leaderboard/ranking UI -- these are activity counts, not
  a performance score (the backend deliberately does not compute one; do not invent a composite score
  client-side either).

## 6. Filter system guide

Fixed reports: only optional `from`/`to` date-range query params (where offered) -- no other filtering.
Report builder: the `filters` array on `ReportBuilderRequest`. Build the filter UI FROM `/datasets/{dataset}`
response (`allowedDimensions`) so the field picker never offers a field the backend will reject. Only
`Equals`/`NotEquals`/`Contains` are currently honored server-side -- do not offer the numeric comparison
operators in the operator dropdown yet (they are accepted by validation but rejected with a 500 at runtime
today).

## 7. Report builder UX flow

1. Call `GET /datasets` once (cache client-side) to populate a dataset picker.
2. On dataset selection, use that dataset's `allowedDimensions`/`allowedMetrics` to populate the dimension
   and metric pickers -- never show a static, hard-coded list.
3. Let the user add filters (field from the same allowed-dimensions list), an aggregation, a sort direction,
   and a row cap.
4. `POST /builder/run`. Render `rows` as a table by default, with a "view as chart" toggle guessing bar
   (dimension categorical) vs line (dimension is a month/date-like string).
5. Offer "Export CSV" using the exact same request body against `POST /export`.
6. On a 422 (invalid combination), surface the message directly -- it already names the rejected combination.

## 8. Drill-down UX

None of the fixed reports currently return case-level ids to drill into (they return aggregates only). A
"drill down" today means: take the current report's filters (date range, status, etc.), translate them to
the equivalent `GET /api/v1/cases` / `GET /api/v1/search/cases` query, and open that list in a new view. No
backend endpoint exists yet that returns "the case ids behind this aggregate row" -- treat this as a known
gap if the product wants true row-level drill-down; it is not implemented in this release.

## 9. Loading / error / empty states

- **Loading**: every fixed report/dashboard is a single request -- a single skeleton per widget is enough;
  no need to stage partial loads.
- **Empty**: an empty system (zero cases) returns real zeros/empty arrays, not an error -- render "no data
  yet" only when arrays are empty, never based on a non-2xx response.
- **Error**: 401 -> redirect to login. 403 -> show "you don't have permission for this report" (this is
  expected for data_entry/social_worker hitting the financial routes if the UI failed to hide them). 422 (
  builder only) -> show the message inline near the builder form, do not treat as a generic toast-and-forget
  error. Anything else -> generic retry banner.

## 10. Responsive UI notes

Stat-tile rows (executive dashboard, comparison result) should collapse from a 4-6 column grid to 2 columns
below ~640px and 1 column below ~400px. Tables (report builder rows, employee activity, cases-by-location)
need horizontal scroll on narrow viewports rather than column-hiding, since every column here is meaningful.

## 11. State management guidance

Cache fixed-report/dashboard responses client-side for ~30-60s (matching the backend's own 60s cache TTL on
the two cached endpoints, and a sane default for the rest) to avoid refetching on every tab switch. The
report-builder result is NOT cached server-side -- treat each `POST /builder/run` as fresh, and debounce
re-runs while the user is still adjusting filters rather than firing on every keystroke.

## 12. Export UX

Trigger a native browser download on the CSV response (`Content-Type: text/csv`); do not attempt to preview
it inline. Show the export button only when `export_reports` is granted (see permissions table). There is no
progress/streaming state to build for -- exports are capped at 5000 rows and return synchronously.

## 13. Frontend implementation roadmap

1. Wire the permissions table into route guards / nav visibility (view_reports, view_financial_reports,
   export_reports).
2. Build the executive dashboard screen first (`GET /dashboards/executive`) -- highest information density
   per request, good first milestone.
3. Build the remaining fixed dashboards (cases, beneficiaries, geographic, support, financial, visits,
   employees, data-quality) reusing one "dashboard shell" component per the response-shape guidance above.
4. Build the fixed-reports pages (mostly the same DTOs as the dashboards, plus by-status/by-location/aging/
   by-type/comparisons) -- largely composition of components already built in step 3.
5. Build the report-builder screen last -- it depends on `/datasets` discovery and is the most UI-complex
   piece (dynamic field pickers, filter rows, chart-vs-table toggle, export button).
6. Add the data-coverage banners to the financial/support dashboards once the base widgets render, wiring
   the `coverage.warning` string as a dismissible banner.

## 14. Frontend acceptance checklist

- [ ] All 9 dashboards render with real data and correct empty states.
- [ ] Financial dashboard/report and export button are hidden (not just disabled) for data_entry/social_worker.
- [ ] Comparison UI renders "N/A" (not 0% or blank) when percentChange is null.
- [ ] Data-coverage warning banners only appear when coveragePercentage < 100.
- [ ] Report builder dropdowns are populated from `/datasets`, never hard-coded.
- [ ] Report builder shows a clear message on a 422 rejection.
- [ ] Export produces a downloadable, correctly-encoded CSV (UTF-8 BOM, opens cleanly in Excel).
- [ ] Employee activity is presented as a table of counts, not a ranked "leaderboard".
- [ ] All widgets have loading skeletons and a retry affordance on generic errors.

## 15. Backend acceptance checklist

- [x] All fixed reports and dashboards return live, correctly-scoped data.
- [x] Financial/export routes are permission-gated with a second, additional permission.
- [x] Comparison division-by-zero returns null, never throws or returns Infinity/0.
- [x] Aging buckets cover the full range including negative/very old ages.
- [x] Report builder rejects any non-whitelisted dataset/dimension/metric combination with 422.
- [x] Report builder never interpolates a client string into a query (enum-only input).
- [x] Every case-rooted query is routed through CaseVisibilityQuery.VisibleTo.
- [x] Module isolation tests pass for the new module.
- [x] CSV export matches the existing RFC 4180 + BOM precedent.
- [ ] Excel export -- deferred, see docs/REPORTING_IMPLEMENTATION_REPORT.md.
- [ ] Saved reports -- deferred, see docs/REPORTING_IMPLEMENTATION_REPORT.md.
