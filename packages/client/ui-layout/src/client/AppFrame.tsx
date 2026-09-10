/**
 * Three-column shell frame, registered into the built-in 'root' slot (the web
 * shell renders only 'root'). Owns the grid tracks (sidebar | center |
 * rightbar), the drag handles (pointer capture + rAF throttle), the column
 * solve (columns.ts), and the child-slot render decisions: the sidebar slot
 * receives live parameters from that solve. The root-scoped main slot selects
 * the Conversation or a global panel. Each column occupant owns its Session
 * binding and reports the geometry it needs.
 *
 * The right column is a track, not a box: its occupant draws its panel anchored
 * to the frame's right edge at the resolved normal width, and the
 * track only decides whether the centre makes room for it. The occupant reports
 * shown/track/fullscreen through `ctx.layout`; fullscreen keeps the reported
 * track but hides the outer resize handle. Everything arrives through the framework
 * shares — zero cordis or framework imports, zero self-made hooks.
 *
 * Phone-width frames (below DRAWER_VIEWPORT) keep neither track: the collapsed
 * rail is replaced by a floating toggle and each panel renders as an overlay
 * drawer over the conversation instead (columns.ts explains why the concession
 * chain cannot serve that width).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import { FishLogo, isTouchPrimary } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  clampWidth, computeColumns, DRAWER_VIEWPORT, RIGHTBAR_DEFAULT_RATIO,
  SIDEBAR_AUTO_COLLAPSE, SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT, SIDEBAR_MAX,
  SIDEBAR_MIN,
} from './columns.ts'
import { DocumentTitle } from './DocumentTitle.tsx'
import type { createLayoutStore } from './stores.ts'
import css from './AppFrame.module.css'

/** Full composed props: runtime share + child-slot render share + store share. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'main' | 'rightbar' | 'shell.overlay'>
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & PropsLocale<'common'>

/** Center column grid item (session-body building block). */
function CenterColumn(props: { children?: ReactNode }) {
  return <div className={css.centerCol}>{props.children}</div>
}

/** Subscribe to the main key without subscribing the column frame to each panel id. */
function MainPanel({ usePanelInfo, renderSlot }: Pick<PropsRuntime<'root'>, 'usePanelInfo'> & PropsRenderSlots<'main'>) {
  const panelId = usePanelInfo(info => info.activePanelId)
  return renderSlot('main', {}, { entryKey: panelId ?? 'conversation' })
}

/**
 * Right column grid item. Zero-width unless the occupant asked for a track; the
 * occupant's panel is positioned against the column's right edge, which never
 * moves, so it can hang over the centre when there is no track.
 */
function RightbarColumn(props: { children?: ReactNode }) {
  return <div className={css.rightbarCol} data-rightbar-col>{props.children}</div>
}

/**
 * One drag handle: pointer capture, rAF-throttled dx reports against the drag-start origin.
 * `side` keys the hover-reveal CSS to the owning column.
 */
function DragHandle(props: { side: 'sidebar' | 'rightbar'; left: number; onStart: () => void; onDrag: (dx: number) => void; onEnd: () => void }) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const capture = useRef<{ element: HTMLDivElement; id: number } | null>(null)
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd }

  const endDrag = useCallback(() => {
    const active = capture.current
    if (active === null) return
    capture.current = null
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    if (active.element.hasPointerCapture(active.id)) active.element.releasePointerCapture(active.id)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])
  useEffect(() => endDrag, [endDrag])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || capture.current !== null) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    capture.current = { element: e.currentTarget, id: e.pointerId }
    origin.current = e.clientX
    latest.current = e.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (capture.current?.id !== e.pointerId) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (capture.current?.id !== e.pointerId) return
    callbacks.current.onDrag(e.clientX - origin.current)
    endDrag()
  }, [endDrag])
  const onPointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (capture.current?.id === e.pointerId) endDrag()
  }, [endDrag])

  return (
    <div
      className={css.handle}
      style={{ left: props.left }}
      data-side={props.side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
    />
  )
}

