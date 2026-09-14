// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { Compare } from '../src/renderer/src/pages/Compare'
import fixture from './accepted-outcome-fixture.json'
import { validateDataset } from '../src/shared/data'
import { compareData, type ComparisonRequest } from '../src/shared/comparison'
import type { Dataset } from '../src/shared/types'

afterEach(cleanup)
function setup(): {
  data: Dataset
  exportComparison: ReturnType<typeof vi.fn>
  onOpenRun: ReturnType<typeof vi.fn>
  onOpenSlice: ReturnType<typeof vi.fn>
  user: ReturnType<typeof userEvent.setup>
} {
  const data: unknown = structuredClone(fixture)
  validateDataset(data)
  const exportComparison = vi.fn().mockResolvedValue('/qa/analytics.json')
  window.pennytel = { ...window.pennytel, exportComparison }
  const onOpenRun = vi.fn()
  const onOpenSlice = vi.fn()
  render(<Compare data={data} onOpenRun={onOpenRun} onOpenSlice={onOpenSlice} />)
  return { data, exportComparison, onOpenRun, onOpenSlice, user: userEvent.setup() }
}
describe('analytics workspace controls and inspection', () => {
  it('updates charts with composed filters and exports the exact date/outcome scope', async () => {
    const { user, data, exportComparison } = setup()
    await user.click(screen.getByText('Narrow the cohort'))
    await user.selectOptions(screen.getByLabelText('Filter Runtime tested'), 'false')
    await user.selectOptions(screen.getByLabelText('Filter Factory role'), 'Implementer')
    await user.selectOptions(screen.getByLabelText('Filter Repair presence'), 'Yes')
    fireEvent.change(screen.getByLabelText('Run start from (UTC day)'), {
      target: { value: '2026-09-11' }
    })
    fireEvent.change(screen.getByLabelText('Run start through (UTC day)'), {
      target: { value: '2026-09-11' }
    })
    const analytics = within(screen.getByRole('region', { name: 'Analytics workspace' }))
    expect(
      analytics.getByText(/Current cohort: 1 runs · 1 slices · 1 accepted outcomes/)
    ).toBeVisible()
    expect(
      analytics.getByRole('region', { name: 'Accepted lifecycle stage composition' })
    ).toHaveTextContent('Verification')
    expect(
      analytics.getByRole('region', { name: 'Implementation versus accepted cost' })
    ).toHaveTextContent('$2.5248')
    await user.click(screen.getByRole('button', { name: 'Export comparison' }))
    const request = exportComparison.mock.calls[0][0] as ComparisonRequest
    expect(request.context).toMatchObject({
      filters: { runtimeTested: 'false', role: 'Implementer' },
      outcomeFilters: { repairPresence: 'Yes' },
      dateRange: {
        from: '2026-09-11T00:00:00.000Z',
        to: '2026-09-11T23:59:59.999Z',
        includeUnknown: false
      }
    })
    expect(compareData(data, request.context).runs.map((run) => run.id)).toEqual([
      'astra-implementation'
    ])
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(analytics.getByText(/5 accepted outcomes/)).toBeVisible()
    expect(screen.getByLabelText('Run start from (UTC day)')).toHaveValue('')
    expect(screen.getByLabelText('Filter Repair presence')).toHaveValue('')
  })
  it('offers Unknown runtime evidence distinctly, preserves null export state, and can recover from empty and invalid ranges', async () => {
    const { user, exportComparison } = setup()
    await user.click(screen.getByText('Narrow the cohort'))
    await user.selectOptions(screen.getByLabelText('Filter Runtime tested'), '__missing__')
    expect(
      screen.getByText(/Current cohort: 1 runs · 1 slices · 1 accepted outcomes/)
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Export comparison' }))
    expect(exportComparison.mock.calls[0][0].context.filters).toEqual({ runtimeTested: null })
    fireEvent.change(screen.getByLabelText('Run start from (UTC day)'), {
      target: { value: '2026-09-12' }
    })
    expect(
      screen.getByText(/Current cohort: 0 runs · 0 slices · 0 accepted outcomes/)
    ).toBeVisible()
    await user.click(
      screen.getByRole('checkbox', { name: 'Include unknown run starts in date range' })
    )
    expect(
      screen.getByText(/Current cohort: 1 runs · 1 slices · 1 accepted outcomes/)
    ).toBeVisible()
    fireEvent.change(screen.getByLabelText('Run start through (UTC day)'), {
      target: { value: '2026-09-11' }
    })
    expect(screen.getByRole('alert')).toHaveTextContent('start date must be on or before')
    expect(screen.getByRole('button', { name: 'Export comparison' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByRole('button', { name: 'Export comparison' })).toBeEnabled()
    expect(screen.getByText(/Not recorded in the current telemetry schema/)).toHaveTextContent(
      'explicit context-preparation state'
    )
  })
  it('opens source evidence from plotted points and grouping without changing accepted economics', async () => {
    const { user, data, onOpenRun, onOpenSlice } = setup()
    const time = within(screen.getByRole('region', { name: 'Time versus cost' }))
    const point = time.getByRole('button', { name: /^Inspect run astra-implementation:/ })
    point.focus()
    await user.keyboard('{Enter}')
    expect(onOpenRun).toHaveBeenCalledWith(
      data.runs.find((run) => run.id === 'astra-implementation')
    )
    const quality = within(
      screen.getByRole('region', { name: 'Operator quality versus accepted cost' })
    )
    await user.click(
      quality.getByRole('button', { name: /^Inspect outcome Cross-model accepted repair:/ })
    )
    expect(onOpenSlice).toHaveBeenCalledWith('mixed')
    await user.selectOptions(screen.getByLabelText('Group runs by'), 'runType')
    await user.click(screen.getByRole('button', { name: 'Inspect analytics group Repair' }))
    expect(screen.getByRole('heading', { name: 'Evidence · Repair' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Accepted aggregate statistics' })).toHaveTextContent(
      '3/5 complete outcome costs'
    )
  })
})
