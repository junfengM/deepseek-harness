/** Minimal root-shell projection for Design Workbench tasks. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SidebarPluginOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsRuntime, SlotComponent } from '@deepseek-ai/dsh-client-ui-slots'
import React, { useSyncExternalStore } from 'react'
import type { IDesignWorkbench } from './service.ts'
import { DESIGN_WORKBENCH_PANEL_ID } from './service.ts'

interface WorkbenchInjected {
  readonly workbench: IDesignWorkbench
}

type PanelProps = PropsRuntime<'main'> & WorkbenchInjected
type StatusProps = PropsRuntime<'sidebar.plugin'> & SidebarPluginOwnerProps & WorkbenchInjected

/** Shell-owned status glyph content: only Host rows awaiting user input. */
export function DesignWorkbenchStatus({ workbench }: StatusProps): React.JSX.Element | null {
  const snapshot = useSyncExternalStore(
    listener => workbench.state.subscribe(listener),
    () => workbench.state.getSnapshot(),
  )
  const count = snapshot.items.filter(item => item.status === 'awaitingUser').length
  if (count === 0) return null
  return <span aria-label={`${count} design ${count === 1 ? 'task' : 'tasks'} awaiting user`}>{count}</span>
}

/** Minimal list/detail panel; no preview, feedback, DecisionPack, or chat controls. */
export function DesignWorkbenchPanel({ workbench }: PanelProps): React.JSX.Element {
  const snapshot = useSyncExternalStore(
    listener => workbench.state.subscribe(listener),
    () => workbench.state.getSnapshot(),
  )
  const selectedId = useSyncExternalStore(
    listener => workbench.selected.subscribe(listener),
    () => workbench.selected.getSnapshot(),
  )
  const selected = snapshot.items.find(item => item.id === selectedId)

  return (
    <main aria-label="Design Workbench">
      <header>
        <h1>Design Workbench</h1>
        <p>Durable design tasks from the Host.</p>
      </header>
      {snapshot.state === 'loading' && <p role="status">Reconnecting…</p>}
      {snapshot.state === 'error' && <p role="alert">Unable to refresh design tasks.</p>}
      <section aria-label="Design tasks">
        <h2>Tasks</h2>
        {snapshot.phase === 'pending' && <p role="status">Loading tasks…</p>}
        {snapshot.phase === 'ready' && snapshot.items.length === 0 && <p>No design tasks yet.</p>}
        <ul>
          {snapshot.items.map(item => (
            <li key={item.id}>
              <button
                type="button"
                aria-pressed={item.id === selectedId}
                onClick={() => { workbench.select(item.id) }}
              >
                {item.title} · {item.status}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Design task details">
        <h2>Details</h2>
        {selected === undefined
          ? <p>Select a task to inspect its durable summary.</p>
          : (
            <dl>
              <dt>Title</dt><dd>{selected.title}</dd>
              <dt>Status</dt><dd>{selected.status}</dd>
              <dt>Revision</dt><dd>{selected.revision}</dd>
              <dt>Source Session</dt><dd>{selected.sourceSessionId}</dd>
            </dl>
          )}
      </section>
    </main>
  )
}

/** Register the keyed main occupant and shell-owned plugin entry. */
export function registerDesignWorkbenchShell(ctx: Context, workbench: IDesignWorkbench): void {
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: DESIGN_WORKBENCH_PANEL_ID,
    inject: () => ({ workbench }),
  }, DesignWorkbenchPanel as SlotComponent<PanelProps>))

  ctx.slots.inject('sidebar.plugin', () => ctx.slots.register({
    name: 'sidebar.plugin',
    id: 'design-workbench',
    order: 40,
    label: 'Design Workbench',
    registration: {
      icon: 'sparkle',
      group: 'Create',
      hasStatus: true,
      open: () => { workbench.open() },
    },
    inject: () => ({ workbench }),
  }, DesignWorkbenchStatus as SlotComponent<StatusProps>))
}
