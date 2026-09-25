/** Formal Host Design Workbench Remote owner and composition entry. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { DesignSessionId } from './domain.ts'
import { DesignWorkbenchFeed, designSessionView } from './feed.ts'
import {
  DesignSessionConflictError,
  DesignSessionNotFoundError,
  DesignWorkbenchRegistry,
} from './registry.ts'
import type {
  DesignSessionCreateRequest,
  DesignSessionDeleteRequest,
  DesignSessionDeleteValue,
  DesignSessionGetRequest,
  DesignSessionListValue,
  DesignSessionUpdateRequest,
  DesignSessionValue,
  DesignWorkbenchFollowFrame,
} from './types.ts'

export type * from './types.ts'
export { DesignSessionId, designSessionRecord, designWorkbenchDomainSpec } from './domain.ts'
export {
  DesignSessionConflictError,
  DesignSessionNotFoundError,
  DesignWorkbenchRegistry,
} from './registry.ts'
export { DesignWorkbenchFeed, designSessionView } from './feed.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Design Workbench Remote namespace owner. */
    designWorkbenchController: DesignWorkbenchController
  }
}

/** Host service backing `ctx.remote.designWorkbench`. */
export class DesignWorkbenchController extends TypertRemoteService {
  static inject = ['typert', 'designWorkbenchRegistry']

  private readonly feed: DesignWorkbenchFeed

  constructor(ctx: Context) {
    super(ctx, 'designWorkbenchController', { namespace: 'designWorkbench' })
    this.feed = new DesignWorkbenchFeed(ctx)
  }

  /** Create one Host-minted DesignSession. */
  @Remote('create')
  async create(request: DesignSessionCreateRequest): Promise<DesignSessionValue> {
    const title = request.title.trim()
    if (title === '') throw new RemoteError('gateway/bad-request', 'DesignSession title must not be blank', {})
    const designSession = await this.ctx.designWorkbenchRegistry.create({
      id: DesignSessionId(`design-${randomUUID()}`),
      title,
      status: request.status ?? 'active',
      sourceSessionId: request.sourceSessionId,
      ...(request.linkedAgentSessionId === undefined ? {} : { linkedAgentSessionId: request.linkedAgentSessionId }),
      now: Date.now(),
    })
    return { designSession: designSessionView(designSession) }
  }

  /** List every current DesignSession. */
  @Remote('list')
  list(): Promise<DesignSessionListValue> {
    return Promise.resolve({ items: this.ctx.designWorkbenchRegistry.list().map(designSessionView) })
  }

  /** Get one current DesignSession. */
  @Remote('get')
  get(request: DesignSessionGetRequest): Promise<DesignSessionValue> {
    const record = this.ctx.designWorkbenchRegistry.get(request.designSessionId)
    if (record === undefined) return Promise.reject(notFound(request.designSessionId))
    return Promise.resolve({ designSession: designSessionView(record) })
  }

  /** Apply a revision-checked title/status patch. */
  @Remote('update')
  async update(request: DesignSessionUpdateRequest): Promise<DesignSessionValue> {
    const title = request.title?.trim()
    if (title === '') throw new RemoteError('gateway/bad-request', 'DesignSession title must not be blank', {})
    if (title === undefined && request.status === undefined) {
      throw new RemoteError('gateway/bad-request', 'DesignSession update requires title or status', {})
    }
    try {
      const record = await this.ctx.designWorkbenchRegistry.update({
        id: request.designSessionId,
        expectedRevision: request.expectedRevision,
        ...(title === undefined ? {} : { title }),
        ...(request.status === undefined ? {} : { status: request.status }),
        now: Date.now(),
      })
      return { designSession: designSessionView(record) }
    } catch (error) {
      throw mappedRegistryError(error)
    }
  }

  /** Delete exactly the revision named by the caller. */
  @Remote('delete')
  async delete(request: DesignSessionDeleteRequest): Promise<DesignSessionDeleteValue> {
    try {
      await this.ctx.designWorkbenchRegistry.delete(request.designSessionId, request.expectedRevision)
      return { deleted: true }
    } catch (error) {
      throw mappedRegistryError(error)
    }
  }

  /** Stream one complete baseline followed by ordered committed increments. */
  @Remote({ mode: 'stream' })
  follow(signal: AbortSignal): AsyncIterable<DesignWorkbenchFollowFrame> {
    return this.feed.follow(signal)
  }
}

/** Required Host services. */
export const inject = ['storageDomain', 'typert']

/** Compose the formal registry before the Remote controller. */
export function apply(ctx: Context): void {
  ctx.plugin(DesignWorkbenchRegistry)
  ctx.plugin(DesignWorkbenchController)
}

function mappedRegistryError(error: unknown): RemoteError {
  if (error instanceof DesignSessionConflictError) {
    return new RemoteError('design-session/conflict', error.message, {
      designSessionId: error.designSessionId,
      expectedRevision: error.expectedRevision,
      actualRevision: error.actualRevision,
    }, { cause: error })
  }
  if (error instanceof DesignSessionNotFoundError) return notFound(error.designSessionId, error)
  if (error instanceof RemoteError) throw error
  throw error
}

function notFound(designSessionId: DesignSessionGetRequest['designSessionId'], cause?: unknown): RemoteError<'design-session/not-found'> {
  return new RemoteError(
    'design-session/not-found',
    `DesignSession '${designSessionId}' not found`,
    { designSessionId },
    cause === undefined ? undefined : { cause },
  )
}
