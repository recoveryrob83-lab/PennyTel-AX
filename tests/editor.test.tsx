// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { RecordEditor } from '../src/renderer/src/components/RecordEditor'
import { fixture } from './fixtures'
import App from '../src/renderer/src/App'
import { localTimestamp } from '../src/shared/acceptance-time'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
describe('record editor behavior', () => {
  it('edits acceptance in local time and persists canonical ISO without changing judgment fields', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <RecordEditor
        target={{
          table: 'slices',
          record: {
            id: 's',
            title: 'Local',
            disposition: 'In progress',
            qualityGrade: 4,
            preferredCandidate: 'A'
          }
        }}
        data={fixture()}
        onSave={onSave}
        onClose={vi.fn()}
      />
    )
    const iso = '2026-09-11T16:30:12.123Z'
    expect(screen.getByLabelText(/Accepted at/)).toHaveAttribute('type', 'datetime-local')
    expect(screen.getByText(/Local timezone:/)).toBeVisible()
    fireEvent.change(screen.getByLabelText(/Accepted at/), {
      target: { value: localTimestamp(iso) }
    })
    await user.click(screen.getByRole('button', { name: 'Save slice' }))
    expect(onSave.mock.calls[0][1]).toMatchObject({
      acceptedAt: iso,
      qualityGrade: 4,
      preferredCandidate: 'A',
      disposition: 'In progress'
    })
  })
  it('Accept now stamps once, keeps history across dispositions, and requires explicit clearing to restamp', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <RecordEditor
        target={{ table: 'slices', record: { id: 's', title: 'Now', disposition: 'In progress' } }}
        data={fixture()}
        onSave={onSave}
        onClose={vi.fn()}
      />
    )
    const before = Date.now()
    await user.click(screen.getByRole('button', { name: 'Accept now' }))
    expect(screen.getByLabelText('Disposition')).toHaveValue('Accepted')
    await user.selectOptions(screen.getByLabelText('Disposition'), 'In progress')
    expect(screen.getByRole('button', { name: 'Accept now' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Save slice' }))
    const saved = onSave.mock.calls[0][1]
    expect(Date.parse(saved.acceptedAt)).toBeGreaterThanOrEqual(before)
    expect(Date.parse(saved.acceptedAt)).toBeLessThanOrEqual(Date.now())
    expect(saved.acceptedAt).toMatch(/Z$/)
    expect(saved).not.toHaveProperty('qualityGrade')
    expect(saved).not.toHaveProperty('preferredCandidate')
    await user.click(screen.getByRole('button', { name: 'Clear acceptance time' }))
    expect(screen.getByRole('button', { name: 'Accept now' })).toBeEnabled()
  })
  it('preserves exact existing timestamps and supports deliberate advanced correction', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    const acceptedAt = '2026-09-11T11:30:12.123-05:00'
    render(
      <RecordEditor
        target={{
          table: 'slices',
          record: { id: 's', title: 'History', disposition: 'In progress', acceptedAt }
        }}
        data={fixture()}
        onSave={onSave}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Accept now' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /Use exact timestamp/ }))
    expect(screen.getByLabelText(/Accepted at/)).toHaveValue(acceptedAt)
    await user.click(screen.getByRole('button', { name: 'Save slice' }))
    expect(onSave.mock.calls[0][1].acceptedAt).toBe(acceptedAt)
    fireEvent.change(screen.getByLabelText(/Accepted at/), {
      target: { value: '2026-09-12T12:00:00' }
    })
    await user.click(screen.getByRole('button', { name: 'Save slice' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('including timezone')
    expect(onSave).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText(/Accepted at/), {
      target: { value: '2026-09-12T12:00:00-05:00' }
    })
    await user.click(screen.getByRole('button', { name: 'Save slice' }))
    expect(onSave.mock.calls[1][1].acceptedAt).toBe('2026-09-12T12:00:00-05:00')
  })
  it('preserves a failed save draft and reports the storage error', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValue(new Error('Disk is full'))
    const onClose = vi.fn()
    render(
      <RecordEditor
        target={{ table: 'slices' }}
        data={fixture()}
        onSave={onSave}
        onClose={onClose}
      />
    )
    await user.type(screen.getByLabelText(/Title/), 'Keep this draft')
    await user.click(screen.getByRole('button', { name: 'Save slice' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk is full')
    expect(screen.getByLabelText(/Title/)).toHaveValue('Keep this draft')
    expect(onClose).not.toHaveBeenCalled()
  })
  it('keeps unknown booleans absent and captures explicit false correctly', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <RecordEditor
        target={{ table: 'discoveries', sliceId: 'slice-test' }}
        data={fixture()}
        onSave={onSave}
        onClose={vi.fn()}
      />
    )
    await user.type(screen.getByLabelText(/Description/), 'Test-only discovery')
    await user.selectOptions(screen.getByLabelText('Already in prompt / contract'), 'false')
    await user.click(screen.getByRole('button', { name: 'Save discovery' }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][1]).toMatchObject({ inPrompt: false, sliceId: 'slice-test' })
    expect(onSave.mock.calls[0][1]).not.toHaveProperty('selfInitiated')
  })
  it('offers explicit draft discard when closing an edited form', async () => {
    const user = userEvent.setup(),
      onClose = vi.fn()
    render(
      <RecordEditor
        target={{ table: 'slices', record: fixture().slices[0] }}
        data={fixture()}
        onSave={vi.fn()}
        onClose={onClose}
      />
    )
    await user.type(screen.getByLabelText(/Title/), ' changed')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByRole('button', { name: 'Discard changes' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close dialog' }))
    await user.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
  it('only offers run relationships from the selected slice', () => {
    const data = fixture()
    data.slices.push({ id: 'other', title: 'Other slice' })
    data.runs.push({ id: 'other-run', sliceId: 'other', role: 'Repair', runType: 'Other repair' })
    render(
      <RecordEditor
        target={{ table: 'findings', sliceId: 'slice-test' }}
        data={data}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    )
    const select = screen.getByLabelText('Discovered in run')
    expect(select).toHaveTextContent('Implementation')
    expect(select).not.toHaveTextContent('Other repair')
  })
  it('surfaces startup failure without presenting an empty writable notebook', async () => {
    window.pennytel = {
      load: vi.fn().mockRejectedValue(new Error('Dataset corrupt: preserved')),
      mutate: vi.fn(),
      previewImport: vi.fn(),
      openImport: vi.fn(),
      exportData: vi.fn(),
      exportComparison: vi.fn()
    }
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Dataset corrupt: preserved')
    expect(screen.queryByRole('button', { name: '+ New slice' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry load' })).toBeVisible()
  })
})
