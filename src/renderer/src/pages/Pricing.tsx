import type { Dataset, Pricing as Price } from '../../../shared/types'
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
  const unpriced = data.runs.filter((r) => !r.priceSnapshot).length
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Historical rates, durable costs</p>
          <h1>Pricing history</h1>
          <p className="muted">
            Maintain the API-equivalent USD rates that were effective when the work ran.
          </p>
        </div>
        <button className="primary" onClick={() => onEdit()}>
          + Add price
        </button>
      </div>
      <div className="notice">
        <strong>Runs keep a snapshot.</strong> On save, the latest price effective on or before the
        run’s UTC start date is selected by exact model and provider. Editing a price affects future
        snapshots. Use a run’s three rate overrides for an explicit historical correction.
      </div>
      {unpriced > 0 && (
        <p className="notice">
          {unpriced} {unpriced === 1 ? 'run has' : 'runs have'} no pricing snapshot. After adding a
          matching price, edit and save those runs to attach it. Rates require exact model,
          provider, and a start timestamp.
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
