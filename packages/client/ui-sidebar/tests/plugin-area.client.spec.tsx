// @vitest-environment jsdom
/**
 * Plugin area: the fit rule, the rail geometry, the overflow card's keyboard
 * contract, and the pin-list defensive reads.
 *
 * Every fixture uses the nominal widths the component falls back to when the
 * layout engine reports none, so a fit assertion here is the same branch
 * production takes and not a mock of it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { PluginArea } from '../src/client/PluginArea.tsx'
import type { PluginAreaProps } from '../src/client/PluginArea.tsx'
import {
  DEFAULT_PLUGIN_PINS, createPluginPinStore, normalizePins, pluginMetadataOf, samePlugins,
} from '../src/client/plugin-entries.ts'
import { en } from '../src/client/locales.ts'
import type { SidebarPluginIcon, SidebarPluginMetadata, SidebarRootComponentProps } from '../src/client/contract/slots.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

const dictionary = en as Record<string, string>

// English-dictionary translate stub, matching the existing sidebar fixture:
// copy values resolve, and the small interpolation surface used by the menu
// summary / accessible overflow label stays exercised in tests.
const t: SidebarRootComponentProps['t'] = (key, params) => {
  const value = dictionary[key] ?? key
  return value.replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match))
}

const open = vi.fn()

function plugin(
  id: string, order: number, label: string, group: string,
  icon: SidebarPluginIcon = 'database', hasStatus = false,
): SidebarPluginMetadata {
  return { id, order, label, icon, group, hasStatus, open }
}

// radar and image exercise the shell-owned glyph branches; database rides a
// shipped icon, so a fixture change cannot silently drop one of the three.
const THREE: readonly SidebarPluginMetadata[] = [
  plugin('trend-radar', 10, 'Trend Radar', 'Content', 'radar', true),
  plugin('sql-library', 20, 'SQL Library', 'Content', 'database'),
  plugin('ai-image-gen', 30, 'Image Gen', 'Media', 'image'),
]

function mount(overrides: Partial<PluginAreaProps> = {}) {
  const onTogglePin = vi.fn()
  // Object.assign rather than an object spread: under exactOptionalPropertyTypes
  // a spread of Partial<T> widens every overridable prop to T | undefined.
  const props = Object.assign({
    width: 300,
    wide: true,
    plugins: THREE,
    pinned: [...DEFAULT_PLUGIN_PINS],
    onTogglePin,
    renderStatus: (): ReactNode => null,
    t,
  } satisfies PluginAreaProps, overrides)
  return { ...render(<PluginArea {...props} />), onTogglePin }
}

describe('PluginArea — fit rule', () => {
  it('keeps the total entry and exposes an empty state before registration', () => {
    render(
      <PluginArea width={300} wide plugins={[]} pinned={[]} onTogglePin={() => {}} renderStatus={() => null} t={t} />
    )
    const all = screen.getByRole('button', { name: 'All plugins' })
    expect(all).toBeTruthy()
    fireEvent.click(all)
    expect(screen.getByRole('dialog', { name: 'All plugins' })).toBeTruthy()
    expect(screen.getByText('No plugins are registered yet.')).toBeTruthy()
  })

  it('shows every pin when the expanded row has room, with a hidden overflow seat', () => {
    mount()
    for (const label of ['Trend Radar', 'SQL Library', 'Image Gen']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
    const all = screen.getByRole('button', { name: 'All plugins' })
    expect(all.textContent).toBe('All plugins0')
    expect(all.querySelector('[aria-hidden="true"]')).toBeTruthy()
  })

  it('keeps one total control when registrations grow from three to ten', () => {
    const ten = Array.from({ length: 10 }, (_, index) =>
      plugin(`plugin-${index}`, index, `Plugin ${index}`, 'Content'))
    const view = mount({ plugins: ten, pinned: ten.map(item => item.id) })
    const group = screen.getByRole('group', { name: 'Plugins' })
    expect(group.querySelectorAll('button')).toHaveLength(4)
    expect(screen.getByRole('button', { name: 'All plugins, 7 more in menu' })).toBeTruthy()
    view.rerender(
      <PluginArea width={300} wide plugins={THREE} pinned={[...DEFAULT_PLUGIN_PINS]} onTogglePin={view.onTogglePin} renderStatus={() => null} t={t} />
    )
    expect(group.querySelectorAll('button')).toHaveLength(4)
    expect(screen.getByRole('button', { name: 'All plugins' })).toBeTruthy()
  })

  it('charges the total entry first and hides the pins it cannot fit', () => {
    mount({ width: 120 })
    expect(screen.queryByRole('button', { name: 'Trend Radar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'SQL Library' })).toBeNull()
    // 3 registered, 0 shown outside: the count badge carries the rest.
    const all = screen.getByRole('button', { name: 'All plugins, 3 more in menu' })
    expect(all.textContent).toBe('All plugins3')
    expect(all.getAttribute('aria-label')).toBe('All plugins, 3 more in menu')
  })

  it('shows none when only one pin would fit', () => {
    mount({ width: 160 })
    expect(screen.queryByRole('button', { name: 'Trend Radar' })).toBeNull()
    expect(screen.getByRole('button', { name: 'All plugins, 3 more in menu' }).textContent).toBe('All plugins3')
  })

  it('keeps the only pinned plugin direct when it is the sole candidate', () => {
    mount({ plugins: [THREE[0]!], pinned: ['trend-radar'], width: 160 })
    expect(screen.getByRole('button', { name: 'Trend Radar' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'All plugins' })).toBeTruthy()
  })

  it('counts separator margins when a measured row is near the fit boundary', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const probe = this.getAttribute('data-probe')
      const width = probe === 'all' ? 100 : probe === 'pin' ? 30 : probe === 'separator' ? 1 : 0
      return { width, height: 0, top: 0, right: width, bottom: 0, left: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
    })
    vi.spyOn(window, 'getComputedStyle').mockImplementation(element => ({
      marginLeft: element.getAttribute('data-probe') === 'separator' ? '2px' : '0px',
      getPropertyValue: (property: string) => property === 'margin-left' ? '2px' : property === 'margin-right' ? '2px' : '',
      marginRight: element.getAttribute('data-probe') === 'separator' ? '2px' : '0px',
    }) as CSSStyleDeclaration)
    mount({ width: 200 }) // available 176; two pins cost 177 with the separator's 4px margins, so the minimum-two rule hides both
    expect(screen.queryByRole('button', { name: 'Trend Radar' })).toBeNull()
  })

  it('drops the count badge in the rail and stacks the pins', () => {
    mount({ wide: false, width: 56 })
    expect(screen.getAllByRole('button', { name: /Trend Radar|SQL Library|Image Gen/ })).toHaveLength(3)
    const all = screen.getByRole('button', { name: 'All plugins' })
    expect(all.textContent).toBe('')
  })
})

describe('PluginArea — overflow card', () => {
  it('groups entries, marks pinned ones, and toggles a pin without opening', () => {
    const { onTogglePin } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'All plugins' }))
    const dialog = screen.getByRole('dialog', { name: 'All plugins' })
    expect(within(dialog).getByText('Content')).toBeTruthy()
    expect(within(dialog).getByText('Media')).toBeTruthy()
    expect(within(dialog).getAllByRole('button', { name: 'Unpin' })).toHaveLength(3)
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Unpin' })[0]!)
    expect(onTogglePin).toHaveBeenCalledTimes(1)
    expect(onTogglePin).toHaveBeenCalledWith('trend-radar')
    expect(open).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('renders status glyphs for unpinned entries in the overflow menu', () => {
    const renderStatus = vi.fn((id: string, isPinned: boolean) => (
      <span>{id}:{String(isPinned)}</span>
    ))
    mount({ pinned: [], renderStatus })
    fireEvent.click(screen.getByRole('button', { name: /^All plugins/ }))
    const statusText = screen.getByText('trend-radar:false')
    expect(statusText).toBeTruthy()
    const rowButton = within(screen.getByRole('dialog')).getByRole('button', { name: 'Trend Radar' })
    const descriptionId = rowButton.getAttribute('aria-describedby')
    expect(descriptionId).toBeTruthy()
    expect(document.getElementById(descriptionId!)?.textContent).toContain('trend-radar:false')
    expect(renderStatus).toHaveBeenCalledWith('trend-radar', false)
  })

  it('associates a pinned status glyph with its button description', () => {
    mount({ renderStatus: () => <span>32</span> })
    const button = screen.getByRole('button', { name: 'Trend Radar' })
    const descriptionId = button.getAttribute('aria-describedby')
    expect(descriptionId).toBeTruthy()
    expect(document.getElementById(descriptionId!)?.textContent).toBe('32')
  })

  it('keeps SlotOutlet-like status containers outside both activation buttons', () => {
    mount({ renderStatus: () => <div data-slot="sidebar.plugin">32</div> })
    const pinnedButton = screen.getByRole('button', { name: 'Trend Radar' })
    expect(pinnedButton.querySelector('[data-slot]')).toBeNull()
    expect(pinnedButton.parentElement?.querySelector('[data-slot]')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'All plugins' }))
    const rowButton = within(screen.getByRole('dialog')).getByRole('button', { name: 'Trend Radar' })
    expect(rowButton.querySelector('[data-slot]')).toBeNull()
    expect(rowButton.parentElement?.querySelector('[data-slot]')).not.toBeNull()
  })

  it('opens a plugin, closes the card, and keeps the entry that was clicked', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'All plugins' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Trend Radar' }))
    expect(open).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on Escape and returns focus to the total entry', () => {
    mount()
    const all = screen.getByRole('button', { name: 'All plugins' })
    fireEvent.click(all)
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(all)
  })

  it('wraps Tab at both ends of the card', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'All plugins' }))
    const dialog = screen.getByRole('dialog')
    const focusables = within(dialog).getAllByRole('button')
    const first = focusables[0]!
    const last = focusables[focusables.length - 1]!
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('closes on a pointer press outside the entry and the card', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'All plugins' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes when focus moves into an iframe and the window blurs', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'All plugins' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    const iframe = document.createElement('iframe')
    document.body.append(iframe)
    iframe.focus()
    fireEvent(window, new Event('blur'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps the expanded narrow menu right-aligned to the sidebar edge', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('aria-label')?.startsWith('All plugins')) {
        return { width: 260, height: 30, top: 100, right: 260, bottom: 130, left: 0, x: 0, y: 100, toJSON: () => ({}) } as DOMRect
      }
      return { width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
    })
    mount({ width: 260 })
    fireEvent.click(screen.getByRole('button', { name: 'All plugins' }))
    expect(screen.getByRole('dialog').getAttribute('style')).toContain('left: -8px')
  })

  it('opens the collapsed rail menu to the right of the rail', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('aria-label')?.startsWith('All plugins')) {
        return { width: 36, height: 36, top: 100, right: 56, bottom: 136, left: 20, x: 20, y: 100, toJSON: () => ({}) } as DOMRect
      }
      return { width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
    })
    mount({ wide: false, width: 56 })
    fireEvent.click(screen.getByRole('button', { name: 'All plugins' }))
    expect(screen.getByRole('dialog').getAttribute('style')).toContain('left: 64px')
  })

  it('uses the expanded row edge, not the total control, for menu placement', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('role') === 'group') {
        return { width: 256, height: 30, top: 100, right: 268, bottom: 130, left: 12, x: 12, y: 100, toJSON: () => ({}) } as DOMRect
      }
      return { width: 0, height: 0, top: 100, right: 0, bottom: 130, left: 0, x: 0, y: 100, toJSON: () => ({}) } as DOMRect
    })
    mount({ width: 280 })
    fireEvent.click(screen.getByRole('button', { name: 'All plugins' }))
    // The 268px card ends at the 268px content edge, rather than opening at
    // a negative x coordinate because the total control is only the tail.
    expect(screen.getByRole('dialog').getAttribute('style')).toContain('left: 0px')
  })

  it('prefers the sidebar column edge when the plugin row is inset', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('data-sidebar-root') === 'true') {
        return { width: 280, height: 873, top: 0, right: 280, bottom: 873, left: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
      }
      if (this.getAttribute('role') === 'group') {
        return { width: 256, height: 30, top: 100, right: 268, bottom: 130, left: 12, x: 12, y: 100, toJSON: () => ({}) } as DOMRect
      }
      return { width: 0, height: 0, top: 100, right: 0, bottom: 130, left: 0, x: 0, y: 100, toJSON: () => ({}) } as DOMRect
    })
    render(
      <div data-sidebar-root="true">
        <div>
          <PluginArea width={280} wide plugins={THREE} pinned={[...DEFAULT_PLUGIN_PINS]} onTogglePin={() => {}} renderStatus={() => null} t={t} />
        </div>
      </div>
    )
    fireEvent.click(screen.getByRole('button', { name: 'All plugins' }))
    expect(screen.getByRole('dialog').getAttribute('style')).toContain('left: 12px')
  })

  it('keeps a reachable empty state when the last plugin unloads', () => {
    const view = mount()
    fireEvent.click(screen.getByRole('button', { name: 'All plugins' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    view.rerender(
      <PluginArea width={300} wide plugins={[]} pinned={[]} onTogglePin={view.onTogglePin} renderStatus={() => null} t={t} />
    )
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('No plugins are registered yet.')).toBeTruthy()
  })
})

describe('plugin-entries', () => {
  it('keeps well-formed unknown pins and drops malformed input', () => {
    expect(normalizePins(['radar', 'radar', 7, null, '', 'x'.repeat(81), 'later-plugin']))
      .toEqual(['radar', 'x'.repeat(81), 'later-plugin'])
    expect(normalizePins({ pinned: ['radar'] })).toEqual(DEFAULT_PLUGIN_PINS)
  })

  it('normalizes whatever rehydrated instead of trusting it', () => {
    localStorage.setItem('dsh.sidebar.plugins.pinned', JSON.stringify({ pinned: 'nope' }))
    const store = createPluginPinStore()
    expect(store.getSnapshot()).toEqual(DEFAULT_PLUGIN_PINS)
  })

  it('projects registry metadata and compares it by value', () => {
    const entry = {
      component: null,
      options: { id: 'trend-radar', order: 10, label: 'Trend Radar', registration: { icon: 'radar', group: 'Content', open } },
    }
    const metadata = pluginMetadataOf(entry)
    expect(metadata).toMatchObject({ id: 'trend-radar', order: 10, label: 'Trend Radar', icon: 'radar', group: 'Content' })
    expect(samePlugins([metadata!], [metadata!])).toBe(true)
    expect(samePlugins([metadata!], [{ ...metadata!, open: vi.fn() }])).toBe(false)
  })

  it('sanitizes dynamic registration values before shell projection', () => {
    const metadata = pluginMetadataOf({
      component: null,
      options: {
        id: 'dynamic-plugin', order: Number.NaN, label: 17,
        registration: { icon: 'unknown', group: 17, hasStatus: 'yes', open: 'not callable' },
      },
    } as never)
    expect(metadata).toMatchObject({
      id: 'dynamic-plugin', order: 0, label: 'dynamic-plugin', icon: 'plugin', group: '', hasStatus: false,
    })
    expect(metadata?.open).toBeUndefined()
  })

  it('ignores an entry whose id is missing or empty', () => {
    expect(pluginMetadataOf({ component: null, options: {} })).toBeUndefined()
    expect(pluginMetadataOf({ component: null, options: { id: '' } })).toBeUndefined()
  })
})
