# Reporting and Data Analysis Module - Architecture

Read-model only, over the existing single NahdaDbContext - no new tables except the deferred
SavedReportDefinition extension point (not built; see Known limitations).

## Module layout

- src/Modules/Nahda.Modules.Reporting/Domain/ReportingEnums.cs - AgingBucket, TimeGranularity,
  ReportDataset/Dimension/Metric/Aggregation/FilterOperator/SortDirection, plus AgingCalculator,
  ComparisonCalculator, DataCoverageCalculator (pure, DB-free static helpers).
- src/Modules/Nahda.Modules.Reporting/Application/Abstractions/ReportingDtos.cs - every response DTO.
- src/Modules/Nahda.Modules.Reporting/Application/Abstractions/IReportingRepository.cs - fixed
  reports/dashboards persistence contract (also declares IReportBuilderRepository, IReportingCache).
- src/Modules/Nahda.Modules.Reporting/Application/Features/ReportCatalog.cs - the fixed
  dataset/dimension/metric whitelist table plus the fixed-report catalog list.
- src/Modules/Nahda.Modules.Reporting/Application/Features/FixedReportQueries.cs - one MediatR
  query+handler per fixed report/dashboard.
- src/Modules/Nahda.Modules.Reporting/Application/Features/ReportBuilderQuery.cs - RunReportBuilderQuery,
  validates against ReportCatalog before Infrastructure is ever reached.
- src/Modules/Nahda.Modules.Reporting/Application/Features/ExportReportQuery.cs - CSV export of a builder run.
- src/Nahda.Infrastructure/Reporting/ReportingRepository.cs - EF Core implementation of IReportingRepository.
- src/Nahda.Infrastructure/Reporting/ReportBuilderRepository.cs - EF Core implementation of
  IReportBuilderRepository (whitelist-only).
- src/Nahda.Infrastructure/Reporting/ReportingCache.cs - DistributedReportingCache / NoOpReportingCache.
- src/Nahda.Api/Endpoints/ReportingEndpoints.cs - all HTTP routes.

Same module-isolation convention as every other module (Nahda.Modules.Dashboard, Nahda.Modules.Search):
Reporting has no Npgsql/EF reference and no project reference to any other Nahda.Modules.* project.
ModuleIsolationTests was extended to cover it and passes. All case-rooted queries reuse
Nahda.Infrastructure.Cases.CaseVisibilityQuery.VisibleTo - the identical extension method that GET /cases,
Search and Dashboard already use (currently a no-op per the confirmed "all logged-in users can view all
cases" integration decision, but every reporting number is still routed through it so it can never silently
diverge from the rest of the system if that policy changes again).

## Permissions

Three new permissions in Nahda.SharedKernel.Authorization.Permission:

- view_reports - the non-financial reporting/analytics surface.
- view_financial_reports - money-shaped analytics specifically (financial summary).
- export_reports - the CSV export sub-route.

Grants in RolePermissionMatrix:

- manager: view_reports, view_financial_reports, export_reports (all three).
- reviewer: view_reports, view_financial_reports, export_reports (all three).
- data_entry: view_reports only.
- social_worker: view_reports only.

Reasoning: manager and reviewer both make or recommend financial/support decisions on a case - the same two
roles that already hold write_manager_approval/write_reviewer_opinion - so both need the full picture,
including money figures and the ability to pull a file out of the system. data_entry and social_worker
operate at the case level and need operational counts (how many cases, what status, how many visits) to do
their job, but the existing matrix never gives either role a money-adjacent permission, so extending that
same narrower grant to reporting was the consistent choice rather than a new judgment call.

Endpoint-level: every route under /api/v1/reports requires view_reports; GET .../financial/summary and
GET .../dashboards/financial additionally require view_financial_reports; POST .../export additionally
requires export_reports. RequireAuthorization with multiple calls requires all of them - identical to every
other multi-permission endpoint in this codebase.

## Fixed reports and dashboards

Full endpoint list, comparison logic, aging logic and coverage logic are documented with real request and
response examples in docs/FRONTEND_REPORTING_HANDOFF.md - this file states the rules, that one states the
wire shapes.

- Aging buckets (AgingCalculator.Bucket): 0-7, 8-30, 31-90, 91-180, 180+ days since Case.RegistrationDate.
  A negative age (bad legacy registration date in the future) is treated as the youngest bucket rather than
  throwing.
