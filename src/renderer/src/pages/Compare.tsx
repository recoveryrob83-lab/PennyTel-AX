import { useState } from 'react'
import type { Dataset, Run } from '../../../shared/types'
import {
  compareData,
  runFilterLabels,
  sliceFilterLabels,
  type ComparisonFilters,
  type ComparisonSort,
  type FilterKey
} from '../../../shared/comparison'
import { burnLabel, displayTimestamp, qualityLabel } from '../../../shared/presentation'
import { duration, groupLabels, money, percent, type GroupBy } from '../../../shared/metrics'
import { Empty, Metric } from '../components/ui'
import { RunTable } from '../components/RunTable'

interface Props {
  data: Dataset
  onOpenRun: (run: Run) => void
  onOpenSlice: (id: string) => void
}
export function Compare({ data, onOpenRun, onOpenSlice }: Props): React.JSX.Element {
  const [groupBy, setGroupBy] = useState<GroupBy>('model')
  const [filters, setFilters] = useState<ComparisonFilters>({})
  const [selected, setSelected] = useState<string>()
  const [sort, setSort] = useState<ComparisonSort>('label')
  const [exportBusy, setExportBusy] = useState(false)
  const [exportError, setExportError] = useState('')
  const [exportMessage, setExportMessage] = useState('')
  const context = { filters, groupBy, sort, ...(selected ? { selectedGroup: selected } : {}) }
  const { slices, runs, summary, groups, selectedGroup, shownRuns, discoveries, accepted } =
    compareData(data, context)
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
  const sliceKeys = Object.keys(sliceFilterLabels) as (keyof typeof sliceFilterLabels)[]
  const runKeys = Object.keys(runFilterLabels) as (keyof typeof runFilterLabels)[]
  const knownMax = Math.max(...groups.map((g) => g.stats.cost), 0)
  const filterOptions: [FilterKey, string, string[]][] = [
    ...sliceKeys.map(
      (k) =>
        [
          k,
          sliceFilterLabels[k],
          [...new Set(data.slices.map((s) => String(s[k] ?? '')).filter(Boolean))].sort()
        ] as [FilterKey, string, string[]]
    ),
    ...runKeys.map(
      (k) =>
        [
          k,
          runFilterLabels[k],
          [...new Set(data.runs.map((r) => String(r[k] ?? '')).filter(Boolean))].sort()
        ] as [FilterKey, string, string[]]
    )
  ]
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
          <button className="primary" disabled={exportBusy} onClick={exportComparison}>
            {exportBusy ? 'Exporting…' : 'Export comparison'}
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
              setSelected(undefined)
            }}
          >
            Clear filters
          </button>
          <span className="muted">
            {Object.values(filters).filter(Boolean).length} active filters
          </span>
        </div>
        <details>
          <summary>Narrow the cohort</summary>
          <div className="filter-grid">
            {filterOptions.map(([key, label, options]) => (
              <label key={key}>
                {label}
                <select
                  aria-label={`Filter ${label}`}
                  value={filters[key] ?? ''}
                  onChange={(e) => {
                    setFilters({ ...filters, [key]: e.target.value })
                    setSelected(undefined)
                  }}
                >
                  <option value="">All</option>
                  {options.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </details>
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
              Run filters qualify slices for this cohort. Each qualifying slice retains its full
              relevant lifecycle across models and roles, including critic and repair costs.
            </p>
          </div>
        </div>
        {!accepted.length ? (
          <Empty title="No accepted slices in this cohort">
            Set a slice’s disposition, acceptance time, quality grade, and preference when its work
            is accepted.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Accepted slice / workflow</th>
                  <th>Preferred / quality</th>
                  <th>Cost to accepted</th>
                  <th>Time to accepted</th>
                  <th>Repair / critic</th>
                  <th>Repair passes</th>
                  <th>Defect evidence</th>
                  <th>Validated discoveries</th>
                </tr>
              </thead>
              <tbody>
                {accepted.map((economics) => {
                  const { slice: s, stats, repair, critic, repairRatio } = economics
                  const defects = economics.findings.filter(
                    (f) => f.severity !== 'Observation' && f.status !== 'Dismissed'
                  )
                  return (
                    <tr key={s.id}>
                      <td>
                        <button className="record-link" onClick={() => onOpenSlice(s.id)}>
                          {s.title}
                        </button>
                        <small>
                          {s.productionModel ?? 'Unknown workflow'} · {s.ambiguity ?? 'Unknown'}{' '}
                          ambiguity
                        </small>
                      </td>
                      <td>
                        {s.preferredCandidate ?? 'No preference'}
                        <small>Quality: {qualityLabel(s.qualityGrade)}</small>
                      </td>
                      <td>
                        {stats.priced ? money(stats.cost) : 'Unknown'}
                        <small>
                          {stats.priced}/{stats.total} priced
                          {stats.priced < stats.total ? ' · incomplete' : ''}
                          {!s.acceptedAt ? ' · all runs (no cutoff)' : ''}
                        </small>
                      </td>
                      <td>
                        {duration(economics.elapsedMinutes)}
                        {s.acceptedAt && (
                          <small>
                            <time dateTime={s.acceptedAt}>{displayTimestamp(s.acceptedAt)}</time>
                          </small>
                        )}
                      </td>
                      <td>
                        {money(repair.cost)} / {money(critic.cost)}
                        <small>Repair / implementation: {percent(repairRatio)}</small>
                      </td>
                      <td>{stats.repairRuns}</td>
                      <td>
                        {['P0', 'P1', 'P2']
                          .map(
                            (sev) => `${sev}: ${defects.filter((f) => f.severity === sev).length}`
                          )
                          .join(' · ')}
                        <small>
                          {[...new Set(defects.map((f) => f.category))].join(', ') ||
                            'None recorded'}
                        </small>
                      </td>
                      <td>{economics.discoveries.length}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="footnote">
          Acceptance costs include all candidates and overhead up to the acceptance timestamp, plus
          undated runs. Runs after acceptance are excluded when dated. Findings and discoveries show
          the entire slice’s evidence, including later evaluation. No inferred quality score is
          imposed.
        </p>
      </section>
    </>
  )
}
