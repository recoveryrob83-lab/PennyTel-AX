import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
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
  private loading?: Promise<Dataset>
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private directory: string) {
    this.path = join(directory, 'telemetry.json')
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
        this.data = emptyDataset()
        return this.data
      }
      throw new Error(`Cannot read ${this.path}: ${(error as Error).message}`)
    }
    try {
      const parsed: unknown = JSON.parse(contents)
      validateDataset(parsed)
      this.data = parsed
      return parsed
    } catch (error) {
      throw new Error(
        `Could not load ${this.path}. Your file has been preserved. Restore a valid export or telemetry.backup.json while PennyTel is closed. ${(error as Error).message}`
      )
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
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      await this.atomicWrite(
        join(this.directory, 'telemetry.backup.json'),
        JSON.stringify(previous, null, 2)
      )
      await this.atomicWrite(this.path, JSON.stringify(next, null, 2))
      this.data = next
      return this.load()
    })
    this.queue = operation.catch(() => undefined)
    return operation
  }
}
