import { link, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { writeExport } from '../src/main/export'
import { emptyDataset } from '../src/shared/types'
import { comparisonExport } from '../src/shared/comparison'

describe('filesystem-safe exports', () => {
  beforeAll(async () => {
    await mkdir(join(process.cwd(), 'test-results'), { recursive: true })
  })
  const raw = emptyDataset()
  const analysis = comparisonExport(
    raw,
    { revision: 0, context: { filters: {}, groupBy: 'model', sort: 'label' } },
    '0.1.0',
    new Date().toISOString()
  )
  for (const [kind, contents] of [
    ['raw', raw],
    ['comparison', analysis]
  ] as const) {
    it.each(['direct', 'symlink', 'hardlink', 'parent-link'])(
      `${kind} rejects %s aliases of both protected files`,
      async (alias) => {
        const directory = await mkdtemp(join(process.cwd(), 'test-results/export-alias-'))
        const paths = ['telemetry.json', 'telemetry.backup.json'].map((name) =>
          join(directory, name)
        )
        await Promise.all(paths.map((path) => writeFile(path, JSON.stringify(raw))))
        for (const [index, path] of paths.entries()) {
          let destination = path
          if (alias === 'symlink' || alias === 'hardlink') {
            destination = join(directory, `${alias}-${index}.json`)
            await (alias === 'symlink' ? symlink : link)(path, destination)
          } else if (alias === 'parent-link') {
            const parent = join(directory, `parent-${index}`)
            await symlink(directory, parent, 'dir')
            destination = join(parent, index ? 'telemetry.backup.json' : 'telemetry.json')
          }
          await expect(writeExport(destination, contents, paths)).rejects.toThrow()
          for (const protectedPath of paths)
            expect(await readFile(protectedPath, 'utf8')).toBe(JSON.stringify(raw))
        }
      }
    )
    it(`${kind} writes new and existing regular exports without changing telemetry`, async () => {
      const directory = await mkdtemp(join(process.cwd(), 'test-results/export-safe-'))
      const paths = ['telemetry.json', 'telemetry.backup.json'].map((name) => join(directory, name))
      await writeFile(paths[0], JSON.stringify(raw))
      const destination = join(directory, 'export.json')
      await writeExport(destination, contents, paths)
      expect(JSON.parse(await readFile(destination, 'utf8'))).toEqual(contents)
      await writeExport(destination, contents, paths)
      expect(await readFile(paths[0], 'utf8')).toBe(JSON.stringify(raw))
    })
  }
  it('fails closed for dangling destinations and unresolvable protected identities', async () => {
    const directory = await mkdtemp(join(process.cwd(), 'test-results/export-uncertain-'))
    const live = join(directory, 'telemetry.json')
    const backup = join(directory, 'telemetry.backup.json')
    const destination = join(directory, 'export.json')
    await writeFile(live, JSON.stringify(raw))
    await symlink(join(directory, 'absent'), destination)
    await expect(writeExport(destination, analysis, [live, backup])).rejects.toThrow()
    await symlink(join(directory, 'absent'), backup)
    await expect(
      writeExport(join(directory, 'safe.json'), analysis, [live, backup])
    ).rejects.toThrow()
    await mkdir(join(directory, 'not-a-file'))
    await expect(writeExport(join(directory, 'not-a-file'), analysis, [live])).rejects.toThrow()
    expect(await readFile(live, 'utf8')).toBe(JSON.stringify(raw))
  })
})
