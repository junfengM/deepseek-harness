/** Browser-safe Design Workbench records and Remote transport vocabulary. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Stable identity of one authoritative design task. */
export type DesignSessionId = Branded<'DesignSessionId'>

/** Supported Phase 1 task lifecycle. */
export type DesignSessionStatus = 'active' | 'awaitingUser' | 'confirmed' | 'completed'

/** Durable internal source-chat delivery row retained for later phases. */
export interface DesignOutboxEntry {
  readonly changeId: string
  readonly designRevision: number
  readonly kind: 'created' | 'route-selected' | 'decision-pack-confirmed'
  readonly compactSummary: string
  readonly happenedAt: number
  readonly deliveredAt?: number
}

/** Authoritative durable DesignSession record. */
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

/** Browser projection of one DesignSession without internal outbox state. */
export interface DesignSessionView {
  readonly id: DesignSessionId
  readonly revision: number
  readonly title: string
  readonly status: DesignSessionStatus
  readonly sourceSessionId: SessionId
  readonly linkedAgentSessionId?: SessionId
  readonly createdAt: number
  readonly updatedAt: number
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The requested DesignSession does not exist. */
    'design-session/not-found': { readonly designSessionId: DesignSessionId }
    /** An optimistic mutation named a stale authoritative revision. */
    'design-session/conflict': {
      readonly designSessionId: DesignSessionId
      readonly expectedRevision: number
      readonly actualRevision: number
    }
  }
}

/** Host-minted DesignSession creation. */
export interface DesignSessionCreateRequest {
  readonly title: string
  readonly sourceSessionId: SessionId
  readonly linkedAgentSessionId?: SessionId
  readonly status?: DesignSessionStatus
}

/** Identity lookup. */
export interface DesignSessionGetRequest {
  readonly designSessionId: DesignSessionId
}

/** Revision-checked partial mutation. */
export interface DesignSessionUpdateRequest extends DesignSessionGetRequest {
  readonly expectedRevision: number
  readonly title?: string
  readonly status?: DesignSessionStatus
}

/** Revision-checked deletion. */
export interface DesignSessionDeleteRequest extends DesignSessionGetRequest {
  readonly expectedRevision: number
}

/** Complete DesignSession response. */
export interface DesignSessionValue {
  readonly designSession: DesignSessionView
}

/** Complete DesignSession list response. */
export interface DesignSessionListValue {
  readonly items: readonly DesignSessionView[]
}

/** Durable deletion receipt. */
export interface DesignSessionDeleteValue {
  readonly deleted: true
}

/** Every follow generation begins with this complete authoritative snapshot. */
export interface DesignWorkbenchBaseline {
  readonly items: readonly DesignSessionView[]
}

/** Ordered change after one generation baseline. */
export type DesignWorkbenchIncrement =
  | { readonly type: 'upsert'; readonly designSession: DesignSessionView }
  | { readonly type: 'remove'; readonly designSessionId: DesignSessionId }

/** Reconnect-safe Design Workbench feed frame. */
export type DesignWorkbenchFollowFrame =
  | { readonly type: 'baseline'; readonly value: DesignWorkbenchBaseline }
  | DesignWorkbenchIncrement
