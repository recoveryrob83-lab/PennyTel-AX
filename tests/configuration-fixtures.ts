import { snapshotRun } from '../src/shared/data'
import { fixture, runFixture } from './fixtures'
import { registryFixture } from './registry-fixtures'
import type { Dataset } from '../src/shared/types'

export function configurationFixture(): Dataset {
  const data = fixture()
  data.registry = registryFixture()
  const astra = data.registry.models.find((model) => model.canonicalName === 'GPT-6 Astra')!
  data.runs = [
    runFixture({ id: 'low', model: astra.canonicalName, thinking: 'Low', modelFamily: 'Astra' }),
    runFixture({
      id: 'alias-low',
      model: astra.apiModelId.toUpperCase(),
      thinking: 'Low',
      modelFamily: 'Astra'
    }),
    runFixture({
      id: 'xhigh',
      model: astra.canonicalName,
      thinking: 'ExtraHigh',
      modelFamily: 'Astra'
    }),
    runFixture({
      id: 'unknown',
      model: astra.canonicalName,
      thinking: undefined,
      modelFamily: 'Astra'
    }),
    runFixture({
      id: 'luna',
      model: 'GPT-5.6 Luna',
      thinking: 'Max',
      modelFamily: 'Luna',
      role: 'Critic'
    }),
    runFixture({
      id: 'sol',
      model: 'GPT-5.6 Sol',
      thinking: 'High',
      modelFamily: 'Sol',
      role: 'Repair'
    })
  ].map((run) => snapshotRun({ ...run, provider: 'OpenAI' }, data))
  return data
}
