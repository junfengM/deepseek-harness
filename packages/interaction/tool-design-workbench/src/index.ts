/** User-confirmed handoff from an ordinary chat into Design Workbench. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-design-workbench'

export const name = 'tool-design-workbench'
export const inject = ['tools', 'userQuestions']

const TOOL_NAME = 'create_design_session'
const QUESTION_ID = 'create-design-session-confirmation'
const CONFIRM_LABEL = '确认创建'

/** Register only when the Host Workbench capability is composed. */
export function apply(ctx: Context): void {
  const controller = ctx.get('designWorkbenchController')
  if (controller === undefined) return

  ctx.tools.register(defineTool({
    name: TOOL_NAME,
    description: 'Create a durable DesignSession from the current ordinary chat when the user wants to begin a concrete design task. Always show the exact title and wait for the user to choose the confirmation option inside this tool before creating anything. Do not call for routine questions or open-ended brainstorming. The source chat is derived from the calling root agent; this does not start a child agent or change the source Session.',
    parameters: {
      title: {
        type: 'string',
        required: true,
        description: 'Concise title for the new DesignSession, proposed from the current conversation.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          created: { type: 'boolean', required: true },
          title: { type: 'string', required: true },
          sourceSessionId: { type: 'string', required: true },
          designSessionId: { type: 'string' },
          reason: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.created
          ? '已创建 DesignSession「' + value.title + '」' + (value.designSessionId === undefined ? '' : '（' + value.designSessionId + '）') + '，并关联当前聊天。'
          : '未创建 DesignSession「' + value.title + '」：用户取消或未选择确认。',
      }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) {
        throw new Error('create_design_session requires an active ordinary chat agent')
      }
      const title = args.title.trim()
      if (title === '') throw new Error('DesignSession title must not be blank')
      const sourceSessionId = agent.session.id

      const answer = await ctx.userQuestions.ask({
        questions: [{
          id: QUESTION_ID,
          header: '创建设计工作台会话',
          question: '确认创建 DesignSession「' + title + '」并关联当前聊天？',
          detail: '这会在 Host 中持久化一个活动会话（source Session：' + sourceSessionId + '），不会启动子 agent，也不会更改当前聊天。创建后，匹配的 Host 更新抵达时会打开 Workbench。',
          options: [
            { label: CONFIRM_LABEL, description: '创建 DesignSession，并在当前聊天仍打开时进入 Workbench。' },
            { label: '取消', description: '返回普通聊天，不创建任何记录。' },
          ],
        }],
        agent,
        signal: exec.signal,
      })
      exec.signal.throwIfAborted()

      const selected = answer.answers.find(item => item.id === QUESTION_ID)?.selected ?? []
      if (!selected.includes(CONFIRM_LABEL)) {
        return { created: false, title, sourceSessionId, reason: 'user-declined' }
      }

      const result = await controller.create({ title, sourceSessionId })
      return {
        created: true,
        title,
        sourceSessionId,
        designSessionId: result.designSession.id,
      }
    },
  }))
}
