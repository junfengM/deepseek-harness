/** Authoritative revisioned DesignSession registry over storage-domain. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Domain, DomainFacility, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { designWorkbenchDomainSpec } from './spec.ts'
import type {
  DesignChangeId,
  DesignSessionChangeKind,
  DesignSessionId,
  DesignSessionRecord,
} from './types.ts'

/** Compare-and-set mutation named a stale DesignSession revision. */
export class DesignSessionConflictError extends Error {
  constructor(
    readonly designSessionId: DesignSessionId,
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(`design session '${designSessionId}' revision conflict: expected ${expectedRevision}, found ${actualRevision}`)
    this.name = 'DesignSessionConflictError'
  }
}

/** Minimal durable registry used to prove Phase-zero storage and outbox semantics. */
export class DesignSessionRegistry {
  private constructor(
    private readonly domain: Domain<typeof designWorkbenchDomainSpec>,
    private readonly sessions: KvTable<DesignSessionId, DesignSessionRecord>,
  ) {}

  /** Open the single Design Workbench domain through the production facility. */
  static async open(facility: DomainFacility): Promise<DesignSessionRegistry> {
    const domain = await facility.open(designWorkbenchDomainSpec)
    return new DesignSessionRegistry(domain, domain.table('sessions'))
  }

  /** Close and release the underlying storage unit. */
  async close(): Promise<void> {
    await this.domain.close()
  }

  /** Read one immutable authoritative record. */
  get(id: DesignSessionId): DesignSessionRecord | undefined {
    return this.sessions.get(id)
  }

  /** Create the initial revision of one DesignSession. */
  async create(input: {
    readonly id: DesignSessionId
    readonly title: string
    readonly sourceSessionId: SessionId
    readonly linkedAgentSessionId?: SessionId
    readonly now: number
  }): Promise<DesignSessionRecord> {
    if (this.sessions.get(input.id) !== undefined) throw new Error(`design session '${input.id}' already exists`)
    const record: DesignSessionRecord = {
      id: input.id,
      revision: 1,
      title: input.title,
      status: 'active',
      sourceSessionId: input.sourceSessionId,
      ...(input.linkedAgentSessionId === undefined ? {} : { linkedAgentSessionId: input.linkedAgentSessionId }),
      outbox: [],
      createdAt: input.now,
      updatedAt: input.now,
    }
    await this.sessions.put(input.id, record)
    return record
  }

  /** Commit one revision and its source-chat outbox pointer atomically in the domain. */
  async enqueueChange(input: {
    readonly id: DesignSessionId
    readonly expectedRevision: number
    readonly changeId: DesignChangeId
    readonly kind: DesignSessionChangeKind
    readonly compactSummary: string
    readonly now: number
  }): Promise<DesignSessionRecord> {
    return await this.sessions.update(input.id, (current) => {
      this.assertRevision(current, input.expectedRevision)
      if (current.outbox.some(entry => entry.changeId === input.changeId)) return current
      const revision = current.revision + 1
      return {
        ...current,
        revision,
        outbox: [...current.outbox, {
          changeId: input.changeId,
          designRevision: revision,
          kind: input.kind,
          compactSummary: input.compactSummary,
          happenedAt: input.now,
        }],
        updatedAt: input.now,
      }
    })
  }

  /** Mark one outbox entry delivered under optimistic revision control. */
  async markDelivered(input: {
    readonly id: DesignSessionId
    readonly expectedRevision: number
    readonly changeId: DesignChangeId
    readonly deliveredAt: number
  }): Promise<DesignSessionRecord> {
    return await this.sessions.update(input.id, (current) => {
      this.assertRevision(current, input.expectedRevision)
      const index = current.outbox.findIndex(entry => entry.changeId === input.changeId)
      const existing = current.outbox[index]
      if (existing === undefined) throw new Error(`design change '${input.changeId}' does not exist`)
      if (existing.deliveredAt !== undefined) return current
      const outbox = [...current.outbox]
      outbox[index] = { ...existing, deliveredAt: input.deliveredAt }
      return {
        ...current,
        revision: current.revision + 1,
        outbox,
        updatedAt: input.deliveredAt,
      }
    })
  }

  private assertRevision(current: DesignSessionRecord, expected: number): void {
    if (current.revision !== expected) {
      throw new DesignSessionConflictError(current.id, expected, current.revision)
    }
  }
}
