// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { Compare } from '../src/renderer/src/pages/Compare'
import { comparisonFixture, runFixture } from './fixtures'
import { configurationFixture } from './configuration-fixtures'
import { modelConfiguration } from '../src/shared/configuration'
import App from '../src/renderer/src/App'
import { version } from '../package.json'
import acceptedFixture from './accepted-outcome-fixture.json'
import { validateDataset } from '../src/shared/data'
import { executionEvidenceCoverage } from '../src/shared/comparison'
import {
  compareData,
  MAX_COMPARISON_CANDIDATES,
  type ComparisonRequest
} from '../src/shared/comparison'

afterEach(cleanup)
describe('comparison UI uses shared cohort context', () => {
  it('shows stable IDs and None, Partial, Complete attachment coverage with a row-only filter', async () => {
    const data: unknown = structuredClone(acceptedFixture)
    validateDataset(data)
    data.slices[1].title = data.slices[0].title
    data.runs.find((run) => run.sliceId === 'mixed')!.executionEvidence = {
      kind: 'codex-rollout',
      formatVersion: 1
    }
    for (const run of data.runs.filter((run) => run.sliceId === 'one-shot'))
      run.executionEvidence = { kind: 'codex-rollout', formatVersion: 1 }
    const onOpenSlice = vi.fn()
    render(<Compare data={data} onOpenRun={vi.fn()} onOpenSlice={onOpenSlice} />)
    const region = within(screen.getByRole('region', { name: 'Accepted outcome comparison' }))
    expect(region.getAllByText('Slice ID: mixed')).toHaveLength(1)
    expect(region.getAllByText('Slice ID: one-shot')).toHaveLength(1)
    expect(executionEvidenceCoverage(data.runs.filter((run) => run.sliceId === 'mixed'))).toBe(
      'Partial'
    )
    expect(executionEvidenceCoverage(data.runs.filter((run) => run.sliceId === 'one-shot'))).toBe(
      'Complete'
    )
    expect(executionEvidenceCoverage([])).toBe('None')
    for (const id of ['empty', 'incomplete']) {
      const row = region.getByText(`Slice ID: ${id}`).closest('tr')!
      const cells = within(row).getAllByRole('cell')
      expect(cells).toHaveLength(2)
      expect(cells[0]).toHaveAttribute('colspan', '6')
      expect(cells[0]).toHaveTextContent('No execution evidence attached.')
      expect(cells[0].textContent?.match(/Unknown/g)).toHaveLength(1)
      expect(cells[1]).toHaveTextContent(`None0/${id === 'empty' ? 0 : 1} relevant runs attached`)
      expect(within(row).queryByText(/Repair cost:/)).toBeNull()
    }
    for (const [id, coverage, cost] of [
      ['mixed', 'Partial', '$2.5248'],
      ['one-shot', 'Complete', '$2.418']
    ]) {
      const row = region.getByText(`Slice ID: ${id}`).closest('tr')!
      expect(within(row).getAllByRole('cell')).toHaveLength(7)
      expect(row).toHaveTextContent(coverage)
      expect(row).toHaveTextContent(cost)
      expect(within(row).queryByText('No execution evidence attached.')).toBeNull()
    }
    const summary = screen.getByText(/Inspect lifecycle · Incomplete accepted lifecycle/)
    await userEvent.click(summary)
    expect(
      within(summary.closest('details')!).getByRole('table', {
        name: 'Lifecycle totals · Incomplete accepted lifecycle'
      })
    ).toBeVisible()
    await userEvent.selectOptions(screen.getByLabelText('Execution evidence coverage'), 'None')
    expect(region.queryByText('Slice ID: mixed')).toBeNull()
    expect(region.getByText('Slice ID: empty')).toBeVisible()
    expect(
      screen.getByText(/row filter does not change comparison calculations or exports/)
    ).toBeVisible()
  })
  it('shows outcome samples, cross-model lifecycle stages, token coverage and opens downstream source runs', async () => {
    const data: unknown = structuredClone(acceptedFixture)
    validateDataset(data)
    data.runs[0].executionEvidence = { kind: 'codex-rollout', formatVersion: 1 }
    const user = userEvent.setup()
    const onOpenRun = vi.fn()
    render(<Compare data={data} onOpenRun={onOpenRun} onOpenSlice={vi.fn()} />)
    await user.click(screen.getByText('Narrow the cohort'))
    await user.selectOptions(
      screen.getByLabelText('Filter Model Configuration'),
      modelConfiguration(data, data.runs[1]).key
    )
    await user.click(screen.getByRole('checkbox', { name: 'Implementation (role: Implementer)' }))
    const region = within(screen.getByRole('region', { name: 'Accepted outcome comparison' }))
    const mixed = region.getByRole('row', { name: /Cross-model accepted repair/ })
    expect(mixed).toHaveTextContent('$2.5248')
    expect(mixed).toHaveTextContent('1.2h6/6 recorded')
    expect(mixed).toHaveTextContent('1.5hFirst recorded start to acceptance')
    expect(mixed).toHaveTextContent('1 recorded repair runs')
    expect(mixed).toHaveTextContent('No: 5 · Yes: 1')
    const summary = screen.getByText(
      /Inspect lifecycle · Cross-model accepted repair · .* · 6 runs/
    )
    await user.click(summary)
    const detail = within(summary.closest('details')!)
    const stages = within(
      detail.getByRole('table', { name: 'Lifecycle stages · Cross-model accepted repair' })
    )
    for (const name of ['Context map', 'Independent critic', 'Repair', 'Re-critic', 'Verification'])
      expect(stages.getByRole('row', { name: new RegExp(`^${name}`) })).toBeVisible()
    expect(
      detail.getByRole('table', { name: 'Lifecycle totals · Cross-model accepted repair' })
    ).toHaveTextContent('3,302,400')
    expect(
      detail.getByRole('table', { name: 'Lifecycle totals · Cross-model accepted repair' })
    ).toHaveTextContent('17.5%')
    await user.click(detail.getByRole('button', { name: 'Repair' }))
    expect(onOpenRun).toHaveBeenCalledWith(data.runs.find((r) => r.id === 'luna-repair'))
  })
  it('visibly distinguishes Yes, No, Unknown, missing runtime telemetry and known zero outcomes', () => {
    const data: unknown = structuredClone(acceptedFixture)
    validateDataset(data)
    for (const run of data.runs) run.executionEvidence = { kind: 'codex-rollout', formatVersion: 1 }
    render(<Compare data={data} onOpenRun={vi.fn()} onOpenSlice={vi.fn()} />)
    const table = within(screen.getByRole('region', { name: 'Accepted outcome comparison' }))
    const cells = (name: string): HTMLElement[] =>
      Array.from(table.getByRole('row', { name: new RegExp(name) }).querySelectorAll('th, td'))
    expect(cells('Directly accepted implementation')[4]).toHaveTextContent(/^Yes/)
    expect(cells('Cross-model accepted repair')[4]).toHaveTextContent(/^No/)
    expect(cells('Incomplete accepted lifecycle')[4]).toHaveTextContent(/^Unknown/)
    expect(cells('Incomplete accepted lifecycle')[6]).toHaveTextContent(
      'Unknown0/1 recorded · incomplete'
    )
    expect(cells('Incomplete accepted lifecycle')[5]).toHaveTextContent('Total repairs: Unknown')
    expect(cells('Accepted with no recorded runs')[1]).toHaveTextContent(
      'No execution evidence attached.'
    )
    expect(cells('Recorded zero-cost acceptance')[1]).toHaveTextContent('$0.001/1 recorded')
    expect(screen.getByText(/Showing 5 of 5 accepted outcomes/)).toBeVisible()
  })
  it('selects 2 then 3+ configurations, scopes evidence, retains empty candidates and exports the shared workspace', async () => {
    const user = userEvent.setup()
    const data = configurationFixture()
    data.runs[0].runType = 'Verification'
    data.runs[1].runType = 'Re-critic'
    data.runs[0].filesChanged = 0
    data.runs[0].runtimeTested = false
    const exportComparison = vi.fn().mockResolvedValue('/qa/workspace.json')
    window.pennytel = { ...window.pennytel, exportComparison }
    const onOpenRun = vi.fn()
    render(<Compare data={data} onOpenRun={onOpenRun} onOpenSlice={vi.fn()} />)
    const labels = [
      'GPT-6 Astra — Low',
      'GPT-5.6 Luna — Max',
      'GPT-6 Astra — ExtraHigh / XHigh',
      'GPT-6 Astra — Unknown'
    ]
    for (const label of labels.slice(0, 2))
      await user.click(screen.getByRole('checkbox', { name: label }))
    const table = within(screen.getByRole('region', { name: 'Selected candidate comparison' }))
    expect(table.getAllByRole('columnheader')).toHaveLength(3)
    for (const label of labels.slice(2))
      await user.click(screen.getByRole('checkbox', { name: label }))
    expect(
      table
        .getAllByRole('columnheader')
        .slice(1)
        .map((cell) => cell.textContent)
    ).toEqual(labels.map((label, i) => `${label}${i ? 1 : 2} runs`))
    await user.click(screen.getByRole('checkbox', { name: 'Critic (role: Critic)' }))
    expect(table.getByRole('columnheader', { name: /GPT-6 Astra — Low/ })).toHaveTextContent(
      '0 runs / no evidence'
    )
    expect(table.getByRole('row', { name: /^API-equivalent cost/ })).toHaveTextContent('Unknown')
    await user.click(screen.getByRole('checkbox', { name: 'Implementation (role: Implementer)' }))
    expect(table.getByRole('columnheader', { name: /GPT-6 Astra — Low/ })).toHaveTextContent(
      '2 runs'
    )
    await user.click(screen.getByRole('button', { name: 'Clear stage scope' }))
    await user.click(screen.getByRole('checkbox', { name: 'Recorded run type: Verification' }))
    await user.click(screen.getByText('Narrow the cohort'))
    await user.selectOptions(screen.getByLabelText('Filter Factory role'), 'Implementer')
    await user.selectOptions(screen.getByLabelText('Group runs by'), 'role')
    await user.selectOptions(screen.getByLabelText('Order groups'), 'time')
    await user.click(
      screen.getByRole('button', { name: /Implementer.*1\/1 priced/, pressed: false })
    )
    await user.click(screen.getByRole('button', { name: 'Export comparison' }))
    const request = exportComparison.mock.calls[0][0] as ComparisonRequest
    expect(request.context).toEqual({
      filters: { role: 'Implementer' },
      groupBy: 'role',
      sort: 'time',
      selectedGroup: 'Implementer',
      selectedCandidates: [0, 4, 2, 3].map((i) => modelConfiguration(data, data.runs[i]).key),
      stageScopes: [{ kind: 'runType', value: 'Verification' }]
    })
    expect(
      compareData(data, request.context).candidates.map((c) => c.runs.map((r) => r.id))
    ).toEqual([['low'], [], [], []])
    expect(table.getByRole('row', { name: /^Files changed/ })).toHaveTextContent('01/1 recorded')
    expect(table.getByRole('row', { name: /^Runtime tested/ })).toHaveTextContent('No: 1')
    await user.click(screen.getByText('Inspect evidence · GPT-6 Astra — Low · 1 runs'))
    const evidence = screen
      .getByText('Inspect evidence · GPT-6 Astra — Low · 1 runs')
      .closest('details')!
    await user.click(within(evidence).getByRole('button', { name: 'Verification' }))
    expect(onOpenRun).toHaveBeenCalledWith(data.runs[0])
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByRole('checkbox', { name: labels[0] })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Recorded run type: Verification' })).toBeChecked()
  })
  it('keeps colliding candidate labels keyed independently and offers no inferred stage', async () => {
    const user = userEvent.setup()
    const data = configurationFixture()
    data.runs = ['a', 'b'].map((id) => ({
      ...data.runs[0],
      id,
      modelId: `missing-${id}`,
      model: 'Same'
    }))
    render(<Compare data={data} onOpenRun={vi.fn()} onOpenSlice={vi.fn()} />)
    for (const [i, run] of data.runs.entries()) {
      const option = screen.getByRole('checkbox', { name: `Same — Low [${i + 1}]` })
      expect(option).toHaveAttribute('value', modelConfiguration(data, run).key)
      await user.click(option)
    }
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(2)
    expect(
      screen.queryByRole('checkbox', { name: /Re-critic|Verification/ })
    ).not.toBeInTheDocument()
    const region = within(screen.getByRole('region', { name: 'Selected candidate comparison' }))
    expect(region.getAllByRole('columnheader')).toHaveLength(3)
  })
  it('bounds candidate controls while allowing deselection at the limit', async () => {
    const user = userEvent.setup()
    const data = configurationFixture()
    data.runs = Array.from({ length: MAX_COMPARISON_CANDIDATES + 1 }, (_, i) =>
      runFixture({ id: String(i), model: `Model ${i}` })
    )
    render(<Compare data={data} onOpenRun={vi.fn()} onOpenSlice={vi.fn()} />)
    for (let i = 0; i < MAX_COMPARISON_CANDIDATES; i++)
      await user.click(screen.getByRole('checkbox', { name: `Model ${i} — High` }))
    const last = screen.getByRole('checkbox', {
      name: `Model ${MAX_COMPARISON_CANDIDATES} — High`
    })
    expect(last).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: 'Model 0 — High' }))
    expect(last).toBeEnabled()
  })
  it('renders distinct colliding filter and group labels and preserves them after filtering', async () => {
    const user = userEvent.setup()
    const data = configurationFixture()
    data.runs = ['a', 'b'].map((id) => ({
      ...data.runs[0],
      id,
      modelId: `missing-${id}`,
      model: 'Same'
    }))
    render(<Compare data={data} onOpenRun={vi.fn()} onOpenSlice={vi.fn()} />)
    await user.click(screen.getByText('Narrow the cohort'))
    for (const dimension of ['modelConfiguration', 'canonicalModel'] as const) {
      await user.selectOptions(screen.getByLabelText('Group runs by'), dimension)
      const base = dimension === 'modelConfiguration' ? 'Same — Low' : 'Same'
      const filter = screen.getByLabelText(
        dimension === 'modelConfiguration'
          ? 'Filter Model Configuration'
          : 'Filter Model (canonical)'
      )
      for (const ordinal of [1, 2]) {
        const label = `${base} [${ordinal}]`
        const option = within(filter).getByRole('option', { name: label }) as HTMLOptionElement
        expect(
          screen.getByRole('button', {
            name: new RegExp(`${base} \\[${ordinal}\\]`),
            pressed: false
          })
        ).toBeVisible()
        await user.selectOptions(filter, option.value)
        expect(
          screen.getByRole('button', {
            name: new RegExp(`${base} \\[${ordinal}\\]`),
            pressed: false
          })
        ).toBeVisible()
        await user.selectOptions(filter, '')
      }
    }
  })
  it('shows distinct configuration choices, Unknown, rollups and selected configuration export', async () => {
    const user = userEvent.setup()
    const data = configurationFixture()
    const exportComparison = vi.fn().mockResolvedValue('/qa/configuration.json')
    window.pennytel = {
      load: vi.fn(),
      mutate: vi.fn(),
      openBatchImport: vi.fn(),
      commitBatchImport: vi.fn(),
      previewImport: vi.fn(),
      openImport: vi.fn(),
      exportData: vi.fn(),
      exportComparison,
      runComparisonPlan: vi.fn(),
      discoverCodexRuns: vi.fn(),
      importCodexRun: vi.fn(),
      createCodexSlice: vi.fn()
    }
    render(<Compare data={data} onOpenRun={vi.fn()} onOpenSlice={vi.fn()} />)
    expect(screen.getByLabelText('Group runs by')).toHaveValue('modelConfiguration')
    for (const label of [
      'GPT-6 Astra — Low',
      'GPT-6 Astra — ExtraHigh / XHigh',
      'GPT-6 Astra — Unknown',
      'GPT-5.6 Luna — Max',
      'GPT-5.6 Sol — High'
    ])
      expect(screen.getByRole('button', { name: new RegExp(label), pressed: false })).toBeVisible()
    await user.selectOptions(screen.getByLabelText('Group runs by'), 'canonicalModel')
    expect(screen.getByRole('button', { name: /GPT-6 Astra\s*4\/4 priced/ })).toBeVisible()
    await user.selectOptions(screen.getByLabelText('Group runs by'), 'modelFamily')
    expect(screen.getByRole('button', { name: /Astra\s*4\/4 priced/ })).toBeVisible()
    await user.selectOptions(screen.getByLabelText('Group runs by'), 'thinking')
    expect(screen.getByRole('button', { name: /Unknown\s*1\/1 priced/ })).toBeVisible()
    await user.selectOptions(screen.getByLabelText('Group runs by'), 'modelConfiguration')
    await user.click(screen.getByText('Narrow the cohort'))
    const key = modelConfiguration(data, data.runs[2]).key
    await user.selectOptions(screen.getByLabelText('Filter Model Configuration'), key)
    expect(screen.queryByRole('button', { name: /GPT-6 Astra — Low/ })).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: /GPT-6 Astra — ExtraHigh \/ XHigh/, pressed: false })
    )
    await user.click(screen.getByRole('button', { name: 'Export comparison' }))
    expect(exportComparison).toHaveBeenCalledWith({
      revision: data.revision,
      context: {
        filters: { modelConfiguration: key },
        groupBy: 'modelConfiguration',
        sort: 'label',
        selectedGroup: key
      }
    })
  })

  it('keeps the canonical package version visible across ordinary pages', async () => {
    expect(version).toBe('0.3.0')
    const user = userEvent.setup()
    window.pennytel = {
      load: vi.fn().mockResolvedValue({ data: configurationFixture(), path: '/qa/telemetry.json' }),
      mutate: vi.fn(),
      openBatchImport: vi.fn(),
      commitBatchImport: vi.fn(),
      previewImport: vi.fn(),
      openImport: vi.fn(),
      exportData: vi.fn(),
      exportComparison: vi.fn(),
      runComparisonPlan: vi.fn(),
      discoverCodexRuns: vi.fn(),
      importCodexRun: vi.fn(),
      createCodexSlice: vi.fn()
    }
    render(<App />)
    const nav = await screen.findByRole('navigation')
    for (const name of ['Compare', 'Model Registry', 'Data & portability', 'Slice notebook']) {
      await user.click(within(nav).getByRole('button', { name }))
      expect(screen.getByText(`PennyTel v${version}`, { exact: false })).toBeVisible()
    }
  })
  it('excludes nonmatching accepted slices, retains support cost, and exports the displayed context', async () => {
    const user = userEvent.setup()
    const exportComparison = vi.fn().mockResolvedValue('/qa/comparison.json')
    window.pennytel = {
      load: vi.fn(),
      mutate: vi.fn(),
      openBatchImport: vi.fn(),
      commitBatchImport: vi.fn(),
      previewImport: vi.fn(),
      openImport: vi.fn(),
      exportData: vi.fn(),
      exportComparison,
      runComparisonPlan: vi.fn(),
      discoverCodexRuns: vi.fn(),
      importCodexRun: vi.fn(),
      createCodexSlice: vi.fn()
    }
    const data = comparisonFixture()
    data.runs[0].executionEvidence = { kind: 'codex-rollout', formatVersion: 1 }
    render(<Compare data={data} onOpenRun={vi.fn()} onOpenSlice={vi.fn()} />)
    const accepted = within(
      screen.getByRole('heading', { name: 'Accepted slice economics' }).closest('section')!
    )
    expect(accepted.getByRole('button', { name: 'Luna-only accepted slice' })).toBeVisible()
    await user.click(screen.getByText('Narrow the cohort'))
    await user.selectOptions(screen.getByLabelText('Filter Exact model'), 'QA Astra')
    await user.selectOptions(screen.getByLabelText('Filter Factory role'), 'Implementer')
    await user.selectOptions(screen.getByLabelText('Group runs by'), 'role')
    await user.selectOptions(screen.getByLabelText('Order groups'), 'cost')
    expect(
      accepted.queryByRole('button', { name: 'Luna-only accepted slice' })
    ).not.toBeInTheDocument()
    expect(
      accepted.queryByRole('button', { name: 'Different runs match different filters' })
    ).not.toBeInTheDocument()
    expect(accepted.getByRole('button', { name: 'Mixed-model accepted slice' })).toBeVisible()
    expect(accepted.getByText('$6.00', { exact: false })).toBeVisible()
    expect(accepted.getByText('Quality: 5 / 5')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Export comparison' }))
    expect(await screen.findByRole('status')).toHaveTextContent('not an importable dataset')
    expect(exportComparison).toHaveBeenCalledWith({
      revision: 0,
      context: {
        filters: { model: 'QA Astra', role: 'Implementer' },
        groupBy: 'role',
        sort: 'cost'
      }
    })
  })
  it('reports export failure without clearing the comparison or claiming success', async () => {
    const user = userEvent.setup()
    window.pennytel = {
      load: vi.fn(),
      mutate: vi.fn(),
      openBatchImport: vi.fn(),
      commitBatchImport: vi.fn(),
      previewImport: vi.fn(),
      openImport: vi.fn(),
      exportData: vi.fn(),
      exportComparison: vi.fn().mockRejectedValue(new Error('Could not save analysis')),
      runComparisonPlan: vi.fn(),
      discoverCodexRuns: vi.fn(),
      importCodexRun: vi.fn(),
      createCodexSlice: vi.fn()
    }
    render(<Compare data={comparisonFixture()} onOpenRun={vi.fn()} onOpenSlice={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Export comparison' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save analysis')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Accepted slice economics' })).toBeVisible()
  })
  it('runs a plan without changing the current comparison controls and reports success or failure', async () => {
    const user = userEvent.setup()
    const runComparisonPlan = vi.fn().mockResolvedValue('/qa/plan-results.json')
    window.pennytel = {
      load: vi.fn(),
      mutate: vi.fn(),
      openBatchImport: vi.fn(),
      commitBatchImport: vi.fn(),
      previewImport: vi.fn(),
      openImport: vi.fn(),
      exportData: vi.fn(),
      exportComparison: vi.fn(),
      runComparisonPlan,
      discoverCodexRuns: vi.fn(),
      importCodexRun: vi.fn(),
      createCodexSlice: vi.fn()
    }
    render(<Compare data={comparisonFixture()} onOpenRun={vi.fn()} onOpenSlice={vi.fn()} />)
    await user.click(screen.getByText('Narrow the cohort'))
    await user.selectOptions(screen.getByLabelText('Filter Exact model'), 'QA Astra')
    await user.selectOptions(screen.getByLabelText('Group runs by'), 'role')
    await user.click(screen.getByRole('checkbox', { name: 'Repair (role: Repair)' }))
    await user.click(screen.getByRole('button', { name: 'Run comparison plan' }))
    expect(runComparisonPlan).toHaveBeenCalledWith()
    expect(await screen.findByRole('status')).toHaveTextContent('/qa/plan-results.json')
    expect(screen.getByLabelText('Filter Exact model')).toHaveValue('QA Astra')
    expect(screen.getByLabelText('Group runs by')).toHaveValue('role')
    expect(screen.getByRole('checkbox', { name: 'Repair (role: Repair)' })).toBeChecked()

    runComparisonPlan.mockRejectedValueOnce(new Error('Comparison 2 is invalid'))
    await user.click(screen.getByRole('button', { name: 'Run comparison plan' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Comparison 2 is invalid')
    expect(screen.getByLabelText('Filter Exact model')).toHaveValue('QA Astra')
  })
})
