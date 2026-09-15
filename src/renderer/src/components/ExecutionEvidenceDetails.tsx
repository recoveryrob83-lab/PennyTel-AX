import type { ExecutionEvidence } from '../../../shared/execution-evidence'
import { peakContextUtilization } from '../../../shared/metrics'
import { evidencePercent } from '../../../shared/presentation'

function Details({ rows }: { rows: [string, string | number | undefined][] }): React.JSX.Element {
  return (
    <dl className="record-details">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value ?? 'Unknown'}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Read only, explicitly enumerated normalized fields; provenance is inert text. */
export function ExecutionEvidenceDetails({
  evidence
}: {
  evidence?: ExecutionEvidence
}): React.JSX.Element {
  return (
    <section aria-label="Execution evidence" className="execution-evidence">
      <h3>Execution evidence</h3>
      {!evidence ? (
        <p className="muted">Unknown · no execution evidence recorded.</p>
      ) : (
        <>
          <p className="muted">
            Read-only recorded metrics and provenance. Missing fields are Unknown.
          </p>
          <Details
            rows={[
              ['Source kind', evidence.kind],
              ['Evidence format version', evidence.formatVersion],
              ['Source log basename', evidence.sourceLog?.fileName],
              ['Source log SHA-256', evidence.sourceLog?.contentHash?.value],
              ['Session ID', evidence.sessionId],
              ['Turn ID', evidence.turnId],
              ['Runtime / Codex version', evidence.runtimeVersion],
              ['Originator', evidence.originator],
              ['Working directory / worktree', evidence.workingDirectory],
              ['Repository', evidence.repository?.url],
              ['Branch', evidence.repository?.branch],
              ['Baseline commit SHA', evidence.repository?.baselineCommitSha],
              ['TTFT (ms)', evidence.timeToFirstTokenMs],
              ['Model invocations', evidence.modelInvocationCount],
              ['Tool calls', evidence.toolCallCount],
              ['Model context window (tokens)', evidence.modelContextWindowTokens],
              [
                'Peak invocation input (tokens, includes cache)',
                evidence.peakInvocation?.inputTokens
              ],
              ['Cached input within peak (tokens)', evidence.peakInvocation?.cachedInputTokens],
              ['Context window at peak (tokens)', evidence.peakInvocation?.contextWindowTokens],
              ['Peak context utilization', evidencePercent(peakContextUtilization(evidence))]
            ]}
          />
          <p className="footnote">
            Utilization uses the window recorded on the same peak invocation. Cached input is
            already included in occupancy. Run token totals and other context windows are not used.
          </p>
          <h4>Quota source evidence</h4>
          <p className="muted">
            Used-percent snapshots are descriptive evidence. Attribution is recorded, not inferred.
            Even Clean snapshots do not establish precise per-run burn; endpoint movement is never
            converted to the remaining-usage meter or cost.
          </p>
          {!evidence.quotaWindows?.length ? (
            <p>Unknown · no quota snapshots recorded.</p>
          ) : (
            evidence.quotaWindows.map((window, index) => (
              <section key={index} aria-label={`Quota window ${index + 1}`}>
                <h4>Quota window {index + 1}</h4>
                <Details
                  rows={[
                    ['Window name', window.windowName],
                    ['Window duration (minutes)', window.windowMinutes],
                    ['Plan type', window.planType],
                    ['Attribution', window.attribution],
                    ['Attribution reason / note', window.note],
                    [
                      'First used_percent',
                      window.first === undefined ? undefined : `${window.first.usedPercent}%`
                    ],
                    ['First recorded at', window.first?.recordedAt],
                    ['First reset at', window.first?.resetsAt],
                    [
                      'Last used_percent',
                      window.last === undefined ? undefined : `${window.last.usedPercent}%`
                    ],
                    ['Last recorded at', window.last?.recordedAt],
                    ['Last reset at', window.last?.resetsAt]
                  ]}
                />
              </section>
            ))
          )}
          <h4>Recorded environment constraints</h4>
          <Details
            rows={[
              ['Sandbox mode', evidence.environment?.sandboxMode],
              ['Approval policy', evidence.environment?.approvalPolicy],
              ['Approval reviewer', evidence.environment?.approvalReviewer],
              ['Network access', evidence.environment?.networkAccess]
            ]}
          />
        </>
      )}
    </section>
  )
}
