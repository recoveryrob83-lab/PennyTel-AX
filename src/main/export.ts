import { lstat, open, realpath, rename, unlink } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

async function entry(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

// Both export kinds use this main-process boundary. Replace a directory entry atomically
// instead of truncating a followed link, so a destination swap cannot clobber its target.
export async function writeExport(
  destination: string,
  contents: unknown,
  protectedPaths: string[],
  protectedDirectories: string[] = []
): Promise<void> {
  const target = join(await realpath(dirname(resolve(destination))), basename(destination))
  const assertSafe = async (): Promise<void> => {
    const candidate = await entry(target)
    if (candidate && (!candidate.isFile() || !candidate.ino || candidate.nlink !== 1))
      throw new Error('Export destination safety cannot be determined. Choose a regular file path.')
    for (const directory of protectedDirectories) {
      const canonical = join(await realpath(dirname(directory)), basename(directory))
      const stat = await entry(canonical)
      if (stat && (!stat.isDirectory() || stat.isSymbolicLink()))
        throw new Error('Cannot determine storage directory identity; export blocked.')
      if (target === canonical || target.startsWith(`${canonical}${sep}`))
        throw new Error('Choose a path outside PennyTel storage and recovery evidence.')
    }
    for (const path of protectedPaths) {
      const canonical = join(await realpath(dirname(path)), basename(path))
      if (target === canonical)
        throw new Error('Choose a path outside PennyTel storage and recovery evidence.')
      const protectedEntry = await entry(canonical)
      if (!protectedEntry) continue
      // Resolve protected links too; broken/inaccessible links fail closed.
      const identity = await entry(await realpath(canonical))
      if (!identity?.isFile() || !identity.ino)
        throw new Error('Cannot determine live dataset or backup identity; export blocked.')
      if (candidate && candidate.dev === identity.dev && candidate.ino === identity.ino)
        throw new Error('Choose a path outside PennyTel storage and recovery evidence.')
    }
  }
  await assertSafe()
  const temporary = join(dirname(target), `.pennytel-export-${randomUUID()}.tmp`)
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(JSON.stringify(contents, null, 2), 'utf8')
    await handle.sync()
    await handle.close()
    await assertSafe()
    await rename(temporary, target)
  } finally {
    await handle.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
  }
}
