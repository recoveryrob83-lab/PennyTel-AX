import { useState } from 'react'
import { fields, singular, type Field } from '../../../shared/fields'
import { validateRecord } from '../../../shared/data'
import type { Dataset, Entity, Table } from '../../../shared/types'
import { Modal } from './ui'
import { AcceptanceTime } from './AcceptanceTime'

export interface EditTarget {
  table: Table
  record?: Entity
  sliceId?: string
}
export function RecordEditor({
  target,
  data,
  onSave,
  onClose
}: {
  target: EditTarget
  data: Dataset
  onSave: (table: Table, record: Entity) => Promise<void>
  onClose: () => void
}): React.JSX.Element {
  const { table, record, sliceId } = target
  const [initial] = useState<Record<string, unknown>>(() =>
    record
      ? { ...record }
      : {
          id: `${singular[table]}-${crypto.randomUUID().slice(0, 8)}`,
          ...(sliceId ? { sliceId } : {}),
          ...(table === 'slices' ? { disposition: 'In progress' } : {})
        }
  )
  const [values, setValues] = useState(initial)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [discard, setDiscard] = useState(false)
  const dirty = JSON.stringify(values) !== JSON.stringify(initial)
  const close = (): void => {
    if (busy) return
    if (dirty) setDiscard(true)
    else onClose()
  }
  const update = (field: Field, raw: string): void => {
    const next = { ...values }
    if (raw === '') delete next[field.key]
    else
      next[field.key] =
        field.type === 'number' ? Number(raw) : field.type === 'boolean' ? raw === 'true' : raw
    setValues(next)
    setDiscard(false)
    setError('')
  }
  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const clean = Object.fromEntries(
        Object.entries(values)
          .filter(([key]) => key !== 'priceSnapshot')
          .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])
          .filter(([, value]) => value !== '')
      )
      validateRecord(table, clean)
      if (!record && data[table].some((row) => row.id === clean.id))
        throw new Error('This record ID already exists. Choose another ID.')
      await onSave(table, clean)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const renderField = (field: Field): React.JSX.Element => {
    const value = values[field.key]
    if (table === 'slices' && field.key === 'acceptedAt')
      return (
        <AcceptanceTime
          key={field.key}
          value={String(value ?? '')}
          onChange={(raw) => update(field, raw)}
          canAcceptNow={values.disposition === 'In progress'}
          onAcceptNow={(iso) => {
            if (values.acceptedAt || values.disposition !== 'In progress') return
            setValues({ ...values, disposition: 'Accepted', acceptedAt: iso })
            setDiscard(false)
            setError('')
          }}
        />
      )
    const inputId = `field-${field.key}`
    const common = {
      id: inputId,
      name: field.key,
      required: field.required,
      value: value === undefined ? '' : String(value),
      onChange: (
        e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
      ) => update(field, e.target.value),
      'aria-describedby': field.hint ? `${inputId}-hint` : undefined
    }
    let options = field.options?.map((v) => ({ value: v, label: v }))
    if (field.type === 'boolean')
      options = [
        { value: 'true', label: 'Yes' },
        { value: 'false', label: 'No' }
      ]
    if (field.relation)
      options =
        field.relation === 'slices'
          ? data.slices.map((s) => ({ value: s.id, label: `${s.title} · ${s.id}` }))
          : data.runs
              .filter((r) => r.sliceId === values.sliceId)
              .map((r) => ({
                value: r.id,
                label: `${r.runType} · ${r.model ?? 'Unknown model'} · ${r.id}`
              }))
    return (
      <div key={field.key} className={`field ${field.type === 'textarea' ? 'full' : ''}`}>
        <label htmlFor={inputId}>
          {field.label}
          {field.required && <span className="required"> *</span>}
        </label>
        {options ? (
          <select {...common}>
            <option value="">{field.required ? 'Select…' : 'Unknown / not recorded'}</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : field.type === 'textarea' ? (
          <textarea {...common} rows={3} />
        ) : (
          <input
            {...common}
            readOnly={field.key === 'id' && !!record}
            type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
            min={field.type === 'number' ? (field.min ?? 0) : undefined}
            max={field.max}
            step={field.type === 'number' ? (field.integer ? 1 : 'any') : undefined}
            placeholder={field.type === 'timestamp' ? '2026-09-11T15:00:00-05:00' : undefined}
          />
        )}
        {field.hint && <small id={`${inputId}-hint`}>{field.hint}</small>}
      </div>
    )
  }
  const groups = [...new Set(fields[table].map((f) => f.group ?? 'Essentials'))]
  return (
    <Modal title={`${record ? 'Edit' : 'New'} ${singular[table]}`} onClose={close} wide>
      <form onSubmit={submit}>
        <div className="modal-body">
          <p className="muted">
            Record what you know. Blank fields stay unknown. <span className="required">*</span>{' '}
            Required
          </p>
          {table === 'runs' && (
            <p className="notice">
              Registry pricing uses stable identity and the run start date, pricing reference date,
              or slice start date. Enter explicit zeroes for known-zero token counts. Explicitly
              correcting model, provider, date, or overrides selects a new snapshot.
            </p>
          )}
          {table === 'pricing' && (
            <p className="notice">
              This edits legacy pricing. Use Model Registry for registered offers. Existing run
              snapshots remain unchanged; correct a historical run using its three rate overrides.
            </p>
          )}
          <fieldset disabled={busy}>
            {groups.map((group) =>
              group === 'Essentials' ? (
                <div className="form-grid" key={group}>
                  {fields[table].filter((f) => !f.group).map(renderField)}
                </div>
              ) : (
                <details
                  className="form-section"
                  key={group}
                  open={['Rates', 'Time & usage', 'Tokens & cost'].includes(group)}
                >
                  <summary>{group}</summary>
                  <div className="form-grid">
                    {fields[table].filter((f) => f.group === group).map(renderField)}
                  </div>
                </details>
              )
            )}
          </fieldset>
        </div>
        <footer className="modal-footer">
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {discard && (
            <p className="notice">
              You have unsaved changes.{' '}
              <button type="button" className="danger-link" onClick={onClose}>
                Discard changes
              </button>
              <button type="button" className="text-button" onClick={() => setDiscard(false)}>
                Keep editing
              </button>
            </p>
          )}
          <div className="button-row">
            <button type="button" onClick={close} disabled={busy}>
              Cancel
            </button>
            <button className="primary" type="submit" disabled={busy}>
              {busy ? 'Saving…' : `Save ${singular[table]}`}
            </button>
          </div>
        </footer>
      </form>
    </Modal>
  )
}
