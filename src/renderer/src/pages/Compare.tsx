import { useMemo, useState } from 'react'
import type { Dataset, Run } from '../../../shared/types'
import {
  MAX_COMPARISON_CANDIDATES,
  MAX_COMPARISON_STAGE_SCOPES,
  runFilterLabels,
  runFilterOptions,
  sliceFilterLabels,
  stageScopeKey,
  stageScopeLabel,
  stageScopeOptions,
  type ComparisonCandidate,
  type ComparisonFilters,
  type ComparisonSort,
  type FilterKey,
  type ComparisonContext,
  type OutcomeFilters,
  type StageScope,
  applyComparisonSelection,
  compareDataBase
} from '../../../shared/comparison'
import { burnLabel, displayTimestamp, qualityLabel } from '../../../shared/presentation'
import {
  duration,
  groupLabels,
  money,
  percent,
  numericEvidenceLabels,
  type GroupBy,
  type MeasuredTotal,
  type RecordedCounts
} from '../../../shared/metrics'
import { Empty, Metric } from '../components/ui'
import { RunTable } from '../components/RunTable'
import type { ComparisonIdentity } from '../../../shared/configuration'
import { AnalyticsWorkspace } from '../components/AnalyticsWorkspace'

interface Props {
  data: Dataset
  onOpenRun: (run: Run) => void
  onOpenSlice: (id: string) => void
}
const sliceFilterKeys = Object.keys(sliceFilterLabels) as (keyof typeof sliceFilterLabels)[]
const runFilterKeys = Object.keys(runFilterLabels) as (keyof typeof runFilterLabels)[]
export function Compare({ data, onOpenRun, onOpenSlice }: Props): React.JSX.Element {
  const [groupBy, setGroupBy] = useState<GroupBy>('modelConfiguration')
  const [filters, setFilters] = useState<ComparisonFilters>({})
  const [selected, setSelected] = useState<string>()
  const [sort, setSort] = useState<ComparisonSort>('label')
  const [selectedCandidates, setSelectedCandidates] = useState<string[]>([])
  const [stageScopes, setStageScopes] = useState<StageScope[]>([])
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [includeUnknownDates, setIncludeUnknownDates] = useState(false)
  const [outcomeFilters, setOutcomeFilters] = useState<OutcomeFilters>({})
  const [exportBusy, setExportBusy] = useState(false)
  const [exportError, setExportError] = useState('')
  const [exportMessage, setExportMessage] = useState('')
  const [planBusy, setPlanBusy] = useState(false)
  const dateError = !!(dateFrom && dateTo && dateFrom > dateTo)
  const baseContext: ComparisonContext = useMemo(
    () => ({
      filters,
      groupBy,
      sort,
      ...(stageScopes.length ? { stageScopes } : {}),
      ...(dateFrom || dateTo
        ? {
            dateRange: {
              ...(dateFrom ? { from: `${dateFrom}T00:00:00.000Z` } : {}),
              ...(dateTo ? { to: `${dateTo}T23:59:59.999Z` } : {}),
              includeUnknown: includeUnknownDates
            }
          }
        : {}),
      ...(Object.keys(outcomeFilters).length ? { outcomeFilters } : {})
    }),
    [filters, groupBy, sort, stageScopes, dateFrom, dateTo, includeUnknownDates, outcomeFilters]
  )
  const context: ComparisonContext = useMemo(
    () => ({
      ...baseContext,
      ...(selected ? { selectedGroup: selected } : {}),
      ...(selectedCandidates.length ? { selectedCandidates } : {})
    }),
    [baseContext, selected, selectedCandidates]
  )
  const baseView = useMemo(() => compareDataBase(data, baseContext), [data, baseContext])
  const view = useMemo(
    () => applyComparisonSelection(data, baseView, context),
    [data, baseView, context]
  )
  // Candidate/evidence-group selection and export status do not change analytics values.
  // Keep the large analytics subtree out of those unrelated Compare rerenders.
  const analyticsVersion = useMemo(() => ({ data, baseContext }), [data, baseContext])
  const {
    slices,
    runs,
    summary,
    groups,
    candidates,
    selectedGroup,
    shownRuns,
    discoveries,
    accepted
  } = view
  const exportComparison = async (): Promise<void> => {
    setExportBusy(true)
    setExportError('')
    setExportMessage('')
    try {
      const path = await window.pennytel.exportComparison({ revision: data.revision, context })
      if (path)
        setExportMessage(
          `Comparison exported to ${path}. This analysis is not an importable dataset.`
        )
    } catch (e) {
      setExportError((e as Error).message)
    } finally {
      setExportBusy(false)
    }
  }
  const runComparisonPlan = async (): Promise<void> => {
    setPlanBusy(true)
    setExportError('')
    setExportMessage('')
    try {
      const path = await window.pennytel.runComparisonPlan()
      if (path) setExportMessage(`Comparison-plan results saved to ${path}.`)
    } catch (e) {
      setExportError((e as Error).message)
    } finally {
      setPlanBusy(false)
    }
  }
  const knownMax = Math.max(...groups.map((g) => g.stats.cost), 0)
  const candidateOptions = useMemo(() => {
    const options = runFilterOptions(data, 'modelConfiguration')
    for (const candidate of candidates)
      if (!options.some((option) => option.key === candidate.key))
        options.push({ key: candidate.key, label: candidate.label })
    return options
  }, [data, candidates])
  const stageOptions = useMemo(() => {
    const options = stageScopeOptions(data)
    for (const scope of stageScopes)
      if (!options.some((option) => stageScopeKey(option) === stageScopeKey(scope)))
        options.push(scope)
    return options
  }, [data, stageScopes])
  const filterOptions: [FilterKey, string, ComparisonIdentity[]][] = useMemo(
    () => [
      ...sliceFilterKeys.map(
        (k) =>
          [
            k,
            sliceFilterLabels[k],
            [...new Set(data.slices.map((s) => String(s[k] ?? '')).filter(Boolean))]
              .sort()
              .map((value) => ({ key: value, label: value }))
          ] as [FilterKey, string, ComparisonIdentity[]]
      ),
      ...runFilterKeys.map(
        (k) =>
          [k, runFilterLabels[k], runFilterOptions(data, k)] as [
            FilterKey,
            string,
            ComparisonIdentity[]
          ]
      )
    ],
    [data]
  )
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Cost · speed · quality</p>
          <h1>Compare the work</h1>
          <p className="muted">Find useful differences, then inspect the runs that explain them.</p>
        </div>
        <div className="button-row">
          <span className="count-tag">
            {runs.length} runs · {slices.length} slices
          </span>
          <button
            className="primary"
            disabled={exportBusy || planBusy || dateError}
            onClick={exportComparison}
          >
            {exportBusy ? 'Exporting…' : 'Export comparison'}
          </button>
          <button disabled={planBusy || exportBusy} onClick={runComparisonPlan}>
            {planBusy ? 'Running plan…' : 'Run comparison plan'}
          </button>
        </div>
      </div>
      {exportError && (
        <p className="error" role="alert">
          {exportError}
        </p>
      )}
      {exportMessage && (
        <p className="success" role="status">
          {exportMessage}
        </p>
      )}
      <section className="panel filters">
        <div className="toolbar">
          <label>
            Group runs by
            <select
              aria-label="Group runs by"
              value={groupBy}
              onChange={(e) => {
                setGroupBy(e.target.value as GroupBy)
                setSelected(undefined)
              }}
            >
              {Object.entries(groupLabels).map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Order groups
            <select
              aria-label="Order groups"
              value={sort}
              onChange={(e) => setSort(e.target.value as ComparisonSort)}
            >
              <option value="label">Name</option>
              <option value="cost">Known cost, highest first</option>
              <option value="time">Known time, highest first</option>
            </select>
          </label>
          <button
            className="text-button"
            onClick={() => {
              setFilters({})
              setDateFrom('')
              setDateTo('')
              setIncludeUnknownDates(false)
              setOutcomeFilters({})
              setSelected(undefined)
            }}
          >
            Clear filters
          </button>
          <span className="muted">
            {Object.values(filters).filter((value) => value !== '' && value !== undefined).length +
              Object.keys(outcomeFilters).length +
              (dateFrom || dateTo ? 1 : 0)}{' '}
            active filters
          </span>
        </div>
        <details>
          <summary>Narrow the cohort</summary>
          <div className="filter-grid">
            {filterOptions.map(([key, label, options]) => {
              let missingKey = '__missing__'
              while (options.some((option) => option.key === missingKey)) missingKey += '_'
              return (
                <label key={key}>
                  {label}
                  <select
                    aria-label={`Filter ${label}`}
                    value={filters[key] === null ? missingKey : (filters[key] ?? '')}
                    onChange={(e) => {
                      setFilters({
                        ...filters,
                        [key]: e.target.value === missingKey ? null : e.target.value
                      })
                      setSelected(undefined)
                    }}
                  >
                    <option value="">All</option>
                    <option value={missingKey}>Unknown (not recorded)</option>
                    {options.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              )
            })}
          </div>
          <div className="filter-grid">
            <label>
              Run start from (UTC day)
              <input
                aria-label="Run start from (UTC day)"
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value)
                  setSelected(undefined)
                }}
              />
            </label>
            <label>
              Run start through (UTC day)
              <input
                aria-label="Run start through (UTC day)"
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value)
                  setSelected(undefined)
                }}
              />
            </label>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={includeUnknownDates}
                onChange={(e) => {
                  setIncludeUnknownDates(e.target.checked)
                  setSelected(undefined)
                }}
              />
              Include unknown run starts in date range
            </label>
          </div>
          {dateError && (
            <p role="alert" className="error">
              The start date must be on or before the end date. Correct the range before exporting.
            </p>
          )}
          <p className="muted">
            Date bounds include both UTC days and qualify matching runs; accepted lifecycle costs
            still include all relevant stages. Undated runs are excluded from a date range unless
            included explicitly.
          </p>
          <fieldset>
            <legend>Accepted outcome filters</legend>
            <p className="muted">
              Using any of these filters limits the entire cohort to accepted slices with matching
              full-lifecycle evidence. Repair burden means recorded repair cost, with incomplete
              evidence kept Unknown.
            </p>
            <div className="filter-grid">
              {(
                [
                  ['firstPass', 'First-pass acceptance', ['Yes', 'No', 'Unknown']],
                  ['repairPresence', 'Repair presence', ['Yes', 'No', 'Unknown']],
                  ['repairBurden', 'Repair cost burden', ['Zero', 'Positive', 'Unknown']]
                ] as const
              ).map(([key, label, options]) => (
                <label key={key}>
                  {label}
                  <select
                    aria-label={`Filter ${label}`}
                    value={outcomeFilters[key] ?? ''}
                    onChange={(e) => {
                      const next = { ...outcomeFilters }
                      if (e.target.value) Object.assign(next, { [key]: e.target.value })
                      else delete next[key]
                      setOutcomeFilters(next)
                      setSelected(undefined)
                    }}
                  >
                    <option value="">All</option>
                    {options.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="footnote">
            Not recorded in the current telemetry schema: technical stack tags, difficulty/coupling
            scores, evidence class, and explicit context-preparation state. These remain Unknown and
            have no inferred filters. Context mode, run result, runtime tested, ambiguity, and risk
            retain their own recorded meanings. Project is the recorded product/project field;
            runtime tested is not a QA pass verdict.
          </p>
        </details>
      </section>
      <section className="panel comparison-workspace" aria-label="Comparison workspace">
        <div className="section-heading">
          <div>
            <h2>Side-by-side configurations</h2>
            <p className="muted">
              Select 2–{MAX_COMPARISON_CANDIDATES} configurations. Columns follow selection order.
            </p>
          </div>
          <button onClick={() => setSelectedCandidates([])} disabled={!selectedCandidates.length}>
            Clear candidates
          </button>
        </div>
        <fieldset>
          <legend>
            Model Configurations · {selectedCandidates.length}/{MAX_COMPARISON_CANDIDATES} selected
          </legend>
          <div className="comparison-choices">
            {candidateOptions.map((option) => (
              <label key={option.key}>
                <input
                  type="checkbox"
                  value={option.key}
                  checked={selectedCandidates.includes(option.key)}
                  disabled={
                    !selectedCandidates.includes(option.key) &&
                    selectedCandidates.length >= MAX_COMPARISON_CANDIDATES
                  }
                  onChange={(event) =>
                    setSelectedCandidates(
                      event.target.checked
                        ? [...selectedCandidates, option.key]
                        : selectedCandidates.filter((key) => key !== option.key)
                    )
                  }
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          {!candidateOptions.length && <p className="muted">No configuration evidence recorded.</p>}
        </fieldset>
        <fieldset>
          <legend>Stage scope</legend>
          <p className="muted">
            Selected scopes match any one scope, together with all active filters. Recorded run
            types retain their exact text.
          </p>
          <div className="comparison-choices">
            {stageOptions.map((scope) => {
              const key = stageScopeKey(scope)
              const checked = stageScopes.some((selected) => stageScopeKey(selected) === key)
              return (
                <label key={key}>
                  <input
                    type="checkbox"
                    value={key}
                    checked={checked}
                    disabled={!checked && stageScopes.length >= MAX_COMPARISON_STAGE_SCOPES}
                    onChange={(event) => {
                      setStageScopes(
                        event.target.checked
                          ? [...stageScopes, scope]
                          : stageScopes.filter((selected) => stageScopeKey(selected) !== key)
                      )
                      setSelected(undefined)
                    }}
                  />
                  <span>{stageScopeLabel(scope)}</span>
                </label>
              )
            })}
          </div>
          <p className="comparison-scope">
            Active scope:{' '}
            {stageScopes.length
              ? stageScopes.map(stageScopeLabel).join(' OR ')
              : 'All runs (no stage scope)'}
          </p>
          {stageScopes.length > 0 && (
            <button
              onClick={() => {
                setStageScopes([])
                setSelected(undefined)
              }}
            >
              Clear stage scope
            </button>
          )}
        </fieldset>
        {candidates.length < 2 && (
          <p className="muted">
            Select {candidates.length ? 'one more configuration' : 'at least two configurations'} to
            compare observed evidence.
          </p>
        )}
        {candidates.length > 0 && (
          <>
            <p className="footnote">
              Known subtotals cover only recorded measurements. Lower coverage does not indicate
              lower cost or faster work. Scroll the table horizontally to inspect additional
              columns.
            </p>
            <div
              className="table-wrap candidate-table"
              role="region"
              aria-label="Selected candidate comparison"
              tabIndex={0}
            >
              <table>
                <caption>
                  Observed run evidence · {candidates.length} selected configurations
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Evidence</th>
                    {candidates.map((candidate) => (
                      <th scope="col" key={candidate.key}>
                        {candidate.label}
                        <small>
                          {candidate.runs.length} runs
                          {!candidate.runs.length ? ' / no evidence' : ''}
                        </small>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {candidateMetricRows.map(([label, render]) => (
                    <tr key={label}>
                      <th scope="row">{label}</th>
                      {candidates.map((candidate) => (
                        <td key={candidate.key}>{render(candidate)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {candidates.map((candidate) => (
              <details className="candidate-evidence" key={candidate.key}>
                <summary>
                  Inspect evidence · {candidate.label} · {candidate.runs.length} runs
                </summary>
                {!candidate.runs.length ? (
                  <p>No matching run evidence under the active filters and stage scope.</p>
                ) : (
                  <>
                    <RunTable runs={candidate.runs} onOpen={onOpenRun} />
                    <p>
                      Linked findings: {candidate.findings.length}. Linked discoveries:{' '}
                      {candidate.discoveries.length}. These record discovery attribution, not fault.
                    </p>
                    {candidate.findings.map((finding) => (
                      <p key={finding.id}>
                        {finding.id} · {finding.severity} · {finding.category} ·{' '}
                        {finding.status ?? 'Unknown status'}: {finding.description}
                      </p>
                    ))}
                    {candidate.discoveries.map((discovery) => (
                      <p key={discovery.id}>
                        {discovery.id} · Validation: {discovery.validation ?? 'Unknown'}:{' '}
                        {discovery.description}
                      </p>
                    ))}
                  </>
                )}
              </details>
            ))}
          </>
        )}
        <p className="footnote">
          Candidates partition the scoped observed runs. They do not change the base cohort or
          assign accepted-slice cost to a configuration. Reasoning is included in output and is
          never charged separately. Usage burn is recorded per run; weekly series and meter identity
          are unavailable. File/test counts are recorded numeric evidence; file lists, test names,
          and verification artifacts are unavailable.
        </p>
      </section>
      <div className="metrics">
        <Metric
          label="Known API-equivalent cost"
          value={summary.priced ? money(summary.cost) : 'Unknown'}
          detail={`${summary.priced}/${runs.length} runs priced`}
        />
        <Metric
          label="Recorded run time"
          value={summary.timed ? duration(summary.minutes) : 'Unknown'}
          detail={`${summary.timed}/${runs.length} runs timed · sum, not elapsed`}
        />
        <Metric
          label="Input served from cache"
          value={percent(summary.cacheRatio)}
          detail={`${summary.cacheKnown}/${runs.length} runs with cache data`}
        />
        <Metric
          label="Validated autonomous discoveries"
          value={discoveries.length}
          detail="Attributed to linked runs in this cohort"
        />
      </div>
      <AnalyticsWorkspace
        view={view}
        analyticsVersion={analyticsVersion}
        onSelectGroup={setSelected}
        onOpenRun={onOpenRun}
        onOpenSlice={onOpenSlice}
      />
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Run economics by {groupLabels[groupBy].toLowerCase()}</h2>
            <p className="muted">
              Cost bars show the known contribution of each role. Select a group to inspect its
              evidence.
            </p>
          </div>
        </div>
        {!groups.length ? (
          <Empty title="No runs to compare">
            Add runs to your slices or broaden the filters. One run is enough to begin.
          </Empty>
        ) : (
          <>
            <div className="legend">
              <span>
                <i className="implementer" />
                Implementation
              </span>
              <span>
                <i className="critic" />
                Critic
              </span>
              <span>
                <i className="repair" />
                Repair
              </span>
              <span>
                <i className="other" />
                Other roles
              </span>
            </div>
            <div className="comparison-bars">
              {groups.map((g) => (
                <button
                  key={g.key}
                  className={`bar-row ${selected === g.key ? 'selected' : ''}`}
                  aria-pressed={selected === g.key}
                  onClick={() => setSelected(selected === g.key ? undefined : g.key)}
                >
                  <span className="bar-label">
                    {g.label}
                    <small>
                      {g.stats.priced}/{g.runs.length} priced
                    </small>
                  </span>
                  <span className="bar-track">
                    {[
                      ['implementer', g.stats.implementationCost],
                      ['critic', g.stats.criticCost],
                      ['repair', g.stats.repairCost],
                      [
                        'other',
                        Math.max(
                          0,
                          g.stats.cost -
                            g.stats.implementationCost -
                            g.stats.criticCost -
                            g.stats.repairCost
                        )
                      ]
                    ].map(([name, value]) => (
                      <i
                        key={name}
                        className={String(name)}
                        style={{ width: `${knownMax ? (Number(value) / knownMax) * 100 : 0}%` }}
                      />
                    ))}
                  </span>
                  <strong>{g.stats.priced ? money(g.stats.cost) : 'Unknown'}</strong>
                </button>
              ))}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>Runs / priced</th>
                    <th>Mean priced run</th>
                    <th>Repair cost</th>
                    <th>Critic cost</th>
                    <th>Run time / timed</th>
                    <th>Cache ratio</th>
                    <th>Meter burn / known</th>
                    <th>P0 / P1 / P2 found</th>
                    <th>Validated discoveries</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => {
                    const found = g.findings.filter(
                      (f) => f.status !== 'Dismissed' && f.severity !== 'Observation'
                    )
                    return (
                      <tr key={g.key}>
                        <td>
                          <button className="record-link" onClick={() => setSelected(g.key)}>
                            {g.label}
                          </button>
                        </td>
                        <td>
                          {g.runs.length} / {g.stats.priced}
                        </td>
                        <td>{money(g.stats.priced ? g.stats.cost / g.stats.priced : null)}</td>
                        <td>
                          {money(g.repair.cost)}
                          <small>
                            {g.repair.priced}/{g.repair.total} priced
                          </small>
                        </td>
                        <td>
                          {money(g.critic.cost)}
                          <small>
                            {g.critic.priced}/{g.critic.total} priced
                          </small>
                        </td>
                        <td>
                          {g.stats.timed ? duration(g.stats.minutes) : 'Unknown'}
                          <small>
                            {g.stats.timed}/{g.runs.length}
                          </small>
                        </td>
                        <td>
                          {percent(g.stats.cacheRatio)}
                          <small>
                            {g.stats.cacheKnown}/{g.runs.length} known
                          </small>
                        </td>
                        <td>
                          {burnLabel(g.stats.burnKnown ? g.stats.burn : null)}
                          <small>
                            {g.stats.burnKnown}/{g.runs.length}
                          </small>
                        </td>
                        <td>
                          {['P0', 'P1', 'P2']
                            .map((sev) => found.filter((f) => f.severity === sev).length)
                            .join(' / ')}
                          <small>
                            {[...new Set(found.map((f) => f.category))].join(', ') ||
                              'No defects recorded'}
                          </small>
                        </td>
                        <td>{g.discoveries.length}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className="footnote">
          These are descriptive comparisons, not controlled experiments. Small samples, task mix,
          incomplete data, and grading differences matter. “Found” attributes discovery to the
          evaluating run; it does not assign fault to that model. All role subtotals use known costs
          only. Meter burn is in percentage points of remaining allowance consumed.
        </p>
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>{selectedGroup ? `Evidence · ${selectedGroup.label}` : 'Underlying runs'}</h2>
            <p className="muted">
              Open a run for its saved pricing, token counts, verification, and linked observations.
            </p>
          </div>
          {selectedGroup && <button onClick={() => setSelected(undefined)}>Show all groups</button>}
        </div>
        <RunTable runs={shownRuns} onOpen={onOpenRun} />
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Accepted slice economics</h2>
            <p className="muted">
              Run filters and stage scope qualify slices for this cohort. Each qualifying slice
              retains its full relevant lifecycle across models and roles, including critic and
              repair costs.
            </p>
          </div>
        </div>
        {!accepted.length ? (
          <Empty title="No accepted slices in this cohort">
            Set a slice’s disposition, acceptance time, quality grade, and preference when its work
            is accepted.
          </Empty>
        ) : (
          <div
            className="table-wrap candidate-table"
            role="region"
            aria-label="Accepted outcome comparison"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th>Accepted slice / workflow</th>
                  <th>Cost to accepted</th>
                  <th>Lifecycle wall time</th>
                  <th>Time to accepted</th>
                  <th>First-pass acceptance</th>
                  <th>Repair burden</th>
                  <th>Runtime QA evidence</th>
                </tr>
              </thead>
              <tbody>
                {accepted.map((economics) => {
                  const { slice: s, metrics, outcome } = economics
                  return (
                    <tr key={s.id}>
                      <th scope="row">
                        <button className="record-link" onClick={() => onOpenSlice(s.id)}>
                          {s.title}
                        </button>
                        <small>
                          {s.productionModel ?? 'Unknown workflow'} · {s.ambiguity ?? 'Unknown'}{' '}
                          ambiguity
                        </small>
                        <small>1 accepted outcome · {metrics.runCount} recorded runs</small>
                        <small>Quality: {qualityLabel(s.qualityGrade)}</small>
                        <small>Preferred: {s.preferredCandidate ?? 'No preference'}</small>
                      </th>
                      <td>{measurement(metrics.costUSD, money)}</td>
                      <td>
                        {measurement(metrics.wallMinutes, duration)}
                        <small>Sum of recorded run time</small>
                      </td>
                      <td>
                        {duration(economics.elapsedMinutes)}
                        <small>
                          {s.timeToAcceptedMinutes !== undefined
                            ? 'Operator measured'
                            : economics.elapsedMinutes !== null
                              ? 'First recorded start to acceptance'
                              : 'Unknown elapsed time'}
                        </small>
                        <small>
                          {outcome.acceptanceWindow.completeTiming
                            ? 'Recorded timing complete'
                            : 'Timing incomplete'}
                          {!s.acceptedAt ? ' · no acceptance cutoff' : ''}
                        </small>
                        {s.acceptedAt && (
                          <small>
                            <time dateTime={s.acceptedAt}>{displayTimestamp(s.acceptedAt)}</time>
                          </small>
                        )}
                      </td>
                      <td>
                        {outcome.firstPassAcceptance.state}
                        <small>
                          {outcome.firstPassAcceptance.state === 'Yes'
                            ? 'Implementation accepted directly'
                            : outcome.firstPassAcceptance.state === 'No'
                              ? 'Repair recorded or required'
                              : 'Insufficient acceptance evidence'}
                        </small>
                      </td>
                      <td>
                        {outcome.repair.recordedRunCount} recorded repair runs
                        <small>Repair cost: {measurement(outcome.repair.costUSD, money)}</small>
                        <small>
                          Repair / implementation:{' '}
                          {percent(outcome.repair.toImplementationCostRatio)}
                        </small>
                        {!outcome.repair.recordedRunCount &&
                          outcome.firstPassAcceptance.state !== 'Yes' && (
                            <small>Total repairs: Unknown</small>
                          )}
                      </td>
                      <td>
                        {counts(metrics.evidence.runtimeTested)}
                        <small>Recorded runtime tested; no separate QA verdict</small>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted">
          Sample count: {accepted.length} accepted outcomes. Coverage below describes recorded
          evidence; unrecorded lifecycle work cannot be counted.
        </p>
        {accepted.map((economics) => {
          const { slice, metrics, outcome } = economics
          return (
            <details key={slice.id} className="candidate-evidence">
              <summary>
                Inspect lifecycle · {slice.title} · {metrics.runCount} runs
              </summary>
              <p className="muted">
                {outcome.evidenceGaps.join(' ') ||
                  'Acceptance, implementation, timestamps, and results are recorded.'}{' '}
                Missing stages are Unknown; stage names below are exact recorded run types with
                their structured roles.
              </p>
              <p>
                First-pass acceptance: {outcome.firstPassAcceptance.state}.{' '}
                {outcome.firstPassAcceptance.basis}
              </p>
              <div className="table-wrap">
                <table aria-label={`Lifecycle totals · ${slice.title}`}>
                  <thead>
                    <tr>
                      <th>Fresh input tokens</th>
                      <th>Cached input tokens</th>
                      <th>Output tokens</th>
                      <th>Reasoning within output</th>
                      <th>Reasoning share</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {(
                        [
                          'inputTokens',
                          'cachedInputTokens',
                          'outputTokens',
                          'reasoningTokens'
                        ] as const
                      ).map((key) => (
                        <td key={key}>{measurement(metrics.evidence.numeric[key])}</td>
                      ))}
                      <td>
                        {percent(outcome.reasoningShare.ratio)}
                        <small>
                          {outcome.reasoningShare.knownRuns}/{outcome.reasoningShare.totalRuns}{' '}
                          paired runs{outcome.reasoningShare.complete ? '' : ' · incomplete'}
                        </small>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="table-wrap">
                <table aria-label={`Lifecycle stages · ${slice.title}`}>
                  <thead>
                    <tr>
                      <th>Recorded stage / role</th>
                      <th>Runs</th>
                      <th>Cost</th>
                      <th>Wall time</th>
                      <th>Runtime tested</th>
                      <th>Results</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outcome.stages.map((stage) => (
                      <tr key={JSON.stringify([stage.role, stage.runType])}>
                        <td>
                          {stage.runType}
                          <small>Role: {stage.role}</small>
                        </td>
                        <td>{stage.runCount}</td>
                        <td>{measurement(stage.costUSD, money)}</td>
                        <td>{measurement(stage.wallMinutes, duration)}</td>
                        <td>{counts(stage.evidence.runtimeTested)}</td>
                        <td>{counts(stage.evidence.result)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>
                Defect evidence:{' '}
                {(['P0', 'P1', 'P2'] as const)
                  .map((severity) => `${severity}: ${economics.defects.bySeverity[severity]}`)
                  .join(' · ')}
                . Validated discoveries: {economics.discoveries.length}. Categories:{' '}
                {Object.entries(economics.defects.byCategory)
                  .filter(([, count]) => count > 0)
                  .map(([category]) => category)
                  .join(', ') || 'None recorded'}
                .
              </p>
              <RunTable runs={economics.lifecycle} onOpen={onOpenRun} />
            </details>
          )
        })}
        <p className="footnote">
          Acceptance costs include all candidates and overhead up to the acceptance timestamp, plus
          undated runs. Runs after acceptance are excluded when dated. Findings and discoveries show
          the entire slice’s evidence, including later evaluation. No inferred quality score is
          imposed. Reasoning tokens are included in output and never billed separately. Repair
          counts count recorded runs and explicit repair links, not inferred cycles. No repair rows
          alone do not establish first-pass acceptance. Runtime-tested Yes/No counts preserve
          missing values as Unknown and do not assert operator acceptance or a passing runtime
          result.
        </p>
      </section>
    </>
  )
}

function measurement(
  value: MeasuredTotal,
  format: (value: number | null) => string = (v) =>
    v === null ? 'Unknown' : v.toLocaleString('en-US')
): React.JSX.Element {
  return (
    <>
      {format(value.knownTotal)}
      <small>
        {value.recorded}/{value.total} recorded{value.complete ? '' : ' · incomplete'}
      </small>
    </>
  )
}
function counts(value: RecordedCounts): React.JSX.Element {
  return (
    <>
      {value.recorded
        ? value.counts
            .map(
              ({ value, count }) =>
                `${typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value}: ${count}`
            )
            .join(' · ')
        : 'Unknown'}
      <small>
        {value.recorded}/{value.total} recorded{value.complete ? '' : ' · incomplete'}
      </small>
    </>
  )
}
const candidateMetricRows: [string, (candidate: ComparisonCandidate) => React.ReactNode][] = [
  ['Sample / run count', (c) => (c.runs.length ? `${c.runs.length} runs` : '0 runs / no evidence')],
  ['API-equivalent cost (known total)', (c) => measurement(c.metrics.costUSD, money)],
  [
    'Mean API-equivalent cost (priced runs)',
    (c) => (
      <>
        {money(c.metrics.meanPricedRunCostUSD)}
        <small>
          {c.metrics.costUSD.recorded}/{c.runs.length} priced
        </small>
      </>
    )
  ],
  ['Wall time (summed)', (c) => measurement(c.metrics.wallMinutes, duration)],
  ...(Object.entries(numericEvidenceLabels) as [keyof typeof numericEvidenceLabels, string][]).map(
    ([key, label]): [string, (c: ComparisonCandidate) => React.ReactNode] => [
      label,
      (c) => measurement(c.metrics.evidence.numeric[key])
    ]
  ),
  [
    'Cache ratio (token weighted)',
    (c) => (
      <>
        {percent(c.metrics.cache.ratio)}
        <small>
          {c.metrics.cache.knownRuns}/{c.runs.length} input pairs recorded
          {c.metrics.cache.ratio === null ? ' · denominator unknown or zero' : ''}
        </small>
      </>
    )
  ],
  [
    'Usage burn (percentage points)',
    (c) => measurement(c.metrics.usageBurnPercentagePoints, burnLabel)
  ],
  ['Build result', (c) => counts(c.metrics.evidence.buildResult)],
  ['Runtime tested', (c) => counts(c.metrics.evidence.runtimeTested)],
  ['Run result', (c) => counts(c.metrics.evidence.result)],
  ['Recorded roles / repair evidence', (c) => counts(c.metrics.evidence.role)],
  ['Touched slice dispositions (not attributed)', (c) => counts(c.sliceDispositions)],
  [
    'Linked findings / discoveries',
    (c) =>
      c.runs.length ? `${c.findings.length} / ${c.discoveries.length} recorded` : 'No run evidence'
  ]
]
