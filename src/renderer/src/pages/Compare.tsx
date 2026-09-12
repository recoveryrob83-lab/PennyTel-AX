import { useState } from 'react'
import type { Dataset, Run, Slice } from '../../../shared/types'
import {
  acceptanceRuns,
  duration,
  groupLabels,
  groupRuns,
  money,
  percent,
  summarize,
  roleSummary,
  timeToAccepted,
  validatedDiscovery,
  type GroupBy
} from '../../../shared/metrics'
import { Empty, Metric } from '../components/ui'
import { RunTable } from '../components/RunTable'

interface Props {
  data: Dataset
  onOpenRun: (run: Run) => void
  onOpenSlice: (id: string) => void
}
export function Compare({ data, onOpenRun, onOpenSlice }: Props): React.JSX.Element {
  const [groupBy, setGroupBy] = useState<GroupBy>('model')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<string>()
  const [sort, setSort] = useState('label')
  const sliceKeys: (keyof Slice)[] = [
    'project',
    'taskShape',
    'ambiguity',
    'risk',
    'productionModel',
    'experiment',
    'disposition'
  ]
  const runKeys: (keyof Run)[] = ['model', 'thinking', 'role', 'sessionMode', 'contextMode']
  const slices = data.slices.filter((s) =>
    sliceKeys.every((k) => !filters[k] || s[k] === filters[k])
  )
  const runs = data.runs.filter(
    (r) =>
      slices.some((s) => s.id === r.sliceId) &&
      runKeys.every((k) => !filters[k] || r[k] === filters[k])
  )
  const summary = summarize(runs)
  const groups = groupRuns(data, runs, groupBy)
    .map((group) => ({
      ...group,
      stats: summarize(group.runs),
      repair: roleSummary(group.runs, 'Repair'),
      critic: roleSummary(group.runs, 'Critic')
    }))
    .sort((a, b) =>
      sort === 'cost'
        ? b.stats.cost - a.stats.cost
        : sort === 'time'
          ? b.stats.minutes - a.stats.minutes
          : a.label.localeCompare(b.label)
    )
  const selectedGroup = groups.find((g) => g.key === selected)
  const shownRuns = selectedGroup?.runs ?? runs
  const knownMax = Math.max(...groups.map((g) => g.stats.cost), 0)
  const discoveries = data.discoveries.filter(
    (d) => d.runId && runs.some((r) => r.id === d.runId) && validatedDiscovery(d)
  )
  const filterOptions: [string, string, string[]][] = [
    ...sliceKeys.map(
      (k) =>
        [
          k,
          {
            project: 'Project',
            taskShape: 'Task shape',
            ambiguity: 'Ambiguity',
            risk: 'Risk',
            productionModel: 'Workflow',
            experiment: 'Study',
            disposition: 'Slice disposition'
          }[k] ?? k,
          [...new Set(data.slices.map((s) => String(s[k] ?? '')).filter(Boolean))].sort()
        ] as [string, string, string[]]
    ),
    ...runKeys.map(
      (k) =>
        [
          k,
          groupLabels[k as GroupBy] ?? k,
          [...new Set(data.runs.map((r) => String(r[k] ?? '')).filter(Boolean))].sort()
        ] as [string, string, string[]]
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
        <span className="count-tag">
          {runs.length} runs · {slices.length} slices
        </span>
      </div>
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
              onChange={(e) => setSort(e.target.value)}
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
                    const found = data.findings.filter(
                      (f) =>
                        f.runId && g.runs.some((r) => r.id === f.runId) && f.status !== 'Dismissed'
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
                          {g.stats.burnKnown ? g.stats.burn : 'Unknown'}
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
                        <td>
                          {discoveries.filter((d) => g.runs.some((r) => r.id === d.runId)).length}
                        </td>
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
          only. Meter units must be consistent to compare burn.
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
              Complete production cost across all models and roles. Uses slice filters above; run
              filters do not remove downstream work.
            </p>
          </div>
        </div>
        {!slices.some((s) => s.disposition === 'Accepted') ? (
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
                {slices
                  .filter((s) => s.disposition === 'Accepted')
                  .map((s) => {
                    const lifecycle = acceptanceRuns(
                        s,
                        data.runs.filter((r) => r.sliceId === s.id)
                      ),
                      stats = summarize(lifecycle)
                    const defects = data.findings.filter(
                      (f) =>
                        f.sliceId === s.id &&
                        f.severity !== 'Observation' &&
                        f.status !== 'Dismissed'
                    )
                    const repairRatio =
                      stats.priced === stats.total && stats.implementationCost > 0
                        ? stats.repairCost / stats.implementationCost
                        : null
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
                          <small>Quality: {s.qualityGrade ?? 'Ungraded'}</small>
                        </td>
                        <td>
                          {stats.priced ? money(stats.cost) : 'Unknown'}
                          <small>
                            {stats.priced}/{stats.total} priced
                            {stats.priced < stats.total ? ' · incomplete' : ''}
                            {!s.acceptedAt ? ' · all runs (no cutoff)' : ''}
                          </small>
                        </td>
                        <td>{duration(timeToAccepted(s, lifecycle))}</td>
                        <td>
                          {money(roleSummary(lifecycle, 'Repair').cost)} /{' '}
                          {money(roleSummary(lifecycle, 'Critic').cost)}
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
                        <td>
                          {
                            data.discoveries.filter(
                              (d) => d.sliceId === s.id && validatedDiscovery(d)
                            ).length
                          }
                        </td>
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
