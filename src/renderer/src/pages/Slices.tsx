import { useState } from 'react'
import { burnLabel, displayTimestamp, qualityLabel } from '../../../shared/presentation'
import type { Dataset, Entity, Run, Slice, Table } from '../../../shared/types'
import {
  acceptanceRuns,
  duration,
  money,
  summarize,
  roleSummary,
  timeToAccepted,
  validatedDiscovery
} from '../../../shared/metrics'
import { Badge, Empty, Metric, RecordDetails } from '../components/ui'
import { RunTable } from '../components/RunTable'

interface Props {
  data: Dataset
  selectedId?: string
  onSelect: (id?: string) => void
  onEdit: (table: Table, record?: Entity, sliceId?: string) => void
  onOpenRun: (run: Run) => void
  onDelete: (table: Table, record: Entity) => void
}
export function Slices({
  data,
  selectedId,
  onSelect,
  onEdit,
  onOpenRun,
  onDelete
}: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [disposition, setDisposition] = useState('')
  const slice = data.slices.find((s) => s.id === selectedId)
  const filtered = data.slices
    .filter(
      (s) =>
        (!disposition || s.disposition === disposition) &&
        [s.title, s.id, s.project, s.taskShape, s.experiment].some((v) =>
          v?.toLowerCase().includes(query.toLowerCase())
        )
    )
    .slice()
    .reverse()
  if (slice)
    return <SliceDetail slice={slice} {...{ data, onSelect, onEdit, onOpenRun, onDelete }} />
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Work, with evidence</p>
          <h1>Slice notebook</h1>
          <p className="muted">Follow bounded work from its first run to the accepted result.</p>
        </div>
        <button className="primary" onClick={() => onEdit('slices')}>
          + New slice
        </button>
      </div>
      <div className="toolbar">
        <label className="search">
          <span className="sr-only">Search slices</span>
          <input
            placeholder="Search title, project, task shape, study…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Filter disposition</span>
          <select value={disposition} onChange={(e) => setDisposition(e.target.value)}>
            <option value="">All dispositions</option>
            {['In progress', 'Accepted', 'Rejected', 'Abandoned'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <span className="muted">{filtered.length} slices</span>
      </div>
      {!filtered.length ? (
        <Empty
          title={data.slices.length ? 'No matching slices' : 'Start with a piece of work'}
          action={
            !data.slices.length && (
              <button className="primary" onClick={() => onEdit('slices')}>
                Create your first slice
              </button>
            )
          }
        >
          {data.slices.length
            ? 'Try another search or disposition.'
            : 'Create a slice, then add the runs, findings, and discoveries that explain the outcome. Your notebook starts empty; all telemetry comes from you.'}
        </Empty>
      ) : (
        <div className="slice-grid">
          {filtered.map((s) => {
            const runs = data.runs.filter((r) => r.sliceId === s.id),
              summary = summarize(runs)
            const findings = data.findings.filter(
              (f) => f.sliceId === s.id && f.severity !== 'Observation' && f.status !== 'Dismissed'
            )
            return (
              <button className="slice-card" key={s.id} onClick={() => onSelect(s.id)}>
                <div className="card-top">
                  <span>{s.project ?? 'No project'}</span>
                  <Badge>{s.disposition}</Badge>
                </div>
                <h2>{s.title}</h2>
                <p>
                  {s.taskShape ?? 'Task shape not recorded'} ·{' '}
                  {s.productionModel ?? 'Workflow unknown'}
                </p>
                <div className="card-stats">
                  <div>
                    <strong>{summary.priced ? money(summary.cost) : 'Unknown'}</strong>
                    <small>
                      known cost · {summary.priced}/{runs.length} runs
                    </small>
                  </div>
                  <div>
                    <strong>{runs.length}</strong>
                    <small>runs</small>
                  </div>
                  <div>
                    <strong>{findings.length}</strong>
                    <small>defects recorded</small>
                  </div>
                </div>
                <div className="card-bottom">
                  <span>{s.ambiguity ? `${s.ambiguity} ambiguity` : 'Ambiguity unknown'}</span>
                  <span>
                    {s.qualityGrade ? `Quality ${qualityLabel(s.qualityGrade)}` : 'Ungraded'} →
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}
function SliceDetail({
  slice,
  data,
  onSelect,
  onEdit,
  onOpenRun,
  onDelete
}: Omit<Props, 'selectedId'> & { slice: Slice }): React.JSX.Element {
  const [tab, setTab] = useState<'runs' | 'findings' | 'discoveries' | 'details'>('runs')
  const runs = data.runs
    .filter((r) => r.sliceId === slice.id)
    .sort((a, b) => (a.startAt ?? '').localeCompare(b.startAt ?? ''))
  const beforeAcceptance = acceptanceRuns(slice, runs)
  const summary = summarize(slice.disposition === 'Accepted' ? beforeAcceptance : runs)
  const repair = roleSummary(slice.disposition === 'Accepted' ? beforeAcceptance : runs, 'Repair')
  const critic = roleSummary(slice.disposition === 'Accepted' ? beforeAcceptance : runs, 'Critic')
  const findings = data.findings.filter((f) => f.sliceId === slice.id)
  const discoveries = data.discoveries.filter((d) => d.sliceId === slice.id)
  const accepted = slice.disposition === 'Accepted'
  return (
    <>
      <button className="back-link" onClick={() => onSelect(undefined)}>
        ← All slices
      </button>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {slice.project ?? 'Slice'} / {slice.id}
          </p>
          <h1>{slice.title}</h1>
          <div className="inline-meta">
            <Badge>{slice.disposition}</Badge>
            <span>{slice.productionModel ?? 'Workflow unknown'}</span>
            <span>{slice.ambiguity ?? 'Unknown'} ambiguity</span>
            <span>{slice.risk ?? 'Unknown'} risk</span>
            {slice.acceptedAt && (
              <span>
                Accepted{' '}
                <time dateTime={slice.acceptedAt}>{displayTimestamp(slice.acceptedAt)}</time>
              </span>
            )}
          </div>
        </div>
        <button onClick={() => onEdit('slices', slice)}>Edit slice</button>
      </div>
      <div className="metrics">
        <Metric
          label={accepted ? 'Cost to accepted' : 'Known cost so far'}
          value={summary.priced ? money(summary.cost) : 'Unknown'}
          detail={`${summary.priced}/${summary.total} runs priced${summary.priced !== summary.total ? ' · incomplete' : ''}`}
        />
        <Metric
          label="Time to accepted"
          value={duration(timeToAccepted(slice, beforeAcceptance))}
          detail={
            slice.timeToAcceptedMinutes !== undefined
              ? 'Operator measured'
              : 'First recorded run → acceptance'
          }
        />
        <Metric
          label="Repair burden"
          value={money(repair.cost)}
          detail={`${repair.total} repair passes · ${repair.priced}/${repair.total} priced`}
        />
        <Metric
          label="Product quality"
          value={qualityLabel(slice.qualityGrade)}
          detail={
            slice.preferredCandidate
              ? `Preferred: ${slice.preferredCandidate}`
              : 'No preference recorded'
          }
        />
      </div>
      {accepted && !slice.acceptedAt && (
        <p className="notice">
          Acceptance time is not recorded. Cost includes every run in this slice; add “Accepted at”
          to bound the acceptance window.
        </p>
      )}
      <div className="evidence-strip">
        <span>
          Critic cost <strong>{money(critic.cost)}</strong>{' '}
          <small>
            {critic.priced}/{critic.total} priced
          </small>
        </span>
        <span>
          Meter burn <strong>{burnLabel(summary.burnKnown ? summary.burn : null)}</strong>{' '}
          <small>
            {summary.burnKnown}/{summary.total} runs
          </small>
        </span>
        <span>
          Validated autonomous discoveries{' '}
          <strong>{discoveries.filter(validatedDiscovery).length}</strong>
        </span>
        <span>
          Findings <strong>{findings.length}</strong>
        </span>
      </div>
      <div className="tabs" role="tablist" aria-label="Slice records">
        {(['runs', 'findings', 'discoveries', 'details'] as const).map((name) => (
          <button key={name} role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>
            {name[0].toUpperCase() + name.slice(1)}
            {name !== 'details' && (
              <span>
                {name === 'runs'
                  ? runs.length
                  : name === 'findings'
                    ? findings.length
                    : discoveries.length}
              </span>
            )}
          </button>
        ))}
      </div>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>
              {tab === 'details'
                ? 'Slice provenance'
                : tab === 'runs'
                  ? 'Run history'
                  : tab === 'findings'
                    ? 'Findings & defects'
                    : 'Discoveries & validation'}
            </h2>
            <p className="muted">
              {tab === 'runs'
                ? 'Every role contributes to the cost of accepted work. Includes runs after acceptance.'
                : tab === 'findings'
                  ? 'Severity and category are separate. A harness defect is distinct from a product defect.'
                  : tab === 'discoveries'
                    ? 'Credit requires self-initiation, independent validation, and absence from the prompt.'
                    : 'Original context and operator judgment stay with the work.'}
            </p>
          </div>
          {tab !== 'details' && (
            <button className="primary" onClick={() => onEdit(tab, undefined, slice.id)}>
              + Add {tab === 'discoveries' ? 'discovery' : tab.slice(0, -1)}
            </button>
          )}
        </div>
        {tab === 'runs' && <RunTable runs={runs} onOpen={onOpenRun} />}
        {tab === 'details' && (
          <>
            <RecordDetails table="slices" record={slice} />
            <button className="danger-link" onClick={() => onDelete('slices', slice)}>
              Delete slice
            </button>
          </>
        )}
        {tab === 'findings' &&
          (!findings.length ? (
            <Empty title="No findings recorded">
              Record material defects, test gaps, and observations as evidence becomes available.
            </Empty>
          ) : (
            <div className="evidence-list">
              {findings.map((f) => (
                <article key={f.id}>
                  <div className="card-top">
                    <div className="inline-meta">
                      <Badge>{f.severity}</Badge>
                      <Badge>{f.category}</Badge>
                      <Badge>{f.status}</Badge>
                    </div>
                    <button onClick={() => onEdit('findings', f)}>Edit finding</button>
                  </div>
                  <h3>{f.title ?? f.description}</h3>
                  {f.title && <p className="preserve">{f.description}</p>}
                  <p className="muted">
                    User visible:{' '}
                    {f.userVisible === undefined ? 'Unknown' : f.userVisible ? 'Yes' : 'No'} ·
                    Repair required:{' '}
                    {f.repairRequired === undefined ? 'Unknown' : f.repairRequired ? 'Yes' : 'No'} ·
                    Found in: {f.runId ?? 'Not linked'}
                  </p>
                  {f.evidence && <p className="preserve">{f.evidence}</p>}
                  <details>
                    <summary>All finding details</summary>
                    <RecordDetails table="findings" record={f} />
                    <button className="danger-link" onClick={() => onDelete('findings', f)}>
                      Delete finding
                    </button>
                  </details>
                </article>
              ))}
            </div>
          ))}
        {tab === 'discoveries' &&
          (!discoveries.length ? (
            <Empty title="Useful discoveries belong here">
              Capture insights beyond the supplied instructions, then record independent validation.
            </Empty>
          ) : (
            <div className="evidence-list">
              {discoveries.map((d) => (
                <article key={d.id}>
                  <div className="card-top">
                    <div className="inline-meta">
                      <Badge>
                        {validatedDiscovery(d)
                          ? 'Validated autonomous'
                          : d.validation === 'Yes'
                            ? 'Validated'
                            : (d.validation ?? 'Pending')}
                      </Badge>
                      <span>
                        {d.impact ?? 'Unknown'} impact · {d.downstreamValue ?? 'Value not recorded'}
                      </span>
                    </div>
                    <button onClick={() => onEdit('discoveries', d)}>Edit discovery</button>
                  </div>
                  <h3>{d.description}</h3>
                  <p className="muted">
                    Validated by: {d.validatedBy ?? 'Not recorded'} · Run: {d.runId ?? 'Not linked'}
                  </p>
                  {d.evidence && <p className="preserve">{d.evidence}</p>}
                  <details>
                    <summary>All discovery details</summary>
                    <RecordDetails table="discoveries" record={d} />
                    <button className="danger-link" onClick={() => onDelete('discoveries', d)}>
                      Delete discovery
                    </button>
                  </details>
                </article>
              ))}
            </div>
          ))}
      </section>
    </>
  )
}
