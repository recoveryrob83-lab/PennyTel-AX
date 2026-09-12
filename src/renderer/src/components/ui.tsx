import { useEffect, useRef, type ReactNode } from 'react'
import { fields } from '../../../shared/fields'
import type { Entity, Run, Table } from '../../../shared/types'
import {
  costIssues,
  money,
  runCost,
  runMinutes,
  duration,
  usageBurn,
  percent
} from '../../../shared/metrics'

export function Empty({
  title,
  children,
  action
}: {
  title: string
  children: ReactNode
  action?: ReactNode
}): React.JSX.Element {
  return (
    <div className="empty">
      <span className="empty-symbol" aria-hidden="true">
        ◇
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  )
}
export function Badge({ children }: { children: ReactNode }): React.JSX.Element {
  const style =
    typeof children === 'string' && ['Accepted', 'Passed', 'Repaired', 'Yes'].includes(children)
      ? 'good'
      : typeof children === 'string' &&
          ['P0', 'P1', 'Failed', 'Needs repair', 'Rejected'].includes(children)
        ? 'warn'
        : ''
  return <span className={`badge ${style}`}>{children ?? 'Unknown'}</span>
}
export function Metric({
  label,
  value,
  detail
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
}): React.JSX.Element {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  )
}
export function Modal({
  title,
  onClose,
  children,
  wide = false
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return (
    <dialog
      ref={ref}
      className={wide ? 'modal wide' : 'modal'}
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <header className="modal-header">
        <h2 id="dialog-title">{title}</h2>
        <button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}>
          ×
        </button>
      </header>
      {children}
    </dialog>
  )
}
export function RecordDetails({
  table,
  record
}: {
  table: Table
  record: Entity
}): React.JSX.Element {
  const values = record as unknown as Record<string, unknown>
  return (
    <dl className="record-details">
      {fields[table]
        .filter((f) => values[f.key] !== undefined)
        .map((field) => (
          <div key={field.key} className={field.type === 'textarea' ? 'full' : ''}>
            <dt>{field.label}</dt>
            <dd>
              {typeof values[field.key] === 'boolean'
                ? values[field.key]
                  ? 'Yes'
                  : 'No'
                : String(values[field.key])}
            </dd>
          </div>
        ))}
    </dl>
  )
}
export function RunMetrics({ run }: { run: Run }): React.JSX.Element {
  const issues = costIssues(run)
  const snapshot = run.priceSnapshot
  return (
    <>
      <div className="metrics">
        <Metric label="API-equivalent cost" value={money(runCost(run))} />
        <Metric label="Wall clock" value={duration(runMinutes(run))} />
        <Metric
          label="Cache ratio"
          value={percent(
            run.inputTokens && run.cachedInputTokens !== undefined
              ? run.cachedInputTokens / run.inputTokens
              : null
          )}
        />
        <Metric label="Meter burn" value={usageBurn(run) ?? 'Unknown'} />
      </div>
      {issues.length > 0 && (
        <p className="notice">
          Cost incomplete: {issues.join(' · ')}. Add pricing and edit/save this run to attach a
          rate, or enter rate overrides.
        </p>
      )}
      {snapshot && (
        <p className="footnote">
          Saved {snapshot.source.toLowerCase()} rates ·{' '}
          {snapshot.effectiveDate
            ? `effective ${snapshot.effectiveDate} UTC`
            : 'effective date unknown'}{' '}
          · input {money(snapshot.inputRate)}, cached {money(snapshot.cachedRate)}, output{' '}
          {money(snapshot.outputRate)} per million tokens. Later catalog edits do not change these
          rates.
        </p>
      )}
    </>
  )
}
