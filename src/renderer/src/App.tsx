import { useEffect, useState } from 'react'
import type { Entity, LoadedData, Mutation, Run, Table } from '../../shared/types'
import { summarize, money } from '../../shared/metrics'
import { singular } from '../../shared/fields'
import { RecordEditor, type EditTarget } from './components/RecordEditor'
import { Modal, RecordDetails, RunMetrics } from './components/ui'
import { Slices } from './pages/Slices'
import { Compare } from './pages/Compare'
import { Pricing } from './pages/Pricing'
import { Registry } from './pages/Registry'
import { Data } from './pages/Data'

type Page = 'slices' | 'compare' | 'pricing' | 'registry' | 'data'
async function readLocalData(): Promise<LoadedData> {
  if (!window.pennytel)
    throw new Error(
      'Open PennyTel in Electron using npm run dev or npm start. The local data service is not available in a standalone browser.'
    )
  return window.pennytel.load()
}
const pages: { id: Page; label: string; icon: string }[] = [
  { id: 'slices', label: 'Slice notebook', icon: '▤' },
  { id: 'compare', label: 'Compare', icon: '▥' },
  { id: 'registry', label: 'Model Registry', icon: '◇' },
  { id: 'pricing', label: 'Pricing history', icon: '＄' },
  { id: 'data', label: 'Data & portability', icon: '⇄' }
]
export default function App(): React.JSX.Element {
  const [loaded, setLoaded] = useState<LoadedData>()
  const [error, setError] = useState('')
  const [page, setPage] = useState<Page>('slices')
  const [selectedSlice, setSelectedSlice] = useState<string>()
  const [edit, setEdit] = useState<EditTarget>()
  const [runId, setRunId] = useState<string>()
  const [deletion, setDeletion] = useState<{ table: Table; record: Entity }>()
  const [deleteError, setDeleteError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const load = async (): Promise<void> => {
    setError('')
    try {
      setLoaded(await readLocalData())
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => {
    let active = true
    readLocalData()
      .then((value) => {
        if (active) setLoaded(value)
      })
      .catch((e) => {
        if (active) setError((e as Error).message)
      })
    return () => {
      active = false
    }
  }, [])
  const mutate = async (
    command:
      | Omit<Extract<Mutation, { kind: 'save' }>, 'revision'>
      | Omit<Extract<Mutation, { kind: 'delete' }>, 'revision'>
      | Omit<Extract<Mutation, { kind: 'import' }>, 'revision'>
      | Omit<Extract<Mutation, { kind: 'registry-import' }>, 'revision'>
  ): Promise<void> => {
    if (!loaded) return
    const result = await window.pennytel.mutate({ ...command, revision: loaded.data.revision })
    setLoaded(result)
  }
  const save = async (table: Table, record: Entity): Promise<void> => {
    await mutate({ kind: 'save', table, record })
    setNotice(`${singular[table][0].toUpperCase() + singular[table].slice(1)} saved locally.`)
    if (table === 'slices') {
      setSelectedSlice(record.id)
      setPage('slices')
    }
  }
  const openEditor = (table: Table, record?: Entity, sliceId?: string): void => {
    setRunId(undefined)
    setEdit({ table, record, sliceId })
  }
  const askDelete = (table: Table, record: Entity): void => {
    setRunId(undefined)
    setDeleteError('')
    setDeletion({ table, record })
  }
  const deleteRecord = async (): Promise<void> => {
    if (!deletion) return
    setBusy(true)
    setDeleteError('')
    try {
      await mutate({ kind: 'delete', table: deletion.table, id: deletion.record.id })
      setNotice(
        `${singular[deletion.table]} deleted. The previous revision is in the local backup.`
      )
      setDeletion(undefined)
    } catch (e) {
      setDeleteError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  if (!loaded)
    return (
      <div className="startup">
        <div className="brand-mark">
          P<span>t</span>
        </div>
        <h1>PennyTel</h1>
        {error ? (
          <>
            <p className="error" role="alert">
              {error}
            </p>
            <button onClick={load}>Retry load</button>
          </>
        ) : (
          <p>Opening your local notebook…</p>
        )}
      </div>
    )
  const { data, path } = loaded
  const summary = summarize(data.runs)
  const selectedRun = data.runs.find((r) => r.id === runId)
  const openRun = (run: Run): void => setRunId(run.id)
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            P<span>t</span>
          </div>
          <div>
            <strong>PennyTel</strong>
            <small>ENGINEERING WORKBENCH</small>
          </div>
        </div>
        <div className="workspace-label">PENNYOS / LOCAL</div>
        <nav aria-label="Main navigation">
          {pages.map((item) => (
            <button
              key={item.id}
              className={page === item.id ? 'active' : ''}
              aria-current={page === item.id ? 'page' : undefined}
              onClick={() => {
                setPage(item.id)
                if (item.id === 'slices') setSelectedSlice(undefined)
              }}
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-indicator">
            <i /> Saved on this device
          </div>
          <p>
            {data.slices.length} slices · {data.runs.length} runs
          </p>
          <p>
            {summary.priced ? money(summary.cost) : 'No priced runs'}
            <small> known API-equivalent</small>
          </p>
          <div className="version">
            PennyTel v0.1 <span>Local first</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            Engineering telemetry <span className="divider">/</span>{' '}
            {pages.find((p) => p.id === page)?.label}
          </span>
          <span className="local-label">
            <i /> LOCAL DATASET
          </span>
        </header>
        <main>
          {notice && (
            <div className="toast" role="status">
              {notice}
              <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
                ×
              </button>
            </div>
          )}
          {page === 'slices' && (
            <Slices
              data={data}
              selectedId={selectedSlice}
              onSelect={setSelectedSlice}
              onEdit={openEditor}
              onOpenRun={openRun}
              onDelete={askDelete}
            />
          )}
          {page === 'compare' && (
            <Compare
              data={data}
              onOpenRun={openRun}
              onOpenSlice={(id) => {
                setSelectedSlice(id)
                setPage('slices')
              }}
            />
          )}
          {page === 'registry' && (
            <Registry data={data} onImport={(text) => mutate({ kind: 'registry-import', text })} />
          )}
          {page === 'pricing' && (
            <Pricing
              data={data}
              onEdit={(record) => openEditor('pricing', record)}
              onDelete={(record) => askDelete('pricing', record)}
            />
          )}
          {page === 'data' && (
            <Data data={data} path={path} onImport={(text) => mutate({ kind: 'import', text })} />
          )}
        </main>
      </div>
      {edit && (
        <RecordEditor target={edit} data={data} onSave={save} onClose={() => setEdit(undefined)} />
      )}
      {selectedRun && (
        <Modal
          title={`${selectedRun.runType} · ${selectedRun.model ?? 'Unknown model'}`}
          onClose={() => setRunId(undefined)}
          wide
        >
          <div className="modal-body">
            <RunMetrics run={selectedRun} />
            <RecordDetails table="runs" record={selectedRun} />
            <section className="linked-evidence">
              <h3>Linked evidence</h3>
              <p className="muted">
                Findings discovered here, repairs attributed here, and discoveries from this run.
              </p>
              {data.findings
                .filter((f) => f.runId === selectedRun.id || f.repairRunId === selectedRun.id)
                .map((f) => (
                  <p key={f.id}>
                    <button className="record-link" onClick={() => openEditor('findings', f)}>
                      {f.severity} · {f.category} · {f.description}
                    </button>
                  </p>
                ))}
              {data.discoveries
                .filter((d) => d.runId === selectedRun.id)
                .map((d) => (
                  <p key={d.id}>
                    <button className="record-link" onClick={() => openEditor('discoveries', d)}>
                      {d.validation ?? 'Pending'} · {d.description}
                    </button>
                  </p>
                ))}
              {!data.findings.some(
                (f) => f.runId === selectedRun.id || f.repairRunId === selectedRun.id
              ) &&
                !data.discoveries.some((d) => d.runId === selectedRun.id) && (
                  <p>No linked evidence recorded.</p>
                )}
            </section>
          </div>
          <footer className="modal-footer">
            <div className="button-row">
              <button className="danger-link" onClick={() => askDelete('runs', selectedRun)}>
                Delete run
              </button>
              <button
                onClick={() => {
                  setSelectedSlice(selectedRun.sliceId)
                  setPage('slices')
                  setRunId(undefined)
                }}
              >
                Open slice
              </button>
              <button className="primary" onClick={() => openEditor('runs', selectedRun)}>
                Edit run
              </button>
            </div>
          </footer>
        </Modal>
      )}
      {deletion && (
        <Modal
          title={`Delete ${singular[deletion.table]}?`}
          onClose={() => {
            if (!busy) setDeletion(undefined)
          }}
        >
          <div className="modal-body">
            <p>
              This removes <strong>{deletion.record.id}</strong> from the local dataset. Related
              records are protected: referenced slices and runs cannot be deleted.
            </p>
            {deletion.table === 'pricing' && (
              <p>
                Run snapshots and migrated registry history are retained. To change registered
                offers, update Model Registry.
              </p>
            )}
            {deleteError && (
              <p role="alert" className="error">
                {deleteError}
              </p>
            )}
          </div>
          <footer className="modal-footer">
            <div className="button-row">
              <button disabled={busy} onClick={() => setDeletion(undefined)}>
                Cancel
              </button>
              <button className="danger" disabled={busy} onClick={deleteRecord}>
                {busy ? 'Deleting…' : 'Delete record'}
              </button>
            </div>
          </footer>
        </Modal>
      )}
    </div>
  )
}
