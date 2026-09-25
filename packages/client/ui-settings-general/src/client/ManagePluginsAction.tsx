/** Settings-owned action that opens the plugin management section. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** Callback supplied by the settings shell's request controller. */
type ManagePluginsInjected = {
  openSettings: () => void
}

/** Component props composed from the sidebar manage slot and settings locale. */
export type ManagePluginsActionProps =
  PropsRuntime<'sidebar.plugin.manage'>
  & InjectFace<ManagePluginsInjected>
  & PropsLocale<'settings'>

/**
 * Render the menu-footer entry. The sidebar shell owns the surrounding footer
 * geometry; Settings owns the action's destination and localized label.
 */
export function ManagePluginsAction({ openSettings, t }: ManagePluginsActionProps) {
  return (
    <button type="button" onClick={openSettings}>
      {t('plugins.manage')}
    </button>
  )
}
