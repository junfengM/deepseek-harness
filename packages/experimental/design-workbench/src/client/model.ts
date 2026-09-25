/** Host-authoritative Client projection for Design Workbench state. */

import { notifySubscribers } from '@deepseek-ai/dsh-client-store'
import { isRemoteFailure } from '@deepseek-ai/dsh-api-gateway/client'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  DesignSessionCreateRequest,
  DesignSessionDeleteRequest,
  DesignSessionDeleteValue,
  DesignSessionGetRequest,
  DesignSessionListValue,
  DesignSessionUpdateRequest,
  DesignSessionValue,
  DesignSessionId,
  DesignSessionView,
  DesignWorkbenchBaseline,
  DesignWorkbenchFollowFrame,
} from '../types.ts'

/** Minimal generated-Remote-compatible face used by the Client model. */
export interface DesignWorkbenchRemote {
  create(request: DesignSessionCreateRequest): Promise<RemoteResult<DesignSessionValue>>
  list(): Promise<RemoteResult<DesignSessionListValue>>
  get(request: DesignSessionGetRequest): Promise<RemoteResult<DesignSessionValue>>
  update(request: DesignSessionUpdateRequest): Promise<RemoteResult<DesignSessionValue>>
  delete(request: DesignSessionDeleteRequest): Promise<RemoteResult<DesignSessionDeleteValue>>
  follow(signal?: AbortSignal): AsyncIterable<DesignWorkbenchFollowFrame>
}

/** Immutable browser snapshot; every business row came from Host Remote state. */
export interface DesignWorkbenchSnapshot {
  readonly items: readonly DesignSessionView[]
  readonly phase: 'pending' | 'ready'
  readonly state: 'loading' | 'idle' | 'error'
  readonly error: RemoteFailure | null
}

/** Decoded operations accepted from one reconnecting follow generation. */
export interface DesignWorkbenchFollowSink {
  replaceBaseline(value: DesignWorkbenchBaseline): void
  upsertView(view: DesignSessionView): void
  removeView(id: DesignSessionId): void
}

/** React-free authoritative Client model with no localStorage persistence. */
export class ClientDesignWorkbenchModel implements DesignWorkbenchFollowSink {
  private items: readonly DesignSessionView[] = []
  private phase: DesignWorkbenchSnapshot['phase'] = 'pending'
  private state: DesignWorkbenchSnapshot['state'] = 'loading'
  private error: RemoteFailure | null = null
  private readonly listeners = new Set<() => void>()
  private snapshot: DesignWorkbenchSnapshot = this.buildSnapshot()

  constructor(private readonly remote: DesignWorkbenchRemote) {}

  getSnapshot(): DesignWorkbenchSnapshot {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  replaceBaseline(value: DesignWorkbenchBaseline): void {
    this.items = [...value.items]
    this.phase = 'ready'
    this.state = 'idle'
    this.error = null
    this.publish()
  }

  upsertView(view: DesignSessionView): void {
    const index = this.items.findIndex(item => item.id === view.id)
    const current = this.items[index]
    if (current !== undefined && current.revision > view.revision) return
    this.items = index < 0
      ? [view, ...this.items]
      : this.items.map((item, position) => position === index ? view : item)
    this.publish()
  }

  removeView(id: DesignSessionId): void {
    const next = this.items.filter(item => item.id !== id)
    if (next.length === this.items.length) return
    this.items = next
    this.publish()
  }

  /** Submit a revision-checked mutation and merge only a Host success. */
  async update(request: DesignSessionUpdateRequest): Promise<RemoteResult<DesignSessionValue>> {
    const result = await this.remote.update(request)
    if (result.ok) this.upsertView(result.value.designSession)
    return result
  }

  /** Mark a retryable carrier gap while retaining the last Host baseline. */
  handleCarrierFailure(): void {
    this.state = 'loading'
    this.error = null
    this.publish()
  }

  /** Publish a terminal business/protocol failure without inventing rows. */
  handleStreamFailure(error: unknown): void {
    this.state = 'error'
    this.error = isRemoteFailure(error)
      ? error
      : new RemoteError('gateway/internal', error instanceof Error ? error.message : String(error), {})
    this.publish()
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot()
    notifySubscribers(this.listeners, 'design-workbench model')
  }

  private buildSnapshot(): DesignWorkbenchSnapshot {
    return {
      items: this.items,
      phase: this.phase,
      state: this.state,
      error: this.error,
    }
  }
}
