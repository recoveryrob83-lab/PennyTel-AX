import { useState } from 'react'
import { displayTimestamp } from '../../../shared/presentation'
import { acceptanceISO, localTimestamp } from '../../../shared/acceptance-time'

export function AcceptanceTime({
  value,
  onChange,
  onAcceptNow,
  canAcceptNow
}: {
  value: string
  onChange: (value: string) => void
  onAcceptNow: (iso: string) => void
  canAcceptNow: boolean
}): React.JSX.Element {
  const [exact, setExact] = useState(false)
  const [local, setLocal] = useState(() => localTimestamp(value))
  const [error, setError] = useState('')
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return (
    <div className="field">
      <label htmlFor="field-acceptedAt">
        Accepted at{exact ? ' (exact timestamp)' : ' (local date/time)'}
      </label>
      <input
        id="field-acceptedAt"
        type={exact ? 'text' : 'datetime-local'}
        step={exact ? undefined : '0.001'}
        value={exact ? value : local}
        aria-describedby="acceptance-help"
        onChange={(event) => {
          const raw = event.target.value
          setError('')
          if (exact) {
            onChange(raw)
            return
          }
          setLocal(raw)
          try {
            onChange(raw ? acceptanceISO(raw) : '')
          } catch (e) {
            setError((e as Error).message)
            onChange(raw) // Invalid local input cannot pass ISO-with-timezone record validation.
          }
        }}
      />
      <small id="acceptance-help">
        Local timezone: {zone}. Save slice to keep changes. Changing disposition keeps this history.
      </small>
      {value && Number.isFinite(Date.parse(value)) && !error && (
        <small>{displayTimestamp(value)}</small>
      )}
      {error && (
        <small role="alert" className="error">
          {error}
        </small>
      )}
      <div className="button-row">
        <button
          type="button"
          onClick={() => {
            setLocal(localTimestamp(value))
            setExact(!exact)
            setError('')
          }}
        >
          {exact ? 'Use local date/time' : 'Use exact timestamp (ISO with timezone)'}
        </button>
        <button
          type="button"
          disabled={!value}
          onClick={() => {
            onChange('')
            setLocal('')
            setError('')
          }}
        >
          Clear acceptance time
        </button>
        {canAcceptNow && (
          <button
            type="button"
            disabled={!!value}
            onClick={() => {
              const iso = new Date().toISOString()
              onAcceptNow(iso)
              setLocal(localTimestamp(iso))
              setError('')
            }}
          >
            Accept now
          </button>
        )}
      </div>
      {canAcceptNow && value && (
        <small>
          Acceptance time already recorded. Correct or explicitly clear it before accepting now.
        </small>
      )}
    </div>
  )
}
