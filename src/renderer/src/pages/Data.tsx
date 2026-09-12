import { useState } from 'react'
import { emptyDataset, TABLES, type Dataset, type ImportPreview } from '../../../shared/types'

export function Data({
  data,
  path,
  onImport
}: {
  data: Dataset
  path: string
  onImport: (text: string) => Promise<void>
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<ImportPreview>()
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<void>): Promise<void> => {
    setError('')
    setMessage('')
    setBusy(true)
    try {
      await action()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Your local dataset</p>
          <h1>Data & portability</h1>
          <p className="muted">
            Import telemetry, take a portable backup, and inspect the storage contract.
          </p>
        </div>
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const exported = await window.pennytel.exportData()
              if (exported) setMessage(`Exported to ${exported}`)
            })
          }
        >
          Export dataset
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      <section className="panel">
        <h2>Local storage</h2>
        <p className="path">{path}</p>
        <div className="dataset-counts">
          {TABLES.map((table) => (
            <span key={table}>
              <strong>{data[table].length}</strong> {table}
            </span>
          ))}
          <span>
            Revision {data.revision} · Schema v{data.schemaVersion}
          </span>
        </div>
        <p className="footnote">
          Every successful change is saved to disk. The previous revision is retained as
          telemetry.backup.json alongside the live dataset. Export periodically for a separate
          backup. If a file is corrupt, PennyTel preserves it and stops writes.
        </p>
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Import records</h2>
            <p className="muted">
              Select a PennyTel JSON export or paste records from an ingestion tool. Preview before
              adding them.
            </p>
          </div>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const value = await window.pennytel.openImport()
                if (value !== null) {
                  setText(value)
                  setPreview(undefined)
                }
              })
            }
          >
            Choose JSON file
          </button>
        </div>
        <label className="field full" htmlFor="import-json">
          Dataset JSON
          <textarea
            id="import-json"
            className="json-input"
            rows={12}
            spellCheck={false}
            value={text}
            disabled={busy}
            onChange={(e) => {
              setText(e.target.value)
              setPreview(undefined)
              setError('')
            }}
            placeholder={'{ "schemaVersion": 1, "slices": […], "runs": […] }'}
          />
        </label>
        <p className="footnote">
          Imports add records atomically. Identical records are skipped. Conflicting IDs, unknown
          fields, invalid values, and broken relationships stop the whole import. Existing records
          are never overwritten by import. Maximum 10 MB.
        </p>
        <div className="button-row">
          <button
            disabled={busy || !text.trim()}
            onClick={() =>
              run(async () => {
                setPreview(undefined)
                setPreview(await window.pennytel.previewImport(text))
              })
            }
          >
            Validate & preview
          </button>
        </div>
        {preview && (
          <div className="import-preview">
            <h3>Ready to add</h3>
            <div className="dataset-counts">
              {TABLES.map((table) => (
                <span key={table}>
                  <strong>{preview.counts[table]}</strong> {table}
                </span>
              ))}
              <span>{preview.skipped} identical records skipped</span>
            </div>
            <button
              className="primary"
              disabled={busy || !Object.values(preview.counts).some(Boolean)}
              onClick={() =>
                run(async () => {
                  await onImport(text)
                  setPreview(undefined)
                  setText('')
                  setMessage('Import saved. All relationships validated.')
                })
              }
            >
              {busy ? 'Importing…' : 'Import records'}
            </button>
          </div>
        )}
      </section>
      <section className="panel prose">
        <h2>Ingestion seam</h2>
        <p>
          The v1 JSON contract is the same for backups and batch ingestion. Include schemaVersion: 1
          and any of the five record arrays. Use stable IDs and camelCase field names. Optional
          fields must be omitted when unknown; null and blank values are rejected.
        </p>
        <details>
          <summary>Empty dataset template</summary>
          <pre>{JSON.stringify(emptyDataset(), null, 2)}</pre>
        </details>
        <p>
          See <code>docs/data-contract.md</code> in the repository for field names, relationships,
          cost conventions, and a minimal example. No Google Sheet connection is needed at runtime.
        </p>
      </section>
    </>
  )
}
