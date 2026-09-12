import type { Dataset, Pricing as Price } from '../../../shared/types'
import { reconcileLegacyPricing } from '../../../shared/registry'
import { money } from '../../../shared/metrics'
import { displayDate } from '../../../shared/presentation'
import { Empty } from '../components/ui'

export function Pricing({
  data,
  onEdit,
  onDelete
}: {
  data: Dataset
  onEdit: (price?: Price) => void
  onDelete: (price: Price) => void
}): React.JSX.Element {
  const reconciliation = data.registry
    ? reconcileLegacyPricing(data.registry, data.pricing).records.map((record) => {
        const installed = data.registry!.models.some((model) =>
          model.offers.some((offer) =>
            offer.pricingHistory.some((price) => price.legacyPricingIds?.includes(record.pricingId))
          )
        )
        return record.status === 'migrated' && !installed
          ? {
              ...record,
              status: 'migration available',
              detail: 'Will migrate on the next registry installation; originals retained.'
            }
          : record
      })
    : []
  const unpriced = data.runs.filter((r) => !r.priceSnapshot).length
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Historical rates, durable costs</p>
          <h1>Pricing history</h1>
          <p className="muted">
            Legacy pricing records are retained here. Manage registered model rates in Model
            Registry.
          </p>
        </div>
        <button className="primary" onClick={() => onEdit()}>
          + Add price
        </button>
      </div>
      <div className="notice">
        <strong>Registry offers take precedence.</strong> Equivalent legacy rates are reconciled;
        safe earlier history is migrated when a registry is installed. Conflicting rows stay here
        for review. Exact legacy lookup remains available only for model/provider pairs without a
        registry offer. Existing snapshots retain their evidence.
      </div>
      {unpriced > 0 && (
        <p className="notice">
          {unpriced} {unpriced === 1 ? 'run has' : 'runs have'} no pricing snapshot. Registry
          installation and telemetry edits backfill eligible runs automatically. Missing or
          ambiguous identity and missing dates remain unresolved.
        </p>
      )}
      <section className="panel">
        {!data.pricing.length ? (
          <Empty
            title="Add your first historical price"
            action={<button onClick={() => onEdit()}>Add price</button>}
          >
            Enter rates from your provider’s pricing source. PennyTel does not invent prices or
            fetch live rates.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Model / provider</th>
                  <th>Effective (UTC)</th>
                  <th>Input / million</th>
                  <th>Cached / million</th>
                  <th>Output / million</th>
                  <th>Saved snapshots</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.pricing
                  .slice()
                  .sort(
                    (a, b) =>
                      a.model.localeCompare(b.model) ||
                      b.effectiveDate.localeCompare(a.effectiveDate)
                  )
                  .map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.model}</strong>
                        <small>{p.provider}</small>
                        {p.source && <small className="preserve">Source: {p.source}</small>}
                        {reconciliation.find((r) => r.pricingId === p.id) && (
                          <small>
                            Registry: {reconciliation.find((r) => r.pricingId === p.id)!.status} ·{' '}
                            {reconciliation.find((r) => r.pricingId === p.id)!.detail}
                          </small>
                        )}
                        {p.notes && <small className="preserve">{p.notes}</small>}
                      </td>
                      <td>
                        <time dateTime={p.effectiveDate}>{displayDate(p.effectiveDate)}</time>
                      </td>
                      <td>{money(p.inputRate)}</td>
                      <td>{money(p.cachedRate)}</td>
                      <td>{money(p.outputRate)}</td>
                      <td>{data.runs.filter((r) => r.priceSnapshot?.pricingId === p.id).length}</td>
                      <td>
                        <div className="button-row">
                          <button onClick={() => onEdit(p)}>Edit price</button>
                          <button className="danger-link" onClick={() => onDelete(p)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel prose">
        <h2>How run cost is calculated</h2>
        <code>
          (fresh input × input rate + cached input × cached rate + output × output rate) / 1,000,000
        </code>
        <p>
          Input tokens are fresh / noncached input. Cached input is additional. Output tokens
          include reasoning tokens, so reasoning is never added a second time. All three token
          counts and a saved price are needed for a complete cost. Zero is a value; blank is
          unknown.
        </p>
        <p>
          Subscription meter burn is a separate measure and is never presented as dollars. Use a
          remaining-percentage meter: 94% before → 92% after means 2 percentage points burned. Mark
          resets between readings; only an explicit measured burn is used across a reset.
        </p>
      </section>
    </>
  )
}
