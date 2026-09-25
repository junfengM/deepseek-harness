// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  ClientDesignWorkbenchModel,
  ClientDesignWorkbenchService,
  DESIGN_WORKBENCH_PANEL_ID,
  DesignWorkbenchPanel,
  DesignWorkbenchStatus,
  registerDesignWorkbenchShell,
} from '../src/client/index.ts'
import type { DesignWorkbenchRemote } from '../src/client/model.ts'
import type { DesignSessionId, DesignSessionView } from '../src/types.ts'
import { en } from '../src/client/locales.ts'

const contexts: Context[] = []

const dictionary = en as Record<string, string>

/** English-dictionary translate stub with {param} interpolation. */
const t = ((key: string, params?: Record<string, unknown>) => {
  const value = dictionary[key] ?? key
  return value.replace(/\{(\w+)\}/g, (match, name: string) => {
    const replacement = params?.[name]
    if (typeof replacement === 'string') return replacement
    return typeof replacement === 'number' ? String(replacement) : match
  })
}) as never

afterEach(async () => {
  cleanup()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const id = (value: string): DesignSessionId => brandString<DesignSessionId>(value)
const sessionId = (value: string): SessionId => brandString<SessionId>(value)

function view(value: string, status: DesignSessionView['status']): DesignSessionView {
  return {
    id: id(value),
    revision: 1,
    title: `Task ${value}`,
    status,
    sourceSessionId: sessionId('current-chat'),
    createdAt: 1,
    updatedAt: 1,
  }
}

const unusedRemote = {
  update: () => { throw new Error('shell test never mutates Host state') },
} as unknown as DesignWorkbenchRemote

async function bench() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SlotRegistry)
  const slots = ctx.slots
  const selectPanel = vi.fn()
  ctx.reflect.provide('layout', {
    selectPanel,
    beginNavigation: () => new AbortController().signal,
    toggleSidebar: vi.fn(),
    setSidebarOpen: vi.fn(),
    setSidebarWidth: vi.fn(),
    reportRightPanelTrack: vi.fn(),
  })
  const sessionOpen = vi.fn()
  ctx.reflect.provide('locale', {
    register: () => () => {},
    bind: () => t,
  })
  const currentSession = sessionId('current-chat')
  ctx.reflect.provide('sessions', {
    open: sessionOpen,
    list: { getSnapshot: () => ({ current: currentSession }) },
  })
  slots.register({
    name: 'root',
    children: {
      main: { kind: 'keyed', scope: 'root' },
      'sidebar.plugin': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)

  const model = new ClientDesignWorkbenchModel(unusedRemote)
  model.replaceBaseline({ items: [
    view('awaiting', 'awaitingUser'),
    view('active', 'active'),
    view('confirmed', 'confirmed'),
  ] })
  const workbench = new ClientDesignWorkbenchService(ctx, model)
  const fiber = ctx.plugin({
    inject: ['slots', 'layout', 'sessions', 'locale'],
    apply(scope) { registerDesignWorkbenchShell(scope, workbench) },
  })
  await fiber
  return { ctx, fiber, model, selectPanel, sessionOpen, slots, workbench, currentSession }
}

describe('Design Workbench shell registration', () => {
  it('registers keyed main plus sidebar metadata, opens without changing Chat, and disposes cleanly', async () => {
    const b = await bench()
    const main = b.slots.entries('main')
    const plugins = b.slots.entries('sidebar.plugin')
    expect(main).toHaveLength(1)
    expect(main[0]?.options).toMatchObject({ key: DESIGN_WORKBENCH_PANEL_ID })
    expect(plugins).toHaveLength(1)
    expect(plugins[0]?.options).toMatchObject({
      id: 'design-workbench',
      label: 'Design Workbench',
      registration: { icon: 'sparkle', group: 'Create', hasStatus: true },
    })

    const registration = plugins[0]?.options.registration as unknown
    if (registration === null || typeof registration !== 'object') {
      throw new Error('sidebar registration metadata is missing')
    }
    const open = (registration as Record<string, unknown>)['open']
    if (typeof open !== 'function') throw new Error('sidebar registration did not expose open')
    const openCallback = open as () => void
    openCallback()
    expect(b.selectPanel).toHaveBeenCalledExactlyOnceWith(DESIGN_WORKBENCH_PANEL_ID)
    expect(b.sessionOpen).not.toHaveBeenCalled()
    expect(b.currentSession).toBe(sessionId('current-chat'))

    await b.fiber.dispose()
    expect(b.slots.entries('main')).toEqual([])
    expect(b.slots.entries('sidebar.plugin')).toEqual([])
  })

  it('opens only a new Host upsert while the workbench panel is on screen, without replaying history', async () => {
    const b = await bench()
    expect(b.selectPanel).not.toHaveBeenCalled()

    // The full baseline may contain rows linked to this chat, but restoring it
    // does not surprise-navigate away from an already-open conversation.
    b.workbench.replaceBaseline({ items: [view('historical', 'active')] })
    expect(b.selectPanel).not.toHaveBeenCalled()

    // With another panel on screen a fresh row must not steal the view.
    b.workbench.notePanelActive(false)
    const ignored = view('ignored-handoff', 'active')
    b.workbench.upsertView(ignored)
    expect(b.selectPanel).not.toHaveBeenCalled()
    expect(b.workbench.selected.getSnapshot()).not.toBe(ignored.id)

    // With the workbench panel on screen the row merges first, then opens.
    b.workbench.notePanelActive(true)
    const created = view('new-handoff', 'active')
    let rowWasMergedBeforeOpen = false
    b.selectPanel.mockImplementation(() => {
      rowWasMergedBeforeOpen = b.model.getSnapshot().items.some(item => item.id === created.id)
    })
    b.workbench.upsertView(created)
    expect(rowWasMergedBeforeOpen).toBe(true)
    expect(b.selectPanel).toHaveBeenCalledExactlyOnceWith(DESIGN_WORKBENCH_PANEL_ID)
    expect(b.workbench.selected.getSnapshot()).toBe(created.id)
    expect(b.sessionOpen).not.toHaveBeenCalled()

    // Updating the same Host row is not another handoff.
    b.workbench.upsertView({ ...created, revision: 2, title: 'Updated title' })
    expect(b.selectPanel).toHaveBeenCalledTimes(1)
  })

  it('renders only awaitingUser in status and switches the in-page detail selection', async () => {
    const b = await bench()
    render(React.createElement(DesignWorkbenchStatus, {
      workbench: b.workbench,
      wide: false,
      size: 16,
      pinned: true,
      t,
    } as never))
    expect(screen.getByLabelText('1 design task awaiting user').textContent).toBe('1')
    cleanup()

    render(React.createElement(DesignWorkbenchPanel, {
      workbench: b.workbench,
      usePanelInfo: (selector: (info: { activePanelId: string | null }) => unknown) => selector({ activePanelId: null }),
      t,
    } as never))
    expect(screen.getByRole('heading', { name: 'Design Workbench' })).toBeDefined()
    expect(screen.getByText('Task awaiting')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Task active · active' }))
    expect(screen.getByText('Task active')).toBeDefined()
    expect(b.workbench.selected.getSnapshot()).toBe(id('active'))
    expect(b.sessionOpen).not.toHaveBeenCalled()
  })
})
