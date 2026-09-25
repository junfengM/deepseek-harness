import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { SessionId } from '@deepseek-ai/dsh-session'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DesignSessionId, DesignWorkbenchRegistry } from '../src/index.ts'

const roots: string[] = []
const contexts = new Set<Context>()

afterEach(async () => {
  for (const ctx of [...contexts].reverse()) {
    await ctx.fiber.dispose()
    contexts.delete(ctx)
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function open(root: string) {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(Storage)
  const backend = new JsonStorageBackend(root)
  ctx.storage.backend.register('json', backend)
  const storageDomain = new DomainFacility(ctx, { backend: 'json', routes: {} })
  ctx.provide('storageDomain', storageDomain)
  await ctx.plugin(DesignWorkbenchRegistry)
  return {
    ctx,
    registry: ctx.designWorkbenchRegistry,
    close: async () => {
      await ctx.fiber.dispose()
      contexts.delete(ctx)
    },
  }
}

describe('formal Design Workbench domain persistence', () => {
  it('reopens the same authoritative record and revision after process-equivalent teardown', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-design-workbench-'))
    roots.push(root)
    const first = await open(root)
    const id = DesignSessionId('design-persisted')
    await first.registry.create({
      id,
      title: 'Persistent task',
      status: 'awaitingUser',
      sourceSessionId: SessionId('source-chat'),
      now: 10,
    })
    await first.registry.update({
      id,
      expectedRevision: 1,
      title: 'Persistent task revised',
      now: 20,
    })
    await first.close()

    const second = await open(root)
    expect(second.registry.get(id)).toMatchObject({
      id,
      revision: 2,
      title: 'Persistent task revised',
      status: 'awaitingUser',
      sourceSessionId: 'source-chat',
    })
    expect(second.registry.list()).toHaveLength(1)
    await second.close()
  })
})
