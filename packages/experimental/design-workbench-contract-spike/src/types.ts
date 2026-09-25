/** Phase-zero Design Workbench durable identities and records. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Stable identity of one durable design task. */
export type DesignSessionId = Branded<'DesignSessionId'>

/** Brand a validated string as a DesignSession identity. */
export function DesignSessionId(value: string): DesignSessionId {
  return value as DesignSessionId
}

/** Stable idempotency identity for one source-chat summary. */
export type DesignChangeId = Branded<'DesignChangeId'>

/** Brand a validated string as a design change identity. */
export function DesignChangeId(value: string): DesignChangeId {
  return value as DesignChangeId
}

/** Phase-zero lifecycle intentionally narrower than the eventual product state machine. */
export type DesignSessionStatus = 'active' | 'confirmed' | 'completed'

/** Source-chat change kinds proven by the Phase-zero event seam. */
export type DesignSessionChangeKind = 'created' | 'route-selected' | 'decision-pack-confirmed'

/** One durable source-chat delivery awaiting or recording completion. */
export interface DesignOutboxEntry {
  readonly changeId: DesignChangeId
  readonly designRevision: number
  readonly kind: DesignSessionChangeKind
  readonly compactSummary: string
  readonly happenedAt: number
  readonly deliveredAt?: number
}

/** Minimal authoritative DesignSession record used by the contract spike. */
export interface DesignSessionRecord {
  readonly id: DesignSessionId
  readonly revision: number
  readonly title: string
  readonly status: DesignSessionStatus
  readonly sourceSessionId: SessionId
  readonly linkedAgentSessionId?: SessionId
  readonly outbox: readonly DesignOutboxEntry[]
  readonly createdAt: number
  readonly updatedAt: number
}

/** Durable informational payload written to the source Chat Session. */
export interface DesignSessionChangeEvent {
  readonly version: 1
  readonly changeId: DesignChangeId
  readonly designSessionId: DesignSessionId
  readonly designRevision: number
  readonly sourceSessionId: SessionId
  readonly kind: DesignSessionChangeKind
  readonly compactSummary: string
  readonly happenedAt: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Informational pointer from a source chat to authoritative DesignSession state. */
    'design/session-change': DesignSessionChangeEvent
  }
}
