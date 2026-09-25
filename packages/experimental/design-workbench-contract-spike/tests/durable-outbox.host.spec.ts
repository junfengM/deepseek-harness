import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import SessionStore, { Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import {
  DesignChangeId,
  DesignSessionId,
  DesignSessionRegistry,
  deliverDesignOutbox,
} from '../src/index.ts'

const roots: string[] = []
const contexts = new Set<Context>()

afterEach(async () => {
  for (const ctx of [...contexts].reverse()) {
    await ctx.fiber.dispose()
    contexts.delete(ctx)
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function openRegistry(root: string) {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(Storage)
  const backend = new JsonStorageBackend(root)
  ctx.storage.backend.register('json', backend)
  const facility = new DomainFacility(ctx, { backend: 'json', routes: {} })
  const registry = await DesignSessionRegistry.open(facility)
  return {
    ctx,
    registry,
    close: async () => {
      await registry.close()
      await backend.close()
      await ctx.fiber.dispose()
      contexts.delete(ctx)
    },
  }
}

async function openSessionPersistence(root: string) {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  return {
    ctx,
    close: async () => {
      await ctx.fiber.dispose()
      contexts.delete(ctx)
    },
  }
}

function restoreSession(header: SessionHeader, events: readonly SessionEvent[]): Session {
  return Session.fromRestore(
    header.id,
    events,
    header,
    SessionLogOffset(0),
    'detached',
  )
}

async function readStored(ctx: Context, id: SessionId) {
  const handle = await ctx.sessionPersistence.open(id, 'read')
  try {
    return { header: handle.header, events: (await handle.read()).events }
  } finally {
    await handle.close()
  }
}

describe('Design Workbench durable domain and source-chat outbox', () => {
  it('survives close/reopen and converges after a crash between event durability and acknowledgement', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-design-contract-'))
    roots.push(root)
    const domainRoot = join(root, 'domain')
    const sessionRoot = join(root, 'sessions')
    const designId = DesignSessionId('design-1')
    const changeId = DesignChangeId('change-1')
    const sourceId = SessionId('source-chat')

    const firstDomain = await openRegistry(domainRoot)
    const created = await firstDomain.registry.create({
      id: designId,
      title: 'Real design task',
      sourceSessionId: sourceId,
      now: 10,
    })
    const queued = await firstDomain.registry.enqueueChange({
      id: designId,
      expectedRevision: created.revision,
      changeId,
      kind: 'created',
      compactSummary: 'Design session created',
      now: 20,
    })
    expect(queued.revision).toBe(2)

    const firstSessions = await openSessionPersistence(sessionRoot)
    const source = firstSessions.ctx.sessions.create(sourceId, { meta: { cwd: root } })
    const writer = await firstSessions.ctx.sessionPersistence.create(source.header)
    const flush = async (session: Session) => {
      await firstSessions.ctx.sessions.flush(session)
    }

    await expect(deliverDesignOutbox(firstDomain.registry, designId, source, {
      flush,
      now: () => 30,
      afterDurableAppend: () => { throw new Error('simulated crash after Session durability') },
    })).rejects.toThrow(/simulated crash/)
    await writer.close()
    expect(firstDomain.registry.get(designId)?.outbox[0]?.deliveredAt).toBeUndefined()
    await firstDomain.close()
    await firstSessions.close()

    const secondDomain = await openRegistry(domainRoot)
    const reopened = secondDomain.registry.get(designId)
    expect(reopened).toMatchObject({ revision: 2, title: 'Real design task' })
    expect(reopened?.outbox).toHaveLength(1)

    const secondSessions = await openSessionPersistence(sessionRoot)
    const storedBeforeRetry = await readStored(secondSessions.ctx, sourceId)
    const durableChanges = storedBeforeRetry.events.filter(event => event.type === 'design/session-change')
    expect(durableChanges).toHaveLength(1)
    expect(durableChanges[0]?.data).toMatchObject({
      changeId,
      designSessionId: designId,
      compactSummary: 'Design session created',
    })
    const restored = restoreSession(storedBeforeRetry.header, storedBeforeRetry.events)

    await deliverDesignOutbox(secondDomain.registry, designId, restored, {
      flush: () => Promise.reject(new Error('retry must not append a duplicate')),
      now: () => 40,
    })
    expect(secondDomain.registry.get(designId)?.outbox[0]?.deliveredAt).toBe(40)
    expect(restored.snapshotEvents().filter(event => event.type === 'design/session-change')).toHaveLength(1)

    await secondDomain.close()
    await secondSessions.close()
  })
})
