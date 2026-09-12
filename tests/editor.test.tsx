// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { RecordEditor } from '../src/renderer/src/components/RecordEditor'
import { fixture } from './fixtures'
import App from '../src/renderer/src/App'

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
      exportData: vi.fn()
    }
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Dataset corrupt: preserved')
    expect(screen.queryByRole('button', { name: '+ New slice' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry load' })).toBeVisible()
  })
})
