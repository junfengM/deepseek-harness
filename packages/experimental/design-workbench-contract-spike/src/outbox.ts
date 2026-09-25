/** Idempotent delivery from DesignSession outbox records to source Session events. */

import type { Session } from '@deepseek-ai/dsh-session'
import type { DesignSessionRegistry } from './registry.ts'
import type { DesignSessionChangeEvent, DesignSessionId } from './types.ts'

/** Optional deterministic failure seams used by the Phase-zero recovery test. */
export interface DesignOutboxDeliveryHooks {
  /** Persist appended Session events before the domain delivery marker commits. */
  readonly flush: (session: Session) => Promise<void>
  /** Test-only crash boundary after Session durability and before domain acknowledgement. */
  readonly afterDurableAppend?: (change: DesignSessionChangeEvent) => void | Promise<void>
  /** Stable clock owned by the caller. */
  readonly now: () => number
}

/**
 * Deliver every pending source-chat change exactly once in the Session log.
 * Existing `changeId` events are acknowledged without appending a duplicate,
 * which makes retry converge after a crash between Session durability and the
 * domain delivery marker.
 */
export async function deliverDesignOutbox(
  registry: DesignSessionRegistry,
  designSessionId: DesignSessionId,
  sourceSession: Session,
  hooks: DesignOutboxDeliveryHooks,
): Promise<void> {
  const initial = registry.get(designSessionId)
  if (initial === undefined) throw new Error(`design session '${designSessionId}' does not exist`)
  if (sourceSession.id !== initial.sourceSessionId) {
    throw new Error(`design session '${designSessionId}' belongs to source Session '${initial.sourceSessionId}'`)
  }

  for (const candidate of initial.outbox) {
    if (candidate.deliveredAt !== undefined) continue
    const duplicate = sourceSession.snapshotEvents().some(event =>
      event.type === 'design/session-change' && event.data.changeId === candidate.changeId)
    const change: DesignSessionChangeEvent = {
      version: 1,
      changeId: candidate.changeId,
      designSessionId,
      designRevision: candidate.designRevision,
      sourceSessionId: initial.sourceSessionId,
      kind: candidate.kind,
      compactSummary: candidate.compactSummary,
      happenedAt: candidate.happenedAt,
    }
    if (!duplicate) {
      sourceSession.append('design/session-change', change)
      await hooks.flush(sourceSession)
      await hooks.afterDurableAppend?.(change)
    }
    const current = registry.get(designSessionId)
    if (current === undefined) throw new Error(`design session '${designSessionId}' disappeared during delivery`)
    await registry.markDelivered({
      id: designSessionId,
      expectedRevision: current.revision,
      changeId: candidate.changeId,
      deliveredAt: hooks.now(),
    })
  }
}
