import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import canonicalRegistry from '../../docs/PennyTel_Model_Registry_v0.2_Canonical_Seed_2026-09-12.json'
import { applyMutation, mergeImport, validateDataset } from '../shared/data'
import {
  emptyDataset,
  type Dataset,
  type LoadedData,
  type Mutation,
  type ImportPreview
} from '../shared/types'

export class TelemetryStore {
  readonly path: string
  private data?: Dataset
  private liveContents?: string
  private backupState?: string
  private initializing?: Promise<LoadedData>
  private awaitingFirstWrite = false
  private loading?: Promise<Dataset>
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private directory: string) {
    this.path = join(directory, 'telemetry.json')
  }
  private async readBackupState(): Promise<string | undefined> {
    const path = join(this.directory, 'telemetry.backup.json')
    let stat
    try {
      stat = await lstat(path, { bigint: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    if (!stat.isFile())
      throw new Error('Backup recovery evidence is not a regular file; writes are blocked.')
    return `${stat.dev}:${stat.ino}:${stat.ctimeNs}:${(await readFile(path)).toString('base64')}`
  }
  private async requireNewProfile(beforeFirstWrite = false): Promise<void> {
    // lstat also detects dangling links: unreadable recovery evidence is not a new profile.
    for (const path of [this.path, join(this.directory, 'telemetry.backup.json')]) {
      try {
        await lstat(path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      if (beforeFirstWrite)
        throw new Error(
          'Storage state changed externally. Files preserved; writes are blocked. Close and reopen PennyTel, or repair the telemetry files while PennyTel is closed.'
        )
      throw new Error(
        `Recovery state at ${this.path}. Files have been preserved; writes are blocked. Close PennyTel, preserve a copy of telemetry.backup.json, then restore a valid dataset to telemetry.json and reopen PennyTel.`
      )
    }
  }
  private async read(): Promise<Dataset> {
    if (this.data) return this.data
    if (!this.loading) this.loading = this.readFromDisk()
    try {
      return await this.loading
    } finally {
      this.loading = undefined
    }
  }
  private async readFromDisk(): Promise<Dataset> {
    let contents: string
    try {
      contents = await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.requireNewProfile()
        this.awaitingFirstWrite = true
        this.data = emptyDataset()
        return this.data
      }
      throw new Error(`Cannot read ${this.path}: ${(error as Error).message}`)
    }
    try {
      const parsed: unknown = JSON.parse(contents)
      validateDataset(parsed)
      this.backupState = await this.readBackupState()
      this.liveContents = contents
      this.data = parsed
      return parsed
    } catch (error) {
      throw new Error(
        `Could not load ${this.path}. Your file has been preserved. Restore a valid export or telemetry.backup.json while PennyTel is closed. ${(error as Error).message}`
      )
    }
  }
  // Startup uses the ordinary transaction path: provenance checks precede seeding,
  // and existing telemetry is backed up before registry and backfill publish together.
  async initializeRegistry(): Promise<LoadedData> {
    if (!this.initializing) {
      this.initializing = (async () => {
        const { data } = await this.load()
        return data.registry
          ? this.load()
          : this.mutate({
              kind: 'registry-import',
              text: JSON.stringify(canonicalRegistry),
              revision: data.revision
            })
      })()
    }
    try {
      return structuredClone(await this.initializing)
    } finally {
      this.initializing = undefined
    }
  }
  async load(): Promise<LoadedData> {
    return { data: structuredClone(await this.read()), path: this.path }
  }
  async preview(text: string): Promise<ImportPreview> {
    return mergeImport(await this.read(), text).preview
  }
  private async atomicWrite(path: string, contents: string): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(contents, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await rename(temporary, path)
    } catch (error) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
  }
  mutate(command: Mutation): Promise<LoadedData> {
    const operation = this.queue.then(async () => {
      const previous = await this.read()
      const next = applyMutation(previous, command)
      // Absence at initial load is session provenance, even if a later file is equal.
      if (this.awaitingFirstWrite) await this.requireNewProfile(true)
      // Recheck before rotating the backup, including after an earlier empty load.
      // Never replace recovery evidence using stale cached state.
      let live: string | undefined
      try {
        live = await readFile(this.path, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        await this.requireNewProfile()
        if (previous.revision !== 0)
          throw new Error(
            'Live dataset disappeared. Files preserved; close PennyTel and restore it.'
          )
      }
      if (live !== undefined && live !== this.liveContents)
        throw new Error(
          'Live dataset changed outside PennyTel. Files preserved; close and reopen PennyTel.'
        )
      if ((await this.readBackupState()) !== this.backupState)
        throw new Error(
          'Backup changed outside PennyTel. Files preserved; close and reopen PennyTel.'
        )
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      if (live !== undefined) {
        await this.atomicWrite(
          join(this.directory, 'telemetry.backup.json'),
          JSON.stringify(previous, null, 2)
        )
        // Track our own rotation even if the following live replacement fails.
        this.backupState = await this.readBackupState()
      }
      await this.atomicWrite(this.path, JSON.stringify(next, null, 2))
      this.liveContents = JSON.stringify(next, null, 2)
      this.awaitingFirstWrite = false
      this.data = next
      return this.load()
    })
    this.queue = operation.catch(() => undefined)
    return operation
  }
}
