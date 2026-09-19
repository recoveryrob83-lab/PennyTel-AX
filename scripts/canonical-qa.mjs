// Read-only independent disk assertions for Electron QA; never used by the app.
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

export async function canonicalSnapshot(directory) {
  const root = join(directory, 'canonical-artifact-store')
  const names = (await readdir(root)).sort()
  return JSON.stringify(
    await Promise.all(names.map(async (name) => [name, await readFile(join(root, name), 'utf8')]))
  )
}

export async function canonicalDataset(directory) {
  const root = join(directory, 'canonical-artifact-store')
  const metadata = JSON.parse(await readFile(join(root, 'artifact-dataset.json'), 'utf8'))
  const dataset = { schemaVersion: 2, revision: metadata.revision }
  for (const [table, ids] of Object.entries(metadata.records)) {
    dataset[table] = await Promise.all(
      ids.map(async (id) => {
        const digest = createHash('sha256').update(Buffer.from(id, 'utf16le')).digest('hex')
        const artifact = JSON.parse(
          await readFile(join(root, `artifact-${table}-${digest}.json`), 'utf8')
        )
        return artifact.record
      })
    )
  }
  if (metadata.registry) dataset.registry = metadata.registry
  return dataset
}
