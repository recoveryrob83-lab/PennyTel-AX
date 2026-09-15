// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ExecutionEvidenceDetails } from '../src/renderer/src/components/ExecutionEvidenceDetails'
import { Compare } from '../src/renderer/src/pages/Compare'
import { evidenceNumber, evidencePercent } from '../src/shared/presentation'
import { evidenceFixture, fixture } from './fixtures'

afterEach(cleanup)
const field = (label: string): HTMLElement =>
  screen.getByText(label, { selector: 'dt' }).nextElementSibling as HTMLElement

describe('read-only execution evidence details', () => {
  it('displays complete normalized provenance, measurements, paired utilization and environment as inert text', () => {
    render(<ExecutionEvidenceDetails evidence={evidenceFixture()} />)
    for (const [label, value] of [
      ['Source kind', 'codex-rollout'],
      ['Evidence format version', '1'],
      ['Source log basename', 'synthetic-rollout.jsonl'],
      ['Source log SHA-256', evidenceFixture().sourceLog!.contentHash!.value],
      ['Session ID', 'synthetic-session-1'],
      ['Turn ID', 'synthetic-turn-1'],
      ['Runtime / Codex version', 'synthetic-1.0'],
      ['Originator', 'synthetic-qa'],
      ['Working directory / worktree', '/synthetic/worktree'],
      ['Repository', 'https://example.invalid/synthetic/repo.git'],
      ['Branch', 'synthetic-branch'],
      ['Baseline commit SHA', evidenceFixture().repository!.baselineCommitSha!],
      ['TTFT (ms)', '123.5'],
      ['Model invocations', '4'],
      ['Tool calls', '3'],
      ['Model context window (tokens)', '200000'],
      ['Peak invocation input (tokens, includes cache)', '90000'],
      ['Cached input within peak (tokens)', '80000'],
      ['Context window at peak (tokens)', '200000'],
      ['Peak context utilization', '45%'],
      ['Sandbox mode', 'workspace-write'],
      ['Approval policy', 'on-request'],
      ['Approval reviewer', 'auto_review'],
      ['Network access', 'restricted']
    ])
      expect(field(label)).toHaveTextContent(value)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Quota window 1' })).toHaveTextContent(
      'Synthetic concurrent-session observation'
    )
    expect(screen.getByRole('region', { name: 'Quota window 2' })).toHaveTextContent('Unknown')
  })

  it('distinguishes absent, partial and recorded zero without borrowing an unpaired context window', () => {
    const { rerender } = render(<ExecutionEvidenceDetails />)
    expect(screen.getByRole('region', { name: 'Execution evidence' })).toHaveTextContent(
      'Unknown · no execution evidence recorded.'
    )
    rerender(
      <ExecutionEvidenceDetails
        evidence={{
          kind: 'codex-rollout',
          formatVersion: 1,
          timeToFirstTokenMs: 0,
          toolCallCount: 0,
          modelContextWindowTokens: 200000,
          peakInvocation: { inputTokens: 0 }
        }}
      />
    )
    expect(field('TTFT (ms)')).toHaveTextContent(/^0$/)
    expect(field('Tool calls')).toHaveTextContent(/^0$/)
    expect(field('Model invocations')).toHaveTextContent(/^Unknown$/)
    expect(field('Peak invocation input (tokens, includes cache)')).toHaveTextContent(/^0$/)
    expect(field('Peak context utilization')).toHaveTextContent(/^Unknown$/)
    expect(field('Runtime / Codex version')).toHaveTextContent(/^Unknown$/)
    expect(screen.getByText('Unknown · no quota snapshots recorded.')).toBeVisible()
    rerender(
      <ExecutionEvidenceDetails
        evidence={{
          kind: 'codex-rollout',
          formatVersion: 1,
          modelInvocationCount: 0,
          quotaWindows: []
        }}
      />
    )
    expect(field('Model invocations')).toHaveTextContent(/^0$/)
    expect(field('TTFT (ms)')).toHaveTextContent(/^Unknown$/)
  })

  it.each(['Clean', 'Contaminated', 'Unknown'] as const)(
    'shows %s quota endpoints and attribution without claiming run burn',
    (attribution) => {
      render(
        <ExecutionEvidenceDetails
          evidence={{
            kind: 'codex-rollout',
            formatVersion: 1,
            quotaWindows: [
              {
                attribution,
                note: 'Recorded attribution reason',
                first: {
                  usedPercent: 0,
                  recordedAt: '2026-09-15T10:00:00Z',
                  resetsAt: '2026-09-15T16:00:00Z'
                }
              }
            ]
          }}
        />
      )
      expect(field('Attribution')).toHaveTextContent(attribution)
      expect(field('Attribution reason / note')).toHaveTextContent('Recorded attribution reason')
      expect(field('First used_percent')).toHaveTextContent(/^0%$/)
      expect(field('Last used_percent')).toHaveTextContent(/^Unknown$/)
      expect(field('First reset at')).toHaveTextContent('2026-09-15T16:00:00Z')
      expect(field('Last reset at')).toHaveTextContent(/^Unknown$/)
      expect(screen.getByText(/Even Clean snapshots/)).toHaveTextContent(
        'do not establish precise per-run burn'
      )
    }
  )

  it('preserves small positive display values and known zero', () => {
    expect(evidenceNumber(0.00000001)).not.toBe('0')
    expect(evidencePercent(0.00000001)).not.toBe('0%')
    expect(evidencePercent(0)).toBe('0%')
    expect(evidencePercent(null)).toBe('Unknown')
  })
})