/** The three-column frame (see module doc). */
export function AppFrame({
  useStore,
  useSessions,
  usePanelInfo,
  actions,
  renderSlot,
  t,
}: AppFrameProps) {
  const layoutInfo = useStore(state => state.layoutInfo)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const viewport = layoutInfo.viewportWidth

  // Track the frame's own box (not the window): rAF-throttled ResizeObserver.
  useLayoutEffect(() => {
    const el = frameRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the frame div renders unconditionally. */
    if (el === null) return
    let raf: number | null = null
    let disposed = false
    const measure = () => {
      const width = el.getBoundingClientRect().width
      if (width > 0) actions.setViewportWidth(width)
    }
    measure()
    const observer = new ResizeObserver(() => {
      if (disposed) return
      raf ??= requestAnimationFrame(() => {
        raf = null
        measure()
      })
    })
    observer.observe(el)
    return () => {
      disposed = true
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [actions])

  // Touch devices: PIN the frame to the visual viewport. Chrome iOS toggles
  // between avoidance strategies mid-typing — resizing the layout viewport in
  // stages (on-device: 669→512→329→305 for the SAME keyboard), freezing
  // halfway, overlaying, or panning — and every classification/padding
  // scheme (v1–v10) ended up fighting one of those stages. Instead of
  // adapting to the strategy, this removes the strategy's effect: the frame
  // is fixed, sized to vv.height and translated to vv.offsetTop, so the app
  // always occupies EXACTLY the visible band. The composer (docked at the
  // frame's bottom) is then glued just above the keyboard through every
  // stage change; there is no page scroll to fight and no pad to invalidate.
  // Desktop (hover-capable) keeps the static in-flow layout.
  useEffect(() => {
    if (!isTouchPrimary()) return
    const vv = window.visualViewport
    const el = frameRef.current
    if (vv === null || el === null) return
    const apply = (): void => {
      el.style.position = 'fixed'
      el.style.top = '0'
      el.style.left = '0'
      el.style.right = '0'
      el.style.height = `${Math.round(vv.height)}px`
      el.style.transform = `translateY(${Math.round(vv.offsetTop)}px)`
    }
    apply()
    // Events miss some of this engine's stage changes (innerHeight moved
    // with no vv resize on-device), so a cheap interval keeps the pin exact.
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    const tick = window.setInterval(apply, 200)
    return () => {
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
      window.clearInterval(tick)
      el.style.position = ''
      el.style.top = ''
      el.style.left = ''
      el.style.right = ''
      el.style.height = ''
      el.style.transform = ''
    }
  }, [])

  // Narrow viewports auto-collapse the sidebar; the store mirror keeps
  // toggleSidebar's semantics right (narrow toggles flip the manual
  // re-expand override, stores.ts). Collapsed is decided here, so the
  // solver stays breakpoint-free: a narrow re-expand passes the preference
  // (or the default when the wide preference is closed) and the center
  // absorbs the squeeze.
  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE
  const sidebarCollapsed = narrow ? !layoutInfo.narrowExpanded : layoutInfo.sidebar === 0
  const sidebarPreference = sidebarCollapsed
    ? 0
    : layoutInfo.sidebar === 0 ? SIDEBAR_DEFAULT : layoutInfo.sidebar
  const rightbarPreference = layoutInfo.rightbar ?? viewport * RIGHTBAR_DEFAULT_RATIO
  // Opening on a narrow frame collapses the left sidebar. Eligibility must
  // include that space before the occupant's first shown report arrives.
  const normal = computeColumns(viewport, !layoutInfo.rightbarShown && narrow ? 0 : sidebarPreference, rightbarPreference)

  // Phone-width frames (drawer mode) float the panels over the conversation
  // instead of giving them grid tracks: below DRAWER_VIEWPORT the concession
  // chain cannot help — an expanded sidebar would crush the center column to a
  // ~110px sliver on a 390px phone, and the right panel can never fit its
  // RIGHTBAR_MIN next to CENTER_MIN, leaving it unreachable. In drawer mode the
  // collapsed rail is dropped entirely (a small floating toggle reopens the
  // drawer); an expanded sidebar and an open right panel render as overlay
  // drawers (see the render sites below).
  const drawerMode = viewport < DRAWER_VIEWPORT
  const sidebarDrawerOpen = drawerMode && !sidebarCollapsed
  const rightbarDrawerOpen = drawerMode && layoutInfo.rightbarShown
  const cols = drawerMode
    ? { sidebar: 0, center: viewport, rightbar: 0 }
    : computeColumns(viewport, sidebarPreference, layoutInfo.rightbarTrack ? rightbarPreference : 0)
  // Drawer widths follow the stored preferences, clamped to leave a sliver of
  // the conversation visible beside them.
  const sidebarDrawerWidth = Math.min(
    clampWidth(layoutInfo.sidebar === 0 ? SIDEBAR_DEFAULT : layoutInfo.sidebar, SIDEBAR_MIN, SIDEBAR_MAX),
    Math.max(viewport - SIDEBAR_COLLAPSED - 24, SIDEBAR_MIN),
  )
  // The right panel is never docked at drawer widths: ui-sidebar-right derives
  // `autoFullscreen = viewportWidth < 768` (SidebarRight.tsx) and drawer mode
  // starts below DRAWER_VIEWPORT = 700, so every right drawer hosts a panel that
  // is `position: fixed` across the viewport. The drawer must therefore be that
  // same viewport box: the old sliver clamp (274px on a 390px phone) made a host
  // narrower than its own fullscreen child, and the fixed child resolving
  // `inset: 0` against the drawer's transformed entry box clipped its left edge
  // — a document lost its first ~116px (path start, body lines).
  const rightbarDrawerWidth = viewport
  const colsRef = useRef(cols)
  colsRef.current = cols
  const rightbarWidth = useRef(normal.rightbar)
  rightbarWidth.current = normal.rightbar

  // The drag base is the rendered width captured at drag start (grabbing a
  // concession-clamped panel must not jump back to the stored preference);
  // it stays frozen for the whole gesture so dx deltas do not compound.
  const sidebarBase = useRef(0)
  const rightbarBase = useRef(0)
  // Track-level transitions pause for the whole gesture: eased tracks would
  // detach the column edge from the pointer (AppFrame.module.css).
  const [dragging, setDragging] = useState(false)
  const onDragEnd = useCallback(() => { setDragging(false) }, [])
  const onSidebarStart = useCallback(() => { sidebarBase.current = colsRef.current.sidebar; setDragging(true) }, [])
  const onSidebarDrag = useCallback((dx: number) => {
    actions.setSidebar(sidebarBase.current + dx)
  }, [actions])
  const onRightbarStart = useCallback(() => { rightbarBase.current = rightbarWidth.current; setDragging(true) }, [])
  const onRightbarDrag = useCallback((dx: number) => {
    actions.setRightbar(rightbarBase.current - dx)
  }, [actions])
  const productTitle = process.env.DSH_CLIENT_TITLE ?? t('brand.localBuild')
  const sidebar = useMemo(() => renderSlot('sidebar', {
    collapsed: sidebarCollapsed,
    width: cols.sidebar,
  }), [renderSlot, sidebarCollapsed, cols.sidebar])
  const main = useMemo(() => (
    <MainPanel usePanelInfo={usePanelInfo} renderSlot={renderSlot} />
  ), [usePanelInfo, renderSlot])
  const overlays = useMemo(() => renderSlot('shell.overlay', {}), [renderSlot])

  return (
    <div
      ref={frameRef}
      className={css.frame}
      style={{
        gridTemplateColumns:
          `${cols.sidebar}px minmax(0, 1fr) ${cols.rightbar}px`,
      }}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-rightbar-collapsed={cols.rightbar === 0 || undefined}
      data-rightbar-fullscreen={layoutInfo.rightbarFullscreen || undefined}
      data-rightbar-instant={layoutInfo.rightbarInstant || undefined}
      data-drawer-mode={drawerMode || undefined}
      data-dragging={dragging || undefined}
    >
      <DocumentTitle
        productTitle={productTitle}
        useSessions={useSessions}
        usePanelInfo={usePanelInfo}
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
        {drawerMode ? null : sidebar}
      </div>
      <>
        {/* Both column occupants stay at fixed tree positions from first
            paint — no loading gate: a bare status line reads worse than
            the shell's own pending rendering. The conversation
            is session-maybe; the right occupant withholds its own strict
            content while no session is current. In drawer mode an open panel
            renders in its drawer instead; the subtree stays mounted either
            way. */}
        <CenterColumn>{main}</CenterColumn>
        <RightbarColumn>
          {rightbarDrawerOpen
            ? null
            : renderSlot('rightbar', { width: normal.rightbar, viewportWidth: viewport, canShow: normal.rightbar > 0 })}
        </RightbarColumn>
      </>
      <div className={css.overlayLayer} data-shell-overlay>
        {overlays}
      </div>
      {/* Drawer-mode reopen control: with the rail dropped, this small
          floating button is the only entry to the sidebar drawer. It sits
          under the backdrop/drawers so an open panel covers it. The DeepSeek
          fish mark doubles as the menu glyph, matching the hero's brand. */}
      {drawerMode && !sidebarDrawerOpen && (
        <button
          className={css.drawerToggle}
          aria-label={t('sidebar.open')}
          onClick={() => { actions.toggleSidebar() }}
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
          <div className={css.drawerBackdrop} onClick={() => { actions.toggleSidebar() }} />
          <div className={css.drawerLeft} style={{ width: sidebarDrawerWidth }}>
            {renderSlot('sidebar', { collapsed: false, width: sidebarDrawerWidth })}
          </div>
        </>
      )}
      {rightbarDrawerOpen && (
        <>
          <div className={css.drawerBackdrop} onClick={() => { actions.closeRightbar() }} />
          <div className={css.drawerRight} style={{ width: rightbarDrawerWidth }}>
            {renderSlot('rightbar', { width: rightbarDrawerWidth, viewportWidth: viewport, canShow: true })}
          </div>
        </>
      )}
      {/* The collapsed rail is fixed-width: no resize handle while closed.
          Drawer mode has no tracks to resize: handles render wide-only. */}
      {!sidebarCollapsed && !drawerMode && <DragHandle side="sidebar" left={cols.sidebar} onStart={onSidebarStart} onDrag={onSidebarDrag} onEnd={onDragEnd} />}
      {layoutInfo.rightbarShown && !layoutInfo.rightbarFullscreen && normal.rightbar > 0 && !drawerMode && (
        <DragHandle side="rightbar" left={viewport - normal.rightbar} onStart={onRightbarStart} onDrag={onRightbarDrag} onEnd={onDragEnd} />
      )}
    </div>
  )
}
