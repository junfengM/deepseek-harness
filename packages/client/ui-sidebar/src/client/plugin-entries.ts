/**
 * Sidebar plugin registry: the projection the shell renders from, plus the
 * persisted pin list.
 *
 * The registration half mirrors the panel-list projection in index.ts: live
 * `sidebar.plugin` entries are projected into metadata and value-compared
 * before they reach the snapshot store, so a re-registration that changes
 * nothing does not re-render the column.
 *
 * Pins are USER state, not registration state, so they live in their own
 * store with `localStorage` persistence. Two consequences are deliberate:
 * a pin survives its plugin not being loaded yet (the shell filters unknown
 * ids at READ time instead of pruning them at boot), and the persisted value
 * is normalized once at startup because the store layer performs no schema
 * checking on rehydration.
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarPluginMetadata, SidebarPluginIcon } from './contract/slots.ts'

/** localStorage key of the pinned-id list (storage identity; renaming drops user state). */
export const PLUGIN_PINS_STORAGE = 'dsh.sidebar.plugins.pinned'

/**
 * New users open on the shape the design was tuned against. An id here that
 * never registers stays harmless: the shell intersects pins with the live
 * registry before rendering.
 */
export const DEFAULT_PLUGIN_PINS: readonly string[] = ['trend-radar', 'sql-library', 'ai-image-gen']

/** Pins rendered outside the menu before the overflow menu takes over. */
export const PLUGIN_PIN_LIMIT = 3

/** Empty or non-string ids are malformed; valid ids remain opaque to this layer. */

/** Runtime allowlist; it mirrors the shell-owned PLUGIN_ICONS map. */
const PLUGIN_ICON_NAMES: readonly string[] = [
  'plugin', 'radar', 'image', 'database', 'sparkle', 'code', 'data', 'gauge', 'goal', 'skill', 'search',
]

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

function iconOf(value: unknown): SidebarPluginIcon {
  return typeof value === 'string' && PLUGIN_ICON_NAMES.includes(value)
    ? value as SidebarPluginIcon
    : 'plugin'
}

function labelOf(label: Parameters<typeof resolveSlotLabel>[0], fallback: string): string {
  let resolved: unknown
  try {
    resolved = resolveSlotLabel(label)
  } catch {
    return fallback
  }
  return typeof resolved === 'string' && resolved.length > 0 ? resolved : fallback
}

/**
 * Defensive read of a persisted pin list. Rehydration is a bare JSON.parse
 * with no schema check, so a hand-edited or older value can be any JSON at
 * all. Unknown but well-formed ids are KEPT: the registry may simply not have
 * loaded that plugin yet, and dropping it here would make the pin impossible
 * to recover.
 * @param value - persisted value of unknown shape.
 * @returns a clean, de-duplicated id list (never a shared array).
 */
export function normalizePins(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [...DEFAULT_PLUGIN_PINS]
  const seen = new Set<string>()
  const pins: string[] = []
  for (const raw of value) {
    if (typeof raw !== 'string' || raw.length === 0) continue
    if (seen.has(raw)) continue
    seen.add(raw)
    pins.push(raw)
  }
  return pins
}

/**
 * Create the persisted pin store and normalize whatever rehydrated.
 * Normalization runs once, before any plugin registers, so it cannot mistake
 * "not loaded yet" for "unknown".
 * @returns the pin store.
 */
export function createPluginPinStore(): SnapshotStore<readonly string[]> {
  const store = createSnapshotStore<readonly string[]>(
    [...DEFAULT_PLUGIN_PINS],
    { persist: { name: PLUGIN_PINS_STORAGE } },
  )
  store.set(normalizePins(store.getSnapshot()))
  return store
}

/**
 * Project one registration into shell metadata, or `undefined` when the entry
 * carries no usable id (the core only checks that `id` exists, and a dynamic
 * registrant can bypass the types).
 * @param entry - one live `sidebar.plugin` registration.
 * @returns metadata plus the activation callback, or undefined when unusable.
 */
export function pluginMetadataOf(entry: StoredEntry): SidebarPluginMetadata | undefined {
  const id = entry.options.id
  if (typeof id !== 'string' || id.length === 0) return undefined
  const registration = recordOf(entry.options.registration)
  const order = entry.options.order
  const open = registration?.open
  return {
    id,
    order: typeof order === 'number' && Number.isFinite(order) ? order : 0,
    label: labelOf(entry.options.label, id),
    icon: iconOf(registration?.icon),
    group: typeof registration?.group === 'string' ? registration.group : '',
    hasStatus: registration?.hasStatus === true,
    ...typeof open === 'function' ? { open: open as () => void } : {},
  }
}

/**
 * Value comparison for the plugin snapshot. The identity of `open` counts: a
 * re-registration that swaps the activation callback must reach the shell even
 * when every visible field is unchanged.
 * @param left - previous metadata list.
 * @param right - next metadata list.
 * @returns whether the two lists render identically.
 */
export function samePlugins(
  left: readonly SidebarPluginMetadata[],
  right: readonly SidebarPluginMetadata[],
): boolean {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index]
    return other !== undefined
      && item.id === other.id
      && item.order === other.order
      && item.label === other.label
      && item.icon === other.icon
      && item.group === other.group
      && item.hasStatus === other.hasStatus
      && item.open === other.open
  })
}
