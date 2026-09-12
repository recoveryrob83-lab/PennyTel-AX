import type { Run } from '../../../shared/types'
import { money, duration, runCost, runMinutes } from '../../../shared/metrics'
import { Badge, Empty } from './ui'

export function RunTable({
  runs,
  onOpen
}: {
  runs: Run[]
  onOpen: (run: Run) => void
}): React.JSX.Element {
  if (!runs.length)
    return (
      <Empty title="No runs recorded">
        Add an implementation, critic, repair, or other unit of model work.
      </Empty>
    )
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Run / candidate</th>
            <th>Model / thinking</th>
            <th>Role</th>
            <th>API-equivalent</th>
            <th>Wall clock</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>
                <button className="record-link" onClick={() => onOpen(run)}>
                  {run.runType}
                </button>
                <small>{run.candidate ?? run.id}</small>
              </td>
              <td>
                {run.model ?? 'Unknown model'}
                <small>
                  {run.thinking ?? 'Unknown thinking'} · {run.sessionMode ?? 'Unknown session'}
                </small>
              </td>
              <td>{run.role}</td>
              <td className="numeric">{money(runCost(run))}</td>
              <td className="numeric">{duration(runMinutes(run))}</td>
              <td>
                <Badge>{run.result}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
