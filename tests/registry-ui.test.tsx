// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { Registry } from '../src/renderer/src/pages/Registry'
import { recoveredData, registryFixture } from './registry-fixtures'

afterEach(cleanup)
describe('Model Registry inspection and import', () => {
  it('shows canonical metadata and benchmarks without modifying their values', async () => {
    const user = userEvent.setup()
    render(
      <Registry data={{ ...recoveredData(), registry: registryFixture() }} onImport={vi.fn()} />
    )
    expect(screen.getByRole('heading', { name: 'GPT-5.6 Luna' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'GPT-6 Astra' })).toBeVisible()
    expect(screen.getByText(/Aliases: Astra, Tropy/)).toBeVisible()
    await user.click(screen.getByText('Benchmarks (7)'))
    expect(screen.getByText('62.7 percent')).toBeVisible()
  })
  it('rejects invalid documents without an install action and keeps an accessible editable draft', async () => {
    const user = userEvent.setup(),
      onImport = vi.fn()
    render(<Registry data={recoveredData()} onImport={onImport} />)
    await user.click(screen.getByText('Import / update registry'))
    const textarea = screen.getByRole('textbox', { name: 'Registry JSON' })
    fireEvent.change(textarea, { target: { value: '{broken' } })
    await user.click(screen.getByRole('button', { name: 'Validate registry & preview' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid registry JSON')
    expect(
      screen.queryByRole('button', { name: 'Install registry update' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Registry JSON' })).toHaveValue('{broken')
    expect(onImport).not.toHaveBeenCalled()
  })
  it('previews backfill and preserves the draft on a failed save', async () => {
    const user = userEvent.setup(),
      onImport = vi.fn().mockRejectedValue(new Error('Synthetic atomic write failure'))
    render(<Registry data={recoveredData()} onImport={onImport} />)
    await user.click(screen.getByText('Import / update registry'))
    const text = JSON.stringify(registryFixture())
    fireEvent.change(screen.getByRole('textbox', { name: 'Registry JSON' }), {
      target: { value: text }
    })
    await user.click(screen.getByRole('button', { name: 'Validate registry & preview' }))
    expect(screen.getByText(/1 unpriced runs gain snapshots/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Install registry update' }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Synthetic atomic write failure')
    )
    expect(screen.getByRole('textbox', { name: 'Registry JSON' })).toHaveValue(text)
    expect(onImport).toHaveBeenCalledWith(text)
  })
})
