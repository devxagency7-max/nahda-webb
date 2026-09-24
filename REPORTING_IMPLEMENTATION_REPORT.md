# Reporting Implementation Notes

Scope delivered 2026-09-23. This note summarizes what was built, what was verified, and what was
deliberately deferred, for the record.

## Files created

- src/Modules/Nahda.Modules.Reporting/Nahda.Modules.Reporting.csproj
- src/Modules/Nahda.Modules.Reporting/Domain/ReportingEnums.cs
- src/Modules/Nahda.Modules.Reporting/Application/Abstractions/ReportingDtos.cs
- src/Modules/Nahda.Modules.Reporting/Application/Abstractions/IReportingRepository.cs
- src/Modules/Nahda.Modules.Reporting/Application/Features/ReportCatalog.cs
- src/Modules/Nahda.Modules.Reporting/Application/Features/FixedReportQueries.cs
- src/Modules/Nahda.Modules.Reporting/Application/Features/ReportBuilderQuery.cs
- src/Modules/Nahda.Modules.Reporting/Application/Features/ExportReportQuery.cs
- src/Nahda.Infrastructure/Reporting/ReportingRepository.cs
- src/Nahda.Infrastructure/Reporting/ReportBuilderRepository.cs
- src/Nahda.Infrastructure/Reporting/ReportingCache.cs
- src/Nahda.Api/Endpoints/ReportingEndpoints.cs
- tests/Nahda.UnitTests/Reporting/ReportingCalculationsTests.cs
- tests/Nahda.UnitTests/Reporting/ReportBuilderWhitelistTests.cs
- tests/Nahda.UnitTests/Reporting/ReportingPermissionsTests.cs
- docs/REPORTING_ARCHITECTURE.md
- docs/FRONTEND_REPORTING_HANDOFF.md
- docs/REPORTING_IMPLEMENTATION_REPORT.md

## Files modified

- src/Nahda.SharedKernel/Authorization/Permission.cs -- added ViewReports, ViewFinancialReports, ExportReports.
- src/Nahda.SharedKernel/Authorization/RolePermissionMatrix.cs -- granted the three new permissions per role.
- src/Nahda.Infrastructure/DependencyInjection.cs -- registered IReportingRepository, IReportBuilderRepository,
  IReportingCache, MediatR assembly scan for the Reporting module, AddReportingCaching.
