# Safe integration database selection

Repair branch: `fix/internship-audit-20261010`. Changes are scoped to audit findings; no deployment or live provider action is included.

## Changed

Integration fixtures validate a dedicated _test database before schema/truncate operations. Auto-create uses a quoted psycopg identifier instead of interpolating a database name into SQL. Added native verification/runbook notes.

## Verification

`Run backend integration tests only with a dedicated TEST_DATABASE_URL ending in _test; frontend tests/build and Windows native tests are separate checks.`

Commands are entry points, not a claim that every live integration was executed. See the repair bundle for actual results.

## Setup and remaining evidence

Frontend baseline: 249 tests in 24 files and bundle/verification script passed at the unchanged frontend HEAD. Selected backend checkers passed in the original audit. Full backend integration and sandbox execution require PostgreSQL and the supported judge permissions. No Windows or full registration-to-review E2E run has been established. Related repositories form one project family.
