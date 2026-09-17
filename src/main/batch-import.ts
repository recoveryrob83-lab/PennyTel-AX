import { constants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { join, relative, isAbsolute, sep } from 'node:path'
import { TextDecoder } from 'node:util'
import type { ImportSource } from '../shared/types'

/** Operator-local, bounded discovery. Symlinks (including directory links) are ignored. */
export async function discoverBatch(directory: string): Promise<ImportSource[]> {
  const root = await realpath(directory)
  const sources: ImportSource[] = []
  let entries = 0
  let bytes = 0
  const contained = async (path: string): Promise<void> => {
    const rel = relative(root, await realpath(path))
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw new Error('Batch path escaped the selected folder.')
  }
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > 64) throw new Error('Batch exceeds the 64-level folder depth limit.')
    await contained(directory)
    const children = await readdir(directory, { withFileTypes: true })
    entries += children.length
    if (entries > 10000) throw new Error('Batch exceeds the 10000-entry scan limit.')
    children.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const child of children) {
      if (child.name.startsWith('.')) continue
      const absolute = join(directory, child.name)
      if (child.isDirectory()) await walk(absolute, depth + 1)
      else if (child.isFile() && child.name.endsWith('.pennytel.json')) {
        const path = relative(root, absolute).split(sep).join('/')
        try {
          if (sources.length >= 1000) throw new Error('Batch exceeds the 1000-file limit.')
          await contained(absolute)
          const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW)
          try {
            const info = await handle.stat()
            await contained(absolute)
            const current = await lstat(absolute)
            if (!current.isFile() || current.dev !== info.dev || current.ino !== info.ino)
              throw new Error('Import source changed during discovery.')
            if (!info.isFile()) throw new Error('Import source is not a regular file.')
            if (info.size > 10_000_000) throw new Error('Import exceeds the 10 MB limit.')
            const buffer = Buffer.alloc(info.size + 1)
            let size = 0
            while (size < buffer.length) {
              const read = await handle.read(buffer, size, buffer.length - size, null)
              if (!read.bytesRead) break
              size += read.bytesRead
            }
            if (size > 10_000_000) throw new Error('Import exceeds the 10 MB limit.')
            if (size > info.size) throw new Error('Import source changed during discovery.')
            bytes += size
            if (bytes > 100_000_000) throw new Error('Batch exceeds the 100 MB total limit.')
            const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size))
            sources.push({ path, text })
          } finally {
            await handle.close()
          }
        } catch (error) {
          throw new Error(`${path}: ${(error as Error).message}`)
        }
      }
    }
  }
  await walk(root, 0)
  return sources.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}
