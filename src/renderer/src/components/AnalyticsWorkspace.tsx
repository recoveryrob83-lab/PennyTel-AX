import { memo } from 'react'
import type { ComparisonView } from '../../../shared/comparison'
import type { Distribution } from '../../../shared/analytics'
import type { Run } from '../../../shared/types'
import { duration, money, percent, type MeasuredTotal } from '../../../shared/metrics'

type Props = {
  view: ComparisonView
  analyticsVersion: object
  onSelectGroup: (key: string) => void
  onOpenRun: (run: Run) => void
  onOpenSlice: (id: string) => void
}
const coverage = (m: MeasuredTotal): string =>
  `${m.recorded}/${m.total} recorded${m.complete ? '' : ' · incomplete'}`
const known = (m: MeasuredTotal, format = money): string =>
  `${format(m.knownTotal)} · ${coverage(m)}`

function Statistics({
  value,
  format
}: {
  value: Distribution
  format: (v: number | null) => string
}): React.JSX.Element {
  return (
    <>
      Mean {format(value.mean)} · median {format(value.median)}
      <small>
        {value.knownCount}/{value.sampleCount} known · {value.unknownCount} Unknown
      </small>
      <small>
        Range {format(value.min)}–{format(value.max)} · sample SD{' '}
        {format(value.sampleStandardDeviation)}
      </small>
    </>
  )
}

