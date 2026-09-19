# PennyTel node:sqlite feasibility spike

> Historical pre-S9 feasibility record. References below to temporary spike files,
> commands, hooks, and “current” candidate state describe the spike at the time it
> was run; S9 converts the durable coverage and removes those temporary surfaces.

Decision: **GO WITH CONDITIONS** for a replaceable, main-process SQLite adapter
backing a rebuildable runtime projection. No demonstrated driver incompatibility;
there is no reason to test better-sqlite3 next. This is feasibility evidence, not
acceptance of a storage-service implementation or vNext schema.

## Candidate and environment

- Repository: `/home/rob/dev/PennyTel-AX`, branch `main`.
- Frozen product baseline / HEAD: `f776f9f50a5cc38ffa4a5dd412b6d57d21e91716`.
- Initial working tree was clean. Candidate is HEAD plus the four spike code/config
  files below; this report is an additional documentation-only change.
- Tested 2026-09-18 on the existing Linux x64 desktop.
- Package version: PennyTel 0.2.2. Requested Electron range: `^39.2.6`.
- **Actual Electron: 39.8.10; embedded Node: 22.22.1; SQLite: 3.51.2.**
- System Node: 24.20.0. Its SQLite implementation was not used as driver evidence.
- Installed `@types/node`: 22.20.2; electron-builder: 26.15.3.

Source SHA-256 identity:

```text
a6e30fff757e06ae847b74e14acd1b31f4385ac65d93ca700ef6691618a8f4ab  src/main/index.ts
c6cb6fa3cfb8dc23cae2038525bf433807a60e8785eca38e7baf8d4be8e791df  src/main/sqlite-spike.ts
6a57e90677107de508a57a2b7efb4b91d42c54558ac1c175e7bfb2f81dc6594c  scripts/electron-sqlite-spike.mjs
0a5034c4ccef445be766e407c798c1c2b930261c5d2b5b51f211a68c1298bd5d  package.json
```

Final built/package SHA-256 identity:

```text
079eb6c4cd6949fb1cdb0e13434160f5e5a43da00217a61261ac9066f80a0d0c  out/main/index.js
88546f9116fc893f6acdaf116e3914039644fae244b4ca710a710c6fc8a07864  out/main/sqlite-spike-ClVXPlo4.js
b7701fca6b619b12b104df8e6fa4c53cb6c1024cbf90bf1e455de80967b06cc1  dist/linux-unpacked/resources/app.asar
c63780578ca420c8651b81544e1551cef8b71a31c64712378467ed30dae06f6d  dist/linux-unpacked/pennytel
```

## Harness and safety

`npm run test:sqlite-spike` runs Playwright against actual Electron loading
`out/main/index.js`. Supplying a binary runs the packaged application instead:
`npm run test:sqlite-spike -- dist/linux-unpacked/pennytel`.

The runner creates `/tmp/pennytel-sqlite-spike-*`, sets the existing
`PENNYTEL_DATA_DIR` isolation setting, and launches separate `create` and `restart`
processes. `PENNYTEL_SQLITE_SPIKE` gates a dynamic main-only import. The probe
requires an existing QA directory directly inside OS temp with that prefix and
asserts Electron main's `process.type === 'browser'`. SQLite is never imported
on ordinary startup. Failure prints diagnostics and exits with failure before
normal startup continues. The smoke runner asserts results and exits nonzero on
failure.

All SQLite fixtures and the ordinary application's synthetic profile/registry
state reside in this disposable directory. No production telemetry was read or
mutated, no migration was run, and TelemetryStore/preload/IPC contracts were not
modified. Reports and fixtures were intentionally retained for inspection.

## Runtime evidence