- Comparison (ComparisonCalculator.Calculate): delta = current - previous; percentChange = null when
  previous == 0 (never Infinity, never a thrown DivideByZeroException, never silently 0). Supported metrics
  today: case registrations in range (Count) and total approved support amount in range (TotalAmount) - any
  other metric throws NotSupportedException at the repository rather than silently returning zero.
- Data coverage (DataCoverageCalculator.Percentage / DataCoverage.Compute): 100% when there are no records
  to be incomplete about (total == 0); otherwise available/total rounded to 2 decimals, clamped to 0-100.
  Every report whose data is affected by the legacy-import gap (see below) returns a coverage block shaped
  { totalRecords, availableRecords, coveragePercentage, warning? } - warning is populated automatically
  whenever coverage is below 100%, worded per-report, so a frontend never has to invent copy or hard-code a
  threshold.
- Employee activity, not "performance": GetEmployeeActivityAsync returns three raw counts per user (cases
  created, visits conducted, audit actions recorded) over an optional date range. There is no score,
  ranking, quota comparison, or aggregate performance figure anywhere in the module - the schema has no
  target/quota concept to compare against, and inventing one would be inventing a business rule.

## Caching

IReportingCache mirrors IDashboardStatsCache's contract exactly: TryGetAsync never throws (a cache
outage/timeout/serialization mismatch is reported as a miss), SetAsync never fails the request that already
computed the live result, and every operation is bounded by a 500ms timeout so a dead Redis degrades latency
only. DistributedReportingCache sits on the same IDistributedCache/Redis connection that AddDashboardCaching
already registers (no second Redis connection, no duplicate AddStackExchangeRedisCache call) -
AddReportingCaching only decides which IReportingCache implementation to wire up, exactly as
AddDashboardCaching does for IDashboardStatsCache. With no Redis connection string configured,
NoOpReportingCache is used and every call recomputes live.

TTL: 60 seconds (ReportCacheTtl.Value), versus the Dashboard's 30 seconds - deliberately longer, because
Reporting aggregates are heavier (full-table GROUP BYs rather than a handful of indexed COUNTs) but are read
on report/dashboard pages rather than polled continuously, so a little more staleness buys materially less
DB load. Cached today: GetCasesSummaryQuery and GetExecutiveDashboardQuery (the two heaviest and most likely
to be hit repeatedly). The rest of the fixed reports and the report builder are not cached in this release.

Cache key shape: nahda:reports:{report}:v1:{role}:{userId:N}[:filters] - user id and role are always in the
key for the same reason DistributedDashboardStatsCache puts them in its key.

## Report builder (whitelist-only)

POST /api/v1/reports/builder/run is the only user-composable query in the module. Every field on the
request body is a closed C# enum (ReportDataset, ReportDimension, ReportMetric, ReportAggregation,
ReportFilterOperator, ReportSortDirection) - there is no free-text field-name parameter for a client to even
attempt to inject. Two layers of defense:

1. ReportCatalog.IsValid(dataset, dimension, metric), called by RunReportBuilderQueryHandler, rejects any
   dataset/dimension/metric combination not in the fixed catalog table before the request reaches
   Infrastructure at all (for example, SupportType is a real dimension, but not valid against the Cases
   dataset).
2. ReportBuilderRepository's per-dataset switch expressions are exhaustive over the same closed enums;
   nothing there concatenates a client-supplied string into a query.

Row cap: RunReportBuilderQueryHandler.MaxRowsCeiling = 5000. A caller-supplied maxRows is clamped to
1-5000 (default 100 if omitted or invalid). This keeps a single builder run or export bounded to a size that
stays renderable in a browser table and opens without complaint in Excel/Sheets.

Filters: Equals/NotEquals/Contains are implemented, applied to the already-projected dimension string (the
same closed vocabulary the dimension switch produces - never a raw client field). The four numeric
comparison operators (GreaterThan/GreaterThanOrEqual/LessThan/LessThanOrEqual/Between) exist on the enum for
forward compatibility with a future numeric-field filter but throw NotSupportedException today.

## Legacy-import data-completeness caveat

Roughly 53 of 215 legacy-imported Excel columns (detailed income/expense line items, detailed housing,
detailed support-given) were never persisted for legacy-imported cases - see LEGACY_IMPORT_FIELD_MAPPING.md
at the repo root (pre-existing, untracked, not modified by this module). Every report whose numbers could be
incomplete because of this returns a dataCoverage/coverage block:

