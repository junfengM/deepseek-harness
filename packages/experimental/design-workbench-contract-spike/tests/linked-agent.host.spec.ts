import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { agentPresetProjectionDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { createSessionTestRemote } from '../../../api/session-controller/tests/test-remote.ts'
import type { SessionRequestId } from '../../../api/session-controller/src/types.ts'

const DESIGN_PRESET = 'design-workbench'
const roots: string[] = []
const contexts = new Set<Context>()

afterEach(async () => {
  for (const ctx of [...contexts].reverse()) {
    await ctx.fiber.dispose()
    contexts.delete(ctx)
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function presetRoster(mounted: string[]) {
  const preset = (id: string) => ({
    id,
    trust: 'system',
    path: `/presets/${id}/agent.cordis.yml`,
  })
  return {
    defaultId: 'general',
    resolve: async (id?: string) => {
      const selected = id ?? 'general'
      if (selected !== DESIGN_PRESET && selected !== 'general') throw new Error(`unknown preset ${selected}`)
      return preset(selected)
    },
    mount: async (_ctx: Context, id?: string) => {
      const selected = id ?? 'general'
      mounted.push(selected)
      return preset(selected)
    },
  }
}

async function stack(root: string, responses: string[]) {
  const ctx = new Context()
  contexts.add(ctx)
  await mountAgentLoopTestDependencies(ctx)
  ctx.sessionProjections.register(agentPresetProjectionDefinition)
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions'), compression: 'none' })
  const mounted: string[] = []
  ctx.provide('agentPresets', presetRoster(mounted) as never)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new MockAdapter(responses.map(textResponse))
  ctx.llm.registerAdapter(['mock'], adapter)
  const remote = createSessionTestRemote(ctx, {
    defaultModelSelection: () => ({ provider: 'mock', model: 'mock' }),
    cwd: root,
  })
  return {
    ctx,
    remote,
    mounted,
    close: async () => {
      await ctx.fiber.dispose()
      contexts.delete(ctx)
    },
  }
}

function textOf(event: SessionEvent): string {
  const content = event.type === 'user/message'
    ? event.data.content
    : event.type === 'assistant/message'
      ? event.data.message.content
      : []
  return content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

async function waitForExchange(agent: Agent, prompt: string, response: string): Promise<void> {
  await vi.waitFor(() => {
    const events = agent.session.snapshotEvents()
    expect(events.some(event => event.type === 'user/message' && textOf(event) === prompt)).toBe(true)
    expect(events.some(event => event.type === 'assistant/message' && textOf(event) === response)).toBe(true)
  }, { timeout: 10_000 })
  await agent.ctx.sessions.flush(agent.session)
}

describe('Design Workbench linked Agent contract', () => {
  it('creates with an explicit design preset and cold-resumes task feedback under the same preset', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-design-agent-')))
    roots.push(root)
    const linkedId = SessionId('design-linked-agent')

    const first = await stack(root, ['initial design acknowledgement'])
    const created = await first.remote.create({
      sessionId: linkedId,
      cwd: root,
      agentPreset: DESIGN_PRESET,
    })
    expect(created).toMatchObject({ ok: true, value: { sessionId: linkedId, agentPreset: DESIGN_PRESET } })
    expect(first.mounted).toEqual([DESIGN_PRESET])
    expect(first.ctx.sessions.get(linkedId)?.header.agentPreset).toBe(DESIGN_PRESET)

    const initialPrompt = 'Task context: compare two real layout routes.'
    const initial = await first.remote.prompt({
      requestId: 'design-initial' as SessionRequestId,
      sessionId: linkedId,
      mode: 'queue',
      content: [{ type: 'text', text: initialPrompt }],
    })
    expect(initial).toMatchObject({ ok: true, value: { accepted: true } })
    const firstAgent = first.ctx.agents.get(linkedId)
    if (firstAgent === undefined) throw new Error('linked design Agent was not created')
    await waitForExchange(firstAgent, initialPrompt, 'initial design acknowledgement')
    await first.close()

    const second = await stack(root, ['revised route recorded'])
    expect(second.ctx.agents.get(linkedId)).toBeUndefined()
    const feedback = 'Feedback for route B at 375px: the filter is too tall.'
    const resumed = await second.remote.prompt({
      requestId: 'design-feedback' as SessionRequestId,
      sessionId: linkedId,
      mode: 'queue',
      content: [{ type: 'text', text: feedback }],
    })
    expect(resumed).toMatchObject({ ok: true, value: { accepted: true } })
    const resumedAgent = second.ctx.agents.get(linkedId)
    if (resumedAgent === undefined) throw new Error('linked design Agent was not cold-resumed')
    await waitForExchange(resumedAgent, feedback, 'revised route recorded')
    expect(resumedAgent.session.header.agentPreset).toBe(DESIGN_PRESET)
    expect(second.mounted).toEqual([DESIGN_PRESET])

    // Fresh Sessions persist their initial preset in the header; a later
    // agent-preset/selected event exists only when the user changes it.
    expect(resumedAgent.session.header.agentPreset).toBe(DESIGN_PRESET)
    await second.close()
  }, 20_000)
})
