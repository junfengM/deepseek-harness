/**
 * Sidebar slot contract: the registrant-side props composition for the
 * layout-owned `sidebar` slot, plus the holes this shell declares. The shell
 * owns column geometry, the brand row, New Session, and global panel rows;
 * everything between the workspace section header and the list bottom is the
 * `sidebar.workspaces` registrant's (ui-workspace), and the foot is the
 * `sidebar.settings` registrant's (ui-settings), followed by optional footer
 * actions in `sidebar.footer.action` and the shell-owned plugin area fed by
 * `sidebar.plugin`.
 */
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Non-interactive notification inside the collapsed sidebar expand button. */
    'sidebar.toggle.badge': { kind: 'single'; scope: 'root'; owner: Record<never, never> }
    /**
     * Brand mark rendered in the expanded brand row and collapsed rail.
     * Declared by this package's `sidebar` entry; deployments may replace
     * the shell's fish fallback without replacing the surrounding controls.
     */
    'sidebar.brand.mark': { kind: 'single'; scope: 'root'; owner: SidebarBrandMarkOwnerProps }
    /**
     * Brand name rendered beside the expanded mark. Declared by this
     * package's `sidebar` entry; the shell supplies a generic text fallback.
     */
    'sidebar.brand.name': { kind: 'single'; scope: 'root'; owner: SidebarBrandNameOwnerProps }
    /**
     * Global panel icons. Each list id addresses the matching main panel;
     * the sidebar owns the button and resolves its label from list metadata.
     */
    'sidebar.panellist': { kind: 'list'; scope: 'root'; owner: SidebarPanelIconOwnerProps }
    /**
     * The workspace/session browsing region: section header, search, the
     * grouped/flat session list, and every workspace dialog. Declared by this
     * package's 'sidebar' entry (declaring is claiming); ui-workspace
     * registers the browser.
     */
    'sidebar.workspaces': { kind: 'single'; scope: 'root'; owner: SidebarSectionOwnerProps }
    /**
     * The settings seat at the sidebar foot. Declared by this package's
     * 'sidebar' entry; ui-settings registers its trigger row + modal panel.
     * The sidebar passes only its column state — it holds no settings state.
     */
    'sidebar.settings': { kind: 'single'; scope: 'root'; owner: SidebarSettingsOwnerProps }
    /**
     * Optional actions beside Settings at the sidebar foot. Declared by this
     * package's 'sidebar' entry; each action receives only the column state.
     *
     * This is NOT the plugin channel: the shell renders these at full column
     * width with no pinning and no overflow, so a plugin that needs pinning,
     * ordering, or a status glyph registers into `sidebar.plugin` instead.
     */
    'sidebar.footer.action': { kind: 'list'; scope: 'root'; owner: SidebarFooterActionOwnerProps }
    /**
     * Plugin entries for the sidebar plugin area. The shell owns the button
     * geometry, the pin list, the overflow menu, and every glyph; a
     * registration contributes metadata (registration.icon / .group / .open /
     * .hasStatus) plus a component that paints ONLY its own status glyph and
     * exposes its value as readable text or an aria-label.
     * Declared by this package's 'sidebar' entry.
     */
    'sidebar.plugin': {
      kind: 'list'
      scope: 'root'
      owner: SidebarPluginOwnerProps
      registration: SidebarPluginRegistration
    }
    /** Optional settings-owned management action in the plugin overflow footer. */
    'sidebar.plugin.manage': { kind: 'single'; scope: 'root' }
  }
}

/** Geometry supplied to the sidebar brand-mark occupant. */
export interface SidebarBrandMarkOwnerProps {
  /** Requested square edge in pixels. */
  size: number
}

/** Empty owner share for the sidebar brand-name occupant. */
export interface SidebarBrandNameOwnerProps {
  /** Marker field: the occupant owns its own content and width. */
  children?: never
}

/** Icon presentation supplied by the global panel row. */
export interface SidebarPanelIconOwnerProps {
  /** Requested square edge in pixels. */
  size: number
  /** Whether this panel is selected in the main column. */
  active: boolean
}

/** Serializable metadata for one active global panel list registration. */
export interface SidebarPanelMetadata {
  /** List id and matching main panel key. */
  id: MainPanelId
  /** Ascending row order; ties retain registration order. */
  order: number
  /** Row title and accessible name: resolved label, or the id when omitted. */
  label: string
}

/**
 * Owner share of the browser hole — the only facts crossing the shell/region
 * boundary. Business data and actions arrive through the region's own inject.
 */
export interface SidebarSectionOwnerProps {
  /** Shell fold-state output: wide renders the full browser, rail the icon column. */
  wide: boolean
  /** Rail icons request expansion; the browser rides the wide flip for focus. */
  expandSidebar: () => void
}

