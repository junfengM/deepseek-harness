import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import * as toolDesignWorkbench from '../src/index.ts'

const contexts: Context[] = []
const CONFIRM = '确认创建'
const QUESTION_ID = 'create-design-session-confirmation'

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function stubAgent(id: string): Agent {
  return {
    id,
    session: { id: id as SessionId, header: { delegationDepth: 0 } },
  } as unknown as Agent
}

async function setup(options: {
  answer?: AskUserQuestionAnswer
  ask?: (request: AskUserQuestionRequest) => Promise<AskUserQuestionAnswer>
  withController?: boolean
} = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const requests: AskUserQuestionRequest[] = []
  const ask = vi.fn(options.ask ?? (async (request: AskUserQuestionRequest) => {
    requests.push(request)
    return options.answer ?? { answers: [{ id: QUESTION_ID, selected: [CONFIRM] }] }
  }))
  ctx.reflect.provide('userQuestions', { ask })
  const create = vi.fn(async (request: { title: string; sourceSessionId: SessionId }) => ({
    designSession: { id: 'design-1' as never, ...request },
  }))
  if (options.withController !== false) {
    ctx.reflect.provide('designWorkbenchController', { create })
  }
  await ctx.plugin(toolDesignWorkbench)
  return { ctx, ask, create, requests }
}

async function execute(ctx: Context, title: string, agent = stubAgent('chat-1'), signal = new AbortController().signal) {
  return ctx.tools.execute({
    signal,
    callId: ToolCallId('create-design-session-1'),
    name: 'create_design_session',
    arguments: { title },
    agent,
  })
}

async function executeWithoutAgent(ctx: Context, title: string) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('create-design-session-without-agent'),
    name: 'create_design_session',
    arguments: { title },
  })
}

describe('create_design_session tool', () => {
  it('registers only with Host capability and creates only after its own explicit confirmation', async () => {
    const b = await setup()
    expect(b.ctx.tools.schemas().map(schema => schema.name)).toContain('create_design_session')

    const agent = stubAgent('source-chat')
    const result = await execute(b.ctx, '  新入口方案  ', agent)

    expect(b.requests).toHaveLength(1)
    expect(b.requests[0]?.questions[0]?.detail).toContain('source Session：source-chat')
    expect(b.requests[0]).toMatchObject({
      agent,
      questions: [{
        id: QUESTION_ID,
        header: '创建设计工作台会话',
        question: '确认创建 DesignSession「新入口方案」并关联当前聊天？',
        options: [{ label: CONFIRM }, { label: '取消' }],
      }],
    })
    expect(b.create).toHaveBeenCalledExactlyOnceWith({ title: '新入口方案', sourceSessionId: 'source-chat' })
    expect(result.isError).toBe(false)
    const message = result.content.find(part => part.type === 'text')
    expect(message?.text).toContain('design-1')
  })

  it('does not create when the user declines', async () => {
    const b = await setup({ answer: { answers: [{ id: QUESTION_ID, selected: ['取消'] }] } })
    const result = await execute(b.ctx, 'A design task')

    expect(b.create).not.toHaveBeenCalled()
    expect(result.isError).toBe(false)
    const message = result.content.find(part => part.type === 'text')
    expect(message?.text).toContain('未创建')
  })

  it('does not create if the question is cancelled, aborted, or the calling chat agent is absent', async () => {
    const rejected = await setup({ ask: async () => { throw new Error('user question cancelled') } })
    const failed = await execute(rejected.ctx, 'Cancelled task')
    expect(failed.isError).toBe(true)
    expect(rejected.create).not.toHaveBeenCalled()

    const abort = new AbortController()
    const aborted = await setup({ ask: async () => {
      abort.abort()
      return { answers: [{ id: QUESTION_ID, selected: [CONFIRM] }] }
    } })
    const abortedResult = await execute(aborted.ctx, 'Aborted task', stubAgent('chat-2'), abort.signal)
    expect(abortedResult.isError).toBe(true)
    expect(aborted.create).not.toHaveBeenCalled()

    const noAgent = await setup()
    const noAgentResult = await executeWithoutAgent(noAgent.ctx, 'No caller')
    expect(noAgentResult.isError).toBe(true)
    expect(noAgent.ask).not.toHaveBeenCalled()
    expect(noAgent.create).not.toHaveBeenCalled()
  })

  it('does not advertise the tool when the Host Workbench controller is not composed', async () => {
    const b = await setup({ withController: false })
    expect(b.ctx.tools.schemas().map(schema => schema.name)).not.toContain('create_design_session')
  })
})
