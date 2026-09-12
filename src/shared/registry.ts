import type { Dataset, PriceSnapshot, Pricing, Run, Slice } from './types'

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type RegistryStatus = 'active' | 'preview' | 'deprecated' | 'retired' | 'inactive'
export interface Maker {
  id: string
  name: string
  aliases?: string[]
}
export interface Provider extends Maker {
  type: 'first_party_api' | 'third_party_api' | 'gateway' | 'local' | 'subscription'
}
export interface Benchmark {
  name: string
  version: string | null
  category: string
  score: number
  unit: string
  source: string
}
export interface RegistryPrice {
  effectiveFrom: string
  effectiveTo?: string | null
  currency: 'USD'
  unit: 'per_1m_tokens'
  inputUsd: number
  cachedInputUsd: number
  // Legacy pricing has no cache-write measurement. Never invent that rate.
  cacheWriteUsd?: number
  outputUsd: number
  source: string
  legacyPricingIds?: string[]
}
export interface ProviderOffer {
  id: string
  providerId: string
  providerModelId: string
  status: RegistryStatus
  pricingHistory: RegistryPrice[]
}
export interface RegistryModel {
  id: string
  canonicalName: string
  apiModelId: string
  makerId: string
  family: string
  tier: string
  aliases: string[]
  status: RegistryStatus
  reasoning: { supported: boolean; effortLevels: ReasoningEffort[] }
  context: { windowTokens: number; maxOutputTokens: number; knowledgeCutoff: string }
  modalities: {
    textInput: boolean
    textOutput: boolean
    imageInput: boolean
    audioInput: boolean
    videoInput: boolean
  }
  capabilities: string[]
  benchmarks: Benchmark[]
  offers: ProviderOffer[]
}
export interface ModelRegistry {
  kind: 'pennytel-model-registry'
  schemaVersion: 1
  registryRevision: number
  updatedAt: string
  description: string
  pricingResolutionPolicy: {
    rule: string
    snapshotOnUse: true
    historicalSnapshotsImmutable: true
    pricingReferencePreference: ['run.startAt', 'run.pricingReferenceDate', 'slice.startDate']
    notes: string
  }
  makers: Maker[]
  providers: Provider[]
  models: RegistryModel[]
}

