import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL('./fixtures/loader-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/design-workbench.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

describe('formal Design Workbench through the production headless profile', () => {
  it('composes the registry, generated Typert Host controller, and Remote namespace', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'design-workbench Loader composition',
      tempDirPrefix: 'design-workbench-loader-e2e-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
    })
    expect(stderr).toBe('')
    const result = JSON.parse(stdout.trim()) as Record<string, unknown>
    expect(result).toMatchObject({
      registry: 'DesignWorkbenchRegistry',
      controller: 'DesignWorkbenchController',
      package: '@deepseek-ai/dsh-design-workbench',
      service: 'designWorkbenchController',
      listed: 1,
      deleted: true,
      remaining: 0,
      registryAfterDelete: 0,
    })
    expect(result['hostEndpoints']).toEqual([
      'designWorkbench/create',
      'designWorkbench/delete',
      'designWorkbench/follow',
      'designWorkbench/get',
      'designWorkbench/list',
      'designWorkbench/update',
    ])
    expect(result['remoteEndpoints']).toEqual(result['hostEndpoints'])
    expect(result['created']).toMatchObject({ title: 'Real Loader task', revision: 1 })
    expect(result['updated']).toMatchObject({ title: 'Composed task', revision: 2 })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
