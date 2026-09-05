/**
 * Three-column shell frame, registered into the built-in 'root' slot (the web
 * shell renders only 'root'). Owns the grid tracks (sidebar | center |
 * details), the drag handles (pointer capture + rAF throttle), the concession
 * chain (columns.ts), and the child-slot render decisions: the sidebar slot
 * renders HERE with live parameters from the concession solve, and the
 * session-aware occupants render in fixed column positions; strict entries
 * gate themselves on current-session availability while session-maybe
 * entries retain identity. Pure component: everything arrives
 * through the three framework shares — zero cordis or framework imports,
 * zero self-made hooks.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import { FishLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  clampWidth, computeColumns, DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN,
  DRAWER_VIEWPORT, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT,
  SIDEBAR_MAX, SIDEBAR_MIN,
} from './columns.ts'
import { DocumentTitle } from './DocumentTitle.tsx'
import type { createLayoutStore } from './stores.ts'
import css from './AppFrame.module.css'

/** Full composed props: runtime share + child-slot render share + store share. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'conversation' | 'details' | 'shell.overlay'>
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & PropsLocale<'common'>

/** Center column grid item (session-body building block). */
function CenterColumn(props: { children?: ReactNode }) {
  return <div className={css.centerCol}>{props.children}</div>
}

/** Details column grid item; width 0 keeps the subtree mounted (never unmount on close). */
function DetailsColumn(props: { children?: ReactNode }) {
  return <div className={css.detailsCol}>{props.children}</div>
}

/**
 * One drag handle: pointer capture, rAF-throttled dx reports against the drag-start origin.
 * `side` keys the hover-reveal CSS to the owning column.
 */
function DragHandle(props: { side: 'sidebar' | 'details'; left: number; onStart: () => void; onDrag: (dx: number) => void; onEnd: () => void }) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd }

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    origin.current = e.clientX
    latest.current = e.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    callbacks.current.onDrag(latest.current - origin.current)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])

  return (
    <div
      className={css.handle}
      style={{ left: props.left }}
      data-side={props.side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )
}

