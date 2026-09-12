import { useState } from 'react'
import { applyMutation } from '../../../shared/data'
import { parseRegistry, priceAt, reconcileLegacyPricing } from '../../../shared/registry'
import type { Dataset } from '../../../shared/types'
import { money } from '../../../shared/metrics'

export function Registry({
  data,
  onImport
}: {
  data: Dataset
  onImport: (text: string) => Promise<void>
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<{
    revision: number
    priced: number
    identities: number
    models: number
    migration: string[]
  }>()
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const registry = data.registry
  const today = new Date().toISOString().slice(0, 10)
  const perform = async (action: () => Promise<void>): Promise<void> => {
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
          <p className="eyebrow">Model identity and pricing evidence</p>
          <h1>Model Registry</h1>
          <p className="muted">
            {registry
              ? `Registry revision ${registry.registryRevision} · updated ${registry.updatedAt} · ${registry.models.length} models`
              : 'No registry installed.'}
          </p>
        </div>
      </div>
      <p className="notice">
        Registry updates price eligible unpriced runs automatically. Existing snapshots keep their
        saved rates and evidence. Pricing uses the run’s UTC start date, then its pricing reference
        date, then the slice start date.
      </p>
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
        <details>
          <summary>Import / update registry</summary>
          <p>
            Load a complete registry JSON. Preview shows the replacement and eligible backfill
            before saving them together. Retain IDs used by runs; mark retired models and offers
            with their status.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              perform(async () => {
                const value = await window.pennytel.openImport()
                if (value !== null) {
                  setText(value)
                  setPreview(undefined)
                }
              })
            }
          >
            Choose registry JSON
          </button>
          <div className="field full">
            <label htmlFor="registry-json">Registry JSON</label>
            <textarea
              id="registry-json"
              className="json-input"
              rows={8}
              spellCheck={false}
              value={text}
              disabled={busy}
              onChange={(e) => {
                setText(e.target.value)
                setPreview(undefined)
                setError('')
              }}
            />
          </div>
          <div className="button-row">
            <button
              disabled={busy || !text.trim()}
              onClick={() =>
                perform(async () => {
                  setPreview(undefined)
                  const next = applyMutation(data, {
                    kind: 'registry-import',
                    text,
                    revision: data.revision
                  })
                  const migration = reconcileLegacyPricing(
                    parseRegistry(text),
                    data.pricing
                  ).records
                  setPreview({
                    revision: data.revision,
                    models: next.registry!.models.length,
                    priced: next.runs.filter(
                      (r) =>
                        r.priceSnapshot && !data.runs.find((old) => old.id === r.id)?.priceSnapshot
                    ).length,
                    identities: next.runs.filter((r) => {
                      const old = data.runs.find((old) => old.id === r.id)!
                      return r.modelId !== old.modelId || r.providerId !== old.providerId
                    }).length,
                    migration: migration.map((r) => `${r.pricingId}: ${r.status} — ${r.detail}`)
                  })
                })
              }
            >
              Validate registry & preview
            </button>
          </div>
          {preview && (
            <div className="import-preview">
              <p>
                {preview.models} models · {preview.identities} runs gain stable identity ·{' '}
                {preview.priced} unpriced runs gain snapshots. Existing frozen snapshots remain
                unchanged.
              </p>
              {preview.migration.length > 0 && (
                <details>
                  <summary>Legacy pricing reconciliation</summary>
                  <ul>
                    {preview.migration.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </details>
              )}
              <button
                className="primary"
                disabled={busy || preview.revision !== data.revision}
                onClick={() =>
                  perform(async () => {
                    await onImport(text)
                    setText('')
                    setPreview(undefined)
                    setMessage(
                      `Registry saved. ${preview.priced} previously unpriced runs resolved.`
                    )
                  })
                }
              >
                Install registry update
              </button>
            </div>
          )}
        </details>
      </section>
      {registry?.models.map((model) => (
        <section className="panel" key={model.id}>
          <div className="section-heading">
            <div>
              <h2>{model.canonicalName}</h2>
              <p>
                {registry.makers.find((m) => m.id === model.makerId)?.name} · {model.family} /{' '}
                {model.tier} · {model.status}
              </p>
            </div>
            <code>{model.id}</code>
          </div>
          <p>
            Aliases: {model.aliases.join(', ') || 'None'} · API model: {model.apiModelId}
          </p>
          <p>
            Reasoning levels: {model.reasoning.effortLevels.join(', ') || 'None'}{' '}
            {model.reasoning.supported ? '' : '(reasoning unsupported)'}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Provider offer</th>
                  <th>Current pricing (USD / million tokens)</th>
                </tr>
              </thead>
              <tbody>
                {model.offers.map((offer) => {
                  const price = priceAt(offer, today)
                  return (
                    <tr key={offer.id}>
                      <td>
                        <strong>
                          {registry.providers.find((p) => p.id === offer.providerId)?.name}
                        </strong>
                        <small>
                          {offer.providerId} · {offer.status}
                        </small>
                        <small>{offer.providerModelId}</small>
                        <small>{offer.id}</small>
                      </td>
                      <td>
                        {price ? (
                          <>
                            <strong>
                              Input {money(price.inputUsd)} · cached {money(price.cachedInputUsd)} ·
                              output {money(price.outputUsd)}
                            </strong>
                            <small>
                              Cache write:{' '}
                              {price.cacheWriteUsd === undefined
                                ? 'Unknown'
                                : money(price.cacheWriteUsd)}
                            </small>
                            <small>
                              Effective {price.effectiveFrom}
                              {price.effectiveTo ? ` until ${price.effectiveTo} (exclusive)` : ''}
                            </small>
                            <small className="preserve">Source: {price.source}</small>
                          </>
                        ) : (
                          `No applicable price on ${today}`
                        )}
                        <details>
                          <summary>Pricing history ({offer.pricingHistory.length})</summary>
                          {offer.pricingHistory.map((p) => (
                            <p key={p.effectiveFrom}>
                              {p.effectiveFrom} → {p.effectiveTo ?? 'open'} · input{' '}
                              {money(p.inputUsd)} · cached {money(p.cachedInputUsd)} · output{' '}
                              {money(p.outputUsd)} · cache write{' '}
                              {p.cacheWriteUsd === undefined ? 'Unknown' : money(p.cacheWriteUsd)}
                              <small className="preserve">{p.source}</small>
                              {p.legacyPricingIds && (
                                <small>Legacy records: {p.legacyPricingIds.join(', ')}</small>
                              )}
                            </p>
                          ))}
                        </details>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <details>
            <summary>Benchmarks ({model.benchmarks.length})</summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Benchmark / version</th>
                    <th>Category</th>
                    <th>Score</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {model.benchmarks.map((b, index) => (
                    <tr key={index}>
                      <td>
                        {b.name}
                        <small>{b.version ?? 'Version unspecified'}</small>
                      </td>
                      <td>{b.category}</td>
                      <td>
                        {b.score} {b.unit}
                      </td>
                      <td className="preserve">{b.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <details>
            <summary>Context, capabilities and modalities</summary>
            <p>
              Context: {model.context.windowTokens.toLocaleString()} tokens · output maximum:{' '}
              {model.context.maxOutputTokens.toLocaleString()} · knowledge cutoff:{' '}
              {model.context.knowledgeCutoff}
            </p>
            <p>Capabilities: {model.capabilities.join(', ')}</p>
            <p>
              Modalities:{' '}
              {Object.entries(model.modalities)
                .filter(([, supported]) => supported)
                .map(([name]) => name)
                .join(', ')}
            </p>
          </details>
        </section>
      ))}
    </>
  )
}
