/** Conversation projection for durable Design Workbench source-chat changes. */

import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { DesignSessionChangeEvent } from './types.ts'

/** Minimal data carried by a source-chat DesignSession card. */
export interface DesignSessionChangeNodeData extends DesignSessionChangeEvent {
  readonly seq: number
}

/** Project one durable source Session event into one stable chat node. */
export const designSessionChangeDefinition: ConversationNodeDefinition<DesignSessionChangeNodeData> = {
  kind: 'design-session-change',
  target: 'chat',
  match: event => event.type === 'design/session-change'
    ? { id: String(event.data.changeId), role: 'start' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'design/session-change') {
      throw new Error('design-session-change start requires design/session-change')
    }
    return { ...match.event.data, seq: match.event.seq }
  },
  update: context => context.state,
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: 'design-session-change',
      id: context.id,
      target: 'chat',
      anchorSeq: context.state.seq,
      location: context.start?.location ?? { kind: 'unresolved' },
      visibility: 'visible',
      data: context.state,
    }
  },
}
