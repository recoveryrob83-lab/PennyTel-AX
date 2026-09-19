// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { Data } from '../src/renderer/src/pages/Data'
import { emptyDataset, type CodexIntakeCandidate, type PennyTelAPI } from '../src/shared/types'
afterEach(cleanup)
it('creates a reviewed tracked parent explicitly without importing a Run', async () => {
  const candidate: CodexIntakeCandidate = {
    receiptId: 'pr1_parent',
    status: 'blocked',
    reason: 'Create or import the matching Dataset Slice first.',
    createSlice: {
      token: 'slice-token',
      slice: { id: 'S14', title: 'Tracked title', project: 'PennyTel' }
    }
  }
  const discoverCodexRuns = vi.fn().mockResolvedValue([candidate])
  const createCodexSlice = vi.fn().mockResolvedValue({
    data: { ...emptyDataset(), revision: 1, slices: [candidate.createSlice!.slice] },
    path: 'QA'
  })
  const importCodexRun = vi.fn()
  window.pennytel = {
    discoverCodexRuns,
    createCodexSlice,
    importCodexRun
  } as unknown as PennyTelAPI
  const onBatchImported = vi.fn()
  render(
    <Data data={emptyDataset()} path="QA" onImport={vi.fn()} onBatchImported={onBatchImported} />
  )
  await userEvent.click(screen.getByRole('button', { name: 'Discover Codex runs' }))
  expect(screen.getByText(/Tracked Slice: S14/)).toHaveTextContent('Tracked title · PennyTel')
  expect(createCodexSlice).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Create Slice' }))
  expect(createCodexSlice).toHaveBeenCalledWith('slice-token')
  expect(onBatchImported).toHaveBeenCalledOnce()
  expect(importCodexRun).not.toHaveBeenCalled()
  expect(screen.getByRole('status')).toHaveTextContent('Discover Codex runs again')
})
it('shows sanitized Codex review and imports only after the operator clicks', async () => {
  const candidate: CodexIntakeCandidate = {
    receiptId: 'pr1_test',
    status: 'ready',
    token: 'opaque-token',
    report: {
      sliceId: 'S13',
      runType: 'Implementation',
      role: 'Implementer',
      result: 'Completed',
      verification: 'Passed',
      findings: 0
    },
    run: {
      id: 'codex_pr1_test',
      sliceId: 'S13',
      runType: 'Implementation',
      role: 'Implementer',
      executionEvidence: { kind: 'codex-rollout', formatVersion: 1, turnId: 'turn-1' }
    },
    unknowns: ['inputTokens', 'outputTokens'],
    warnings: ['Usage incomplete']
  }
  const discoverCodexRuns = vi.fn().mockResolvedValue([candidate])
  const result = { data: { ...emptyDataset(), revision: 1 }, path: 'QA' }
  const importCodexRun = vi.fn().mockResolvedValue(result)
  window.pennytel = { discoverCodexRuns, importCodexRun } as unknown as PennyTelAPI
  const onBatchImported = vi.fn()
  render(
    <Data
      data={{ ...emptyDataset(), slices: [{ id: 'S13', title: 'Intake' }] }}
      path="QA"
      onImport={vi.fn()}
      onBatchImported={onBatchImported}
    />
  )
  await userEvent.click(screen.getByRole('button', { name: 'Discover Codex runs' }))
  expect(await screen.findByText('pr1_test · ready')).toBeVisible()
  expect(screen.getByText(/verification: Passed · findings: 0/)).toBeVisible()
  expect(screen.getByText('Unknown: inputTokens, outputTokens')).toBeVisible()
  expect(screen.getByText('Usage incomplete')).toBeVisible()
  expect(screen.getByText(/"turnId": "turn-1"/)).toBeVisible()
  expect(importCodexRun).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Import reviewed Run' }))
  expect(importCodexRun).toHaveBeenCalledWith('opaque-token')
  expect(onBatchImported).toHaveBeenCalledWith(result)
})
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