/** The three-column frame (see module doc). */
export function AppFrame({
  useStore,
  useSessions,
  actions,
  renderSlot,
  SessionProvider,
  t,
}: AppFrameProps) {
  const panels = useStore(s => s)
  const detailsSession = useSessions((s) => {
    const current = s.current
    return current !== undefined && s.byId[current]?.blank === false ? current : undefined
  })
  const documentTitle = useSessions((s) => {
    const current = s.current
    return current === undefined ? undefined : s.byId[current]?.title
  })
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState(() => window.innerWidth)

  const lastSession = useRef(detailsSession)
  useLayoutEffect(() => {
    if (detailsSession === undefined) return
    if (lastSession.current !== undefined && lastSession.current !== detailsSession) {
      actions.closeDetails()
    }
    lastSession.current = detailsSession
  }, [actions, detailsSession])

  // Track the frame's own box (not the window): rAF-throttled ResizeObserver.
  useEffect(() => {
    const el = frameRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the frame div renders unconditionally. */
    if (el === null) return
    let raf: number | null = null
    const observer = new ResizeObserver(() => {
      raf ??= requestAnimationFrame(() => {
        raf = null
        const width = el.getBoundingClientRect().width
        if (width > 0) setViewport(width)
      })
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [])

  // Narrow viewports auto-collapse the sidebar; the store mirror keeps
  // toggleSidebar's semantics right (narrow toggles flip the manual
  // re-expand override, stores.ts). Collapsed is decided here, so the
  // solver stays breakpoint-free: a narrow re-expand passes the preference
  // (or the default when the wide preference is closed) and the center
  // absorbs the squeeze.
  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE
  useEffect(() => { actions.setNarrow(narrow) }, [actions, narrow])
  const sidebarCollapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0
  const sidebarPreference = sidebarCollapsed
    ? 0
    : panels.sidebar === 0 ? SIDEBAR_DEFAULT : panels.sidebar

  // Phone-width frames (drawer mode) float the panels over the conversation
  // instead of giving them grid tracks: below DRAWER_VIEWPORT the concession
  // chain cannot help — an expanded sidebar would crush the center column to a
  // ~110px sliver on a 390px phone, and the details panel can never fit its
  // DETAILS_MIN next to CENTER_MIN, leaving it unreachable. In drawer mode the
  // collapsed rail is dropped entirely (a small floating toggle reopens the
  // drawer); an expanded sidebar and an open details panel render as overlay
  // drawers (see the render site below).
  const drawerMode = viewport < DRAWER_VIEWPORT
  const detailsPreference = detailsSession === undefined ? 0 : panels.details
  const detailsDrawerOpen = drawerMode && detailsPreference > 0
  const sidebarDrawerOpen = drawerMode && !sidebarCollapsed
  const cols = drawerMode
    ? { sidebar: 0, center: viewport, details: 0 }
    : computeColumns(viewport, sidebarPreference, detailsSession === undefined ? 0 : panels.details)
  // Drawer widths follow the stored preferences, clamped to leave the rail
  // (sidebar) or a sliver of the conversation (details) visible beside them.
  const sidebarDrawerWidth = Math.min(
    clampWidth(panels.sidebar === 0 ? SIDEBAR_DEFAULT : panels.sidebar, SIDEBAR_MIN, SIDEBAR_MAX),
    Math.max(viewport - SIDEBAR_COLLAPSED - 24, SIDEBAR_MIN),
  )
  const detailsDrawerWidth = Math.min(
    clampWidth(detailsPreference || DETAILS_DEFAULT, DETAILS_MIN, DETAILS_MAX),
    Math.max(viewport - SIDEBAR_COLLAPSED - 24, DETAILS_MIN),
  )
  const colsRef = useRef(cols)
  colsRef.current = cols

  // The drag base is the rendered width captured at drag start (grabbing a
  // concession-clamped panel must not jump back to the stored preference);
  // it stays frozen for the whole gesture so dx deltas do not compound.
  const sidebarBase = useRef(0)
  const detailsBase = useRef(0)
  // Track-level transitions pause for the whole gesture: eased tracks would
  // detach the column edge from the pointer (AppFrame.module.css).
  const [dragging, setDragging] = useState(false)
  const onDragEnd = useCallback(() => { setDragging(false) }, [])
  const onSidebarStart = useCallback(() => { sidebarBase.current = colsRef.current.sidebar; setDragging(true) }, [])
  const onDetailsStart = useCallback(() => { detailsBase.current = colsRef.current.details; setDragging(true) }, [])
  const onSidebarDrag = useCallback((dx: number) => {
    actions.setSidebar(sidebarBase.current + dx)
  }, [actions])
  const onDetailsDrag = useCallback((dx: number) => {
    actions.setDetails(detailsBase.current - dx)
  }, [actions])
  const productTitle = process.env.DSH_CLIENT_TITLE ?? t('brand.localBuild')

  return (
    <div
      ref={frameRef}
      className={css.frame}
      style={{ gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.details}px` }}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-details-collapsed={cols.details === 0 || undefined}
      data-drawer-mode={drawerMode || undefined}
      data-dragging={dragging || undefined}
    >
      <DocumentTitle
        productTitle={productTitle}
        {...documentTitle === undefined ? {} : { title: documentTitle }}
      />
      <div className={css.sidebarCol}>
        {/* Render-site slot call with live concession output: a closed
            sidebar keeps the mounted slot at the compact-rail width, and the
            component sees its rendered state as owner params decided here
            (collapsed follows the resolved rail, so a derived auto-collapse
            renders the rail UI too). Wide mode renders it unconditionally;
            drawer mode renders it only inside the open drawer — the phone
            frame has no permanent rail (the floating toggle reopens the
            drawer). The column element itself stays mounted in every case:
            grid items occupy tracks by DOM order, so dropping it would shift
            the conversation into the zero-width sidebar track. */}
        {!drawerMode && renderSlot('sidebar', {
          collapsed: sidebarCollapsed,
          width: cols.sidebar,
        })}
      </div>
      <>
        {/* Both column occupants stay at fixed tree positions from first
            paint — no loading gate: a bare status line reads worse than
            the shell's own pending rendering. The conversation
            is session-maybe; SessionProvider withholds the strict details
            entry while no session is current. In drawer mode an open panel
            renders in its drawer instead; the subtree stays mounted either
            way. */}
        <CenterColumn>{renderSlot('conversation', {})}</CenterColumn>
        <DetailsColumn>
          <SessionProvider>
            {detailsDrawerOpen ? null : renderSlot('details', {})}
          </SessionProvider>
        </DetailsColumn>
      </>
      <div className={css.overlayLayer} data-shell-overlay>
        {renderSlot('shell.overlay', {})}
      </div>
      {/* Drawer-mode reopen control: with the rail dropped, this small
          floating button is the only entry to the sidebar drawer. It sits
          under the backdrop/drawers so an open panel covers it. The DeepSeek
          fish mark doubles as the menu glyph, matching the hero's brand. */}
      {drawerMode && !sidebarDrawerOpen && (
        <button
          className={css.drawerToggle}
          aria-label="打开侧边栏"
          onClick={() => actions.toggleSidebar()}
        >
          <FishLogo size={20} />
        </button>
      )}
      {/* Drawer-mode panels float over the conversation; the backdrop closes
          them (toggleSidebar flips narrowExpanded below SIDEBAR_AUTO_COLLAPSE,
          which drawer mode always is). Drawers sit under the shell overlay
          layer (fullscreen dialogs) but above every column. */}
      {sidebarDrawerOpen && (
        <>
          <div className={css.drawerBackdrop} onClick={() => actions.toggleSidebar()} />
          <div className={css.drawerLeft} style={{ width: sidebarDrawerWidth }}>
            {renderSlot('sidebar', { collapsed: false, width: sidebarDrawerWidth })}
          </div>
        </>
      )}
      {detailsDrawerOpen && (
        <>
          <div className={css.drawerBackdrop} onClick={() => actions.closeDetails()} />
          <div className={css.drawerRight} style={{ width: detailsDrawerWidth }}>
            <SessionProvider>{renderSlot('details', {})}</SessionProvider>
          </div>
        </>
      )}
      {/* The collapsed rail is fixed-width: no resize handle while closed.
          Drawer mode has no tracks to resize: handles render wide-only. */}
      {!sidebarCollapsed && !drawerMode && <DragHandle side="sidebar" left={cols.sidebar} onStart={onSidebarStart} onDrag={onSidebarDrag} onEnd={onDragEnd} />}
      {cols.details > 0 && !drawerMode && <DragHandle side="details" left={viewport - cols.details} onStart={onDetailsStart} onDrag={onDetailsDrag} onEnd={onDragEnd} />}
    </div>
  )
}