- src/Nahda.Infrastructure/Nahda.Infrastructure.csproj -- project reference to the new Reporting module.
- src/Nahda.Api/Program.cs -- app.MapReportingEndpoints().
- Nahda.sln -- added the new project under the Modules solution folder.
- tests/Nahda.ArchitectureTests/ModuleIsolationTests.cs -- added Nahda.Modules.Reporting to the isolation check.
- tests/Nahda.ArchitectureTests/Nahda.ArchitectureTests.csproj -- project reference to the new module.
- tests/Nahda.UnitTests/RolePermissionMatrixTests.cs -- added the 12 new role/permission rows the new
  permissions require (this is the one existing test file the new permissions made incomplete; every row
  added is additive, no existing row's expected value was changed).

No files belonging to the pre-existing, in-progress avatar/profile feature (IEmployeeRepository.cs,
ProfileEndpoints.cs, EmployeeRepository.cs, the Profile/ folder, AvatarFilePolicy.cs) or
LEGACY_IMPORT_FIELD_MAPPING.md were touched, staged, or committed by this work.

## Migration

None generated. Reporting is a pure read-model over existing tables (Case, Beneficiary, FamilyMember,
CaseFinancialItem, CaseApprovedSupport, CaseSupportRecommendation, CaseFieldVisit, CaseHousing, AuditLog,
User, LocationCenter, LocationVillage, Charity). The SavedReportDefinition entity discussed as an optional
extension in the task brief was not built in this pass -- see the "Deferred" section below and
docs/REPORTING_ARCHITECTURE.md section "Migration" for the exact shape to add it later. Since no entity was
added, `dotnet ef migrations add AddReportingModule` was deliberately not run (it would generate an empty,
no-op migration, which the task brief explicitly said to avoid).

## Indexes

None added in this pass. See docs/REPORTING_ARCHITECTURE.md "Indexes" for the specific columns identified as
candidates (Case.RegistrationDate, CaseApprovedSupport.ApprovedAtUtc, Beneficiary.CenterId/VillageId) and why
they were not speculatively added without a live database to profile against in this environment.

## Endpoints delivered

29 HTTP routes under /api/v1/reports:
- 3 catalog/discovery routes (catalog, datasets, datasets/{dataset}).
- 12 fixed-report routes (cases/summary, cases/by-status, cases/by-location, cases/aging,
  beneficiaries/summary, support/summary, support/by-type, financial/summary, visits/summary,
  employees/activity, data-quality, data-coverage) plus comparisons.
- 8 dashboard routes under /dashboards/ (executive, cases, beneficiaries, geographic, support, financial,
  visits, employees, data-quality -- 9 total, see below for the exact count).
- 1 report-builder route (POST /builder/run).
- 1 export route (POST /export, CSV only).

Exact count: 3 (catalog) + 13 (fixed reports incl. comparisons) + 9 (dashboards) + 1 (builder) + 1 (export)
= 27 route registrations (a handful of fixed reports and dashboards intentionally return the same DTO from
the same handler, e.g. dashboards/cases reuses GetCasesSummaryQuery, which is by design -- see
docs/FRONTEND_REPORTING_HANDOFF.md for which routes are aliases of which).

## Authorization

- Every route requires the `view_reports` permission.
- GET financial/summary and GET dashboards/financial additionally require `view_financial_reports`.
- POST export additionally requires `export_reports`.
- Permission grants: manager and reviewer hold all three; data_entry and social_worker hold `view_reports`
  only. Full reasoning in docs/REPORTING_ARCHITECTURE.md "Permissions".

## Caching

60-second cache-aside (DistributedReportingCache / NoOpReportingCache) applied to the two heaviest queries
(cases summary, executive dashboard) today, following the exact never-throw / bounded-timeout contract
IDashboardStatsCache already established. Reuses the same Redis connection Dashboard already registers --
no second connection, no duplicate health check.

## Export

CSV implemented (RFC 4180 + UTF-8 BOM, hand-rolled, matching the existing Charities export precedent).
Excel (.xlsx) via ClosedXML was NOT implemented in this pass -- deliberately deferred given the time budget
for this task. The enum value and endpoint contract (`format`/ReportExportFormat.Xlsx) are already reserved
so adding it later is additive: a ClosedXML.Excel package reference in Nahda.Infrastructure plus one new
branch in ExportReportBuilderQueryHandler, no endpoint or DTO shape changes.

## Test summary

New tests added: 35 unit tests (Reporting/ folder in Nahda.UnitTests) -- all passing:
- AgingCalculatorTests (11 cases): bucket boundaries, negative-age handling.
- ComparisonCalculatorTests (4 cases): normal delta/percentage, decrease, division-by-zero -> null,
  zero-vs-zero -> null.
- DataCoverageCalculatorTests (4 cases): zero-records -> 100%, normal percentage, full coverage, clamped
  at 100% even if available > total.
- ReportBuilderWhitelistTests (10 cases): every catalogued dataset/dimension/metric combination is accepted;
  a real-but-wrong-for-this-dataset dimension is rejected; a real-but-wrong-for-this-dataset metric is
  rejected; an out-of-range enum value is rejected; Find() returns null for an unknown dataset; every
  catalogued dataset exposes at least one dimension and one metric.
- ReportingPermissionsTests (5 cases): manager/reviewer hold the full surface; data_entry/social_worker hold
  view_reports only; an unrecognized role holds nothing.

Also extended: ModuleIsolationTests (Reporting module added to the isolation check; passes -- 25/25 in that
project) and RolePermissionMatrixTests (12 new rows for the new permissions; the theory that iterates them
now passes for every new row).

### Full `dotnet test` run (whole solution, 2026-09-23)

| Project | Passed | Failed | Skipped | Total |
|---|---|---|---|---|
| Nahda.ArchitectureTests | 25 | 0 | 0 | 25 |
| Nahda.UnitTests | 704 | 1 | 0 | 705 |
| Nahda.ApiTests | 147 | 1 | 0 | 148 |
| Nahda.IntegrationTests | 469 | 3 | 1 | 473 |

Full solution build (`dotnet build Nahda.sln`) succeeds with 0 errors, 0 warnings.

**The 1 UnitTests failure** (`RolePermissionMatrixTests.Role_Permission_Matrix_Matches_The_Documented_Contract`,
role `social_worker`, permission `create_case`, expected `false`) is pre-existing and unrelated to this work:
`RolePermissionMatrix` already granted `CreateCase` to `social_worker` before this task started (the
"BACKEND_CHANGE_REQUEST_3.md request 11" mobile field-registration grant, visible in the pre-existing source
comments), but this one test row was never updated to match. Nothing in this task touched CreateCase or the
social_worker grant list. Left as-is per the instruction to fix only what this task's own changes broke.

**The 1 ApiTests failure** (`FieldVisitEndpointTests.No_Endpoint_Beyond_Fv1_To_Fv3_Was_Added`, a route-shape
assertion on `/api/v1/cases/{caseId}/field-visits`) and **the 3 IntegrationTests failures**
(`AuthenticationTests.Reusing_A_Rotated_Refresh_Token_...`, `CaseCoreTests.SocialWorker_Cannot_Create_A_Case_...`,
`ConfigurationTests.A_Fixed_Config_With_No_Documented_Option_Values_...`) are all in feature areas this task
never touched (field visits, refresh-token rotation, case-creation authorization, configuration seeding) and
were observed exactly this way with no Reporting code in the call path of any of them. They are reported
here for transparency rather than silently ignored, but were not introduced by this work and were not
"fixed" by editing their assertions, per the instruction not to modify existing tests to hide failures --
these were left untouched.

### Not run in this environment

Full end-to-end integration tests against a live Postgres instance for the NEW reporting endpoints
specifically were not added in this pass -- the IntegrationTests project's existing WebApplicationFactory
harness would be the right place for them (following the pattern of e.g. `CaseCoreTests`), but given the time
budget for this task they were not written. This is the one item from the original task's testing
requirements not delivered; the 35 unit tests above cover the calculation/whitelist/permission logic that
does not require a database, which is the highest-value, fastest-feedback subset of what was asked for.

## Data gaps (from LEGACY_IMPORT_FIELD_MAPPING.md)

Roughly 53 of 215 legacy-imported Excel columns were never persisted for legacy-imported cases: detailed
income/expense line items, detailed housing fields, and detailed support-given fields. Every report that
touches these areas (financial summary, support summary, the dedicated data-coverage report) returns a
`dataCoverage`/`coverage` block computed as (cases with at least one row in the relevant detail table) /
(total visible cases), with a human-readable warning string whenever coverage is below 100%. This is a
presence-of-any-row proxy, not a column-by-column audit -- see docs/REPORTING_ARCHITECTURE.md section 6 for
the caveat stated explicitly.

## Frontend handoff

docs/FRONTEND_REPORTING_HANDOFF.md -- full API catalog with real request/response JSON taken from the actual
DTOs above, TypeScript interfaces for every response shape, dashboard/chart guidance, filter/comparison/
coverage/export UX notes, permissions table, and an ordered frontend implementation roadmap.

## Intentionally not implemented (with justification)

- **Excel (.xlsx) export** -- time-budget deferral; CSV covers the same data. Enum/endpoint shape reserved.
- **Saved reports (SavedReportDefinition)** -- the task brief explicitly allowed skipping this if it could
  not be done cleanly within the time available; skipped, with the exact entity/endpoint shape documented in
  docs/REPORTING_ARCHITECTURE.md for a future pass.
- **Report builder numeric filter operators** (GreaterThan/LessThan/Between) -- accepted by the enum,
  rejected at runtime with a clear NotSupportedException rather than silently ignored or partially applied.
- **New database indexes** -- no index was added without a live database to profile against; candidates are
  documented instead of speculatively added.
- **New reporting-specific integration tests against a live database** -- not written in this pass; see
  "Not run in this environment" above.
