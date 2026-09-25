/** Reconnecting Client transport for Host-authoritative Design Workbench state. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import {
  RemoteSnapshotStream,
  RemoteStreamCarrierError,
  type ClientRemote,
} from '@deepseek-ai/dsh-api-gateway/client'
import type { DesignWorkbenchFollowFrame, DesignWorkbenchIncrement } from '../types.ts'
import {
  ClientDesignWorkbenchModel,
  type DesignWorkbenchFollowSink,
  type DesignWorkbenchRemote,
} from './model.ts'
import { ClientDesignWorkbenchService } from './service.ts'
import { DESIGN_WORKBENCH_NS, en, zh } from './locales.ts'
import { registerDesignWorkbenchShell } from './shell.tsx'

export {
  ClientDesignWorkbenchModel,
} from './model.ts'
export type {
  DesignWorkbenchFollowSink,
  DesignWorkbenchRemote,
  DesignWorkbenchSnapshot,
} from './model.ts'
export {
  ClientDesignWorkbenchService,
  DESIGN_WORKBENCH_PANEL_ID,
} from './service.ts'
export type { IDesignWorkbench, SnapshotSource } from './service.ts'
export {
  DesignWorkbenchPanel,
  DesignWorkbenchStatus,
  registerDesignWorkbenchShell,
} from './shell.tsx'

/** Gateway Remote with the generated Design Workbench namespace attached. */
export type DesignWorkbenchClientRemote = ClientRemote & {
  readonly designWorkbench: DesignWorkbenchRemote
}

type BaselineFrame = Extract<DesignWorkbenchFollowFrame, { type: 'baseline' }>

/** Reconnecting snapshot stream for Design Workbench state. */
export type DesignWorkbenchStateStream = RemoteSnapshotStream<BaselineFrame, DesignWorkbenchIncrement>

/** Required Client Remote services. */
export const inject = ['remote', 'slots', 'layout', 'sessions', 'locale']

/** Install the generated Remote namespace, model, shell, and reconnecting stream. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  ctx.effect(() => ctx.locale.register(DESIGN_WORKBENCH_NS, { zh, en }), 'design-workbench:dictionaries')
  // api-remotes mounts every generated Remote namespace centrally.
  const namespace = ctx.inject(['remote.designWorkbench'], (namespaceCtx) => {
    const remote = namespaceCtx.remote as DesignWorkbenchClientRemote
    const model = new ClientDesignWorkbenchModel(remote.designWorkbench)
    const disposeModel = namespaceCtx.reflect.provide('designWorkbenchModel', model)
    const workbench = new ClientDesignWorkbenchService(namespaceCtx, model)
    registerDesignWorkbenchShell(namespaceCtx, workbench)
    const control = createDesignWorkbenchStateStream(remote, {
      accept: workbench,
      carrierFailed: () => { model.handleCarrierFailure() },
      failed: (error) => { model.handleStreamFailure(error) },
    })
    control.start()
    namespaceCtx.effect(() => async () => {
      await disposeModel()
      await control.dispose()
    }, 'design-workbench.client.control')
  })
  await namespace
  return async () => {
    await namespace.dispose()
  }
}

/** Stream callback destinations. */
export interface DesignWorkbenchStateStreamOptions {
  readonly accept: DesignWorkbenchFollowSink
  readonly carrierFailed?: (error: RemoteStreamCarrierError) => void
  readonly failed: (error: unknown) => void
}

/** Build an unstarted reconnect-safe baseline/increment stream. */
export function createDesignWorkbenchStateStream(
  remote: DesignWorkbenchClientRemote,
  options: DesignWorkbenchStateStreamOptions,
): DesignWorkbenchStateStream {
  const stream = remote.$stream<DesignWorkbenchFollowFrame>({
    name: 'Design Workbench state stream',
    open: signal => remote.designWorkbench.follow(signal),
    ended: accepted => accepted
      ? new RemoteStreamCarrierError('Design Workbench state stream ended without a terminal result')
      : new Error('Design Workbench state stream ended before its opening snapshot'),
    ...(options.carrierFailed === undefined ? {} : { carrierFailed: options.carrierFailed }),
  })
  return new RemoteSnapshotStream<BaselineFrame, DesignWorkbenchIncrement>(stream, {
    name: 'Design Workbench state stream',
    isSnapshot: (frame): frame is BaselineFrame => frame.type === 'baseline',
    replace: (frame) => { options.accept.replaceBaseline(frame.value) },
    update: (frame) => { acceptIncrement(options.accept, frame) },
    failed: options.failed,
  })
}

function acceptIncrement(sink: DesignWorkbenchFollowSink, frame: DesignWorkbenchIncrement): void {
  switch (frame.type) {
    case 'upsert':
      sink.upsertView(frame.designSession)
      return
    case 'remove':
      sink.removeView(frame.designSessionId)
      return
    default:
      return assertNever(frame)
  }
}

function assertNever(value: never): never {
  throw new Error(`unreachable Design Workbench increment: ${JSON.stringify(value)}`)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** React-free Host-authoritative Design Workbench projection. */
    designWorkbenchModel: ClientDesignWorkbenchModel
  }
}
