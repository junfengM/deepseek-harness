/** Formal Design Workbench storage-domain contract. */

import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { DesignSessionId, DesignSessionRecord } from './types.ts'

/** Brand a validated raw identity. */
export function DesignSessionId(value: string): DesignSessionId {
  return brandString<DesignSessionId>(value)
}

const safeRevision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const sessionId = z.string().min(1).transform(value => brandString<SessionId>(value))
const designSessionId = z.string().min(1).transform(value => DesignSessionId(value))

const outboxEntry = z.object({
  changeId: z.string().min(1),
  designRevision: safeRevision,
  kind: z.enum(['created', 'route-selected', 'decision-pack-confirmed']),
  compactSummary: z.string().min(1),
  happenedAt: timestamp,
  deliveredAt: timestamp.optional(),
}).strict()

/** Runtime durability-boundary validator. */
export const designSessionRecord = z.object({
  id: designSessionId,
  revision: safeRevision,
  title: z.string().min(1),
  status: z.enum(['active', 'awaitingUser', 'confirmed', 'completed']),
  sourceSessionId: sessionId,
  linkedAgentSessionId: sessionId.optional(),
  outbox: z.array(outboxEntry),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict() as z.ZodType<DesignSessionRecord>

/** Formal product authority; distinct from the Phase 0 contract-spike domain. */
export const designWorkbenchDomainSpec = defineDomain({
  name: 'design_workbench',
  version: 1,
  tables: {
    sessions: domainTable<DesignSessionId, DesignSessionRecord>(designSessionRecord),
  },
})