| Requirement  | Expected and observed result                                                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Availability | `require('node:sqlite')` works in Electron main without a feature flag, both built and packaged.                                                                                                                   |
| Schema       | Project, Slice and Run STRICT tables, primary keys, two indexes and prepared statements work. Invalid TEXT into INTEGER is rejected.                                                                               |
| Foreign keys | Default observed `PRAGMA foreign_keys = 1`; explicit ON is read back as 1. Orphan Run insert fails (extended SQLite code 787); foreign_key_check is empty.                                                         |
| Commit       | One BEGIN IMMEDIATE transaction commits Project -> Slice -> two Runs, with 42 and NULL token values preserved.                                                                                                     |
| Rollback     | Failure after Project and Slice insertion is caught; explicit ROLLBACK leaves neither parent nor child nor failed Run. Final cardinalities remain 1 Project, 1 Slice, 2 Runs.                                      |
| Projection   | Rows reconstruct a small Dataset-like object. A bound model filter with three-table join returns exactly the expected Run. EXPLAIN QUERY PLAN confirms run_slice_model index use. Unknown tokens remain NULL.      |
| Errors       | Missing table, missing parent directory, deliberately invalid disposable DB file, lock contention and closed handles fail predictably and are caught.                                                              |
| Lifecycle    | Explicit close finalizes old statements; new connection sees both persisted Runs. Separate Electron restart sees the same complete dataset and passes integrity_check.                                             |
| Renderer     | Actual renderer has no require or process; sandbox=true, contextIsolation=true, nodeIntegration=false. Existing nine-method PennyTel preload API is unchanged. No SQLite or general filesystem IPC was introduced. |
| ASAR         | Packaged app reports app.isPackaged=true and loads resources/app.asar. Probe code executes from ASAR; database remains in writable temp storage outside it.                                                        |

Actual API exercised: `DatabaseSync` constructor, `exec`, `prepare`, `close`,
`isOpen`; prepared `StatementSync.run`, `.get`, `.all`; positional and named
parameters. Transactions use explicit SQL; no transaction-helper abstraction was
invented. Both runtime and production TypeScript compilation prove this subset.

Runtime module exports inventoried: DatabaseSync, StatementSync, backup,
constants, plus the CommonJS interop default namespace. Database prototype
methods inventoried: aggregate, applyChangeset, close, createSession,
enableLoadExtension, exec, function, loadExtension, location, open, prepare.
Statement prototype methods inventoried: all, columns, get, iterate, run,
setAllowBareNamedParameters, setAllowUnknownNamedParameters, setReadBigInts,
setReturnArrays. Inventory is availability evidence, not verification of unused
backup/session/extension/aggregate APIs.

Error details actually observed:

```text
foreign key     ERR_SQLITE_ERROR  errcode=787
STRICT type     ERR_SQLITE_ERROR  errcode=3091
missing table   ERR_SQLITE_ERROR  errcode=1
failed open     ERR_SQLITE_ERROR  errcode=14
corrupt fixture ERR_SQLITE_ERROR  errcode=26
locked writer   ERR_SQLITE_ERROR  errcode=5
closed database ERR_INVALID_STATE: database is not open
closed statement ERR_INVALID_STATE: statement has been finalized
```

Final detailed runtime JSON:

- Built: `/tmp/pennytel-sqlite-spike-kRE985/runtime-report.json`.
- Packaged: `/tmp/pennytel-sqlite-spike-ULV4fy/runtime-report.json`.
- Earlier pre-formatting built probe: `/tmp/pennytel-sqlite-spike-HBdK5F/runtime-report.json`.

## Build, packaging and regressions

- `npm run build`: PASS, including normal node/web/test TypeScript checks and
  electron-vite production build. No tsconfig, typing, bundler or dependency
  changes were needed. Vite externalizes SQLite as `require('node:sqlite')` in
  the gated main chunk.
- `npm run lint -- --max-warnings=0`: PASS after formatting new harness files.
- Default `npm test`: 350 passed, 6 five-second timeouts in 4 files while checks
  ran concurrently. `npm test -- --maxWorkers=1`: **21 files / 356 tests PASS**,
  without changing assertions or timeout limits. This is test execution friction,
  not evidence of a SQLite/product defect.
