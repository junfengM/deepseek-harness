/** Storage-domain declaration for the Phase-zero DesignSession record. */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { DesignChangeId, DesignSessionId } from './types.ts'
import type { DesignSessionRecord } from './types.ts'

const safeRevision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const sessionId = z.string().min(1).transform(value => brandString<SessionId>(value))
const designSessionId = z.string().min(1).transform(value => DesignSessionId(value))
const changeId = z.string().min(1).transform(value => DesignChangeId(value))

const outboxEntry = z.object({
  changeId,
  designRevision: safeRevision,
  kind: z.enum(['created', 'route-selected', 'decision-pack-confirmed']),
  compactSummary: z.string().min(1),
  happenedAt: timestamp,
  deliveredAt: timestamp.optional(),
}).strict()

/** Runtime validation for every durable DesignSession record. */
export const designSessionRecord = z.object({
  id: designSessionId,
  revision: safeRevision,
  title: z.string().min(1),
  status: z.enum(['active', 'confirmed', 'completed']),
  sourceSessionId: sessionId,
  linkedAgentSessionId: sessionId.optional(),
  outbox: z.array(outboxEntry),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict() as z.ZodType<DesignSessionRecord>

/** One private Phase-zero domain containing DesignSession records. */
export const designWorkbenchDomainSpec = defineDomain({
  name: 'design_workbench_contract_spike',
  version: 1,
  tables: {
    sessions: domainTable<DesignSessionId, DesignSessionRecord>(designSessionRecord),
  },
})