/**
 * Owner share of the sidebar settings seat: the column display state the
 * occupant's trigger row must render against (wide row vs rail icon).
 */
export interface SidebarSettingsOwnerProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
}

/** Owner share of an action rendered beside Settings at the sidebar foot. */
export interface SidebarFooterActionOwnerProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
}

/**
 * Icon name a plugin entry may declare. Names, never markup: the shell maps
 * each to a shipped glyph, which is what keeps one column in one visual
 * language. Add a name here (and to the shell's map) rather than accepting an
 * inline SVG from a registrant.
 */
export type SidebarPluginIcon =
  | 'plugin'
  | 'radar'
  | 'image'
  | 'database'
  | 'sparkle'
  | 'code'
  | 'data'
  | 'gauge'
  | 'goal'
  | 'skill'
  | 'search'

/** Per-registration plugin metadata, nested under `registration` in the register call. */
export interface SidebarPluginRegistration {
  /** Built-in icon name; defaults to 'plugin'. */
  icon?: SidebarPluginIcon
  /** Menu grouping heading; '' collects under the trailing heading. */
  group?: string
  /**
   * Invoked when the shell activates this entry (its pinned button or its menu
   * row). Synchronous on purpose: a plugin that needs async work kicks it off
   * inside the callback, and the shell never awaits a registrant.
   */
  open?: () => void
  /**
   * Declares that this entry paints a status glyph. The shell renders it in a
   * fixed seat in both pinned and menu rows; the seat does not participate in
   * fit width, so a status that appears later cannot invalidate the fit.
   */
  hasStatus?: boolean
}

/**
 * Owner share of a plugin entry: the column state its status component
 * renders against. The component paints ONLY its own glyph — the shell owns
 * the button, icon, label, and geometry. It must expose the status value to
 * assistive technology with readable text or an `aria-label`; a decorative-only
 * dot is not sufficient.
 */
export interface SidebarPluginOwnerProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
  /** Requested square edge in pixels for the entry's status glyph. */
  size: number
  /** Whether this entry is currently pinned outside the menu. */
  pinned: boolean
}

/** Serializable metadata the shell projects from one live plugin registration. */
export interface SidebarPluginMetadata {
  /** List id; also the persisted pin identity. */
  id: string
  /** Ascending entry order; ties retain registration order. */
  order: number
  /** Menu row title and accessible name (resolved label, or the id when omitted). */
  label: string
  /** Shell-owned glyph name. */
  icon: SidebarPluginIcon
  /** Menu grouping heading; '' groups under the trailing heading. */
  group: string
  /** Whether the entry renders a status glyph in the fixed pinned/menu seat. */
  hasStatus: boolean
  /** Activation callback from the registration; in-memory only, never persisted. */
  open?: (() => void) | undefined
}

/**
 * Registrant-private injected share (arrives via the register inject
 * factory). The renderer binds the panel metadata source to usePanels.
 */
export type SidebarRootInjected = {
  /**
   * Start a New Session: with a workspace, reuse-or-create its blank session
   * and open it; without one, inherit the current Session Workspace, then the
   * recent Workspace, or clear into the New Session pure view when none exist.
   */
  startSession: (workspaceId?: WorkspaceId) => void
  /** Toggle the sidebar column through the layout service. */
  toggleSidebar: () => void
  /** Select the global panel addressed by a sidebar row. */
  selectPanel: (id: MainPanelId) => void
  /** Pin or unpin one plugin entry. Pins are user state, not registration state. */
  togglePluginPin: (id: string) => void
  /** Private reactive sources bound to framework selector hooks. */
  hooks: {
    panels: ObservableSnapshot<readonly SidebarPanelMetadata[]>
    shortcuts: ObservableSnapshot<readonly ShortcutCatalogEntry[]>
    /** Live plugin entries, ascending by order. */
    plugins: ObservableSnapshot<readonly SidebarPluginMetadata[]>
    /** User pin list; unknown ids are kept so a late-loaded plugin returns pinned. */
    pluginPins: ObservableSnapshot<readonly string[]>
  }
}

/**
 * Full component props: layout owner state/actions plus the declared holes'
 * render shares, this package's injected callbacks, and the standard locale
 * seat. Panel metadata arrives through an injected observable.
 */
export type SidebarRootComponentProps =
  PropsRuntime<'sidebar'>
  & PropsRenderSlots<
    | 'sidebar.brand.mark'
    | 'sidebar.brand.name'
    | 'sidebar.toggle.badge'
    | 'sidebar.panellist'
    | 'sidebar.workspaces'
    | 'sidebar.settings'
    | 'sidebar.footer.action'
    | 'sidebar.plugin'
    | 'sidebar.plugin.manage'
  >
  & InjectFace<SidebarRootInjected> & PropsLocale<'sidebar'>
