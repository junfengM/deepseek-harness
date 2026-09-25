/** Design Workbench shell copy: panel chrome, task list, and detail labels. */

/** Locale namespace owned by this package's shell. */
export const DESIGN_WORKBENCH_NS = 'design-workbench'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'panel.title': '设计工作台',
  'panel.subtitle': '来自 Host 的持久设计任务。',
  'panel.reconnecting': '正在重连…',
  'panel.refreshFailed': '无法刷新设计任务。',
  'tasks.heading': '任务',
  'tasks.loading': '正在加载任务…',
  'tasks.empty': '还没有设计任务。',
  'details.heading': '详情',
  'details.hint': '选择一个任务以查看它的持久摘要。',
  'details.title': '标题',
  'details.status': '状态',
  'details.revision': '修订',
  'details.sourceSession': '来源会话',
  'status.awaitingOne': '{count} 个设计任务等待你处理',
  'status.awaitingMany': '{count} 个设计任务等待你处理',
  'plugin.label': '设计工作台',
} satisfies Record<string, string>

/** Translation keys owned by the Design Workbench shell. */
export type DesignWorkbenchKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Design Workbench shell copy. */
    'design-workbench': DesignWorkbenchKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'panel.title': 'Design Workbench',
  'panel.subtitle': 'Durable design tasks from the Host.',
  'panel.reconnecting': 'Reconnecting…',
  'panel.refreshFailed': 'Unable to refresh design tasks.',
  'tasks.heading': 'Tasks',
  'tasks.loading': 'Loading tasks…',
  'tasks.empty': 'No design tasks yet.',
  'details.heading': 'Details',
  'details.hint': 'Select a task to inspect its durable summary.',
  'details.title': 'Title',
  'details.status': 'Status',
  'details.revision': 'Revision',
  'details.sourceSession': 'Source Session',
  'status.awaitingOne': '{count} design task awaiting user',
  'status.awaitingMany': '{count} design tasks awaiting user',
  'plugin.label': 'Design Workbench',
} satisfies Record<DesignWorkbenchKey, string>
