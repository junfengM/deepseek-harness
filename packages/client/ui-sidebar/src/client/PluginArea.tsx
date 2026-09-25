/**
 * Sidebar plugin area: pinned entries, the constant total entry, and the
 * overflow menu it opens.
 *
 * The shell owns everything visual here — button geometry, glyph choice, the
 * count badge, menu layout, overflow rule — because the failure this replaces
 * was every plugin drawing its own button. A registration therefore
 * contributes metadata only (icon NAME, group, activation callback), plus an
 * optional status glyph rendered through its own slot entry, which is what
 * keeps a live count reactive without the shell subscribing on the plugin's
 * behalf.
 *
 * Sizing follows the approved order and skips no step: the total entry's
 * width is resolved BEFORE pins are measured, and the probe renders the
 * widest badge the entry can ever carry, so a count appearing later cannot
 * invalidate the fit. A wide column that cannot hold two pins holds none.
 *
 * The overflow card is a shell-owned popover rather than ui-primitives' Menu:
 * Menu has no trailing row action and no Tab loop, and pinning needs a real,
 * focusable control next to the row's activate target (the design稿 drew that
 * control as a span nested inside a button, which is invalid HTML and
 * keyboard-unreachable).
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import {
  IconCheckOutlineRegular, IconCodeOutlineRegular, IconCordisPluginOutlineRegular, IconDataOutlineRegular,
  IconDatabaseOutlineRegular, IconEllipsisOutlineRegular, IconGaugeOutlineRegular, IconGoalOutlineRegular,
  IconSearchOutlineRegular, IconSkillOutlineRegular, IconSparkleRegular, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { PLUGIN_PIN_LIMIT } from './plugin-entries.ts'
import type { SidebarPluginIcon, SidebarPluginMetadata } from './contract/slots.ts'
import css from './PluginArea.module.css'

/** Gap between the area's controls in the expanded row. */
const ROW_GAP = 4
/** Column padding on both sides (SidebarRoot.module.css: 12px each). */
const COLUMN_INSET = 24
/** A wide column that fits only one pin shows none: a lone pin reads as the wrong pin. */
const MIN_VISIBLE_PINS = 2
/** Menu width floor used before the card is measured. */
const MENU_WIDTH = 268
/** Margin the card keeps from the viewport edges. */
const MENU_MARGIN = 12
/**
 * Nominal control widths, used only where no layout engine reports widths
 * (jsdom). Separator is its 1px border box plus 2px horizontal margins, so
 * its nominal outer width is 5px. They match PluginArea.module.css so the
 * branch under test is the same one production takes.
 */
const NOMINAL = { pin: 30, all: 88, separator: 5 }

function statusDescriptionId(slot: 'pin' | 'menu', index: string): string {
  return `dsh-sidebar-plugin-status-${slot}-${index}`
}

