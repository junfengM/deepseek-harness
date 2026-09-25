import { describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  RemoteStream,
  RemoteStreamCarrierError,
  type RemoteStreamOptions,
} from '@deepseek-ai/dsh-api-gateway/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  ClientDesignWorkbenchModel,
  createDesignWorkbenchStateStream,
  type DesignWorkbenchClientRemote,
  type DesignWorkbenchRemote,
} from '../src/client/index.ts'
import type {
  DesignSessionCreateRequest,
  DesignSessionDeleteRequest,
  DesignSessionDeleteValue,
  DesignSessionGetRequest,
  DesignSessionId,
  DesignSessionListValue,
  DesignSessionUpdateRequest,
  DesignSessionValue,
  DesignSessionView,
  DesignWorkbenchFollowFrame,
} from '../src/types.ts'

const AVAILABLE_CONNECTION = {
  generation: {
    getSnapshot: () => ({ id: 1, host: { home: '/home/fixture' } }),
    subscribe: () => () => {},
  },
}

const id = (value: string): DesignSessionId => brandString<DesignSessionId>(value)
const sessionId = (value: string): SessionId => brandString<SessionId>(value)

function view(value: string, revision = 1, title = value): DesignSessionView {
  return {
    id: id(value),
    revision,
    title,
    status: 'active',
    sourceSessionId: sessionId('source-chat'),
    createdAt: 1,
    updatedAt: revision,
  }
}

function ok<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

interface Generation {
  readonly frames: readonly DesignWorkbenchFollowFrame[]
  readonly error?: unknown
  readonly hold?: boolean
}

class ScriptedRemote implements DesignWorkbenchRemote {
  calls = 0
  readonly signals: AbortSignal[] = []
  onUpdate: (request: DesignSessionUpdateRequest) => Promise<RemoteResult<DesignSessionValue>> = request =>
    Promise.resolve(ok({ designSession: view(String(request.designSessionId), request.expectedRevision + 1) }))

  constructor(private readonly generations: readonly Generation[] = []) {}

  create(_request: DesignSessionCreateRequest): Promise<RemoteResult<DesignSessionValue>> { throw new Error('unused') }
  list(): Promise<RemoteResult<DesignSessionListValue>> { throw new Error('unused') }
  get(_request: DesignSessionGetRequest): Promise<RemoteResult<DesignSessionValue>> { throw new Error('unused') }
  update(request: DesignSessionUpdateRequest): Promise<RemoteResult<DesignSessionValue>> { return this.onUpdate(request) }
  delete(_request: DesignSessionDeleteRequest): Promise<RemoteResult<DesignSessionDeleteValue>> { throw new Error('unused') }

  async *follow(signal = new AbortController().signal): AsyncIterable<DesignWorkbenchFollowFrame> {
    const generation = this.generations[this.calls++]
    if (generation === undefined) throw new Error('no scripted Design Workbench generation')
    this.signals.push(signal)
    for (const frame of generation.frames) yield frame
    if (generation.error !== undefined) throw generation.error
    if (generation.hold === true && !signal.aborted) {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
    }
  }
}

function clientRemote(
  namespace: DesignWorkbenchRemote,
  connection: Pick<ConnectionHandle, 'generation'> = AVAILABLE_CONNECTION,
): DesignWorkbenchClientRemote {
  return {
    designWorkbench: namespace,
    $stream: <Item>(options: RemoteStreamOptions<Item>) => new RemoteStream(connection, options),
  } as DesignWorkbenchClientRemote
}

describe('ClientDesignWorkbenchModel', () => {
  it('replaces baselines, applies upsert/remove increments, and ignores a stale row', () => {
    const model = new ClientDesignWorkbenchModel(new ScriptedRemote())
    model.replaceBaseline({ items: [view('one', 2, 'current')] })
    expect(model.getSnapshot()).toMatchObject({ phase: 'ready', state: 'idle', items: [{ title: 'current' }] })

    model.upsertView(view('one', 1, 'stale'))
    expect(model.getSnapshot().items[0]?.title).toBe('current')
    model.upsertView(view('one', 3, 'fresh'))
    expect(model.getSnapshot().items[0]?.title).toBe('fresh')
    model.removeView(id('one'))
    expect(model.getSnapshot().items).toEqual([])
  })

  it('does not overwrite Host state when a revision-checked update conflicts', async () => {
    const remote = new ScriptedRemote()
    remote.onUpdate = request => Promise.resolve({
      ok: false,
      error: new RemoteError('design-session/conflict', 'stale writer', {
        designSessionId: request.designSessionId,
        expectedRevision: request.expectedRevision,
        actualRevision: 2,
      }),
    })
    const model = new ClientDesignWorkbenchModel(remote)
    model.replaceBaseline({ items: [view('shared', 2, 'Host winner')] })

    await expect(model.update({
      designSessionId: id('shared'),
      expectedRevision: 1,
      title: 'Stale browser',
    })).resolves.toMatchObject({ ok: false, error: { code: 'design-session/conflict' } })
    expect(model.getSnapshot().items[0]).toMatchObject({ revision: 2, title: 'Host winner' })
  })
})

describe('Design Workbench reconnect stream', () => {
  it('retains old data across carrier loss and replaces it from the next baseline', async () => {
    const carrier = new RemoteStreamCarrierError('socket lost')
    const remote = new ScriptedRemote([
      { frames: [{ type: 'baseline', value: { items: [view('old')] } }], error: carrier },
      { frames: [{ type: 'baseline', value: { items: [view('fresh')] } }], hold: true },
    ])
    const model = new ClientDesignWorkbenchModel(remote)
    const carrierFailed = vi.fn()
    const failed = vi.fn()
    const stream = createDesignWorkbenchStateStream(clientRemote(remote), {
      accept: model,
      carrierFailed: (error) => {
        model.handleCarrierFailure()
        carrierFailed(error)
      },
      failed: (error) => {
        model.handleStreamFailure(error)
        failed(error)
      },
    })

    stream.start()
    await vi.waitFor(() => { expect(model.getSnapshot().items[0]?.id).toBe(id('fresh')) })
    expect(carrierFailed).toHaveBeenCalledWith(carrier)
    expect(failed).not.toHaveBeenCalled()
    expect(model.getSnapshot()).toMatchObject({ state: 'idle', phase: 'ready' })
    await stream.dispose()
    expect(remote.signals.at(-1)?.aborted).toBe(true)
  })

  it('publishes a terminal protocol error after an accepted baseline', async () => {
    const remote = new ScriptedRemote([{
      frames: [
        { type: 'baseline', value: { items: [view('first')] } },
        { type: 'baseline', value: { items: [view('duplicate')] } },
      ],
    }])
    const model = new ClientDesignWorkbenchModel(remote)
    const stream = createDesignWorkbenchStateStream(clientRemote(remote), {
      accept: model,
      failed: (error) => { model.handleStreamFailure(error) },
    })

    stream.start()
    await vi.waitFor(() => { expect(model.getSnapshot().state).toBe('error') })
    expect(model.getSnapshot()).toMatchObject({
      items: [{ id: 'first' }],
      error: { code: 'gateway/internal', message: 'Design Workbench state stream emitted more than one opening snapshot' },
    })
    await stream.dispose()
  })
})