- GetFinancialSummaryAsync - coverage = cases with at least one CaseFinancialItem row divided by total
  visible cases.
- GetSupportSummaryAsync - coverage = cases with at least one CaseApprovedSupport row divided by total
  visible cases.
- GetDataCoverageAsync - all three blocks at once (financial, housing, support).

This is a proxy for completeness (presence of any row in the gappy table), not a column-by-column audit -
the schema does not record which of the ~53 missing Excel columns a given legacy case is missing, only
whether the detail rows exist at all.

## Export

CSV only, RFC 4180 quoting plus UTF-8 BOM, hand-rolled - the identical pattern
ExportCharitiesCsvQuery/CharityEndpoints.MapGet("/export") already ship (this codebase's only existing
export precedent; no CSV library dependency added). POST /api/v1/reports/export runs a report-builder
request and streams the result as report.csv.

Excel (.xlsx) via ClosedXML is a designed-but-deferred extension point, not implemented in this release:
ReportExportFormat.Xlsx exists in the enum so the endpoint contract will not need to change shape when it is
added, and ExportReportBuilderQueryHandler throws a clear NotSupportedException for it today. Adding it
later requires a ClosedXML.Excel package reference in Nahda.Infrastructure and a workbook-writing branch in
the export handler - no other file changes.

## Performance

- Every fixed-report query is AsNoTracking, projects only the columns it needs, and (for case-rooted
  reports) starts from CaseVisibilityQuery.VisibleTo so PostgreSQL, not the app, excludes invisible rows.
- Group-bys that translate cleanly to SQL (status/priority counts, support-by-type, visit outcome/status)
  are left as IQueryable all the way to ToListAsync. A handful of reports (aging, cases-by-location,
  beneficiaries-by-age-bracket) fetch one narrow projected column set and finish the bucketing in memory,
  because the bucketing logic is not a value EF Core can translate.
- The report builder fetches each dataset's raw rows with one ToListAsync, then performs the dimension and
  metric mapping, grouping, aggregation and sort in memory - a C# switch expression cannot appear inside an
  EF Core expression tree.

### Indexes

No new index migration was added in this pass. The reporting queries lean on the same columns the existing
Cases/Search/Dashboard modules already query by (Case.Status, Case.RegistrationDate,
Beneficiary.CenterId/VillageId, CaseFieldVisit.VisitDate, CaseApprovedSupport.ApprovedAtUtc). If profiling
later shows any of these as a hot, unindexed path: Case.RegistrationDate for the trend/aging/summary
date-range filters; CaseApprovedSupport.ApprovedAtUtc for the comparison report's date-range sum;
Beneficiary.CenterId/VillageId for the by-location/by-center builder dimension. Deferred rather than
speculatively added because none of them could be justified against an actual EXPLAIN without a live,
populated database in this environment.

## Migration

None. Reporting is a pure read-model over existing tables; no new entity was added in this pass (the
SavedReportDefinition extension point was deliberately not built - see below), so there is nothing for
dotnet ef migrations add to generate. Adding it later needs exactly one new
IEntityTypeConfiguration<SavedReportDefinition> plus one migration; no other schema change.

## Known limitations and deferred work

- Report builder aggregation is in-memory, not SQL GROUP BY. Bounded by MaxRowsCeiling (5000) on the output,
  but the underlying per-dataset row fetch is not itself capped beyond the dataset's total visible row
  count. Acceptable at this system's current data volume; the fix if volume grows is either precomputed
  rollup tables or pushing the bucketing expressions into SQL via computed columns.
- Report builder filters: only Equals/NotEquals/Contains are implemented; the four numeric comparison
  operators are accepted by the enum but rejected at runtime with NotSupportedException.
- Excel export: designed (enum value and endpoint shape reserved), not implemented.
- Saved reports: not implemented, deliberately deferred per the task brief's own allowance. Future shape: a
  small entity (Id, OwnerUserId, Name, serialized ReportBuilderRequest JSON, CreatedAtUtc) plus
  IEntityTypeConfiguration plus migration plus ISavedReportRepository plus four endpoints
  (list/get/create/delete) under /api/v1/reports/saved, permission-gated the same way as the rest of the
  module.
- No index migration in this pass.
- Integration tests requiring a live Postgres instance were not executed in this environment - see the
  implementation notes.
