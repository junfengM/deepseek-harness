/** In-page Design Workbench navigation over Host-authoritative model state. */

import { Service, type Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { DesignSessionId } from '../types.ts'
import type { ClientDesignWorkbenchModel, DesignWorkbenchFollowSink, DesignWorkbenchSnapshot } from './model.ts'
import type { DesignSessionView, DesignWorkbenchBaseline } from '../types.ts'

/** Stable root main-slot key and sidebar activation target. */
export const DESIGN_WORKBENCH_PANEL_ID = brandString<MainPanelId>('design-workbench')

/** Bare observable source. */
export interface SnapshotSource<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** Client service consumed by the shell and future task-card navigation. */
export interface IDesignWorkbench {
  /** Host-authoritative rows and stream lifecycle. */
  readonly state: SnapshotSource<DesignWorkbenchSnapshot>
  /** In-page selected task; not durable business state. */
  readonly selected: SnapshotSource<DesignSessionId | null>
  /** Select an optional task and open the root workbench panel. */
  open(designSessionId?: DesignSessionId): void
  /** Select a task without changing the current Chat Session. */
  select(designSessionId: DesignSessionId): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Client Design Workbench state and root-panel navigation. */
    designWorkbench: IDesignWorkbench
  }
}

/** Owns only ephemeral navigation; all task rows remain Host-authoritative. */
export class ClientDesignWorkbenchService extends Service implements IDesignWorkbench, DesignWorkbenchFollowSink {
  readonly state: SnapshotSource<DesignWorkbenchSnapshot>
  readonly selected: SnapshotSource<DesignSessionId | null>
  private selectedId: DesignSessionId | null = null
  private readonly listeners = new Set<() => void>()

  constructor(ctx: Context, private readonly model: ClientDesignWorkbenchModel) {
    super(ctx, 'designWorkbench')
    this.state = model
    this.selected = {
      getSnapshot: () => this.selectedId,
      subscribe: (listener) => {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
      },
    }
    const unsubscribe = model.subscribe(() => { this.reconcileSelection() })
    ctx.effect(() => unsubscribe, 'design-workbench.selection')
    this.reconcileSelection()
  }

  replaceBaseline(value: DesignWorkbenchBaseline): void {
    // Baseline replay restores durable state but must never reopen historical handoffs.
    this.model.replaceBaseline(value)
  }

  upsertView(view: DesignSessionView): void {
    const isNew = !this.model.getSnapshot().items.some(item => item.id === view.id)
    this.model.upsertView(view)
    // Merge first so open(id) can select it. Only a fresh commit for the
    // currently selected source chat triggers automatic navigation.
    if (isNew && this.ctx.sessions.list.getSnapshot().current === view.sourceSessionId) {
      this.open(view.id)
    }
  }

  removeView(id: DesignSessionId): void {
    this.model.removeView(id)
  }

  open(designSessionId?: DesignSessionId): void {
    if (designSessionId !== undefined) this.select(designSessionId)
    this.ctx.layout.selectPanel(DESIGN_WORKBENCH_PANEL_ID)
  }

  select(designSessionId: DesignSessionId): void {
    if (!this.model.getSnapshot().items.some(item => item.id === designSessionId)) return
    if (this.selectedId === designSessionId) return
    this.selectedId = designSessionId
    this.publishSelection()
  }

  private reconcileSelection(): void {
    const items = this.model.getSnapshot().items
    if (this.selectedId !== null && items.some(item => item.id === this.selectedId)) return
    const next = items[0]?.id ?? null
    if (next === this.selectedId) return
    this.selectedId = next
    this.publishSelection()
  }

  private publishSelection(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch (error) {
        console.error('design-workbench selection subscriber failed:', error)
      }
    }
  }
}
