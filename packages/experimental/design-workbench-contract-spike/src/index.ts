/** Phase-zero Design Workbench contract spike. */

export { DesignSessionRegistry, DesignSessionConflictError } from './registry.ts'
export { deliverDesignOutbox } from './outbox.ts'
export { designSessionRecord, designWorkbenchDomainSpec } from './spec.ts'
export {
  DesignChangeId,
  DesignSessionId,
} from './types.ts'
export type {
  DesignOutboxEntry,
  DesignSessionChangeEvent,
  DesignSessionChangeKind,
  DesignSessionRecord,
  DesignSessionStatus,
} from './types.ts'
