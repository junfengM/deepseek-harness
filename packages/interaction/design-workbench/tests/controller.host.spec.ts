import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { SessionId } from '@deepseek-ai/dsh-session'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import {
  DesignWorkbenchController,
  DesignWorkbenchRegistry,
} from '../src/index.ts'
import type { DesignWorkbenchFollowFrame } from '../src/types.ts'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

const roots: Context[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function harness() {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const storageDomain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', storageDomain)
  ctx.provide('storageDomain', storageDomain)
  const dispose = (): void => {}
  ctx.provide('typert', {
    lookups: { configure: () => dispose },
    contexts: { configureHost: () => dispose },
  } as never)
  await ctx.plugin(DesignWorkbenchRegistry)
  const controller = new DesignWorkbenchController(ctx)
  return { controller, ctx }
}

async function nextFrame(iterator: AsyncIterator<DesignWorkbenchFollowFrame>): Promise<DesignWorkbenchFollowFrame> {
  const next = await iterator.next()
  if (next.done === true) throw new Error('Design Workbench stream ended before expected frame')
  return next.value
}

describe('DesignWorkbenchController Host contracts', () => {
  it('serves CRUD plus a real baseline/increment stream that closes with its generation signal', async () => {
    const { controller } = await harness()
    const abort = new AbortController()
    const iterator = controller.follow(abort.signal)[Symbol.asyncIterator]()
    await expect(nextFrame(iterator)).resolves.toEqual({ type: 'baseline', value: { items: [] } })

    const created = await controller.create({
      title: '  Campaign routes  ',
      sourceSessionId: SessionId('source-chat'),
      status: 'awaitingUser',
    })
    expect(created.designSession).toMatchObject({ title: 'Campaign routes', revision: 1, status: 'awaitingUser' })
    await expect(nextFrame(iterator)).resolves.toMatchObject({
      type: 'upsert',
      designSession: { id: created.designSession.id, revision: 1 },
    })

    await expect(controller.list()).resolves.toMatchObject({ items: [{ id: created.designSession.id }] })
    await expect(controller.get({ designSessionId: created.designSession.id })).resolves.toEqual(created)

    const updated = await controller.update({
      designSessionId: created.designSession.id,
      expectedRevision: 1,
      title: 'Chosen route',
      status: 'confirmed',
    })
    expect(updated.designSession).toMatchObject({ revision: 2, title: 'Chosen route', status: 'confirmed' })
    await expect(nextFrame(iterator)).resolves.toMatchObject({
      type: 'upsert',
      designSession: { id: created.designSession.id, revision: 2 },
    })

    abort.abort()
    await expect(iterator.next()).resolves.toMatchObject({ done: true })

    const reopenedAbort = new AbortController()
    const reopened = controller.follow(reopenedAbort.signal)[Symbol.asyncIterator]()
    await expect(nextFrame(reopened)).resolves.toMatchObject({
      type: 'baseline',
      value: { items: [{ id: created.designSession.id, revision: 2, title: 'Chosen route' }] },
    })
    await expect(controller.delete({
      designSessionId: created.designSession.id,
      expectedRevision: 2,
    })).resolves.toEqual({ deleted: true })
    await expect(nextFrame(reopened)).resolves.toEqual({
      type: 'remove',
      designSessionId: created.designSession.id,
    })
    reopenedAbort.abort()
    await expect(reopened.next()).resolves.toMatchObject({ done: true })
  })

  it('rejects the second stale writer with a structured revision conflict', async () => {
    const { controller } = await harness()
    const created = await controller.create({
      title: 'Shared task',
      sourceSessionId: SessionId('source-chat'),
    })
    const revision = created.designSession.revision

    const firstPage = controller.update({
      designSessionId: created.designSession.id,
      expectedRevision: revision,
      title: 'Page A wins',
    })
    const secondPage = controller.update({
      designSessionId: created.designSession.id,
      expectedRevision: revision,
      title: 'Page B stale',
    })

    await expect(firstPage).resolves.toMatchObject({ designSession: { revision: 2, title: 'Page A wins' } })
    const failure = await secondPage.catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'design-session/conflict',
      details: {
        designSessionId: created.designSession.id,
        expectedRevision: 1,
        actualRevision: 2,
      },
    })
    await expect(controller.get({ designSessionId: created.designSession.id })).resolves.toMatchObject({
      designSession: { revision: 2, title: 'Page A wins' },
    })
  })

  it('maps missing reads and mutations without silently recreating state', async () => {
    const { controller } = await harness()
    const missing = 'design-missing' as never
    await expect(controller.get({ designSessionId: missing })).rejects.toMatchObject({
      code: 'design-session/not-found',
      details: { designSessionId: missing },
    })
    await expect(controller.update({
      designSessionId: missing,
      expectedRevision: 1,
      status: 'active',
    })).rejects.toMatchObject({ code: 'design-session/not-found' })
    await expect(controller.delete({
      designSessionId: missing,
      expectedRevision: 1,
    })).rejects.toMatchObject({ code: 'design-session/not-found' })
    await expect(controller.list()).resolves.toEqual({ items: [] })
  })
})