- `npm run test:electron`: **PASS**, including its build and all 9 existing QA
  scripts: smoke, repair, new-profile, registry, configuration, accepted-outcome,
  comparison-plan, execution-evidence and batch-import. These run with isolated
  synthetic profiles. Existing security, persistence, recovery, import/export,
  pricing and renderer checks passed.
- `npm run build:unpack`: its build passed, but packaging could not resolve the
  configured `npmmirror.com` download host in this network-restricted session.
- Local-only packaging command, approved execution: **PASS**:

  ```bash
  ./node_modules/.bin/electron-builder --linux --dir \
    -c.electronDist=node_modules/electron/dist --publish never
  ```

  This loads the unchanged repository electron-builder configuration and uses
  exactly the already-installed 39.8.10 Linux x64 runtime. No dependency install,
  download, configuration change, native rebuild or publication was required.
  A prior sandboxed attempt emitted `No JSON content found in output` during
  dependency collection. Diagnosis found child-process `EPERM`, with the exact
  npm command producing valid JSON when run directly. Approved execution resolved
  it without a product or dependency patch. A diagnostic process-local collector
  argument override was unsuccessful and was not used for the final package.

- Built smoke and packaged smoke: **PASS**, create and restart phases each.
  Electron launches used the approved route required by AGENTS.md, without
  disabling sandbox flags.
- ASAR inspection: **zero `.node` native addons**. Builder explicitly skipped
  dependency rebuild because existing `npmRebuild: false` remained unchanged.
  Packaged main and probe bytes match the final built files. No new addon/ABI or
  asarUnpack rule was introduced.
- `git diff --check`: PASS.

## Conditions, remaining uncertainty and next action

1. Keep the driver inside a replaceable main-process adapter. JSON artifacts
   remain canonical; SQLite is rebuildable. The spike makes no change to current
   persistence authority.
2. Explicitly enable and verify foreign keys for every connection, map errors to
   bounded service errors, and close connections during service shutdown. Keep
   transaction SQL and rollback ownership inside the adapter; avoid asynchronous
   gaps within an open transaction.
3. DatabaseSync blocks Electron main. Bound query/rebuild work, use indexes and a
   deliberate busy policy, and establish responsiveness limits in the future
   storage slice. This tiny smoke is not a large-dataset benchmark or proof of
   power-loss recovery.
4. Use a real writable service-owned path outside ASAR. Package contents are not
   writable projection storage. Tests must retain isolated profiles.
5. Re-run this real Electron/package smoke on runtime upgrades. System-Node-only
   tests and TypeScript declarations are insufficient runtime capability checks.
   The experimental API label is a bounded replaceability/versioning concern,
   not a demonstrated incompatibility.
6. Evidence covers Linux x64 unpacked + ASAR. Windows/macOS/other architectures
   and installed AppImage/deb/snap behavior were not exercised. Revalidate those
   release targets when they enter scope. Packaging environment readiness must
   include an available Electron distribution and permitted subprocess execution.

Recommended next Engineering action: approve the driver choice, then dispatch a
separate storage-service adapter contract/slice with projection rebuild semantics,
error/lifecycle ownership and responsiveness acceptance. Do not start migration
or artifact-store implementation as part of this spike.

Retain the smoke scenario and report as QA evidence; convert the probe into
adapter integration QA when that slice exists. Remove the temporary environment
hook and spike-specific production chunk before shipping a production change.
Current spike files remain uncommitted and visible for review, as requested.

Changed files: package.json (one smoke command), src/main/index.ts (gated probe),
src/main/sqlite-spike.ts (disposable main probe), scripts/electron-sqlite-spike.mjs
(isolated actual-runtime runner), and this report. No existing storage or preload
files changed. No MASTER_INDEX reconciliation is needed for durable product
geography yet; a retained QA route would warrant a later QA-routing entry.

No commit, push, merge, history rewrite, deployment, package installation,
better-sqlite3 comparison or vNext implementation was performed. HEAD remains the
baseline above. The current AGENTS.md return contract is used; no canonical
PENNYOS_TURN_REPORT_V1 requirement/schema was found in the repository guidance.
