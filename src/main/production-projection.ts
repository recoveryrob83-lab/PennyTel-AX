import { randomUUID } from 'node:crypto'
import type { Dataset } from '../shared/types'
import type { DatasetProjectionRepository } from './storage-service'
import { PROJECTION_DATABASE_FILENAME, SqliteProjectionRepository } from './sqlite-projection'
import { StorageFiles } from './storage-files'

export const PROJECTION_RECOVERY_DIRECTORY = 'projection-recovery'
export const PROJECTION_FILES = [
  PROJECTION_DATABASE_FILENAME,
  `${PROJECTION_DATABASE_FILENAME}-wal`,
  `${PROJECTION_DATABASE_FILENAME}-shm`,
  `${PROJECTION_DATABASE_FILENAME}-journal`
]

/** Attach only when S10 has verified canonical truth and calls project(). This
 * also prevents a pre-cutover projection from influencing initialization.
 * S10's ordinary reconciliation then projects the complete canonical snapshot.
 */
export class ProductionProjection implements DatasetProjectionRepository {
  private repository?: SqliteProjectionRepository
  constructor(private readonly files: StorageFiles) {}

  private assertSafe(): void {
    for (const name of PROJECTION_FILES) this.files.regular(name)
  }

  load(): Dataset | undefined {
    this.assertSafe()
    return this.repository?.load()
  }

  private open(): SqliteProjectionRepository {
    this.assertSafe()
    // An orphan WAL must never be attached to a newly created database.
    if (
      !this.files.regular(PROJECTION_FILES[0]) &&
      PROJECTION_FILES.slice(1).some((name) => this.files.regular(name))
    )
      this.quarantine()
    return new SqliteProjectionRepository(this.files.path(PROJECTION_FILES[0]))
  }

  private quarantine(): void {
    this.assertSafe()
    const recovery = new StorageFiles(this.files.path(PROJECTION_RECOVERY_DIRECTORY))
    const id = randomUUID()
    // No connection is open here. All old sidecars leave before any fresh DB is
    // created. A crash halfway leaves only rebuildable, checked regular files;
    // the next startup again projects canonical truth before serving consumers.
    for (const name of PROJECTION_FILES)
      if (this.files.regular(name)) this.files.move(name, `${id}-${name}`, recovery)
  }

  replace(dataset: Dataset): void {
    this.assertSafe()
    try {
      this.repository ??= this.open()
      // Admit content through the adapter's physical row/byte bounds before
      // deleting stale rows. Corrupt or oversized content is quarantined too.
      this.repository.load()
      this.repository.replace(dataset)
    } catch {
      this.close()
      this.quarantine()
      this.repository = this.open()
      this.repository.replace(dataset)
    }
  }

  close(): void {
    this.repository?.close()
    this.repository = undefined
  }
}
