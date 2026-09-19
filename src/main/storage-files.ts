import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  writeFileSync,
  type Stats
} from 'node:fs'
import { dirname, isAbsolute, join, parse, resolve } from 'node:path'

export function entry(path: string): Stats | undefined {
  try {
    return lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export function syncDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

// Migration/rebuild names are fixed direct children. Pin the parent and reject
// links (including ancestor links) before touching evidence or opening SQLite.
export class StorageFiles {
  private readonly identity: Stats
  constructor(readonly directory: string) {
    if (!isAbsolute(directory) || directory !== resolve(directory))
      throw new Error('Storage directory must be an absolute normalized path.')
    this.checkAncestors()
    if (!entry(directory)) {
      mkdirSync(directory, { mode: 0o700 })
      syncDirectory(dirname(directory))
    }
    this.identity = lstatSync(directory)
    this.assertDirectory()
  }

  private checkAncestors(): void {
    let path = this.directory
    while (true) {
      const stat = entry(path)
      if (stat && (!stat.isDirectory() || stat.isSymbolicLink()))
        throw new Error(`Unsafe storage directory: ${path}`)
      if (path === parse(path).root) break
      path = dirname(path)
    }
  }

  assertDirectory(): void {
    this.checkAncestors()
    const current = lstatSync(this.directory)
    if (current.dev !== this.identity.dev || current.ino !== this.identity.ino)
      throw new Error('Storage directory changed outside PennyTel; files preserved.')
  }

  path(name: string): string {
    if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..')
      throw new Error('Storage entry must be a direct child.')
    return join(this.directory, name)
  }

  regular(name: string): Stats | undefined {
    this.assertDirectory()
    const stat = entry(this.path(name))
    if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1))
      throw new Error(`Unsafe storage file; evidence preserved: ${name}`)
    return stat
  }

  read(name: string, limit = 10_000_000): Buffer | undefined {
    const before = this.regular(name)
    if (!before) return undefined
    const fd = openSync(
      this.path(name),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    try {
      const stat = fstatSync(fd)
      if (!stat.isFile() || stat.nlink !== 1 || stat.dev !== before.dev || stat.ino !== before.ino)
        throw new Error(`Storage file changed while opening: ${name}`)
      if (stat.size > limit) throw new Error(`Storage file exceeds its byte limit: ${name}`)
      const bytes = Buffer.alloc(stat.size + 1)
      let length = 0
      while (length < bytes.length) {
        const count = readSync(fd, bytes, length, bytes.length - length, null)
        if (!count) break
        length += count
      }
      const after = fstatSync(fd)
      const current = this.regular(name)
      if (
        length !== stat.size ||
        after.ctimeMs !== stat.ctimeMs ||
        after.mtimeMs !== stat.mtimeMs ||
        current?.dev !== stat.dev ||
        current?.ino !== stat.ino ||
        current?.ctimeMs !== after.ctimeMs
      )
        throw new Error(`Storage file changed while reading: ${name}`)
      return bytes.subarray(0, length)
    } finally {
      closeSync(fd)
    }
  }

  writeNew(name: string, bytes: Buffer): void {
    this.assertDirectory()
    const fd = openSync(this.path(name), 'wx', 0o600)
    try {
      writeFileSync(fd, bytes)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    syncDirectory(this.directory)
  }

  syncFile(name: string): void {
    const stat = this.regular(name)
    if (!stat) throw new Error('Required storage evidence disappeared.')
    const fd = openSync(
      this.path(name),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    try {
      const opened = fstatSync(fd)
      if (
        !opened.isFile() ||
        opened.nlink !== 1 ||
        opened.dev !== stat.dev ||
        opened.ino !== stat.ino
      )
        throw new Error('Storage evidence changed before durability could be established.')
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  }

  move(source: string, destination: string, target: StorageFiles = this): void {
    if (!this.regular(source) || target.regular(destination))
      throw new Error('Storage retirement/rebuild evidence is ambiguous; files preserved.')
    this.syncFile(source)
    renameSync(this.path(source), target.path(destination))
    syncDirectory(target.directory)
    if (target !== this) syncDirectory(this.directory)
  }
}
