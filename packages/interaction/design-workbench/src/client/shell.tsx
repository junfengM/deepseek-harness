/** Minimal root-shell projection for Design Workbench tasks. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SidebarPluginOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsLocale, PropsRuntime, SlotComponent } from '@deepseek-ai/dsh-client-ui-slots'
import React, { useEffect, useSyncExternalStore } from 'react'
import { DESIGN_WORKBENCH_NS } from './locales.ts'
import type { IDesignWorkbench } from './service.ts'
import { DESIGN_WORKBENCH_PANEL_ID } from './service.ts'

interface WorkbenchInjected {
  readonly workbench: IDesignWorkbench
}

type PanelProps = PropsRuntime<'main'> & WorkbenchInjected & PropsLocale<typeof DESIGN_WORKBENCH_NS>
type StatusProps =
  & PropsRuntime<'sidebar.plugin'>
  & SidebarPluginOwnerProps
  & WorkbenchInjected
  & PropsLocale<typeof DESIGN_WORKBENCH_NS>

/** Shell-owned status glyph content: only Host rows awaiting user input. */
export function DesignWorkbenchStatus({ workbench, t }: StatusProps): React.JSX.Element | null {
  const snapshot = useSyncExternalStore(
    listener => workbench.state.subscribe(listener),
    () => workbench.state.getSnapshot(),
  )
  const count = snapshot.items.filter(item => item.status === 'awaitingUser').length
  if (count === 0) return null
  const label = count === 1 ? t('status.awaitingOne', { count }) : t('status.awaitingMany', { count })
  return <span aria-label={label}>{count}</span>
}

/** Minimal list/detail panel; no preview, feedback, DecisionPack, or chat controls. */
export function DesignWorkbenchPanel({ workbench, usePanelInfo, t }: PanelProps): React.JSX.Element {
  // The root `main` seat is not session-scoped, so the workbench cannot read the
  // Chat Session being viewed; it instead reports whether it is the panel on
  // screen, which is what keeps a fresh task from stealing an unrelated view.
  const active = usePanelInfo(info => info.activePanelId === DESIGN_WORKBENCH_PANEL_ID)
  useEffect(() => { workbench.notePanelActive(active) }, [workbench, active])
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
    <main aria-label={t('panel.title')}>
      <header>
        <h1>{t('panel.title')}</h1>
        <p>{t('panel.subtitle')}</p>
      </header>
      {snapshot.state === 'loading' && <p role="status">{t('panel.reconnecting')}</p>}
      {snapshot.state === 'error' && <p role="alert">{t('panel.refreshFailed')}</p>}
      <section aria-label={t('tasks.heading')}>
        <h2>{t('tasks.heading')}</h2>
        {snapshot.phase === 'pending' && <p role="status">{t('tasks.loading')}</p>}
        {snapshot.phase === 'ready' && snapshot.items.length === 0 && <p>{t('tasks.empty')}</p>}
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
      <section aria-label={t('details.heading')}>
        <h2>{t('details.heading')}</h2>
        {selected === undefined
          ? <p>{t('details.hint')}</p>
          : (
            <dl>
              <dt>{t('details.title')}</dt><dd>{selected.title}</dd>
              <dt>{t('details.status')}</dt><dd>{selected.status}</dd>
              <dt>{t('details.revision')}</dt><dd>{selected.revision}</dd>
              <dt>{t('details.sourceSession')}</dt><dd>{selected.sourceSessionId}</dd>
            </dl>
          )}
      </section>
    </main>
  )
}

/** Register the keyed main occupant and shell-owned plugin entry. */
export function registerDesignWorkbenchShell(ctx: Context, workbench: IDesignWorkbench): void {
  // The plugin row resolves its label once, at registration time.
  const t = ctx.locale.bind(DESIGN_WORKBENCH_NS)
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: DESIGN_WORKBENCH_PANEL_ID,
    locale: DESIGN_WORKBENCH_NS,
    inject: () => ({ workbench }),
  }, DesignWorkbenchPanel as SlotComponent<PanelProps>))

  ctx.slots.inject('sidebar.plugin', () => ctx.slots.register({
    name: 'sidebar.plugin',
    id: 'design-workbench',
    order: 40,
    label: t('plugin.label'),
    locale: DESIGN_WORKBENCH_NS,
    registration: {
      icon: 'sparkle',
      group: 'Create',
      hasStatus: true,
      open: () => { workbench.open() },
    },
    inject: () => ({ workbench }),
  }, DesignWorkbenchStatus as SlotComponent<StatusProps>))
}
