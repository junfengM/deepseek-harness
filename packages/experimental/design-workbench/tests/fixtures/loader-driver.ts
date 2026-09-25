#!/usr/bin/env node
/** Prove the formal Design Workbench through the shipped headless Loader. */

import { bootProductionProfile } from '../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const PACKAGE = '@deepseek-ai/dsh-experimental-design-workbench'
const configPath = process.argv[2]
if (configPath === undefined) throw new Error('design-workbench Loader driver requires an overlay path')

const ctx = await bootProductionProfile({
  binName: 'design-workbench-loader-composition',
  profile: 'headless',
  overlayPaths: [configPath],
})

type LoaderSession = {
  readonly id: string
  readonly revision: number
  readonly title: string
}

type LoaderHost = {
  readonly designWorkbenchRegistry?: {
    readonly constructor: { readonly name: string }
    list(): readonly unknown[]
  }
  readonly designWorkbenchController?: {
    create(request: {
      readonly title: string
      readonly sourceSessionId: string
    }): Promise<{ readonly designSession: LoaderSession }>
    list(): Promise<{ readonly items: readonly unknown[] }>
    update(request: {
      readonly designSessionId: string
      readonly expectedRevision: number
      readonly title: string
    }): Promise<{ readonly designSession: Pick<LoaderSession, 'revision' | 'title'> }>
    delete(request: {
      readonly designSessionId: string
      readonly expectedRevision: number
    }): Promise<{ readonly deleted: true }>
  }
  readonly typert?: {
    getPackage(packageName: string, face?: string): {
      readonly package: string
      readonly face: string
      readonly model: {
        readonly services: readonly { readonly key: string }[]
      }
    } | undefined
    local: {
      list(): readonly {
        readonly id: string
        readonly namespace: string
        readonly method: string
      }[]
    }
  }
}

try {
  const host = ctx as unknown as LoaderHost

  const registry = host.designWorkbenchRegistry
  const controller = host.designWorkbenchController
  const typert = host.typert
  if (registry === undefined) throw new Error('Loader composition did not mount DesignWorkbenchRegistry')
  if (controller === undefined) throw new Error('Loader composition did not mount DesignWorkbenchController')
  if (typert === undefined) throw new Error('Loader composition did not mount Typert registry')

  const packageRecord = typert.getPackage(PACKAGE, 'host')
  if (packageRecord === undefined) throw new Error('Typert Loader did not register the workbench host artifact')
  const workbenchService = packageRecord.model.services.find(service => service.key === 'designWorkbenchController')
  if (workbenchService === undefined) throw new Error('Typert host reflection omitted designWorkbenchController')

  const localEndpoints = typert.local.list()
    .filter(descriptor => descriptor.id.startsWith(PACKAGE + '#'))
    .map(descriptor => descriptor.namespace + '/' + descriptor.method)
    .sort()
  const expectedEndpoints = [
    'designWorkbench/create',
    'designWorkbench/delete',
    'designWorkbench/follow',
    'designWorkbench/get',
    'designWorkbench/list',
    'designWorkbench/update',
  ]
  if (JSON.stringify(localEndpoints) !== JSON.stringify(expectedEndpoints)) {
    throw new Error('unexpected generated Host endpoints: ' + JSON.stringify(localEndpoints))
  }

  const generatedRemote = await import(PACKAGE + '/remote') as unknown as {
    readonly TYPERT_REMOTE: {
      readonly package: string
      readonly descriptors: readonly { readonly namespace: string; readonly method: string }[]
    }
  }
  const remote = generatedRemote.TYPERT_REMOTE
  const remoteEndpoints = remote.descriptors
    .filter(descriptor => descriptor.namespace === 'designWorkbench')
    .map(descriptor => descriptor.namespace + '/' + descriptor.method)
    .sort()
  if (remote.package !== PACKAGE) throw new Error('generated Remote artifact belongs to ' + remote.package)
  if (JSON.stringify(remoteEndpoints) !== JSON.stringify(expectedEndpoints)) {
    throw new Error('unexpected generated Remote namespace: ' + JSON.stringify(remoteEndpoints))
  }
  const created = await controller.create({ title: '  Real Loader task  ', sourceSessionId: 'source-chat' })
  const listed = await controller.list()
  const updated = await controller.update({
    designSessionId: created.designSession.id,
    expectedRevision: created.designSession.revision,
    title: 'Composed task',
  })
  const deleted = await controller.delete({
    designSessionId: created.designSession.id,
    expectedRevision: updated.designSession.revision,
  })
  const remaining = await controller.list()

  process.stdout.write(JSON.stringify({
    registry: registry.constructor.name,
    controller: controller.constructor.name,
    package: packageRecord.package,
    service: workbenchService.key,
    hostEndpoints: localEndpoints,
    remoteEndpoints,
    created: created.designSession,
    listed: listed.items.length,
    updated: updated.designSession,
    deleted: deleted.deleted,
    remaining: remaining.items.length,
    registryAfterDelete: registry.list().length,
  }) + '\n')
} finally {
  await ctx.fiber.dispose()
}
