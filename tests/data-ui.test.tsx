// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { Data } from '../src/renderer/src/pages/Data'
import { emptyDataset, type PennyTelAPI } from '../src/shared/types'
afterEach(cleanup)
it('previews before committing, reports counts and keeps single import available', async () => {
  const result = { data: { ...emptyDataset(), revision: 1 }, path: 'QA' }
  const openBatchImport = vi.fn().mockResolvedValue({
    token: 't',
    revision: 0,
    fileCount: 20,
    counts: { slices: 1, runs: 20, findings: 0, discoveries: 0, pricing: 0 },
    skipped: 19
  })
  const commitBatchImport = vi.fn().mockResolvedValue(result)
  window.pennytel = { openBatchImport, commitBatchImport } as unknown as PennyTelAPI
  const onBatchImported = vi.fn()
  render(
    <Data data={emptyDataset()} path="QA" onImport={vi.fn()} onBatchImported={onBatchImported} />
  )
  await userEvent.click(screen.getByRole('button', { name: 'Choose batch folder' }))
  expect(screen.getByText('Batch ready to add · 20 files')).toBeVisible()
  expect(commitBatchImport).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Import batch' }))
  expect(commitBatchImport).toHaveBeenCalledWith('t')
  expect(onBatchImported).toHaveBeenCalledWith(result)
  expect(screen.getByRole('status')).toHaveTextContent(
    '21 records imported; 19 identical records skipped'
  )
  expect(screen.getByLabelText('Dataset JSON')).toBeVisible()
})
it('clears old previews on canceled/failed selection and blocks stale commits', async () => {
  const openBatchImport = vi
    .fn()
    .mockResolvedValueOnce({ token: 't', revision: 0, fileCount: 1, counts: {}, skipped: 0 })
    .mockResolvedValueOnce(null)
    .mockRejectedValueOnce(new Error('late.pennytel.json: Invalid JSON'))
  window.pennytel = { openBatchImport } as unknown as PennyTelAPI
  render(
    <Data
      data={{ ...emptyDataset(), revision: 1 }}
      path="QA"
      onImport={vi.fn()}
      onBatchImported={vi.fn()}
    />
  )
  const choose = screen.getByRole('button', { name: 'Choose batch folder' })
  await userEvent.click(choose)
  expect(screen.getByRole('button', { name: 'Import batch' })).toBeDisabled()
  await userEvent.click(choose)
  expect(screen.queryByRole('button', { name: 'Import batch' })).toBeNull()
  await userEvent.click(choose)
  expect(screen.getByRole('alert')).toHaveTextContent('late.pennytel.json')
})

it.each([
  'Persistence failed',
  'The dataset changed',
  'Select and preview the batch folder again.'
])(
  'invalidates a failed commit preview and requires selection before retry: %s',
  async (failure) => {
    const preview = {
      revision: 0,
      fileCount: 1,
      counts: { slices: 1, runs: 0, findings: 0, discoveries: 0, pricing: 0 },
      skipped: 0
    }
    const result = { data: { ...emptyDataset(), revision: 1 }, path: 'QA' }
    const openBatchImport = vi
      .fn()
      .mockResolvedValueOnce({ ...preview, token: 'consumed' })
      .mockResolvedValueOnce({ ...preview, token: 'fresh' })
    const commitBatchImport = vi
      .fn()
      .mockRejectedValueOnce(new Error(failure))
      .mockResolvedValueOnce(result)
    window.pennytel = { openBatchImport, commitBatchImport } as unknown as PennyTelAPI
    const onBatchImported = vi.fn()
    render(
      <Data data={emptyDataset()} path="QA" onImport={vi.fn()} onBatchImported={onBatchImported} />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Choose batch folder' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import batch' }))
    expect(screen.queryByText(/Batch ready to add/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Import batch' })).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Batch import failed. No records were changed. Select and preview the batch folder again before retrying.'
    )
    expect(screen.getByRole('alert')).toHaveTextContent(failure)
    expect(onBatchImported).not.toHaveBeenCalled()
    expect(commitBatchImport).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Choose batch folder' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import batch' }))
    expect(commitBatchImport.mock.calls).toEqual([['consumed'], ['fresh']])
    expect(onBatchImported).toHaveBeenCalledWith(result)
  }
)
