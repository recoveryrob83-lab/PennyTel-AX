// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { Slices } from '../src/renderer/src/pages/Slices'
import { emptyDataset } from '../src/shared/types'

afterEach(cleanup)

it('offers explicit acceptance for a tracked Slice with no recorded disposition', () => {
  const data = { ...emptyDataset(), slices: [{ id: 'S14', title: 'Tracked Slice' }] }
  render(
    <Slices
      data={data}
      selectedId="S14"
      onSelect={vi.fn()}
      onEdit={vi.fn()}
      onOpenRun={vi.fn()}
      onDelete={vi.fn()}
      onSave={vi.fn()}
    />
  )
  expect(screen.getByRole('button', { name: 'Accept Slice' })).toBeVisible()
})

it('accepts an in-progress Slice through the ordinary save callback and hides the action once accepted', async () => {
  const data = {
    ...emptyDataset(),
    slices: [{ id: 'S14', title: 'Closure', disposition: 'In progress' as const }]
  }
  const onSave = vi.fn().mockResolvedValue(undefined)
  const props = {
    data,
    selectedId: 'S14',
    onSelect: vi.fn(),
    onEdit: vi.fn(),
    onOpenRun: vi.fn(),
    onDelete: vi.fn(),
    onSave
  }
  const view = render(<Slices {...props} />)
  await userEvent.click(screen.getByRole('button', { name: 'Accept Slice' }))
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
  const saved = onSave.mock.calls[0][1]
  expect(onSave.mock.calls[0][0]).toBe('slices')
  expect(saved).toMatchObject({ id: 'S14', title: 'Closure', disposition: 'Accepted' })
  expect(Number.isFinite(Date.parse(saved.acceptedAt))).toBe(true)
  view.rerender(<Slices {...props} data={{ ...data, slices: [saved] }} />)
  expect(screen.queryByRole('button', { name: 'Accept Slice' })).toBeNull()
})

it('shows a failed save and does not present acceptance as complete', async () => {
  const data = {
    ...emptyDataset(),
    slices: [{ id: 'S14', title: 'Closure', disposition: 'In progress' as const }]
  }
  const onSave = vi.fn().mockRejectedValue(new Error('Dataset revision changed'))
  render(
    <Slices
      data={data}
      selectedId="S14"
      onSelect={vi.fn()}
      onEdit={vi.fn()}
      onOpenRun={vi.fn()}
      onDelete={vi.fn()}
      onSave={onSave}
    />
  )
  await userEvent.click(screen.getByRole('button', { name: 'Accept Slice' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Dataset revision changed')
  expect(screen.getByRole('button', { name: 'Accept Slice' })).toBeEnabled()
})