export function validDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  )
}
function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`)
}
function shape(
  value: unknown,
  path: string,
  required: string[],
  optional: string[] = []
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected an object.')
  const row = value as Record<string, unknown>
  for (const key of Object.keys(row))
    if (![...required, ...optional].includes(key))
      fail(`${path}.${key}`, 'unknown field. Check the registry contract.')
  for (const key of required)
    if (row[key] === undefined) fail(`${path}.${key}`, 'required field is missing.')
  return row
}
function text(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100_000)
    fail(path, 'expected nonempty text (maximum 100,000 characters).')
}
function id(value: unknown, path: string): asserts value is string {
  text(value, path)
  if (value.trim() !== value || value.length > 200)
    fail(path, 'ID must have no surrounding whitespace and be at most 200 characters.')
}
function number(value: unknown, path: string, integer = false): void {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER ||
    (integer && !Number.isSafeInteger(value))
  )
    fail(path, `expected a nonnegative finite ${integer ? 'integer' : 'number'}.`)
}
function date(value: unknown, path: string): void {
  if (!validDate(value)) fail(path, 'expected a valid YYYY-MM-DD date.')
}
function boolean(value: unknown, path: string): void {
  if (typeof value !== 'boolean') fail(path, 'expected true or false.')
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'expected an array.')
  return value
}
function strings(value: unknown, path: string): string[] {
  const values = array(value, path)
  values.forEach((v, i) => text(v, `${path}[${i}]`))
  if (new Set(values).size !== values.length) fail(path, 'duplicate value.')
  return values as string[]
}
function oneOf(value: unknown, values: readonly unknown[], path: string): void {
  if (!values.includes(value)) fail(path, `expected one of ${values.join(', ')}.`)
}
function unique(value: unknown, ids: Set<string>, path: string): void {
  id(value, path)
  if (ids.has(value)) fail(path, `duplicate ID “${value}”.`)
  ids.add(value)
}
const statuses = ['active', 'preview', 'deprecated', 'retired', 'inactive']
export function validateRegistry(value: unknown): asserts value is ModelRegistry {
  const root = 'Registry'
  const r = shape(value, root, [
    'kind',
    'schemaVersion',
    'registryRevision',
    'updatedAt',
    'description',
    'pricingResolutionPolicy',
    'makers',
    'providers',
    'models'
  ])
  oneOf(r.kind, ['pennytel-model-registry'], `${root}.kind`)
  oneOf(r.schemaVersion, [1], `${root}.schemaVersion`)
  number(r.registryRevision, `${root}.registryRevision`, true)
  date(r.updatedAt, `${root}.updatedAt`)
  text(r.description, `${root}.description`)
  const policy = shape(r.pricingResolutionPolicy, `${root}.pricingResolutionPolicy`, [
    'rule',
    'snapshotOnUse',
    'historicalSnapshotsImmutable',
    'pricingReferencePreference',
    'notes'
  ])
  for (const key of ['rule', 'notes']) text(policy[key], `${root}.pricingResolutionPolicy.${key}`)
  for (const key of ['snapshotOnUse', 'historicalSnapshotsImmutable'])
    oneOf(policy[key], [true], `${root}.pricingResolutionPolicy.${key}`)
  if (
    JSON.stringify(policy.pricingReferencePreference) !==
    JSON.stringify(['run.startAt', 'run.pricingReferenceDate', 'slice.startDate'])
  )
    fail(
      `${root}.pricingResolutionPolicy.pricingReferencePreference`,
      'expected run.startAt, run.pricingReferenceDate, slice.startDate in that order.'
    )
  const makers = new Set<string>(),
    providers = new Set<string>(),
    models = new Set<string>(),
    offers = new Set<string>()
  for (const [table, ids] of [
    ['makers', makers],
    ['providers', providers]
  ] as const) {
    array(r[table], `${root}.${table}`).forEach((value, index) => {
      const path = `${root}.${table}[${index}]`
      const row = shape(
        value,
        path,
        table === 'providers' ? ['id', 'name', 'type'] : ['id', 'name'],
        ['aliases']
      )
      unique(row.id, ids, `${path}.id`)
      text(row.name, `${path}.name`)
      if (row.aliases !== undefined) strings(row.aliases, `${path}.aliases`)
      if (table === 'providers')
        oneOf(
          row.type,
          ['first_party_api', 'third_party_api', 'gateway', 'local', 'subscription'],
          `${path}.type`
        )
    })
  }
  array(r.models, `${root}.models`).forEach((value, index) => {
    const path = `${root}.models[${index}]`
    const m = shape(value, path, [
      'id',
      'canonicalName',
      'apiModelId',
      'makerId',
      'family',
      'tier',
      'aliases',
      'status',
      'reasoning',
      'context',
      'modalities',
      'capabilities',
      'benchmarks',
      'offers'
    ])
    unique(m.id, models, `${path}.id`)
    for (const key of ['canonicalName', 'apiModelId', 'family', 'tier'])
      text(m[key], `${path}.${key}`)
    if (!makers.has(m.makerId as string)) fail(`${path}.makerId`, 'unknown maker reference.')
    strings(m.aliases, `${path}.aliases`)
    strings(m.capabilities, `${path}.capabilities`)
    oneOf(m.status, statuses, `${path}.status`)
    const reasoning = shape(m.reasoning, `${path}.reasoning`, ['supported', 'effortLevels'])
    boolean(reasoning.supported, `${path}.reasoning.supported`)
    const efforts = strings(reasoning.effortLevels, `${path}.reasoning.effortLevels`)
    efforts.forEach((effort) =>
      oneOf(
        effort,
        ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
        `${path}.reasoning.effortLevels`
      )
    )
    if (
      (!reasoning.supported && efforts.some((e) => e !== 'none')) ||
      (reasoning.supported && !efforts.length)
    )
      fail(`${path}.reasoning`, 'effort levels disagree with supported flag.')
    const context = shape(m.context, `${path}.context`, [
      'windowTokens',
      'maxOutputTokens',
      'knowledgeCutoff'
    ])
    for (const key of ['windowTokens', 'maxOutputTokens']) {
      number(context[key], `${path}.context.${key}`, true)
      if (context[key] === 0) fail(`${path}.context.${key}`, 'must be positive.')
    }
    if ((context.maxOutputTokens as number) > (context.windowTokens as number))
      fail(`${path}.context`, 'maxOutputTokens exceeds windowTokens.')
    date(context.knowledgeCutoff, `${path}.context.knowledgeCutoff`)
    const modalities = shape(m.modalities, `${path}.modalities`, [
      'textInput',
      'textOutput',
      'imageInput',
      'audioInput',
      'videoInput'
    ])
    Object.entries(modalities).forEach(([key, value]) =>
      boolean(value, `${path}.modalities.${key}`)
    )
    array(m.benchmarks, `${path}.benchmarks`).forEach((value, i) => {
      const at = `${path}.benchmarks[${i}]`
      const b = shape(value, at, ['name', 'version', 'category', 'score', 'unit', 'source'])
      for (const key of ['name', 'category', 'unit', 'source']) text(b[key], `${at}.${key}`)
      if (b.version !== null) text(b.version, `${at}.version`)
      number(b.score, `${at}.score`)
      if (b.unit === 'percent' && (b.score as number) > 100)
        fail(`${at}.score`, 'percent score exceeds 100.')
    })
    const modelProviders = new Set<string>()
    array(m.offers, `${path}.offers`).forEach((value, i) => {
      const at = `${path}.offers[${i}]`
      const o = shape(value, at, [
        'id',
        'providerId',
        'providerModelId',
        'status',
        'pricingHistory'
      ])
      unique(o.id, offers, `${at}.id`)
      if (!providers.has(o.providerId as string))
        fail(`${at}.providerId`, 'unknown provider reference.')
      if (modelProviders.has(o.providerId as string))
        fail(`${at}.providerId`, 'ambiguous duplicate model/provider offer.')
      modelProviders.add(o.providerId as string)
      text(o.providerModelId, `${at}.providerModelId`)
      oneOf(o.status, statuses, `${at}.status`)
      const dates = new Set<string>()
      array(o.pricingHistory, `${at}.pricingHistory`).forEach((value, j) => {
        const p = `${at}.pricingHistory[${j}]`
        const price = shape(
          value,
          p,
          [
            'effectiveFrom',
            'currency',
            'unit',
            'inputUsd',
            'cachedInputUsd',
            'outputUsd',
            'source'
          ],
          ['effectiveTo', 'cacheWriteUsd', 'legacyPricingIds']
        )
        date(price.effectiveFrom, `${p}.effectiveFrom`)
        if (dates.has(price.effectiveFrom as string))
          fail(`${p}.effectiveFrom`, 'ambiguous duplicate effective pricing date.')
        dates.add(price.effectiveFrom as string)
        if (price.effectiveTo !== undefined && price.effectiveTo !== null) {
          date(price.effectiveTo, `${p}.effectiveTo`)
          if ((price.effectiveTo as string) <= (price.effectiveFrom as string))
            fail(`${p}.effectiveTo`, 'must be after effectiveFrom (exclusive end).')
        }
        oneOf(price.currency, ['USD'], `${p}.currency`)
        oneOf(price.unit, ['per_1m_tokens'], `${p}.unit`)
        for (const key of ['inputUsd', 'cachedInputUsd', 'outputUsd'])
          number(price[key], `${p}.${key}`)
        if (price.cacheWriteUsd !== undefined) number(price.cacheWriteUsd, `${p}.cacheWriteUsd`)
        text(price.source, `${p}.source`)
        if (price.legacyPricingIds !== undefined) {
          const ids = strings(price.legacyPricingIds, `${p}.legacyPricingIds`)
          if (!ids.length) fail(`${p}.legacyPricingIds`, 'must not be empty.')
          ids.forEach((value) => id(value, `${p}.legacyPricingIds`))
        }
      })
    })
  })
}
export function parseRegistry(text: string): ModelRegistry {
  if (typeof text !== 'string') throw new Error('Registry import must be text.')
  if (text.length > 10_000_000) throw new Error('Registry import exceeds the 10 MB limit.')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('Invalid registry JSON.')
  }
  validateRegistry(value)
  return value
}
const normalized = (value: string): string => value.trim().toLowerCase()
const matches = (value: string, names: string[]): boolean =>
  names.some((name) => normalized(name) === normalized(value))
export interface RegistryIdentity {
  model: RegistryModel
  provider: Provider
  offer: ProviderOffer
}
export function identityCandidates(
  run: Pick<Run, 'model' | 'provider' | 'modelId' | 'providerId'>,
  registry: ModelRegistry
): RegistryIdentity[] {
  const candidates: RegistryIdentity[] = []
  for (const model of registry.models) {
    for (const offer of model.offers) {
      if (
        run.modelId
          ? run.modelId !== model.id
          : !run.model ||
            !matches(run.model, [
              model.id,
              model.canonicalName,
              model.apiModelId,
              ...model.aliases,
              offer.providerModelId
            ])
      )
        continue
      const provider = registry.providers.find((p) => p.id === offer.providerId)!
      const maker = registry.makers.find((m) => m.id === model.makerId)!
      // A maker name is a compatibility alias only for that model's first-party API.
      const names = [
        provider.id,
        provider.name,
        ...(provider.aliases ?? []),
        ...(provider.type === 'first_party_api'
          ? [maker.id, maker.name, ...(maker.aliases ?? [])]
          : [])
      ]
      if (
        run.providerId
          ? run.providerId !== provider.id
          : !run.provider || !matches(run.provider, names)
      )
        continue
      candidates.push({ model, provider, offer })
    }
  }
  return candidates
}
export function resolveIdentity(
  run: Pick<Run, 'model' | 'provider' | 'modelId' | 'providerId'>,
  registry: ModelRegistry
): RegistryIdentity | undefined {
  const candidates = identityCandidates(run, registry)
  return candidates.length === 1 ? candidates[0] : undefined
}
export function pricingReference(
  run: Run,
  slice?: Slice
):
  | { date: string; source: 'run.startAt' | 'run.pricingReferenceDate' | 'slice.startDate' }
  | undefined {
  if (run.startAt && Number.isFinite(Date.parse(run.startAt)))
    return { date: new Date(run.startAt).toISOString().slice(0, 10), source: 'run.startAt' }
  if (validDate(run.pricingReferenceDate))
    return { date: run.pricingReferenceDate, source: 'run.pricingReferenceDate' }
  if (validDate(slice?.startDate)) return { date: slice.startDate, source: 'slice.startDate' }
  return undefined
}
export function priceAt(offer: ProviderOffer, date: string): RegistryPrice | undefined {
  return offer.pricingHistory
    .filter((p) => p.effectiveFrom <= date && (!p.effectiveTo || date < p.effectiveTo))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]
}
export function registrySnapshot(
  run: Run,
  registry: ModelRegistry,
  slice?: Slice
): PriceSnapshot | undefined {
  const identity = resolveIdentity(run, registry),
    reference = pricingReference(run, slice)
  if (!identity || !reference) return undefined
  const price = priceAt(identity.offer, reference.date)
  if (!price) return undefined
  return {
    source: 'Registry',
    model: run.model ?? '',
    provider: run.provider ?? '',
    modelId: identity.model.id,
    providerId: identity.provider.id,
    offerId: identity.offer.id,
    registryRevision: registry.registryRevision,
    effectiveDate: price.effectiveFrom,
    referenceDate: reference.date,
    referenceDateSource: reference.source,
    inputRate: price.inputUsd,
    cachedRate: price.cachedInputUsd,
    outputRate: price.outputUsd,
    ...(price.cacheWriteUsd !== undefined ? { cacheWriteRate: price.cacheWriteUsd } : {}),
    rateSource: price.source
  }
}
export function backfillRegistry(data: Dataset): Dataset {
  if (!data.registry) return data
  const registry = data.registry
  return {
    ...data,
    runs: data.runs.map((run) => {
      const identity = resolveIdentity(run, registry)
      if (!identity) return run
      const next = { ...run, modelId: identity.model.id, providerId: identity.provider.id }
      if (!run.priceSnapshot && run.inputRate === undefined) {
        const snapshot = registrySnapshot(
          next,
          registry,
          data.slices.find((s) => s.id === run.sliceId)
        )
        if (snapshot) next.priceSnapshot = snapshot
      }
      return next
    })
  }
}
export interface LegacyReconciliation {
  pricingId: string
  status: 'migrated' | 'equivalent' | 'conflict' | 'legacy fallback' | 'unresolved'
  detail: string
}
export function reconcileLegacyPricing(
  input: ModelRegistry,
  pricing: Pricing[]
): { registry: ModelRegistry; records: LegacyReconciliation[] } {
  const registry = structuredClone(input)
  const records: LegacyReconciliation[] = []
  // Authored history owns every date from its first entry onward, including gaps.
  // Recheck existing migrations before the already-migrated fast path below.
  for (const model of registry.models) {
    for (const offer of model.offers) {
      const first = offer.pricingHistory
        .filter((row) => !row.legacyPricingIds)
        .map((row) => row.effectiveFrom)
        .sort()[0]
      if (!first) continue
      offer.pricingHistory = offer.pricingHistory.filter((row) => {
        if (!row.legacyPricingIds) return true
        if (row.effectiveFrom >= first) return false
        if (!row.effectiveTo || row.effectiveTo > first) row.effectiveTo = first
        return true
      })
    }
  }
  const matched = pricing.map((p) => ({ p, candidates: identityCandidates(p, registry) }))
  // Group before inserting: aliases can otherwise hide conflicting rates on one date.
  for (const { p, candidates } of matched) {
    const report = (status: LegacyReconciliation['status'], detail: string): void => {
      records.push({ pricingId: p.id, status, detail })
    }
    if (candidates.length !== 1) {
      report(
        candidates.length ? 'unresolved' : 'legacy fallback',
        candidates.length
          ? 'Ambiguous registry identity; no automatic resolution.'
          : 'No registry offer; exact legacy lookup remains available.'
      )
      continue
    }
    const offer = candidates[0].offer
    const peers = matched
      .filter(
        (m) =>
          m.candidates.length === 1 &&
          m.candidates[0].offer.id === offer.id &&
          m.p.effectiveDate === p.effectiveDate
      )
      .map((m) => m.p)
    const sameRates = (other: Pricing): boolean =>
      other.inputRate === p.inputRate &&
      other.cachedRate === p.cachedRate &&
      other.outputRate === p.outputRate
    if (!peers.every(sameRates)) {
      report('conflict', 'Legacy aliases disagree on this offer/date; retained without migration.')
      continue
    }
    const atDate = offer.pricingHistory.find((r) => r.effectiveFrom === p.effectiveDate)
    if (atDate) {
      const equal =
        atDate.inputUsd === p.inputRate &&
        atDate.cachedInputUsd === p.cachedRate &&
        atDate.outputUsd === p.outputRate
      report(
        equal ? (atDate.legacyPricingIds?.includes(p.id) ? 'migrated' : 'equivalent') : 'conflict',
        equal
          ? 'Equivalent rates already in registry history.'
          : 'Registry wins; conflicting legacy row retained.'
      )
      continue
    }
    // Only extend history before its first authored entry; never override a registry interval.
    const authored = offer.pricingHistory
      .filter((r) => !r.legacyPricingIds)
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
    const first = authored[0]?.effectiveFrom
    if (first && p.effectiveDate >= first) {
      report(
        'conflict',
        'Within registry history; legacy row retained without automatic migration.'
      )
      continue
    }
    const nextLegacy = matched
      .filter(
        (m) =>
          m.candidates.length === 1 &&
          m.candidates[0].offer.id === offer.id &&
          m.p.effectiveDate > p.effectiveDate
      )
      .map((m) => m.p.effectiveDate)
      .sort()[0]
    const end = [first, nextLegacy].filter((d): d is string => !!d).sort()[0]
    const sources = [...new Set(peers.flatMap((row) => (row.source ? [row.source] : [])))].sort()
    const source = `Legacy pricing: ${peers
      .map((row) => row.id)
      .sort()
      .join(', ')}${sources.length ? `; Sources: ${sources.join('; ')}` : ''}`
    if (source.length > 100_000) {
      report(
        'unresolved',
        'Combined migration provenance exceeds the source text limit; originals retained.'
      )
      continue
    }
    offer.pricingHistory.push({
      effectiveFrom: p.effectiveDate,
      effectiveTo: end ?? null,
      currency: 'USD',
      unit: 'per_1m_tokens',
      inputUsd: p.inputRate,
      cachedInputUsd: p.cachedRate,
      outputUsd: p.outputRate,
      source,
      legacyPricingIds: peers.map((r) => r.id).sort()
    })
    report('migrated', 'Historical gap before registry pricing; legacy originals retained.')
  }
  for (const model of registry.models)
    for (const offer of model.offers)
      offer.pricingHistory.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
  validateRegistry(registry)
  return { registry, records }
}