it('offers evidence controls, updates shared statistics, selects source groups and exports exact Unknown/filter/group state', async () => {
  const data = fixture()
  data.runs = [
    { ...data.runs[0], id: 'complete', executionEvidence: evidenceFixture() },
    {
      ...data.runs[0],
      id: 'zero',
      executionEvidence: {
        kind: 'codex-rollout',
        formatVersion: 1,
        runtimeVersion: 'Unknown',
        toolCallCount: 0
      }
    },
    { ...data.runs[0], id: 'legacy' }
  ]
  const exportComparison = vi.fn().mockResolvedValue('/qa/evidence-analysis.json')
  window.pennytel = { ...window.pennytel, exportComparison }
  render(<Compare data={data} onOpenRun={vi.fn()} onOpenSlice={vi.fn()} />)
  const stats = screen.getByRole('region', { name: 'Execution evidence statistics' })
  const overall = within(stats).getAllByRole('row')[1]
  expect(overall).toHaveTextContent('2/3 with execution evidence · 1 Unknown')
  expect(overall).toHaveTextContent('Mean 1.5 · median 1.5')
  expect(overall).toHaveTextContent('Mean 45% · median 45%')
  fireEvent.click(screen.getByText('Narrow the cohort'))
  fireEvent.change(screen.getByLabelText('Group runs by'), { target: { value: 'runtimeVersion' } })
  fireEvent.change(screen.getByLabelText('Filter Evidence source kind'), {
    target: { value: 'codex-rollout' }
  })
  fireEvent.change(screen.getByLabelText('Filter Runtime / Codex version'), {
    target: { value: 'Unknown' }
  })
  expect(stats).toHaveTextContent('Mean 0 · median 0')
  fireEvent.click(screen.getByRole('button', { name: 'Inspect execution evidence group Unknown' }))
  expect(screen.getByRole('heading', { name: 'Evidence · Unknown' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Export comparison' }))
  expect(exportComparison.mock.calls[0][0].context).toMatchObject({
    filters: { evidenceSourceKind: 'codex-rollout', runtimeVersion: 'Unknown' },
    groupBy: 'runtimeVersion',
    selectedGroup: '["recorded","Unknown"]'
  })
  await screen.findByRole('status')
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
  fireEvent.change(screen.getByLabelText('Filter Runtime / Codex version'), {
    target: { value: '__missing__' }
  })
  expect(stats).toHaveTextContent('0/1 with execution evidence · 1 Unknown')
  expect(stats).toHaveTextContent('Mean Unknown · median Unknown')
  fireEvent.click(screen.getByRole('button', { name: 'Export comparison' }))
  expect(exportComparison.mock.calls[1][0].context.filters).toEqual({ runtimeVersion: null })
  await screen.findByRole('status')
})