/** Shell-owned 16px line glyph, built like the shipped icon set. */
function ShellGlyph({ size = 16, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16" width={size} height={size} className={className}
      fill="none" stroke="currentColor" strokeWidth={1.4}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/**
 * Shell-owned glyph per plugin icon NAME. A registrant never supplies markup,
 * which is what keeps the rail in one visual language; names without a
 * faithful shipped glyph use a shell glyph from the approved design.
 */
const PLUGIN_ICONS: Record<SidebarPluginIcon, ComponentType<IconProps>> = {
  plugin: IconCordisPluginOutlineRegular,
  radar: props => (
    <ShellGlyph {...props}>
      <circle cx="8" cy="8" r="5.6" /><circle cx="8" cy="8" r="2.2" /><path d="M8 8l4-4" />
    </ShellGlyph>
  ),
  image: props => (
    <ShellGlyph {...props}>
      <rect x="2" y="2.6" width="12" height="10.8" rx="2" />
      <circle cx="5.8" cy="6.2" r="1.1" />
      <path d="M2.6 11.4l3.2-2.8 2.4 2 2-1.6 3.2 2.6" />
    </ShellGlyph>
  ),
  database: IconDatabaseOutlineRegular,
  sparkle: IconSparkleRegular,
  code: IconCodeOutlineRegular,
  data: IconDataOutlineRegular,
  gauge: IconGaugeOutlineRegular,
  goal: IconGoalOutlineRegular,
  skill: IconSkillOutlineRegular,
  search: IconSearchOutlineRegular,
}

/** Loaded config passed by the shell; every value is owned by SidebarRoot. */
export interface PluginAreaProps {
  /** Sidebar column width in pixels (the layout owner's value). */
  width: number
  /** Whether the column renders wide content (false = 56px rail). */
  wide: boolean
  /** Live plugin registrations, ascending by order. */
  plugins: readonly SidebarPluginMetadata[]
  /** User pin list; may name plugins that have not registered yet. */
  pinned: readonly string[]
  /** Pin or unpin one entry. */
  onTogglePin: (id: string) => void
  /** Render one entry's status glyph through its own slot registration. */
  renderStatus: (id: string, pinned: boolean) => ReactNode
  /** Optional settings-owned management action rendered in the menu footer. */
  renderManage?: () => ReactNode
  /** Sidebar-namespace translate. */
  t: TranslateNS<'sidebar'>
}

/**
 * Render the plugin area.
 * @param props - registry state, pin state, and the status renderer.
 * @returns the area, including a permanent total entry and its empty state.
 */
export function PluginArea({
  width, wide, plugins, pinned, onTogglePin, renderStatus, renderManage, t,
}: PluginAreaProps) {
  const [open, setOpen] = useState(false)
  const [fits, setFits] = useState(PLUGIN_PIN_LIMIT)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const probeRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const allRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const pinnedPlugins = plugins.filter(plugin => pinned.includes(plugin.id))
  const visiblePins = pinnedPlugins.slice(0, Math.min(fits, PLUGIN_PIN_LIMIT))
  const overflowCount = plugins.length - visiblePins.length
  // The total entry and its empty menu are permanent shell chrome. Keeping the
  // area mounted also lets normal React effect cleanup handle plugin unloads.
  const menuActive = open

  // Fit pass. In the rail the area stacks, so width never limits it and all
  // pins fit; in the expanded row the total entry is charged first, badge
  // included.
  useLayoutEffect(() => {
    if (!wide) {
      setFits(PLUGIN_PIN_LIMIT)
      return
    }
    const probe = probeRef.current
    if (probe === null) return
    const widthOf = (element: Element | null, nominal: number): number => {
      const measured = element?.getBoundingClientRect().width ?? 0
      return measured > 0 ? measured : nominal
    }
    const outerWidthOf = (element: Element | null, nominal: number): number => {
      const measured = element?.getBoundingClientRect().width ?? 0
      if (measured <= 0 || element === null) return nominal
      const style = window.getComputedStyle(element)
      const left = Number.parseFloat(style.marginLeft)
      const right = Number.parseFloat(style.marginRight)
      return Number.isFinite(left) && Number.isFinite(right) ? measured + left + right : nominal
    }
    const separator = outerWidthOf(probe.querySelector('[data-probe="separator"]'), NOMINAL.separator)
    const available = Math.max(0, width - COLUMN_INSET)
    let used = widthOf(probe.querySelector('[data-probe="all"]'), NOMINAL.all)
    let count = 0
    for (const pin of probe.querySelectorAll('[data-probe="pin"]')) {
      const step = widthOf(pin, NOMINAL.pin) + ROW_GAP + (count === 0 ? separator + ROW_GAP : 0)
      if (used + step > available) break
      used += step
      count += 1
    }
    // A single pinned plugin is still a valid direct entry; only collapse the
    // row when there are at least two candidates and fewer than two fit.
    setFits(count < MIN_VISIBLE_PINS && pinnedPlugins.length >= MIN_VISIBLE_PINS ? 0 : count)
  }, [wide, width, plugins, pinned, t])

  // Placement. Expanded cards open above the total entry and align to the
  // sidebar column edge; the collapsed rail opens to the rail's right.
  // Both arrangements are clamped to the viewport as a second guard.
  useLayoutEffect(() => {
    if (!menuActive) {
      setPosition(null)
      return
    }
    const place = (): void => {
      const anchor = allRef.current
      const menu = menuRef.current
      if (anchor === null || menu === null) return
      const rect = anchor.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const measuredCardWidth = menu.offsetWidth > 0 ? menu.offsetWidth : MENU_WIDTH
      const cardWidth = Math.min(measuredCardWidth, Math.max(0, viewportWidth - MENU_MARGIN * 2))
      const cardHeight = menu.offsetHeight
      let left: number
      let top: number
      if (!wide) {
        // In the 56px rail the menu opens to the right, like the specimen;
        // clamping is only to the viewport because the rail itself is the
        // anchor and the menu is deliberately allowed outside it.
        left = Math.min(rect.right + 8, viewportWidth - MENU_MARGIN - cardWidth)
        left = Math.max(MENU_MARGIN, left)
        top = Math.min(
          Math.max(MENU_MARGIN, rect.bottom - cardHeight),
          viewportHeight - MENU_MARGIN - cardHeight,
        )
      } else {
        // Expanded narrow sidebars (260/280/300px) keep the card's right
        // edge at the sidebar column edge. The total control only occupies its
        // own tail width, not the full row; find the owning column and retain
        // the row/anchor fallbacks for standalone hosts and tests.
        const row = anchor.closest<HTMLElement>('[role="group"]')
        const rowEdge = row?.getBoundingClientRect()
        const columnEdge = row?.parentElement?.parentElement?.getBoundingClientRect()
        const edge = columnEdge !== undefined && columnEdge.width > 0 ? columnEdge : rowEdge
        const right = Math.min(
          edge !== undefined && edge.width > 0 ? edge.right : rect.right,
          viewportWidth - MENU_MARGIN,
        )
        const maxLeft = viewportWidth - MENU_MARGIN - cardWidth
        const minLeft = MENU_MARGIN - cardWidth
        left = Math.max(minLeft, Math.min(right - cardWidth, maxLeft))
        top = rect.top - cardHeight - 6
        if (top < MENU_MARGIN) top = rect.bottom + 6
        if (top + cardHeight > viewportHeight - MENU_MARGIN) {
          top = Math.max(MENU_MARGIN, viewportHeight - MENU_MARGIN - cardHeight)
        }
      }
      setPosition({ left, top })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [menuActive, open, plugins, pinned, fits, t, wide, width])

  const closeMenu = useCallback((restoreFocus: boolean): void => {
    setOpen(false)
    if (restoreFocus) allRef.current?.focus()
  }, [])

  // Dismissal and keyboard: outside pointer, Escape, and a Tab loop that
  // keeps focus inside the card while it is open.
  useEffect(() => {
    if (!menuActive) return
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (anchorRef.current?.contains(target) === true) return
      if (menuRef.current?.contains(target) === true) return
      closeMenu(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMenu(true)
        return
      }
      if (event.key !== 'Tab') return
      const card = menuRef.current
      if (card === null) return
      const focusables = Array.from(card.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (first === undefined || last === undefined) return
      const active = document.activeElement
      const inside = active instanceof Node && card.contains(active)
      if (event.shiftKey && (active === first || !inside)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !inside)) {
        event.preventDefault()
        first.focus()
      }
    }
    // A pointerdown inside a cross-origin iframe never reaches this document;
    // the focus move it causes blurs the window instead.
    const onWindowBlur = (): void => {
      if (document.activeElement instanceof HTMLIFrameElement) closeMenu(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [menuActive, closeMenu])

  // The total entry is permanent shell chrome, even before the first plugin
  // registers; opening it then gives the user the explicit empty state.

  const glyph = (icon: SidebarPluginIcon, size: number): ReactNode => {
    const Glyph = Object.hasOwn(PLUGIN_ICONS, icon) ? PLUGIN_ICONS[icon] : PLUGIN_ICONS.plugin
    return <Glyph size={size} />
  }

  const activate = (plugin: SidebarPluginMetadata): void => {
    closeMenu(false)
    if (typeof plugin.open === 'function') plugin.open()
  }

  const byGroup = new Map<string, SidebarPluginMetadata[]>()
  for (const plugin of plugins) {
    const bucket = byGroup.get(plugin.group)
    if (bucket === undefined) byGroup.set(plugin.group, [plugin])
    else bucket.push(plugin)
  }
  const groups = [...byGroup.entries()]
    .map(([key, items]) => ({ key, label: key === '' ? t('plugins.ungrouped') : key, items }))
    .sort((left, right) => (left.key === '' ? 1 : 0) - (right.key === '' ? 1 : 0))
  const allLabel = t('plugins.all')
  const allAriaLabel = overflowCount > 0
    ? t('plugins.allWithOverflow', { count: overflowCount })
    : allLabel

  return (
    <div
      className={clsx(css.area, !wide && css.areaRail)}
      role="group"
      aria-label={t('plugins.label')}
    >
      {visiblePins.map((plugin, index) => {
        const descriptionId = plugin.hasStatus ? statusDescriptionId('pin', String(index)) : undefined
        return (
          <Tooltip key={plugin.id} label={plugin.label} delayMs={500}>
            <div className={clsx(css.pinWrap, !wide && css.pinWrapRail)}>
              <button
                type="button"
                className={clsx(css.pinButton, !wide && css.pinButtonRail)}
                aria-label={plugin.label}
                aria-describedby={descriptionId}
                onClick={() => { activate(plugin) }}
              >
                <span className={css.pinGlyph} aria-hidden="true">{glyph(plugin.icon, wide ? 16 : 18)}</span>
              </button>
              {plugin.hasStatus && <div id={descriptionId} className={css.status}>{renderStatus(plugin.id, true)}</div>}
            </div>
          </Tooltip>
        )
      })}

      {visiblePins.length > 0 && (
        <span className={clsx(css.separator, !wide && css.separatorRail)} aria-hidden="true" />
      )}

      <div className={css.allWrap} ref={anchorRef}>
        <Tooltip label={allLabel} delayMs={500} disabled={wide}>
          <button
            ref={allRef}
            type="button"
            className={clsx(css.allButton, !wide && css.allButtonRail, open && css.allButtonOpen)}
            aria-label={allAriaLabel}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => { setOpen(value => !value) }}
          >
            {wide
              ? <span className={css.allLabel}>{allLabel}</span>
              : <span className={css.pinGlyph} aria-hidden="true"><IconEllipsisOutlineRegular size={18} /></span>}
            {wide && (
              <span
                className={clsx(css.badge, overflowCount === 0 && css.badgePlaceholder)}
                aria-hidden={overflowCount === 0}
              >
                {overflowCount}
              </span>
            )}
          </button>
        </Tooltip>
      </div>

      {open && createPortal(
        <div
          ref={menuRef}
          className={css.menu}
          role="dialog"
          aria-label={allLabel}
          style={position === null
            ? { visibility: 'hidden', left: 0, top: 0 }
            : { left: position.left, top: position.top }}
        >
          <div className={css.menuHead}>
            <span className={css.menuHeadTitle}>{allLabel}</span>
            <span>{t('plugins.menuSummary', { registered: plugins.length, pinned: pinnedPlugins.length })}</span>
          </div>
          <div className={css.menuBody}>
            {groups.length === 0 && <div className={css.menuEmpty}>{t('plugins.empty')}</div>}
            {groups.map((group, groupIndex) => (
              <Fragment key={group.key}>
                <div className={css.menuGroup}>
                  <span>{group.label}</span>
                  <span>{group.items.length}</span>
                </div>
                {group.items.map((plugin, pluginIndex) => {
                  const isPinned = pinned.includes(plugin.id)
                  const descriptionId = plugin.hasStatus
                    ? statusDescriptionId('menu', `${groupIndex}-${pluginIndex}`)
                    : undefined
                  return (
                    <div key={plugin.id} className={css.menuRow}>
                      <div className={css.menuOpenWrap}>
                        <button
                          type="button"
                          className={css.menuOpen}
                          aria-label={plugin.label}
                          aria-describedby={descriptionId}
                          onClick={() => { activate(plugin) }}
                        >
                          <span className={css.menuCheck} aria-hidden="true">
                            {isPinned ? <IconCheckOutlineRegular size={14} /> : null}
                          </span>
                          <span className={css.menuIcon} aria-hidden="true">{glyph(plugin.icon, 16)}</span>
                          <span className={css.menuName}>{plugin.label}</span>
                        </button>
                        {plugin.hasStatus && <div id={descriptionId} className={css.menuStatus}>{renderStatus(plugin.id, isPinned)}</div>}
                      </div>
                      <button
                        type="button"
                        className={clsx(css.menuPin, isPinned && css.menuPinOn)}
                        aria-pressed={isPinned}
                        aria-label={isPinned ? t('plugins.unpin') : t('plugins.pin')}
                        onClick={() => { onTogglePin(plugin.id) }}
                      >
                        <ShellGlyph size={14}>
                          <path d="M6.2 2.4h3.6l-.6 3.6 2 2v1.2H4.8V8l2-2z" />
                          <path d="M8 9.2v4" />
                        </ShellGlyph>
                      </button>
                    </div>
                  )
                })}
              </Fragment>
            ))}
          </div>
          <div className={css.menuFoot}>
            {renderManage !== undefined && <div className={css.menuManage}>{renderManage()}</div>}
            <small>{t('plugins.pinHint')}</small>
          </div>
        </div>,
        document.body,
      )}

      {/* Measuring clones: same classes, never interactive, and the badge
          carries the widest count the entry can ever show so the reserve is
          stable across fit changes. */}
      <div className={css.probe} aria-hidden="true" ref={probeRef}>
        {pinnedPlugins.map(plugin => (
          <span key={plugin.id} className={css.pinButton} data-probe="pin">
            <span className={css.pinGlyph}>{glyph(plugin.icon, 16)}</span>
            {plugin.hasStatus && <span className={css.status}>00</span>}
          </span>
        ))}
        <span className={css.separator} data-probe="separator" />
        <span className={css.allButton} data-probe="all">
          <span className={css.allLabel}>{t('plugins.all')}</span>
          <span className={css.badge}>{Math.max(plugins.length, 99)}</span>
        </span>
      </div>
    </div>
  )
}
