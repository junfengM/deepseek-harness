// This spike test spans both faces, so it lives in neither TypeScript project
// (see tsconfig.client.json's exclude); oxlint therefore has no types for it.
import { once } from 'node:events'
import WebSocket, { type RawData } from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { apply as applyConnection, inject as connectionInject } from '@deepseek-ai/dsh-client-connection'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import TypertRegistry, { type TypertContribution } from '@deepseek-ai/dsh-typert-registry'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import {
  DesignWorkbenchController,
  DesignWorkbenchRegistry,
} from '../src/index.ts'
import { ClientDesignWorkbenchModel, type DesignWorkbenchRemote } from '../src/client/model.ts'
import { ClientDesignWorkbenchService, DESIGN_WORKBENCH_PANEL_ID } from '../src/client/service.ts'
import * as toolDesignWorkbench from '../../../interaction/tool-design-workbench/src/index.ts'

interface RpcSuccess {
  readonly ok: true
  readonly value: Record<string, unknown>
}

interface RpcFailure {
  readonly ok: false
  readonly error: {
    readonly code: string
    readonly message: string
    readonly details: Record<string, unknown>
  }
}

type RpcResult = RpcSuccess | RpcFailure

interface RpcEnvelope {
  readonly type: 'server-response'
  readonly rpcId: string
  readonly result: RpcResult
}

type Frame = Record<string, unknown>

interface FollowClient {
  readonly socket: WebSocket
  readonly frames: Frame[]
  readonly streamId: string
}

const roots: Context[] = []
const sockets = new Set<WebSocket>()

/** Provide the in-memory browser credential owner expected by Connection. */
function provideBrowserCredentials(ctx: Context): void {
  const records = new Map<unknown, unknown>()
  ctx.provide('credentials', {
    async modifyRecord(key: unknown, mutate: (current: unknown) => Promise<unknown>): Promise<unknown> {
      const next = await mutate(records.get(key))
      if (next !== undefined) records.set(key, next)
      return next ?? records.get(key)
    },
  } as never)
}

async function setup(): Promise<{ readonly ctx: Context; readonly origin: string; readonly cookie: string }> {
  const ctx = new Context()
  roots.push(ctx)

  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const storageDomain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', storageDomain)
  ctx.provide('storageDomain', storageDomain)

  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  provideBrowserCredentials(ctx)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(TypertGatewayService)
  await ctx.plugin({ inject: [...connectionInject], apply: applyConnection })
  await ctx.plugin(DesignWorkbenchRegistry)
  await ctx.plugin(DesignWorkbenchController)
  ctx.typert.register(workbenchContribution())

  const origin = 'http://127.0.0.1:' + String(ctx.webServer.port)
  return { ctx, origin, cookie: browserCookie(ctx, origin) }
}

function browserCookie(ctx: Context, origin: string): string {
  const target = new URL(ctx.connection.authenticatedUrl(origin))
  let setCookie: string | undefined
  ctx.connection.authorizeIndex({
    method: 'GET',
    url: target.pathname + target.search,
    headers: { host: target.host },
  }, {
    writeHead(_status, headers) { setCookie = headers?.['set-cookie'] },
    end() {},
  })
  if (setCookie === undefined) throw new Error('design-workbench fixture did not receive a browser cookie')
  return setCookie.split(';', 1)[0] ?? ''
}

async function rpc(origin: string, cookie: string, method: string, args: Record<string, unknown>, rpcId: string): Promise<RpcEnvelope> {
  const response = await fetch(origin + '/api/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      type: 'client-request',
      rpcId,
      method,
      payload: { args },
    }),
  })
  expect(response.status).toBe(200)
  return await response.json() as RpcEnvelope
}

async function openFollow(origin: string, cookie: string, streamId: string): Promise<FollowClient> {
  const socket = new WebSocket(origin.replace('http:', 'ws:') + '/api/remote.mux', {
    headers: { cookie },
  })
  sockets.add(socket)
  await once(socket, 'open')
  const frames: Frame[] = []
  socket.on('message', (data: RawData) => { frames.push(JSON.parse(rawText(data)) as Frame) })
  socket.send(JSON.stringify({
    type: 'open',
    streamId,
    endpoint: 'designWorkbench/follow',
    payload: { args: {} },
  }))
  await waitForFrame(frames, frame => frame.type === 'item' && frame.streamId === streamId
    && isRecord(frame.value) && frame.value.type === 'baseline')
  return { socket, frames, streamId }
}