function Bar({
  values,
  max
}: {
  values: { value: number | null; style: string }[]
  max: number
}): React.JSX.Element {
  return (
    <span className="analytics-track" aria-hidden="true">
      {values.map((part, i) => (
        <i
          key={i}
          className={part.style}
          style={{ width: `${max > 0 ? (Math.max(0, part.value ?? 0) / max) * 100 : 0}%` }}
        />
      ))}
    </span>
  )
}
type Point = { key: string; label: string; x: number; y: number; open: () => void }
function Scatter({
  title,
  points,
  total,
  xLabel,
  yLabel,
  xFormat,
  yFormat
}: {
  title: string
  points: Point[]
  total: number
  xLabel: string
  yLabel: string
  xFormat: (v: number | null) => string
  yFormat: (v: number | null) => string
}): React.JSX.Element {
  const maxX = Math.max(0, ...points.map((p) => p.x))
  const maxY = Math.max(0, ...points.map((p) => p.y))
  return (
    <section className="analytics-chart" aria-label={title}>
      <h3>{title}</h3>
      <p className="muted">
        {points.length}/{total} paired samples · {total - points.length} omitted for Unknown
        evidence. Select a point to inspect its source. Overlapping points may share a position.
      </p>
      {!points.length ? (
        <p>No paired evidence to plot.</p>
      ) : (
        <svg viewBox="0 0 620 260" aria-label={`${title} plot`} role="group">
          <path d="M75 20V210H600" className="analytics-axis" />
          <text x="72" y="228">
            0
          </text>
          <text x="595" y="228" textAnchor="end">
            {xFormat(maxX)}
          </text>
          <text x="69" y="24" textAnchor="end">
            {yFormat(maxY)}
          </text>
          <text x="69" y="210" textAnchor="end">
            0
          </text>
          <text x="335" y="251" textAnchor="middle">
            {xLabel}
          </text>
          <text x="8" y="125" transform="rotate(-90 8 125)" textAnchor="middle">
            {yLabel}
          </text>
          {points.map((point) => (
            <circle
              key={point.key}
              cx={75 + (point.x / (maxX || 1)) * 515}
              cy={210 - (point.y / (maxY || 1)) * 180}
              r="6"
              role="button"
              tabIndex={0}
              aria-label={`Inspect ${point.label}: ${xFormat(point.x)}, ${yFormat(point.y)}`}
              onClick={point.open}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  point.open()
                }
              }}
            >
              <title>
                {point.label}: {xFormat(point.x)}, {yFormat(point.y)}
              </title>
            </circle>
          ))}
        </svg>
      )}
      {points.length > 0 && (
        <details>
          <summary>Inspect plotted samples</summary>
          <ul>
            {points.map((p) => (
              <li key={p.key}>
                <button className="record-link" onClick={p.open}>
                  {p.label}
                </button>{' '}
                · {xFormat(p.x)} · {yFormat(p.y)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

export const AnalyticsWorkspace = memo(
  function AnalyticsWorkspace({
    view,
    onSelectGroup,
    onOpenRun,
    onOpenSlice
  }: Props): React.JSX.Element {
    const { analytics, groups, acceptedAnalytics: accepted, temporal } = view
    const costMax = Math.max(0, ...groups.map((g) => g.stats.cost))
    const timeMax = Math.max(0, ...groups.map((g) => g.analytics.wallMinutes.mean ?? 0))
    const outcomeMax = Math.max(
      0,
      ...accepted.outcomes.flatMap((o) => [
        o.acceptedCostUSD.knownTotal ?? 0,
        o.implementationCostUSD.knownTotal ?? 0
      ])
    )
    const stageMax = Math.max(0, ...accepted.stages.map((s) => s.costUSD.knownTotal ?? 0))
    const trendMax = Math.max(0, ...temporal.days.map((day) => day.costUSD.mean ?? 0))
    return (
      <section className="panel analytics-workspace" aria-label="Analytics workspace">
        <h2>Comparison analytics</h2>
        <p className="muted">
          Current cohort: {analytics.sampleCount} runs · {view.slices.length} slices ·{' '}
          {accepted.sampleCount} accepted outcomes. Candidate columns and evidence-group selection
          do not narrow these charts. All values follow the active filters and stage scope.
        </p>
        <p className="footnote">
          Descriptive evidence only: sample sizes, missing measurements, task mix, and operator
          grading affect comparisons. No confidence intervals, causal claims, or combined winner
          score. SD is sample standard deviation and is Unknown with fewer than two known samples.
        </p>
        <div className="table-wrap" role="region" aria-label="Analytics statistics" tabIndex={0}>
          <table>
            <caption>Known run distributions · select a group to inspect underlying runs</caption>
            <thead>
              <tr>
                <th>Scope / samples</th>
                <th>API-equivalent cost per run</th>
                <th>Wall minutes per run</th>
                <th>Reasoning within output</th>
              </tr>
            </thead>
            <tbody>
              {[{ key: '', label: 'All matching runs', analytics }, ...groups].map((group) => (
                <tr key={group.key}>
                  <th>
                    {group.key ? (
                      <button
                        className="record-link"
                        aria-label={`Inspect analytics group ${group.label}`}
                        onClick={() => onSelectGroup(group.key)}
                      >
                        {group.label}
                      </button>
                    ) : (
                      group.label
                    )}
                    <small>{group.analytics.sampleCount} runs</small>
                  </th>
                  <td>
                    <Statistics value={group.analytics.costUSD} format={money} />
                  </td>
                  <td>
                    <Statistics value={group.analytics.wallMinutes} format={duration} />
                  </td>
                  <td>
                    {percent(group.analytics.reasoningShare.ratio)}
                    <small>
                      {group.analytics.reasoningShare.knownRuns}/
                      {group.analytics.reasoningShare.totalRuns} paired runs
                      {group.analytics.reasoningShare.complete ? '' : ' · incomplete'}
                    </small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="analytics-grid">
          <section className="analytics-chart" aria-label="Cost composition">
            <h3>Cost composition by current group</h3>
            <p className="muted">
              Fresh input / cached input / output. The stack uses fully priced runs only and sums to
              known run cost. Reasoning is already inside output.
            </p>
            <div className="legend">
              <span>
                <i className="fresh-input" />
                Fresh input
              </span>
              <span>
                <i className="cached-input" />
                Cached input
              </span>
              <span>
                <i className="output-cost" />
                Output
              </span>
            </div>
            {!groups.length && <p>No matching cost evidence.</p>}
            {groups.map((group) => {
              const c = group.analytics.costComposition
              return (
                <div className="analytics-row" key={group.key}>
                  <strong>{group.label}</strong>
                  <Bar
                    max={costMax}
                    values={[
                      { value: c.freshInputUSD.knownTotal, style: 'fresh-input' },
                      { value: c.cachedInputUSD.knownTotal, style: 'cached-input' },
                      { value: c.outputUSD.knownTotal, style: 'output-cost' }
                    ]}
                  />
                  <small>
                    Fresh {money(c.freshInputUSD.knownTotal)} · cached{' '}
                    {money(c.cachedInputUSD.knownTotal)} · output {money(c.outputUSD.knownTotal)} ·{' '}
                    {coverage(c.outputUSD)}
                  </small>
                </div>
              )
            })}
          </section>
          <section className="analytics-chart" aria-label="Wall time and reasoning share">
            <h3>Wall time and reasoning share by current group</h3>
            <p className="muted">
              Mean known wall time uses timed runs; reasoning share uses paired token counts. These
              may cover different subsets.
            </p>
            {!groups.length && <p>No matching time or reasoning evidence.</p>}
            {groups.map((group) => (
              <div className="analytics-row" key={group.key}>
                <strong>{group.label}</strong>
                <Bar
                  max={timeMax}
                  values={[{ value: group.analytics.wallMinutes.mean, style: 'fresh-input' }]}
                />
                <small>
                  Mean wall time {duration(group.analytics.wallMinutes.mean)} ·{' '}
                  {group.analytics.wallMinutes.knownCount}/{group.runs.length} timed
                </small>
                <Bar
                  max={1}
                  values={[{ value: group.analytics.reasoningShare.ratio, style: 'output-cost' }]}
                />
                <small>
                  Reasoning share {percent(group.analytics.reasoningShare.ratio)} ·{' '}
                  {group.analytics.reasoningShare.knownRuns}/{group.runs.length} paired runs
                </small>
              </div>
            ))}
          </section>
          <Scatter
            title="Time versus cost"
            total={view.runs.length}
            xLabel="Cost (USD)"
            yLabel="Wall time"
            xFormat={money}
            yFormat={duration}
            points={temporal.timeCost.flatMap((point) =>
              point.costUSD === null || point.wallMinutes === null
                ? []
                : [
                    {
                      key: point.runId,
                      label: `run ${point.runId}`,
                      x: point.costUSD,
                      y: point.wallMinutes,
                      open: () => onOpenRun(view.runs.find((run) => run.id === point.runId)!)
                    }
                  ]
            )}
          />
          <section className="analytics-chart" aria-label="Cost trend by recorded date">
            <h3>Cost trend by recorded date</h3>
            <p className="muted">
              Mean run cost by recorded start in UTC. {temporal.undatedRunIds.length}/
              {view.runs.length} undated runs excluded. Missing days are not filled with zero.
            </p>
            {temporal.days.length < 2 && (
              <p>Fewer than two recorded days; no temporal trend established.</p>
            )}
            {temporal.days.map((day) => (
              <div className="analytics-row" key={day.date}>
                <strong>
                  {day.date} · {day.sampleCount} runs
                </strong>
                <Bar max={trendMax} values={[{ value: day.costUSD.mean, style: 'cached-input' }]} />
                <small>
                  Mean cost {money(day.costUSD.mean)} · {day.costUSD.knownCount}/{day.sampleCount}{' '}
                  priced; mean wall time {duration(day.wallMinutes.mean)} ·{' '}
                  {day.wallMinutes.knownCount}/{day.sampleCount} timed
                </small>
                <details>
                  <summary>Source runs for {day.date}</summary>
                  {day.runIds.map((id) => (
                    <button
                      className="record-link"
                      key={id}
                      onClick={() => onOpenRun(view.runs.find((run) => run.id === id)!)}
                    >
                      {id}
                    </button>
                  ))}
                </details>
              </div>
            ))}
          </section>
        </div>
        <h3>Accepted outcome aggregates</h3>
        <p className="muted">
          {accepted.sampleCount} accepted slices, each counted once. Full lifecycles are retained
          across models and stages after qualification. Outcome distributions use only complete
          recorded outcomes; known lifecycle cost also includes partial outcomes.
        </p>
        <div
          className="table-wrap"
          role="region"
          aria-label="Accepted aggregate statistics"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th>Known total accepted cost</th>
                <th>Cost per accepted outcome</th>
                <th>Wall time per accepted outcome</th>
                <th>Recorded repair burden</th>
                <th>Operator quality</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  {known(accepted.knownLifecycleCostUSD)}
                  <small>
                    Run coverage · {accepted.costUSD.knownCount}/{accepted.sampleCount} complete
                    outcome costs
                  </small>
                </td>
                <td>
                  <Statistics value={accepted.costUSD} format={money} />
                </td>
                <td>
                  <Statistics value={accepted.wallMinutes} format={duration} />
                  <small>Summed run durations per outcome, not elapsed time</small>
                </td>
                <td>
                  {accepted.repair.recordedRunCount} recorded repair runs
                  <small>Repair cost per outcome</small>
                  <Statistics value={accepted.repair.costUSD} format={money} />
                  <small>
                    Mean repair / implementation{' '}
                    {percent(accepted.repair.toImplementationCostRatio.mean)} ·{' '}
                    {accepted.repair.toImplementationCostRatio.knownCount}/{accepted.sampleCount}{' '}
                    known
                  </small>
                </td>
                <td>
                  {accepted.quality.graded}/{accepted.sampleCount} graded ·{' '}
                  {accepted.quality.ungraded} Unknown
                  <small>
                    {Object.entries(accepted.quality.byGrade)
                      .map(([grade, count]) => `${grade}: ${count}`)
                      .join(' · ')}
                  </small>
                  <small>Recorded operator judgments, 1–5</small>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <section className="analytics-chart" aria-label="First-pass acceptance distribution">
          <h3>First-pass acceptance / repair evidence</h3>
          <Bar
            max={accepted.sampleCount}
            values={[
              { value: accepted.firstPass.yes, style: 'cached-input' },
              { value: accepted.firstPass.no, style: 'output-cost' },
              { value: accepted.firstPass.unknown, style: 'unknown-evidence' }
            ]}
          />
          <p>
            Yes {accepted.firstPass.yes} · No (repair recorded or required) {accepted.firstPass.no}{' '}
            · Unknown {accepted.firstPass.unknown}. First-pass rate{' '}
            {percent(accepted.firstPass.rate)} · {accepted.firstPass.determinable}/
            {accepted.sampleCount} determinable outcomes.
          </p>
          <p className="muted">
            No repair rows alone do not establish first-pass acceptance or zero repair burden.
          </p>
        </section>
        <div className="analytics-grid">
          <section className="analytics-chart" aria-label="Implementation versus accepted cost">
            <h3>Implementation versus accepted-outcome cost</h3>
            <p className="muted">
              Paired bars share a cost scale. Implementation excludes explicitly linked repair runs;
              accepted cost includes the full recorded lifecycle. Partial bars are known subtotals.
            </p>
            {!accepted.outcomes.length && <p>No qualifying accepted outcomes.</p>}
            {accepted.outcomes.map((outcome) => (
              <div className="analytics-row" key={outcome.sliceId}>
                <button className="record-link" onClick={() => onOpenSlice(outcome.sliceId)}>
                  {outcome.title}
                </button>
                <Bar
                  max={outcomeMax}
                  values={[
                    { value: outcome.implementationCostUSD.knownTotal, style: 'fresh-input' }
                  ]}
                />
                <small>Implementation {known(outcome.implementationCostUSD)}</small>
                <Bar
                  max={outcomeMax}
                  values={[{ value: outcome.acceptedCostUSD.knownTotal, style: 'cached-input' }]}
                />
                <small>Accepted {known(outcome.acceptedCostUSD)}</small>
              </div>
            ))}
          </section>
          <section className="analytics-chart" aria-label="Accepted lifecycle stage composition">
            <h3>Accepted lifecycle / stage composition</h3>
            <p className="muted">
              Exact recorded stage and role, summed across qualifying accepted slices. Absent stages
              are not evidence of zero work.
            </p>
            {!accepted.stages.length && <p>No recorded lifecycle stages.</p>}
            {accepted.stages.map((stage) => (
              <div className="analytics-row" key={stage.key}>
                <strong>
                  {stage.runType} · {stage.role}
                </strong>
                <Bar
                  max={stageMax}
                  values={[{ value: stage.costUSD.knownTotal, style: 'output-cost' }]}
                />
                <small>
                  Cost {known(stage.costUSD)} · wall time {known(stage.wallMinutes, duration)}
                </small>
              </div>
            ))}
          </section>
          <Scatter
            title="Operator quality versus accepted cost"
            total={accepted.sampleCount}
            xLabel="Full recorded accepted cost (USD)"
            yLabel="Operator quality (1–5)"
            xFormat={money}
            yFormat={(v) => (v === null ? 'Unknown' : String(v))}
            points={accepted.outcomes.flatMap((outcome) =>
              outcome.qualityGrade === null || outcome.acceptedCostUSD.completeTotal === null
                ? []
                : [
                    {
                      key: outcome.sliceId,
                      label: `outcome ${outcome.title}`,
                      x: outcome.acceptedCostUSD.completeTotal,
                      y: outcome.qualityGrade,
                      open: () => onOpenSlice(outcome.sliceId)
                    }
                  ]
            )}
          />
        </div>
        <p className="footnote">
          Source runs are available through the group evidence table, plotted samples, dated source
          lists, and per-outcome lifecycle details below. Comparison export carries these chart
          inputs, source IDs, filter state, and coverage. Quality points describe whole outcomes and
          do not attribute quality to one model.
        </p>
      </section>
    )
  },
  (previous, next) =>
    previous.analyticsVersion === next.analyticsVersion &&
    previous.onSelectGroup === next.onSelectGroup &&
    previous.onOpenRun === next.onOpenRun &&
    previous.onOpenSlice === next.onOpenSlice
)
