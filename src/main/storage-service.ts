import { validateDataset } from '../shared/data'
import type { Dataset } from '../shared/types'

/** Replaceable main-process persistence boundary. Driver details stay in implementations. */
export interface DatasetProjectionRepository {
  replace(dataset: Dataset): void
  load(): Dataset | undefined
  close(): void
}

export interface PennyTelStorageService {
  project(dataset: Dataset): void
  loadProjection(): Dataset | undefined
  close(): void
}

export class MainProcessStorageService implements PennyTelStorageService {
  constructor(private readonly repository: DatasetProjectionRepository) {}

  project(dataset: Dataset): void {
    validateDataset(dataset)
    this.repository.replace(structuredClone(dataset))
  }

  loadProjection(): Dataset | undefined {
    const dataset = this.repository.load()
    if (dataset === undefined) return undefined
    validateDataset(dataset)
    return structuredClone(dataset)
  }

  close(): void {
    this.repository.close()
  }
}
