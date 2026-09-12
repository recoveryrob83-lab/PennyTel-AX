// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { Compare } from '../src/renderer/src/pages/Compare'
import { comparisonFixture } from './fixtures'

afterEach(cleanup)
describe('comparison UI uses shared cohort context', () => {
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
