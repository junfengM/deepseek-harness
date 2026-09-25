/** Authoritative DesignSession registry over the formal storage domain. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { designWorkbenchDomainSpec } from './domain.ts'
import type {
  DesignSessionId,
  DesignSessionRecord,
  DesignSessionStatus,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Formal Host authority for DesignSession state. */
    designWorkbenchRegistry: DesignWorkbenchRegistry
  }
}

/** A mutation named a stale authoritative revision. */
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

/** Host storage-domain service for DesignSession state. */
export class DesignWorkbenchRegistry extends Service {
  static inject = ['storageDomain']

  private sessions?: KvTable<DesignSessionId, DesignSessionRecord>
  private operationTail = Promise.resolve()

  constructor(ctx: Context) {
    super(ctx, 'designWorkbenchRegistry')
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(designWorkbenchDomainSpec)
    this.sessions = domain.table('sessions')
    this.ctx.effect(() => () => domain.close(), 'design-workbench.domain')
  }

  /** Return the complete stable record order, newest mutation first. */
  list(): readonly DesignSessionRecord[] {
    return [...this.table().entries()].map(([, record]) => record).sort((left, right) =>
      right.updatedAt - left.updatedAt || String(left.id).localeCompare(String(right.id)))
  }

  /** Read one record. */
  get(id: DesignSessionId): DesignSessionRecord | undefined {
    return this.table().get(id)
  }

  /** Create revision one under a Host-minted identity. */
  create(input: {
    readonly id: DesignSessionId
    readonly title: string
    readonly status: DesignSessionStatus
    readonly sourceSessionId: SessionId
    readonly linkedAgentSessionId?: SessionId
    readonly now: number
  }): Promise<DesignSessionRecord> {
    return this.enqueue(async () => {
      if (this.table().get(input.id) !== undefined) throw new Error(`design session '${input.id}' already exists`)
      const record: DesignSessionRecord = {
        id: input.id,
        revision: 1,
        title: input.title,
        status: input.status,
        sourceSessionId: input.sourceSessionId,
        ...(input.linkedAgentSessionId === undefined ? {} : { linkedAgentSessionId: input.linkedAgentSessionId }),
        outbox: [],
        createdAt: input.now,
        updatedAt: input.now,
      }
      await this.table().put(input.id, record)
      return record
    })
  }

  /** Commit a revision-checked title/status mutation. */
  update(input: {
    readonly id: DesignSessionId
    readonly expectedRevision: number
    readonly title?: string
    readonly status?: DesignSessionStatus
    readonly now: number
  }): Promise<DesignSessionRecord> {
    return this.enqueue(async () => {
      const current = this.table().get(input.id)
      if (current === undefined) throw new DesignSessionNotFoundError(input.id)
      this.assertRevision(current, input.expectedRevision)
      return await this.table().update(input.id, value => ({
        ...value,
        revision: value.revision + 1,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.status === undefined ? {} : { status: input.status }),
        updatedAt: input.now,
      }))
    })
  }

  /** Delete exactly the revision named by the caller. */
  delete(id: DesignSessionId, expectedRevision: number): Promise<boolean> {
    return this.enqueue(async () => {
      const current = this.table().get(id)
      if (current === undefined) throw new DesignSessionNotFoundError(id)
      this.assertRevision(current, expectedRevision)
      return await this.table().delete(id)
    })
  }

  private table(): KvTable<DesignSessionId, DesignSessionRecord> {
    if (this.sessions === undefined) throw new Error('DesignWorkbenchRegistry is not initialized')
    return this.sessions
  }

  private assertRevision(current: DesignSessionRecord, expectedRevision: number): void {
    if (current.revision !== expectedRevision) {
      throw new DesignSessionConflictError(current.id, expectedRevision, current.revision)
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => undefined, () => undefined)
    return result
  }
}

/** A registry operation named an unknown DesignSession. */
export class DesignSessionNotFoundError extends Error {
  constructor(readonly designSessionId: DesignSessionId) {
    super(`design session '${designSessionId}' does not exist`)
    this.name = 'DesignSessionNotFoundError'
  }
}
