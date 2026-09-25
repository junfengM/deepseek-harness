/** `sidebar` namespace dictionaries for shell controls and global panels. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'session.new': '新会话',
  'session.new.label': '新建会话',
  'toggle.open': '打开侧边栏',
  'toggle.collapse': '收起侧边栏',
  'panels.label': '全局面板',
  'plugins.label': '插件',
  'plugins.all': '全部插件',
  'plugins.allWithOverflow': '全部插件，菜单中还有 {count} 个',
  'plugins.menuSummary': '{registered} 个 · 已钉 {pinned}',
  'plugins.pin': '钉到侧栏',
  'plugins.unpin': '取消钉住',
  'plugins.ungrouped': '其他',
  'plugins.empty': '还没有注册任何插件。',
  'plugins.pinHint': '用图钉把插件钉到侧栏外面。',
} satisfies Record<string, string>

/** The sidebar namespace key union. */
export type SidebarKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'session.new': 'New Session',
  'session.new.label': 'New session',
  'toggle.open': 'Open sidebar',
  'toggle.collapse': 'Collapse sidebar',
  'panels.label': 'Global panels',
  'plugins.label': 'Plugins',
  'plugins.all': 'All plugins',
  'plugins.allWithOverflow': 'All plugins, {count} more in menu',
  'plugins.menuSummary': '{registered} registered · {pinned} pinned',
  'plugins.pin': 'Pin to sidebar',
  'plugins.unpin': 'Unpin',
  'plugins.ungrouped': 'Other',
  'plugins.empty': 'No plugins are registered yet.',
  'plugins.pinHint': 'Use the pin to show a plugin outside the menu.',
} satisfies Record<SidebarKey, string>
