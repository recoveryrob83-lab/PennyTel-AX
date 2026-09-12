import { fields } from './fields'
import { applicablePrice } from './metrics'
import {
  emptyDataset,
  TABLES,
  type Dataset,
  type Entity,
  type ImportPreview,
  type Mutation,
  type PriceSnapshot,
  type Run,
  type Table
} from './types'

function fail(message: string): never {
  throw new Error(message)
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function validDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  )
}
function validTimestamp(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value) &&
    validDate(value.slice(0, 10)) &&
    Number.isFinite(Date.parse(value))
  )
}
function nonnegative(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
  )
}
export function validateRecord(table: Table, value: unknown): asserts value is Entity {
  if (!object(value)) fail(`${table}: record must be an object.`)
  const prefix = `${table} ${String(value.id ?? '(new)')}`
  const allowed = new Set([
    ...fields[table].map((f) => f.key),
    ...(table === 'runs' ? ['priceSnapshot'] : [])
  ])
  for (const key of Object.keys(value))
    if (!allowed.has(key)) fail(`${prefix}: unknown field “${key}”. Check the import contract.`)
  for (const field of fields[table]) {
    const v = value[field.key]
    if (v === undefined) {
      if (field.required) fail(`${prefix}: ${field.label} is required.`)
      continue
    }
    if (field.type === 'number') {
      if (
        !nonnegative(v) ||
        (field.integer && !Number.isSafeInteger(v)) ||
        (field.min !== undefined && (v as number) < field.min) ||
        (field.max !== undefined && (v as number) > field.max)
      )
        fail(
          `${prefix}: ${field.label} must be a nonnegative ${field.integer ? 'whole ' : ''}number${field.min !== undefined ? ` at least ${field.min}` : ''}${field.max !== undefined ? ` no greater than ${field.max}` : ''}.`
        )
    } else if (field.type === 'boolean') {
      if (typeof v !== 'boolean') fail(`${prefix}: ${field.label} must be true or false.`)
    } else {
      if (typeof v !== 'string' || !v.trim() || v.length > 100_000)
        fail(
          `${prefix}: ${field.label} must be nonempty text (max 100,000 characters). Omit unknown values.`
        )
      if (field.options && !field.options.includes(v as string))
        fail(`${prefix}: invalid ${field.label} “${v}”.`)
      if (field.type === 'date' && !validDate(v as string))
        fail(`${prefix}: ${field.label} must be a valid YYYY-MM-DD date.`)
      if (field.type === 'timestamp' && !validTimestamp(v as string))
        fail(`${prefix}: ${field.label} must be a valid ISO timestamp including timezone.`)
    }
  }
  if (typeof value.id !== 'string' || value.id !== value.id.trim() || value.id.length > 200)
    fail(`${prefix}: ID must have no surrounding spaces and be at most 200 characters.`)
  if (table === 'runs') {
    const run = value as unknown as Run
    if (run.startAt && run.endAt && Date.parse(run.endAt) < Date.parse(run.startAt))
      fail(`${prefix}: end timestamp precedes start.`)
    if (
      run.reasoningTokens !== undefined &&
      run.outputTokens !== undefined &&
      run.reasoningTokens > run.outputTokens
    )
      fail(`${prefix}: reasoning tokens exceed total output tokens.`)
    const overrides = [run.inputRate, run.cachedRate, run.outputRate]
    if (overrides.some((v) => v !== undefined) && !overrides.every((v) => v !== undefined))
      fail(`${prefix}: provide all three rate overrides, or leave all blank.`)
    if (run.priceSnapshot !== undefined) {
      const p = run.priceSnapshot
      if (
        !object(p) ||
        Object.keys(p).some(
          (k) =>
            ![
              'model',
              'provider',
              'effectiveDate',
              'pricingId',
              'source',
              'rateSource',
              'inputRate',
              'cachedRate',
              'outputRate'
            ].includes(k)
        ) ||
        ![p.inputRate, p.cachedRate, p.outputRate].every(nonnegative) ||
        !['Catalog', 'Override'].includes(p.source) ||
        (p.effectiveDate !== undefined && !validDate(p.effectiveDate)) ||
        typeof p.model !== 'string' ||
        typeof p.provider !== 'string' ||
        p.model !== (run.model ?? '') ||
        p.provider !== (run.provider ?? '') ||
        (p.pricingId !== undefined && typeof p.pricingId !== 'string') ||
        (p.rateSource !== undefined &&
          (typeof p.rateSource !== 'string' ||
            !p.rateSource.trim() ||
            p.rateSource.length > 100_000))
      )
        fail(`${prefix}: invalid or mismatched pricing snapshot.`)
      if (
        p.source === 'Catalog' &&
        (!run.startAt ||
          !p.effectiveDate ||
          p.effectiveDate > new Date(run.startAt).toISOString().slice(0, 10))
      )
        fail(`${prefix}: catalog snapshot is later than the run or run date is missing.`)
      if (
        overrides.every((v) => v !== undefined) &&
        (p.inputRate !== run.inputRate ||
          p.cachedRate !== run.cachedRate ||
          p.outputRate !== run.outputRate ||
          p.source !== 'Override')
      )
        fail(`${prefix}: pricing snapshot differs from rate overrides.`)
    }
  }
}
export function validateDataset(value: unknown): asserts value is Dataset {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0
  )
    fail('Unsupported dataset. Expected schemaVersion 1 and a nonnegative integer revision.')
  if (Object.keys(value).some((k) => !['schemaVersion', 'revision', ...TABLES].includes(k)))
    fail('Dataset contains unknown top-level fields.')
  for (const table of TABLES) {
    if (!Array.isArray(value[table])) fail(`Dataset must contain a ${table} array.`)
    const ids = new Set<string>()
    for (const row of value[table] as unknown[]) {
      validateRecord(table, row)
      if (ids.has(row.id)) fail(`${table}: duplicate ID “${row.id}”.`)
      ids.add(row.id)
    }
  }
  const data = value as unknown as Dataset
  for (const table of ['runs', 'findings', 'discoveries'] as const) {
    for (const row of data[table]) {
      if (!data.slices.some((s) => s.id === row.sliceId))
        fail(`${table} ${row.id}: slice “${row.sliceId}” does not exist.`)
      if (table !== 'runs') {
        for (const key of ['runId', 'repairRunId']) {
          const runId = (row as unknown as Record<string, unknown>)[key]
          if (
            runId !== undefined &&
            !data.runs.some((r) => r.id === runId && r.sliceId === row.sliceId)
          )
            fail(`${table} ${row.id}: ${key} must reference a run in the same slice.`)
        }
      }
    }
  }
  for (const slice of data.slices) {
    if (slice.acceptedAt && slice.startDate && slice.acceptedAt.slice(0, 10) < slice.startDate)
      fail(`Slice ${slice.id}: acceptance precedes start date.`)
    if (
      slice.acceptedAt &&
      data.runs.some(
        (r) =>
          r.sliceId === slice.id &&
          r.startAt &&
          r.endAt &&
          Date.parse(r.startAt) <= Date.parse(slice.acceptedAt!) &&
          Date.parse(r.endAt) > Date.parse(slice.acceptedAt!)
      )
    )
      fail(
        `Slice ${slice.id}: a run crosses acceptance. Correct its timestamps or the acceptance timestamp.`
      )
  }
  const prices = new Set<string>()
  for (const p of data.pricing) {
    const key = JSON.stringify([p.model, p.provider, p.effectiveDate])
    if (prices.has(key))
      fail('Pricing: only one price per exact model, provider, and effective date is allowed.')
    prices.add(key)
  }
}
export function snapshotRun(run: Run, data: Dataset, previous?: Run): Run {
  const identityKeys = [
    'model',
    'provider',
    'startAt',
    'inputRate',
    'cachedRate',
    'outputRate'
  ] as const
  if (previous?.priceSnapshot && identityKeys.every((k) => previous[k] === run[k]))
    return { ...run, priceSnapshot: previous.priceSnapshot }
  const next = { ...run }
  delete next.priceSnapshot
  if (run.inputRate !== undefined && run.cachedRate !== undefined && run.outputRate !== undefined) {
    next.priceSnapshot = {
      model: run.model ?? '',
      provider: run.provider ?? '',
      ...(run.startAt ? { effectiveDate: new Date(run.startAt).toISOString().slice(0, 10) } : {}),
      inputRate: run.inputRate,
      cachedRate: run.cachedRate,
      outputRate: run.outputRate,
      source: 'Override'
    }
  } else {
    const price = applicablePrice(run, data.pricing)
    if (price) {
      const { id, model, provider, effectiveDate, inputRate, cachedRate, outputRate, source } =
        price
      next.priceSnapshot = {
        pricingId: id,
        model,
        provider,
        effectiveDate,
        inputRate,
        cachedRate,
        outputRate,
        source: 'Catalog',
        ...(source ? { rateSource: source } : {})
      } satisfies PriceSnapshot
    }
  }
  return next
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`
  return JSON.stringify(value)
}
export function mergeImport(
  current: Dataset,
  text: string
): { data: Dataset; preview: ImportPreview } {
  if (text.length > 10_000_000) fail('Import exceeds the 10 MB limit.')
  let input: unknown
  try {
    input = JSON.parse(text)
  } catch {
    fail('Invalid JSON. Paste or select a PennyTel dataset export.')
  }
  if (object(input) && input.kind === 'pennytel-comparison')
    fail(
      'Comparison exports are derived analysis, not importable telemetry. Select an Export dataset JSON file instead.'
    )
  if (!object(input) || input.schemaVersion !== 1) fail('Import requires schemaVersion: 1.')
  const incoming = { ...emptyDataset(), ...input, revision: 0 }
  // Check each record first, then relationships against the combined dataset.
  for (const key of Object.keys(incoming))
    if (!['schemaVersion', 'revision', ...TABLES].includes(key))
      fail(`Unknown import field “${key}”.`)
  const next = structuredClone(current)
  const preview: ImportPreview = {
    counts: { slices: 0, runs: 0, findings: 0, discoveries: 0, pricing: 0 },
    skipped: 0
  }
  for (const table of TABLES) {
    if (!Array.isArray(incoming[table])) fail(`Import ${table} must be an array.`)
    const seen = new Set<string>()
    for (const row of incoming[table]) {
      validateRecord(table, row)
      if (seen.has(row.id)) fail(`Import ${table}: duplicate ID “${row.id}”.`)
      seen.add(row.id)
      const existing = (next[table] as Entity[]).find((r) => r.id === row.id)
      if (existing) {
        if (canonical(existing) !== canonical(row))
          fail(
            `${table} ${row.id}: conflicts with an existing record. Edit it in PennyTel, or assign a new ID and update its relationships before importing.`
          )
        preview.skipped++
      } else {
        ;(next[table] as Entity[]).push(row)
        preview.counts[table]++
      }
    }
  }
  validateDataset(next)
  // Freeze rates only for newly imported runs; existing histories remain intact.
  next.runs = next.runs.map((r) =>
    !current.runs.some((old) => old.id === r.id) && !r.priceSnapshot ? snapshotRun(r, next) : r
  )
  validateDataset(next)
  return { data: next, preview }
}
export function applyMutation(current: Dataset, command: Mutation): Dataset {
  if (!command || command.revision !== current.revision)
    fail(
      'The dataset changed since this view loaded. Reload before saving; your draft is still open.'
    )
  let next = structuredClone(current)
  if (command.kind === 'import') {
    if (typeof command.text !== 'string') fail('Import must be text.')
    next = mergeImport(current, command.text).data
  } else if (command.kind === 'save' || command.kind === 'delete') {
    if (!TABLES.includes(command.table)) fail('Unknown record type.')
    const rows = next[command.table] as Entity[]
    if (command.kind === 'save') {
      const clean = structuredClone(command.record)
      // Only the main process decides snapshots for interactive saves.
      if (command.table === 'runs' && object(clean)) delete clean.priceSnapshot
      validateRecord(command.table, clean)
      const record =
        command.table === 'runs'
          ? snapshotRun(
              clean as Run,
              next,
              current.runs.find((r) => r.id === clean.id)
            )
          : clean
      const index = rows.findIndex((r) => r.id === record.id)
      if (index < 0) rows.push(record)
      else rows[index] = record
    } else {
      const index = rows.findIndex((r) => r.id === command.id)
      if (index < 0) fail('Record no longer exists.')
      if (
        command.table === 'slices' &&
        [...next.runs, ...next.findings, ...next.discoveries].some((r) => r.sliceId === command.id)
      )
        fail('This slice has related records. Remove those records first; nothing was deleted.')
      if (
        command.table === 'runs' &&
        [...next.findings, ...next.discoveries].some(
          (r) => r.runId === command.id || ('repairRunId' in r && r.repairRunId === command.id)
        )
      )
        fail(
          'This run is referenced by a finding or discovery. Update those links first; nothing was deleted.'
        )
      rows.splice(index, 1)
    }
  } else fail('Unknown operation.')
  next.revision = current.revision + 1
  validateDataset(next)
  return next
}