async function waitForFrame(frames: readonly Frame[], predicate: (frame: Frame) => boolean): Promise<Frame> {
  let match: Frame | undefined
  await vi.waitFor(() => {
    match = frames.find(predicate)
    expect(match).toBeDefined()
  })
  return match!
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function rawText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return Buffer.from(data).toString('utf8')
}

function workbenchContribution(): TypertContribution {
  const view = z.object({
    id: z.string(),
    revision: z.number(),
    title: z.string(),
    status: z.enum(['active', 'awaitingUser', 'confirmed', 'completed']),
    sourceSessionId: z.string(),
    linkedAgentSessionId: z.string().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  const value = z.object({ designSession: view })
  const list = z.object({ items: z.array(view) })
  const baseline = z.object({ type: z.literal('baseline'), value: z.object({ items: z.array(view) }) })
  const upsert = z.object({ type: z.literal('upsert'), designSession: view })
  const remove = z.object({ type: z.literal('remove'), designSessionId: z.string() })
  const request = (schema: z.ZodType, typeSymbol: string) => ({
    name: 'request',
    wire: 'request',
    source: 'json' as const,
    codec: { mode: 'strict' as const, typeSymbol, create: () => schema },
  })
  const direct = (method: string, parameters: InvocationDescriptor['parameters'], result: z.ZodType): InvocationDescriptor => ({
    id: '@deepseek-ai/dsh-design-workbench#designWorkbench/' + method,
    service: 'designWorkbenchController',
    namespace: 'designWorkbench',
    method,
    invocation: { kind: 'direct' },
    parameters,
    result: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-design-workbench#result', create: () => result },
  })
  const emptyModel: TypertContribution['model'] = { services: [], events: [], objects: [] }
  return {
    package: '@deepseek-ai/dsh-design-workbench',
    face: 'host',
    schemas: [],
    model: emptyModel,
    invocations: [
      direct('create', [request(z.object({
        title: z.string(),
        sourceSessionId: z.string(),
        linkedAgentSessionId: z.string().optional(),
        status: z.enum(['active', 'awaitingUser', 'confirmed', 'completed']).optional(),
      }), 'DesignSessionCreateRequest')], value),
      direct('get', [request(z.object({ designSessionId: z.string() }), 'DesignSessionGetRequest')], value),
      direct('list', [], list),
      direct('update', [request(z.object({
        designSessionId: z.string(),
        expectedRevision: z.number(),
        title: z.string().optional(),
        status: z.enum(['active', 'awaitingUser', 'confirmed', 'completed']).optional(),
      }), 'DesignSessionUpdateRequest')], value),
      direct('delete', [request(z.object({ designSessionId: z.string(), expectedRevision: z.number() }), 'DesignSessionDeleteRequest')], z.object({ deleted: z.literal(true) })),
      {
        ...direct('follow', [], z.union([baseline, upsert, remove])),
        mode: 'stream',
        cancellation: { parameter: 'signal' },
      },
    ],
  }
}

afterEach(async () => {
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close()
  }
  sockets.clear()
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('Design Workbench real Gateway transport', () => {
  it('confirms chat handoff, persists through Host, and opens from a real follow upsert', async () => {
    const { ctx, origin, cookie } = await setup()
    const follow = await openFollow(origin, cookie, 'handoff-follow')
    const baselineFrame = await waitForFrame(follow.frames, frame => frame.type === 'item'
      && frame.streamId === follow.streamId && isRecord(frame.value) && frame.value.type === 'baseline')
    if (!isRecord(baselineFrame.value) || !isRecord(baselineFrame.value.value)) {
      throw new Error('Host follow omitted its baseline value')
    }

    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const sourceSessionId = 'source-chat'
    const questionRequests: { questions: { id: string; options: { label: string }[] }[] }[] = []
    const ask = vi.fn(async (request: { questions: { id: string; options: { label: string }[] }[] }) => {
      questionRequests.push(request)
      return { answers: [{ id: 'create-design-session-confirmation', selected: ['确认创建'] }] }
    })
    ctx.reflect.provide('userQuestions', { ask })

    const selectPanel = vi.fn()
    const openSession = vi.fn()
    ctx.reflect.provide('layout', { selectPanel })
    ctx.reflect.provide('sessions', {
      list: { getSnapshot: () => ({ current: sourceSessionId }) },
      open: openSession,
    })
    const model = new ClientDesignWorkbenchModel({
      update: async () => { throw new Error('unexpected update in handoff test') },
    } as unknown as DesignWorkbenchRemote)
    let workbench: ClientDesignWorkbenchService | undefined
    await ctx.plugin({
      inject: ['layout', 'sessions'],
      apply(clientCtx) {
        workbench = new ClientDesignWorkbenchService(clientCtx, model)
      },
    })
    if (workbench === undefined) throw new Error('Client service was not composed')
    workbench.replaceBaseline(baselineFrame.value.value as never)
    expect(selectPanel).not.toHaveBeenCalled()

    await ctx.plugin(toolDesignWorkbench)
    const agent = {
      id: 'handoff-agent',
      session: { id: sourceSessionId, header: { delegationDepth: 0 } },
    } as unknown as Agent
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('handoff-confirmed'),
      name: 'create_design_session',
      arguments: { title: '  Campaign routes  ' },
      agent,
    })
    expect(result.isError).toBe(false)
    const handoffText = result.content.find(part => part.type === 'text')
    expect(handoffText?.text).toContain('已创建 DesignSession「Campaign routes」')
    expect(ask).toHaveBeenCalledOnce()
    expect(questionRequests[0]?.questions[0]?.options.map(option => option.label)).toEqual(['确认创建', '取消'])

    const upsertFrame = await waitForFrame(follow.frames, frame => frame.type === 'item'
      && frame.streamId === follow.streamId && isRecord(frame.value) && frame.value.type === 'upsert'
      && isRecord(frame.value.designSession) && frame.value.designSession.sourceSessionId === sourceSessionId)
    if (!isRecord(upsertFrame.value) || !isRecord(upsertFrame.value.designSession)) {
      throw new Error('Host follow omitted the created DesignSession')
    }
    const createdView = upsertFrame.value.designSession
    if (typeof createdView.id !== 'string') throw new Error('Host upsert omitted DesignSession id')
    expect(createdView).toMatchObject({ title: 'Campaign routes', status: 'active', sourceSessionId })

    // The shell reports the workbench as the panel on screen; only then does a
    // fresh Host row open itself (0.1.7 no longer exposes the wired Session).
    workbench.notePanelActive(true)
    workbench.upsertView(createdView as never)
    expect(workbench.state.getSnapshot().items.map(item => item.id)).toEqual([createdView.id])
    expect(workbench.selected.getSnapshot()).toBe(createdView.id)
    expect(selectPanel).toHaveBeenCalledTimes(1)
    expect(selectPanel).toHaveBeenCalledWith(DESIGN_WORKBENCH_PANEL_ID)
    expect(openSession).not.toHaveBeenCalled()

    const listed = await rpc(origin, cookie, 'designWorkbench/list', {}, 'handoff-list')
    expect(listed.result).toMatchObject({
      ok: true,
      value: { items: [{ id: createdView.id, title: 'Campaign routes', sourceSessionId }] },
    })
  }, 15_000)

  it('validates HTTP CRUD/conflict plus WebSocket follow and reconnect baselines', async () => {
    const { origin, cookie } = await setup()
    const first = await openFollow(origin, cookie, 'follow-a')
    expect(first.frames).toContainEqual({
      type: 'item',
      streamId: 'follow-a',
      value: { type: 'baseline', value: { items: [] } },
    })

    const created = await rpc(origin, cookie, 'designWorkbench/create', {
      request: {
        title: '  Campaign routes  ',
        sourceSessionId: 'source-chat',
        status: 'awaitingUser',
      },
    }, 'crud-create')
    expect(created.result).toMatchObject({
      ok: true,
      value: { designSession: { title: 'Campaign routes', revision: 1, status: 'awaitingUser' } },
    })
    const createdValue = (created.result as RpcSuccess).value.designSession
    if (!isRecord(createdValue)) throw new Error('Gateway create omitted designSession')
    const createdId = createdValue.id
    if (typeof createdId !== 'string') throw new Error('Gateway create omitted designSession.id')
    await waitForFrame(first.frames, frame => frame.type === 'item' && frame.streamId === first.streamId
      && isRecord(frame.value) && frame.value.type === 'upsert'
      && isRecord(frame.value.designSession) && frame.value.designSession.revision === 1)

    const listed = await rpc(origin, cookie, 'designWorkbench/list', {}, 'crud-list')
    expect(listed.result).toMatchObject({ ok: true, value: { items: [{ id: createdId, revision: 1 }] } })
    const fetched = await rpc(origin, cookie, 'designWorkbench/get', {
      request: { designSessionId: createdId },
    }, 'crud-get')
    expect(fetched.result).toMatchObject({ ok: true, value: { designSession: { id: createdId, revision: 1 } } })

    const updated = await rpc(origin, cookie, 'designWorkbench/update', {
      request: {
        designSessionId: createdId,
        expectedRevision: 1,
        title: 'Canonical route',
        status: 'confirmed',
      },
    }, 'crud-update')
    expect(updated.result).toMatchObject({
      ok: true,
      value: { designSession: { id: createdId, revision: 2, title: 'Canonical route', status: 'confirmed' } },
    })
    await waitForFrame(first.frames, frame => frame.type === 'item' && frame.streamId === first.streamId
      && isRecord(frame.value) && frame.value.type === 'upsert'
      && isRecord(frame.value.designSession) && frame.value.designSession.revision === 2)

    await new Promise<void>((resolve, reject) => {
      first.socket.once('close', () => { resolve() })
      first.socket.once('error', reject)
      first.socket.close()
    })

    const staleWrites = await Promise.all([
      rpc(origin, cookie, 'designWorkbench/update', {
        request: { designSessionId: createdId, expectedRevision: 2, title: 'Winner A' },
      }, 'conflict-a'),
      rpc(origin, cookie, 'designWorkbench/update', {
        request: { designSessionId: createdId, expectedRevision: 2, title: 'Stale B' },
      }, 'conflict-b'),
    ])
    const winner = staleWrites.find(result => result.result.ok)
    const conflict = staleWrites.find(result => !result.result.ok)
    expect(winner?.result).toMatchObject({ ok: true, value: { designSession: { revision: 3 } } })
    expect(conflict?.result).toMatchObject({
      ok: false,
      error: {
        code: 'design-session/conflict',
        details: { designSessionId: createdId, expectedRevision: 2, actualRevision: 3 },
      },
    })

    const winnerValue = (winner?.result as RpcSuccess | undefined)?.value.designSession
    if (!isRecord(winnerValue)) throw new Error('Gateway winner omitted designSession')
    const second = await openFollow(origin, cookie, 'follow-b')
    expect(second.frames).toContainEqual({
      type: 'item',
      streamId: 'follow-b',
      value: { type: 'baseline', value: { items: [winnerValue] } },
    })

    const deleted = await rpc(origin, cookie, 'designWorkbench/delete', {
      request: { designSessionId: createdId, expectedRevision: winnerValue.revision },
    }, 'crud-delete')
    expect(deleted.result).toEqual({ ok: true, value: { deleted: true } })
    await waitForFrame(second.frames, frame => frame.type === 'item' && frame.streamId === second.streamId
      && isRecord(frame.value) && frame.value.type === 'remove' && frame.value.designSessionId === createdId)

    const finalList = await rpc(origin, cookie, 'designWorkbench/list', {}, 'crud-final-list')
    expect(finalList.result).toEqual({ ok: true, value: { items: [] } })
  }, 15_000)
})
