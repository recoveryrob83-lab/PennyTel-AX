// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { Compare } from '../src/renderer/src/pages/Compare'
import { comparisonFixture } from './fixtures'
import { configurationFixture } from './configuration-fixtures'
import { modelConfiguration } from '../src/shared/configuration'
import App from '../src/renderer/src/App'
import { version } from '../package.json'

afterEach(cleanup)
describe('comparison UI uses shared cohort context', () => {
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
      previewImport: vi.fn(),
      openImport: vi.fn(),
      exportData: vi.fn(),
      exportComparison
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
    const user = userEvent.setup()
    window.pennytel = {
      load: vi.fn().mockResolvedValue({ data: configurationFixture(), path: '/qa/telemetry.json' }),
      mutate: vi.fn(),
      previewImport: vi.fn(),
      openImport: vi.fn(),
      exportData: vi.fn(),
      exportComparison: vi.fn()
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
      previewImport: vi.fn(),
      openImport: vi.fn(),
      exportData: vi.fn(),
      exportComparison
    }
    render(<Compare data={comparisonFixture()} onOpenRun={vi.fn()} onOpenSlice={vi.fn()} />)
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
      previewImport: vi.fn(),
      openImport: vi.fn(),
      exportData: vi.fn(),
      exportComparison: vi.fn().mockRejectedValue(new Error('Could not save analysis'))
    }
    render(<Compare data={comparisonFixture()} onOpenRun={vi.fn()} onOpenSlice={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Export comparison' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save analysis')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Accepted slice economics' })).toBeVisible()
  })
})
