import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  ConversationNodeDefinition,
  ConversationViewDefinition,
  ConversationViewNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { DesignChangeId, DesignSessionId } from '../src/types.ts'
import { designSessionChangeDefinition } from '../src/client.ts'

class Definitions {
  constructor(private readonly definitions: readonly ConversationNodeDefinition[]) {}
  entries(): readonly ConversationNodeDefinition[] { return this.definitions }
  fallbackEntry(): ConversationNodeDefinition | undefined { return undefined }
}

interface ChatSnapshot {
  readonly order: readonly string[]
  readonly nodes: ReadonlyMap<string, ConversationViewNode>
}

class Views {
  readonly definition: ConversationViewDefinition<ConversationViewNode, ChatSnapshot> = {
    target: 'chat',
    create: () => {
      let current: ChatSnapshot = { order: [], nodes: new Map() }
      return {
        empty: current,
        replace: ({ nodes }) => {
          current = {
            order: nodes.map(node => node.key),
            nodes: new Map(nodes.map(node => [node.key, node])),
          }
          return current
        },
        apply: ({ upserts }) => {
          const nodes = new Map(current.nodes)
          const order = [...current.order]
          for (const node of upserts) {
            if (!nodes.has(node.key)) order.push(node.key)
            nodes.set(node.key, node)
          }
          current = { order, nodes }
          return current
        },
      }
    },
  }
  entries(): readonly ConversationViewDefinition[] { return [this.definition] }
}

describe('Design Workbench Conversation projection', () => {
  it('projects the durable change-event envelope into one stable chat node', () => {
    const changeId = DesignChangeId('change-1')
    const designSessionId = DesignSessionId('design-1')
    const event: SessionEvent = {
      type: 'design/session-change',
      seq: SessionSeq(0),
      time: 20,
      data: {
        version: 1,
        changeId,
        designSessionId,
        designRevision: 2,
        sourceSessionId: brandString<SessionId>('source-chat'),
        kind: 'created',
        compactSummary: 'Design session created',
        happenedAt: 20,
      },
    }
    const assembler = new ConversationNodeAssembler(
      new Definitions([designSessionChangeDefinition]),
      new Views(),
    )
    assembler.activateTarget('chat')
    assembler.replaceWindow([{ type: 'event', event }], false)
    assembler.flush()

    const snapshot = assembler.snapshot('chat') as ChatSnapshot
    expect(snapshot.order).toHaveLength(1)
    expect([...snapshot.nodes.values()][0]?.data).toMatchObject({
      changeId,
      designSessionId,
      compactSummary: 'Design session created',
    })
  })
})
