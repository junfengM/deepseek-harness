/** Reconnect-safe baseline/increment feed for DesignSession state. */

import type { Context } from '@deepseek-ai/cordis'
import { Deque } from '@deepseek-ai/dsh-deque'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import { DesignSessionId, designSessionRecord } from './domain.ts'
import type {
  DesignSessionRecord,
  DesignSessionView,
  DesignWorkbenchBaseline,
  DesignWorkbenchFollowFrame,
} from './types.ts'

/** Project internal durable state into the browser contract. */
export function designSessionView(record: DesignSessionRecord): DesignSessionView {
  return {
    id: record.id,
    revision: record.revision,
    title: record.title,
    status: record.status,
    sourceSessionId: record.sourceSessionId,
    ...(record.linkedAgentSessionId === undefined ? {} : { linkedAgentSessionId: record.linkedAgentSessionId }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/** Own all active follow generations over the formal domain. */
export class DesignWorkbenchFeed {
  private readonly followers = new Set<DesignWorkbenchFollower>()

  constructor(private readonly ctx: Context) {
    ctx.on('domain/changed', (change: DomainChanged) => { this.changed(change) })
    ctx.effect(() => () => {
      for (const follower of this.followers) follower.close()
      this.followers.clear()
    }, 'design-workbench.feed')
  }

  /** Read a complete authoritative baseline. */
  baseline(): DesignWorkbenchBaseline {
    return { items: this.ctx.designWorkbenchRegistry.list().map(designSessionView) }
  }

  /** Open one generation: one baseline, then ordered increments until close. */
  async *follow(signal: AbortSignal): AsyncIterable<DesignWorkbenchFollowFrame> {
    signal.throwIfAborted()
    const follower = new DesignWorkbenchFollower()
    this.followers.add(follower)
    try {
      yield { type: 'baseline', value: this.baseline() }
      yield* follower.read(signal)
    } finally {
      this.followers.delete(follower)
      follower.close()
    }
  }

  private changed(change: DomainChanged): void {
    if (change.domain !== 'design_workbench' || change.table !== 'sessions') return
    if (change.operation === 'deleted') {
      this.publish({ type: 'remove', designSessionId: DesignSessionId(change.key) })
      return
    }
    this.publish({
      type: 'upsert',
      designSession: designSessionView(designSessionRecord.parse(change.value)),
    })
  }

  private publish(frame: Exclude<DesignWorkbenchFollowFrame, { type: 'baseline' }>): void {
    for (const follower of this.followers) follower.push(frame)
  }
}

class DesignWorkbenchFollower {
  private readonly frames = new Deque<DesignWorkbenchFollowFrame>()
  private waiting: (() => void) | undefined
  private closed = false

  push(frame: DesignWorkbenchFollowFrame): void {
    if (this.closed) return
    this.frames.pushBack(frame)
    this.waiting?.()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.waiting?.()
  }

  async *read(signal: AbortSignal): AsyncIterable<DesignWorkbenchFollowFrame> {
    while (!this.closed && !signal.aborted) {
      const frame = this.frames.popFront()
      if (frame !== undefined) {
        yield frame
        continue
      }
      await this.wait(signal)
    }
  }

  private wait(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const finish = (): void => {
        signal.removeEventListener('abort', finish)
        if (this.waiting === finish) this.waiting = undefined
        resolve()
      }
      this.waiting = finish
      signal.addEventListener('abort', finish, { once: true })
      if (signal.aborted || this.closed || this.frames.size > 0) finish()
    })
  }
}
